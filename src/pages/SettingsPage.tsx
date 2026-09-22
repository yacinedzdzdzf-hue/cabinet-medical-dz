import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, Building2, Volume2, ListChecks, Printer, Lock, DatabaseBackup, QrCode, Volume2 as VoiceIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { Loading, PageHeader } from '@/components/ui';
import type { Settings } from '@/types';

type Tab = 'clinic' | 'voice' | 'queue' | 'printer' | 'qr' | 'autolock' | 'backup';

const TABS: { value: Tab; label: string; icon: typeof Building2 }[] = [
  { value: 'clinic', label: 'Cabinet', icon: Building2 },
  { value: 'voice', label: 'Voix', icon: Volume2 },
  { value: 'queue', label: 'File d\'attente', icon: ListChecks },
  { value: 'printer', label: 'Imprimante', icon: Printer },
  { value: 'qr', label: 'QR codes', icon: QrCode },
  { value: 'autolock', label: 'Verrouillage', icon: Lock },
  { value: 'backup', label: 'Sauvegardes', icon: DatabaseBackup },
];

export default function SettingsPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('clinic');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canAccess = hasRole('ADMIN');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('settings').select('*');
    const map: Record<string, any> = {};
    (data as Settings[] | null)?.forEach((s) => { map[s.key] = s.value; });
    setSettings(map);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [canAccess, load]);

  const updateSetting = async (key: string, value: any) => {
    setSaving(true);
    setSaved(false);
    const { data: existing } = await supabase.from('settings').select('*').eq('key', key).maybeSingle();
    if (existing) {
      await supabase.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    } else {
      await supabase.from('settings').insert({ key, value });
    }
    setSettings({ ...settings, [key]: value });
    await logAudit('settings_update', 'settings', key, undefined, { key, value });

    // For voice settings, also update waiting_settings
    if (key === 'voice') {
      await supabase.from('waiting_settings').update({
        voice_enabled: value.enabled ?? false,
        voice_volume: value.volume ?? 1.0,
        voice_rate: value.rate ?? 1.0,
        voice_pitch: value.pitch ?? 1.0,
        voice_repeat_count: value.repeat_count ?? 1,
        voice_lang: value.language ?? 'fr-FR',
        updated_at: new Date().toISOString(),
      }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // For queue settings, also update waiting_settings
    if (key === 'queue') {
      await supabase.from('waiting_settings').update({
        show_patient_name: value.show_patient_name ?? true,
        updated_at: new Date().toISOString(),
      }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Paramètres" />
        <div className="card p-8 text-center text-gray-500">
          Accès réservé aux administrateurs.
        </div>
      </div>
    );
  }

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Configuration du système CMDZ" />

      <div className="flex flex-wrap gap-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`btn-sm flex items-center gap-2 ${tab === t.value ? 'btn-primary' : 'btn-secondary'}`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {saved && (
        <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Paramètres enregistrés avec succès.
        </div>
      )}

      {tab === 'clinic' && <ClinicSettings data={settings.clinic ?? {}} onSave={(v) => updateSetting('clinic', v)} saving={saving} />}
      {tab === 'voice' && <VoiceSettings data={settings.voice ?? {}} onSave={(v) => updateSetting('voice', v)} saving={saving} />}
      {tab === 'queue' && <QueueSettings data={settings.queue ?? {}} onSave={(v) => updateSetting('queue', v)} saving={saving} />}
      {tab === 'printer' && <PrinterSettings data={settings.printer ?? {}} onSave={(v) => updateSetting('printer', v)} saving={saving} />}
      {tab === 'qr' && <QrSettingsPanel data={settings.qr ?? {}} onSave={(v) => updateSetting('qr', v)} saving={saving} />}
      {tab === 'autolock' && <AutoLockSettings data={settings.autolock ?? {}} onSave={(v) => updateSetting('autolock', v)} saving={saving} />}
      {tab === 'backup' && <BackupSettings data={settings.backup ?? {}} onSave={(v) => updateSetting('backup', v)} saving={saving} />}
    </div>
  );
}

function SettingsCard({ title, children, onSave, saving }: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
      <div className="flex justify-end mt-6">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

function ClinicSettings({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    name: data.name ?? '',
    address: data.address ?? '',
    phone: data.phone ?? '',
    email: data.email ?? '',
    nif: data.nif ?? '',
    nis: data.nis ?? '',
    rc: data.rc ?? '',
    specialty: data.specialty ?? '',
    registration_number: data.registration_number ?? '',
    doctor_name: data.doctor_name ?? '',
    commune: data.commune ?? '',
    wilaya: data.wilaya ?? '',
    logo_url: data.logo_url ?? '',
    stamp_url: data.stamp_url ?? '',
    signature_url: data.signature_url ?? '',
    footer_note: data.footer_note ?? '',
  });

  return (
    <SettingsCard title="Informations du cabinet" onSave={() => onSave(form)} saving={saving}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Nom du cabinet</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Spécialité</label>
          <input className="input" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="label">Adresse</label>
        <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Téléphone</label>
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">NIF</label>
          <input className="input" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
        </div>
        <div>
          <label className="label">NIS</label>
          <input className="input" value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">RC (Registre de commerce)</label>
          <input className="input" value={form.rc} onChange={(e) => setForm({ ...form, rc: e.target.value })} />
        </div>
        <div>
          <label className="label">N° d’enregistrement</label>
          <input className="input" value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} />
        </div>
      </div>
    </SettingsCard>
  );
}

function VoiceSettings({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    enabled: data.enabled ?? false,
    volume: data.volume ?? 1.0,
    rate: data.rate ?? 1.0,
    pitch: data.pitch ?? 1.0,
    repeat_count: data.repeat_count ?? 1,
    language: data.language ?? 'fr-FR',
  });

  const testVoice = () => {
    const u = new SpeechSynthesisUtterance('Ceci est un test de la voix.');
    u.lang = form.language;
    u.volume = form.volume;
    u.rate = form.rate;
    u.pitch = form.pitch;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  return (
    <SettingsCard title="Paramètres vocaux" onSave={() => onSave(form)} saving={saving}>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-5 h-5" />
        <span className="text-sm font-medium text-gray-700">Activer l’annonce vocale</span>
      </label>
      <div>
        <label className="label">Volume ({form.volume})</label>
        <input type="range" min={0} max={1} step={0.1} value={form.volume} onChange={(e) => setForm({ ...form, volume: parseFloat(e.target.value) })} className="w-full" />
      </div>
      <div>
        <label className="label">Vitesse ({form.rate})</label>
        <input type="range" min={0.5} max={2} step={0.1} value={form.rate} onChange={(e) => setForm({ ...form, rate: parseFloat(e.target.value) })} className="w-full" />
      </div>
      <div>
        <label className="label">Tonalité ({form.pitch})</label>
        <input type="range" min={0} max={2} step={0.1} value={form.pitch} onChange={(e) => setForm({ ...form, pitch: parseFloat(e.target.value) })} className="w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Nombre de répétitions</label>
          <input type="number" min={1} max={5} className="input" value={form.repeat_count} onChange={(e) => setForm({ ...form, repeat_count: parseInt(e.target.value) || 1 })} />
        </div>
        <div>
          <label className="label">Langue</label>
          <select className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            <option value="fr-FR">Français</option>
            <option value="ar-DZ">Arabe</option>
            <option value="en-US">Anglais</option>
          </select>
        </div>
      </div>
      <button type="button" onClick={testVoice} className="btn-secondary btn-sm flex items-center gap-2">
        <VoiceIcon className="w-4 h-4" /> Tester la voix
      </button>
    </SettingsCard>
  );
}

function QueueSettings({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    show_patient_name: data.show_patient_name ?? true,
  });

  return (
    <SettingsCard title="File d’attente" onSave={() => onSave(form)} saving={saving}>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.show_patient_name} onChange={(e) => setForm({ ...form, show_patient_name: e.target.checked })} className="w-5 h-5" />
        <span className="text-sm font-medium text-gray-700">Afficher le nom du patient sur l’écran d’attente</span>
      </label>
    </SettingsCard>
  );
}

function PrinterSettings({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    default_size: data.default_size ?? 'A5',
    receipt_size: data.receipt_size ?? '80mm',
  });

  return (
    <SettingsCard title="Imprimante" onSave={() => onSave(form)} saving={saving}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Format par défaut</label>
          <select className="input" value={form.default_size} onChange={(e) => setForm({ ...form, default_size: e.target.value })}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
            <option value="58mm">58mm</option>
            <option value="80mm">80mm</option>
          </select>
        </div>
        <div>
          <label className="label">Format des reçus</label>
          <select className="input" value={form.receipt_size} onChange={(e) => setForm({ ...form, receipt_size: e.target.value })}>
            <option value="58mm">58mm</option>
            <option value="80mm">80mm</option>
            <option value="A5">A5</option>
          </select>
        </div>
      </div>
    </SettingsCard>
  );
}

function QrSettingsPanel({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    base_url: data.base_url ?? '',
    paper_size: data.paper_size ?? 'A5',
  });
  const current = `${window.location.protocol}//${window.location.host}`;

  return (
    <SettingsCard title="QR codes des ordonnances" onSave={() => onSave(form)} saving={saving}>
      <div>
        <label className="label">Adresse du serveur CMDZ</label>
        <input
          className="input"
          placeholder="http://192.168.1.10:3000"
          value={form.base_url}
          onChange={(e) => setForm({ ...form, base_url: e.target.value })}
        />
        <p className="text-xs text-gray-500 mt-1.5">
          Les QR codes imprimés utiliseront cette adresse. Si elle change, les nouvelles ordonnances
          utiliseront automatiquement la nouvelle adresse.
        </p>
      </div>

      <div>
        <label className="label">Format du papier de l’ordonnance</label>
        <select className="input" value={form.paper_size} onChange={(e) => setForm({ ...form, paper_size: e.target.value })}>
          <option value="A5">A5</option>
          <option value="A4">A4</option>
        </select>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
        <p className="text-sm font-medium text-amber-800">Réseau local requis</p>
        <p className="text-xs text-amber-700 mt-1 leading-relaxed">
          Le téléphone doit être connecté au même réseau local que le serveur CMDZ pour ouvrir un QR
          utilisant une adresse LAN. Un QR encodant une adresse locale ne fonctionne pas depuis Internet.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3">
        <p className="text-sm font-medium text-gray-800">Sécurité</p>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
          Le QR ne contient aucune donnée personnelle ni médicale : uniquement un identifiant opaque.
          Il faut être connecté à CMDZ avec un rôle autorisé (administrateur, médecin ou réception)
          pour que le dossier s’ouvre. Les écrans de salle d’attente n’ont aucun accès.
        </p>
      </div>

      <div className="text-xs text-gray-500">
        Adresse actuelle de cette session : <span className="font-mono">{current}</span>
        {!form.base_url && ' — utilisée si le champ ci-dessus reste vide.'}
      </div>
    </SettingsCard>
  );
}

function AutoLockSettings({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    enabled: data.enabled ?? false,
    timeout: data.timeout ?? 5,
  });

  return (
    <SettingsCard title="Verrouillage automatique" onSave={() => onSave(form)} saving={saving}>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-5 h-5" />
        <span className="text-sm font-medium text-gray-700">Activer le verrouillage automatique</span>
      </label>
      <div>
        <label className="label">Délai d’inactivité (minutes)</label>
        <input type="number" min={1} max={60} className="input" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: parseInt(e.target.value) || 5 })} />
      </div>
    </SettingsCard>
  );
}

function BackupSettings({ data, onSave, saving }: { data: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    frequency: data.frequency ?? 'weekly',
    enabled: data.enabled ?? true,
  });

  return (
    <SettingsCard title="Sauvegardes" onSave={() => onSave(form)} saving={saving}>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-5 h-5" />
        <span className="text-sm font-medium text-gray-700">Activer les sauvegardes automatiques</span>
      </label>
      <div>
        <label className="label">Fréquence</label>
        <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
          <option value="daily">Quotidienne</option>
          <option value="weekly">Hebdomadaire</option>
          <option value="monthly">Mensuelle</option>
        </select>
      </div>
    </SettingsCard>
  );
}
