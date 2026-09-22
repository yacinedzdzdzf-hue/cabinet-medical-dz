import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'cmdz-theme';

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

/** Thème clair / sombre / système, mémorisé et appliqué à la racine du document. */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => { applyTheme(mode); }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(THEME_KEY, next);
    setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setMode(resolveTheme(mode) === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  return { mode, resolved: resolveTheme(mode), setMode, toggle };
}

const SIDEBAR_KEY = 'cmdz-sidebar-collapsed';

export function readSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
}

export function storeSidebarCollapsed(collapsed: boolean) {
  localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open');
}
