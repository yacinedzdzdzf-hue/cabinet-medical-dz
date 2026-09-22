import { useState, useEffect, useRef } from 'react';
import { Stethoscope, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fullName } from '@/lib/format';
import type { WaitingQueueEntry, WaitingSettings, CallRecord, Settings } from '@/types';

export default function WaitingScreenPage({ screenType }: { screenType: 'H' | 'F' }) {
  const [queue, setQueue] = useState<WaitingQueueEntry[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [settings, setSettings] = useState<WaitingSettings | null>(null);
  const [clinicSettings, setClinicSettings] = useState<Record<string, unknown>>({});
  const [currentTime, setCurrentTime] = useState(new Date());
  const lastCallIdRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    (async () => {
      const [q, c, s, cs] = await Promise.all([
        supabase.from('waiting_queue').select('*, patient:patients(*)').in('status', ['waiting', 'called', 'returned']).order('created_at'),
        supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('waiting_settings').select('*').maybeSingle(),
        supabase.from('settings').select('*').eq('key', 'clinic').maybeSingle(),
      ]);
      setQueue((q.data as WaitingQueueEntry[]) ?? []);
      setCalls((c.data as CallRecord[]) ?? []);
      setSettings(s.data as WaitingSettings | null);
      setClinicSettings((cs.data as Settings)?.value ?? {});
    })();

    const channel = supabase
      .channel(`waiting_screen_${screenType}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiting_queue' }, async () => {
        const { data } = await supabase.from('waiting_queue').select('*, patient:patients(*)').in('status', ['waiting', 'called', 'returned']).order('created_at');
        setQueue((data as WaitingQueueEntry[]) ?? []);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, async (payload) => {
        const call = payload.new as CallRecord;
        const { data: recentCalls } = await supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(5);
        setCalls((recentCalls as CallRecord[]) ?? []);

        if (settings?.voice_enabled && lastCallIdRef.current !== call.id) {
          lastCallIdRef.current = call.id;
          speakCall(call, settings);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [screenType, settings]);

  const speakCall = (call: CallRecord, s: WaitingSettings) => {
    window.speechSynthesis.cancel();
    const repeatCount = s.voice_repeat_count ?? 1;
    let count = 0;
    const speakOnce = () => {
      if (count >= repeatCount) return;
      count++;
      const u = new SpeechSynthesisUtterance(call.call_text);
      u.lang = s.voice_lang ?? 'fr-FR';
      u.volume = s.voice_volume ?? 1.0;
      u.rate = s.voice_rate ?? 1.0;
      u.pitch = s.voice_pitch ?? 1.0;
      u.onend = () => count < repeatCount && setTimeout(speakOnce, 500);
      window.speechSynthesis.speak(u);
    };
    speakOnce();
  };

  const filtered = queue.filter((q) => q.queue_type === screenType);
  const currentCall = calls[0];
  const clinicName = (clinicSettings.name as string) ?? 'Cabinet Médical DZ';

  const bgColor = screenType === 'H' ? 'from-blue-900 via-slate-900 to-slate-800' : 'from-pink-900 via-rose-900 to-slate-800';
  const accentColor = screenType === 'H' ? 'text-blue-400' : 'text-pink-400';
  const cardBorder = screenType === 'H' ? 'border-blue-500/30' : 'border-pink-500/30';
  const numBg = screenType === 'H' ? 'bg-blue-600' : 'bg-pink-600';

  return (
    <div className={`min-h-screen bg-gradient-to-br ${bgBgColorFix(bgColor)} text-white p-6 flex flex-col`}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
            <Stethoscope className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{clinicName}</h1>
            <p className={`text-sm ${accentColor}`}>
              Salle d’attente — {screenType === 'H' ? 'Hommes' : 'Femmes'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-3xl font-bold font-mono">
            <Clock className="w-6 h-6" />
            {currentTime.toLocaleTimeString('fr-FR')}
          </div>
          <p className="text-sm text-slate-400 capitalize">
            {currentTime.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="flex-1 flex gap-6">
        <div className="flex-1 flex flex-col justify-center">
          {currentCall ? (
            <div className={`bg-white/10 backdrop-blur rounded-2xl border-2 ${cardBorder} p-8 text-center`}>
              <p className="text-sm text-slate-400 mb-4">Numéro appelé</p>
              <div className={`text-8xl font-bold ${accentColor} mb-6`}>{currentCall.queue_number}</div>
              {settings?.show_patient_name && (
                <p className="text-3xl font-medium">{currentCall.patient_name}</p>
              )}
              <p className="text-lg text-slate-400 mt-4">Veuillez entrer en consultation</p>
            </div>
          ) : (
            <div className="bg-white/5 rounded-2xl border border-white/10 p-8 text-center">
              <p className="text-2xl text-slate-400">En attente d’appel</p>
            </div>
          )}
        </div>

        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h2 className="text-sm font-medium text-slate-400 mb-3">File d’attente</h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">File vide</p>
            ) : (
              <div className="space-y-1.5">
                {filtered.slice(0, 8).map((entry, i) => (
                  <div key={entry.id} className="flex items-center gap-3">
                    <span className={`w-10 h-10 rounded-lg ${numBg} flex items-center justify-center font-bold text-sm`}>
                      {entry.queue_number}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {settings?.show_patient_name ? fullName(entry.patient) : '—'}
                      </p>
                    </div>
                    {i === 0 && <span className="text-xs text-amber-400">Suivant</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4 flex-1">
            <h2 className="text-sm font-medium text-slate-400 mb-3">Appels récents</h2>
            {calls.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Aucun appel</p>
            ) : (
              <div className="space-y-1.5">
                {calls.slice(1).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 text-sm">
                    <span className={`w-8 h-8 rounded ${numBg} flex items-center justify-center font-bold text-xs`}>
                      {c.queue_number}
                    </span>
                    <span className="text-slate-300 truncate">{settings?.show_patient_name ? c.patient_name : '—'}</span>
                    <span className="text-slate-500 text-xs ml-auto">{new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function bgBgColorFix(classes: string): string {
  return classes;
}
