import type { Role } from '@/types';

export const ALGERIAN_WILAYAS: string[] = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra',
  'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret',
  'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel', 'Sétif', 'Saïda', 'Skikda',
  'Sidi Bel Abbès', 'Annaba', 'Guelma', 'Constantine', 'Médéa', 'Mostaganem',
  "M’Sila", 'Mascara', 'Ouargla', 'Oran', 'El Bayadh', 'Illizi',
  'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt',
  'El Oued', 'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla',
  'Naâma', 'Aïn Témouchent', 'Ghardaïa', 'Relizane',
];

export const ROLES: { value: Role; label: string; color: string }[] = [
  { value: 'ADMIN', label: 'Administrateur', color: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'DOCTOR', label: 'Médecin', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'RECEPTION', label: 'Réception', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'WAITING_MALE', label: 'Salle d’attente (H)', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'WAITING_FEMALE', label: 'Salle d’attente (F)', color: 'bg-pink-100 text-pink-700 border-pink-200' },
];

export const PAYMENT_METHODS = [
  { value: 'cash' as const, label: 'Espèces' },
  { value: 'card' as const, label: 'Carte' },
  { value: 'guarantee_card' as const, label: 'Carte de garantie sociale' },
];

export const INVOICE_STATUS = [
  { value: 'unpaid' as const, label: 'Non payée', color: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'partially_paid' as const, label: 'Partiellement payée', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'paid' as const, label: 'Payée', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'cancelled' as const, label: 'Annulée', color: 'bg-gray-100 text-gray-500 border-gray-200' },
];

export const CERTIFICATE_TYPES = [
  { value: 'medical' as const, label: 'Certificat médical' },
  { value: 'sick_leave' as const, label: 'Congé maladie' },
  { value: 'fitness' as const, label: 'Aptitude' },
  { value: 'aptitude' as const, label: 'Aptitude sportive' },
  { value: 'non_contraindication' as const, label: 'Non-contre-indication' },
  { value: 'custom' as const, label: 'Personnalisé' },
];

export const DOCUMENT_TYPES = [
  { value: 'xray' as const, label: 'Radio' },
  { value: 'radiography' as const, label: 'Radiographie' },
  { value: 'lab_result' as const, label: 'Résultat d’analyse' },
  { value: 'report' as const, label: 'Compte-rendu' },
  { value: 'imaging' as const, label: 'Imagerie' },
  { value: 'image' as const, label: 'Image' },
  { value: 'certificate' as const, label: 'Certificat' },
  { value: 'administrative' as const, label: 'Document administratif' },
  { value: 'other' as const, label: 'Autre' },
];

export type NavRole = 'ADMIN' | 'DOCTOR' | 'RECEPTION';

/** Entrée de menu, avec les rôles autorisés. Sans restriction : visible par tous. */
export type NavEntry = { label: string; icon: string; path: string; roles?: NavRole[] };

export const NAV_GROUPS: { title: string; items: NavEntry[] }[] = [
  {
    title: 'Principal',
    items: [
      { label: 'Tableau de bord', icon: 'LayoutDashboard', path: '/' },
      { label: 'Patients', icon: 'UsersRound', path: '/patients' },
      { label: 'Dossiers médicaux', icon: 'FolderHeart', path: '/medical-files' },
      { label: 'Rendez-vous', icon: 'CalendarDays', path: '/appointments' },
      { label: 'Salle d’attente', icon: 'Clock3', path: '/waiting' },
    ],
  },
  {
    title: 'Médical',
    items: [
      { label: 'Consultations', icon: 'Stethoscope', path: '/consultations' },
      { label: 'Médicaments', icon: 'Pill', path: '/medications' },
      { label: 'Ordonnances', icon: 'ClipboardList', path: '/prescriptions', roles: ['ADMIN', 'DOCTOR'] },
      { label: 'Certificats', icon: 'FileBadge', path: '/certificates' },
      { label: 'Documents médicaux', icon: 'Files', path: '/documents' },
      { label: 'Suivi', icon: 'Activity', path: '/follow-ups' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Facturation', icon: 'WalletCards', path: '/invoices' },
      { label: 'Paiements', icon: 'CreditCard', path: '/payments' },
      { label: 'Reçus', icon: 'Receipt', path: '/receipts' },
      { label: 'Dettes', icon: 'BadgeAlert', path: '/debts' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Rapports', icon: 'ChartNoAxesCombined', path: '/reports' },
      { label: 'Messages', icon: 'MessageSquare', path: '/messages' },
      { label: 'Paramètres', icon: 'Settings', path: '/settings' },
      { label: 'Utilisateurs', icon: 'UserCog', path: '/users' },
      { label: 'Sauvegardes', icon: 'DatabaseBackup', path: '/backups' },
      { label: 'Journal d’activité', icon: 'History', path: '/audit' },
    ],
  },
];

export type NavItem = { label: string; icon: string; path: string };

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

export function roleColor(role: string): string {
  return ROLES.find((r) => r.value === role)?.color ?? 'bg-gray-100 text-gray-700 border-gray-200';
}
