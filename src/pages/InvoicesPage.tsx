import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Eye, Ban, Receipt, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatCurrency, formatDate, fullName } from '@/lib/format';
import { INVOICE_STATUS } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader, Badge, Pagination, ConfirmDialog } from '@/components/ui';
import type { Invoice, InvoiceItem, Patient, Service } from '@/types';

const PAGE_SIZE = 15;

function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS.find((s) => s.value === status)?.label ?? status;
}
function invoiceStatusColor(status: string): string {
  return INVOICE_STATUS.find((s) => s.value === status)?.color ?? 'bg-gray-100 text-gray-600 border-gray-200';
}

interface InvoiceDetail extends Invoice {
  invoice_items: (InvoiceItem & { service?: Service })[];
}

export default function InvoicesPage() {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<InvoiceDetail | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Invoice | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('invoices')
      .select('*, patient:patients(*)', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`invoice_number.ilike.%${search}%,patient.first_name.ilike.%${search}%,patient.last_name.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    setInvoices((data as Invoice[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const loadOptions = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from('patients').select('*').eq('status', 'active').order('last_name'),
      supabase.from('services').select('*').eq('active', true).order('name'),
    ]);
    setPatients((p.data as Patient[]) ?? []);
    setServices((s.data as Service[]) ?? []);
  }, []);

  useEffect(() => { if (canEdit) loadOptions(); }, [canEdit, loadOptions]);

  const handleView = async (inv: Invoice) => {
    setLoadingDetail(true);
    const { data } = await supabase
      .from('invoice_items')
      .select('*, service:services(*)')
      .eq('invoice_id', inv.id)
      .order('created_at');
    setViewing({ ...inv, invoice_items: (data as (InvoiceItem & { service?: Service })[]) ?? [] });
    setLoadingDetail(false);
  };

  const handleCancel = async (inv: Invoice, reason: string) => {
    await supabase.from('invoices').update({
      status: 'cancelled',
      cancellation_reason: reason,
      cancelled_by: profile?.id ?? null,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', inv.id);
    await logAudit('invoice_cancel', 'invoice', inv.id, inv.invoice_number, { reason });
    setConfirmCancel(null);
    load();
  };

  const handleCreate = async (data: {
    patientId: string;
    items: { service_id: string | null; description: string; quantity: number; unit_price: number; discount: number; tva_rate: number }[];
    discount: number;
  }) => {
    const subtotal = data.items.reduce((sum, it) => sum + it.unit_price * it.quantity - it.discount, 0);
    const tvaAmount = data.items.reduce((sum, it) => {
      const lineTotal = it.unit_price * it.quantity - it.discount;
      return sum + lineTotal * (it.tva_rate / 100);
    }, 0);
    const total = subtotal + tvaAmount - data.discount;

    const { data: seqData } = await supabase.rpc('generate_invoice_number');
    const invoiceNumber = seqData as string;

    const { data: newInvoice, error } = await supabase.from('invoices').insert({
      invoice_number: invoiceNumber,
      patient_id: data.patientId,
      created_by: profile?.id ?? null,
      subtotal,
      discount: data.discount,
      tva_amount: tvaAmount,
      total,
      paid_amount: 0,
      remaining_amount: total,
      status: 'unpaid',
    }).select().single();

    if (error) { console.error(error); return; }

    const inv = newInvoice as Invoice;
    const itemsToInsert = data.items.map((it) => {
      const lineTotal = it.unit_price * it.quantity - it.discount;
      return {
        invoice_id: inv.id,
        service_id: it.service_id,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        discount: it.discount,
        tva_rate: it.tva_rate,
        total: lineTotal,
      };
    });
    await supabase.from('invoice_items').insert(itemsToInsert);
    await logAudit('invoice_create', 'invoice', inv.id, invoiceNumber, { total });
    setShowForm(false);
    load();
  };

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Facturation"
        subtitle={`${total} facture(s)`}
        actions={canEdit && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouvelle facture
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

      {invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-12 h-12" />}
          title="Aucune facture trouvée"
          description="Créez votre première facture ou modifiez votre recherche."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">N° Facture</th>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-right px-4 py-3">Total</th>
                  <th className="table-header text-right px-4 py-3">Payé</th>
                  <th className="table-header text-right px-4 py-3">Reste</th>
                  <th className="table-header text-left px-4 py-3">Date</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(inv.patient)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(inv.total)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatCurrency(inv.paid_amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatCurrency(inv.remaining_amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(inv.created_at)}</td>
                    <td className="px-4 py-3">
                      <Badge className={invoiceStatusColor(inv.status)}>{invoiceStatusLabel(inv.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleView(inv)} className="btn-ghost btn-sm" title="Voir">
                          <Eye className="w-4 h-4" />
                        </button>
                        {canEdit && inv.status !== 'cancelled' && inv.status !== 'paid' && (
                          <button onClick={() => setConfirmCancel(inv)} className="btn-ghost btn-sm" title="Annuler">
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
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

      {showForm && (
        <InvoiceForm
          patients={patients}
          services={services}
          onClose={() => setShowForm(false)}
          onSave={handleCreate}
        />
      )}

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`Facture ${viewing.invoice_number}`} size="lg">
          {loadingDetail ? (
            <Loading />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">Patient :</span> <span className="font-medium">{fullName(viewing.patient)}</span></div>
                <div><span className="text-gray-500">Date :</span> {formatDate(viewing.created_at)}</div>
                <div><span className="text-gray-500">Statut :</span> <Badge className={invoiceStatusColor(viewing.status)}>{invoiceStatusLabel(viewing.status)}</Badge></div>
                {viewing.cancellation_reason && (
                  <div className="col-span-2 text-red-600"><span className="text-red-400">Motif d’annulation :</span> {viewing.cancellation_reason}</div>
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="table-header text-left px-3 py-2">Description</th>
                    <th className="table-header text-right px-3 py-2">Qté</th>
                    <th className="table-header text-right px-3 py-2">P.U.</th>
                    <th className="table-header text-right px-3 py-2">Remise</th>
                    <th className="table-header text-right px-3 py-2">TVA</th>
                    <th className="table-header text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {viewing.invoice_items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(it.discount)}</td>
                      <td className="px-3 py-2 text-right">{it.tva_rate}%</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Sous-total</span><span>{formatCurrency(viewing.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Remise</span><span>{formatCurrency(viewing.discount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">TVA</span><span>{formatCurrency(viewing.tva_amount)}</span></div>
                <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>{formatCurrency(viewing.total)}</span></div>
                <div className="flex justify-between text-green-600"><span>Payé</span><span>{formatCurrency(viewing.paid_amount)}</span></div>
                <div className="flex justify-between text-red-600"><span>Reste</span><span>{formatCurrency(viewing.remaining_amount)}</span></div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {confirmCancel && (
        <CancelInvoiceDialog
          invoice={confirmCancel}
          onClose={() => setConfirmCancel(null)}
          onConfirm={(reason) => handleCancel(confirmCancel, reason)}
        />
      )}
    </div>
  );
}

function CancelInvoiceDialog({ invoice, onClose, onConfirm }: {
  invoice: Invoice;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={`Annuler la facture ${invoice.invoice_number}`} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Veuillez indiquer le motif d’annulation de cette facture. Cette action est irréversible.</p>
        <textarea
          className="input"
          rows={3}
          placeholder="Motif d’annulation..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary btn-sm">Fermer</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
            className="btn-danger btn-sm"
          >
            Confirmer l’annulation
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface FormLine {
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tva_rate: number;
}

function InvoiceForm({ patients, services, onClose, onSave }: {
  patients: Patient[];
  services: Service[];
  onClose: () => void;
  onSave: (data: { patientId: string; items: FormLine[]; discount: number }) => void;
}) {
  const [patientId, setPatientId] = useState('');
  const [discount, setDiscount] = useState(0);
  const [lines, setLines] = useState<FormLine[]>([
    { service_id: null, description: '', quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 },
  ]);

  const addLine = () => setLines([...lines, { service_id: null, description: '', quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const updateLine = (idx: number, patch: Partial<FormLine>) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSelectService = (idx: number, serviceId: string) => {
    const svc = services.find((s) => s.id === serviceId);
    if (svc) {
      updateLine(idx, {
        service_id: serviceId,
        description: svc.name,
        unit_price: svc.unit_price,
        tva_rate: svc.tva_rate,
      });
    } else {
      updateLine(idx, { service_id: null });
    }
  };

  const subtotal = lines.reduce((sum, l) => sum + l.unit_price * l.quantity - l.discount, 0);
  const tvaAmount = lines.reduce((sum, l) => {
    const lineTotal = l.unit_price * l.quantity - l.discount;
    return sum + lineTotal * (l.tva_rate / 100);
  }, 0);
  const total = subtotal + tvaAmount - discount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId || lines.length === 0) return;
    onSave({ patientId, items: lines, discount });
  };

  return (
    <Modal open onClose={onClose} title="Nouvelle facture" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Patient *</label>
          <select className="input" required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{fullName(p)} — {p.patient_number}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Prestations</label>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <select
                    className="input"
                    value={line.service_id ?? ''}
                    onChange={(e) => handleSelectService(idx, e.target.value)}
                  >
                    <option value="">Prestation personnalisée</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <input className="input" placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, { description: e.target.value })} />
                </div>
                <div className="col-span-1">
                  <input type="number" min={1} className="input" placeholder="Qté" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="col-span-2">
                  <input type="number" min={0} step="0.01" className="input" placeholder="P.U." value={line.unit_price} onChange={(e) => updateLine(idx, { unit_price: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="col-span-1">
                  <input type="number" min={0} step="0.01" className="input" placeholder="Remise" value={line.discount} onChange={(e) => updateLine(idx, { discount: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="col-span-1 flex gap-1">
                  <span className="text-xs text-gray-400 py-2">{line.tva_rate}%</span>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(idx)} className="btn-ghost btn-sm text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addLine} className="btn-secondary btn-sm mt-2">
            <Plus className="w-4 h-4" /> Ajouter une ligne
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Remise globale (DA)</label>
            <input type="number" min={0} step="0.01" className="input" value={discount} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="ml-auto max-w-xs space-y-1 text-sm bg-gray-50 rounded-lg p-3">
          <div className="flex justify-between"><span className="text-gray-500">Sous-total</span><span>{formatCurrency(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Remise</span><span>{formatCurrency(discount)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">TVA</span><span>{formatCurrency(tvaAmount)}</span></div>
          <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>{formatCurrency(total)}</span></div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={!patientId} className="btn-primary">Créer la facture</button>
        </div>
      </form>
    </Modal>
  );
}
