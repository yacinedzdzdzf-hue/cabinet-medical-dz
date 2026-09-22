import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, UserCog, Check, X, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { ROLES, roleLabel, roleColor } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader, Badge, ConfirmDialog } from '@/components/ui';
import type { Profile, Role } from '@/types';

export default function UsersPage() {
  const { hasRole, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAccess = hasRole('ADMIN');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error(error);
    setUsers((data as Profile[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [canAccess, load]);

  const callEdgeFunction = async (payload: Record<string, unknown>) => {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/promote-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Erreur ${response.status}`);
    }
    return response.json();
  };

  const handleCreate = async (data: { email: string; password: string; fullName: string; role: Role }) => {
    setSaving(true);
    setError(null);
    try {
      await callEdgeFunction({ action: 'create_user', email: data.email, password: data.password, fullName: data.fullName, role: data.role });
      await logAudit('user_create', 'profile', undefined, data.fullName, { email: data.email, role: data.role });
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de la création');
    }
    setSaving(false);
  };

  const handleUpdate = async (user: Profile, updates: { role: Role; active: boolean }) => {
    setSaving(true);
    setError(null);
    try {
      await callEdgeFunction({ action: 'update_user', targetUserId: user.id, role: updates.role, active: updates.active });
      await logAudit('user_update', 'profile', user.id, user.full_name, { before: { role: user.role, active: user.active }, after: updates });
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de la modification');
    }
    setSaving(false);
  };

  const handleToggleActive = async (user: Profile) => {
    await handleUpdate(user, { role: user.role, active: !user.active });
    setConfirmToggle(null);
  };

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Utilisateurs" />
        <div className="card p-8 text-center text-gray-500">
          Accès réservé aux administrateurs.
        </div>
      </div>
    );
  }

  if (loading) return <Loading />;

  const filtered = users.filter((u) =>
    !search.trim() || u.full_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        subtitle={`${users.length} utilisateur(s)`}
        actions={
          <button onClick={() => { setEditing(null); setError(null); setShowForm(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouvel utilisateur
          </button>
        }
      />

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par nom ou email..."
          className="input pl-10"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<UserCog className="w-12 h-12" />}
          title="Aucun utilisateur trouvé"
          description="Créez un nouvel utilisateur ou modifiez votre recherche."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Nom</th>
                  <th className="table-header text-left px-4 py-3">Email</th>
                  <th className="table-header text-left px-4 py-3">Rôle</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{u.full_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <Badge className={roleColor(u.role)}>{roleLabel(u.role)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={u.active ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                        {u.active ? 'Actif' : 'Inactif'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditing(u); setError(null); setShowForm(true); }} className="btn-ghost btn-sm" title="Modifier">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setConfirmToggle(u)} className="btn-ghost btn-sm" title={u.active ? 'Désactiver' : 'Activer'}>
                          {u.active ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <UserForm
          user={editing}
          error={error}
          saving={saving}
          onClose={() => { setShowForm(false); setEditing(null); setError(null); }}
          onSave={editing ? (updates) => handleUpdate(editing, updates) : handleCreate}
        />
      )}

      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => confirmToggle && handleToggleActive(confirmToggle)}
        title={confirmToggle?.active ? 'Désactiver l\'utilisateur' : 'Activer l\'utilisateur'}
        message={`Voulez-vous vraiment ${confirmToggle?.active ? 'désactiver' : 'activer'} ${confirmToggle?.full_name} ?`}
        confirmLabel={confirmToggle?.active ? 'Désactiver' : 'Activer'}
        danger={confirmToggle?.active}
      />
    </div>
  );
}

function UserForm({ user, error, saving, onClose, onSave }: {
  user: Profile | null;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [form, setForm] = useState({
    email: user?.email ?? '',
    password: '',
    fullName: user?.full_name ?? '',
    role: user?.role ?? 'RECEPTION' as Role,
    active: user?.active ?? true,
  });

  return (
    <Modal open onClose={onClose} title={user ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
        <div>
          <label className="label">Nom complet *</label>
          <input className="input" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </div>
        <div>
          <label className="label">Email *</label>
          <input type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!user} />
        </div>
        {!user && (
          <div>
            <label className="label">Mot de passe *</label>
            <input type="password" className="input" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        )}
        <div>
          <label className="label">Rôle *</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {user && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-5 h-5" />
            <span className="text-sm font-medium text-gray-700">Compte actif</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}
