/*
 * ConsultationsList — filtres combinables + table de l'historique des consultations.
 * Toutes les valeurs (statuts, médecins, dates) proviennent de la base réelle.
 */

import { RotateCcw, Search, X, FolderHeart, AlertCircle, Stethoscope } from 'lucide-react';
import { fullName, formatDate, formatTime } from '@/lib/format';
import { Badge, Pagination } from '@/components/ui';
import {
  DATE_OPTIONS, consultationStatusBadge, consultationStatusLabel,
  type DateFilter, type StatusFilter,
} from '@/lib/consultations';
import type { Consultation, Profile } from '@/types';

export type ConsultationsFilters = {
  search: string;
  date: DateFilter;
  from: string;
  to: string;
  status: StatusFilter;
  doctor: string;
  page: number;
};

export function ConsultationsList({ consultations, doctors, loading, error, filters, onChange, onOpen, onRetry, onOpenFile }: {
  consultations: Consultation[];
  doctors: Profile[];
  loading: boolean;
  error: boolean;
  filters: ConsultationsFilters;
  onChange: (patch: Partial<ConsultationsFilters>) => void;
  onOpen: (c: Consultation) => void;
  onRetry: () => void;
  onOpenFile?: (patientId: string) => void;
}) {
  const { search, date, from, to, status, doctor, page } = filters;

  return (
    <div>
      {/* === FILTRES === */}
      <div className="card p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input pl-10 pr-9"
              placeholder="Rechercher un patient : nom, prénom, PAT, DM, téléphone, CIN..."
              value={search}
              onChange={(e) => onChange({ search: e.target.value, page: 1 })}
            />
            {search && (
              <button onClick={() => onChange({ search: '', page: 1 })} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => onChange({ search: '', date: 'all', from: '', to: '', status: 'all', doctor: '', page: 1 })}
            className="btn-secondary btn-sm"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser les filtres
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Date</label>
            <select className="input" value={date} onChange={(e) => onChange({ date: e.target.value as DateFilter, page: 1 })}>
              {DATE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Statut</label>
            <select className="input" value={status} onChange={(e) => onChange({ status: e.target.value as StatusFilter, page: 1 })}>
              <option value="all">Tous les statuts</option>
              <option value="pending">À accepter</option>
              <option value="in_progress">En consultation</option>
              <option value="completed">Terminée</option>
              <option value="cancelled">Annulée</option>
            </select>
          </div>
          <div>
            <label className="label">Médecin</label>
            <select className="input" value={doctor} onChange={(e) => onChange({ doctor: e.target.value, page: 1 })}>
              <option value="">Tous les médecins</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </div>
          {date === 'custom' && (
            <>
              <div>
                <label className="label">Du</label>
                <input type="date" className="input" value={from} onChange={(e) => onChange({ from: e.target.value, page: 1 })} />
              </div>
              <div>
                <label className="label">Au</label>
                <input type="date" className="input" value={to} onChange={(e) => onChange({ to: e.target.value, page: 1 })} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Historique des consultations</h2>
        <span className="text-xs text-gray-500">{loading ? 'Chargement…' : error ? '' : `${consultations.length} résultat(s)`}</span>
      </div>

      {error ? (
        <div className="card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm font-medium text-red-700">Impossible de charger les consultations.</p>
          <p className="text-xs text-gray-500 mt-1">Le détail technique de l'erreur est disponible dans la console du navigateur.</p>
          <button onClick={onRetry} className="btn-primary btn-sm mt-4">
            <RotateCcw className="w-4 h-4" /> Réessayer
          </button>
        </div>
      ) : loading ? (
        <div className="card overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 border-b border-gray-100 animate-pulse">
              <div className="h-3 w-20 bg-gray-100 rounded" />
              <div className="h-3 w-40 bg-gray-100 rounded" />
              <div className="h-3 w-24 bg-gray-100 rounded" />
              <div className="h-6 w-24 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
      ) : consultations.length === 0 ? (
        <div className="card p-12 flex flex-col items-center justify-center text-center">
          <Stethoscope className="w-10 h-10 text-gray-300 mb-3" />
          <h3 className="text-gray-900 font-semibold">{status === 'pending' ? 'Aucune consultation à accepter' : 'Aucune consultation'}</h3>
          <p className="text-gray-500 text-sm mt-1 max-w-sm">
            {status === 'pending'
              ? "Les patients à accepter sont affichés dans la section « Patients à accepter » ci-dessus."
              : 'Aucune consultation ne correspond aux critères sélectionnés.'}
          </p>
          <button
            onClick={() => onChange({ search: '', date: 'all', from: '', to: '', status: 'all', doctor: '', page: 1 })}
            className="btn-secondary btn-sm mt-4"
          >
            <RotateCcw className="w-4 h-4" /> Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header text-left px-4 py-3">Date</th>
                  <th className="table-header text-left px-4 py-3">Heure</th>
                  <th className="table-header text-left px-4 py-3">Patient</th>
                  <th className="table-header text-left px-4 py-3">PAT</th>
                  <th className="table-header text-left px-4 py-3">Médecin</th>
                  <th className="table-header text-left px-4 py-3">Motif</th>
                  <th className="table-header text-left px-4 py-3">Diagnostic</th>
                  <th className="table-header text-left px-4 py-3">Statut</th>
                  <th className="table-header text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {consultations.map((c) => {
                  const dateShown = c.appointment ? formatDate(c.appointment.appointment_date) : formatDate(c.created_at);
                  const timeShown = c.appointment?.appointment_time?.substring(0, 5) ?? formatTime(c.created_at);
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(c)}>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{dateShown}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">{timeShown}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(c.patient)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">{c.patient?.patient_number ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{c.doctor?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-48 truncate" title={c.chief_complaint ?? ''}>{c.chief_complaint || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-48 truncate" title={c.diagnosis ?? ''}>{c.diagnosis || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge className={consultationStatusBadge(c.status)}>{consultationStatusLabel(c.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => onOpen(c)} className="btn-ghost btn-sm">Ouvrir</button>
                          {onOpenFile && c.patient_id && (
                            <button onClick={() => onOpenFile(c.patient_id)} className="btn-ghost btn-sm" title="Voir le dossier médical">
                              <FolderHeart className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && consultations.length > 0 && (
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(consultations.length / 15))} onChange={(p) => onChange({ page: p })} />
      )}
    </div>
  );
}
