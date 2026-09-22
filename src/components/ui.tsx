import { type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function Loading({ label = 'Chargement...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
      <span className="ml-2 text-gray-500 text-sm">{label}</span>
    </div>
  );
}

export function FullPageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        <p className="text-gray-500 text-sm">Chargement...</p>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-gray-300">{icon}</div>}
      <h3 className="text-gray-900 font-medium">{title}</h3>
      {description && <p className="text-gray-500 text-sm mt-1 max-w-md">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-3">
        <span className="text-red-600 text-xl">!</span>
      </div>
      <p className="text-red-700 text-sm font-medium">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary btn-sm mt-3">Réessayer</button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md' }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${sizes[size]} max-h-[90vh] flex flex-col animate-slide-up`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1 scrollbar-thin">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmer', danger }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600">{message}</p>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={danger ? 'btn-danger btn-sm' : 'btn-primary btn-sm'}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`badge ${className ?? ''}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Rechercher...' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input max-w-xs"
    />
  );
}

export function Pagination({ page, totalPages, onChange }: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary btn-sm"
      >
        Précédent
      </button>
      <span className="text-sm text-gray-600 px-3">
        Page {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="btn-secondary btn-sm"
      >
        Suivant
      </button>
    </div>
  );
}
