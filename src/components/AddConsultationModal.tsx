import { useState } from 'react';
import { Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { Modal } from '@/components/ui';
import type { Patient, Consultation, MedicalFile } from '@/types';

export function AddConsultationModal({ patient, onClose, onSaved }: {
  patient: Patient;
  onClose: () => void;
  onSaved: (consultation: Consultation) => void;
}) {
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Consultation>>({
    patient_id: patient.id,
    chief_complaint: '',
    symptoms: '',
    medical_history: '',
    surgical_history: '',
    family_history: '',
    temperature: null,
    blood_pressure_systolic: null,
    blood_pressure_diastolic: null,
    heart_rate: null,
    respiratory_rate: null,
    spo2: null,
    weight: null,
    height: null,
    diagnosis: '',
    icd_code: '',
    treatment: '',
    recommendations: '',
    notes: '',
    follow_up_date: '',
  });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data: medicalFile } = await supabase.from('medical_files').select('id').eq('patient_id', patient.id).maybeSingle();
      const data: Partial<Consultation> = { ...form };
      if (data.temperature !== null) data.temperature = Number(data.temperature) || null;
      if (data.blood_pressure_systolic !== null) data.blood_pressure_systolic = Number(data.blood_pressure_systolic) || null;
      if (data.blood_pressure_diastolic !== null) data.blood_pressure_diastolic = Number(data.blood_pressure_diastolic) || null;
      if (data.heart_rate !== null) data.heart_rate = Number(data.heart_rate) || null;
      if (data.respiratory_rate !== null) data.respiratory_rate = Number(data.respiratory_rate) || null;
      if (data.spo2 !== null) data.spo2 = Number(data.spo2) || null;
      if (data.weight !== null) data.weight = Number(data.weight) || null;
      if (data.height !== null) data.height = Number(data.height) || null;

      const { data: newCons, error: insertErr } = await supabase.from('consultations').insert({
        ...data,
        medical_file_id: (medicalFile as MedicalFile)?.id ?? null,
        doctor_id: profile?.id,
        status: 'in_progress',
      }).select().single();

      if (insertErr) { setError(insertErr.message); setSaving(false); return; }

      await logAudit('consultation_create', 'consultation', (newCons as Consultation).id, `${form.chief_complaint ?? ''} — ${patient.first_name} ${patient.last_name}`);
      onSaved(newCons as Consultation);
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de l\'enregistrement');
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Nouvelle consultation — ${patient.first_name} ${patient.last_name}`} size="xl">
      <div className="space-y-4">
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">
          Patient: <span className="font-medium">{patient.first_name} {patient.last_name}</span> — {patient.patient_number}
        </div>

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
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={submit} disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" /> {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
