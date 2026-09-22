import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, Calendar as CalIcon, Clock, X, Check, UserX,
  ChevronLeft, ChevronRight, CalendarClock, Trash2, Edit2,
  CreditCard, Stethoscope, FileText, User, MoreHorizontal,
  RefreshCw, AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui';
import { AppointmentForm, PostponeModal } from '@/components/AppointmentForm';
import { AppointmentDetailsModal } from '@/components/AppointmentDetailsModal';
import {
  STATUS_META, getStatusMeta, toLocalDateStr, fromLocalDateStr, formatDateStr,
  addDays, startOfWeek, weekDays, monthGridDays, isToday, formatLongDateFR,
  formatMonthYearFR, WEEKDAY_SHORT, mergeNotes,
  type AppointmentWithRelations,
} from '@/lib/appointments';
import type { Appointment, Profile } from '@/types';

type ViewMode = 'day' | 'week' | 'month';
type DateScope = 'today' | 'tomorrow' | 'week' | 'upcoming' | 'all';
type StatusScope = 'scheduled' | 'arrived' | 'in_consultation' | 'completed' | 'no_show' | 'cancelled';

type Chip = { key: string; label: string; date?: DateScope; status?: StatusScope };

const CHIPS: Chip[] = [
  { key: 'today', label: "Aujourd'hui", date: 'today' },
  { key: 'tomorrow', label: 'Demain', date: 'tomorrow' },
  { key: 'week', label: 'Cette semaine', date: 'week' },
  { key: 'upcoming', label: 'À venir', date: 'upcoming' },
  { key: 'scheduled', label: 'Programmés', status: 'scheduled' },
  { key: 'arrived', label: 'Présents', status: 'arrived' },
  { key: 'in_consultation', label: 'En consultation', status: 'in_consultation' },
  { key: 'completed', label: 'Terminés', status: 'completed' },
  { key: 'no_show', label: 'Absents', status: 'no_show' },
  { key: 'cancelled', label: 'Annulés', status: 'cancelled' },
  { key: 'all', label: 'Tous', date: 'all' },
];

const LOAD_ERROR = 'Impossible de charger les rendez-vous. Vérifiez la connexion au serveur et réessayez.';
const MAX_ROWS = 500;

const SELECT_QUERY = `
  *,
  patient:patients(*, medical_file:medical_files(*)),
  doctor:profiles(*)
`;

export default function AppointmentsPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { hasRole, profile } = useAuth();
  const [view, setView] = useState<ViewMode>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dateScope, setDateScope] = useState<DateScope>('today');
  const [statusScope, setStatusScope] = useState<StatusScope | null>(null);

  const [rows, setRows] = useState<AppointmentWithRelations[]>([]);
  const [calRows, setCalRows] = useState<AppointmentWithRelations[]>([]);
  const [rowsStatus, setRowsStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [calStatus, setCalStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppointmentWithRelations | null>(null);
  const [details, setDetails] = useState<AppointmentWithRelations | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<AppointmentWithRelations | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AppointmentWithRelations | null>(null);
  const [showPostpone, setShowPostpone] = useState<AppointmentWithRelations | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [todayStats, setTodayStats] = useState({ total: 0, scheduled: 0, arrived: 0, inConsultation: 0, completed: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');
  const canDelete = hasRole('ADMIN', 'RECEPTION');
  const isDoctorOnly = hasRole('DOCTOR') && !hasRole('ADMIN');

  const todayStr = toLocalDateStr(new Date());

  // === Liste : portée de dates + portée de statut, filtrées côté serveur ===
  const loadRows = useCallback(async (silent = false) => {
    if (!silent) setRowsStatus('loading');
    else setRefreshing(true);

    let q = supabase.from('appointments').select(SELECT_QUERY);

    if (dateScope === 'today') {
      q = q.eq('appointment_date', todayStr);
    } else if (dateScope === 'tomorrow') {
      q = q.eq('appointment_date', toLocalDateStr(addDays(new Date(), 1)));
    } else if (dateScope === 'week') {
      const s = startOfWeek(new Date());
      q = q.gte('appointment_date', toLocalDateStr(s)).lte('appointment_date', toLocalDateStr(addDays(s, 6)));
    } else if (dateScope === 'upcoming') {
      q = q.gte('appointment_date', todayStr).in('status', ['scheduled', 'postponed']);
    }

    if (statusScope) q = q.eq('status', statusScope);

    const { data, error } = await q
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })
      .limit(MAX_ROWS);

    if (error) {
      console.error('[APPOINTMENTS] query error:', error);
      setRowsStatus('error');
      setRefreshing(false);
      return;
    }
    const list = (data as AppointmentWithRelations[]) ?? [];
    setRows(list);
    setTruncated(list.length === MAX_ROWS);
    setRowsStatus('success');
    setRefreshing(false);
  }, [dateScope, statusScope, todayStr]);

  // === Calendrier : fenêtre du mois affiché ===
  const loadCalendar = useCallback(async () => {
    setCalStatus('loading');
    const grid = monthGridDays(currentDate);
    const { data, error } = await supabase
      .from('appointments')
      .select(SELECT_QUERY)
      .gte('appointment_date', toLocalDateStr(grid[0]))
      .lte('appointment_date', toLocalDateStr(grid[grid.length - 1]))
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });

    if (error) {
      console.error('[APPOINTMENTS] calendar query error:', error);
      setCalStatus('error');
      return;
    }
    setCalRows((data as AppointmentWithRelations[]) ?? []);
    setCalStatus('success');
  }, [currentDate]);

  // === Statistiques du jour, indépendantes des filtres ===
  const loadStats = useCallback(async () => {
    const base = () => supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('appointment_date', todayStr);
    const [total, scheduled, arrived, inConsultation, completed] = await Promise.all([
      base(),
      base().eq('status', 'scheduled'),
      base().eq('status', 'arrived'),
      base().eq('status', 'in_consultation'),
      base().eq('status', 'completed'),
    ]);
    if (total.error) { console.error('[APPOINTMENTS] stats error:', total.error); return; }
    setTodayStats({
      total: total.count ?? 0,
      scheduled: scheduled.count ?? 0,
      arrived: arrived.count ?? 0,
      inConsultation: inConsultation.count ?? 0,
      completed: completed.count ?? 0,
    });
  }, [todayStr]);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'DOCTOR').eq('active', true)
      .then(({ data }) => setDoctors((data as Profile[]) ?? []));
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);
  useEffect(() => { loadCalendar(); }, [loadCalendar]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // Statuts de file d'attente associés aux rendez-vous affichés
  const idsKey = [...rows.map((r) => r.id), ...calRows.map((r) => r.id)].join(',');
  useEffect(() => {
    const ids = Array.from(new Set([...rows.map((r) => r.id), ...calRows.map((r) => r.id)]));
    if (ids.length === 0) return;
    let cancelled = false;
    supabase
      .from('waiting_queue')
      .select('appointment_id, status, entered_consultation_at')
      .in('appointment_id', ids)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const map = new Map<string, { status: string; entered: string | null }>();
        for (const q of data as { appointment_id: string; status: string; entered_consultation_at: string | null }[]) {
          map.set(q.appointment_id, { status: q.status, entered: q.entered_consultation_at });
        }
        const apply = (a: AppointmentWithRelations): AppointmentWithRelations => {
          const q = map.get(a.id);
          return { ...a, queue_status: q?.status ?? null, queue_entered_at: q?.entered ?? null };
        };
        setRows((prev) => prev.map(apply));
        setCalRows((prev) => prev.map(apply));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Realtime — synchronisation immédiate entre postes
  useEffect(() => {
    const channel = supabase
      .channel('appointments_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        loadRows(true); loadCalendar(); loadStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiting_queue' }, () => {
        loadRows(true); loadCalendar();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadRows, loadCalendar, loadStats]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const matchesSearch = useCallback((a: AppointmentWithRelations, s: string): boolean => {
    if (!s) return true;
    const q = s.toLowerCase();
    return (
      fullName(a.patient).toLowerCase().includes(q) ||
      (a.patient?.patient_number ?? '').toLowerCase().includes(q) ||
      (a.patient?.medical_file?.file_number ?? '').toLowerCase().includes(q) ||
      (a.patient?.phone ?? '').toLowerCase().includes(q) ||
      (a.patient?.cin ?? '').toLowerCase().includes(q) ||
      (a.doctor?.full_name ?? '').toLowerCase().includes(q) ||
      (a.reason ?? '').toLowerCase().includes(q)
    );
  }, []);

  const visible = rows.filter((a) => matchesSearch(a, debouncedSearch));
  const calendarVisible = calRows
    .filter((a) => matchesSearch(a, debouncedSearch))
    .filter((a) => !statusScope || a.status === statusScope);

  const activeChip = CHIPS.find((c) =>
    c.status ? c.status === statusScope : !statusScope && c.date === dateScope
  );

  const selectChip = (chip: Chip) => {
    if (chip.date) { setDateScope(chip.date); setStatusScope(null); }
    else if (chip.status) { setStatusScope(chip.status); }
  };

  // Patients non arrivés — toujours les rendez-vous programmés du jour
  const notArrived = rows.filter((a) => a.appointment_date === todayStr && a.status === 'scheduled');
  const showNotArrived = dateScope === 'today' && !statusScope && notArrived.length > 0;

  // === Actions métier ===
  const handleSave = async (data: Partial<Appointment>) => {
    if (editing) {
      const { error } = await supabase.from('appointments').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editing.id);
      if (error) { alert(LOAD_ERROR); console.error(error); return; }
      await logAudit('appointment_update', 'appointment', editing.id, fullName(editing.patient), {
        user: profile?.full_name, role: profile?.role, appointment_id: editing.id, patient_id: editing.patient_id,
        old_value: `${editing.appointment_date} ${editing.appointment_time}`,
        new_value: `${data.appointment_date} ${data.appointment_time}`,
      });
    } else {
      const { data: newAppt, error } = await supabase.from('appointments').insert(data).select().single();
      if (error) { alert(LOAD_ERROR); console.error(error); return; }
      if (newAppt) {
        await logAudit('appointment_create', 'appointment', (newAppt as Appointment).id, data.reason ?? '', {
          user: profile?.full_name, role: profile?.role, patient_id: data.patient_id,
          appointment_id: (newAppt as Appointment).id, date: data.appointment_date, time: data.appointment_time,
        });
        setCurrentDate(fromLocalDateStr((newAppt as Appointment).appointment_date));
        setDateScope('all');
        setStatusScope(null);
      }
    }
    setShowForm(false);
    setEditing(null);
    loadRows(true); loadCalendar(); loadStats();
  };

  const handlePresent = async (appt: AppointmentWithRelations) => {
    setActionLoading(appt.id);
    try {
      if (!appt.patient?.sex) {
        alert('Le sexe du patient est manquant. Veuillez le compléter dans la fiche patient avant le check-in.');
        return;
      }
      const queueType = appt.patient.sex === 'M' ? 'H' : 'F';

      const { error: apptErr } = await supabase
        .from('appointments')
        .update({ status: 'arrived', checked_in_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', appt.id);
      if (apptErr) { alert(apptErr.message); return; }

      const { data: numData, error: numErr } = await supabase.rpc('generate_queue_number', { p_queue_type: queueType });
      if (numErr) { alert(numErr.message); return; }

      const { error: queueErr } = await supabase.from('waiting_queue').insert({
        patient_id: appt.patient_id,
        appointment_id: appt.id,
        queue_type: queueType,
        queue_number: numData as string,
        status: 'waiting',
      });

      if (queueErr) {
        alert(queueErr.code === '23505' ? 'Ce patient est déjà dans la salle d\'attente.' : queueErr.message);
        await supabase.from('appointments').update({ status: 'scheduled', checked_in_at: null }).eq('id', appt.id);
        return;
      }

      await logAudit('appointment_arrived', 'appointment', appt.id, fullName(appt.patient), {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: 'scheduled', new_value: 'arrived',
      });
      await logAudit('queue_checkin', 'waiting_queue', appt.patient_id, `${queueType}-${numData} ${fullName(appt.patient)}`);
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleNoShow = async (appt: AppointmentWithRelations) => {
    setActionLoading(appt.id);
    try {
      const { error } = await supabase.from('appointments').update({ status: 'no_show', updated_at: new Date().toISOString() }).eq('id', appt.id);
      if (error) { alert(error.message); return; }
      await logAudit('appointment_no_show', 'appointment', appt.id, fullName(appt.patient), {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: appt.status, new_value: 'no_show',
      });
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (appt: AppointmentWithRelations, reason?: string) => {
    setActionLoading(appt.id);
    try {
      const { error } = await supabase.from('appointments').update({
        status: 'cancelled',
        notes: reason ? mergeNotes(appt.notes, `Motif d'annulation: ${reason}`) : appt.notes,
        updated_at: new Date().toISOString(),
      }).eq('id', appt.id);
      if (error) { alert(error.message); return; }
      await logAudit('appointment_cancel', 'appointment', appt.id, `${fullName(appt.patient)}${reason ? ` — ${reason}` : ''}`, {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: appt.status, new_value: 'cancelled', reason,
      });
      setConfirmCancel(null);
      setCancelReason('');
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handlePostpone = async (appt: AppointmentWithRelations, newDate: string, newTime: string, newDoctorId: string | null, reason: string) => {
    setActionLoading(appt.id);
    try {
      const { data: newAppt, error: newErr } = await supabase.from('appointments').insert({
        patient_id: appt.patient_id,
        doctor_id: newDoctorId ?? appt.doctor_id,
        appointment_date: newDate,
        appointment_time: newTime,
        duration_minutes: appt.duration_minutes,
        reason: appt.reason,
        notes: reason
          ? `Reporté depuis le ${formatDateStr(appt.appointment_date)}. Motif: ${reason}`
          : `Reporté depuis le ${formatDateStr(appt.appointment_date)}`,
        status: 'scheduled',
      }).select().single();

      if (newErr) { alert(newErr.message); return; }

      await supabase.from('appointments').update({
        status: 'postponed',
        postponed_appointment_id: (newAppt as Appointment).id,
        notes: reason
          ? mergeNotes(appt.notes, `Reporté au ${formatDateStr(newDate)} ${newTime.substring(0, 5)}. Motif: ${reason}`)
          : mergeNotes(appt.notes, `Reporté au ${formatDateStr(newDate)} ${newTime.substring(0, 5)}`),
        updated_at: new Date().toISOString(),
      }).eq('id', appt.id);

      await logAudit('appointment_postpone', 'appointment', appt.id, `${fullName(appt.patient)} → ${newDate} ${newTime}`, {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: `${appt.appointment_date} ${appt.appointment_time}`, new_value: `${newDate} ${newTime}`, reason,
      });
      await logAudit('appointment_create', 'appointment', (newAppt as Appointment).id, `Reporté depuis le ${appt.appointment_date}`);
      setShowPostpone(null);
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (appt: AppointmentWithRelations) => {
    setActionLoading(appt.id);
    try {
      const [{ data: consults }, { data: queue }] = await Promise.all([
        supabase.from('consultations').select('id').eq('appointment_id', appt.id).limit(1),
        supabase.from('waiting_queue').select('id, status').eq('appointment_id', appt.id).limit(1),
      ]);

      if ((consults ?? []).length > 0) {
        alert('Ce rendez-vous a été utilisé dans le workflow médical. Suppression impossible — utilisez l\'annulation à la place.');
        setConfirmDelete(null);
        return;
      }

      if ((queue ?? []).length > 0 && (queue ?? [])[0]?.status !== 'in_consultation') {
        await supabase.from('waiting_queue').delete().eq('appointment_id', appt.id);
      }

      const { error: delErr } = await supabase.from('appointments').delete().eq('id', appt.id);
      if (delErr) { alert(delErr.message); return; }

      await logAudit('appointment_delete', 'appointment', appt.id, fullName(appt.patient), {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: appt.status,
      });
      setConfirmDelete(null);
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnterConsultation = async (appt: AppointmentWithRelations) => {
    setActionLoading(appt.id);
    try {
      await supabase.from('appointments').update({ status: 'in_consultation', updated_at: new Date().toISOString() }).eq('id', appt.id);
      await supabase.from('waiting_queue').update({
        status: 'in_consultation',
        entered_consultation_at: new Date().toISOString(),
        doctor_id: profile?.id,
        updated_at: new Date().toISOString(),
      }).eq('appointment_id', appt.id);
      await logAudit('queue_enter_consultation', 'appointment', appt.id, fullName(appt.patient), {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: 'arrived', new_value: 'in_consultation',
      });
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompleteConsultation = async (appt: AppointmentWithRelations) => {
    setActionLoading(appt.id);
    try {
      await supabase.from('appointments').update({
        status: 'completed',
        completed_by: profile?.id,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', appt.id);
      await supabase.from('waiting_queue').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('appointment_id', appt.id);
      await logAudit('appointment_complete', 'appointment', appt.id, fullName(appt.patient), {
        user: profile?.full_name, role: profile?.role, appointment_id: appt.id, patient_id: appt.patient_id,
        old_value: 'in_consultation', new_value: 'completed',
      });
      loadRows(true); loadCalendar(); loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDetailsAction = (
    action: 'present' | 'no_show' | 'enter_consultation' | 'complete' | 'cancel' | 'postpone' | 'edit' | 'delete',
    appt: AppointmentWithRelations,
  ) => {
    switch (action) {
      case 'present': handlePresent(appt); break;
      case 'no_show': handleNoShow(appt); break;
      case 'enter_consultation': handleEnterConsultation(appt); break;
      case 'complete': handleCompleteConsultation(appt); break;
      case 'cancel': setConfirmCancel(appt); break;
      case 'postpone': setShowPostpone(appt); break;
      case 'edit': setEditing(appt); setShowForm(true); break;
      case 'delete': setConfirmDelete(appt); break;
    }
  };

  const goToPatientFile = (patientId?: string) => {
    if (!patientId || !onNavigate) return;
    onNavigate(`/medical-files?patient=${patientId}`);
  };

  const shiftDate = (dir: number) => {
    if (view === 'day') setCurrentDate((d) => addDays(d, dir));
    else if (view === 'week') setCurrentDate((d) => addDays(d, dir * 7));
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1));
  };

  const periodLabel = view === 'day'
    ? formatLongDateFR(currentDate)
    : view === 'week'
      ? `${formatDateStr(toLocalDateStr(startOfWeek(currentDate)))} — ${formatDateStr(toLocalDateStr(addDays(startOfWeek(currentDate), 6)))}`
      : formatMonthYearFR(currentDate);

  const loadingRows = rowsStatus === 'loading';
  const errorRows = rowsStatus === 'error';
  const total = todayStats.total;

  return (
    <div>
      {/* === EN-TÊTE === */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Rendez-vous
            {refreshing && <RefreshCw className="w-4 h-4 text-gray-300 animate-spin" />}
          </h1>
          <p className="text-gray-500 text-sm mt-1">Gestion des rendez-vous et agenda du cabinet</p>
          <div className="flex items-center gap-2 mt-2">
            <CalendarClock className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-gray-700">{formatLongDateFR(new Date())}</span>
            <button
              onClick={() => { setCurrentDate(new Date()); setDateScope('today'); setStatusScope(null); }}
              className={`text-xs px-2 py-0.5 rounded-md ml-1 transition-colors ${
                isToday(currentDate) && dateScope === 'today' && !statusScope ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Aujourd'hui
            </button>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau rendez-vous
          </button>
        )}
      </div>

      {/* === STATISTIQUES === */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Aujourd'hui" value={todayStats.total} icon={<CalIcon className="w-4 h-4" />} accent="text-gray-700 bg-gray-100" active={dateScope === 'today' && !statusScope} onClick={() => { setDateScope('today'); setStatusScope(null); }} />
        <StatCard label="Programmés" value={todayStats.scheduled} icon={<Clock className="w-4 h-4" />} accent={STATUS_META.scheduled.badge} active={statusScope === 'scheduled'} onClick={() => { setDateScope('today'); setStatusScope('scheduled'); }} />
        <StatCard label="Présents" value={todayStats.arrived} icon={<Check className="w-4 h-4" />} accent={STATUS_META.arrived.badge} active={statusScope === 'arrived'} onClick={() => { setDateScope('today'); setStatusScope('arrived'); }} />
        <StatCard label="En consultation" value={todayStats.inConsultation} icon={<Stethoscope className="w-4 h-4" />} accent={STATUS_META.in_consultation.badge} active={statusScope === 'in_consultation'} onClick={() => { setDateScope('today'); setStatusScope('in_consultation'); }} />
        <StatCard label="Terminés" value={todayStats.completed} icon={<Check className="w-4 h-4" />} accent={STATUS_META.completed.badge} active={statusScope === 'completed'} onClick={() => { setDateScope('today'); setStatusScope('completed'); }} />
      </div>

      {/* === RÉSUMÉ VISUEL DU JOUR === */}
      {total > 0 && (
        <div className="mb-5 bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <p className="text-sm font-medium text-gray-700">{total} rendez-vous aujourd'hui</p>
            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              <LegendDot className="bg-green-500" label={`${todayStats.completed} terminés`} />
              <LegendDot className="bg-amber-500" label={`${todayStats.inConsultation} en consultation`} />
              <LegendDot className="bg-violet-500" label={`${todayStats.arrived} présents`} />
              <LegendDot className="bg-blue-500" label={`${todayStats.scheduled} programmés`} />
            </div>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
            <Segment value={todayStats.completed} total={total} className="bg-green-500" />
            <Segment value={todayStats.inConsultation} total={total} className="bg-amber-500" />
            <Segment value={todayStats.arrived} total={total} className="bg-violet-500" />
            <Segment value={todayStats.scheduled} total={total} className="bg-blue-500" />
          </div>
        </div>
      )}

      {/* === FILTRES / RECHERCHE / VUE === */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((c) => {
            const active = activeChip?.key === c.key;
            return (
              <button
                key={c.key}
                onClick={() => selectChip(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input pl-10 pr-9"
              placeholder="Rechercher un patient, PAT, DM, téléphone, médecin ou motif..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDate(-1)} className="btn-secondary btn-sm p-1.5"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium text-gray-700 min-w-48 text-center capitalize">{periodLabel}</span>
            <button onClick={() => shiftDate(1)} className="btn-secondary btn-sm p-1.5"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <span className="text-xs text-gray-400">
            {debouncedSearch ? `${visible.length} résultat(s)` : `${visible.length} rendez-vous`}
          </span>
        </div>
      </div>

      {/* === CONTENU === */}
      {errorRows ? (
        <div className="card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm font-medium text-red-700">{LOAD_ERROR}</p>
          <button onClick={() => loadRows()} className="btn-secondary btn-sm mt-3">
            <RefreshCw className="w-4 h-4" /> Réessayer
          </button>
        </div>
      ) : view === 'day' ? (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex-wrap gap-2">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" /> Agenda
                <span className="text-xs font-normal text-gray-400">({visible.length})</span>
              </h2>
              <div className="flex items-center gap-2">
                {truncated && <span className="text-xs text-amber-600">Affichage limité aux {MAX_ROWS} premiers rendez-vous</span>}
                <span className="text-xs text-gray-500">Filtre : {activeChip?.label ?? 'Tous'}</span>
              </div>
            </div>

            {loadingRows ? (
              <div>{Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)}</div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
                  <CalIcon className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="text-gray-900 font-semibold">Aucun rendez-vous</h3>
                <p className="text-gray-500 text-sm mt-1 max-w-sm">
                  {debouncedSearch
                    ? 'Aucun rendez-vous ne correspond à cette recherche.'
                    : `Aucun rendez-vous ne correspond au filtre « ${activeChip?.label ?? 'Tous'} ».`}
                </p>
                {canEdit && (
                  <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary btn-sm mt-4">
                    <Plus className="w-4 h-4" /> Nouveau rendez-vous
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visible.map((a) => (
                  <AgendaRow
                    key={a.id}
                    appt={a}
                    showDate={dateScope !== 'today'}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    isDoctorOnly={isDoctorOnly}
                    loading={actionLoading === a.id}
                    openMenu={openMenu}
                    setOpenMenu={setOpenMenu}
                    menuRef={menuRef}
                    onDetails={setDetails}
                    onPatient={goToPatientFile}
                    onPresent={handlePresent}
                    onNoShow={handleNoShow}
                    onPostpone={setShowPostpone}
                    onCancel={setConfirmCancel}
                    onEdit={(x) => { setEditing(x); setShowForm(true); }}
                    onDelete={setConfirmDelete}
                    onEnterConsultation={handleEnterConsultation}
                    onComplete={handleCompleteConsultation}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>

          {!loadingRows && showNotArrived && (
            <div className="card overflow-hidden border-l-4 border-l-blue-400">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                  <UserX className="w-4 h-4 text-blue-500" /> Patients non arrivés
                  <span className="text-xs font-normal text-gray-400">({notArrived.length})</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Rendez-vous du jour encore programmés — à traiter par la réception.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {notArrived.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm font-medium text-gray-500 tabular-nums w-12">{a.appointment_time.substring(0, 5)}</span>
                    <button onClick={() => goToPatientFile(a.patient_id)} className="text-sm font-medium text-gray-900 hover:text-blue-600 flex-1 min-w-0 truncate text-left">
                      {fullName(a.patient)}
                    </button>
                    {canEdit && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handlePresent(a)} disabled={actionLoading === a.id} className="btn-sm bg-green-600 text-white hover:bg-green-700 px-2 py-1 rounded-md text-xs">Présent</button>
                        <button onClick={() => handleNoShow(a)} disabled={actionLoading === a.id} className="btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200 px-2 py-1 rounded-md text-xs">Absent</button>
                        <button onClick={() => setShowPostpone(a)} className="btn-ghost btn-sm text-xs">Reporter</button>
                        <button onClick={() => setConfirmCancel(a)} className="btn-ghost btn-sm text-xs text-red-600">Annuler</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : view === 'week' ? (
        <WeekView
          loading={calStatus === 'loading'}
          error={calStatus === 'error'}
          currentDate={currentDate}
          appointments={calendarVisible}
          onOpenDay={(d) => { setCurrentDate(d); setView('day'); }}
          onDetails={setDetails}
          onRetry={loadCalendar}
        />
      ) : (
        <MonthView
          loading={calStatus === 'loading'}
          error={calStatus === 'error'}
          currentDate={currentDate}
          appointments={calendarVisible}
          onOpenDay={(d) => { setCurrentDate(d); setView('day'); }}
          onDetails={setDetails}
          onRetry={loadCalendar}
        />
      )}

      {/* === MODALES === */}
      {showForm && (
        <AppointmentForm
          appointment={editing}
          doctors={doctors}
          defaultDoctorId={profile?.id}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {showPostpone && (
        <PostponeModal
          appointment={showPostpone}
          doctors={doctors}
          onClose={() => setShowPostpone(null)}
          onPostpone={(date, time, docId, reason) => handlePostpone(showPostpone, date, time, docId, reason)}
        />
      )}

      {details && (
        <AppointmentDetailsModal
          appointment={details}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setDetails(null)}
          onNavigate={(path, patientId) => { onNavigate?.(patientId ? `${path}?patient=${patientId}` : path); }}
          onAction={handleDetailsAction}
        />
      )}

      <ConfirmDialog
        open={!!confirmCancel}
        onClose={() => { setConfirmCancel(null); setCancelReason(''); }}
        onConfirm={() => confirmCancel && handleCancel(confirmCancel, cancelReason || undefined)}
        title="Annuler le rendez-vous"
        message={`Annuler le rendez-vous de ${confirmCancel ? fullName(confirmCancel.patient) : ''} ?`}
        confirmLabel="Annuler"
        danger
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title="Supprimer le rendez-vous"
        message={`Supprimer définitivement le rendez-vous de ${confirmDelete ? fullName(confirmDelete.patient) : ''} ? Le patient et son dossier médical ne seront PAS supprimés.`}
        confirmLabel="Supprimer"
        danger
      />
    </div>
  );
}

// === SOUS-COMPOSANTS ===

function StatCard({ label, value, icon, accent, active, onClick }: {
  label: string; value: number; icon: React.ReactNode; accent: string;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border p-3.5 shadow-sm transition-all hover:shadow-md ${
        active ? 'border-blue-300 ring-1 ring-blue-200' : 'border-gray-100'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 border ${accent}`}>{icon}</div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${className}`} /> {label}
    </span>
  );
}

function Segment({ value, total, className }: { value: number; total: number; className: string }) {
  if (!value || !total) return null;
  return <div className={`${className} transition-all`} style={{ width: `${(value / total) * 100}%` }} />;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-100 animate-pulse">
      <div className="w-14 h-6 bg-gray-100 rounded" />
      <div className="w-10 h-10 bg-gray-100 rounded-xl" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-40 bg-gray-100 rounded" />
        <div className="h-2.5 w-56 bg-gray-100 rounded" />
      </div>
      <div className="h-6 w-24 bg-gray-100 rounded-full" />
      <div className="h-7 w-32 bg-gray-100 rounded-lg" />
    </div>
  );
}

function AgendaRow({ appt, showDate, canEdit, canDelete, isDoctorOnly, loading, openMenu, setOpenMenu, menuRef, onDetails, onPatient, onPresent, onNoShow, onPostpone, onCancel, onEdit, onDelete, onEnterConsultation, onComplete, onNavigate }: {
  appt: AppointmentWithRelations;
  showDate: boolean;
  canEdit: boolean; canDelete: boolean; isDoctorOnly: boolean; loading: boolean;
  openMenu: string | null; setOpenMenu: (v: string | null) => void; menuRef: React.RefObject<HTMLDivElement>;
  onDetails: (a: AppointmentWithRelations) => void;
  onPatient: (id?: string) => void;
  onPresent: (a: AppointmentWithRelations) => void;
  onNoShow: (a: AppointmentWithRelations) => void;
  onPostpone: (a: AppointmentWithRelations) => void;
  onCancel: (a: AppointmentWithRelations) => void;
  onEdit: (a: AppointmentWithRelations) => void;
  onDelete: (a: AppointmentWithRelations) => void;
  onEnterConsultation: (a: AppointmentWithRelations) => void;
  onComplete: (a: AppointmentWithRelations) => void;
  onNavigate?: (path: string) => void;
}) {
  const p = appt.patient;
  const meta = getStatusMeta(appt.status, appt.queue_status);
  const initials = `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase();
  const avatarClass = p?.sex === 'M' ? 'bg-blue-600' : p?.sex === 'F' ? 'bg-pink-600' : 'bg-gray-500';

  return (
    <div className={`flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors ${appt.status === 'cancelled' ? 'opacity-60' : ''}`}>
      <div className="w-20 flex-shrink-0">
        <p className="text-base font-bold text-gray-900 tabular-nums">{appt.appointment_time.substring(0, 5)}</p>
        <p className="text-xs text-gray-400">
          {showDate ? formatDateStr(appt.appointment_date) : `${appt.duration_minutes} min`}
        </p>
      </div>
      <div className={`w-0.5 h-12 rounded-full ${meta.dot} flex-shrink-0`} />
      <button onClick={() => onPatient(appt.patient_id)} className="flex items-center gap-3 flex-1 min-w-0 text-left group">
        <div className={`w-10 h-10 rounded-xl ${avatarClass} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
          {initials || <User className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate">{fullName(p)}</p>
          <p className="text-xs text-gray-500 font-mono truncate">
            {p?.patient_number ?? '—'}
            {p?.medical_file?.file_number ? ` • ${p.medical_file.file_number}` : ''}
          </p>
        </div>
      </button>
      <div className="w-48 flex-shrink-0 hidden xl:block min-w-0">
        <p className="text-sm text-gray-700 flex items-center gap-1.5 truncate">
          <Stethoscope className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          {appt.doctor?.full_name ?? '—'}
        </p>
        <p className="text-xs text-gray-500 truncate" title={appt.reason ?? ''}>{appt.reason || '—'}</p>
      </div>
      <div className="w-36 flex-shrink-0 hidden lg:block">
        <span className={`badge ${meta.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} mr-1.5`} />
          {meta.label}
        </span>
      </div>
      <div className="flex-shrink-0 flex items-center justify-end gap-1.5">
        <button onClick={() => onDetails(appt)} className="btn-secondary btn-sm">
          <FileText className="w-3.5 h-3.5" /> Voir
        </button>

        {canEdit && appt.status === 'scheduled' && (
          <button onClick={() => onPresent(appt)} disabled={loading} className="btn-sm bg-green-600 text-white hover:bg-green-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Présent
          </button>
        )}
        {canEdit && appt.status === 'arrived' && (
          <button onClick={() => onEnterConsultation(appt)} disabled={loading} className="btn-sm bg-amber-600 text-white hover:bg-amber-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
            <Stethoscope className="w-3.5 h-3.5" /> Consulter
          </button>
        )}
        {canEdit && appt.status === 'in_consultation' && (
          <button onClick={() => onComplete(appt)} disabled={loading} className="btn-sm bg-green-600 text-white hover:bg-green-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Terminer
          </button>
        )}
        {appt.status === 'completed' && onNavigate && (
          <button onClick={() => onNavigate(`/invoices?patient=${appt.patient_id}`)} className="btn-sm bg-blue-600 text-white hover:bg-blue-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5" /> Paiement
          </button>
        )}

        {canEdit && ['scheduled', 'arrived'].includes(appt.status) && (
          <div className="relative" ref={openMenu === appt.id ? menuRef : undefined}>
            <button onClick={() => setOpenMenu(openMenu === appt.id ? null : appt.id)} className="btn-ghost btn-sm p-1.5">
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {openMenu === appt.id && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50 animate-slide-up">
                <MenuItem icon={<FileText className="w-4 h-4" />} label="Voir les détails" onClick={() => { setOpenMenu(null); onDetails(appt); }} />
                {appt.status === 'scheduled' && (
                  <>
                    <MenuItem icon={<UserX className="w-4 h-4" />} label="Marquer absent" onClick={() => { setOpenMenu(null); onNoShow(appt); }} />
                    <MenuItem icon={<CalendarClock className="w-4 h-4" />} label="Reporter" onClick={() => { setOpenMenu(null); onPostpone(appt); }} />
                  </>
                )}
                {appt.status === 'arrived' && (
                  <MenuItem icon={<Stethoscope className="w-4 h-4" />} label="Entrer en consultation" onClick={() => { setOpenMenu(null); onEnterConsultation(appt); }} />
                )}
                <MenuItem icon={<Edit2 className="w-4 h-4" />} label="Modifier" onClick={() => { setOpenMenu(null); onEdit(appt); }} />
                <div className="border-t border-gray-100 my-1" />
                <MenuItem icon={<X className="w-4 h-4" />} label="Annuler le rendez-vous" danger onClick={() => { setOpenMenu(null); onCancel(appt); }} />
                {canDelete && !isDoctorOnly && (
                  <MenuItem icon={<Trash2 className="w-4 h-4" />} label="Supprimer" danger onClick={() => { setOpenMenu(null); onDelete(appt); }} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3.5 py-2 text-sm flex items-center gap-2.5 transition-colors ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      {icon} {label}
    </button>
  );
}

function CalendarError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card p-8 text-center">
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p className="text-sm text-red-700">{LOAD_ERROR}</p>
      <button onClick={onRetry} className="btn-secondary btn-sm mt-3"><RefreshCw className="w-4 h-4" /> Réessayer</button>
    </div>
  );
}

function WeekView({ loading, error, currentDate, appointments, onOpenDay, onDetails, onRetry }: {
  loading: boolean; error: boolean; currentDate: Date; appointments: AppointmentWithRelations[];
  onOpenDay: (d: Date) => void; onDetails: (a: AppointmentWithRelations) => void; onRetry: () => void;
}) {
  if (error) return <CalendarError onRetry={onRetry} />;
  const days = weekDays(currentDate);
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d, i) => {
        const key = toLocalDateStr(d);
        const items = appointments.filter((a) => a.appointment_date === key);
        return (
          <div key={i} className={`card flex flex-col min-h-72 ${isToday(d) ? 'ring-2 ring-blue-200' : ''}`}>
            <button onClick={() => onOpenDay(d)} className={`px-2 py-2 border-b border-gray-100 text-center hover:bg-gray-50 transition-colors ${isToday(d) ? 'bg-blue-50' : ''}`}>
              <p className="text-xs font-medium text-gray-500 uppercase">{WEEKDAY_SHORT[i]}</p>
              <p className={`text-lg font-bold ${isToday(d) ? 'text-blue-600' : 'text-gray-900'}`}>{d.getDate()}</p>
              {items.length > 0 && <p className="text-[10px] text-gray-400">{items.length} rdv</p>}
            </button>
            <div className="flex-1 p-1.5 space-y-1.5 overflow-y-auto scrollbar-thin max-h-96">
              {loading ? (
                Array.from({ length: 2 }, (_, k) => <div key={k} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)
              ) : items.length === 0 ? (
                <p className="text-[10px] text-gray-300 text-center pt-3">—</p>
              ) : (
                items.map((a) => {
                  const meta = getStatusMeta(a.status, a.queue_status);
                  return (
                    <button
                      key={a.id}
                      onClick={() => onDetails(a)}
                      className={`w-full text-left rounded-lg border px-2 py-1.5 hover:shadow-sm transition-all ${meta.badge}`}
                    >
                      <p className="text-[11px] font-bold tabular-nums">{a.appointment_time.substring(0, 5)}</p>
                      <p className="text-[11px] font-medium truncate text-gray-800">{fullName(a.patient)}</p>
                      <p className="text-[10px] truncate opacity-80">{a.reason || '—'}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ loading, error, currentDate, appointments, onOpenDay, onDetails, onRetry }: {
  loading: boolean; error: boolean; currentDate: Date; appointments: AppointmentWithRelations[];
  onOpenDay: (d: Date) => void; onDetails: (a: AppointmentWithRelations) => void; onRetry: () => void;
}) {
  if (error) return <CalendarError onRetry={onRetry} />;
  const days = monthGridDays(currentDate);
  const month = currentDate.getMonth();
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-xs font-semibold text-gray-500 uppercase">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const key = toLocalDateStr(d);
          const items = appointments.filter((a) => a.appointment_date === key);
          const outside = d.getMonth() !== month;
          return (
            <div key={i} className={`border-b border-r border-gray-100 min-h-28 p-1.5 ${outside ? 'bg-gray-50/50' : ''}`}>
              <button
                onClick={() => onOpenDay(d)}
                className={`w-6 h-6 rounded-full text-xs font-medium mb-1 flex items-center justify-center transition-colors ${
                  isToday(d) ? 'bg-blue-600 text-white' : outside ? 'text-gray-300 hover:bg-gray-100' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {d.getDate()}
              </button>
              {loading ? (
                <div className="h-4 bg-gray-100 rounded animate-pulse" />
              ) : (
                <div className="space-y-1">
                  {items.slice(0, 3).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onDetails(a)}
                      className="w-full text-left flex items-center gap-1 px-1 py-0.5 rounded hover:bg-gray-50 transition-colors"
                      title={`${a.appointment_time.substring(0, 5)} — ${fullName(a.patient)}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusMeta(a.status, a.queue_status).dot}`} />
                      <span className="text-[10px] text-gray-700 truncate">
                        {a.appointment_time.substring(0, 5)} {fullName(a.patient)}
                      </span>
                    </button>
                  ))}
                  {items.length > 3 && (
                    <button onClick={() => onOpenDay(d)} className="text-[10px] text-blue-600 hover:underline pl-1">
                      +{items.length - 3} autres
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
