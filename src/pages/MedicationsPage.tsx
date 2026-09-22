import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, Edit2, Upload, Download, FileText, FileSpreadsheet,
  Star, Check, X, AlertTriangle, Eye, EyeOff, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatDate } from '@/lib/format';
import { Loading, EmptyState, Modal, PageHeader, Badge, Pagination, ConfirmDialog } from '@/components/ui';
import { parseCSV, parseExcelFile, generateCSV, downloadFile, type ParsedMedicationRow } from '@/lib/csv';
import type { Medication } from '@/types';

const PAGE_SIZE = 20;

export default function MedicationsPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<Medication | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = hasRole('ADMIN');
  const canAddMed = hasRole('ADMIN', 'DOCTOR');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('medications')
      .select('*', { count: 'exact' });

    if (!showInactive) {
      query = query.eq('is_active', true);
    }

    if (search.trim()) {
      const s = search.trim();
      query = query.or(
        `commercial_name.ilike.%${s}%,dci.ilike.%${s}%,active_ingredient.ilike.%${s}%,code.ilike.%${s}%,strength.ilike.%${s}%,manufacturer.ilike.%${s}%`
      );
    }

    query = query
      .order('commercial_name')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error: err } = await query;
    if (err) { console.error(err); setLoading(false); return; }
    setMedications((data as Medication[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page, showInactive]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data: Partial<Medication>) => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const { error: err } = await supabase
          .from('medications')
          .update({
            code: data.code || null,
            commercial_name: data.commercial_name,
            dci: data.dci || null,
            active_ingredient: data.active_ingredient || null,
            strength: data.strength || null,
            pharmaceutical_form: data.pharmaceutical_form || null,
            form: data.pharmaceutical_form || data.form || null,
            manufacturer: data.manufacturer || null,
            laboratory: data.laboratory || null,
            route: data.route || null,
            default_dosage: data.default_dosage || null,
            default_frequency: data.default_frequency || null,
            default_duration: data.default_duration || null,
            instructions: data.instructions || null,
            is_favorite: data.is_favorite ?? false,
          })
          .eq('id', editing.id);
        if (err) throw new Error(err.message);
        await logAudit('medication_update', 'medication', editing.id, data.commercial_name);
      } else {
        const { error: err } = await supabase
          .from('medications')
          .insert({
            code: data.code || null,
            commercial_name: data.commercial_name,
            dci: data.dci || null,
            active_ingredient: data.active_ingredient || null,
            strength: data.strength || null,
            pharmaceutical_form: data.pharmaceutical_form || null,
            form: data.pharmaceutical_form || null,
            manufacturer: data.manufacturer || null,
            laboratory: data.laboratory || null,
            route: data.route || null,
            default_dosage: data.default_dosage || null,
            default_frequency: data.default_frequency || null,
            default_duration: data.default_duration || null,
            instructions: data.instructions || null,
            is_favorite: data.is_favorite ?? false,
            is_active: true,
          });
        if (err) throw new Error(err.message);
        await logAudit('medication_create', 'medication', undefined, data.commercial_name);
      }
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de l\'enregistrement');
    }
    setSaving(false);
  };

  const handleArchive = async (med: Medication) => {
    await supabase.from('medications').update({ is_active: false }).eq('id', med.id);
    await logAudit('medication_archive', 'medication', med.id, med.commercial_name);
    setConfirmArchive(null);
    load();
  };

  const handleRestore = async (med: Medication) => {
    await supabase.from('medications').update({ is_active: true }).eq('id', med.id);
    await logAudit('medication_restore', 'medication', med.id, med.commercial_name);
    load();
  };

  const handleToggleFavorite = async (med: Medication) => {
    await supabase.from('medications').update({ is_favorite: !med.is_favorite }).eq('id', med.id);
    load();
  };

  const handleExportCSV = () => {
    const csv = generateCSV(medications as unknown as Record<string, unknown>[]);
    downloadFile(csv, `medicaments_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportExcel = () => {
    // Export as CSV with .xls extension (Excel-compatible)
    const csv = generateCSV(medications as unknown as Record<string, unknown>[]);
    downloadFile(csv, `medicaments_${new Date().toISOString().split('T')[0]}.xls`, 'application/vnd.ms-excel');
  };

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Médicaments"
        subtitle={`${total} médicament(s) dans la base`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <button onClick={() => setShowImport(true)} className="btn-secondary">
                  <Upload className="w-4 h-4" /> Importer
                </button>
                <button onClick={handleExportCSV} className="btn-secondary">
                  <FileText className="w-4 h-4" /> Export CSV
                </button>
                <button onClick={handleExportExcel} className="btn-secondary">
                  <FileSpreadsheet className="w-4 h-4" /> Export Excel
                </button>
              </>
            )}
            {canAddMed && (
              <button onClick={() => { setEditing(null); setError(null); setShowForm(true); }} className="btn-primary">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="input pl-10"
            placeholder="Rechercher par nom, DCI, principe actif, code..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {canManage && (
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="btn-secondary btn-sm"
            title={showInactive ? 'Masquer inactifs' : 'Afficher inactifs'}
          >
            {showInactive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showInactive ? ' Masquer inactifs' : ' Afficher inactifs'}
          </button>
        )}
      </div>

      {medications.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-12 h-12" />}
          title="Aucun médicament trouvé"
          description="Ajoutez des médicaments manuellement ou importez un fichier CSV/Excel."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Code</th>
                  <th className="table-header text-left px-4 py-3">Nom commercial</th>
                  <th className="table-header text-left px-4 py-3">DCI</th>
                  <th className="table-header text-left px-4 py-3">Dosage</th>
                  <th className="table-header text-left px-4 py-3">Forme</th>
                  <th className="table-header text-left px-4 py-3">Laboratoire</th>
                  <th className="table-header text-center px-4 py-3">Fav</th>
                  <th className="table-header text-center px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {medications.map((m) => (
                  <tr key={m.id} className={`hover:bg-gray-50 ${!m.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{m.code || '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.commercial_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.dci || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.strength || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.pharmaceutical_form || m.form || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.manufacturer || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => canAddMed && handleToggleFavorite(m)}
                        disabled={!canAddMed}
                        className="disabled:cursor-default"
                      >
                        <Star className={`w-4 h-4 ${m.is_favorite ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={m.is_active ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                        {m.is_active ? 'Actif' : 'Inactif'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canAddMed && (
                          <button onClick={() => { setEditing(m); setError(null); setShowForm(true); }} className="btn-ghost btn-sm" title="Modifier">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {canManage && (m.is_active ? (
                          <button onClick={() => setConfirmArchive(m)} className="btn-ghost btn-sm" title="Archiver">
                            <X className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => handleRestore(m)} className="btn-ghost btn-sm" title="Activer">
                            <Check className="w-4 h-4" />
                          </button>
                        ))}
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
        <MedicationForm
          medication={editing}
          error={error}
          saving={saving}
          onClose={() => { setShowForm(false); setEditing(null); setError(null); }}
          onSave={handleSave}
        />
      )}

      {showImport && canManage && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => load()}
        />
      )}

      <ConfirmDialog
        open={!!confirmArchive}
        onClose={() => setConfirmArchive(null)}
        onConfirm={() => confirmArchive && handleArchive(confirmArchive)}
        title="Archiver le médicament"
        message={`Archiver ${confirmArchive?.commercial_name ?? ''} ? Le médicament ne sera plus disponible pour les nouvelles ordonnances mais restera visible dans les anciennes.`}
        confirmLabel="Archiver"
        danger
      />
    </div>
  );
}

function MedicationForm({ medication, error, saving, onClose, onSave }: {
  medication: Medication | null;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: Partial<Medication>) => void;
}) {
  const [form, setForm] = useState<Partial<Medication>>({
    code: medication?.code ?? '',
    commercial_name: medication?.commercial_name ?? '',
    dci: medication?.dci ?? '',
    active_ingredient: medication?.active_ingredient ?? '',
    strength: medication?.strength ?? '',
    pharmaceutical_form: medication?.pharmaceutical_form ?? medication?.form ?? '',
    manufacturer: medication?.manufacturer ?? '',
    laboratory: medication?.laboratory ?? '',
    route: medication?.route ?? '',
    default_dosage: medication?.default_dosage ?? '',
    default_frequency: medication?.default_frequency ?? '',
    default_duration: medication?.default_duration ?? '',
    instructions: medication?.instructions ?? '',
    is_favorite: medication?.is_favorite ?? false,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <Modal open onClose={onClose} title={medication ? 'Modifier le médicament' : 'Nouveau médicament'} size="lg">
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Nom commercial *</label>
            <input className="input" required value={form.commercial_name ?? ''} onChange={(e) => setForm({ ...form, commercial_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">DCI</label>
            <input className="input" value={form.dci ?? ''} onChange={(e) => setForm({ ...form, dci: e.target.value })} />
          </div>
          <div>
            <label className="label">Principe actif</label>
            <input className="input" value={form.active_ingredient ?? ''} onChange={(e) => setForm({ ...form, active_ingredient: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Dosage</label>
            <input className="input" placeholder="500mg, 1g..." value={form.strength ?? ''} onChange={(e) => setForm({ ...form, strength: e.target.value })} />
          </div>
          <div>
            <label className="label">Forme</label>
            <input className="input" placeholder="Comprimé, sirop..." value={form.pharmaceutical_form ?? ''} onChange={(e) => setForm({ ...form, pharmaceutical_form: e.target.value })} />
          </div>
          <div>
            <label className="label">Voie</label>
            <input className="input" placeholder="Orale, IM..." value={form.route ?? ''} onChange={(e) => setForm({ ...form, route: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Laboratoire</label>
            <input className="input" value={form.manufacturer ?? ''} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
          </div>
          <div>
            <label className="label">Fabricant</label>
            <input className="input" value={form.laboratory ?? ''} onChange={(e) => setForm({ ...form, laboratory: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Posologie par défaut</label>
            <input className="input" value={form.default_dosage ?? ''} onChange={(e) => setForm({ ...form, default_dosage: e.target.value })} />
          </div>
          <div>
            <label className="label">Fréquence par défaut</label>
            <input className="input" value={form.default_frequency ?? ''} onChange={(e) => setForm({ ...form, default_frequency: e.target.value })} />
          </div>
          <div>
            <label className="label">Durée par défaut</label>
            <input className="input" value={form.default_duration ?? ''} onChange={(e) => setForm({ ...form, default_duration: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Instructions</label>
          <textarea className="input" rows={2} value={form.instructions ?? ''} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.is_favorite ?? false} onChange={(e) => setForm({ ...form, is_favorite: e.target.checked })} className="w-5 h-5" />
          <span className="text-sm font-medium text-gray-700">Favori (affiché en priorité dans la recherche)</span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ImportPreview {
  rows: ParsedMedicationRow[];
  duplicates: { row: ParsedMedicationRow; existing: Medication }[];
  newRows: ParsedMedicationRow[];
  invalidRows: ParsedMedicationRow[];
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update' | 'create'>('skip');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('Le fichier est trop volumineux (max 5 Mo).');
      return;
    }

    const ext = file.name.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx', 'xls'].includes(ext ?? '')) {
      setError('Format non supporté. Utilisez .csv, .xlsx ou .xls');
      return;
    }

    try {
      let rows: ParsedMedicationRow[];
      if (ext === 'csv') {
        const text = await file.text();
        rows = parseCSV(text);
      } else {
        rows = await parseExcelFile(file);
      }

      if (rows.length === 0) {
        setError('Aucune ligne trouvée dans le fichier.');
        return;
      }

      // Check for duplicates against existing medications
      const allMeds: Medication[] = [];
      let offset = 0;
      while (true) {
        const { data } = await supabase
          .from('medications')
          .select('*')
          .range(offset, offset + 999);
        if (!data || data.length === 0) break;
        allMeds.push(...(data as Medication[]));
        offset += 1000;
      }

      const duplicates: { row: ParsedMedicationRow; existing: Medication }[] = [];
      const newRows: ParsedMedicationRow[] = [];
      const invalidRows: ParsedMedicationRow[] = [];

      for (const row of rows) {
        if (row._errors.length > 0) {
          invalidRows.push(row);
          continue;
        }

        const existing = allMeds.find((m) => {
          if (row.code && m.code && row.code.toLowerCase() === m.code.toLowerCase()) return true;
          if (row.commercial_name && m.commercial_name.toLowerCase() === row.commercial_name.toLowerCase()) {
            if (!row.strength && !m.strength) return true;
            if (row.strength && m.strength && row.strength.toLowerCase() === m.strength.toLowerCase()) return true;
          }
          return false;
        });

        if (existing) {
          duplicates.push({ row, existing });
        } else {
          newRows.push(row);
        }
      }

      setPreview({ rows, duplicates, newRows, invalidRows });
      setStep('preview');
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de la lecture du fichier');
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      // Insert new rows
      for (const row of preview.newRows) {
        const { error: err } = await supabase.from('medications').insert({
          code: row.code || null,
          commercial_name: row.commercial_name || '',
          dci: row.dci || null,
          active_ingredient: row.active_ingredient || null,
          strength: row.strength || null,
          pharmaceutical_form: row.pharmaceutical_form || null,
          form: row.pharmaceutical_form || null,
          manufacturer: row.manufacturer || null,
          laboratory: row.laboratory || null,
          route: row.route || null,
          default_dosage: row.default_dosage || null,
          default_frequency: row.default_frequency || null,
          default_duration: row.default_duration || null,
          instructions: row.instructions || null,
          is_active: true,
        });
        if (err) {
          console.error('Insert error:', err);
        } else {
          created++;
        }
      }

      // Handle duplicates
      for (const dup of preview.duplicates) {
        if (duplicateMode === 'skip') {
          skipped++;
        } else if (duplicateMode === 'update') {
          const { error: err } = await supabase
            .from('medications')
            .update({
              code: dup.row.code || dup.existing.code,
              dci: dup.row.dci || dup.existing.dci,
              active_ingredient: dup.row.active_ingredient || dup.existing.active_ingredient,
              strength: dup.row.strength || dup.existing.strength,
              pharmaceutical_form: dup.row.pharmaceutical_form || dup.existing.pharmaceutical_form,
              form: dup.row.pharmaceutical_form || dup.existing.form,
              manufacturer: dup.row.manufacturer || dup.existing.manufacturer,
              laboratory: dup.row.laboratory || dup.existing.laboratory,
              route: dup.row.route || dup.existing.route,
              default_dosage: dup.row.default_dosage || dup.existing.default_dosage,
              default_frequency: dup.row.default_frequency || dup.existing.default_frequency,
              default_duration: dup.row.default_duration || dup.existing.default_duration,
              instructions: dup.row.instructions || dup.existing.instructions,
            })
            .eq('id', dup.existing.id);
          if (err) {
            console.error('Update error:', err);
          } else {
            updated++;
          }
        } else if (duplicateMode === 'create') {
          const { error: err } = await supabase.from('medications').insert({
            code: dup.row.code ? `${dup.row.code}-2` : null,
            commercial_name: dup.row.commercial_name || '',
            dci: dup.row.dci || null,
            active_ingredient: dup.row.active_ingredient || null,
            strength: dup.row.strength || null,
            pharmaceutical_form: dup.row.pharmaceutical_form || null,
            form: dup.row.pharmaceutical_form || null,
            manufacturer: dup.row.manufacturer || null,
            laboratory: dup.row.laboratory || null,
            route: dup.row.route || null,
            default_dosage: dup.row.default_dosage || null,
            default_frequency: dup.row.default_frequency || null,
            default_duration: dup.row.default_duration || null,
            instructions: dup.row.instructions || null,
            is_active: true,
          });
          if (err) {
            console.error('Create duplicate error:', err);
          } else {
            created++;
          }
        }
      }

      await logAudit('medication_import', 'medication', undefined, `Import: ${created} créés, ${updated} mis à jour, ${skipped} ignorés`);
      setImportResult({ created, updated, skipped });
      setStep('done');
      onImported();
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de l\'import');
    }
    setImporting(false);
  };

  return (
    <Modal open onClose={onClose} title="Importer des médicaments" size="xl">
      {step === 'upload' && (
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
          >
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-600 mb-2">Glissez un fichier ici ou cliquez pour parcourir</p>
            <p className="text-xs text-gray-400 mb-4">Formats acceptés: .csv, .xlsx, .xls (max 5 Mo)</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <button onClick={() => fileRef.current?.click()} className="btn-secondary">
              Parcourir
            </button>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            <p className="font-medium mb-1">Colonnes reconnues:</p>
            <p className="text-xs">Code, Nom commercial, DCI, Principe actif, Dosage, Forme, Laboratoire, Voie, Posologie, Fréquence, Durée, Instructions</p>
            <p className="text-xs mt-1 text-blue-600">Les variantes avec accents et sans accents sont acceptées.</p>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{preview.newRows.length}</p>
              <p className="text-xs text-green-600">Nouveaux</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">{preview.duplicates.length}</p>
              <p className="text-xs text-amber-600">Doublons</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-700">{preview.invalidRows.length}</p>
              <p className="text-xs text-red-600">Invalides</p>
            </div>
          </div>

          {preview.duplicates.length > 0 && (
            <div>
              <label className="label">Gestion des doublons</label>
              <div className="flex gap-2">
                <button onClick={() => setDuplicateMode('skip')} className={`btn-sm ${duplicateMode === 'skip' ? 'btn-primary' : 'btn-secondary'}`}>
                  Ignorer
                </button>
                <button onClick={() => setDuplicateMode('update')} className={`btn-sm ${duplicateMode === 'update' ? 'btn-primary' : 'btn-secondary'}`}>
                  Mettre à jour
                </button>
                <button onClick={() => setDuplicateMode('create')} className={`btn-sm ${duplicateMode === 'create' ? 'btn-primary' : 'btn-secondary'}`}>
                  Créer comme nouveau
                </button>
              </div>
            </div>
          )}

          {preview.newRows.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-2">Nouveaux médicaments ({preview.newRows.length})</h3>
              <div className="max-h-40 overflow-y-auto scrollbar-thin border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Nom</th>
                      <th className="text-left px-2 py-1">DCI</th>
                      <th className="text-left px-2 py-1">Dosage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.newRows.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1">{r.commercial_name}</td>
                        <td className="px-2 py-1">{r.dci || '—'}</td>
                        <td className="px-2 py-1">{r.strength || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.duplicates.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Doublons détectés ({preview.duplicates.length})
              </h3>
              <div className="max-h-32 overflow-y-auto scrollbar-thin border border-amber-200 rounded-lg bg-amber-50">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Nom (fichier)</th>
                      <th className="text-left px-2 py-1">Existant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {preview.duplicates.slice(0, 30).map((d, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1">{d.row.commercial_name}</td>
                        <td className="px-2 py-1 text-gray-500">{d.existing.commercial_name} ({d.existing.strength})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.invalidRows.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-700 mb-2">Lignes invalides ({preview.invalidRows.length})</h3>
              <div className="max-h-24 overflow-y-auto scrollbar-thin border border-red-200 rounded-lg bg-red-50">
                {preview.invalidRows.slice(0, 10).map((r, i) => (
                  <div key={i} className="px-3 py-1 text-xs text-red-700">
                    Ligne {r._rowNumber}: {r._errors.join(', ')}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setStep('upload')} className="btn-secondary">Retour</button>
            <button
              onClick={handleImport}
              disabled={importing || (preview.newRows.length === 0 && preview.duplicates.length === 0)}
              className="btn-primary"
            >
              {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importation...</> : `Importer ${preview.newRows.length + (duplicateMode !== 'skip' ? preview.duplicates.length : 0)} médicament(s)`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && importResult && (
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Import terminé</h3>
          <div className="flex justify-center gap-6 mt-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{importResult.created}</p>
              <p className="text-xs text-gray-500">Créés</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{importResult.updated}</p>
              <p className="text-xs text-gray-500">Mis à jour</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-400">{importResult.skipped}</p>
              <p className="text-xs text-gray-500">Ignorés</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-primary mt-6">Terminé</button>
        </div>
      )}
    </Modal>
  );
}
