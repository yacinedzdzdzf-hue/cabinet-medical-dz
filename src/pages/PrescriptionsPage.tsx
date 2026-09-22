import { useState, useEffect, useCallback } from 'react';
import { Plus, Pill, Search, Printer, Trash2, Copy, Pencil, FileText as FileBlank } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fullName, formatDate, formatDateTime } from '@/lib/format';
import { ConfirmDialog, Loading, EmptyState, PageHeader } from '@/components/ui';
import { PrescriptionEditor } from '@/components/PrescriptionEditor';
import {
  deletePrescription, loadPrescriptionItems, toEditable, type EditableItem,
} from '@/lib/prescriptions';
import type { Patient, Prescription } from '@/types';

type Mode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; prescription: Prescription }
  | { kind: 'view'; prescription: Prescription }
  | { kind: 'duplicate'; prescription: Prescription; items: EditableItem[]; notes: string }
  | { kind: 'blank' };

/**
 * Historique des ordonnances et point d'entrée de l'unique éditeur.
 * Consulter une ordonnance, la modifier, la dupliquer ou l'imprimer passe
 * toujours par le même aperçu A5.
 */
export default function PrescriptionsPage({ params }: { params: URLSearchParams }) {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [fileNumbers, setFileNumbers] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [confirmDelete, setConfirmDelete] = useState<Prescription | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Patient transmis par l'entrée (dossier médical, consultation) via l'adresse
  const [entryPatient, setEntryPatient] = useState<Patient | null>(null);

  const filterPatientId = params.get('patient');
  const filterPrescId = params.get('id');
  const wantsNew = params.get('new') === '1';
  const canEdit = hasRole('ADMIN', 'DOCTOR');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('prescriptions')
      .select('*, patient:patients(*), doctor:profiles(*)')
      .order('created_at', { ascending: false });
    if (filterPatientId) q = q.eq('patient_id', filterPatientId);
    if (search.trim()) q = q.or(`prescription_number.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) {
      console.error('[ORDONNANCES] historique:', error);
      setPrescriptions([]);
      setLoading(false);
      return;
    }

    const rows = (data as Prescription[]) ?? [];
    setPrescriptions(rows);

    // Nombre réel de médicaments par ordonnance + numéros de dossier
    const [itemsRes, filesRes] = await Promise.all([
      supabase.from('prescription_items').select('prescription_id'),
      supabase.from('medical_files').select('patient_id, file_number'),
    ]);
    const counts: Record<string, number> = {};
    for (const row of (itemsRes.data as { prescription_id: string }[]) ?? []) {
      counts[row.prescription_id] = (counts[row.prescription_id] ?? 0) + 1;
    }
    setItemCounts(counts);
    const files: Record<string, string> = {};
    for (const row of (filesRes.data as { patient_id: string; file_number: string }[]) ?? []) {
      files[row.patient_id] = row.file_number;
    }
    setFileNumbers(files);
    setLoading(false);
  }, [filterPatientId, search]);

  useEffect(() => { load(); }, [load]);

  // Patient imposé par l'entrée : on ne le redemande pas au médecin
  useEffect(() => {
    if (!filterPatientId) { setEntryPatient(null); return; }
    let cancelled = false;
    supabase.from('patients').select('*').eq('id', filterPatientId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setEntryPatient((data as Patient) ?? null); });
    return () => { cancelled = true; };
  }, [filterPatientId]);

  // Ouverture directe depuis une autre page (dossier médical, consultation)
  useEffect(() => {
    if (wantsNew) { setMode({ kind: 'new' }); return; }
    if (!filterPrescId || loading) return;
    const found = prescriptions.find((p) => p.id === filterPrescId);
    if (found) setMode({ kind: 'view', prescription: found });
  }, [filterPrescId, wantsNew, prescriptions, loading]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const open = useCallback(async (kind: 'view' | 'edit' | 'duplicate' | 'print', prescription: Prescription) => {
    const items = await loadPrescriptionItems(prescription.id);
    if (kind === 'print') {
      setMode({ kind: 'view', prescription: { ...prescription, items } as Prescription });
      // L'aperçu déclenche l'impression dès qu'il est prêt
      setTimeout(() => window.print(), 400);
      return;
    }
    if (kind === 'duplicate') {
      setMode({
        kind: 'duplicate',
        prescription,
        items: items.map(toEditable),
        notes: prescription.notes ?? '',
      });
      return;
    }
    setMode({ kind: kind === 'edit' ? 'edit' : 'view', prescription });
  }, []);

  const handleDelete = async (prescription: Prescription) => {
    setConfirmDelete(null);
    const message = await deletePrescription(prescription.id);
    if (message) { setNotice(message); return; }
    setNotice(`Ordonnance ${prescription.prescription_number} supprimée.`);
    setMode({ kind: 'list' });
    load();
  };

  const handleSaved = async (prescriptionId: string, number: string) => {
    setNotice(`Ordonnance ${number} enregistrée.`);
    // On recharge l'ordonnance enregistrée pour que l'aperçu et le QR
    // correspondent exactement à ce qui est en base.
    const { data } = await supabase
      .from('prescriptions')
      .select('*, patient:patients(*), doctor:profiles(*)')
      .eq('id', prescriptionId)
      .maybeSingle();
    if (data) setMode({ kind: 'edit', prescription: data as Prescription });
    load();
  };

  if (loading && mode.kind === 'list') return <Loading />;

  if (mode.kind === 'new') {
    const fromList = filterPatientId
      ? prescriptions.find((p) => p.patient_id === filterPatientId)?.patient
      : null;
    const patient = (fromList as Patient | undefined) ?? entryPatient;
    return (
      <div>
        <PageHeader title="Nouvelle ordonnance" subtitle="Aperçu A5 et prescription" />
        <PrescriptionEditor
          patient={patient}
          doctorId={profile?.id ?? null}
          onClose={() => setMode({ kind: 'list' })}
          onSaved={handleSaved}
        />
      </div>
    );
  }

  if (mode.kind === 'blank') {
    return (
      <div>
        <PageHeader title="Ordonnance vierge" subtitle="Document à compléter à la main" />
        <PrescriptionEditor
          readOnly
          doctorId={profile?.id ?? null}
          onClose={() => setMode({ kind: 'list' })}
          onSaved={() => setMode({ kind: 'list' })}
        />
      </div>
    );
  }

  if (mode.kind === 'view') {
    return (
      <div>
        <PageHeader
          title={`Ordonnance ${mode.prescription.prescription_number}`}
          subtitle="Aperçu A5, impression et PDF"
          actions={canEdit ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setMode({ kind: 'edit', prescription: mode.prescription })} className="btn-secondary">
                <Pencil className="w-4 h-4" /> Modifier
              </button>
              <button
                onClick={() => open('duplicate', mode.prescription)}
                className="btn-secondary"
              >
                <Copy className="w-4 h-4" /> Dupliquer
              </button>
            </div>
          ) : undefined}
        />
        <PrescriptionEditor
          readOnly
          prescription={mode.prescription}
          patient={(mode.prescription.patient as Patient) ?? null}
          doctorId={profile?.id ?? null}
          onClose={() => setMode({ kind: 'list' })}
          onSaved={() => setMode({ kind: 'list' })}
        />
      </div>
    );
  }

  if (mode.kind === 'edit') {
    return (
      <div>
        <PageHeader
          title={`Ordonnance ${mode.prescription.prescription_number}`}
          subtitle="Modification de la prescription"
        />
        <PrescriptionEditor
          prescription={mode.prescription}
          patient={(mode.prescription.patient as Patient) ?? null}
          doctorId={profile?.id ?? null}
          onClose={() => setMode({ kind: 'list' })}
          onSaved={handleSaved}
        />
      </div>
    );
  }

  if (mode.kind === 'duplicate') {
    return (
      <div>
        <PageHeader
          title="Nouvelle ordonnance"
          subtitle={`Copie de ${mode.prescription.prescription_number} — à enregistrer`}
        />
        <PrescriptionEditor
          patient={(mode.prescription.patient as Patient) ?? null}
          doctorId={profile?.id ?? null}
          initialItems={mode.items}
          initialNotes={mode.notes}
          onClose={() => setMode({ kind: 'list' })}
          onSaved={handleSaved}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Ordonnances"
        subtitle={`${prescriptions.length} ordonnance(s)`}
        actions={canEdit ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setMode({ kind: 'blank' })} className="btn-secondary">
              <FileBlank className="w-4 h-4" /> Ordonnance vierge
            </button>
            <button onClick={() => setMode({ kind: 'new' })} className="btn-primary">
              <Plus className="w-4 h-4" /> Nouvelle ordonnance
            </button>
          </div>
        ) : undefined}
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input className="input pl-10" placeholder="Rechercher par numéro d'ordonnance…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {prescriptions.length === 0 ? (
        <EmptyState
          icon={<Pill className="w-12 h-12" />}
          title="Aucune ordonnance"
          description={search ? 'Aucun résultat pour cette recherche.' : undefined}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-header text-left px-4 py-3">N°</th>
                <th className="table-header text-left px-4 py-3">Patient</th>
                <th className="table-header text-left px-4 py-3">PAT / DM</th>
                <th className="table-header text-left px-4 py-3">Date</th>
                <th className="table-header text-left px-4 py-3">Dernière modif.</th>
                <th className="table-header text-left px-4 py-3">Médecin</th>
                <th className="table-header text-center px-4 py-3">Médicaments</th>
                <th className="table-header text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {prescriptions.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-blue-600">{p.prescription_number}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.patient_display_name ?? fullName(p.patient)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">
                    {p.patient?.patient_number ?? '—'}
                    {fileNumbers[p.patient_id] ? ` • ${fileNumbers[p.patient_id]}` : ''}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(p.prescription_date ?? p.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.updated_at ? formatDateTime(p.updated_at) : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.doctor?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-center">{itemCounts[p.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => open('view', p)} className="btn-ghost btn-sm" title="Ouvrir l'aperçu A5">Ouvrir</button>
                      {canEdit && (
                        <>
                          <button onClick={() => open('edit', p)} className="btn-ghost btn-sm" title="Modifier">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => open('duplicate', p)} className="btn-ghost btn-sm" title="Dupliquer">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button onClick={() => open('print', p)} className="btn-ghost btn-sm" title="Imprimer / PDF">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (
                        <button onClick={() => setConfirmDelete(p)} className="btn-ghost btn-sm text-red-600" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title="Supprimer l'ordonnance"
        message={confirmDelete ? `Supprimer définitivement l'ordonnance ${confirmDelete.prescription_number} et ses médicaments ?` : ''}
        confirmLabel="Supprimer"
        danger
      />
    </div>
  );
}
