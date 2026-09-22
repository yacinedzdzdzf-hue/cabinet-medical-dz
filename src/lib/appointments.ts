import type { Appointment, Patient, Profile, MedicalFile } from '@/types';

export type AppointmentWithRelations = Appointment & {
  patient: (Patient & { medical_file?: MedicalFile | null }) | null;
  doctor: Profile | null;
  queue_status?: string | null;
  queue_entered_at?: string | null;
};

export type StatusMeta = { label: string; badge: string; dot: string };

/**
 * Statuts visuels. « waiting » et « called » proviennent de la file d'attente
 * et ne remplacent le statut du rendez-vous que lorsque celui-ci est « arrived ».
 */
export const STATUS_META: Record<string, StatusMeta> = {
  scheduled: { label: 'Programmé', badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  arrived: { label: 'Présent', badge: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  waiting: { label: 'En attente', badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  called: { label: 'Appelé', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
  in_consultation: { label: 'En consultation', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  completed: { label: 'Terminé', badge: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  no_show: { label: 'Absent', badge: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' },
  cancelled: { label: 'Annulé', badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  postponed: { label: 'Reporté', badge: 'bg-orange-50 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
};

const FALLBACK: StatusMeta = { label: 'Inconnu', badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' };

export function getStatusMeta(appointmentStatus: string, queueStatus?: string | null): StatusMeta {
  if (appointmentStatus === 'arrived' && (queueStatus === 'waiting' || queueStatus === 'called')) {
    return STATUS_META[queueStatus] ?? FALLBACK;
  }
  return STATUS_META[appointmentStatus] ?? FALLBACK;
}

// === Dates locales (jamais UTC) ===

export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromLocalDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDateStr(s: string | null | undefined): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  return addDays(x, day === 0 ? -6 : 1 - day);
}

export function weekDays(d: Date): Date[] {
  const s = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export function monthGridDays(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

export function formatLongDateFR(d: Date): string {
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatMonthYearFR(d: Date): string {
  const s = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Ajoute une ligne d'historique aux notes sans dupliquer une ligne déjà présente. */
export function mergeNotes(existing: string | null | undefined, line: string): string {
  const base = (existing ?? '').trim();
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base}\n${line}`;
}
