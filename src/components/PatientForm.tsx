import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle, Printer,
  User, Phone, MapPin, Heart, Shield, Activity, Baby, Pill,
  FileText, AlertCircle, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { ALGERIAN_WILAYAS } from '@/lib/constants';
import { calculateAge, sexLabel, fullName, formatDate } from '@/lib/format';
import { Modal } from '@/components/ui';
import type {
  Patient, MedicalFile, Allergy, ChronicCondition,
  MedicalHistoryEntry, SurgicalHistoryEntry, FamilyHistoryEntry, Pregnancy,
} from '@/types';

// === Constants ===
const BLOOD_TYPES = ['Inconnue', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MARITAL_STATUSES = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf/Veuve'];
const EMERGENCY_RELATIONSHIPS = ['Père', 'Mère', 'Conjoint(e)', 'Frère', 'Sœur', 'Fils', 'Fille', 'Autre'];
const CHRONIC_DISEASES = ['Diabète', 'Hypertension artérielle', 'Asthme', 'Maladie cardiaque', 'Maladie rénale chronique', 'Maladie hépatique chronique', 'Épilepsie', 'Maladie thyroïdienne', 'Cancer', 'BPCO', 'Maladie rhumatismale'];
const ALLERGY_OPTIONS = ['Pénicilline', 'Antibiotiques', 'Aspirine', 'AINS', 'Latex', 'Aliments', 'Produits de contraste'];
const ALLERGY_CATEGORIES = ['Médicament', 'Aliment', 'Environnement', 'Produit chimique', 'Autre'];
const SEVERITIES = ['Légère', 'Modérée', 'Sévère', 'Inconnue'];
const FAMILY_HISTORY_OPTIONS = ['Diabète', 'Hypertension', 'Maladie cardiaque', 'Cancer', 'Maladie héréditaire'];
const RISK_FACTORS = ['Tabagisme', 'Alcool', 'Sédentarité', 'Obésité'];

const SEVERITY_MAP: Record<string, string> = { 'Légère': 'mild', 'Modérée': 'moderate', 'Sévère': 'severe', 'Inconnue': 'unknown' };
const SEVERITY_REVERSE: Record<string, string> = { 'mild': 'Légère', 'moderate': 'Modérée', 'severe': 'Sévère', 'unknown': 'Inconnue' };

// === Section component ===
function Section({ title, icon, children, defaultOpen = false, accent }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`border rounded-lg ${accent ?? 'border-gray-200'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-medium text-gray-900 text-sm">
        {icon}
        {title}
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

// === Allergy entry ===
interface AllergyEntry {
  id?: string;
  name: string;
  allergen: string;
  category: string;
  reaction: string;
  severity: string;
  notes: string;
}

// === Medical history entry ===
interface MedHistEntry {
  id?: string;
  description: string;
  approximate_date: string;
  notes: string;
}

// === Surgical history entry ===
interface SurgHistEntry {
  id?: string;
  intervention: string;
  operation_date: string;
  establishment: string;
  notes: string;
}

// === Family history entry ===
interface FamHistEntry {
  id?: string;
  condition_name: string;
  notes: string;
}

// === Main form props ===
export interface PatientFormProps {
  patient: Patient | null;
  medicalFile: MedicalFile | null;
  duplicates: string[];
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: Partial<Patient>, medicalFileData: Partial<MedicalFile>, related: RelatedData) => void;
}

export interface RelatedData {
  allergies: AllergyEntry[];
  chronicConditions: string[];
  chronicOther: string;
  medicalHistories: MedHistEntry[];
  surgicalHistories: SurgHistEntry[];
  familyHistories: FamHistEntry[];
  pregnancy: {
    is_pregnant: boolean;
    gravidity: number | null;
    parity: number | null;
    lmp_date: string | null;
    gestational_age_weeks: number | null;
    expected_term_date: string | null;
    notes: string;
  };
  riskFactors: string[];
  usualMedications: string;
  observations: string;
}

function emptyRelated(): RelatedData {
  return {
    allergies: [],
    chronicConditions: [],
    chronicOther: '',
    medicalHistories: [],
    surgicalHistories: [],
    familyHistories: [],
    pregnancy: { is_pregnant: false, gravidity: null, parity: null, lmp_date: null, gestational_age_weeks: null, expected_term_date: null, notes: '' },
    riskFactors: [],
    usualMedications: '',
    observations: '',
  };
}

export function PatientForm({ patient, medicalFile, duplicates, error, saving, onClose, onSave }: PatientFormProps) {
  const [form, setForm] = useState<Partial<Patient>>({
    first_name: patient?.first_name ?? '',
    last_name: patient?.last_name ?? '',
    date_of_birth: patient?.date_of_birth ?? '',
    sex: patient?.sex ?? null,
    cin: patient?.cin ?? '',
    phone: patient?.phone ?? '',
    email: patient?.email ?? '',
    address: patient?.address ?? '',
    wilaya: patient?.wilaya ?? '',
    commune: patient?.commune ?? '',
    emergency_contact_name: patient?.emergency_contact_name ?? '',
    emergency_contact_phone: patient?.emergency_contact_phone ?? '',
    emergency_contact_relationship: patient?.emergency_contact_relationship ?? '',
    marital_status: patient?.marital_status ?? medicalFile?.marital_status ?? '',
  });

  const [bloodType, setBloodType] = useState(medicalFile?.blood_type ?? 'Inconnue');
  const [related, setRelated] = useState<RelatedData>(emptyRelated());
  const [showPrint, setShowPrint] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Load related data when editing
  const loadRelated = useCallback(async () => {
    if (!patient) return;
    const pid = patient.id;

    const [al, cc, mh, sh, fh, preg] = await Promise.all([
      supabase.from('allergies').select('*').eq('patient_id', pid).order('created_at'),
      supabase.from('chronic_conditions').select('*').eq('patient_id', pid).order('created_at'),
      supabase.from('medical_histories').select('*').eq('patient_id', pid).order('created_at'),
      supabase.from('surgical_histories').select('*').eq('patient_id', pid).order('created_at'),
      supabase.from('family_histories').select('*').eq('patient_id', pid).order('created_at'),
      supabase.from('pregnancies').select('*').eq('patient_id', pid).order('created_at', { ascending: false }).limit(1),
    ]);

    const allergies = ((al.data as Allergy[]) ?? []).map((a) => ({
      id: a.id, name: a.name, allergen: a.allergen ?? '', category: a.category ?? '',
      reaction: a.reaction ?? '', severity: SEVERITY_REVERSE[a.severity ?? ''] ?? 'Inconnue', notes: a.notes ?? '',
    }));

    const chronicConditions = ((cc.data as ChronicCondition[]) ?? []).map((c) => c.name);
    const chronicOtherEntry = ((cc.data as ChronicCondition[]) ?? []).find((c) => !CHRONIC_DISEASES.includes(c.name));
    const chronicOther = chronicOtherEntry?.name ?? '';

    const medicalHistories = ((mh.data as MedicalHistoryEntry[]) ?? []).map((m) => ({
      id: m.id, description: m.description, approximate_date: m.approximate_date ?? '', notes: m.notes ?? '',
    }));

    const surgicalHistories = ((sh.data as SurgicalHistoryEntry[]) ?? []).map((s) => ({
      id: s.id, intervention: s.intervention, operation_date: s.operation_date ?? '', establishment: s.establishment ?? '', notes: s.notes ?? '',
    }));

    const familyHistories = ((fh.data as FamilyHistoryEntry[]) ?? []).map((f) => ({
      id: f.id, condition_name: f.condition_name, notes: f.notes ?? '',
    }));

    const pregData = (preg.data as Pregnancy[]) ?? [];
    const pregnancy = pregData.length > 0 ? {
      is_pregnant: pregData[0].is_pregnant,
      gravidity: pregData[0].gravidity,
      parity: pregData[0].parity,
      lmp_date: pregData[0].lmp_date,
      gestational_age_weeks: pregData[0].gestational_age_weeks,
      expected_term_date: pregData[0].expected_term_date,
      notes: pregData[0].notes ?? '',
    } : related.pregnancy;

    setRelated({
      allergies,
      chronicConditions: chronicConditions.filter((n) => CHRONIC_DISEASES.includes(n)),
      chronicOther,
      medicalHistories,
      surgicalHistories,
      familyHistories,
      pregnancy,
      riskFactors: medicalFile?.risk_factors ?? [],
      usualMedications: medicalFile?.usual_medications ?? '',
      observations: medicalFile?.observations ?? '',
    });
  }, [patient, medicalFile]);

  useEffect(() => { loadRelated(); }, [loadRelated]);

  // Auto-calculate age and gestational age
  const age = form.date_of_birth ? calculateAge(form.date_of_birth) : null;
  const isMinor = typeof age === 'number' && age < 18;

  // Auto-calculate gestational age from LMP
  const calcGestAge = (lmp: string): number | null => {
    if (!lmp) return null;
    const diff = Math.floor((Date.now() - new Date(lmp).getTime()) / (1000 * 60 * 60 * 24 * 7));
    return diff >= 0 && diff <= 45 ? diff : null;
  };

  // === Chronic disease toggle ===
  const toggleChronic = (disease: string) => {
    setRelated((prev) => {
      if (disease === 'Aucune') return { ...prev, chronicConditions: [], chronicOther: '' };
      const current = prev.chronicConditions.includes(disease)
        ? prev.chronicConditions.filter((d) => d !== disease)
        : [...prev.chronicConditions, disease];
      return { ...prev, chronicConditions: current };
    });
  };

  // === Allergy toggle ===
  const toggleAllergy = (allergen: string) => {
    setRelated((prev) => {
      if (allergen === 'Aucune allergie connue') return { ...prev, allergies: [] };
      const exists = prev.allergies.find((a) => a.name === allergen);
      if (exists) return { ...prev, allergies: prev.allergies.filter((a) => a.name !== allergen) };
      return {
        ...prev,
        allergies: [...prev.allergies, { name: allergen, allergen, category: '', reaction: '', severity: 'Inconnue', notes: '' }],
      };
    });
  };

  const updateAllergy = (index: number, field: keyof AllergyEntry, value: string) => {
    setRelated((prev) => {
      const allergies = [...prev.allergies];
      allergies[index] = { ...allergies[index], [field]: value };
      return { ...prev, allergies };
    });
  };

  const addCustomAllergy = () => {
    setRelated((prev) => ({
      ...prev,
      allergies: [...prev.allergies, { name: '', allergen: '', category: 'Autre', reaction: '', severity: 'Inconnue', notes: '' }],
    }));
  };

  const removeAllergy = (index: number) => {
    setRelated((prev) => ({ ...prev, allergies: prev.allergies.filter((_, i) => i !== index) }));
  };

  // === Medical history ===
  const addMedHistory = () => {
    setRelated((prev) => ({ ...prev, medicalHistories: [...prev.medicalHistories, { description: '', approximate_date: '', notes: '' }] }));
  };
  const updateMedHistory = (i: number, field: keyof MedHistEntry, value: string) => {
    setRelated((prev) => {
      const arr = [...prev.medicalHistories];
      arr[i] = { ...arr[i], [field]: value };
      return { ...prev, medicalHistories: arr };
    });
  };
  const removeMedHistory = (i: number) => {
    setRelated((prev) => ({ ...prev, medicalHistories: prev.medicalHistories.filter((_, idx) => idx !== i) }));
  };

  // === Surgical history ===
  const addSurgHistory = () => {
    setRelated((prev) => ({ ...prev, surgicalHistories: [...prev.surgicalHistories, { intervention: '', operation_date: '', establishment: '', notes: '' }] }));
  };
  const updateSurgHistory = (i: number, field: keyof SurgHistEntry, value: string) => {
    setRelated((prev) => {
      const arr = [...prev.surgicalHistories];
      arr[i] = { ...arr[i], [field]: value };
      return { ...prev, surgicalHistories: arr };
    });
  };
  const removeSurgHistory = (i: number) => {
    setRelated((prev) => ({ ...prev, surgicalHistories: prev.surgicalHistories.filter((_, idx) => idx !== i) }));
  };

  // === Family history ===
  const toggleFamilyHistory = (condition: string) => {
    setRelated((prev) => {
      const exists = prev.familyHistories.find((f) => f.condition_name === condition);
      if (exists) return { ...prev, familyHistories: prev.familyHistories.filter((f) => f.condition_name !== condition) };
      return { ...prev, familyHistories: [...prev.familyHistories, { condition_name: condition, notes: '' }] };
    });
  };
  const updateFamilyHistoryNotes = (condition: string, notes: string) => {
    setRelated((prev) => {
      const arr = [...prev.familyHistories];
      const idx = arr.findIndex((f) => f.condition_name === condition);
      if (idx >= 0) arr[idx] = { ...arr[idx], notes };
      return { ...prev, familyHistories: arr };
    });
  };
  const addCustomFamilyHistory = () => {
    setRelated((prev) => ({ ...prev, familyHistories: [...prev.familyHistories, { condition_name: '', notes: '' }] }));
  };
  const updateFamilyHistory = (i: number, field: keyof FamHistEntry, value: string) => {
    setRelated((prev) => {
      const arr = [...prev.familyHistories];
      arr[i] = { ...arr[i], [field]: value };
      return { ...prev, familyHistories: arr };
    });
  };
  const removeFamilyHistory = (i: number) => {
    setRelated((prev) => ({ ...prev, familyHistories: prev.familyHistories.filter((_, idx) => idx !== i) }));
  };

  // === Risk factors ===
  const toggleRiskFactor = (factor: string) => {
    setRelated((prev) => ({
      ...prev,
      riskFactors: prev.riskFactors.includes(factor)
        ? prev.riskFactors.filter((f) => f !== factor)
        : [...prev.riskFactors, factor],
    }));
  };

  // === Pregnancy ===
  const updatePregnancy = (field: string, value: string | boolean | number | null) => {
    setRelated((prev) => ({ ...prev, pregnancy: { ...prev.pregnancy, [field]: value } }));
  };

  // === Sex change: clear pregnancy if male ===
  const handleSexChange = (sex: 'M' | 'F') => {
    setForm((prev) => ({ ...prev, sex }));
    if (sex === 'M') {
      setRelated((prev) => ({
        ...prev,
        pregnancy: { is_pregnant: false, gravidity: null, parity: null, lmp_date: null, gestational_age_weeks: null, expected_term_date: null, notes: '' },
      }));
    }
  };

  // === Validation ===
  const validate = (): string[] => {
    const errs: string[] = [];
    if (!form.first_name?.trim()) errs.push('Prénom obligatoire');
    if (!form.last_name?.trim()) errs.push('Nom obligatoire');
    if (!form.date_of_birth) errs.push('Date de naissance obligatoire');
    if (!form.sex) errs.push('Sexe obligatoire');
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.push('Format email invalide');
    if (form.sex === 'M' && related.pregnancy.is_pregnant) errs.push('Un patient de sexe masculin ne peut pas être enceinte');
    if (related.pregnancy.is_pregnant && related.pregnancy.gestational_age_weeks !== null && (related.pregnancy.gestational_age_weeks < 0 || related.pregnancy.gestational_age_weeks > 45)) errs.push('Âge gestationnel doit être entre 0 et 45 semaines');
    if (related.chronicConditions.length > 0 && related.chronicConditions.includes('Aucune')) errs.push('Incohérence: "Aucune" et des maladies sélectionnées');
    if (related.allergies.length > 0 && related.allergies.some((a) => a.name === 'Aucune allergie connue')) errs.push('Incohérence: "Aucune allergie connue" et des allergies sélectionnées');
    return errs;
  };

  const submit = () => {
    const errs = validate();
    setValidationErrors(errs);
    if (errs.length > 0) return;

    const medicalFileData: Partial<MedicalFile> = {
      blood_type: bloodType,
      marital_status: form.marital_status ?? null,
      observations: related.observations || null,
      risk_factors: related.riskFactors,
      usual_medications: related.usualMedications || null,
    };

    // Auto-calculate gestational age if LMP is set
    let finalRelated = related;
    if (related.pregnancy.is_pregnant && related.pregnancy.lmp_date) {
      const ga = calcGestAge(related.pregnancy.lmp_date);
      finalRelated = {
        ...related,
        pregnancy: { ...related.pregnancy, gestational_age_weeks: ga },
      };
    }

    onSave(form, medicalFileData, finalRelated);
  };

  const isFemale = form.sex === 'F';

  return (
    <>
      <Modal open onClose={onClose} title={patient ? 'Modifier le patient' : 'Nouveau patient'} size="xl">
        <div className="space-y-3">
          {duplicates.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-amber-800 font-medium text-sm mb-1">
                <AlertTriangle className="w-4 h-4" /> Doublons détectés
              </div>
              <ul className="text-sm text-amber-700 list-disc list-inside">
                {duplicates.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {validationErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-800 font-medium text-sm mb-1">
                <AlertCircle className="w-4 h-4" /> Erreurs de validation
              </div>
              <ul className="text-sm text-red-700 list-disc list-inside">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* SECTION A — IDENTITÉ */}
          <Section title="Identité" icon={<User className="w-4 h-4 text-blue-600" />} defaultOpen>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Prénom *</label>
                <input className="input" value={form.first_name ?? ''} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Nom *</label>
                <input className="input" value={form.last_name ?? ''} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Date de naissance *</label>
                <input type="date" className="input" value={form.date_of_birth ?? ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
                {age !== null && typeof age === 'number' && (
                  <p className="text-xs text-gray-500 mt-1">{age} ans — {isMinor ? 'Mineur' : 'Majeur'}</p>
                )}
              </div>
              <div>
                <label className="label">Sexe *</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleSexChange('M')} className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${form.sex === 'M' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Homme</button>
                  <button type="button" onClick={() => handleSexChange('F')} className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${form.sex === 'F' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Femme</button>
                </div>
              </div>
              <div>
                <label className="label">CIN</label>
                <input className="input" value={form.cin ?? ''} onChange={(e) => setForm({ ...form, cin: e.target.value })} />
              </div>
            </div>
          </Section>

          {/* SECTION B — COORDONNÉES */}
          <Section title="Coordonnées" icon={<Phone className="w-4 h-4 text-green-600" />} defaultOpen>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Téléphone</label>
                <input className="input" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="label">Adresse</label>
                <input className="input" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <label className="label">Wilaya</label>
                <select className="input" value={form.wilaya ?? ''} onChange={(e) => setForm({ ...form, wilaya: e.target.value })}>
                  <option value="">—</option>
                  {ALGERIAN_WILAYAS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Commune</label>
                <input className="input" value={form.commune ?? ''} onChange={(e) => setForm({ ...form, commune: e.target.value })} />
              </div>
            </div>
          </Section>

          {/* SECTION C — CONTACT D'URGENCE */}
          <Section title="Contact d'urgence" icon={<Shield className="w-4 h-4 text-orange-600" />}>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Nom</label>
                <input className="input" value={form.emergency_contact_name ?? ''} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Téléphone</label>
                <input className="input" value={form.emergency_contact_phone ?? ''} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Lien avec le patient</label>
                <select className="input" value={form.emergency_contact_relationship ?? ''} onChange={(e) => setForm({ ...form, emergency_contact_relationship: e.target.value })}>
                  <option value="">—</option>
                  {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </Section>

          {/* SECTION D — SITUATION PERSONNELLE */}
          <Section title="Situation personnelle" icon={<Heart className="w-4 h-4 text-rose-600" />}>
            <div>
              <label className="label">Situation familiale</label>
              <div className="flex flex-wrap gap-2">
                {MARITAL_STATUSES.map((s) => (
                  <button key={s} type="button" onClick={() => setForm({ ...form, marital_status: form.marital_status === s ? '' : s })}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${form.marital_status === s ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {s}
                  </button>
                ))}
              </div>
              {isMinor && <p className="text-xs text-amber-600 mt-1">Patient mineur (calculé automatiquement)</p>}
            </div>
          </Section>

          {/* SECTION E — GROUPE SANGUIN */}
          <Section title="Groupe sanguin" icon={<Activity className="w-4 h-4 text-red-600" />}>
            <div>
              <label className="label">Groupe sanguin</label>
              <div className="flex flex-wrap gap-2">
                {BLOOD_TYPES.map((bt) => (
                  <button key={bt} type="button" onClick={() => setBloodType(bt)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${bloodType === bt ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {bt}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* SECTION F — MALADIES CHRONIQUES */}
          <Section title="Maladies chroniques" icon={<Activity className="w-4 h-4 text-amber-600" />}>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => toggleChronic('Aucune')}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.chronicConditions.length === 0 ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Aucune
              </button>
              {CHRONIC_DISEASES.map((d) => (
                <button key={d} type="button" onClick={() => toggleChronic(d)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.chronicConditions.includes(d) ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {d}
                </button>
              ))}
            </div>
            {related.chronicConditions.length > 0 && (
              <div>
                <label className="label">Autre maladie (préciser)</label>
                <input className="input" value={related.chronicOther} onChange={(e) => setRelated({ ...related, chronicOther: e.target.value })} placeholder="Préciser la maladie" />
              </div>
            )}
          </Section>

          {/* SECTION G — ALLERGIES */}
          <Section title="⚠️ Allergies" icon={<AlertTriangle className="w-4 h-4 text-red-600" />} accent="border-red-200">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => toggleAllergy('Aucune allergie connue')}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.allergies.length === 0 ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Aucune allergie connue
              </button>
              {ALLERGY_OPTIONS.map((a) => (
                <button key={a} type="button" onClick={() => toggleAllergy(a)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.allergies.some((al) => al.name === a) ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {a}
                </button>
              ))}
            </div>
            {related.allergies.length > 0 && (
              <div className="space-y-3 mt-2">
                {related.allergies.map((a, i) => (
                  <div key={i} className="border border-red-200 rounded-lg p-3 bg-red-50/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-red-700">{a.name || 'Allergie personnalisée'}</span>
                      <button type="button" onClick={() => removeAllergy(i)} className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="input" placeholder="Allergène" value={a.allergen} onChange={(e) => updateAllergy(i, 'allergen', e.target.value)} />
                      <select className="input" value={a.category} onChange={(e) => updateAllergy(i, 'category', e.target.value)}>
                        <option value="">Catégorie —</option>
                        {ALLERGY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input className="input" placeholder="Réaction" value={a.reaction} onChange={(e) => updateAllergy(i, 'reaction', e.target.value)} />
                      <select className="input" value={a.severity} onChange={(e) => updateAllergy(i, 'severity', e.target.value)}>
                        {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input className="input col-span-2" placeholder="Notes" value={a.notes} onChange={(e) => updateAllergy(i, 'notes', e.target.value)} />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addCustomAllergy} className="btn-secondary btn-sm">
                  <Plus className="w-4 h-4" /> Ajouter une allergie
                </button>
              </div>
            )}
          </Section>

          {/* SECTION H — ANTÉCÉDENTS MÉDICAUX */}
          <Section title="Antécédents médicaux" icon={<FileText className="w-4 h-4 text-blue-600" />}>
            <div className="space-y-2">
              {related.medicalHistories.map((m, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Antécédent {i + 1}</span>
                    <button type="button" onClick={() => removeMedHistory(i)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Description" value={m.description} onChange={(e) => updateMedHistory(i, 'description', e.target.value)} />
                    <input type="date" className="input" placeholder="Date approximative" value={m.approximate_date} onChange={(e) => updateMedHistory(i, 'approximate_date', e.target.value)} />
                    <input className="input col-span-2" placeholder="Notes" value={m.notes} onChange={(e) => updateMedHistory(i, 'notes', e.target.value)} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addMedHistory} className="btn-secondary btn-sm">
                <Plus className="w-4 h-4" /> Ajouter un antécédent
              </button>
            </div>
          </Section>

          {/* SECTION I — ANTÉCÉDENTS CHIRURGICAUX */}
          <Section title="Antécédents chirurgicaux" icon={<Activity className="w-4 h-4 text-teal-600" />}>
            <div className="space-y-2">
              {related.surgicalHistories.map((s, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Intervention {i + 1}</span>
                    <button type="button" onClick={() => removeSurgHistory(i)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Intervention / opération" value={s.intervention} onChange={(e) => updateSurgHistory(i, 'intervention', e.target.value)} />
                    <input type="date" className="input" value={s.operation_date} onChange={(e) => updateSurgHistory(i, 'operation_date', e.target.value)} />
                    <input className="input" placeholder="Établissement" value={s.establishment} onChange={(e) => updateSurgHistory(i, 'establishment', e.target.value)} />
                    <input className="input" placeholder="Notes" value={s.notes} onChange={(e) => updateSurgHistory(i, 'notes', e.target.value)} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addSurgHistory} className="btn-secondary btn-sm">
                <Plus className="w-4 h-4" /> Ajouter une intervention
              </button>
            </div>
          </Section>

          {/* SECTION J — ANTÉCÉDENTS FAMILIAUX */}
          <Section title="Antécédents familiaux" icon={<Heart className="w-4 h-4 text-purple-600" />}>
            <div className="flex flex-wrap gap-2">
              {FAMILY_HISTORY_OPTIONS.map((f) => (
                <button key={f} type="button" onClick={() => toggleFamilyHistory(f)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.familyHistories.some((fh) => fh.condition_name === f) ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {f}
                </button>
              ))}
            </div>
            {related.familyHistories.map((f, i) => (
              <input key={i} className="input" placeholder={`Notes — ${f.condition_name}`} value={f.notes} onChange={(e) => updateFamilyHistoryNotes(f.condition_name, e.target.value)} />
            ))}
            <div className="space-y-2">
              {related.familyHistories.filter((f) => !FAMILY_HISTORY_OPTIONS.includes(f.condition_name)).map((f, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input" placeholder="Autre condition" value={f.condition_name} onChange={(e) => updateFamilyHistory(i, 'condition_name', e.target.value)} />
                  <button type="button" onClick={() => removeFamilyHistory(i)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" onClick={addCustomFamilyHistory} className="btn-secondary btn-sm">
                <Plus className="w-4 h-4" /> Autre
              </button>
            </div>
          </Section>

          {/* SECTION K — GROSSESSE (Femmes uniquement) */}
          {isFemale && (
            <Section title="Grossesse / Gynécologie" icon={<Baby className="w-4 h-4 text-pink-600" />} accent="border-pink-200">
              <div>
                <label className="label">Grossesse en cours</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => updatePregnancy('is_pregnant', false)} className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${!related.pregnancy.is_pregnant ? 'border-gray-500 bg-gray-50 text-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>Non</button>
                  <button type="button" onClick={() => updatePregnancy('is_pregnant', true)} className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.pregnancy.is_pregnant ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>Oui</button>
                </div>
              </div>
              {related.pregnancy.is_pregnant && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nombre de grossesses</label>
                    <input type="number" min="0" className="input" value={related.pregnancy.gravidity ?? ''} onChange={(e) => updatePregnancy('gravidity', e.target.value ? Number(e.target.value) : null)} />
                  </div>
                  <div>
                    <label className="label">Nombre d'accouchements</label>
                    <input type="number" min="0" className="input" value={related.pregnancy.parity ?? ''} onChange={(e) => updatePregnancy('parity', e.target.value ? Number(e.target.value) : null)} />
                  </div>
                  <div>
                    <label className="label">DDR — Dernières règles</label>
                    <input type="date" className="input" value={related.pregnancy.lmp_date ?? ''} onChange={(e) => updatePregnancy('lmp_date', e.target.value || null)} />
                  </div>
                  <div>
                    <label className="label">Âge gestationnel (semaines)</label>
                    <input type="number" min="0" max="45" className="input" value={related.pregnancy.gestational_age_weeks ?? ''} onChange={(e) => updatePregnancy('gestational_age_weeks', e.target.value ? Number(e.target.value) : null)} />
                    {related.pregnancy.lmp_date && (
                      <p className="text-xs text-gray-500 mt-1">Calculé: {calcGestAge(related.pregnancy.lmp_date)} semaines</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Terme prévu</label>
                    <input type="date" className="input" value={related.pregnancy.expected_term_date ?? ''} onChange={(e) => updatePregnancy('expected_term_date', e.target.value || null)} />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Notes</label>
                    <input className="input" value={related.pregnancy.notes} onChange={(e) => updatePregnancy('notes', e.target.value)} />
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* SECTION L — MÉDICAMENTS HABITUELS & FACTEURS DE RISQUE */}
          <Section title="Médicaments habituels & facteurs de risque" icon={<Pill className="w-4 h-4 text-indigo-600" />}>
            <div>
              <label className="label">Médicaments habituels</label>
              <textarea className="input" rows={2} value={related.usualMedications} onChange={(e) => setRelated({ ...related, usualMedications: e.target.value })} placeholder="Ex: Metformine 500mg, Amlodipine 5mg..." />
            </div>
            <div>
              <label className="label">Facteurs de risque</label>
              <div className="flex flex-wrap gap-2">
                {RISK_FACTORS.map((r) => (
                  <button key={r} type="button" onClick={() => toggleRiskFactor(r)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${related.riskFactors.includes(r) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* SECTION M — OBSERVATIONS */}
          <Section title="Observations médicales" icon={<FileText className="w-4 h-4 text-gray-600" />}>
            <textarea className="input" rows={3} value={related.observations} onChange={(e) => setRelated({ ...related, observations: e.target.value })} placeholder="Observations médicales générales" />
          </Section>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            {patient && (
              <button type="button" onClick={() => setShowPrint(true)} className="btn-secondary btn-sm">
                <Printer className="w-4 h-4" /> Imprimer la fiche
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
              <button type="button" onClick={submit} disabled={saving} className="btn-primary">
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {showPrint && patient && (
        <PatientFichePrint
          patient={{ ...form, patient_number: patient.patient_number, id: patient.id, status: patient.status, created_at: patient.created_at, updated_at: patient.updated_at } as Patient}
          bloodType={bloodType}
          related={related}
          onClose={() => setShowPrint(false)}
        />
      )}
    </>
  );
}

// === Patient fiche print ===
function PatientFichePrint({ patient, bloodType, related, onClose }: {
  patient: Patient;
  bloodType: string;
  related: RelatedData;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 no-print">
          <h2 className="font-semibold text-gray-900">Fiche patient</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="btn-primary btn-sm"><Printer className="w-4 h-4" /> Imprimer</button>
            <button onClick={onClose} className="btn-secondary btn-sm"><X className="w-4 h-4" /> Fermer</button>
          </div>
        </div>
        <div className="p-8" id="patient-fiche-print">
          <div className="text-center mb-6 border-b-2 border-gray-300 pb-4">
            <h1 className="text-xl font-bold text-gray-900">CABINET MÉDICAL DZ</h1>
            <p className="text-sm text-gray-600 mt-1">Fiche patient</p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><span className="font-medium">N° Patient:</span> {patient.patient_number}</div>
            <div><span className="font-medium">CIN:</span> {patient.cin ?? '—'}</div>
            <div><span className="font-medium">Nom:</span> {patient.last_name}</div>
            <div><span className="font-medium">Prénom:</span> {patient.first_name}</div>
            <div><span className="font-medium">Date de naissance:</span> {formatDate(patient.date_of_birth)}</div>
            <div><span className="font-medium">Sexe:</span> {sexLabel(patient.sex)}</div>
            <div><span className="font-medium">Téléphone:</span> {patient.phone ?? '—'}</div>
            <div><span className="font-medium">Email:</span> {patient.email ?? '—'}</div>
            <div><span className="font-medium">Adresse:</span> {patient.address ?? '—'}</div>
            <div><span className="font-medium">Wilaya/Commune:</span> {patient.wilaya ?? '—'} {patient.commune ?? ''}</div>
            <div><span className="font-medium">Groupe sanguin:</span> {bloodType}</div>
            <div><span className="font-medium">Situation:</span> {patient.marital_status ?? '—'}</div>
            <div><span className="font-medium">Contact d'urgence:</span> {patient.emergency_contact_name ?? '—'} ({patient.emergency_contact_phone ?? '—'})</div>
            <div><span className="font-medium">Lien:</span> {patient.emergency_contact_relationship ?? '—'}</div>
          </div>
          {related.allergies.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold text-red-700 mb-1">⚠️ ALLERGIES</h3>
              <ul className="text-sm space-y-1">
                {related.allergies.map((a, i) => (
                  <li key={i}>• {a.name} {a.severity !== 'Inconnue' && `(${a.severity})`}{a.reaction && ` — Réaction: ${a.reaction}`}</li>
                ))}
              </ul>
            </div>
          )}
          {related.chronicConditions.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold text-amber-700 mb-1">Maladies chroniques</h3>
              <p className="text-sm">{related.chronicConditions.join(', ')}{related.chronicOther && `, ${related.chronicOther}`}</p>
            </div>
          )}
          {related.medicalHistories.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold text-blue-700 mb-1">Antécédents médicaux</h3>
              <ul className="text-sm space-y-1">
                {related.medicalHistories.map((m, i) => <li key={i}>• {m.description}{m.approximate_date && ` (${formatDate(m.approximate_date)})`}</li>)}
              </ul>
            </div>
          )}
          {related.surgicalHistories.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold text-teal-700 mb-1">Antécédents chirurgicaux</h3>
              <ul className="text-sm space-y-1">
                {related.surgicalHistories.map((s, i) => <li key={i}>• {s.intervention}{s.operation_date && ` (${formatDate(s.operation_date)})`}{s.establishment && ` — ${s.establishment}`}</li>)}
              </ul>
            </div>
          )}
          {related.familyHistories.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold text-purple-700 mb-1">Antécédents familiaux</h3>
              <p className="text-sm">{related.familyHistories.map((f) => f.condition_name).join(', ')}</p>
            </div>
          )}
          {patient.sex === 'F' && related.pregnancy.is_pregnant && (
            <div className="mb-4">
              <h3 className="font-bold text-pink-700 mb-1">Grossesse</h3>
              <div className="text-sm">
                <p>Grossesse en cours: Oui</p>
                {related.pregnancy.gravidity !== null && <p>Grossesses: {related.pregnancy.gravidity}</p>}
                {related.pregnancy.parity !== null && <p>Accouchements: {related.pregnancy.parity}</p>}
                {related.pregnancy.lmp_date && <p>DDR: {formatDate(related.pregnancy.lmp_date)}</p>}
                {related.pregnancy.gestational_age_weeks !== null && <p>Âge gestationnel: {related.pregnancy.gestational_age_weeks} semaines</p>}
                {related.pregnancy.expected_term_date && <p>Terme prévu: {formatDate(related.pregnancy.expected_term_date)}</p>}
              </div>
            </div>
          )}
          {related.riskFactors.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold text-indigo-700 mb-1">Facteurs de risque</h3>
              <p className="text-sm">{related.riskFactors.join(', ')}</p>
            </div>
          )}
          {related.usualMedications && (
            <div className="mb-4">
              <h3 className="font-bold text-gray-700 mb-1">Médicaments habituels</h3>
              <p className="text-sm">{related.usualMedications}</p>
            </div>
          )}
          {related.observations && (
            <div className="mb-4">
              <h3 className="font-bold text-gray-700 mb-1">Observations</h3>
              <p className="text-sm">{related.observations}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
