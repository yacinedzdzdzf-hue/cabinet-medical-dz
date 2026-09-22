export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '0 DA';
  return new Intl.NumberFormat('fr-DZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount) + ' DA';
}

/**
 * Une valeur date seule (« 2026-10-01 », colonne SQL de type date) est
 * interprétée par `new Date()` comme minuit UTC. Sous un fuseau à décalage
 * négatif, l'affichage reculerait d'un jour. On la construit donc en heure
 * locale. Les horodatages complets gardent leur traitement normal.
 */
function parseLocalDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  return parseLocalDate(date).toLocaleDateString('fr-FR');
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTimeOnly(time: string | null | undefined): string {
  if (!time) return '—';
  return time.substring(0, 5);
}

export function calculateAge(dateOfBirth: string | null | undefined): number | string {
  if (!dateOfBirth) return '—';
  const today = new Date();
  const birth = new Date(dateOfBirth);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function sexLabel(sex: string | null | undefined): string {
  if (sex === 'M') return 'Homme';
  if (sex === 'F') return 'Femme';
  return '—';
}

export function fullName(p: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!p) return '—';
  return `${p.first_name || ''} ${p.last_name || ''}`.trim();
}
