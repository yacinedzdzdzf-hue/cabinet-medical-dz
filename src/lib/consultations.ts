import { fullName, formatTime } from '@/lib/format';
import type { Appointment, Patient } from '@/types';

export type DateFilter = 'today' | 'yesterday' | 'tomorrow' | 'week' | 'month' | 'year' | 'all' | 'custom';
export type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** Statuts réellement portés par la table `consultations` (hors « à accepter », qui vit dans la file). */
export const CONSULTATION_STATUSES: StatusFilter[] = ['in_progress', 'completed', 'cancelled'];

export const DATE_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'yesterday', label: 'Hier' },
  { key: 'tomorrow', label: 'Demain' },
  { key: 'week', label: 'Cette semaine' },
  { key: 'month', label: 'Ce mois' },
  { key: 'year', label: 'Cette année' },
  { key: 'all', label: 'Toutes les dates' },
  { key: 'custom', label: 'Période personnalisée' },
];

export type PendingItem = {
  queue_id: string;
  queue_number: string;
  sent_at: string;
  patient: Patient | null;
  appointment: Appointment | null;
  appointment_doctor_name: string | null;
  medical_file_number: string | null;
};

export type ActiveItem = {
  queue_id: string;
  queue_number: string;
  patient: Patient | null;
  appointment: Appointment | null;
  appointment_doctor_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  consultation_id: string | null;
  entered_at: string | null;
};

export type WorkflowState = {
  pending: PendingItem[];
  active: ActiveItem[];
  counts: { pending: number; in_consultation: number; completed: number; cancelled: number };
};

/**
 * Filtre de date appliqué sur la date réellement affichée : celle du rendez-vous
 * quand il existe, sinon la date de création de la consultation. Bornes locales,
 * jamais UTC, pour rester cohérent avec ce que voit le cabinet.
 */
export function localDateKey(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date effective d'une consultation : rendez-vous réel, sinon création. */
export function consultationEffectiveDate(c: { created_at: string; appointment?: Appointment | null }): string {
  return c.appointment?.appointment_date ?? localDateKey(c.created_at);
}

export function resolveDateRange(filter: DateFilter, customFrom: string, customTo: string): { from?: string; to?: string } {
  const key = (d: Date) => localDateKey(d.toISOString());
  const now = new Date();
  const shift = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  if (filter === 'all') return {};
  if (filter === 'today') return { from: key(now), to: key(shift(1)) };
  if (filter === 'yesterday') return { from: key(shift(-1)), to: key(now) };
  if (filter === 'tomorrow') return { from: key(shift(1)), to: key(shift(2)) };
  if (filter === 'week') {
    const day = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 0 ? -6 : 1 - day));
    return { from: key(start), to: key(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)) };
  }
  if (filter === 'month') return { from: key(new Date(now.getFullYear(), now.getMonth(), 1)), to: key(new Date(now.getFullYear(), now.getMonth() + 1, 1)) };
  if (filter === 'year') return { from: key(new Date(now.getFullYear(), 0, 1)), to: key(new Date(now.getFullYear() + 1, 0, 1)) };
  return { from: customFrom || undefined, to: customTo || undefined };
}

/** Bornes inclusives sur la date effective (comparaison de chaînes AAAA-MM-JJ). */
export function matchesDateRange(effectiveDate: string, range: { from?: string; to?: string }): boolean {
  if (!effectiveDate) return !range.from && !range.to;
  if (range.from && effectiveDate < range.from) return false;
  if (range.to && effectiveDate > range.to) return false;
  return true;
}

/** Recherche locale sur nom, prénom, PAT, DM, téléphone, CIN. */
export function matchesPatientSearch(
  patient: Patient | null | undefined,
  medicalFileNumber: string | null | undefined,
  search: string,
): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return (
    fullName(patient).toLowerCase().includes(q) ||
    (patient?.patient_number ?? '').toLowerCase().includes(q) ||
    (medicalFileNumber ?? '').toLowerCase().includes(q) ||
    (patient?.phone ?? '').toLowerCase().includes(q) ||
    (patient?.cin ?? '').toLowerCase().includes(q)
  );
}

export function consultationStatusLabel(status: string): string {
  if (status === 'in_progress') return 'En consultation';
  if (status === 'completed') return 'Terminée';
  if (status === 'cancelled') return 'Annulée';
  return status;
}

export function consultationStatusBadge(status: string): string {
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'completed') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'cancelled') return 'bg-red-100 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

/** Date et heure affichées : celles du rendez-vous réel, sinon celles de la consultation. */
export function consultationDateTime(consultation: { created_at: string; appointment?: Appointment | null }): { date: string; time: string } {
  const appt = consultation.appointment;
  if (appt) return { date: appt.appointment_date, time: appt.appointment_time?.substring(0, 5) ?? '' };
  return { date: consultation.created_at, time: formatTime(consultation.created_at) };
}

