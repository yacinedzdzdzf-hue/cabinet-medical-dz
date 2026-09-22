import { useState, useEffect, useCallback } from 'react';
import { BellRing, Check, X, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatDate, fullName } from '@/lib/format';
import { Loading, EmptyState, PageHeader, Badge, Pagination } from '@/components/ui';
import type { FollowUp } from '@/types';

const PAGE_SIZE = 15;

type StatusFilter = 'all' | 'pending' | 'completed' | 'cancelled';

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: 'En attente', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  completed: { label: 'Terminé', className: 'bg-green-100 text-green-700 border-green-200' },
  cancelled: { label: 'Annulé', className: 'bg-red-100 text-red-700 border-red-200' },
};

export default function FollowUpsPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');

  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('follow_ups')
      .select('*, patient:patients(*)', { count: 'exact' });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (search.trim()) {
      query = query.or(`reason.ilike.%${search}%,patient.first_name.ilike.%${search}%,patient.last_name.ilike.%${search}%`);
    }

    query = query
      .order('follow_up_date', { ascending: statusFilter === 'pending' })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    setFollowUps((data as FollowUp[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (fu: FollowUp, status: 'completed' | 'cancelled') => {
    await supabase.from('follow_ups').update({ status }).eq('id', fu.id);
    await logAudit(`followup_${status}`, 'follow_up', fu.id, fullName(fu.patient));
    load();
  };

  if (loading) return <Loading />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Suivi des patients"
        subtitle={`${total} suivi(s)`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative max-w-md flex-1 min-w-48">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Rechercher par patient ou motif..."
            className="input pl-10"
          />
        </div>
        <div className="flex gap-1">
          {(['pending', 'completed', 'cancelled', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            >
              {s === 'pending' ? 'En attente' : s === 'completed' ? 'Terminés' : s === 'cancelled' ? 'Annulés' : 'Tous'}
            </button>
          ))}
        </div>
      </div>

      {followUps.length === 0 ? (
        <EmptyState
          icon={<BellRing className="w-12 h-12" />}
          title="Aucun suivi trouvé"
          description="Aucun suivi ne correspond à vos critères de recherche."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-left px-4 py-3">Date</th>
                  <th className="table-header text-left px-4 py-3">Motif</th>
                  <th className="table-header text-left px-4 py-3">Notes</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {followUps.map((fu) => {
                  const cfg = statusConfig[fu.status] ?? statusConfig.pending;
                  return (
                    <tr key={fu.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(fu.patient)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(fu.follow_up_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{fu.reason || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{fu.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge className={cfg.className}>{cfg.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && fu.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleStatusChange(fu, 'completed')} className="btn-ghost btn-sm" title="Marquer comme terminé">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleStatusChange(fu, 'cancelled')} className="btn-ghost btn-sm" title="Annuler">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
