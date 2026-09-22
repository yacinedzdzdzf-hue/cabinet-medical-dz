import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Volume2, Square, RotateCcw, SkipForward, ArrowRight, Phone,
  Play, Stethoscope, Check, CreditCard, Loader2, AlertCircle, X, Undo2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName, formatTime } from '@/lib/format';
import { Loading, Modal, PageHeader, Badge } from '@/components/ui';
import type { Patient, WaitingQueueEntry, WaitingSettings, CallRecord } from '@/types';

export default function WaitingQueuePage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<WaitingQueueEntry[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [settings, setSettings] = useState<WaitingSettings | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const speakLockRef = useRef(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(
    () => sessionStorage.getItem('cmdz-transfer-error')
  );
  const transferLockRef = useRef(false);

  const canManage = hasRole('ADMIN', 'RECEPTION', 'DOCTOR');
  const isTransferring = (id: string) => actionLoading === `transfer-${id}`;

  const load = useCallback(async () => {
    const [q, p, c, s] = await Promise.all([
      supabase.from('waiting_queue').select('*, patient:patients(*)').in('status', ['waiting', 'called', 'returned', 'pending_acceptance', 'in_consultation']).order('created_at'),
      supabase.from('patients').select('*').eq('status', 'active').order('last_name'),
      supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('waiting_settings').select('*').maybeSingle(),
    ]);
    setQueue((q.data as WaitingQueueEntry[]) ?? []);
    setPatients((p.data as Patient[]) ?? []);
    setCalls((c.data as CallRecord[]) ?? []);
    setSettings(s.data as WaitingSettings | null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    sessionStorage.removeItem('cmdz-transfer-error');
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const channel = supabase
      .channel('waiting_queue_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiting_queue' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (payload) => {
        const call = payload.new as CallRecord;
        if (settings?.voice_enabled) {
          speakCall(call);
        }
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, settings]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(null);
    speakLockRef.current = false;
  }, []);

  const speakCall = useCallback((call: CallRecord) => {
    if (speakLockRef.current) {
      window.speechSynthesis.cancel();
    }
    speakLockRef.current = true;
    setSpeaking(call.id);

    const repeatCount = settings?.voice_repeat_count ?? 1;
    const volume = settings?.voice_volume ?? 1.0;
    const rate = settings?.voice_rate ?? 1.0;
    const pitch = settings?.voice_pitch ?? 1.0;
    const lang = settings?.voice_lang ?? 'fr-FR';

    let currentRepeat = 0;

    const speakOnce = () => {
      if (currentRepeat >= repeatCount) {
        setSpeaking(null);
        speakLockRef.current = false;
        return;
      }
      currentRepeat++;
      const utterance = new SpeechSynthesisUtterance(call.call_text);
      utterance.lang = lang;
      utterance.volume = volume;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.onend = () => {
        if (currentRepeat < repeatCount && speakLockRef.current) {
          setTimeout(speakOnce, 500);
        } else {
          setSpeaking(null);
          speakLockRef.current = false;
        }
      };
      utterance.onerror = () => {
        setSpeaking(null);
        speakLockRef.current = false;
      };
      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    speakOnce();
  }, [settings]);

  const handleCallNext = async (queueType: 'H' | 'F') => {
    setActionLoading(`next-${queueType}`);
    try {
      // Get the first waiting patient for this queue type, ordered by created_at
      const { data: nextEntry, error } = await supabase
        .from('waiting_queue')
        .select('*, patient:patients(*)')
        .eq('queue_type', queueType)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error || !nextEntry) {
        alert('Aucun patient en attente dans cette file.');
        return;
      }

      const entry = nextEntry as WaitingQueueEntry;
      await handleCall(entry);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCall = async (entry: WaitingQueueEntry) => {
    stopSpeaking();
    setActionLoading(entry.id);
    try {
      const patientName = fullName(entry.patient);
      const sex = entry.patient?.sex;
      const title = sex === 'F' ? 'Madame' : 'Monsieur';
      const showName = settings?.show_patient_name ?? true;
      const callText = showName
        ? `Numéro ${entry.queue_number}, ${title} ${patientName}, veuillez entrer en consultation.`
        : `Numéro ${entry.queue_number}, veuillez entrer en consultation.`;

      const { data: callRecord } = await supabase.from('calls').insert({
        queue_id: entry.id,
        patient_id: entry.patient_id,
        queue_number: entry.queue_number,
        patient_name: patientName,
        call_text: callText,
        called_by: profile?.id,
        status: 'called',
      }).select().single();

      await supabase.from('waiting_queue').update({
        status: 'called',
        called_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', entry.id);

      await logAudit('queue_call', 'waiting_queue', entry.id, `${entry.queue_number} ${patientName}`);

      if (callRecord && settings?.voice_enabled) {
        speakCall(callRecord as CallRecord);
      }
      load();
    } finally {
      setActionLoading(null);
    }
  };

  const handleRecall = async (entry: WaitingQueueEntry) => {
    stopSpeaking();
    const patientName = fullName(entry.patient);
    const sex = entry.patient?.sex;
    const title = sex === 'F' ? 'Madame' : 'Monsieur';
    const showName = settings?.show_patient_name ?? true;
    const callText = showName
      ? `Rappel. Numéro ${entry.queue_number}, ${title} ${patientName}, veuillez entrer en consultation.`
      : `Rappel. Numéro ${entry.queue_number}, veuillez entrer en consultation.`;

    const { data: callRecord } = await supabase.from('calls').insert({
      queue_id: entry.id,
      patient_id: entry.patient_id,
      queue_number: entry.queue_number,
      patient_name: patientName,
      call_text: callText,
      called_by: profile?.id,
      status: 'recall',
    }).select().single();

    if (callRecord && settings?.voice_enabled) {
      speakCall(callRecord as CallRecord);
    }
  };

  const handleReturnToQueue = async (entry: WaitingQueueEntry) => {
    setActionLoading(entry.id);
    try {
      const { error } = await supabase.rpc('return_to_waiting_queue', { p_queue_id: entry.id });
      if (error) {
        console.error('[WAITING] return error:', error);
        persistTransferError("Impossible de retourner le patient en salle d'attente. Veuillez réessayer.");
        return;
      }
      await logAudit('queue_return', 'waiting_queue', entry.id, entry.queue_number, {
        user: profile?.full_name, role: profile?.role, patient_id: entry.patient_id, appointment_id: entry.appointment_id,
      }, { id: profile?.id, name: profile?.full_name });
      load();
    } finally {
      setActionLoading(null);
    }
  };

  const handleSkip = async (entry: WaitingQueueEntry) => {
    stopSpeaking();
    await supabase.from('waiting_queue').update({ status: 'skipped', updated_at: new Date().toISOString() }).eq('id', entry.id);
    await logAudit('queue_skip', 'waiting_queue', entry.id, entry.queue_number);
    load();
  };

  const persistTransferError = (message: string) => {
    sessionStorage.setItem('cmdz-transfer-error', message);
    setTransferError(message);
  };

  /**
   * « Consulter » = envoi du patient vers le flux Consultations.
   * Aucune consultation n'est créée ici : le médecin devra l'accepter.
   */
  const handleSendToConsultation = async (entry: WaitingQueueEntry) => {
    if (transferLockRef.current) return;
    transferLockRef.current = true;
    setTransferError(null);
    sessionStorage.removeItem('cmdz-transfer-error');
    setActionLoading(`transfer-${entry.id}`);
    try {
      const { data, error } = await supabase.rpc('send_patient_to_consultation', { p_queue_id: entry.id });
      if (error) {
        console.error('[WAITING] send error:', error);
        persistTransferError("Impossible de transférer le patient vers la consultation. Veuillez réessayer.");
        return;
      }
      const result = data as { patient_id: string; appointment_id: string | null } | null;
      if (!result?.patient_id) {
        persistTransferError("Impossible de transférer le patient vers la consultation. Veuillez réessayer.");
        return;
      }
      await logAudit('PATIENT_SENT_TO_CONSULTATION', 'waiting_queue', entry.id, `${entry.queue_number} ${fullName(entry.patient)}`, {
        user: profile?.full_name, role: profile?.role,
        patient_id: result.patient_id, appointment_id: result.appointment_id, queue_number: entry.queue_number,
      }, { id: profile?.id, name: profile?.full_name });

      // Aucune navigation : l'utilisateur reste sur la salle d'attente.
      load();
      setToast(`Patient envoyé vers les consultations — ${entry.queue_number}`);
    } finally {
      setActionLoading(null);
      transferLockRef.current = false;
    }
  };

  const handleCompleteConsultation = async (entry: WaitingQueueEntry) => {
    setActionLoading(entry.id);
    try {
      await supabase.from('waiting_queue').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', entry.id);

      // Update appointment status if linked
      if (entry.appointment_id) {
        await supabase.from('appointments').update({
          status: 'completed',
          completed_by: profile?.id,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', entry.appointment_id);
      }

      await logAudit('queue_complete', 'waiting_queue', entry.id, entry.queue_number);
      load();
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddToQueue = async (patientId: string) => {
    const patient = patients.find((p) => p.id === patientId);
    if (!patient) return;
    if (!patient.sex) {
      alert("Le sexe du patient est manquant. Veuillez le compléter dans la fiche patient.");
      return;
    }
    const queueType = patient.sex === 'M' ? 'H' : 'F';
    const { data: numData, error: numErr } = await supabase.rpc('generate_queue_number', { p_queue_type: queueType });
    if (numErr) { alert(numErr.message); return; }

    const { error: insertErr } = await supabase.from('waiting_queue').insert({
      patient_id: patientId,
      queue_type: queueType,
      queue_number: numData as string,
      status: 'waiting',
    });

    if (insertErr) {
      alert(insertErr.message);
      return;
    }
    await logAudit('queue_add', 'waiting_queue', patientId, `${queueType}-${numData} ${fullName(patient)}`);
    setShowAdd(false);
    load();
  };

  const handleTestVoice = () => {
    stopSpeaking();
    const testCall: CallRecord = {
      id: 'test',
      queue_id: 'test',
      patient_id: 'test',
      queue_number: 'H-001',
      patient_name: 'Test',
      call_text: "Ceci est un test de la voix. Numéro H-001, veuillez entrer en consultation.",
      called_by: null,
      status: 'called',
      created_at: new Date().toISOString(),
    };
    speakCall(testCall);
  };

  if (loading) return <Loading />;

  const maleQueue = queue.filter((q) => q.queue_type === 'H');
  const femaleQueue = queue.filter((q) => q.queue_type === 'F');
  const inConsultation = queue.filter((q) => q.status === 'in_consultation');
  const pendingAcceptance = queue.filter((q) => q.status === 'pending_acceptance');
  const waitingNow = queue.filter((q) => q.status === 'waiting' || q.status === 'called' || q.status === 'returned');

  return (
    <div>
      <PageHeader
        title="Salle d'attente"
        subtitle={`${waitingNow.length} patient(s) en attente — ${pendingAcceptance.length} en attente du médecin — ${inConsultation.length} en consultation`}
        actions={
          <div className="flex gap-2">
            {settings?.voice_enabled && (
              <button onClick={handleTestVoice} className="btn-secondary">
                <Volume2 className="w-4 h-4" /> Tester la voix
              </button>
            )}
            {speaking && (
              <button onClick={stopSpeaking} className="btn-danger">
                <Square className="w-4 h-4" /> Arrêter la voix
              </button>
            )}
            {canManage && (
              <button onClick={() => setShowAdd(true)} className="btn-primary">
                <Plus className="w-4 h-4" /> Ajouter à la file
              </button>
            )}
          </div>
        }
      />

      {toast && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-slide-up">
          <Check className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm font-medium text-emerald-800 flex-1">{toast}</p>
          <button onClick={() => setToast(null)} className="text-emerald-500 hover:text-emerald-700" aria-label="Fermer le message">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {transferError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">{transferError}</p>
            <p className="text-xs text-red-600 mt-0.5">Le patient est resté dans la salle d'attente. Aucune donnée n'a été modifiée.</p>
          </div>
          <button onClick={() => { setTransferError(null); sessionStorage.removeItem('cmdz-transfer-error'); }} className="text-red-400 hover:text-red-600" aria-label="Fermer le message">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QueueColumn
          title="Salle d'attente — Hommes"
          queue={maleQueue}
          color="blue"
          onCall={handleCall}
          onCallNext={() => handleCallNext('H')}
          onRecall={handleRecall}
          onSkip={handleSkip}
          onEnter={handleSendToConsultation}
          onReturnToQueue={handleReturnToQueue}
          onComplete={handleCompleteConsultation}
          speaking={speaking}
          canManage={canManage}
          actionLoading={actionLoading}
          transferringId={isTransferring}
          onNavigate={onNavigate}
        />
        <QueueColumn
          title="Salle d'attente — Femmes"
          queue={femaleQueue}
          color="pink"
          onCall={handleCall}
          onCallNext={() => handleCallNext('F')}
          onRecall={handleRecall}
          onSkip={handleSkip}
          onEnter={handleSendToConsultation}
          onReturnToQueue={handleReturnToQueue}
          onComplete={handleCompleteConsultation}
          speaking={speaking}
          canManage={canManage}
          actionLoading={actionLoading}
          transferringId={isTransferring}
          onNavigate={onNavigate}
        />
      </div>

      {/* In consultation section */}
      {inConsultation.length > 0 && (
        <div className="card p-5 mt-6 border-purple-200 bg-purple-50/30">
          <h2 className="font-semibold text-purple-700 mb-4 flex items-center gap-2">
            <Stethoscope className="w-5 h-5" />
            Patients en consultation ({inConsultation.length})
          </h2>
          <div className="space-y-2">
            {inConsultation.map((entry) => (
              <div key={entry.id} className="bg-white rounded-lg border border-purple-200 p-3 flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg ${entry.queue_type === 'H' ? 'bg-blue-600' : 'bg-pink-600'} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                  {entry.queue_number}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{fullName(entry.patient)}</p>
                  <Badge className="bg-purple-100 text-purple-700 border-purple-200">En consultation</Badge>
                  {entry.entered_consultation_at && (
                    <span className="text-xs text-gray-400 ml-2">depuis {formatTime(entry.entered_consultation_at)}</span>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleCompleteConsultation(entry)}
                      disabled={actionLoading === entry.id}
                      className="btn-sm bg-green-600 text-white hover:bg-green-700 px-2 py-1 rounded-lg flex items-center gap-1"
                      title="Terminer la consultation"
                    >
                      <Check className="w-3 h-3" /> Terminer
                    </button>
                    {onNavigate && (
                      <button
                        onClick={() => onNavigate(`/invoices?patient=${entry.patient_id}`)}
                        className="btn-sm bg-blue-600 text-white hover:bg-blue-700 px-2 py-1 rounded-lg flex items-center gap-1"
                        title="Aller au paiement"
                      >
                        <CreditCard className="w-3 h-3" /> Paiement
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {calls.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-semibold text-gray-900 mb-4">Appels récents</h2>
          <div className="space-y-2">
            {calls.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-sm py-2 border-b border-gray-100 last:border-0">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className={`badge ${c.queue_number.startsWith('H') ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-pink-100 text-pink-700 border-pink-200'}`}>{c.queue_number}</span>
                <span className="flex-1 truncate">{c.patient_name}</span>
                <span className="text-gray-400 text-xs">{formatTime(c.created_at)}</span>
                {c.status === 'recall' && <Badge className="bg-amber-100 text-amber-700 border-amber-200">Rappel</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && (
        <AddToQueueModal patients={patients} onClose={() => setShowAdd(false)} onAdd={handleAddToQueue} />
      )}
    </div>
  );
}

function QueueColumn({ title, queue, color, onCall, onCallNext, onRecall, onSkip, onEnter, onReturnToQueue, onComplete, speaking, canManage, actionLoading, transferringId, onNavigate }: {
  title: string;
  queue: WaitingQueueEntry[];
  color: 'blue' | 'pink';
  onCall: (e: WaitingQueueEntry) => void;
  onCallNext: () => void;
  onRecall: (e: WaitingQueueEntry) => void;
  onSkip: (e: WaitingQueueEntry) => void;
  onEnter: (e: WaitingQueueEntry) => void;
  onReturnToQueue: (e: WaitingQueueEntry) => void;
  onComplete: (e: WaitingQueueEntry) => void;
  speaking: string | null;
  canManage: boolean;
  actionLoading: string | null;
  transferringId: (id: string) => boolean;
  onNavigate?: (path: string) => void;
}) {
  const colorClasses = color === 'blue'
    ? 'border-blue-200 bg-blue-50/50'
    : 'border-pink-200 bg-pink-50/50';
  const headerColor = color === 'blue' ? 'text-blue-700' : 'text-pink-700';
  const numColor = color === 'blue' ? 'bg-blue-600' : 'bg-pink-600';
  const nextBtnColor = color === 'blue' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-pink-600 hover:bg-pink-700';

  const waitingCount = queue.filter((q) => q.status === 'waiting' || q.status === 'returned').length;
  const pendingCount = queue.filter((q) => q.status === 'pending_acceptance').length;

  return (
    <div className={`card p-5 ${colorClasses}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`font-semibold ${headerColor}`}>{title} ({waitingCount} en attente{pendingCount > 0 ? `, ${pendingCount} chez le médecin` : ''})</h2>
        {canManage && waitingCount > 0 && (
          <button
            onClick={onCallNext}
            disabled={!!actionLoading}
            className={`btn-sm text-white px-3 py-1.5 rounded-lg flex items-center gap-1 ${nextBtnColor}`}
          >
            <Play className="w-3 h-3" /> Appeler le suivant
          </button>
        )}
      </div>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">File vide</p>
      ) : (
        <div className="space-y-2">
          {queue.map((entry) => (
            <div key={entry.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
              <div className={`w-12 h-12 rounded-lg ${numColor} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                {entry.queue_number}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{fullName(entry.patient)}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={
                    entry.status === 'waiting' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                    entry.status === 'called' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                    entry.status === 'returned' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                    entry.status === 'pending_acceptance' ? 'bg-cyan-100 text-cyan-700 border-cyan-200' :
                    entry.status === 'in_consultation' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                    'bg-gray-100 text-gray-600 border-gray-200'
                  }>
                    {entry.status === 'waiting' ? 'En attente' :
                     entry.status === 'called' ? 'Appelé' :
                     entry.status === 'returned' ? 'Revenu' :
                     entry.status === 'in_consultation' ? 'En consultation' :
                     entry.status}
                  </Badge>
                  {speaking === entry.id && <span className="text-xs text-blue-600 animate-pulse">En cours...</span>}
                </div>
              </div>
              {canManage && (
                <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                  {entry.status === 'waiting' && (
                    <button
                      onClick={() => onCall(entry)}
                      disabled={actionLoading === entry.id}
                      className="btn-ghost btn-sm"
                      title="Appeler"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  )}
                  {entry.status === 'called' && (
                    <>
                      <button
                        onClick={() => onRecall(entry)}
                        disabled={actionLoading === entry.id}
                        className="btn-ghost btn-sm"
                        title="Rappeler"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onEnter(entry)}
                        disabled={actionLoading === entry.id || transferringId(entry.id)}
                        className="btn-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-70 px-2 py-1 rounded-lg flex items-center gap-1"
                        title="Envoyer le patient vers les consultations"
                        aria-busy={transferringId(entry.id)}
                      >
                        {transferringId(entry.id)
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Envoi...</>
                          : <><ArrowRight className="w-3 h-3" /> Consulter</>}
                      </button>
                    </>
                  )}
                  {entry.status === 'returned' && (
                    <button
                      onClick={() => onCall(entry)}
                      disabled={actionLoading === entry.id}
                      className="btn-ghost btn-sm"
                      title="Appeler"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  )}
                  {(entry.status === 'pending_acceptance' || entry.status === 'in_consultation') && (
                    <button
                      onClick={() => onReturnToQueue(entry)}
                      disabled={actionLoading === entry.id}
                      className="btn-ghost btn-sm"
                      title="Retourner en salle d'attente"
                    >
                      <Undo2 className="w-4 h-4" />
                    </button>
                  )}
                  {entry.status === 'in_consultation' && (
                    <>
                      <button
                        onClick={() => onComplete(entry)}
                        disabled={actionLoading === entry.id}
                        className="btn-sm bg-green-600 text-white hover:bg-green-700 px-2 py-1 rounded-lg flex items-center gap-1"
                        title="Terminer la consultation"
                      >
                        <Check className="w-3 h-3" /> Terminer
                      </button>
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate(`/invoices?patient=${entry.patient_id}`)}
                          className="btn-sm bg-blue-600 text-white hover:bg-blue-700 px-2 py-1 rounded-lg flex items-center gap-1"
                          title="Aller au paiement"
                        >
                          <CreditCard className="w-3 h-3" />
                        </button>
                      )}
                    </>
                  )}
                  {(entry.status === 'waiting' || entry.status === 'returned') && (
                    <button
                      onClick={() => onSkip(entry)}
                      disabled={actionLoading === entry.id}
                      className="btn-ghost btn-sm"
                      title="Passer"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddToQueueModal({ patients, onClose, onAdd }: {
  patients: Patient[];
  onClose: () => void;
  onAdd: (patientId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');

  const filtered = patients.filter((p) => {
    if (!search.trim()) return true;
    return fullName(p).toLowerCase().includes(search.toLowerCase()) || (p.phone ?? '').includes(search);
  });

  return (
    <Modal open onClose={onClose} title="Ajouter à la file d'attente">
      <div className="space-y-4">
        <input className="input" placeholder="Rechercher un patient..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-1">
          {filtered.slice(0, 30).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selected === p.id ? 'bg-blue-50 border border-blue-300' : 'hover:bg-gray-50 border border-transparent'}`}
            >
              <span className="font-medium">{fullName(p)}</span>
              <span className="text-gray-500 ml-2">{p.patient_number}</span>
              {!p.sex && <span className="text-red-500 text-xs ml-2">Sexe manquant!</span>}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={() => selected && onAdd(selected)} disabled={!selected} className="btn-primary">Ajouter</button>
        </div>
      </div>
    </Modal>
  );
}
