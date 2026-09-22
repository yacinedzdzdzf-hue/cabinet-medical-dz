import { supabase } from '@/lib/supabase';
import type { Patient, MedicalFile, Allergy, ChronicCondition, PatientMedication, MedicalHistoryEntry } from '@/types';

export type PatientHeader = {
  patient: Patient | null;
  medicalFile: MedicalFile | null;
};

export type PatientContext = PatientHeader & {
  allergies: Allergy[];
  chronicConditions: ChronicCondition[];
  medications: PatientMedication[];
  histories: MedicalHistoryEntry[];
};

/** Identité + dossier médical (léger). */
export async function loadPatientHeader(patientId: string): Promise<PatientHeader> {
  const [p, f] = await Promise.all([
    supabase.from('patients').select('*').eq('id', patientId).maybeSingle(),
    supabase.from('medical_files').select('*').eq('patient_id', patientId).maybeSingle(),
  ]);
  if (p.error) console.error('[CONSULTATION] patient load error:', p.error);
  return { patient: (p.data as Patient) ?? null, medicalFile: (f.data as MedicalFile) ?? null };
}

/** Contexte médical utile pendant la consultation, chargé depuis la base réelle. */
export async function loadPatientContext(patientId: string): Promise<PatientContext> {
  const [header, al, cc, meds, mh] = await Promise.all([
    loadPatientHeader(patientId),
    supabase.from('allergies').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('chronic_conditions').select('*').eq('patient_id', patientId),
    supabase.from('patient_medications').select('*').eq('patient_id', patientId).eq('is_current', true),
    supabase.from('medical_histories').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
  ]);
  return {
    ...header,
    allergies: (al.data as Allergy[]) ?? [],
    chronicConditions: (cc.data as ChronicCondition[]) ?? [],
    medications: (meds.data as PatientMedication[]) ?? [],
    histories: (mh.data as MedicalHistoryEntry[]) ?? [],
  };
}
