import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, Edit2, Archive, RotateCcw, Eye, Trash2, Calendar,
  SlidersHorizontal, X, Download, ChevronDown, AlertCircle, RefreshCw,
  UserX, User, ArrowUpDown, Clock, History,
} from 'lucide-react';
import { supabase, MEDICAL_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { calculateAge, sexLabel, fullName, formatDate, formatTime } from '@/lib/format';
import { downloadFile } from '@/lib/csv';
import { ConfirmDialog, Modal, Badge, Pagination } from '@/components/ui';
import { PatientForm, type RelatedData } from '@/components/PatientForm';
import { AppointmentModal, NextAppointmentBadge } from '@/components/AppointmentModal';
import type { Patient, MedicalFile, MedicalDocument, AuditLog } from '@/types';

const PAGE_SIZE = 15;
type StatusFilter = 'active' | 'archived' | 'all';
type PeriodFilter = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';
type SortKey =
  | 'archived_desc' | 'archived_asc' | 'name_asc' | 'name_desc'
  | 'number_asc' | 'number_desc' | 'dob_asc' | 'dob_desc';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'archived_desc', label: 'Archivage le plus récent' },
  { key: 'archived_asc', label: 'Archivage le plus ancien' },
  { key: 'name_asc', label: 'Nom A → Z' },
  { key: 'name_desc', label: 'Nom Z → A' },
  { key: 'number_asc', label: 'PAT croissant' },
  { key: 'number_desc', label: 'PAT décroissant' },
  { key: 'dob_asc', label: 'Date de naissance croissante' },
  { key: 'dob_desc', label: 'Date de naissance décroissante' },
];

const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
  { key: 'all', label: 'Toutes les périodes' },
  { key: 'today', label: "Aujourd'hui" },
  { key: 'week', label: 'Cette semaine' },
  { key: 'month', label: 'Ce mois' },
  { key: 'year', label: 'Cette année' },
  { key: 'custom', label: 'Personnalisée' },
];

const LOAD_ERROR = 'Impossible de charger les patients archivés. Vérifiez la connexion et réessayez.';

type FilterOptions = {
  active_count: number;
  archived_count: number;
  total_count: number;
  archive_years: number[];
  birth_years: number[];
};

interface PatientRow { patient: Patient; medical_file_number: string | null; total_count: number }

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bornes locales (jamais UTC) pour une période d'archivage. */
function resolvePeriod(period: PeriodFilter, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (period === 'all') return {};
  if (period === 'today') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString() };
  }
  if (period === 'week') {
    const day = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 0 ? -6 : 1 - day));
    return { from: start.toISOString(), to: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7).toISOString() };
  }
  if (period === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
  }
  if (period === 'year') {
    return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: new Date(now.getFullYear() + 1, 0, 1).toISOString() };
  }
  return {
    from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
    to: to ? new Date(new Date(to + 'T00:00:00').getTime() + 86400000).toISOString() : undefined,
  };
}

export default function PatientsPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { hasRole, profile } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [archiveYear, setArchiveYear] = useState<number | null>(null);
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [sexFilter, setSexFilter] = useState<'M' | 'F' | null>(null);
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] = useState<SortKey>('archived_desc');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [options, setOptions] = useState<FilterOptions | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [editingFile, setEditingFile] = useState<MedicalFile | null>(null);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmArchive, setConfirmArchive] = useState<Patient | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<Patient | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Patient | null>(null);
  const [confirmDelete2, setConfirmDelete2] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [historyPatient, setHistoryPatient] = useState<Patient | null>(null);
  const [historyLogs, setHistoryLogs] = useState<AuditLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [appointmentPatient, setAppointmentPatient] = useState<Patient | null>(null);
  const [appointmentFile, setAppointmentFile] = useState<MedicalFile | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');
  const canDelete = hasRole('ADMIN');
  const isArchivedView = statusFilter === 'archived';
  const periodBounds = resolvePeriod(period, customFrom, customTo);

  // === Recherche + filtres + tri, exécutés côté base ===
  const load = useCallback(async (silent = false) => {
    if (!silent) setState('loading');
    else setRefreshing(true);

    const { data, error: rpcError } = await supabase.rpc('search_patients', {
      p_search: debouncedSearch || null,
      p_status: statusFilter === 'all' ? null : statusFilter,
      p_sex: sexFilter,
      p_archive_year: archiveYear,
      p_birth_year: birthYear,
      p_archived_from: periodBounds.from ?? null,
      p_archived_to: periodBounds.to ?? null,
      p_sort: sort,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    });

    if (rpcError) {
      console.error('[PATIENTS] search error:', rpcError);
      setState('error');
      setRefreshing(false);
      return;
    }

    const list = (data as PatientRow[]) ?? [];
    if (list.length === 0 && page > 1) { setPage(1); setRefreshing(false); return; }
    setRows(list);
    setTotal(list.length > 0 ? Number(list[0].total_count) : 0);
    setState('success');
    setRefreshing(false);
  }, [debouncedSearch, statusFilter, sexFilter, archiveYear, birthYear, periodBounds.from, periodBounds.to, sort, page]);

  const loadOptions = useCallback(async () => {
    const { data, error: optError } = await supabase.rpc('patient_filter_options');
    if (optError) { console.error('[PATIENTS] options error:', optError); return; }
    setOptions(data as FilterOptions);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Realtime — un archivage/restauration depuis un autre poste met la liste à jour
  useEffect(() => {
    const channel = supabase
      .channel('patients_archive_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => {
        load(true); loadOptions();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, loadOptions]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hasActiveFilters = !!(debouncedSearch || archiveYear || birthYear || sexFilter || period !== 'all');

  const resetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setArchiveYear(null);
    setBirthYear(null);
    setSexFilter(null);
    setPeriod('all');
    setCustomFrom('');
    setCustomTo('');
    setSort('archived_desc');
    setPage(1);
  };

  const removeFilter = (kind: 'search' | 'archiveYear' | 'birthYear' | 'sex' | 'period') => {
    if (kind === 'search') { setSearch(''); setDebouncedSearch(''); }
    if (kind === 'archiveYear') setArchiveYear(null);
    if (kind === 'birthYear') setBirthYear(null);
    if (kind === 'sex') setSexFilter(null);
    if (kind === 'period') { setPeriod('all'); setCustomFrom(''); setCustomTo(''); }
    setPage(1);
  };

  // === Export respectant les filtres actifs ===
  const buildExportRows = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('search_patients', {
      p_search: debouncedSearch || null,
      p_status: statusFilter === 'all' ? null : statusFilter,
      p_sex: sexFilter,
      p_archive_year: archiveYear,
      p_birth_year: birthYear,
      p_archived_from: periodBounds.from ?? null,
      p_archived_to: periodBounds.to ?? null,
      p_sort: sort,
      p_limit: 200,
      p_offset: 0,
    });
    if (rpcError) { console.error('[PATIENTS] export error:', rpcError); alert(LOAD_ERROR); return null; }
    const list = (data as PatientRow[]) ?? [];
    const header = ['N° Patient', 'N° Dossier', 'Nom', 'Prénom', 'Sexe', 'Âge', 'Téléphone', 'CIN', 'Wilaya', 'Commune', "Date d'archivage", 'Archivé par', 'Statut'];
    const lines = [header.join(',')];
    for (const r of list) {
      const p = r.patient;
      const values = [
        p.patient_number, r.medical_file_number ?? '', p.last_name, p.first_name,
        sexLabel(p.sex), String(calculateAge(p.date_of_birth)), p.phone ?? '', p.cin ?? '',
        p.wilaya ?? '', p.commune ?? '',
        p.archived_at ? formatDate(p.archived_at) + ' ' + formatTime(p.archived_at) : '',
        p.archived_by_name ?? '', p.status === 'active' ? 'Actif' : 'Archivé',
      ].map((v) => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(values.join(','));
    }
    return { list, content: lines.join('\n') };
  }, [debouncedSearch, statusFilter, sexFilter, archiveYear, birthYear, periodBounds.from, periodBounds.to, sort]);

  const exportRows = async () => {
    const result = await buildExportRows();
    if (!result) return;
    downloadFile(result.content, `patients_${statusFilter}_${toLocalDateStr(new Date())}.csv`, 'text/csv;charset=utf-8');
    await logAudit('patients_export', 'patient', undefined, `${result.list.length} patient(s) exporté(s)`, {
      user: profile?.full_name, role: profile?.role,
      filters: { search: debouncedSearch, statusFilter, archiveYear, birthYear, sexFilter, period, sort },
    }, { id: profile?.id, name: profile?.full_name });
    setExportOpen(false);
  };

  const openHistory = async (p: Patient) => {
    setHistoryPatient(p);
    setHistoryLoading(true);
    const { data, error: histError } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_id', p.id)
      .in('action', ['PATIENT_ARCHIVED', 'PATIENT_RESTORED'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (histError) console.error('[PATIENTS] history error:', histError);
    setHistoryLogs((data as AuditLog[]) ?? []);
    setHistoryLoading(false);
  };

  // === Enregistrement (conservé à l'identique) ===
  const checkDuplicates = async (data: Partial<Patient>, excludeId?: string): Promise<string[]> => {
    const dupes: string[] = [];
    const excludeUuid = excludeId ?? '00000000-0000-0000-0000-000000000000';
    if (data.cin) {
      const { data: found } = await supabase.from('patients').select('id, patient_number, first_name, last_name').eq('cin', data.cin).neq('id', excludeUuid).limit(1);
      if (found && found.length > 0) dupes.push(`CIN: déjà utilisé par ${found[0].patient_number}`);
    }
    if (data.phone) {
      const { data: found } = await supabase.from('patients').select('id, patient_number, first_name, last_name').eq('phone', data.phone).neq('id', excludeUuid).limit(1);
      if (found && found.length > 0) dupes.push(`Téléphone: déjà utilisé par ${found[0].patient_number}`);
    }
    if (data.first_name && data.last_name && data.date_of_birth) {
      const { data: found } = await supabase.from('patients').select('id, patient_number').ilike('first_name', data.first_name).ilike('last_name', data.last_name).eq('date_of_birth', data.date_of_birth).neq('id', excludeUuid).limit(1);
      if (found && found.length > 0) dupes.push(`Nom + date de naissance: déjà enregistré sous ${found[0].patient_number}`);
    }
    return dupes;
  };

  const handleSave = async (formData: Partial<Patient>, medicalFileData: Partial<MedicalFile>, related: RelatedData) => {
    setSaving(true);
    setError(null);
    try {
      const dupes = await checkDuplicates(formData, editing?.id);
      setDuplicates(dupes);
      if (dupes.length > 0 && !editing) { setSaving(false); return; }

      let patientId: string;

      if (editing) {
        const { data: oldData } = await supabase.from('patients').select('*').eq('id', editing.id).maybeSingle();
        const { error: patErr } = await supabase.from('patients').update({ ...formData, updated_at: new Date().toISOString() }).eq('id', editing.id);
        if (patErr) throw patErr;
        patientId = editing.id;
        await logAudit('patient_update', 'patient', patientId, `${formData.first_name} ${formData.last_name}`, { before: oldData, after: formData }, { id: profile?.id, name: profile?.full_name });

        if (editingFile) {
          await supabase.from('medical_files').update({ ...medicalFileData, updated_at: new Date().toISOString() }).eq('id', editingFile.id);
        }
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('generate_patient_number');
        if (numErr) throw numErr;
        const patientNumber = numData as string;

        const { data: newPatient, error: insErr } = await supabase.from('patients').insert({ ...formData, patient_number: patientNumber }).select().single();
        if (insErr) throw insErr;
        patientId = (newPatient as Patient).id;

        const { data: fileNumData, error: fileNumErr } = await supabase.rpc('generate_file_number');
        if (fileNumErr) throw fileNumErr;
        const { data: newFile } = await supabase.from('medical_files').insert({
          file_number: fileNumData as string, patient_id: patientId, ...medicalFileData,
        }).select().single();
        setEditingFile(newFile as MedicalFile | null);

        await logAudit('patient_create', 'patient', patientId, `${formData.first_name} ${formData.last_name}`, { patient_number: patientNumber }, { id: profile?.id, name: profile?.full_name });
      }

      await supabase.from('allergies').delete().eq('patient_id', patientId);
      for (const a of related.allergies) {
        if (!a.name) continue;
        await supabase.from('allergies').insert({
          patient_id: patientId, name: a.name, allergen: a.allergen || null, category: a.category || null,
          reaction: a.reaction || null, severity: SEVERITY_MAP[a.severity] ?? 'unknown', notes: a.notes || null,
        });
      }

      await supabase.from('chronic_conditions').delete().eq('patient_id', patientId);
      for (const disease of related.chronicConditions) {
        await supabase.from('chronic_conditions').insert({ patient_id: patientId, name: disease });
      }
      if (related.chronicOther) {
        await supabase.from('chronic_conditions').insert({ patient_id: patientId, name: related.chronicOther });
      }

      await supabase.from('medical_histories').delete().eq('patient_id', patientId);
      for (const m of related.medicalHistories) {
        if (!m.description) continue;
        await supabase.from('medical_histories').insert({
          patient_id: patientId, description: m.description,
          approximate_date: m.approximate_date || null, notes: m.notes || null,
        });
      }

      await supabase.from('surgical_histories').delete().eq('patient_id', patientId);
      for (const s of related.surgicalHistories) {
        if (!s.intervention) continue;
        await supabase.from('surgical_histories').insert({
          patient_id: patientId, intervention: s.intervention,
          operation_date: s.operation_date || null, establishment: s.establishment || null, notes: s.notes || null,
        });
      }

      await supabase.from('family_histories').delete().eq('patient_id', patientId);
      for (const f of related.familyHistories) {
        if (!f.condition_name) continue;
        await supabase.from('family_histories').insert({ patient_id: patientId, condition_name: f.condition_name, notes: f.notes || null });
      }

      await supabase.from('pregnancies').delete().eq('patient_id', patientId);
      if (formData.sex === 'F') {
        await supabase.from('pregnancies').insert({
          patient_id: patientId, is_pregnant: related.pregnancy.is_pregnant,
          gravidity: related.pregnancy.gravidity, parity: related.pregnancy.parity,
          lmp_date: related.pregnancy.lmp_date || null,
          gestational_age_weeks: related.pregnancy.gestational_age_weeks,
          expected_term_date: related.pregnancy.expected_term_date || null,
          notes: related.pregnancy.notes || null,
        });
      }

      setShowForm(false);
      setEditing(null);
      setEditingFile(null);
      setDuplicates([]);
      load(true); loadOptions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement');
    }
    setSaving(false);
  };

  const handleArchive = async (p: Patient) => {
    const nowIso = new Date().toISOString();
    const { error: err } = await supabase.from('patients').update({
      status: 'archived', archived_at: nowIso, archived_by: profile?.id ?? null,
      archived_by_name: profile?.full_name ?? null, updated_at: nowIso,
    }).eq('id', p.id);
    if (err) { alert(err.message); return; }
    await logAudit('PATIENT_ARCHIVED', 'patient', p.id, `${p.patient_number} — ${fullName(p)}`, {
      user: profile?.full_name, role: profile?.role, patient_id: p.id, pat: p.patient_number,
      patient_name: fullName(p), archived_at: nowIso,
    }, { id: profile?.id, name: profile?.full_name });
    setConfirmArchive(null);
    load(true); loadOptions();
  };

  const handleRestore = async (p: Patient) => {
    const { error: err } = await supabase.from('patients').update({
      status: 'active', archived_at: null, archived_by: null, archived_by_name: null,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (err) { alert(err.message); return; }
    await logAudit('PATIENT_RESTORED', 'patient', p.id, `${p.patient_number} — ${fullName(p)}`, {
      user: profile?.full_name, role: profile?.role, patient_id: p.id, pat: p.patient_number,
      patient_name: fullName(p), restored_from: p.archived_at,
    }, { id: profile?.id, name: profile?.full_name });
    setConfirmRestore(null);
    load(true); loadOptions();
  };

  const handleDelete = async (p: Patient) => {
    setDeleting(true);
    try {
      const { data: docs } = await supabase.from('medical_documents').select('file_path').eq('patient_id', p.id);
      const filePaths = ((docs as MedicalDocument[]) ?? []).map((d) => d.file_path).filter(Boolean);
      if (filePaths.length > 0) await supabase.storage.from(MEDICAL_BUCKET).remove(filePaths);

      await logAudit('PATIENT_DELETED', 'patient', p.id, `${p.patient_number} — ${fullName(p)}`, {
        user: profile?.full_name, role: profile?.role, patient_id: p.id, pat: p.patient_number, patient_name: fullName(p),
      }, { id: profile?.id, name: profile?.full_name });

      const { error: delErr } = await supabase.from('patients').delete().eq('id', p.id);
      if (delErr) throw delErr;

      setConfirmDelete2(null);
      load(true); loadOptions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression');
    }
    setDeleting(false);
  };

  const openEditForm = async (p: Patient) => {
    setEditing(p);
    setDuplicates([]);
    setError(null);
    const { data: mf } = await supabase.from('medical_files').select('*').eq('patient_id', p.id).maybeSingle();
    setEditingFile(mf as MedicalFile | null);
    setShowForm(true);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const headerCount = options
    ? statusFilter === 'active' ? options.active_count : statusFilter === 'archived' ? options.archived_count : options.total_count
    : 0;

  return (
    <div>
      {/* === EN-TÊTE === */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {isArchivedView ? 'Patients archivés' : 'Patients'}
            {refreshing && <RefreshCw className="w-4 h-4 text-gray-300 animate-spin" />}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isArchivedView ? 'Historique des patients archivés et recherche avancée' : 'Gestion des patients du cabinet'}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge className="bg-gray-100 text-gray-700 border-gray-200">
              {state === 'loading' ? 'Chargement…' : `${headerCount} ${headerCount <= 1 ? 'patient' : 'patients'} ${statusFilter === 'active' ? 'actif(s)' : statusFilter === 'archived' ? 'archivé(s)' : 'au total'}`}
            </Badge>
            {(options?.archive_years.length ?? 0) > 0 && (
              <span className="text-xs text-gray-400">{options?.archive_years.length} année(s) d'archivage disponibles</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={exportRef}>
            <button onClick={() => setExportOpen(!exportOpen)} className="btn-secondary">
              <Download className="w-4 h-4" /> Exporter <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50 animate-slide-up">
                <button onClick={exportRows} className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Exporter en CSV
                </button>
              </div>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() => { setEditing(null); setEditingFile(null); setDuplicates([]); setError(null); setShowForm(true); }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" /> Nouveau patient
            </button>
          )}
        </div>
      </div>

      {/* === NAVIGATION === */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['active', 'archived', 'all'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setStatusFilter(f); setPage(1); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusFilter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'active' ? 'Actifs' : f === 'archived' ? 'Archivés' : 'Tous'}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un patient : nom, prénom, PAT, DM, CIN, téléphone, email, wilaya, commune..."
            className="input pl-10 pr-9"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`btn-secondary ${showAdvanced || hasActiveFilters ? 'border-blue-300 text-blue-700' : ''}`}
        >
          <SlidersHorizontal className="w-4 h-4" /> Filtres avancés
          {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
        </button>
      </div>

      {/* === FILTRES AVANCÉS === */}
      {showAdvanced && (
        <div className="card p-4 mb-4 animate-slide-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="label">Année d'archivage</label>
              <select className="input" value={archiveYear ?? ''} onChange={(e) => { setArchiveYear(e.target.value ? Number(e.target.value) : null); setPage(1); }}>
                <option value="">Toutes les années</option>
                {(options?.archive_years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Année de naissance</label>
              <select className="input" value={birthYear ?? ''} onChange={(e) => { setBirthYear(e.target.value ? Number(e.target.value) : null); setPage(1); }}>
                <option value="">Toutes</option>
                {(options?.birth_years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Sexe</label>
              <select className="input" value={sexFilter ?? ''} onChange={(e) => { const v = e.target.value; setSexFilter(v === 'M' || v === 'F' ? v : null); setPage(1); }}>
                <option value="">Tous</option>
                <option value="M">Homme</option>
                <option value="F">Femme</option>
              </select>
            </div>
            <div>
              <label className="label">Trier par</label>
              <select className="input" value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }}>
                {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Statut (page)</label>
              <select className="input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}>
                <option value="active">Actif</option>
                <option value="archived">Archivé</option>
                <option value="all">Tous</option>
              </select>
            </div>
            <div>
              <label className="label">Date d'archivage</label>
              <select className="input" value={period} onChange={(e) => { setPeriod(e.target.value as PeriodFilter); setPage(1); }}>
                {PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            {period === 'custom' && (
              <>
                <div>
                  <label className="label">Du</label>
                  <input type="date" className="input" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }} />
                </div>
                <div>
                  <label className="label">Au</label>
                  <input type="date" className="input" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); }} />
                </div>
              </>
            )}
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5" /> Les filtres se combinent entre eux.
            </p>
            <button onClick={resetFilters} className="btn-secondary btn-sm">
              <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser les filtres
            </button>
          </div>
        </div>
      )}

      {/* === BADGES DE FILTRES ACTIFS === */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Filtres actifs :</span>
          {debouncedSearch && (
            <FilterChip label={`Recherche : ${debouncedSearch}`} onRemove={() => removeFilter('search')} />
          )}
          {archiveYear && <FilterChip label={`Année archivage : ${archiveYear}`} onRemove={() => removeFilter('archiveYear')} />}
          {birthYear && <FilterChip label={`Année naissance : ${birthYear}`} onRemove={() => removeFilter('birthYear')} />}
          {sexFilter && <FilterChip label={`Sexe : ${sexFilter === 'M' ? 'Homme' : 'Femme'}`} onRemove={() => removeFilter('sex')} />}
          {period !== 'all' && (
            <FilterChip
              label={`Période : ${PERIOD_OPTIONS.find((p) => p.key === period)?.label}${period === 'custom' && (customFrom || customTo) ? ` (${customFrom || '…'} → ${customTo || '…'})` : ''}`}
              onRemove={() => removeFilter('period')}
            />
          )}
          <button onClick={resetFilters} className="text-xs text-blue-600 hover:underline ml-1">Réinitialiser les filtres</button>
        </div>
      )}

      {/* === RÉSULTATS === */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600">
          {state === 'loading' ? 'Chargement…' : `${total} résultat(s)`}
          {state === 'success' && hasActiveFilters && ' sur l\'ensemble des patients'}
        </p>
        {state === 'success' && (
          <p className="text-xs text-gray-400">Tri : {SORT_OPTIONS.find((o) => o.key === sort)?.label}</p>
        )}
      </div>

      {/* === CONTENU === */}
      {state === 'error' ? (
        <div className="card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm font-medium text-red-700">{LOAD_ERROR}</p>
          <button onClick={() => load()} className="btn-secondary btn-sm mt-3">
            <RefreshCw className="w-4 h-4" /> Réessayer
          </button>
        </div>
      ) : state === 'loading' ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['N° Patient', 'Patient', 'Sexe', 'Âge', 'Téléphone', "Date d'archivage", 'Archivé par', 'Statut', 'Actions'].map((h) => (
                  <th key={h} className={`table-header px-4 py-3 ${h === 'Actions' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-4"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-32 bg-gray-100 rounded" />
                        <div className="h-2.5 w-24 bg-gray-100 rounded" />
                      </div>
                    </div>
                  </td>
                  {Array.from({ length: 7 }, (_, k) => (
                    <td key={k} className="px-4 py-4"><div className="h-3 w-16 bg-gray-100 rounded" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
            <Search className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-gray-900 font-semibold">Aucun patient trouvé</h3>
          <p className="text-gray-500 text-sm mt-1 max-w-sm">
            {hasActiveFilters
              ? 'Aucun patient ne correspond aux critères sélectionnés.'
              : statusFilter === 'archived'
                ? 'Aucun patient n\'a été archivé pour le moment.'
                : 'Commencez par enregistrer un nouveau patient.'}
          </p>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="btn-secondary btn-sm mt-4">
              <RotateCcw className="w-4 h-4" /> Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">N° Patient</th>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-left px-4 py-3">Sexe</th>
                  <th className="table-header text-left px-4 py-3">Âge</th>
                  <th className="table-header text-left px-4 py-3">Téléphone</th>
                  <th className="table-header text-left px-4 py-3">
                    {isArchivedView ? "Date d'archivage" : 'Prochain RDV'}
                  </th>
                  <th className="table-header text-left px-4 py-3">Archivé par</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ patient: p, medical_file_number }) => {
                  const initials = `${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase();
                  const avatarClass = p.sex === 'M' ? 'bg-blue-600' : p.sex === 'F' ? 'bg-pink-600' : 'bg-gray-500';
                  return (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-gray-600">{p.patient_number}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => onNavigate(`/medical-files?patient=${p.id}`)} className="flex items-center gap-3 text-left group">
                          <div className={`w-10 h-10 rounded-xl ${avatarClass} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
                            {initials || <User className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate">{fullName(p)}</p>
                            <p className="text-xs text-gray-500 font-mono truncate">
                              {p.patient_number}
                              {medical_file_number ? ` • ${medical_file_number}` : ''}
                            </p>
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {p.sex ? (
                          <Badge className={p.sex === 'M' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-pink-50 text-pink-700 border-pink-200'}>
                            {sexLabel(p.sex)}
                          </Badge>
                        ) : <span className="text-sm text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{calculateAge(p.date_of_birth)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{p.phone || '—'}</td>
                      <td className="px-4 py-3">
                        {isArchivedView ? (
                          p.archived_at ? (
                            <div>
                              <p className="text-sm text-gray-800">{formatDate(p.archived_at)}</p>
                              <p className="text-xs text-gray-400">{formatTime(p.archived_at)}</p>
                            </div>
                          ) : <span className="text-sm text-gray-400">—</span>
                        ) : (
                          <NextAppointmentBadge key={refreshKey} patientId={p.id} onNavigate={onNavigate} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.archived_by_name ? (
                          <span className="text-sm text-gray-600">{p.archived_by_name}</span>
                        ) : <span className="text-sm text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Badge className={p.status === 'active' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                            {p.status === 'active' ? 'Actif' : 'Archivé'}
                          </Badge>
                          <button onClick={() => openHistory(p)} className="text-gray-400 hover:text-blue-600" title="Historique des archivages">
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => onNavigate(`/medical-files?patient=${p.id}`)} className="btn-ghost btn-sm" title="Ouvrir le dossier médical">
                            <Eye className="w-4 h-4" /> Dossier
                          </button>
                          {canEdit && (
                            <>
                              <button onClick={() => openEditForm(p)} className="btn-ghost btn-sm" title="Modifier">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {p.status === 'active' ? (
                                <button
                                  onClick={async () => {
                                    setAppointmentPatient(p);
                                    const { data: mf } = await supabase.from('medical_files').select('*').eq('patient_id', p.id).maybeSingle();
                                    setAppointmentFile(mf as MedicalFile | null);
                                  }}
                                  className="btn-ghost btn-sm text-blue-600 hover:text-blue-700"
                                  title="Prendre rendez-vous"
                                >
                                  <Calendar className="w-4 h-4" />
                                </button>
                              ) : null}
                              {p.status === 'active' ? (
                                <button onClick={() => setConfirmArchive(p)} className="btn-ghost btn-sm" title="Archiver">
                                  <Archive className="w-4 h-4" />
                                </button>
                              ) : (
                                <button onClick={() => setConfirmRestore(p)} className="btn-sm text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5" title="Restaurer le patient">
                                  <RotateCcw className="w-3.5 h-3.5" /> Restaurer
                                </button>
                              )}
                              {canDelete && (
                                <button onClick={() => setConfirmDelete(p)} className="btn-ghost btn-sm text-red-600 hover:text-red-700" title="Supprimer définitivement">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      {/* === FORMULAIRE === */}
      {showForm && (
        <PatientForm
          patient={editing}
          medicalFile={editingFile}
          duplicates={duplicates}
          error={error}
          saving={saving}
          onClose={() => { setShowForm(false); setEditing(null); setEditingFile(null); setDuplicates([]); setError(null); }}
          onSave={handleSave}
        />
      )}

      {appointmentPatient && (
        <AppointmentModal
          patient={appointmentPatient}
          medicalFile={appointmentFile}
          onClose={() => { setAppointmentPatient(null); setAppointmentFile(null); }}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* === HISTORIQUE DES ARCHIVAGES === */}
      <Modal open={!!historyPatient} onClose={() => setHistoryPatient(null)} title={`Historique — ${historyPatient ? fullName(historyPatient) : ''}`}>
        {historyLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        ) : historyLogs.length === 0 ? (
          <div className="text-center py-8">
            <UserX className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Aucun archivage enregistré pour ce patient.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-3.5 top-0 bottom-0 w-0.5 bg-gray-100" />
            <div className="space-y-4">
              {historyLogs.map((log) => (
                <div key={log.id} className="flex gap-3 items-start relative">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 border-2 border-white ${
                    log.action === 'PATIENT_ARCHIVED' ? 'bg-gray-200' : 'bg-green-100'
                  }`}>
                    {log.action === 'PATIENT_ARCHIVED'
                      ? <Archive className="w-3.5 h-3.5 text-gray-600" />
                      : <RotateCcw className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {log.action === 'PATIENT_ARCHIVED' ? 'Patient archivé' : 'Patient restauré'}
                    </p>
                    <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3 h-3" /> {formatDate(log.created_at)} {formatTime(log.created_at)}
                      {log.user_name && <span className="text-gray-400">— {log.user_name}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* === CONFIRMATIONS === */}
      <ConfirmDialog
        open={!!confirmArchive}
        onClose={() => setConfirmArchive(null)}
        onConfirm={() => confirmArchive && handleArchive(confirmArchive)}
        title="Archiver le patient"
        message={`Voulez-vous vraiment archiver ${confirmArchive ? fullName(confirmArchive) : ''} ? Le patient ne sera plus visible dans les listes actives. Aucune donnée ne sera supprimée.`}
        confirmLabel="Archiver"
      />

      <ConfirmDialog
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => confirmRestore && handleRestore(confirmRestore)}
        title="Restaurer le patient"
        message={`Voulez-vous restaurer ce patient et le remettre dans la liste des patients actifs ? Aucun historique ne sera supprimé.`}
        confirmLabel="Restaurer"
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { setConfirmDelete2(confirmDelete); setConfirmDelete(null); }}
        title="Suppression définitive"
        message="Attention : la suppression définitive du patient supprimera définitivement ses données et les informations associées. Cette action est irréversible."
        confirmLabel="Continuer"
        danger
      />

      <ConfirmDialog
        open={!!confirmDelete2}
        onClose={() => setConfirmDelete2(null)}
        onConfirm={() => confirmDelete2 && handleDelete(confirmDelete2)}
        title="Confirmer la suppression définitive"
        message={`Êtes-vous absolument sûr de vouloir supprimer définitivement ${confirmDelete2 ? fullName(confirmDelete2) + ' (' + confirmDelete2.patient_number + ')' : ''} ? Toutes les consultations, ordonnances, documents, factures et historique seront définitivement supprimés. Cette action est IRRÉVERSIBLE.`}
        confirmLabel={deleting ? 'Suppression...' : 'Supprimer définitivement'}
        danger
      />
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
      {label}
      <button onClick={onRemove} className="text-blue-400 hover:text-blue-700" aria-label={`Retirer le filtre ${label}`}>
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

const SEVERITY_MAP: Record<string, string> = { 'Légère': 'mild', 'Modérée': 'moderate', 'Sévère': 'severe', 'Inconnue': 'unknown' };
