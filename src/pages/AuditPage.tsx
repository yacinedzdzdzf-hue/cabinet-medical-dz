import { useState, useEffect, useCallback } from 'react';
import { FileClock, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/lib/format';
import { Loading, EmptyState, PageHeader, Badge, Pagination } from '@/components/ui';
import type { AuditLog } from '@/types';

const PAGE_SIZE = 25;

const ACTION_CATEGORIES = [
  { value: 'all', label: 'Toutes les actions' },
  { value: 'patient', label: 'Patients' },
  { value: 'appointment', label: 'Rendez-vous' },
  { value: 'consultation', label: 'Consultations' },
  { value: 'invoice', label: 'Facturation' },
  { value: 'payment', label: 'Paiements' },
  { value: 'user', label: 'Utilisateurs' },
  { value: 'settings', label: 'Paramètres' },
  { value: 'backup', label: 'Sauvegardes' },
  { value: 'queue', label: 'File d\'attente' },
  { value: 'auth', label: 'Authentification' },
];

export default function AuditPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const canAccess = hasRole('ADMIN');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' });

    if (actionFilter !== 'all') {
      query = query.ilike('action', `%${actionFilter}%`);
    }
    if (search.trim()) {
      query = query.or(`action.ilike.%${search}%,user_name.ilike.%${search}%,entity_description.ilike.%${search}%`);
    }
    if (startDate) {
      query = query.gte('created_at', startDate + 'T00:00:00');
    }
    if (endDate) {
      query = query.lte('created_at', endDate + 'T23:59:59');
    }

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    setLogs((data as AuditLog[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page, actionFilter, startDate, endDate]);

  useEffect(() => { if (canAccess) load(); }, [canAccess, load]);

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Journal d’activité" />
        <div className="card p-8 text-center text-gray-500">
          Accès réservé aux administrateurs.
        </div>
      </div>
    );
  }

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Journal d’activité"
        subtitle={`${total} entrée(s) dans le journal`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative max-w-md flex-1 min-w-48">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Rechercher dans le journal..."
            className="input pl-10"
          />
        </div>
        <select
          className="input max-w-48"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
        >
          {ACTION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input
          type="date"
          className="input max-w-40"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          title="Date de début"
        />
        <input
          type="date"
          className="input max-w-40"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          title="Date de fin"
        />
        {(startDate || endDate || actionFilter !== 'all' || search) && (
          <button
            onClick={() => { setSearch(''); setActionFilter('all'); setStartDate(''); setEndDate(''); setPage(1); }}
            className="btn-secondary btn-sm"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={<FileClock className="w-12 h-12" />}
          title="Aucune entrée dans le journal"
          description="Aucune activité ne correspond à vos critères de recherche."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Date / Heure</th>
                  <th className="table-header text-left px-4 py-3">Utilisateur</th>
                  <th className="table-header text-left px-4 py-3">Action</th>
                  <th className="table-header text-left px-4 py-3">Entité</th>
                  <th className="table-header text-left px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 font-medium">{log.user_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-mono text-xs">{log.action}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{log.entity_type ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{log.entity_description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
