import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, CreditCard, X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatCurrency, formatDate, fullName } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader, Badge, Pagination } from '@/components/ui';
import type { Payment, Invoice, Patient } from '@/types';

const PAGE_SIZE = 15;

function methodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

interface SplitMethod {
  method: 'cash' | 'card' | 'guarantee_card';
  amount: number;
}

export default function PaymentsPage() {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<(Payment & { patient?: Patient })[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [invoices, setInvoices] = useState<(Invoice & { patient?: Patient })[]>([]);

  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('payments')
      .select('*, patient:patients(*)', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`payment_number.ilike.%${search}%,patient.first_name.ilike.%${search}%,patient.last_name.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    setPayments((data as (Payment & { patient?: Patient })[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const loadInvoices = useCallback(async () => {
    const { data } = await supabase
      .from('invoices')
      .select('*, patient:patients(*)')
      .in('status', ['unpaid', 'partially_paid'])
      .order('created_at', { ascending: false });
    setInvoices((data as (Invoice & { patient?: Patient })[]) ?? []);
  }, []);

  useEffect(() => { if (canEdit) loadInvoices(); }, [canEdit, loadInvoices]);

  const handleCreatePayment = async (data: {
    invoiceId: string;
    splitMethods: SplitMethod[];
    notes: string;
  }) => {
    const totalAmount = data.splitMethods.reduce((s, m) => s + m.amount, 0);
    if (totalAmount <= 0) return;

    // Fetch invoice and check remaining balance atomically
    const { data: inv, error: invErr } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', data.invoiceId)
      .maybeSingle();

    if (invErr || !inv) { console.error(invErr); return; }
    const invoice = inv as Invoice;

    if (invoice.status === 'cancelled') {
      alert('Cette facture est annulée. Aucun paiement ne peut être effectué.');
      return;
    }

    const currentRemaining = invoice.remaining_amount;
    if (totalAmount > currentRemaining + 0.01) {
      alert(`Le montant du paiement (${formatCurrency(totalAmount)}) dépasse le solde restant (${formatCurrency(currentRemaining)}).`);
      return;
    }

    const newPaidAmount = invoice.paid_amount + totalAmount;
    const newRemaining = Math.max(0, invoice.total - newPaidAmount);
    const newStatus = newRemaining <= 0 ? 'paid' : 'partially_paid';

    const { data: seqData } = await supabase.rpc('generate_payment_number');
    const paymentNumber = seqData as string;

    const patientId = invoice.patient_id;

    // Create payment record for each split method
    for (const sm of data.splitMethods) {
      if (sm.amount <= 0) continue;
      const { data: payData, error: payErr } = await supabase.from('payments').insert({
        payment_number: paymentNumber,
        invoice_id: data.invoiceId,
        patient_id: patientId,
        amount: sm.amount,
        method: sm.method,
        received_by: profile?.id ?? null,
        notes: data.notes || null,
      }).select().single();

      if (payErr) { console.error(payErr); return; }
      const payment = payData as Payment;

      // Create receipt
      const { data: receiptSeq } = await supabase.rpc('generate_receipt_number');
      const receiptNumber = receiptSeq as string;
      await supabase.from('receipts').insert({
        receipt_number: receiptNumber,
        payment_id: payment.id,
        patient_id: patientId,
        invoice_id: data.invoiceId,
        amount: sm.amount,
        method: sm.method,
        remaining_balance: newRemaining,
        issued_by: profile?.id ?? null,
      });

      await logAudit('payment_create', 'payment', payment.id, paymentNumber, {
        invoice_id: data.invoiceId, amount: sm.amount, method: sm.method,
      });
    }

    // Update invoice
    await supabase.from('invoices').update({
      paid_amount: newPaidAmount,
      remaining_amount: newRemaining,
      status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', data.invoiceId);

    // Create or update debt if remaining > 0
    if (newRemaining > 0) {
      const { data: existingDebt } = await supabase
        .from('debts')
        .select('*')
        .eq('invoice_id', data.invoiceId)
        .eq('status', 'active')
        .maybeSingle();

      if (existingDebt) {
        await supabase.from('debts').update({
          paid_amount: newPaidAmount,
          remaining_amount: newRemaining,
          updated_at: new Date().toISOString(),
        }).eq('id', existingDebt.id);
      } else {
        await supabase.from('debts').insert({
          patient_id: patientId,
          invoice_id: data.invoiceId,
          original_amount: invoice.total,
          paid_amount: newPaidAmount,
          remaining_amount: newRemaining,
          status: 'active',
        });
      }
    } else {
      // Debt fully paid — update status
      await supabase.from('debts').update({
        paid_amount: newPaidAmount,
        remaining_amount: 0,
        status: 'paid',
        updated_at: new Date().toISOString(),
      }).eq('invoice_id', data.invoiceId).eq('status', 'active');
    }

    setShowForm(false);
    load();
  };

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Paiements"
        subtitle={`${total} paiement(s)`}
        actions={canEdit && (
          <button onClick={() => { loadInvoices(); setShowForm(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau paiement
          </button>
        )}
      />

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Rechercher par numéro ou patient..."
          className="input pl-10"
        />
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-12 h-12" />}
          title="Aucun paiement trouvé"
          description="Enregistrez un nouveau paiement ou modifiez votre recherche."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">N° Paiement</th>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-right px-4 py-3">Montant</th>
                  <th className="table-header text-left px-4 py-3">Méthode</th>
                  <th className="table-header text-left px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{p.payment_number}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(p.patient)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200">{methodLabel(p.method)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      {showForm && (
        <PaymentForm
          invoices={invoices}
          onClose={() => setShowForm(false)}
          onSave={handleCreatePayment}
        />
      )}
    </div>
  );
}

function PaymentForm({ invoices, onClose, onSave }: {
  invoices: (Invoice & { patient?: Patient })[];
  onClose: () => void;
  onSave: (data: { invoiceId: string; splitMethods: SplitMethod[]; notes: string }) => void;
}) {
  const [invoiceId, setInvoiceId] = useState('');
  const [splitMethods, setSplitMethods] = useState<SplitMethod[]>([{ method: 'cash', amount: 0 }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId);
  const totalAmount = splitMethods.reduce((s, m) => s + m.amount, 0);
  const remaining = selectedInvoice?.remaining_amount ?? 0;
  const overpayment = totalAmount > remaining + 0.01;

  const addSplit = () => setSplitMethods([...splitMethods, { method: 'cash', amount: 0 }]);
  const removeSplit = (idx: number) => setSplitMethods(splitMethods.filter((_, i) => i !== idx));
  const updateSplit = (idx: number, patch: Partial<SplitMethod>) => {
    setSplitMethods(splitMethods.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceId || totalAmount <= 0) return;
    if (overpayment) {
      setError(`Le montant total dépasse le solde restant de ${formatCurrency(remaining)}.`);
      return;
    }
    setError(null);
    onSave({ invoiceId, splitMethods: splitMethods.filter((s) => s.amount > 0), notes });
  };

  return (
    <Modal open onClose={onClose} title="Nouveau paiement" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Facture *</label>
          <select className="input" required value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setError(null); }}>
            <option value="">— Sélectionner une facture impayée —</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} — {fullName(i.patient)} — Reste : {formatCurrency(i.remaining_amount)}
              </option>
            ))}
          </select>
        </div>

        {selectedInvoice && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Total facture</span><span>{formatCurrency(selectedInvoice.total)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Déjà payé</span><span>{formatCurrency(selectedInvoice.paid_amount)}</span></div>
            <div className="flex justify-between font-medium"><span className="text-blue-700">Reste à payer</span><span className="text-blue-700">{formatCurrency(remaining)}</span></div>
          </div>
        )}

        <div>
          <label className="label">Méthodes de paiement</label>
          <div className="space-y-2">
            {splitMethods.map((sm, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <select className="input" value={sm.method} onChange={(e) => updateSplit(idx, { method: e.target.value as SplitMethod['method'] })}>
                    {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="w-40">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    placeholder="Montant"
                    value={sm.amount}
                    onChange={(e) => updateSplit(idx, { amount: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                {splitMethods.length > 1 && (
                  <button type="button" onClick={() => removeSplit(idx)} className="btn-ghost btn-sm text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addSplit} className="btn-secondary btn-sm mt-2">
            <Plus className="w-4 h-4" /> Ajouter une méthode
          </button>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {overpayment && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> Le montant total ({formatCurrency(totalAmount)}) dépasse le solde restant ({formatCurrency(remaining)}).
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <div className="text-sm">
            <span className="text-gray-500">Total à payer : </span>
            <span className="font-bold text-base">{formatCurrency(totalAmount)}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={!invoiceId || totalAmount <= 0 || overpayment} className="btn-primary">Encaisser</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
