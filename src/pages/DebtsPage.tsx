import { useState, useEffect, useCallback } from 'react';
import { HandCoins, Search, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatCurrency, formatDate, fullName } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader, Badge, Pagination } from '@/components/ui';
import type { Debt, Patient, Invoice } from '@/types';

const PAGE_SIZE = 15;

interface DebtWithRelations extends Debt {
  patient?: Patient;
  invoice?: Invoice;
}

export default function DebtsPage() {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtWithRelations[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [payingDebt, setPayingDebt] = useState<DebtWithRelations | null>(null);

  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('debts')
      .select('*, patient:patients(*), invoice:invoices(*)', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`patient.first_name.ilike.%${search}%,patient.last_name.ilike.%${search}%,invoice.invoice_number.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    setDebts((data as DebtWithRelations[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const handlePayment = async (debt: DebtWithRelations, amount: number, method: 'cash' | 'card' | 'guarantee_card') => {
    if (amount <= 0 || !debt.invoice) return;

    // Check remaining balance atomically
    const { data: freshDebt } = await supabase
      .from('debts')
      .select('*')
      .eq('id', debt.id)
      .maybeSingle();

    if (!freshDebt) return;
    const currentDebt = freshDebt as Debt;

    if (currentDebt.status !== 'active') {
      alert('Cette dette est déjà soldée.');
      return;
    }

    if (amount > currentDebt.remaining_amount + 0.01) {
      alert(`Le montant (${formatCurrency(amount)}) dépasse le solde restant de la dette (${formatCurrency(currentDebt.remaining_amount)}).`);
      return;
    }

    const newPaidAmount = currentDebt.paid_amount + amount;
    const newRemaining = Math.max(0, currentDebt.original_amount - newPaidAmount);
    const newDebtStatus = newRemaining <= 0 ? 'paid' : 'active';

    // Update debt
    await supabase.from('debts').update({
      paid_amount: newPaidAmount,
      remaining_amount: newRemaining,
      status: newDebtStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', debt.id);

    // Create payment
    const { data: seqData } = await supabase.rpc('generate_payment_number');
    const paymentNumber = seqData as string;

    const { data: payData } = await supabase.from('payments').insert({
      payment_number: paymentNumber,
      invoice_id: debt.invoice_id,
      patient_id: debt.patient_id,
      amount,
      method,
      received_by: profile?.id ?? null,
      notes: `Paiement de dette — ${debt.invoice?.invoice_number}`,
    }).select().single();

    // Create receipt
    if (payData) {
      const { data: receiptSeq } = await supabase.rpc('generate_receipt_number');
      const receiptNumber = receiptSeq as string;
      await supabase.from('receipts').insert({
        receipt_number: receiptNumber,
        payment_id: (payData as { id: string }).id,
        patient_id: debt.patient_id,
        invoice_id: debt.invoice_id,
        amount,
        method,
        remaining_balance: newRemaining,
        issued_by: profile?.id ?? null,
      });
    }

    // Update invoice
    const invoice = debt.invoice;
    if (invoice) {
      const invNewPaid = invoice.paid_amount + amount;
      const invNewRemaining = Math.max(0, invoice.total - invNewPaid);
      const invNewStatus = invNewRemaining <= 0 ? 'paid' : 'partially_paid';
      await supabase.from('invoices').update({
        paid_amount: invNewPaid,
        remaining_amount: invNewRemaining,
        status: invNewStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', invoice.id);
    }

    await logAudit('debt_payment', 'debt', debt.id, formatCurrency(amount), {
      invoice_id: debt.invoice_id, amount, method,
    });

    setPayingDebt(null);
    load();
  };

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const totalRemaining = debts.filter((d) => d.status === 'active').reduce((s, d) => s + d.remaining_amount, 0);

  return (
    <div>
      <PageHeader
        title="Dettes"
        subtitle={`${total} dette(s) — Reste à recouvrer : ${formatCurrency(totalRemaining)}`}
      />

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Rechercher par patient ou facture..."
          className="input pl-10"
        />
      </div>

      {debts.length === 0 ? (
        <EmptyState
          icon={<HandCoins className="w-12 h-12" />}
          title="Aucune dette trouvée"
          description="Les dettes sont créées automatiquement lorsqu’une facture n’est pas entièrement payée."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-left px-4 py-3">Facture</th>
                  <th className="table-header text-right px-4 py-3">Montant initial</th>
                  <th className="table-header text-right px-4 py-3">Payé</th>
                  <th className="table-header text-right px-4 py-3">Reste</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {debts.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(d.patient)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{d.invoice?.invoice_number ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatCurrency(d.original_amount)}</td>
                    <td className="px-4 py-3 text-sm text-green-600 text-right">{formatCurrency(d.paid_amount)}</td>
                    <td className="px-4 py-3 text-sm text-red-600 text-right font-medium">{formatCurrency(d.remaining_amount)}</td>
                    <td className="px-4 py-3">
                      <Badge className={d.status === 'active' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-green-100 text-green-700 border-green-200'}>
                        {d.status === 'active' ? 'Active' : 'Soldée'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && d.status === 'active' && (
                        <button onClick={() => setPayingDebt(d)} className="btn-primary btn-sm">
                          <Plus className="w-4 h-4" /> Payer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      {payingDebt && (
        <DebtPaymentModal
          debt={payingDebt}
          onClose={() => setPayingDebt(null)}
          onPay={(amount, method) => handlePayment(payingDebt, amount, method)}
        />
      )}
    </div>
  );
}

function DebtPaymentModal({ debt, onClose, onPay }: {
  debt: DebtWithRelations;
  onClose: () => void;
  onPay: (amount: number, method: 'cash' | 'card' | 'guarantee_card') => void;
}) {
  const [amount, setAmount] = useState(debt.remaining_amount);
  const [method, setMethod] = useState<'cash' | 'card' | 'guarantee_card'>('cash');

  return (
    <Modal open onClose={onClose} title="Paiement de dette" size="sm">
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Patient</span><span className="font-medium">{fullName(debt.patient)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Facture</span><span className="font-mono">{debt.invoice?.invoice_number}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Reste à payer</span><span className="font-bold text-red-600">{formatCurrency(debt.remaining_amount)}</span></div>
        </div>
        <div>
          <label className="label">Montant à payer *</label>
          <input
            type="number"
            min={0}
            max={debt.remaining_amount}
            step="0.01"
            className="input"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Méthode de paiement</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
          <button
            onClick={() => amount > 0 && onPay(amount, method)}
            disabled={amount <= 0 || amount > debt.remaining_amount + 0.01}
            className="btn-primary btn-sm"
          >
            Encaisser
          </button>
        </div>
      </div>
    </Modal>
  );
}
