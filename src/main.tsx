import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { applyTheme } from '@/lib/theme';

applyTheme((localStorage.getItem('cmdz-theme') as 'light' | 'dark' | 'system' | null) ?? 'system');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
