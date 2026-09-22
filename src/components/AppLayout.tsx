import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Bell, ChevronDown, Menu, X, LogOut, Settings as SettingsIcon, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_GROUPS, roleLabel, roleColor } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { useTheme, readSidebarCollapsed, storeSidebarCollapsed } from '@/lib/theme';
import {
  SidebarLogo, SidebarNav, SidebarToggleButton, ThemeToggle, ConnectivityStatus,
  AutoLockBadge, SidebarUserZone,
} from '@/components/Sidebar';
import { SIDEBAR_PALETTES } from '@/lib/sidebarTheme';
import type { Notification } from '@/types';

type UnreadCounts = { messages: number; notifications: number; waiting: number };

interface LayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function AppLayout({ currentPath, onNavigate, children }: LayoutProps) {
  const { profile, signOut, hasRole } = useAuth();
  const { mode, resolved, setMode } = useTheme();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [counts, setCounts] = useState<UnreadCounts>({ messages: 0, notifications: 0, waiting: 0 });
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => { storeSidebarCollapsed(!prev); return !prev; });
  }, []);

  // Raccourci clavier Ctrl/Cmd + B
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(10);
    const list = (data as Notification[]) ?? [];
    setNotifications(list);
    setCounts((c: UnreadCounts) => ({ ...c, notifications: list.length }));
  }, [profile]);

  const loadUnread = useCallback(async () => {
    if (!profile) return;
    const [messages, waiting] = await Promise.all([
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('recipient_id', profile.id).eq('is_read', false),
      supabase.from('waiting_queue').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    ]);
    setCounts((c: UnreadCounts) => ({ ...c, messages: messages.count ?? 0, waiting: waiting.count ?? 0 }));
  }, [profile]);

  useEffect(() => {
    loadNotifications();
    loadUnread();
    if (!profile) return;
    const channel = supabase
      .channel('layout_badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, () => loadNotifications())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadUnread())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiting_queue' }, () => loadUnread())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadNotifications, loadUnread, profile]);

  const navBadges = useMemo(() => ({
    '/messages': counts.messages,
    '/waiting': counts.waiting,
  }), [counts.messages, counts.waiting]);

  const visibleGroups = useMemo(() => NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.roles) return hasRole(...item.roles);
        if (item.path === '/users' || item.path === '/backups' || item.path === '/audit') return hasRole('ADMIN');
        if (item.path === '/waiting') return hasRole('ADMIN', 'RECEPTION', 'DOCTOR');
        if (item.path === '/medications') return hasRole('ADMIN', 'DOCTOR');
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0), [hasRole]);

  const unreadCount = notifications.length;

  const markAllRead = async () => {
    if (!profile) return;
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', profile.id)
      .eq('is_read', false);
    setNotifications([]);
    setCounts((c: UnreadCounts) => ({ ...c, notifications: 0 }));
  };

  const handleAutoLock = useCallback(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { signOut(); }, 15 * 60 * 1000);
    };
    const events = ['mousedown', 'keydown', 'mousemove', 'touchstart'];
    events.forEach((e) => document.addEventListener(e, reset));
    reset();
    return () => events.forEach((e) => document.removeEventListener(e, reset));
  }, [signOut]);

  useEffect(() => {
    const cleanup = handleAutoLock();
    return cleanup;
  }, [handleAutoLock]);

  const handleNavigate = (path: string) => {
    onNavigate(path);
    setSidebarOpen(false);
  };

  const sidebarWidth = collapsed ? 72 : 270;
  const palette = SIDEBAR_PALETTES[resolved];

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 overflow-hidden">
      {/* === SIDEBAR (desktop) === */}
      <aside
        id="cmdz-sidebar"
        style={{ width: sidebarWidth }}
        className={`hidden lg:flex flex-shrink-0 flex-col transition-[width] duration-200 ease-out overflow-hidden ${palette.aside}`}
        aria-label="Barre de navigation"
      >
        <SidebarLogo collapsed={collapsed} palette={palette} onExpand={() => { setCollapsed(false); storeSidebarCollapsed(false); }} />

        <SidebarNav
          collapsed={collapsed}
          palette={palette}
          groups={visibleGroups}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          badges={navBadges}
        />

        <div className={`border-t py-1.5 space-y-0.5 ${palette.divider}`}>
          <ThemeToggle mode={mode} resolved={resolved} palette={palette} onChange={setMode} collapsed={collapsed} />
          <ConnectivityStatus online={online} palette={palette} collapsed={collapsed} />
          <AutoLockBadge collapsed={collapsed} palette={palette} minutes={15} />
          <div className="px-2 pt-1">
            <SidebarToggleButton collapsed={collapsed} palette={palette} onToggle={toggleSidebar} />
          </div>
        </div>

        <SidebarUserZone collapsed={collapsed} palette={palette} onOpenSettings={() => handleNavigate('/settings')} />
      </aside>

      {/* === DRAWER (mobile / tablette) === */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden animate-fade-in" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[270px] flex flex-col lg:hidden transition-transform duration-200 ease-out ${palette.aside} ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Barre de navigation"
        aria-hidden={!sidebarOpen}
      >
        <div className={`flex items-center border-b ${palette.divider}`}>
          <div className="flex-1"><SidebarLogo collapsed={false} palette={palette} /></div>
          <button onClick={() => setSidebarOpen(false)} aria-label="Fermer le menu" className={`p-2 mr-2 ${palette.muted} ${palette.toggleHover} rounded-lg`}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <SidebarNav
          collapsed={false}
          palette={palette}
          groups={visibleGroups}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          badges={navBadges}
        />
        <div className={`border-t py-1.5 ${palette.divider}`}>
          <ThemeToggle mode={mode} resolved={resolved} palette={palette} onChange={setMode} collapsed={false} />
          <ConnectivityStatus online={online} palette={palette} collapsed={false} />
          <AutoLockBadge collapsed={false} palette={palette} minutes={15} />
        </div>
        <SidebarUserZone collapsed={false} palette={palette} onOpenSettings={() => handleNavigate('/settings')} />
      </aside>

      {/* === MAIN === */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu" className="lg:hidden text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white">
              <Menu className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => { setShowNotifs(!showNotifs); setShowUserMenu(false); }}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
                className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 z-50 animate-slide-up">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                    <span className="font-medium text-sm dark:text-white">Notifications</span>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700">
                        Tout marquer lu
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto scrollbar-thin">
                    {notifications.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-6">Aucune notification</p>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => n.link && handleNavigate(n.link)}>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                          {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifs(false); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-medium">
                  {profile?.full_name?.charAt(0).toUpperCase() ?? 'U'}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{profile?.full_name}</p>
                  <p className="text-xs text-gray-500">{roleLabel(profile?.role ?? '')}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 z-50 animate-slide-up">
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{profile?.full_name}</p>
                    <p className="text-xs text-gray-500">{profile?.email}</p>
                    <span className={`badge mt-2 ${roleColor(profile?.role ?? '')}`}>
                      {roleLabel(profile?.role ?? '')}
                    </span>
                  </div>
                  <button
                    onClick={() => { handleNavigate('/settings'); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    <User className="w-4 h-4" /> Mon profil
                  </button>
                  <button
                    onClick={() => { handleNavigate('/settings'); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    <SettingsIcon className="w-4 h-4" /> Paramètres
                  </button>
                  <button
                    onClick={() => { signOut(); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <LogOut className="w-4 h-4" />
                    Déconnexion
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6">
          <div className="max-w-7xl mx-auto animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
