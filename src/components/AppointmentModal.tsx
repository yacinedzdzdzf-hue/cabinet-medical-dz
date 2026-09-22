import { useState, useEffect } from 'react';
import { Calendar, User, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName, formatDate, formatTimeOnly } from '@/lib/format';
import { Modal, Badge } from '@/components/ui';
import type { Patient, Appointment, Profile, MedicalFile } from '@/types';

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Programmé', arrived: 'Présent', no_show: 'Absent',
  cancelled: 'Annulé', completed: 'Terminé', postponed: 'Reporté', in_consultation: 'En consultation',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-600 border-gray-200',
  arrived: 'bg-blue-100 text-blue-700 border-blue-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
  postponed: 'bg-amber-100 text-amber-700 border-amber-200',
  in_consultation: 'bg-purple-100 text-purple-700 border-purple-200',
  no_show: 'bg-orange-100 text-orange-700 border-orange-200',
};

export function AppointmentModal({
  patient,
  medicalFile,
  onClose,
  onCreated,
}: {
  patient: Patient;
  medicalFile?: MedicalFile | null;
  onClose: () => void;
  onCreated: (appt: Appointment) => void;
}) {
  const { profile } = useAuth();
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [form, setForm] = useState({
    doctor_id: '',
    appointment_date: new Date().toISOString().split('T')[0],
    appointment_time: '09:00',
    duration_minutes: 30,
    reason: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'DOCTOR').eq('active', true).then(({ data }) => {
      setDoctors((data as Profile[]) ?? []);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!form.appointment_date || !form.appointment_time) {
        setError('Date et heure obligatoires');
        setSaving(false);
        return;
      }
      const { data, error: insertErr } = await supabase.from('appointments').insert({
        patient_id: patient.id,
        doctor_id: form.doctor_id || null,
        appointment_date: form.appointment_date,
        appointment_time: form.appointment_time,
        duration_minutes: form.duration_minutes,
        reason: form.reason || null,
        notes: form.notes || null,
        status: 'scheduled',
      }).select().single();

      if (insertErr) throw insertErr;

      await logAudit('APPOINTMENT_CREATED', 'appointment', (data as Appointment).id,
        `${patient.patient_number} — ${fullName(patient)} — ${form.appointment_date} ${form.appointment_time}`, {
          user: profile?.full_name, role: profile?.role, patient_id: patient.id,
          pat: patient.patient_number, appointment_id: (data as Appointment).id,
          date: form.appointment_date, time: form.appointment_time,
        });

      onCreated(data as Appointment);
      onClose();
    } catch (e: any) {
      console.error('[APPOINTMENT] creation error:', e);
      setError('Impossible de créer le rendez-vous. Veuillez vérifier la connexion au serveur et réessayer.');
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="Prendre rendez-vous" size="md">
      <form onSubmit={submit} className="space-y-4">
        {/* Patient — read only */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{fullName(patient)}</p>
              <p className="text-xs text-gray-500">
                {patient.patient_number}
                {medicalFile?.file_number && ` — ${medicalFile.file_number}`}
                {patient.phone && ` — Tél: ${patient.phone}`}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        <div>
          <label className="label">Médecin</label>
          <select className="input" value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}>
            <option value="">—</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" required value={form.appointment_date} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Heure *</label>
            <input type="time" className="input" required value={form.appointment_time} onChange={(e) => setForm({ ...form, appointment_time: e.target.value })} />
          </div>
          <div>
            <label className="label">Durée (min)</label>
            <input type="number" className="input" min="5" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 30 })} />
          </div>
        </div>

        <div>
          <label className="label">Motif</label>
          <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <div className="flex items-center justify-between">
          <Badge className={STATUS_COLORS.scheduled}>{STATUS_LABELS.scheduled}</Badge>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// === Next appointment badge for patient list ===
export function NextAppointmentBadge({ patientId, onNavigate }: {
  patientId: string;
  onNavigate: (path: string) => void;
}) {
  const [appt, setAppt] = useState<Appointment & { doctor: Profile | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    supabase
      .from('appointments')
      .select('*, doctor:profiles(*)')
      .eq('patient_id', patientId)
      .gte('appointment_date', today)
      .in('status', ['scheduled', 'postponed'])
      .order('appointment_date')
      .order('appointment_time')
      .limit(1)
      .then(({ data }) => {
        setAppt((data as (Appointment & { doctor: Profile | null })[])?.[0] ?? null);
        setLoading(false);
      });
  }, [patientId]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`next_appt_${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `patient_id=eq.${patientId}` }, () => {
        const today = new Date().toISOString().split('T')[0];
        supabase
          .from('appointments')
          .select('*, doctor:profiles(*)')
          .eq('patient_id', patientId)
          .gte('appointment_date', today)
          .in('status', ['scheduled', 'postponed'])
          .order('appointment_date')
          .order('appointment_time')
          .limit(1)
          .then(({ data }) => setAppt((data as (Appointment & { doctor: Profile | null })[])?.[0] ?? null));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [patientId]);

  if (loading) return <span className="text-xs text-gray-300">...</span>;
  if (!appt) return <span className="text-sm text-gray-400">—</span>;

  return (
    <button
      onClick={() => onNavigate('/appointments')}
      className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
      title={appt.doctor?.full_name ? `Dr. ${appt.doctor.full_name}` : 'Médecin non assigné'}
    >
      <Calendar className="w-3 h-3" />
      {formatDate(appt.appointment_date)} — {formatTimeOnly(appt.appointment_time)}
    </button>
  );
}
