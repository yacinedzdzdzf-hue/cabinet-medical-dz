import { useMemo } from 'react';
import {
  Calendar, Clock, Stethoscope, FileText, ArrowRight, AlertTriangle,
  CheckCircle2, XCircle, CalendarClock, UserX, Phone,
} from 'lucide-react';
import { Modal, Badge } from '@/components/ui';
import { fullName, formatDateTime, formatTimeOnly, calculateAge, sexLabel } from '@/lib/format';
import { getStatusMeta, formatDateStr } from '@/lib/appointments';
import type { AppointmentWithRelations } from '@/lib/appointments';

export function AppointmentDetailsModal({ appointment, canEdit, canDelete, onClose, onNavigate, onAction }: {
  appointment: AppointmentWithRelations;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onNavigate?: (path: string, patientId?: string) => void;
  onAction: (action: 'present' | 'no_show' | 'enter_consultation' | 'complete' | 'cancel' | 'postpone' | 'edit' | 'delete', appt: AppointmentWithRelations) => void;
}) {
  const p = appointment.patient;
  const meta = getStatusMeta(appointment.status, appointment.queue_status);
  const initials = `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase();
  const avatarClass = p?.sex === 'M' ? 'bg-blue-600' : p?.sex === 'F' ? 'bg-pink-600' : 'bg-gray-500';
  const endTime = useMemo(() => {
    const [h, m] = appointment.appointment_time.split(':').map(Number);
    const total = h * 60 + (m || 0) + (appointment.duration_minutes || 30);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }, [appointment.appointment_time, appointment.duration_minutes]);

  const history = [
    { label: 'Rendez-vous créé', date: appointment.created_at, icon: Calendar },
    { label: 'Patient arrivé', date: appointment.checked_in_at, icon: CheckCircle2 },
    { label: 'Entrée en consultation', date: appointment.queue_entered_at, icon: Stethoscope },
    { label: 'Consultation terminée', date: appointment.completed_at, icon: CheckCircle2 },
    { label: 'Dernière modification', date: appointment.updated_at, icon: Clock },
  ].filter((h) => !!h.date);

  return (
    <Modal open onClose={onClose} title="Détails du rendez-vous" size="lg">
      <div className="space-y-5">
        {/* Patient */}
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl ${avatarClass} flex items-center justify-center text-white text-xl font-bold flex-shrink-0`}>
            {initials || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onNavigate?.('/medical-files', p?.id)}
                className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors"
              >
                {fullName(p)}
              </button>
              <Badge className={getStatusMeta(appointment.status, appointment.queue_status).badge}>{meta.label}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
              <span className="font-mono">{p?.patient_number ?? '—'}</span>
              {p?.medical_file?.file_number && <><span className="text-gray-300">•</span><span className="font-mono">{p.medical_file.file_number}</span></>}
              {p?.date_of_birth && <><span className="text-gray-300">•</span><span>{calculateAge(p.date_of_birth)} ans</span></>}
              {p?.sex && <><span className="text-gray-300">•</span><span>{sexLabel(p.sex)}</span></>}
            </div>
            {p?.phone && (
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5"><Phone className="w-3 h-3" /> {p.phone}</p>
            )}
          </div>
        </div>

        {/* Infos */}
        <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Date</p>
            <p className="text-sm font-medium text-gray-800">{formatDateStr(appointment.appointment_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Horaire</p>
            <p className="text-sm font-medium text-gray-800">{formatTimeOnly(appointment.appointment_time)} — {endTime}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Durée</p>
            <p className="text-sm font-medium text-gray-800">{appointment.duration_minutes} min</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Médecin</p>
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5 text-gray-400" /> {appointment.doctor?.full_name ?? 'Non assigné'}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-gray-400 mb-0.5">Motif</p>
            <p className="text-sm font-medium text-gray-800">{appointment.reason || '—'}</p>
          </div>
          {appointment.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-line">{appointment.notes}</p>
            </div>
          )}
        </div>

        {appointment.status === 'postponed' && (
          <div className="flex items-start gap-2.5 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-orange-800">
              Ce rendez-vous a été reporté. Un nouveau rendez-vous a été créé à la nouvelle date.
            </p>
          </div>
        )}

        {/* Historique */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Historique du rendez-vous</h4>
          <div className="space-y-2.5">
            {history.map((h, i) => {
              const Icon = h.icon;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <span className="text-gray-700 flex-1">{h.label}</span>
                  <span className="text-xs text-gray-400">{formatDateTime(h.date)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          {onNavigate && p && (
            <button onClick={() => onNavigate('/medical-files', p.id)} className="btn-secondary btn-sm">
              <FileText className="w-4 h-4" /> Dossier médical <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="flex-1" />
          {canEdit && appointment.status === 'scheduled' && (
            <>
              <button onClick={() => { onAction('present', appointment); onClose(); }} className="btn-sm bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Présent
              </button>
              <button onClick={() => { onAction('no_show', appointment); onClose(); }} className="btn-sm bg-orange-500 text-white hover:bg-orange-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <UserX className="w-4 h-4" /> Absent
              </button>
              <button onClick={() => { onAction('postpone', appointment); onClose(); }} className="btn-secondary btn-sm">
                <CalendarClock className="w-4 h-4" /> Reporter
              </button>
              <button onClick={() => { onAction('cancel', appointment); onClose(); }} className="btn-secondary btn-sm text-red-600">
                <XCircle className="w-4 h-4" /> Annuler
              </button>
            </>
          )}
          {canEdit && appointment.status === 'arrived' && (
            <>
              <button onClick={() => { onAction('enter_consultation', appointment); onClose(); }} className="btn-sm bg-amber-600 text-white hover:bg-amber-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <Stethoscope className="w-4 h-4" /> Entrer en consultation
              </button>
              <button onClick={() => { onAction('cancel', appointment); onClose(); }} className="btn-secondary btn-sm text-red-600">
                <XCircle className="w-4 h-4" /> Annuler
              </button>
            </>
          )}
          {canEdit && appointment.status === 'in_consultation' && (
            <button onClick={() => { onAction('complete', appointment); onClose(); }} className="btn-sm bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Terminer
            </button>
          )}
          {canEdit && (
            <button onClick={() => { onAction('edit', appointment); onClose(); }} className="btn-secondary btn-sm">Modifier</button>
          )}
          {canDelete && (
            <button onClick={() => { onAction('delete', appointment); onClose(); }} className="btn-ghost btn-sm text-red-600 hover:bg-red-50">
              Supprimer
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
