import { useState, useEffect, useCallback } from 'react';
import { Search, ScrollText, Printer, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, fullName } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader, Badge, Pagination } from '@/components/ui';
import type { Receipt, Patient, Invoice } from '@/types';

const PAGE_SIZE = 15;

type PrintSize = 'A4' | 'A5' | '58mm' | '80mm';

const PRINT_SIZES: { value: PrintSize; label: string; width: string }[] = [
  { value: 'A4', label: 'A4', width: '210mm' },
  { value: 'A5', label: 'A5', width: '148mm' },
  { value: '58mm', label: '58mm', width: '58mm' },
  { value: '80mm', label: '80mm', width: '80mm' },
];

function methodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

interface ReceiptDetail extends Receipt {
  patient?: Patient;
  invoice?: Invoice;
}

export default function ReceiptsPage() {
  const [loading, setLoading] = useState(true);
  const [receipts, setReceipts] = useState<(Receipt & { patient?: Patient; invoice?: Invoice })[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [viewing, setViewing] = useState<ReceiptDetail | null>(null);
  const [printSize, setPrintSize] = useState<PrintSize>('A5');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('receipts')
      .select('*, patient:patients(*), invoice:invoices(*)', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`receipt_number.ilike.%${search}%,patient.first_name.ilike.%${search}%,patient.last_name.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    setReceipts((data as (Receipt & { patient?: Patient; invoice?: Invoice })[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const handleView = async (r: Receipt) => {
    const { data } = await supabase
      .from('receipts')
      .select('*, patient:patients(*), invoice:invoices(*)')
      .eq('id', r.id)
      .maybeSingle();
    setViewing(data as ReceiptDetail);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Reçus"
        subtitle={`${total} reçu(s)`}
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

      {receipts.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="w-12 h-12" />}
          title="Aucun reçu trouvé"
          description="Les reçus sont générés automatiquement lors des paiements."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">N° Reçu</th>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-left px-4 py-3">Facture</th>
                  <th className="table-header text-right px-4 py-3">Montant</th>
                  <th className="table-header text-left px-4 py-3">Méthode</th>
                  <th className="table-header text-left px-4 py-3">Date</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{r.receipt_number}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(r.patient)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{r.invoice?.invoice_number ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200">{methodLabel(r.method)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleView(r)} className="btn-ghost btn-sm" title="Voir">
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`Reçu ${viewing.receipt_number}`} size="lg">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Format d’impression :</label>
              <select className="input max-w-32" value={printSize} onChange={(e) => setPrintSize(e.target.value as PrintSize)}>
                {PRINT_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button onClick={handlePrint} className="btn-primary btn-sm">
                <Printer className="w-4 h-4" /> Imprimer
              </button>
            </div>

            <div
              className="receipt-print-area bg-white border border-gray-200 rounded-lg p-6 mx-auto"
              style={{ maxWidth: PRINT_SIZES.find((s) => s.value === printSize)?.width }}
            >
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold text-gray-900">Reçu de paiement</h2>
                <p className="text-sm text-gray-500 font-mono">{viewing.receipt_number}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Patient :</span>
                  <span className="font-medium">{fullName(viewing.patient)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Facture :</span>
                  <span className="font-mono">{viewing.invoice?.invoice_number ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date :</span>
                  <span>{formatDate(viewing.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Méthode :</span>
                  <span>{methodLabel(viewing.method)}</span>
                </div>
                <div className="border-t border-gray-200 my-2" />
                <div className="flex justify-between text-base font-bold">
                  <span>Montant payé :</span>
                  <span>{formatCurrency(viewing.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Solde restant :</span>
                  <span className={viewing.remaining_balance > 0 ? 'text-red-600' : 'text-green-600'}>
                    {formatCurrency(viewing.remaining_balance)}
                  </span>
                </div>
              </div>
              <div className="text-center text-xs text-gray-400 mt-6">
                Merci de votre confiance — CMDZ
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
