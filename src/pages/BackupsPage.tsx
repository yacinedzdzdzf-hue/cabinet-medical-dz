import { useState, useEffect, useCallback } from 'react';
import { DatabaseBackup, Download, Calendar, CalendarDays, CalendarRange, HardDrive, Clock, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';
import { Loading, EmptyState, PageHeader, Badge } from '@/components/ui';
import type { Settings, AuditLog } from '@/types';

interface BackupConfig {
  lastBackup?: string;
  nextScheduled?: string;
  storageUsed?: number;
  frequency?: string;
  enabled?: boolean;
}

const BACKUP_ACTIONS = ['backup_manual', 'backup_daily', 'backup_weekly', 'backup_monthly'];

const backupActionLabels: Record<string, string> = {
  backup_manual: 'Sauvegarde manuelle',
  backup_daily: 'Sauvegarde quotidienne',
  backup_weekly: 'Sauvegarde hebdomadaire',
  backup_monthly: 'Sauvegarde mensuelle',
};

export default function BackupsPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<BackupConfig>({});
  const [history, setHistory] = useState<AuditLog[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const canAccess = hasRole('ADMIN');

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsRes, logsRes] = await Promise.all([
      supabase.from('settings').select('*').eq('key', 'backup').maybeSingle(),
      supabase
        .from('audit_logs')
        .select('*')
        .in('action', BACKUP_ACTIONS)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const settingsData = settingsRes.data as Settings | null;
    setConfig((settingsData?.value as BackupConfig) ?? {});
    setHistory((logsRes.data as AuditLog[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [canAccess, load]);

  const runBackup = async (type: 'manual' | 'daily' | 'weekly' | 'monthly') => {
    setRunning(type);
    const action = `backup_${type}`;
    const now = new Date().toISOString();

    // Simulate backup: log to audit_logs
    await logAudit(action, 'backup', undefined, `Sauvegarde ${backupActionLabels[action]}`, {
      timestamp: now,
      type,
      status: 'completed',
    });

    // Calculate next scheduled date
    let nextDate: string | undefined;
    const next = new Date();
    if (type === 'daily') next.setDate(next.getDate() + 1);
    else if (type === 'weekly') next.setDate(next.getDate() + 7);
    else if (type === 'monthly') next.setMonth(next.getMonth() + 1);
    if (type !== 'manual') nextDate = next.toISOString();

    // Update settings
    const newConfig: BackupConfig = {
      ...config,
      lastBackup: now,
      nextScheduled: nextDate,
      storageUsed: (config.storageUsed ?? 0) + 1,
      frequency: type,
    };

    const { data: existing } = await supabase.from('settings').select('*').eq('key', 'backup').maybeSingle();
    if (existing) {
      await supabase.from('settings').update({ value: newConfig as any, updated_at: now }).eq('key', 'backup');
    } else {
      await supabase.from('settings').insert({ key: 'backup', value: newConfig as any });
    }

    setRunning(null);
    load();
  };

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Sauvegardes" />
        <div className="card p-8 text-center text-gray-500">
          Accès réservé aux administrateurs.
        </div>
      </div>
    );
  }

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Sauvegardes" subtitle="Gestion et historique des sauvegardes" />

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Dernière sauvegarde</p>
              <p className="text-sm font-medium text-gray-900">{config.lastBackup ? formatDateTime(config.lastBackup) : 'Jamais'}</p>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Prochaine sauvegarde</p>
              <p className="text-sm font-medium text-gray-900">{config.nextScheduled ? formatDateTime(config.nextScheduled) : 'Non planifiée'}</p>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-50 text-green-600">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Sauvegardes effectuées</p>
              <p className="text-sm font-medium text-gray-900">{config.storageUsed ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Backup actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <button
          onClick={() => runBackup('manual')}
          disabled={running !== null}
          className="card p-5 text-center hover:shadow-md transition-shadow disabled:opacity-50"
        >
          <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600 mx-auto mb-3">
            {running === 'manual' ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
          </div>
          <p className="text-sm font-medium text-gray-900">Sauvegarde manuelle</p>
          <p className="text-xs text-gray-500 mt-1">Lancer immédiatement</p>
        </button>

        <button
          onClick={() => runBackup('daily')}
          disabled={running !== null}
          className="card p-5 text-center hover:shadow-md transition-shadow disabled:opacity-50"
        >
          <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-green-50 text-green-600 mx-auto mb-3">
            {running === 'daily' ? <Loader2 className="w-6 h-6 animate-spin" /> : <Calendar className="w-6 h-6" />}
          </div>
          <p className="text-sm font-medium text-gray-900">Sauvegarde quotidienne</p>
          <p className="text-xs text-gray-500 mt-1">Planifier pour chaque jour</p>
        </button>

        <button
          onClick={() => runBackup('weekly')}
          disabled={running !== null}
          className="card p-5 text-center hover:shadow-md transition-shadow disabled:opacity-50"
        >
          <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-50 text-purple-600 mx-auto mb-3">
            {running === 'weekly' ? <Loader2 className="w-6 h-6 animate-spin" /> : <CalendarDays className="w-6 h-6" />}
          </div>
          <p className="text-sm font-medium text-gray-900">Sauvegarde hebdomadaire</p>
          <p className="text-xs text-gray-500 mt-1">Planifier pour chaque semaine</p>
        </button>

        <button
          onClick={() => runBackup('monthly')}
          disabled={running !== null}
          className="card p-5 text-center hover:shadow-md transition-shadow disabled:opacity-50"
        >
          <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-orange-50 text-orange-600 mx-auto mb-3">
            {running === 'monthly' ? <Loader2 className="w-6 h-6 animate-spin" /> : <CalendarRange className="w-6 h-6" />}
          </div>
          <p className="text-sm font-medium text-gray-900">Sauvegarde mensuelle</p>
          <p className="text-xs text-gray-500 mt-1">Planifier pour chaque mois</p>
        </button>
      </div>

      {/* Backup history */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <DatabaseBackup className="w-4 h-4 text-blue-600" />
          Historique des sauvegardes
        </h2>
        {history.length === 0 ? (
          <EmptyState
            icon={<DatabaseBackup className="w-10 h-10" />}
            title="Aucune sauvegarde"
            description="Lancez votre première sauvegarde pour voir l’historique ici."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Date</th>
                  <th className="table-header text-left px-4 py-3">Type</th>
                  <th className="table-header text-left px-4 py-3">Utilisateur</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDateTime(h.created_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                      {backupActionLabels[h.action] ?? h.action}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{h.user_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-green-100 text-green-700 border-green-200">
                        <CheckCircle className="w-3 h-3 inline mr-1" /> Terminé
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
