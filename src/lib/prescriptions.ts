import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import type { Prescription, PrescriptionItem } from '@/types';

/**
 * Accès aux ordonnances.
 *
 * Le système d'ordonnances est unique : ces fonctions servent toutes les entrées
 * (dossier médical, consultation, page Ordonnances) et le même éditeur A5.
 */

export type EditableItem = {
  key: string;
  medication_id: string | null;
  name: string;
  dci: string;
  strength: string;
  form: string;
  dose: string;
  frequency: string;
  duration: string;
  route: string;
  timing: string;
  instructions: string;
  qsp: string;
};

let keyCounter = 0;
export function newItemKey(): string {
  keyCounter += 1;
  return `item-${keyCounter}`;
}

export function emptyItem(): EditableItem {
  return {
    key: newItemKey(),
    medication_id: null, name: '', dci: '', strength: '', form: '',
    dose: '', frequency: '', duration: '', route: '', timing: '', instructions: '', qsp: '',
  };
}

export function toEditable(item: PrescriptionItem): EditableItem {
  return {
    key: item.id || newItemKey(),
    medication_id: item.medication_id,
    name: item.name ?? '',
    dci: item.dci ?? '',
    strength: item.strength ?? '',
    form: item.form ?? '',
    dose: item.dose ?? '',
    frequency: item.frequency ?? '',
    duration: item.duration ?? '',
    route: item.route ?? '',
    timing: item.timing ?? '',
    instructions: item.instructions ?? '',
    qsp: item.qsp ?? '',
  };
}

/** Lignes réellement prescrites : une ligne sans nom est ignorée. */
export function isFilled(item: EditableItem): boolean {
  return item.name.trim().length > 0;
}

/**
 * Prochain numéro d'ordonnance, calculé côté base (usage multi-PC).
 * Renvoie null si le serveur ne peut pas le fournir : on n'invente jamais un
 * numéro, car il pourrait entrer en collision avec une ordonnance existante.
 */
export async function nextPrescriptionNumber(): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_prescription_number');
  if (error) {
    console.error('[ORDONNANCES] numéro indisponible:', error);
    return null;
  }
  return (data as string) || null;
}

export async function loadPrescriptionItems(prescriptionId: string): Promise<PrescriptionItem[]> {
  const { data, error } = await supabase
    .from('prescription_items')
    .select('*')
    .eq('prescription_id', prescriptionId)
    .order('sort_order');
  if (error) {
    console.error('[ORDONNANCES] chargement des lignes:', error);
    return [];
  }
  return (data as PrescriptionItem[]) ?? [];
}

export type SavePrescriptionInput = {
  id: string | null;
  patientId: string;
  doctorId: string | null;
  consultationId: string | null;
  appointmentId?: string | null;
  notes: string;
  items: EditableItem[];
  /** Nom imprimé sur l'ordonnance (copie, le patient n'est pas modifié). */
  patientDisplayName: string | null;
  /** Date choisie par le médecin, au format AAAA-MM-JJ. */
  prescriptionDate: string | null;
};

/** Contrôles communs avant écriture : date et nom imprimé. */
function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeName(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type SaveResult =
  | { ok: true; prescriptionId: string; number: string }
  | { ok: false; message: string };

/** Message affiché lorsqu'une écriture est refusée par les droits d'accès. */
export const WRITE_DENIED_MESSAGE =
  "Vous n'avez pas les autorisations nécessaires pour modifier cette ordonnance.";

/**
 * Une écriture refusée par la base peut revenir sans erreur mais sans avoir
 * touché la moindre ligne (0 ligne affectée). Sans ce contrôle, l'application
 * annoncerait « Enregistré » alors que rien n'a été écrit.
 */
function isDenied(error: { code?: string; message?: string } | null, affected: number): boolean {
  if (error) {
    const code = error.code ?? '';
    const message = error.message ?? '';
    return code === '42501' || code === 'PGRST301' || message.includes('row-level security')
      || message.includes('permission denied');
  }
  return affected === 0;
}

/** Lignes enregistrées, dans l'ordre affiché. */
function itemsPayload(prescriptionId: string, items: EditableItem[]) {
  return items.filter(isFilled).map((item, index) => ({
    prescription_id: prescriptionId,
    medication_id: item.medication_id,
    name: item.name.trim(),
    dci: item.dci.trim() || null,
    strength: item.strength.trim() || null,
    form: item.form.trim() || null,
    dose: item.dose.trim() || null,
    frequency: item.frequency.trim() || null,
    duration: item.duration.trim() || null,
    route: item.route.trim() || null,
    timing: item.timing.trim() || null,
    instructions: item.instructions.trim() || null,
    qsp: item.qsp.trim() || null,
    sort_order: index,
  }));
}

/**
 * Enregistre l'ordonnance : mise à jour si elle existe, création sinon.
 * Les lignes sont remplacées en bloc pour refléter exactement ce que le médecin
 * voit à l'écran (ajout, modification, suppression).
 */
export async function savePrescription(input: SavePrescriptionInput): Promise<SaveResult> {
  const rows = itemsPayload(input.id ?? '', input.items);

  if (input.id) {
    const { data, error } = await supabase
      .from('prescriptions')
      .update({
        notes: input.notes.trim() || null,
        patient_display_name: normalizeName(input.patientDisplayName),
        prescription_date: normalizeDate(input.prescriptionDate),
      })
      .eq('id', input.id)
      .select('id, prescription_number');
    if (error || !data || data.length === 0) {
      if (isDenied(error, data?.length ?? 0)) {
        return { ok: false, message: WRITE_DENIED_MESSAGE };
      }
      console.error('[ORDONNANCES] mise à jour:', error);
      return { ok: false, message: "Impossible d'enregistrer les modifications de l'ordonnance." };
    }

    // Les anciennes lignes sont retirées pour refléter exactement l'écran.
    // Le nombre de lignes supprimées est contrôlé : un refus doit être signalé.
    const { error: delError, count: delCount } = await supabase
      .from('prescription_items')
      .delete({ count: 'exact' })
      .eq('prescription_id', input.id);
    if (delError || (delCount ?? 0) === 0) {
      if (isDenied(delError, delCount ?? 0)) {
        return { ok: false, message: WRITE_DENIED_MESSAGE };
      }
      console.error('[ORDONNANCES] suppression des lignes:', delError);
      return { ok: false, message: "Impossible d'enregistrer les modifications de l'ordonnance." };
    }

    if (rows.length > 0) {
      const { error: insError } = await supabase
        .from('prescription_items')
        .insert(itemsPayload(input.id, input.items));
      if (insError) {
        if (isDenied(insError, 0)) {
          return { ok: false, message: WRITE_DENIED_MESSAGE };
        }
        console.error('[ORDONNANCES] écriture des lignes:', insError);
        return { ok: false, message: "Impossible d'enregistrer les médicaments." };
      }
    }

    const updated = data[0] as { id: string; prescription_number: string };
    await logAudit('prescription_update', 'prescription', input.id, updated.prescription_number);
    return { ok: true, prescriptionId: updated.id, number: updated.prescription_number };
  }

  const number = await nextPrescriptionNumber();
  if (!number) {
    return { ok: false, message: "Impossible d'obtenir un numéro d'ordonnance. Vérifiez votre connexion." };
  }

  const { data: medicalFile } = await supabase
    .from('medical_files').select('id').eq('patient_id', input.patientId).maybeSingle();

  const { data, error } = await supabase
    .from('prescriptions')
    .insert({
      prescription_number: number,
      patient_id: input.patientId,
      medical_file_id: (medicalFile as { id: string } | null)?.id ?? null,
      consultation_id: input.consultationId,
      doctor_id: input.doctorId,
      notes: input.notes.trim() || null,
      patient_display_name: normalizeName(input.patientDisplayName),
      prescription_date: normalizeDate(input.prescriptionDate),
    })
    .select('id, prescription_number')
    .single();

  if (error || !data) {
    if (isDenied(error, 0)) {
      return { ok: false, message: WRITE_DENIED_MESSAGE };
    }
    console.error('[ORDONNANCES] création:', error);
    return { ok: false, message: "Impossible d'enregistrer l'ordonnance." };
  }

  const created = data as Prescription;
  if (rows.length > 0) {
    const { error: insError } = await supabase
      .from('prescription_items')
      .insert(itemsPayload(created.id, input.items));
    if (insError) {
      if (isDenied(insError, 0)) {
        return { ok: false, message: WRITE_DENIED_MESSAGE };
      }
      console.error('[ORDONNANCES] écriture des lignes:', insError);
      return { ok: false, message: "L'ordonnance est créée mais les médicaments n'ont pas pu être enregistrés." };
    }
  }

  await logAudit('prescription_create', 'prescription', created.id, created.prescription_number);
  return { ok: true, prescriptionId: created.id, number: created.prescription_number };
}

/** Duplique une ordonnance existante vers aujourd'hui, avec les mêmes lignes. */
export async function duplicatePrescription(
  source: Prescription,
  items: PrescriptionItem[],
  doctorId: string | null,
): Promise<SaveResult> {
  const editable = items.map(toEditable);
  return savePrescription({
    id: null,
    patientId: source.patient_id,
    doctorId,
    consultationId: source.consultation_id,
    notes: source.notes ?? '',
    items: editable,
    patientDisplayName: source.patient_display_name,
    prescriptionDate: null,
  });
}

export async function deletePrescription(id: string): Promise<string | null> {
  const { error, count } = await supabase.from('prescriptions').delete({ count: 'exact' }).eq('id', id);
  if (error || (count ?? 0) === 0) {
    if (isDenied(error, count ?? 0)) {
      return "Vous n'avez pas les autorisations nécessaires pour supprimer cette ordonnance.";
    }
    console.error('[ORDONNANCES] suppression:', error);
    return "Impossible de supprimer l'ordonnance.";
  }
  await logAudit('prescription_delete', 'prescription', id);
  return null;
}
