import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Stethoscope, Save, FileClock, History, AlertCircle, X,
  FolderHeart, ArrowRight, User, Clock3, CheckCircle2, XCircle, Clock, Pill,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName, formatDate, formatTime, formatDateTime, calculateAge, sexLabel } from '@/lib/format';
import { loadPatientContext, type PatientContext } from '@/lib/patientContext';
import { Modal, PageHeader } from '@/components/ui';
import { ConsultationAcceptancePanel } from '@/components/ConsultationAcceptancePanel';
import { ConsultationsList, type ConsultationsFilters } from '@/components/ConsultationsList';
import { PrescriptionEditor } from '@/components/PrescriptionEditor';
import {
  resolveDateRange, matchesDateRange, matchesPatientSearch, consultationEffectiveDate,
  type WorkflowState, type PendingItem,
} from '@/lib/consultations';
import type { Patient, Consultation, RecordVersion, MedicalFile, Profile, Appointment } from '@/types';

type ReturnableItem = {
  queue_id: string;
  queue_number: string;
  patient: Patient | null;
  appointment: Appointment | null;
};

export default function ConsultationsPage({ params, onNavigate }: { params: URLSearchParams; onNavigate?: (path: string) => void }) {
  const { hasRole, profile } = useAuth();
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState(false);

  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [medicalFileNumbers, setMedicalFileNumbers] = useState<Record<string, string>>({});
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [filters, setFilters] = useState<ConsultationsFilters>({
    search: '', date: 'all', from: '', to: '', status: 'all', doctor: '', page: 1,
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Consultation | null>(null);
  const [viewing, setViewing] = useState<Consultation | null>(null);
  const [versions, setVersions] = useState<RecordVersion[]>([]);
  const [patientContext, setPatientContext] = useState<PatientContext | null>(null);
  const [pendingAppointmentId, setPendingAppointmentId] = useState<string | null>(null);
  const [writePrescription, setWritePrescription] = useState(false);
  const [actionError, setActionError] = useState<string | null>(() => sessionStorage.getItem('cmdz-transfer-error'));
  const [accepting, setAccepting] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const acceptLockRef = useRef(false);

  const filterPatientId = params.get('patient');
  const filterConsultationId = params.get('id');
  const canEdit = hasRole('ADMIN', 'DOCTOR');
  const autoOpenedRef = useRef<string | null>(null);

  const updateFilters = (patch: Partial<ConsultationsFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // === Flux d'acceptation (patients envoyés depuis la salle d'attente) ===
  const loadWorkflow = useCallback(async () => {
    const { data, error } = await supabase.rpc('consultation_workflow');
    if (error) {
      console.error('[CONSULTATIONS] workflow error:', error);
      setWorkflowError(true);
      setWorkflowLoading(false);
      return;
    }
    setWorkflow((data as WorkflowState) ?? null);
    setWorkflowError(false);
    setWorkflowLoading(false);
  }, []);

  // === Historique (filtres serveur) ===
  const load = useCallback(async (silent = false) => {
    if (filters.status === 'pending') { setConsultations([]); setLoadError(false); setLoading(false); return; }
    if (!silent) setLoading(true);
    let q = supabase
      .from('consultations')
      .select('*, patient:patients(*), doctor:profiles(*), appointment:appointments(*)')
      .order('created_at', { ascending: false })
      .limit(400);

    if (filterPatientId) q = q.eq('patient_id', filterPatientId);
    if (filters.status !== 'all') q = q.eq('status', filters.status);
    if (filters.doctor) q = q.eq('doctor_id', filters.doctor);

    console.debug('[CONSULTATIONS] filters', { status: filters.status, doctor: filters.doctor, patient: filterPatientId });
    const { data, error } = await q;
    if (error) {
      console.error('[CONSULTATIONS] error', error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    console.debug('[CONSULTATIONS] data', { rows: data?.length ?? 0 });
    const loaded = (data as Consultation[]) ?? [];
    setConsultations(loaded);
    setLoadError(false);
    setLoading(false);

    if (filterConsultationId) {
      const found = loaded.find((c) => c.id === filterConsultationId);
      if (found) {
        setViewing(found);
        // Ouverture automatique du formulaire, une seule fois par consultation
        if (found.status === 'in_progress' && canEdit && autoOpenedRef.current !== found.id) {
          autoOpenedRef.current = found.id;
          setEditing(found);
          setShowForm(true);
        }
      }
    }
  }, [filterPatientId, filterConsultationId, filters.status, filters.doctor, canEdit]);


  useEffect(() => { loadWorkflow(); }, [loadWorkflow]);
  useEffect(() => { load(); }, [load]);

  /** Consultation transmise à l'ouverture : le rendez-vous est conservé quand on
   *  ouvre depuis une carte du flux, pour ne jamais en créer un second. */
  const baseConsultation = useMemo(() => {
    if (!viewing) return null;
    return pendingAppointmentId && !viewing.appointment_id
      ? { ...viewing, appointment_id: pendingAppointmentId }
      : viewing;
  }, [viewing, pendingAppointmentId]);

  // Patients, médecins et numéros de dossier (référentiels)
  useEffect(() => {
    supabase.from('patients').select('*').eq('status', 'active').order('last_name')
      .then(({ data }) => setPatients((data as Patient[]) ?? []));
    supabase.from('profiles').select('*').eq('role', 'DOCTOR').eq('active', true).order('full_name')
      .then(({ data }) => setDoctors((data as Profile[]) ?? []));
    supabase.from('medical_files').select('patient_id, file_number')
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const f of (data as { patient_id: string; file_number: string }[]) ?? []) map[f.patient_id] = f.file_number;
        setMedicalFileNumbers(map);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Realtime : envois depuis la salle d'attente et acceptations par les médecins
  useEffect(() => {
    const channel = supabase
      .channel('consultation_workflow_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiting_queue' }, () => loadWorkflow())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations' }, () => { loadWorkflow(); load(true); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadWorkflow, load]);

  useEffect(() => {
    if (!filterPatientId) { setPatientContext(null); return; }
    let cancelled = false;
    loadPatientContext(filterPatientId).then((ctx) => { if (!cancelled) setPatientContext(ctx); });
    return () => { cancelled = true; };
  }, [filterPatientId]);

  const dismissError = () => {
    sessionStorage.removeItem('cmdz-transfer-error');
    setActionError(null);
  };

  /** « Accepter » : le médecin prend le patient et ouvre la consultation. */
  const handleAccept = async (item: PendingItem) => {
    if (acceptLockRef.current) return;
    acceptLockRef.current = true;
    setActionError(null);
    setAccepting(item.queue_id);
    try {
      const { data, error } = await supabase.rpc('accept_consultation', { p_queue_id: item.queue_id });
      if (error) {
        console.error('[CONSULTATIONS] accept error:', error);
        setActionError(error.message.includes('déjà été pris en charge')
          ? 'Ce patient a déjà été pris en charge par un autre médecin.'
          : "Impossible d'accepter ce patient. Veuillez réessayer.");
        loadWorkflow();
        return;
      }
      const result = data as { consultation_id: string; patient_id: string } | null;
      if (!result?.consultation_id) {
        setActionError("Impossible d'accepter ce patient. Veuillez réessayer.");
        return;
      }
      // Accepter ne navigue pas : le patient apparaît dans « En consultation ».
      await loadWorkflow();
    } finally {
      setAccepting(null);
      acceptLockRef.current = false;
    }
  };

  /**
   * « Ouvrir » : ouvre la vraie consultation médicale du patient.
   * Réutilise la consultation existante ; sinon bascule sur le montage direct
   * en transmettant patient et rendez-vous déjà sélectionnés.
   */
  const handleOpenConsultation = async (item: ReturnableItem & { consultation_id: string | null }) => {
    const patientId = item.patient?.id;
    const appointmentId = item.appointment?.id ?? null;
    if (!patientId) return;

    let consultationId = item.consultation_id;
    if (!consultationId) {
      const { data, error } = await supabase.rpc('ensure_consultation_for_appointment', {
        p_patient_id: patientId, p_appointment_id: appointmentId,
      });
      if (error || !data) {
        console.error('[CONSULTATIONS] ensure error:', error);
        setActionError("Impossible d'ouvrir la consultation. Veuillez réessayer.");
        return;
      }
      consultationId = (data as { consultation_id: string }).consultation_id;
    }

    const { data: full } = await supabase
      .from('consultations')
      .select('*, patient:patients(*), doctor:profiles(*), appointment:appointments(*)')
      .eq('id', consultationId)
      .maybeSingle();

    if (!full) {
      setActionError("Impossible d'ouvrir la consultation. Veuillez réessayer.");
      return;
    }

    const consultation = full as Consultation;
    setPendingAppointmentId(appointmentId ? consultation.appointment_id : null);
    await logAudit('CONSULTATION_OPENED', 'consultation', consultationId, fullName(consultation.patient), {
      user: profile?.full_name, role: profile?.role, doctor_id: consultation.doctor_id,
      patient_id: consultation.patient_id, appointment_id: consultation.appointment_id,
      consultation_id: consultationId,
    }, { id: profile?.id, name: profile?.full_name });

    setViewing(consultation);
  };

  /** Renvoie le patient en salle d'attente sans créer de nouveau rendez-vous. */
  const handleReturnToQueue = async (item: ReturnableItem) => {
    setReturning(item.queue_id);
    setActionError(null);
    try {
      const { error } = await supabase.rpc('return_to_waiting_queue', { p_queue_id: item.queue_id });
      if (error) {
        console.error('[CONSULTATIONS] return error:', error);
        setActionError("Impossible de retourner le patient en salle d'attente. Veuillez réessayer.");
        return;
      }
      await logAudit('queue_return', 'waiting_queue', item.queue_id, item.queue_number, {
        user: profile?.full_name, role: profile?.role,
        patient_id: item.patient?.id, appointment_id: item.appointment?.id,
      }, { id: profile?.id, name: profile?.full_name });
      loadWorkflow(); load(true);
    } finally {
      setReturning(null);
    }
  };

  const loadVersions = async (consultationId: string) => {
    const { data } = await supabase.from('record_versions').select('*').eq('entity_type', 'consultation').eq('entity_id', consultationId).order('version_number', { ascending: false });
    setVersions((data as RecordVersion[]) ?? []);
  };

  const handleSave = async (data: Partial<Consultation>) => {
    if (editing) {
      const { data: old } = await supabase.from('consultations').select('*').eq('id', editing.id).maybeSingle();
      const { error } = await supabase.from('consultations').update({
        ...data,
        updated_at: new Date().toISOString(),
        bmi: data.weight && data.height ? Number((data.weight / Math.pow(data.height / 100, 2)).toFixed(1)) : data.bmi,
      }).eq('id', editing.id);
      if (error) { alert(error.message); return; }

      const changedFields: Record<string, unknown> = {};
      const prevValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const key of Object.keys(data)) {
        if ((old as Record<string, unknown>)?.[key] !== (data as Record<string, unknown>)[key]) {
          changedFields[key] = true;
          prevValues[key] = (old as Record<string, unknown>)?.[key];
          newValues[key] = (data as Record<string, unknown>)[key];
        }
      }
      if (Object.keys(changedFields).length > 0) {
        const { data: lastVer } = await supabase.from('record_versions').select('version_number').eq('entity_type', 'consultation').eq('entity_id', editing.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
        const nextVer = ((lastVer as RecordVersion)?.version_number ?? 0) + 1;
        await supabase.from('record_versions').insert({
          entity_type: 'consultation',
          entity_id: editing.id,
          version_number: nextVer,
          changed_by: profile?.id,
          changed_fields: changedFields,
          previous_values: prevValues,
          new_values: newValues,
        });
      }
      await logAudit('consultation_update', 'consultation', editing.id, fullName(editing.patient));
    } else {
      const { data: medicalFile } = await supabase.from('medical_files').select('id').eq('patient_id', data.patient_id).maybeSingle();
      const { data: newCons, error } = await supabase.from('consultations').insert({
        ...data,
        medical_file_id: (medicalFile as MedicalFile)?.id ?? null,
        doctor_id: profile?.id,
        appointment_id: data.appointment_id ?? pendingAppointmentId ?? null,
        status: 'in_progress',
      }).select().single();
      if (error) { alert(error.message); return; }
      await logAudit('consultation_create', 'consultation', (newCons as Consultation).id, data.chief_complaint ?? '');
    }
    setShowForm(false);
    setEditing(null);
    load(true); loadWorkflow();
  };

  const handleComplete = async (c: Consultation) => {
    const nowIso = new Date().toISOString();
    await supabase.from('consultations').update({
      status: 'completed',
      completed_at: nowIso,
      updated_at: nowIso,
    }).eq('id', c.id);
    await logAudit('CONSULTATION_COMPLETED', 'consultation', c.id, fullName(c.patient), {
      user: profile?.full_name, role: profile?.role, patient_id: c.patient_id,
      appointment_id: c.appointment_id, consultation_id: c.id,
    }, { id: profile?.id, name: profile?.full_name });

    // Sortie de file d'attente et clôture du rendez-vous, pour la facturation
    if (c.queue_id) {
      await supabase.from('waiting_queue').update({
        status: 'completed', completed_at: nowIso, updated_at: nowIso,
      }).eq('id', c.queue_id);
    }
    const appointmentId = c.appointment_id ?? null;
    if (appointmentId) {
      await supabase.from('appointments').update({
        status: 'completed', completed_by: profile?.id, completed_at: nowIso, updated_at: nowIso,
      }).eq('id', appointmentId);
      await logAudit('appointment_complete', 'appointment', appointmentId, fullName(c.patient), {
        user: profile?.full_name, role: profile?.role, patient_id: c.patient_id,
        consultation_id: c.id, old_value: 'in_consultation', new_value: 'completed',
      }, { id: profile?.id, name: profile?.full_name });
    }
    setViewing(null);
    load(true); loadWorkflow();
  };

  if (writePrescription && viewing) {
    return (
      <div>
        <PageHeader
          title="Nouvelle ordonnance"
          subtitle={`Depuis la consultation — ${fullName(viewing.patient)}`}
          actions={<button onClick={() => setWritePrescription(false)} className="btn-secondary">← Retour à la consultation</button>}
        />
        <PrescriptionEditor
          patient={(viewing.patient as Patient) ?? null}
          consultationId={viewing.id}
          doctorId={profile?.id ?? null}
          onClose={() => setWritePrescription(false)}
          onSaved={() => setWritePrescription(false)}
        />
      </div>
    );
  }

  if (viewing && baseConsultation) {
    return (
      <>
        <ConsultationDetail
          consultation={baseConsultation}
          versions={versions}
          onBack={() => { setViewing(null); setVersions([]); }}
          onEdit={() => { setEditing(baseConsultation); setShowForm(true); }}
          onComplete={() => handleComplete(baseConsultation)}
          onLoadVersions={() => loadVersions(viewing.id)}
          onOpenMedicalFile={onNavigate && viewing.patient_id ? () => onNavigate(`/medical-files?patient=${viewing.patient_id}`) : undefined}
          onWritePrescription={() => setWritePrescription(true)}
          canEdit={canEdit}
        />
        {showForm && (
          <ConsultationForm
            consultation={editing}
            patients={patients}
            preselectedPatientId={editing ? null : filterPatientId}
            patientContext={patientContext}
            onClose={() => { setShowForm(false); setEditing(null); }}
            onSave={handleSave}
            onOpenMedicalFile={onNavigate && filterPatientId ? () => onNavigate(`/medical-files?patient=${filterPatientId}`) : undefined}
          />
        )}
      </>
    );
  }

  // La date filtrée est la date affichée : rendez-vous réel, sinon création.
  const effectiveRange = resolveDateRange(filters.date, filters.from, filters.to);
  const visible = consultations.filter((c) =>
    matchesDateRange(consultationEffectiveDate(c), effectiveRange) &&
    matchesPatientSearch(c.patient, medicalFileNumbers[c.patient_id], debouncedSearch)
  );
  const page = filters.page;
  const paged = visible.slice((page - 1) * 15, page * 15);
  const active = workflow?.active ?? [];
  const counts = workflow?.counts;

  return (
    <div>
      {actionError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-700 flex-1">{actionError}</p>
          <button onClick={dismissError} className="text-red-400 hover:text-red-600" aria-label="Fermer le message">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <PageHeader
        title="Consultations"
        subtitle="Patients envoyés depuis la salle d'attente, consultations en cours et historique"
        actions={canEdit && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouvelle consultation
          </button>
        )}
      />

      {workflowError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-700">Impossible de charger le flux des consultations. Vérifiez la connexion et réessayez.</p>
        </div>
      )}

      {/* === COMPTEURS RÉELS === */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="À accepter" value={counts?.pending} loading={workflowLoading} tone="cyan" icon={<Clock3 className="w-4 h-4" />} onClick={() => updateFilters({ status: 'pending', page: 1 })} active={filters.status === 'pending'} />
        <StatCard label="En consultation" value={counts?.in_consultation} loading={workflowLoading} tone="amber" icon={<Stethoscope className="w-4 h-4" />} onClick={() => updateFilters({ status: 'in_progress', page: 1 })} active={filters.status === 'in_progress'} />
        <StatCard label="Terminées" value={counts?.completed} loading={workflowLoading} tone="green" icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => updateFilters({ status: 'completed', page: 1 })} active={filters.status === 'completed'} />
        <StatCard label="Annulées" value={counts?.cancelled} loading={workflowLoading} tone="gray" icon={<XCircle className="w-4 h-4" />} onClick={() => updateFilters({ status: 'cancelled', page: 1 })} active={filters.status === 'cancelled'} />
      </div>

      {/* === À ACCEPTER === */}
      <ConsultationAcceptancePanel
        items={workflow?.pending ?? []}
        loading={workflowLoading}
        canAccept={canEdit}
        acceptingId={accepting}
        returningId={returning}
        onAccept={handleAccept}
        onReturn={handleReturnToQueue}
        onOpenFile={onNavigate ? (pid) => onNavigate(`/medical-files?patient=${pid}`) : undefined}
      />

      {/* === EN CONSULTATION === */}
      {(workflowLoading || active.length > 0) && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-gray-900">En consultation</h2>
            {!workflowLoading && <span className="badge bg-amber-100 text-amber-700 border-amber-200">{active.length}</span>}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((item) => (
              <div key={item.queue_id} className="card p-4 border-l-4 border-l-amber-400">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900 truncate">{fullName(item.patient)}</p>
                      <span className="badge bg-amber-100 text-amber-700 border-amber-200">En consultation</span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">{item.patient?.patient_number ?? '—'}</p>
                    <p className="text-sm text-gray-600 mt-1.5 flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5 text-gray-400" />
                      {item.doctor_name ?? 'Médecin non assigné'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-gray-400" />
                      {formatDate(item.appointment?.appointment_date)} {item.appointment?.appointment_time?.substring(0, 5) ?? ''}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                    <button
                      onClick={() => handleOpenConsultation(item)}
                      className="btn-sm bg-amber-600 text-white hover:bg-amber-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                    >
                      <Stethoscope className="w-3.5 h-3.5" /> Ouvrir
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => handleReturnToQueue(item)}
                        disabled={returning === item.queue_id}
                        className="btn-ghost btn-sm text-xs"
                        title="Retourner en salle d'attente"
                      >
                        <ArrowRight className="w-3.5 h-3.5 rotate-180" /> Retour
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === HISTORIQUE + FILTRES === */}
      <ConsultationsList
        consultations={paged}
        doctors={doctors}
        loading={loading}
        error={loadError}
        filters={{ ...filters, search: debouncedSearch }}
        onChange={updateFilters}
        onOpen={setViewing}
        onRetry={() => load()}
        onOpenFile={onNavigate ? (pid) => onNavigate(`/medical-files?patient=${pid}`) : undefined}
      />

      {showForm && (
        <ConsultationForm
          consultation={editing}
          patients={patients}
          preselectedPatientId={editing ? null : filterPatientId}
          patientContext={patientContext}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
          onOpenMedicalFile={onNavigate && filterPatientId ? () => onNavigate(`/medical-files?patient=${filterPatientId}`) : undefined}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, loading, tone, icon, onClick, active }: {
  label: string; value?: number; loading: boolean;
  tone: 'cyan' | 'amber' | 'green' | 'gray';
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const tones = {
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white rounded-xl border p-3.5 shadow-sm transition-all hover:shadow-md ${active ? 'border-blue-300 ring-1 ring-blue-200' : 'border-gray-100'}`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 border ${tones[tone]}`}>{icon}</div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      {loading ? <div className="h-5 w-10 bg-gray-100 rounded animate-pulse" /> : <p className="text-xl font-bold text-gray-900">{value ?? 0}</p>}
    </button>
  );
}

function ConsultationDetail({ consultation, versions, onBack, onEdit, onComplete, onLoadVersions, onOpenMedicalFile, onWritePrescription, canEdit }: {
  consultation: Consultation;
  versions: RecordVersion[];
  onBack: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onLoadVersions: () => void;
  onOpenMedicalFile?: () => void;
  /** Ouvre l'unique éditeur d'ordonnance avec le patient et la consultation. */
  onWritePrescription: () => void;
  canEdit: boolean;
}) {
  const [showVersions, setShowVersions] = useState(false);
  const [fileNumber, setFileNumber] = useState<string | null>(null);

  useEffect(() => { onLoadVersions(); }, [onLoadVersions]);

  useEffect(() => {
    if (!consultation.medical_file_id) { setFileNumber(null); return; }
    supabase.from('medical_files').select('file_number').eq('id', consultation.medical_file_id).maybeSingle()
      .then(({ data }) => setFileNumber((data as { file_number: string } | null)?.file_number ?? null));
  }, [consultation.medical_file_id]);

  const fields: { label: string; value: string | null | undefined }[] = [
    { label: 'Motif de consultation', value: consultation.chief_complaint },
    { label: 'Symptômes', value: consultation.symptoms },
    { label: 'Antécédents médicaux', value: consultation.medical_history },
    { label: 'Antécédents chirurgicaux', value: consultation.surgical_history },
    { label: 'Antécédents familiaux', value: consultation.family_history },
    { label: 'Diagnostic', value: consultation.diagnosis },
    { label: 'Code CIM', value: consultation.icd_code },
    { label: 'Traitement', value: consultation.treatment },
    { label: 'Recommandations', value: consultation.recommendations },
    { label: 'Notes', value: consultation.notes },
  ];

  const vitals: { label: string; value: string | null | undefined }[] = [
    { label: 'Température (°C)', value: consultation.temperature?.toString() },
    { label: 'Tension artérielle', value: consultation.blood_pressure_systolic ? `${consultation.blood_pressure_systolic}/${consultation.blood_pressure_diastolic}` : null },
    { label: 'Fréquence cardiaque', value: consultation.heart_rate?.toString() },
    { label: 'Fréquence respiratoire', value: consultation.respiratory_rate?.toString() },
    { label: 'SpO2 (%)', value: consultation.spo2?.toString() },
    { label: 'Poids (kg)', value: consultation.weight?.toString() },
    { label: 'Taille (cm)', value: consultation.height?.toString() },
    { label: 'IMC', value: consultation.bmi?.toString() },
  ];

  return (
    <div>
      <button onClick={onBack} className="btn-secondary btn-sm mb-4">← Retour</button>

      <div className="card p-5 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Patient</p>
            <h1 className="text-2xl font-bold text-gray-900">{fullName(consultation.patient)}</h1>
            <p className="text-sm text-gray-600 font-mono mt-1">
              {consultation.patient?.patient_number ?? '—'}{fileNumber ? ` • ${fileNumber}` : ''}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {calculateAge(consultation.patient?.date_of_birth)} ans — {sexLabel(consultation.patient?.sex)}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
              <div>
                <p className="text-xs text-gray-400">Date</p>
                <p className="text-sm font-medium text-gray-900">
                  {consultation.appointment ? formatDate(consultation.appointment.appointment_date) : formatDate(consultation.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Heure</p>
                <p className="text-sm font-medium text-gray-900">
                  {consultation.appointment?.appointment_time?.substring(0, 5) ?? formatTime(consultation.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Médecin</p>
                <p className="text-sm font-medium text-gray-900">{consultation.doctor?.full_name ?? 'Non affecté'}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {canEdit && consultation.status === 'in_progress' && (
              <>
                <button onClick={onEdit} className="btn-secondary btn-sm">Modifier</button>
                <button onClick={onComplete} className="btn-primary btn-sm">Terminer</button>
              </>
            )}
            {canEdit && (
              <button onClick={onWritePrescription} className="btn-secondary btn-sm">
                <Pill className="w-4 h-4" /> Ordonnance
              </button>
            )}
            {onOpenMedicalFile && (
              <button onClick={onOpenMedicalFile} className="btn-secondary btn-sm">
                <FolderHeart className="w-4 h-4" /> Voir le dossier médical
              </button>
            )}
            <button onClick={() => setShowVersions(!showVersions)} className="btn-secondary btn-sm">
              <History className="w-4 h-4" /> Versions
            </button>
          </div>
        </div>
      </div>

      {showVersions && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <FileClock className="w-4 h-4" /> Historique des versions ({versions.length})
          </h2>
          {versions.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune modification enregistrée</p>
          ) : (
            <div className="space-y-3">
              {versions.map((v) => (
                <div key={v.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">Version {v.version_number}</span>
                    <span className="text-xs text-gray-500">{formatDateTime(v.created_at)}</span>
                  </div>
                  <div className="text-xs space-y-1">
                    {Object.keys(v.changed_fields).map((field) => (
                      <div key={field} className="flex gap-2">
                        <span className="font-medium text-gray-700">{field}:</span>
                        <span className="text-red-500 line-through">{String(v.previous_values[field] ?? '')}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-green-600">{String(v.new_values[field] ?? '')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Constantes vitales</h2>
          <div className="grid grid-cols-2 gap-3">
            {vitals.map((v) => (
              <div key={v.label}>
                <p className="text-xs text-gray-500">{v.label}</p>
                <p className="text-sm font-medium text-gray-900">{v.value || '—'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Suivi</h2>
          <div>
            <p className="text-xs text-gray-500">Date de suivi recommandée</p>
            <p className="text-sm font-medium text-gray-900">{formatDate(consultation.follow_up_date)}</p>
          </div>
        </div>
      </div>

      <div className="card p-5 mt-6">
        <h2 className="font-semibold text-gray-900 mb-4">Détails de la consultation</h2>
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.label}>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{f.label}</p>
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{f.value || '—'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsultationForm({ consultation, patients, preselectedPatientId, patientContext, onClose, onSave, onOpenMedicalFile }: {
  consultation: Consultation | null;
  patients: Patient[];
  preselectedPatientId?: string | null;
  patientContext?: PatientContext | null;
  onClose: () => void;
  onSave: (data: Partial<Consultation>) => void;
  onOpenMedicalFile?: () => void;
}) {
  const lockedPatient = useMemo(
    () => (!consultation && preselectedPatientId)
      ? (patientContext?.patient ?? patients.find((p) => p.id === preselectedPatientId) ?? null)
      : null,
    [consultation, preselectedPatientId, patientContext, patients],
  );

  const [form, setForm] = useState<Partial<Consultation>>({
    patient_id: consultation?.patient_id ?? preselectedPatientId ?? '',
    chief_complaint: consultation?.chief_complaint ?? '',
    symptoms: consultation?.symptoms ?? '',
    medical_history: consultation?.medical_history ?? '',
    surgical_history: consultation?.surgical_history ?? '',
    family_history: consultation?.family_history ?? '',
    temperature: consultation?.temperature ?? null,
    blood_pressure_systolic: consultation?.blood_pressure_systolic ?? null,
    blood_pressure_diastolic: consultation?.blood_pressure_diastolic ?? null,
    heart_rate: consultation?.heart_rate ?? null,
    respiratory_rate: consultation?.respiratory_rate ?? null,
    spo2: consultation?.spo2 ?? null,
    weight: consultation?.weight ?? null,
    height: consultation?.height ?? null,
    diagnosis: consultation?.diagnosis ?? '',
    icd_code: consultation?.icd_code ?? '',
    treatment: consultation?.treatment ?? '',
    recommendations: consultation?.recommendations ?? '',
    notes: consultation?.notes ?? '',
    follow_up_date: consultation?.follow_up_date ?? '',
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<Consultation> = { ...form };
    if (data.temperature !== null) data.temperature = Number(data.temperature) || null;
    if (data.blood_pressure_systolic !== null) data.blood_pressure_systolic = Number(data.blood_pressure_systolic) || null;
    if (data.blood_pressure_diastolic !== null) data.blood_pressure_diastolic = Number(data.blood_pressure_diastolic) || null;
    if (data.heart_rate !== null) data.heart_rate = Number(data.heart_rate) || null;
    if (data.respiratory_rate !== null) data.respiratory_rate = Number(data.respiratory_rate) || null;
    if (data.spo2 !== null) data.spo2 = Number(data.spo2) || null;
    if (data.weight !== null) data.weight = Number(data.weight) || null;
    if (data.height !== null) data.height = Number(data.height) || null;
    onSave(data);
  };

  return (
    <Modal open onClose={onClose} title={consultation ? 'Modifier la consultation' : 'Nouvelle consultation'} size="xl">
      <form onSubmit={submit} className="space-y-4">
        {!consultation && lockedPatient && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5">
            <p className="text-xs text-blue-600 uppercase tracking-wide mb-2">Patient (déjà sélectionné)</p>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${lockedPatient.sex === 'M' ? 'bg-blue-600' : lockedPatient.sex === 'F' ? 'bg-pink-600' : 'bg-gray-500'} flex items-center justify-center text-white font-bold flex-shrink-0`}>
                  {`${lockedPatient.first_name?.[0] ?? ''}${lockedPatient.last_name?.[0] ?? ''}`.toUpperCase() || <User className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{fullName(lockedPatient)}</p>
                  <p className="text-xs text-gray-600 font-mono">
                    {lockedPatient.patient_number}
                    {patientContext?.medicalFile?.file_number ? ` • ${patientContext.medicalFile.file_number}` : ''}
                  </p>
                  <p className="text-xs text-gray-600">
                    {calculateAge(lockedPatient.date_of_birth)} ans — {sexLabel(lockedPatient.sex)}
                  </p>
                </div>
              </div>
              {onOpenMedicalFile && (
                <button type="button" onClick={onOpenMedicalFile} className="btn-secondary btn-sm">
                  <FolderHeart className="w-4 h-4" /> Voir le dossier médical <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {!consultation && !lockedPatient && (
          <div>
            <label className="label">Patient *</label>
            <select className="input" required value={form.patient_id ?? ''} onChange={(e) => setForm({ ...form, patient_id: e.target.value })}>
              <option value="">— Sélectionner —</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{fullName(p)} — {p.patient_number}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Motif de consultation</label><input className="input" value={form.chief_complaint ?? ''} onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })} /></div>
          <div><label className="label">Code CIM</label><input className="input" value={form.icd_code ?? ''} onChange={(e) => setForm({ ...form, icd_code: e.target.value })} /></div>
        </div>

        <div><label className="label">Symptômes</label><textarea className="input" rows={2} value={form.symptoms ?? ''} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} /></div>

        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Temp. (°C)</label><input type="number" step="0.1" className="input" value={form.temperature ?? ''} onChange={(e) => setForm({ ...form, temperature: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">Tension S.</label><input type="number" className="input" value={form.blood_pressure_systolic ?? ''} onChange={(e) => setForm({ ...form, blood_pressure_systolic: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">Tension D.</label><input type="number" className="input" value={form.blood_pressure_diastolic ?? ''} onChange={(e) => setForm({ ...form, blood_pressure_diastolic: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">FC (bpm)</label><input type="number" className="input" value={form.heart_rate ?? ''} onChange={(e) => setForm({ ...form, heart_rate: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">FR</label><input type="number" className="input" value={form.respiratory_rate ?? ''} onChange={(e) => setForm({ ...form, respiratory_rate: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">SpO2 (%)</label><input type="number" className="input" value={form.spo2 ?? ''} onChange={(e) => setForm({ ...form, spo2: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">Poids (kg)</label><input type="number" step="0.1" className="input" value={form.weight ?? ''} onChange={(e) => setForm({ ...form, weight: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">Taille (cm)</label><input type="number" className="input" value={form.height ?? ''} onChange={(e) => setForm({ ...form, height: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">Date de suivi</label><input type="date" className="input" value={form.follow_up_date ?? ''} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} /></div>
        </div>

        <div><label className="label">Antécédents médicaux</label><textarea className="input" rows={2} value={form.medical_history ?? ''} onChange={(e) => setForm({ ...form, medical_history: e.target.value })} /></div>
        <div><label className="label">Antécédents chirurgicaux</label><textarea className="input" rows={2} value={form.surgical_history ?? ''} onChange={(e) => setForm({ ...form, surgical_history: e.target.value })} /></div>
        <div><label className="label">Antécédents familiaux</label><textarea className="input" rows={2} value={form.family_history ?? ''} onChange={(e) => setForm({ ...form, family_history: e.target.value })} /></div>

        <div><label className="label">Diagnostic</label><textarea className="input" rows={2} value={form.diagnosis ?? ''} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></div>
        <div><label className="label">Traitement</label><textarea className="input" rows={2} value={form.treatment ?? ''} onChange={(e) => setForm({ ...form, treatment: e.target.value })} /></div>
        <div><label className="label">Recommandations</label><textarea className="input" rows={2} value={form.recommendations ?? ''} onChange={(e) => setForm({ ...form, recommendations: e.target.value })} /></div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" className="btn-primary"><Save className="w-4 h-4" /> Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
