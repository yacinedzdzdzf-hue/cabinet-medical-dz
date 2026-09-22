/** Palette du menu latéral pour chaque thème — garantit un contraste lisible dans les deux modes. */
export type SidebarPalette = {
  aside: string;
  divider: string;
  logoText: string;
  logoSub: string;
  groupTitle: string;
  itemIdle: string;
  itemActive: string;
  activeIcon: string;
  activeBar: string;
  muted: string;
  panel: string;
  panelText: string;
  panelSub: string;
  badgeRing: string;
  toggleHover: string;
};

export const SIDEBAR_PALETTES: Record<'light' | 'dark', SidebarPalette> = {
  light: {
    aside: 'bg-white border-r border-gray-200',
    divider: 'border-gray-200',
    logoText: 'text-gray-900',
    logoSub: 'text-gray-500',
    groupTitle: 'text-gray-400',
    itemIdle: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
    itemActive: 'bg-blue-50 text-blue-700',
    activeIcon: 'text-blue-600',
    activeBar: 'bg-gradient-to-b from-blue-500 to-cyan-500',
    muted: 'text-gray-400',
    panel: 'bg-gray-50 border border-gray-200',
    panelText: 'text-gray-900',
    panelSub: 'text-gray-500',
    badgeRing: 'ring-white',
    toggleHover: 'hover:text-gray-900 hover:bg-gray-100',
  },
  dark: {
    aside: 'bg-slate-900 border-r border-slate-800/80',
    divider: 'border-slate-800/80',
    logoText: 'text-white',
    logoSub: 'text-slate-400',
    groupTitle: 'text-slate-500',
    itemIdle: 'text-slate-400 hover:text-white hover:bg-slate-800/70',
    itemActive: 'bg-gradient-to-r from-blue-600/25 to-cyan-500/10 text-white',
    activeIcon: 'text-cyan-300',
    activeBar: 'bg-gradient-to-b from-cyan-400 to-blue-500',
    muted: 'text-slate-500',
    panel: 'bg-slate-800/60 border border-slate-700/50',
    panelText: 'text-white',
    panelSub: 'text-slate-400',
    badgeRing: 'ring-slate-900',
    toggleHover: 'hover:text-white hover:bg-slate-800/70',
  },
};
