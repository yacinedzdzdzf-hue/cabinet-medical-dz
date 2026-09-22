import { useState, useEffect, useCallback } from 'react';
import { Plus, Award, Search, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName, formatDate } from '@/lib/format';
import { CERTIFICATE_TYPES } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader } from '@/components/ui';
import type { Patient, Certificate } from '@/types';

const TEMPLATES: Record<string, (name: string) => string> = {
  medical: (n) => `Je soussigné(e), médecin examinateur, certifie avoir examiné ce jour ${new Date().toLocaleDateString('fr-FR')} le/la patient(e) ${n} et l’avoir trouvé(e) en bonne santé apparente.\n\nCette attestation est délivrée à la demande de l’intéressé(e) pour servir et valoir ce que de droit.`,
  sick_leave: (n) => `Je soussigné(e), médecin examinateur, certifie que le/la patient(e) ${n} nécessite un arrêt de travail pour raison médicale.`,
  fitness: (n) => `Je soussigné(e), médecin examinateur, certifie que le/la patient(e) ${n} est apte à pratiquer les activités demandées.`,
  aptitude: (n) => `Je soussigné(e), médecin examinateur, certifie que le/la patient(e) ${n} est apte sur le plan médical pour l’activité sportive demandée.`,
  non_contraindication: (n) => `Je soussigné(e), médecin examinateur, certifie qu’il n’y a pas de contre-indication médicale pour le/la patient(e) ${n} concernant l’activité demandée.`,
  custom: () => '',
};

export default function CertificatesPage({ params }: { params: URLSearchParams }) {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<Certificate | null>(null);

  const filterPatientId = params.get('patient');
  const filterCertId = params.get('id');
  const canEdit = hasRole('ADMIN', 'DOCTOR');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('certificates').select('*, patient:patients(*)').order('created_at', { ascending: false });
    if (filterPatientId) q = q.eq('patient_id', filterPatientId);
    if (search.trim()) q = q.or(`certificate_number.ilike.%${search}%`);
    const { data } = await q;
    setCertificates((data as Certificate[]) ?? []);
    const { data: p } = await supabase.from('patients').select('*').eq('status', 'active').order('last_name');
    setPatients((p as Patient[]) ?? []);
    setLoading(false);
    if (filterCertId) {
      const found = (data as Certificate[])?.find((c) => c.id === filterCertId);
      if (found) setViewing(found);
    }
  }, [filterPatientId, filterCertId, search]);

  useEffect(() => { load(); }, [load]);

  const generateNumber = async (): Promise<string> => {
    const { data } = await supabase.from('certificates').select('certificate_number').order('created_at', { ascending: false }).limit(1);
    const last = (data?.[0] as Certificate)?.certificate_number;
    const num = last ? parseInt(last.replace(/\D/g, '')) + 1 : 1;
    return `CERT-${String(num).padStart(6, '0')}`;
  };

  const handleCreate = async (data: Partial<Certificate>) => {
    const num = await generateNumber();
    const { data: newCert, error } = await supabase.from('certificates').insert({
      ...data,
      certificate_number: num,
      doctor_id: profile?.id,
    }).select().single();
    if (error) { alert(error.message); return; }
    await logAudit('certificate_create', 'certificate', (newCert as Certificate).id, num);
    setShowForm(false);
    load();
  };

  if (loading) return <Loading />;

  if (viewing) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 no-print">
          <button onClick={() => setViewing(null)} className="btn-secondary btn-sm">← Retour</button>
          <button onClick={() => window.print()} className="btn-primary btn-sm"><Printer className="w-4 h-4" /> Imprimer</button>
        </div>
        <div className="card p-8 max-w-3xl mx-auto" id="certificate-print">
          <div className="text-center mb-8 border-b-2 border-gray-300 pb-4">
            <h1 className="text-2xl font-bold text-gray-900">{viewing.title || CERTIFICATE_TYPES.find((t) => t.value === viewing.type)?.label}</h1>
            <p className="text-sm text-gray-600 mt-2">N° {viewing.certificate_number}</p>
            <p className="text-sm text-gray-600">{formatDate(viewing.created_at)}</p>
          </div>
          <div className="mb-6">
            <p className="text-sm text-gray-600">Patient: <span className="font-semibold">{fullName(viewing.patient)}</span></p>
          </div>
          <div className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed mb-8">{viewing.body}</div>
          {viewing.days_off && (
            <div className="mb-6 text-sm">
              <p className="font-medium">Arrêt de travail: {viewing.days_off} jour(s)</p>
              {viewing.start_date && <p>Du {formatDate(viewing.start_date)} au {formatDate(viewing.end_date)}</p>}
            </div>
          )}
          <div className="mt-12 text-right">
            <div className="inline-block border-t border-gray-400 pt-2 px-8">
              <p className="text-sm text-gray-600">Signature et cachet</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Certificats"
        subtitle={`${certificates.length} certificat(s)`}
        actions={canEdit && <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Nouveau certificat</button>}
      />

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input className="input pl-10" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {certificates.length === 0 ? (
        <EmptyState icon={<Award className="w-12 h-12" />} title="Aucun certificat" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-header text-left px-4 py-3">N°</th>
                <th className="table-header text-left px-4 py-3">Patient</th>
                <th className="table-header text-left px-4 py-3">Type</th>
                <th className="table-header text-left px-4 py-3">Date</th>
                <th className="table-header text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {certificates.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setViewing(c)}>
                  <td className="px-4 py-3 text-sm font-mono text-blue-600">{c.certificate_number}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{fullName(c.patient)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{CERTIFICATE_TYPES.find((t) => t.value === c.type)?.label ?? c.type}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 text-right"><button onClick={(e) => { e.stopPropagation(); setViewing(c); }} className="btn-ghost btn-sm">Ouvrir →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <CertificateForm patients={patients} onClose={() => setShowForm(false)} onSave={handleCreate} />}
    </div>
  );
}

function CertificateForm({ patients, onClose, onSave }: { patients: Patient[]; onClose: () => void; onSave: (data: Partial<Certificate>) => void }) {
  const [form, setForm] = useState<Partial<Certificate>>({
    patient_id: '',
    type: 'medical',
    title: '',
    body: '',
    days_off: null,
    start_date: '',
    end_date: '',
  });

  const handlePatientChange = (id: string) => {
    setForm({ ...form, patient_id: id });
    const patient = patients.find((p) => p.id === id);
    if (patient) {
      const tpl = TEMPLATES[form.type ?? 'medical'];
      if (tpl) setForm({ ...form, patient_id: id, body: tpl(fullName(patient)) });
    }
  };

  const handleTypeChange = (type: string) => {
    const patient = patients.find((p) => p.id === form.patient_id);
    const tpl = TEMPLATES[type];
    setForm({ ...form, type: type as Certificate['type'], body: patient ? tpl(fullName(patient)) : form.body ?? '' });
  };

  return (
    <Modal open onClose={onClose} title="Nouveau certificat" size="lg">
      <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Patient *</label>
            <select className="input" required value={form.patient_id ?? ''} onChange={(e) => handlePatientChange(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{fullName(p)} — {p.patient_number}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Type *</label>
            <select className="input" value={form.type ?? ''} onChange={(e) => handleTypeChange(e.target.value)}>
              {CERTIFICATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">Titre</label><input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div><label className="label">Corps du certificat</label><textarea className="input" rows={8} value={form.body ?? ''} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
        {form.type === 'sick_leave' && (
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Jours d’arrêt</label><input type="number" className="input" value={form.days_off ?? ''} onChange={(e) => setForm({ ...form, days_off: e.target.value ? Number(e.target.value) : null })} /></div>
            <div><label className="label">Du</label><input type="date" className="input" value={form.start_date ?? ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><label className="label">Au</label><input type="date" className="input" value={form.end_date ?? ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
