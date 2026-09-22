import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, User, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fullName } from '@/lib/format';
import { Modal, Badge } from '@/components/ui';
import type { Patient, Appointment, Profile, MedicalFile } from '@/types';
import type { AppointmentWithRelations } from '@/lib/appointments';

/**
 * Recherche patient côté serveur avec debounce.
 * Aucun chargement massif — requêtes ILIKE limitées et numéro de dossier joint.
 */
export function PatientSearch({ selectedPatient, onSelect }: {
  selectedPatient: Patient | null;
  onSelect: (patient: Patient | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [fileNumbers, setFileNumbers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchPatients = useCallback(async (q: string) => {
    setLoading(true);
    let request = supabase
      .from('patients')
      .select('*')
      .eq('status', 'active')
      .order('last_name')
      .limit(20);

    if (q.trim()) {
      request = request.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,patient_number.ilike.%${q}%,phone.ilike.%${q}%,cin.ilike.%${q}%`
      );
    }

    const { data, error } = await request;
    if (error) { console.error('[APPOINTMENTS] patient search error:', error); setLoading(false); return; }

    const patients = (data as Patient[]) ?? [];
    setResults(patients);

    if (patients.length > 0) {
      const patientIds = patients.map((p) => p.id);
      const { data: files } = await supabase
        .from('medical_files')
        .select('patient_id, file_number')
        .in('patient_id', patientIds);
      const fileMap: Record<string, string> = {};
      for (const f of (files ?? []) as MedicalFile[]) fileMap[f.patient_id] = f.file_number;
      setFileNumbers(fileMap);
    }

    setLoading(false);
    setShowResults(true);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(() => searchPatients(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchPatients]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (patient: Patient) => {
    onSelect(patient);
    setQuery('');
    setShowResults(false);
    setShowBrowse(false);
  };

  const loadBrowseList = async () => {
    setShowBrowse(true);
    await searchPatients('');
  };

  if (selectedPatient) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{fullName(selectedPatient)}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedPatient.patient_number}
                {fileNumbers[selectedPatient.id] && ` — ${fileNumbers[selectedPatient.id]}`}
                {selectedPatient.phone && ` — Tél: ${selectedPatient.phone}`}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => { onSelect(null); setFileNumbers({}); }} className="text-gray-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="input pl-10"
            placeholder="Nom, PAT, DM, téléphone, CIN..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (results.length > 0) setShowResults(true); }}
            autoFocus
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <button type="button" onClick={loadBrowseList} className="btn-secondary whitespace-nowrap">
          <FileText className="w-4 h-4" /> Parcourir
        </button>
      </div>

      {showResults && results.length > 0 && (
        <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto scrollbar-thin bg-white shadow-sm">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p)}
              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{fullName(p)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {p.patient_number}
                    {fileNumbers[p.id] && ` — ${fileNumbers[p.id]}`}
                    {p.phone && ` — Tél: ${p.phone}`}
                  </p>
                </div>
                {p.sex && (
                  <Badge className={p.sex === 'M' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-pink-100 text-pink-700 border-pink-200'}>
                    {p.sex === 'M' ? 'H' : 'F'}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && !loading && results.length === 0 && query.trim() && (
        <div className="text-center py-4 text-sm text-gray-400">Aucun patient trouvé pour « {query} »</div>
      )}

      {showBrowse && (
        <Modal open onClose={() => setShowBrowse(false)} title="Liste des patients" size="lg">
          <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border border-gray-200 rounded-lg transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{fullName(p)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.patient_number}
                      {fileNumbers[p.id] && ` — ${fileNumbers[p.id]}`}
                      {p.phone && ` — Tél: ${p.phone}`}
                    </p>
                  </div>
                  {p.sex && (
                    <Badge className={p.sex === 'M' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-pink-100 text-pink-700 border-pink-200'}>
                      {p.sex === 'M' ? 'H' : 'F'}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function AppointmentForm({ appointment, doctors, defaultDoctorId, onClose, onSave }: {
  appointment: AppointmentWithRelations | null;
  doctors: Profile[];
  defaultDoctorId?: string;
  onClose: () => void;
  onSave: (data: Partial<Appointment>) => Promise<void> | void;
}) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(appointment?.patient ?? null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Appointment>>({
    patient_id: appointment?.patient_id ?? '',
    doctor_id: appointment?.doctor_id ?? defaultDoctorId,
    appointment_date: appointment?.appointment_date ?? todayLocal(),
    appointment_time: appointment?.appointment_time ?? '09:00',
    duration_minutes: appointment?.duration_minutes ?? 30,
    reason: appointment?.reason ?? '',
    notes: appointment?.notes ?? '',
  });

  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const handlePatientSelect = (patient: Patient | null) => {
    setSelectedPatient(patient);
    setForm((f) => ({ ...f, patient_id: patient?.id ?? '' }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || saving) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={appointment ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Patient *</label>
          <PatientSearch selectedPatient={selectedPatient} onSelect={handlePatientSelect} />
          {!selectedPatient && (
            <p className="text-xs text-gray-400 mt-1.5">
              Un même patient peut avoir plusieurs rendez-vous : chacun possède son propre identifiant.
            </p>
          )}
        </div>
        <div>
          <label className="label">Médecin</label>
          <select className="input" value={form.doctor_id ?? ''} onChange={(e) => setForm({ ...form, doctor_id: e.target.value || null })}>
            <option value="">—</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" required value={form.appointment_date ?? ''} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Heure *</label>
            <input type="time" className="input" required value={form.appointment_time ?? ''} onChange={(e) => setForm({ ...form, appointment_time: e.target.value })} />
          </div>
          <div>
            <label className="label">Durée (min)</label>
            <input type="number" className="input" min="5" value={form.duration_minutes ?? 30} onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 30 })} />
          </div>
        </div>
        <div>
          <label className="label">Motif</label>
          <input className="input" value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={!selectedPatient || saving} className="btn-primary">
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PostponeModal({ appointment, doctors, onClose, onPostpone }: {
  appointment: AppointmentWithRelations;
  doctors: Profile[];
  onClose: () => void;
  onPostpone: (date: string, time: string, doctorId: string | null, reason: string) => Promise<void> | void;
}) {
  const [newDate, setNewDate] = useState(appointment.appointment_date);
  const [newTime, setNewTime] = useState(appointment.appointment_time);
  const [newDoctorId, setNewDoctorId] = useState(appointment.doctor_id ?? '');
  const [reason, setReason] = useState('');

  return (
    <Modal open onClose={onClose} title="Reporter le rendez-vous">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Reporter le rendez-vous de <span className="font-medium text-gray-900">{fullName(appointment.patient)}</span> du {appointment.appointment_date} à {appointment.appointment_time}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Nouvelle date *</label>
            <input type="date" className="input" required value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Nouvelle heure *</label>
            <input type="time" className="input" required value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Médecin</label>
          <select className="input" value={newDoctorId} onChange={(e) => setNewDoctorId(e.target.value)}>
            <option value="">—</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Motif du report (facultatif)</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: patient indisponible" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={() => onPostpone(newDate, newTime, newDoctorId || null, reason)} className="btn-primary">Confirmer le report</button>
        </div>
      </div>
    </Modal>
  );
}
