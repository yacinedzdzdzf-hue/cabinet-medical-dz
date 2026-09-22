/*
 * ConsultationAcceptancePanel — bloc « Patients à accepter » de la page Consultations.
 *
 * Le patient a été envoyé depuis la salle d'attente. Le médecin l'accepte ici :
 * c'est la seule action qui ouvre réellement la consultation.
 * En cas de concurrence, le serveur refuse la seconde prise en charge.
 */

import { Loader2, CheckCircle2, FolderHeart, Undo2, UserX, AlertCircle } from 'lucide-react';
import { fullName, sexLabel, calculateAge, formatDate, formatTime } from '@/lib/format';
import type { PendingItem } from '@/lib/consultations';

export function ConsultationAcceptancePanel({ items, loading, canAccept, acceptingId, returningId, error, onAccept, onReturn, onOpenFile }: {
  items: PendingItem[];
  loading: boolean;
  canAccept: boolean;
  acceptingId: string | null;
  returningId: string | null;
  error?: string | null;
  onAccept: (item: PendingItem) => void;
  onReturn: (item: PendingItem) => void;
  onOpenFile?: (patientId: string) => void;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold text-gray-900">Patients à accepter</h2>
        {!loading && <span className="badge bg-cyan-100 text-cyan-700 border-cyan-200">{items.length}</span>}
        <span className="text-xs text-gray-400 ml-1">Envoyés depuis la salle d'attente — en attente d'un médecin</span>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 2 }, (_, i) => <div key={i} className="card h-36 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-6 text-center">
          <UserX className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            Aucun patient en attente d'acceptation. Les patients envoyés depuis la salle d'attente apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((item) => {
            const p = item.patient;
            const initials = `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase();
            const avatarClass = p?.sex === 'M' ? 'bg-blue-600' : p?.sex === 'F' ? 'bg-pink-600' : 'bg-gray-500';
            const busy = acceptingId === item.queue_id || returningId === item.queue_id;
            return (
              <div key={item.queue_id} className="card p-4 border-l-4 border-l-cyan-400">
                <div className="flex items-start gap-3">
                  <div className={`w-11 h-11 rounded-xl ${avatarClass} flex items-center justify-center text-white font-bold flex-shrink-0`}>
                    {initials || 'P'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900 truncate">{fullName(p)}</p>
                      <span className="badge bg-cyan-100 text-cyan-700 border-cyan-200">{item.queue_number}</span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                      {p?.patient_number ?? '—'}
                      {item.medical_file_number ? ` • ${item.medical_file_number}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{calculateAge(p?.date_of_birth)} ans — {sexLabel(p?.sex)}</p>
                    <p className="text-xs text-gray-600 mt-1.5">
                      <span className="text-gray-400">Rendez-vous :</span>{' '}
                      {formatDate(item.appointment?.appointment_date)} {item.appointment?.appointment_time?.substring(0, 5) ?? ''}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      <span className="text-gray-400">Médecin :</span> {item.appointment_doctor_name || 'Non affecté'}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      <span className="text-gray-400">Motif :</span> {item.appointment?.reason || '—'}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">Envoyé à {formatTime(item.sent_at)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                  {onOpenFile && p && (
                    <button onClick={() => onOpenFile(p.id)} className="btn-secondary btn-sm" disabled={busy}>
                      <FolderHeart className="w-4 h-4" /> Voir dossier
                    </button>
                  )}
                  {canAccept && (
                    <>
                      <button onClick={() => onReturn(item)} disabled={busy} className="btn-ghost btn-sm text-xs" title="Retourner en salle d'attente">
                        <Undo2 className="w-3.5 h-3.5" /> Retour
                      </button>
                      <button
                        onClick={() => onAccept(item)}
                        disabled={busy}
                        aria-busy={acceptingId === item.queue_id}
                        className="btn-sm bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-70 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                      >
                        {acceptingId === item.queue_id
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Acceptation...</>
                          : <><CheckCircle2 className="w-3.5 h-3.5" /> Accepter</>}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
