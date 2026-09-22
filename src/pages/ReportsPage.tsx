import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Download, Stethoscope, UserPlus, Calendar, UserX, Receipt, CreditCard, HandCoins, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { Loading, PageHeader } from '@/components/ui';

type DateRange = 'today' | 'week' | 'month' | 'year';

interface ReportData {
  dailyConsultations: number;
  monthlyConsultations: number;
  newPatients: number;
  appointments: number;
  noShows: number;
  revenue: number;
  payments: number;
  debts: number;
  unpaidInvoices: number;
}

interface ReportCard {
  key: keyof ReportData;
  label: string;
  description: string;
  icon: typeof Stethoscope;
  color: string;
  isCurrency: boolean;
}

const REPORT_CARDS: ReportCard[] = [
  { key: 'dailyConsultations', label: 'Consultations du jour', description: 'Consultations effectuées aujourd\'hui', icon: Stethoscope, color: 'text-blue-600 bg-blue-50', isCurrency: false },
  { key: 'monthlyConsultations', label: 'Consultations du mois', description: 'Consultations effectuées ce mois', icon: Stethoscope, color: 'text-purple-600 bg-purple-50', isCurrency: false },
  { key: 'newPatients', label: 'Nouveaux patients', description: 'Patients enregistrés sur la période', icon: UserPlus, color: 'text-teal-600 bg-teal-50', isCurrency: false },
  { key: 'appointments', label: 'Rendez-vous', description: 'Rendez-vous sur la période', icon: Calendar, color: 'text-green-600 bg-green-50', isCurrency: false },
  { key: 'noShows', label: 'Absences', description: 'Patients absents à leur rendez-vous', icon: UserX, color: 'text-orange-600 bg-orange-50', isCurrency: false },
  { key: 'revenue', label: 'Revenu total', description: 'Montant total des factures sur la période', icon: Receipt, color: 'text-indigo-600 bg-indigo-50', isCurrency: true },
  { key: 'payments', label: 'Paiements encaissés', description: 'Montant total des paiements sur la période', icon: CreditCard, color: 'text-green-600 bg-green-50', isCurrency: true },
  { key: 'debts', label: 'Dettes en cours', description: 'Montant total des dettes actives', icon: HandCoins, color: 'text-red-600 bg-red-50', isCurrency: true },
  { key: 'unpaidInvoices', label: 'Factures impayées', description: 'Nombre de factures non payées', icon: FileText, color: 'text-amber-600 bg-amber-50', isCurrency: false },
];

function getDateRange(range: DateRange): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  let start: string;

  switch (range) {
    case 'today':
      start = end;
      break;
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay() + 1);
      start = d.toISOString().split('T')[0];
      break;
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
      break;
  }
  return { start, end };
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>('month');
  const [data, setData] = useState<ReportData>({
    dailyConsultations: 0,
    monthlyConsultations: 0,
    newPatients: 0,
    appointments: 0,
    noShows: 0,
    revenue: 0,
    payments: 0,
    debts: 0,
    unpaidInvoices: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    const { start, end } = getDateRange(range);

    const [dc, mc, np, appt, ns, rev, pay, debts, unpaid] = await Promise.all([
      supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', today).lte('completed_at', today + 'T23:59:59'),
      supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', monthStartStr),
      supabase.from('patients').select('*', { count: 'exact', head: true }).gte('created_at', start).lte('created_at', end + 'T23:59:59'),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('appointment_date', start).lte('appointment_date', end).neq('status', 'cancelled'),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('appointment_date', start).lte('appointment_date', end).eq('status', 'no_show'),
      supabase.from('invoices').select('total').gte('created_at', start).lte('created_at', end + 'T23:59:59').neq('status', 'cancelled'),
      supabase.from('payments').select('amount').gte('created_at', start).lte('created_at', end + 'T23:59:59'),
      supabase.from('debts').select('remaining_amount').eq('status', 'active'),
      supabase.from('invoices').select('*', { count: 'exact', head: true }).in('status', ['unpaid', 'partially_paid']),
    ]);

    setData({
      dailyConsultations: dc.count ?? 0,
      monthlyConsultations: mc.count ?? 0,
      newPatients: np.count ?? 0,
      appointments: appt.count ?? 0,
      noShows: ns.count ?? 0,
      revenue: (rev.data ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0),
      payments: (pay.data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0),
      debts: (debts.data ?? []).reduce((s: number, r: any) => s + (r.remaining_amount ?? 0), 0),
      unpaidInvoices: unpaid.count ?? 0,
    });
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const exportCSV = () => {
    const rows = [
      ['Rapport CMDZ', `Période: ${range}`],
      [],
      ['Indicateur', 'Valeur', 'Description'],
      ...REPORT_CARDS.map((c) => [
        c.label,
        c.isCurrency ? data[c.key].toFixed(2) + ' DA' : String(data[c.key]),
        c.description,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport_cmdz_${range}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rangeLabels: Record<DateRange, string> = {
    today: "Aujourd’hui",
    week: 'Cette semaine',
    month: 'Ce mois',
    year: 'Cette année',
  };

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Rapports"
        subtitle="Statistiques et indicateurs de l’activité"
        actions={
          <button onClick={exportCSV} className="btn-secondary">
            <Download className="w-4 h-4" /> Exporter CSV
          </button>
        }
      />

      <div className="flex gap-1 mb-6">
        {(['today', 'week', 'month', 'year'] as DateRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`btn-sm ${range === r ? 'btn-primary' : 'btn-secondary'}`}
          >
            {rangeLabels[r]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORT_CARDS.map((c) => (
          <div key={c.key} className="card p-5">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {c.isCurrency ? formatCurrency(data[c.key]) : data[c.key]}
            </p>
            <p className="text-sm font-medium text-gray-700 mt-1">{c.label}</p>
            <p className="text-xs text-gray-500 mt-1">{c.description}</p>
          </div>
        ))}
      </div>

      <div className="card p-5 mt-6">
        <h2 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          Résumé de la période
        </h2>
        <p className="text-sm text-gray-500">
          Période sélectionnée : <span className="font-medium text-gray-700">{rangeLabels[range]}</span>
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="text-center">
            <p className="text-xs text-gray-500">Revenu</p>
            <p className="text-lg font-bold text-indigo-600">{formatCurrency(data.revenue)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Encaissé</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(data.payments)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Dettes</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(data.debts)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Factures impayées</p>
            <p className="text-lg font-bold text-amber-600">{data.unpaidInvoices}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
