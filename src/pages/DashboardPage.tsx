import { useState, useEffect, useCallback } from 'react';
import {
  Users, Calendar, Clock, Stethoscope, Receipt, HandCoins,
  UserPlus, FileText, TrendingUp, Armchair,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate, fullName } from '@/lib/format';
import { Loading } from '@/components/ui';
import type { Patient, Appointment, WaitingQueueEntry, Invoice } from '@/types';

export default function DashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { profile, hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    patients: 0,
    todayAppointments: 0,
    waiting: 0,
    inConsultation: 0,
    unpaidInvoices: 0,
    totalDebts: 0,
    newPatientsThisMonth: 0,
  });
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [todayAppts, setTodayAppts] = useState<Appointment[]>([]);
  const [waitingQueue, setWaitingQueue] = useState<WaitingQueueEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date();
    monthStart.setDate(1);

    const [p, a, w, c, i, d, np, appts, wq] = await Promise.all([
      supabase.from('patients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('appointment_date', today).neq('status', 'cancelled'),
      supabase.from('waiting_queue').select('*', { count: 'exact', head: true }).eq('status', 'waiting'),
      supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
      supabase.from('invoices').select('*', { count: 'exact', head: true }).in('status', ['unpaid', 'partially_paid']),
      supabase.from('debts').select('remaining_amount').eq('status', 'active'),
      supabase.from('patients').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString()),
      supabase.from('appointments').select('*, patient:patients(*)').eq('appointment_date', today).neq('status', 'cancelled').order('appointment_time').limit(10),
      supabase.from('waiting_queue').select('*, patient:patients(*)').in('status', ['waiting', 'called']).order('created_at').limit(10),
    ]);

    setStats({
      patients: p.count ?? 0,
      todayAppointments: a.count ?? 0,
      waiting: w.count ?? 0,
      inConsultation: c.count ?? 0,
      unpaidInvoices: i.count ?? 0,
      totalDebts: (d.data ?? []).reduce((s: number, r: any) => s + (r.remaining_amount ?? 0), 0),
      newPatientsThisMonth: np.count ?? 0,
    });
    setRecentPatients((appts.data as unknown as Patient[]) ?? []);
    setTodayAppts((appts.data as Appointment[]) ?? []);
    setWaitingQueue((wq.data as WaitingQueueEntry[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const cards = [
    { label: 'Patients actifs', value: stats.patients, icon: Users, color: 'text-blue-600 bg-blue-50', path: '/patients' },
    { label: "Rendez-vous aujourd’hui", value: stats.todayAppointments, icon: Calendar, color: 'text-green-600 bg-green-50', path: '/appointments' },
    { label: 'En attente', value: stats.waiting, icon: Armchair, color: 'text-amber-600 bg-amber-50', path: '/waiting' },
    { label: 'En consultation', value: stats.inConsultation, icon: Stethoscope, color: 'text-purple-600 bg-purple-50', path: '/consultations' },
    { label: 'Factures impayées', value: stats.unpaidInvoices, icon: Receipt, color: 'text-red-600 bg-red-50', path: '/invoices' },
    { label: 'Dettes totales', value: formatCurrency(stats.totalDebts), icon: HandCoins, color: 'text-orange-600 bg-orange-50', path: '/debts' },
    { label: 'Nouveaux patients (mois)', value: stats.newPatientsThisMonth, icon: UserPlus, color: 'text-teal-600 bg-teal-50', path: '/patients' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        <p className="text-gray-500 text-sm mt-1">
          Bienvenue, {profile?.full_name} — {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => onNavigate(c.path)}
            className="card p-4 text-left hover:shadow-md transition-shadow"
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{c.value}</p>
            <p className="text-xs text-gray-500 mt-1">{c.label}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today’s appointments */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            Rendez-vous du jour
          </h2>
          {todayAppts.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">Aucun rendez-vous aujourd’hui</p>
          ) : (
            <div className="space-y-2">
              {todayAppts.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <div className="w-12 text-center">
                    <p className="text-sm font-medium text-gray-900">{a.appointment_time.substring(0, 5)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{fullName(a.patient)}</p>
                    <p className="text-xs text-gray-500 truncate">{a.reason || '—'}</p>
                  </div>
                  <span className={`badge ${
                    a.status === 'arrived' ? 'bg-green-100 text-green-700 border-green-200' :
                    a.status === 'completed' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                    a.status === 'no_show' ? 'bg-red-100 text-red-700 border-red-200' :
                    'bg-gray-100 text-gray-600 border-gray-200'
                  }`}>
                    {a.status === 'scheduled' ? 'Programmé' : a.status === 'arrived' ? 'Arrivé' : a.status === 'completed' ? 'Terminé' : a.status === 'no_show' ? 'Absent' : 'Annulé'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Waiting queue */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Armchair className="w-4 h-4 text-amber-600" />
            Salle d’attente
          </h2>
          {waitingQueue.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">Aucun patient en attente</p>
          ) : (
            <div className="space-y-2">
              {waitingQueue.slice(0, 6).map((w) => (
                <div key={w.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <span className={`badge ${w.queue_type === 'H' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-pink-100 text-pink-700 border-pink-200'}`}>
                    {w.queue_number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{fullName(w.patient)}</p>
                  </div>
                  <span className={`badge ${
                    w.status === 'waiting' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                    w.status === 'called' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                    'bg-gray-100 text-gray-600 border-gray-200'
                  }`}>
                    {w.status === 'waiting' ? 'En attente' : w.status === 'called' ? 'Appelé' : w.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
