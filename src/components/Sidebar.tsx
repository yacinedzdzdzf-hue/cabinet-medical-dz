import {
  LayoutDashboard, UsersRound, FolderHeart, CalendarDays, Clock3, Stethoscope,
  Pill, ClipboardList, FileBadge, Files, Activity, WalletCards, CreditCard,
  Receipt, BadgeAlert, ChartNoAxesCombined, MessageSquare, Settings, UserCog,
  DatabaseBackup, History, Lock, LogOut, HeartPulse, PanelLeftClose, PanelLeftOpen,
  User, Server, Sun, Moon, Monitor,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { roleLabel } from '@/lib/constants';
import type { ThemeMode } from '@/lib/theme';
import type { SidebarPalette } from '@/lib/sidebarTheme';
export type { SidebarPalette } from '@/lib/sidebarTheme';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, UsersRound, FolderHeart, CalendarDays, Clock3, Stethoscope,
  Pill, ClipboardList, FileBadge, Files, Activity, WalletCards, CreditCard,
  Receipt, BadgeAlert, ChartNoAxesCombined, MessageSquare, Settings, UserCog,
  DatabaseBackup, History,
};

type NavItem = { label: string; icon: string; path: string };

export function SidebarLogo({ collapsed, palette, onExpand }: { collapsed: boolean; palette: SidebarPalette; onExpand?: () => void }) {
  if (collapsed) {
    return (
      <div className={`flex flex-col items-center gap-1.5 border-b px-2 py-3 ${palette.divider}`}>
        <LogoMark />
        <span className={`font-bold text-[10px] tracking-[0.18em] leading-none ${palette.logoText}`}>CMDZ</span>
        <button
          onClick={onExpand}
          aria-label="Développer le menu"
          title="Développer le menu"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${palette.muted} ${palette.toggleHover}`}
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-3 border-b px-4 py-4 ${palette.divider}`}>
      <LogoMark />
      <div className="min-w-0">
        <p className={`font-bold text-sm tracking-wide leading-tight ${palette.logoText}`}>CMDZ</p>
        <p className={`text-[11px] tracking-wide truncate ${palette.logoSub}`}>Cabinet Médical DZ</p>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="relative flex-shrink-0">
      <div className="absolute inset-0 rounded-xl bg-blue-500/25 blur-md" aria-hidden />
      <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-900/30 ring-1 ring-white/10">
        <HeartPulse className="w-5 h-5 text-white" />
      </div>
    </div>
  );
}

export function SidebarNav({ collapsed, palette, groups, currentPath, onNavigate, badges }: {
  collapsed: boolean;
  palette: SidebarPalette;
  groups: { title: string; items: NavItem[] }[];
  currentPath: string;
  onNavigate: (path: string) => void;
  badges?: Record<string, number>;
}) {
  return (
    <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-sidebar" aria-label="Navigation principale">
      {groups.map((group, gi) => (
        <div key={group.title}>
          {!collapsed ? (
            <p className={`px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${palette.groupTitle}`}>
              {group.title}
            </p>
          ) : gi > 0 ? (
            <div className={`mx-3 my-2 border-t ${palette.divider}`} aria-hidden />
          ) : null}
          <div className="space-y-0.5 px-2">
            {group.items.map((item) => (
              <NavButton
                key={item.path}
                item={item}
                collapsed={collapsed}
                palette={palette}
                active={currentPath === item.path}
                badge={badges?.[item.path]}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function NavButton({ item, collapsed, palette, active, badge, onNavigate }: {
  item: NavItem;
  collapsed: boolean;
  palette: SidebarPalette;
  active: boolean;
  badge?: number;
  onNavigate: (path: string) => void;
}) {
  const Icon = ICONS[item.icon] ?? LayoutDashboard;
  return (
    <button
      onClick={() => onNavigate(item.path)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={`group relative w-full flex items-center rounded-lg transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
        collapsed ? 'justify-center h-11' : 'gap-3 px-3 h-10'
      } ${active ? palette.itemActive : palette.itemIdle}`}
    >
      {active && (
        <span
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full ${palette.activeBar} ${collapsed ? 'h-5' : 'h-6'}`}
          aria-hidden
        />
      )}
      <span className="relative flex-shrink-0">
        <Icon className={`w-[18px] h-[18px] transition-transform duration-200 group-hover:scale-105 ${active ? palette.activeIcon : ''}`} />
        {collapsed && !!badge && (
          <span className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ${palette.badgeRing}`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {!collapsed && (
        <>
          <span className={`text-[13px] truncate flex-1 text-left ${active ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
          {!!badge && (
            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function SidebarToggleButton({ collapsed, palette, onToggle }: {
  collapsed: boolean;
  palette: SidebarPalette;
  onToggle: () => void;
}) {
  const label = collapsed ? 'Développer le menu' : 'Réduire le menu';
  return (
    <button
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="cmdz-sidebar"
      title={`${label} (Ctrl+B)`}
      className={`flex items-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
        collapsed ? 'w-9 h-9 justify-center' : 'w-full h-9 px-3 gap-2'
      } ${palette.muted} ${palette.toggleHover}`}
    >
      {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
      {!collapsed && <span className="text-[12px] font-medium">{label}</span>}
    </button>
  );
}

export function ThemeToggle({ mode, resolved, palette, onChange, collapsed }: {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  palette: SidebarPalette;
  onChange: (m: ThemeMode) => void;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <div className="flex justify-center px-2 py-1">
        <button
          onClick={() => onChange(resolved === 'dark' ? 'light' : 'dark')}
          aria-label={resolved === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
          title={resolved === 'dark' ? 'Thème clair' : 'Thème sombre'}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${palette.muted} ${palette.toggleHover}`}
        >
          {resolved === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    );
  }
  const options: { key: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { key: 'light', icon: <Sun className="w-3.5 h-3.5" />, label: 'Clair' },
    { key: 'dark', icon: <Moon className="w-3.5 h-3.5" />, label: 'Sombre' },
    { key: 'system', icon: <Monitor className="w-3.5 h-3.5" />, label: 'Système' },
  ];
  return (
    <div className="px-3 py-1.5">
      <div className={`flex items-center gap-0.5 rounded-lg p-0.5 ${palette.panel}`}>
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            aria-label={`Thème ${o.label}`}
            title={`Thème ${o.label}`}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              mode === o.key
                ? 'bg-blue-600 text-white'
                : `${palette.panelSub} hover:opacity-80`
            }`}
          >
            {o.icon} {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConnectivityStatus({ online, palette, collapsed }: { online: boolean; palette: SidebarPalette; collapsed: boolean }) {
  return (
    <div
      className={`flex items-center ${collapsed ? 'justify-center py-1' : 'gap-2 px-3 py-1'}`}
      title={online ? 'Serveur connecté' : 'Serveur hors ligne'}
    >
      <Server className={`w-3.5 h-3.5 flex-shrink-0 ${palette.muted}`} />
      <span className="relative flex h-2 w-2 flex-shrink-0">
        {online && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
      </span>
      {!collapsed && (
        <span className={`text-[11px] font-medium ${online ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {online ? 'Serveur connecté' : 'Serveur hors ligne'}
        </span>
      )}
    </div>
  );
}

export function AutoLockBadge({ collapsed, palette, minutes = 15 }: { collapsed: boolean; palette: SidebarPalette; minutes?: number }) {
  return (
    <div
      className={`flex items-center ${palette.muted} ${collapsed ? 'justify-center py-1' : 'gap-2 px-3 py-1'}`}
      title={`Verrouillage automatique : ${minutes} min`}
    >
      <Lock className="w-3.5 h-3.5 flex-shrink-0" />
      {!collapsed && <span className="text-[11px]">Verrouillage auto : {minutes} min</span>}
    </div>
  );
}

export function SidebarUserZone({ collapsed, palette, onOpenSettings }: {
  collapsed: boolean;
  palette: SidebarPalette;
  onOpenSettings: () => void;
}) {
  const { profile, signOut } = useAuth();
  return (
    <div className={`border-t px-2 py-2 ${palette.divider}`}>
      <button
        onClick={signOut}
        aria-label="Déconnexion"
        title="Déconnexion"
        className={`w-full flex items-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
          collapsed ? 'justify-center h-10' : 'gap-3 px-3 h-10'
        } ${palette.muted} ${palette.toggleHover}`}
      >
        <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
        {!collapsed && <span className="text-[13px] font-medium">Déconnexion</span>}
      </button>

      <div className={`rounded-xl mt-2 ${palette.panel} ${collapsed ? 'p-1.5' : 'p-2.5'}`}>
        <button
          onClick={onOpenSettings}
          aria-label="Mon profil et paramètres"
          title={collapsed ? profile?.full_name ?? 'Mon profil' : undefined}
          className={`w-full flex items-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
            collapsed ? 'justify-center py-1' : 'gap-2.5'
          }`}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ring-1 ring-white/20">
            {profile?.full_name?.charAt(0).toUpperCase() ?? 'U'}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <p className={`text-[12px] font-semibold truncate leading-tight ${palette.panelText}`}>{profile?.full_name}</p>
                <p className={`text-[10px] truncate ${palette.panelSub}`}>{roleLabel(profile?.role ?? '')}</p>
              </div>
              <User className={`w-4 h-4 flex-shrink-0 ${palette.muted}`} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
