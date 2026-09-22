import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Stethoscope, Pill, FileText, Award, BellRing, Calendar,
  Plus, Eye, Download, Printer, Trash2, Archive, RotateCcw,
  Activity, Image, FlaskConical, Clock, User, AlertTriangle,
  ScanLine, ClipboardList, ChevronRight, MoreVertical,
  Heart, Droplet, ShieldAlert, Baby, Edit2, FilePlus,
  UserCircle, Phone, CreditCard,
} from 'lucide-react';
import { supabase, MEDICAL_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName, formatDate, formatDateTime, formatTimeOnly, calculateAge, sexLabel } from '@/lib/format';
import { Loading, EmptyState, Badge, ConfirmDialog } from '@/components/ui';
import { DocumentViewer } from '@/components/DocumentViewer';
import { AddDocumentModal } from '@/components/AddDocumentModal';
import { AddConsultationModal } from '@/components/AddConsultationModal';
import { AppointmentModal } from '@/components/AppointmentModal';
import type {
  Patient, MedicalFile, Consultation, Prescription, PrescriptionItem, Certificate,
  MedicalDocument, Appointment, FollowUp, Invoice, Allergy, ChronicCondition,
  PatientMedication, LabResult, RadiologyExam, Profile,
  Pregnancy, MedicalHistoryEntry, SurgicalHistoryEntry, FamilyHistoryEntry,
} from '@/types';

type Tab = 'overview' | 'consultations' | 'prescriptions' | 'documents' | 'labs' | 'radiology' | 'certificates' | 'followups' | 'appointments' | 'billing' | 'timeline';

// === Sex-based theme ===
type Theme = {
  primary: string; primaryText: string; primaryBg: string; primaryBgLight: string;
  primaryBorder: string; primaryHover: string; primary50: string; primary100: string;
  primary600: string; primary700: string; badge: string; avatarBg: string;
};

const maleTheme: Theme = {
  primary: 'blue', primaryText: 'text-blue-600', primaryBg: 'bg-blue-600',
  primaryBgLight: 'bg-blue-50', primaryBorder: 'border-blue-200',
  primaryHover: 'hover:bg-blue-700', primary50: 'bg-blue-50', primary100: 'bg-blue-100',
  primary600: 'text-blue-600', primary700: 'text-blue-700',
  badge: 'bg-blue-100 text-blue-700 border-blue-200', avatarBg: 'bg-blue-600',
};

const femaleTheme: Theme = {
  primary: 'pink', primaryText: 'text-pink-600', primaryBg: 'bg-pink-600',
  primaryBgLight: 'bg-pink-50', primaryBorder: 'border-pink-200',
  primaryHover: 'hover:bg-pink-700', primary50: 'bg-pink-50', primary100: 'bg-pink-100',
  primary600: 'text-pink-600', primary700: 'text-pink-700',
  badge: 'bg-pink-100 text-pink-700 border-pink-200', avatarBg: 'bg-pink-600',
};

const neutralTheme: Theme = {
  primary: 'gray', primaryText: 'text-gray-600', primaryBg: 'bg-gray-600',
  primaryBgLight: 'bg-gray-50', primaryBorder: 'border-gray-200',
  primaryHover: 'hover:bg-gray-700', primary50: 'bg-gray-50', primary100: 'bg-gray-100',
  primary600: 'text-gray-600', primary700: 'text-gray-700',
  badge: 'bg-gray-100 text-gray-600 border-gray-200', avatarBg: 'bg-gray-500',
};

function getTheme(sex: 'M' | 'F' | null): Theme {
  if (sex === 'M') return maleTheme;
  if (sex === 'F') return femaleTheme;
  return neutralTheme;
}

const SEVERITY_LABELS: Record<string, string> = {
  mild: 'Légère', moderate: 'Modérée', severe: 'Sévère', unknown: 'Inconnue',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Programmé', arrived: 'Présent', no_show: 'Absent',
  cancelled: 'Annulé', completed: 'Terminé', postponed: 'Reporté', in_consultation: 'En consultation',
};

export function PatientDetailPage({ patientId, onBack, onNavigate }: {
  patientId: string;
  onBack: () => void;
  onNavigate: (path: string) => void;
}) {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [medicalFile, setMedicalFile] = useState<MedicalFile | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [prescriptionItems, setPrescriptionItems] = useState<Record<string, PrescriptionItem[]>>({});
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [chronicConditions, setChronicConditions] = useState<ChronicCondition[]>([]);
  const [medications, setMedications] = useState<PatientMedication[]>([]);
  const [labResults, setLabResults] = useState<LabResult[]>([]);
  const [radiologyExams, setRadiologyExams] = useState<RadiologyExam[]>([]);
  const [pregnancy, setPregnancy] = useState<Pregnancy | null>(null);
  const [medicalHistories, setMedicalHistories] = useState<MedicalHistoryEntry[]>([]);
  const [surgicalHistories, setSurgicalHistories] = useState<SurgicalHistoryEntry[]>([]);
  const [familyHistories, setFamilyHistories] = useState<FamilyHistoryEntry[]>([]);

  const [showAddDoc, setShowAddDoc] = useState(false);
  const [showAddConsult, setShowAddConsult] = useState(false);
  const [showAppointment, setShowAppointment] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<MedicalDocument | null>(null);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<MedicalDocument | null>(null);
  const [confirmArchiveDoc, setConfirmArchiveDoc] = useState<MedicalDocument | null>(null);
  const [confirmArchivePatient, setConfirmArchivePatient] = useState(false);
  const [confirmDeletePatient, setConfirmDeletePatient] = useState(false);
  const [confirmDeletePatient2, setConfirmDeletePatient2] = useState(false);
  const [deletingPatient, setDeletingPatient] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const canEditMedical = hasRole('ADMIN', 'DOCTOR');
  const canManageDocs = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');
  const canDeleteDocs = hasRole('ADMIN', 'DOCTOR');
  const canManagePatient = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: p } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle();
    setPatient(p as Patient | null);

    const { data: mf } = await supabase.from('medical_files').select('*').eq('patient_id', patientId).maybeSingle();
    setMedicalFile(mf as MedicalFile | null);

    const [c, p2, cert, d, a, f, i, al, cc, m, lr, re, preg, mh, sh, fh] = await Promise.all([
      supabase.from('consultations').select('*, doctor:profiles(*)').eq('patient_id', patientId).order('created_at', { ascending: false }),
      canEditMedical
        ? supabase.from('prescriptions').select('*, doctor:profiles(*)').eq('patient_id', patientId).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase.from('certificates').select('*, doctor:profiles(*)').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('medical_documents').select('*').eq('patient_id', patientId).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('appointments').select('*, doctor:profiles(*)').eq('patient_id', patientId).order('appointment_date', { ascending: false }),
      supabase.from('follow_ups').select('*').eq('patient_id', patientId).order('follow_up_date', { ascending: false }),
      supabase.from('invoices').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('allergies').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('chronic_conditions').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('patient_medications').select('*').eq('patient_id', patientId).eq('is_current', true).order('created_at', { ascending: false }),
      supabase.from('lab_results').select('*').eq('patient_id', patientId).order('result_date', { ascending: false }),
      supabase.from('radiology_exams').select('*').eq('patient_id', patientId).order('exam_date', { ascending: false }),
      supabase.from('pregnancies').select('*').eq('patient_id', patientId).maybeSingle(),
      supabase.from('medical_histories').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('surgical_histories').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('family_histories').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    ]);

    setConsultations((c.data as Consultation[]) ?? []);
    const prescs = (p2.data as Prescription[]) ?? [];
    setPrescriptions(prescs);
    setCertificates((cert.data as Certificate[]) ?? []);
    setDocuments((d.data as MedicalDocument[]) ?? []);
    setAppointments((a.data as Appointment[]) ?? []);
    setFollowUps((f.data as FollowUp[]) ?? []);
    setInvoices((i.data as Invoice[]) ?? []);
    setAllergies((al.data as Allergy[]) ?? []);
    setChronicConditions((cc.data as ChronicCondition[]) ?? []);
    setMedications((m.data as PatientMedication[]) ?? []);
    setLabResults((lr.data as LabResult[]) ?? []);
    setRadiologyExams((re.data as RadiologyExam[]) ?? []);
    setPregnancy((preg.data as Pregnancy) ?? null);
    setMedicalHistories((mh.data as MedicalHistoryEntry[]) ?? []);
    setSurgicalHistories((sh.data as SurgicalHistoryEntry[]) ?? []);
    setFamilyHistories((fh.data as FamilyHistoryEntry[]) ?? []);

    const itemsMap: Record<string, PrescriptionItem[]> = {};
    for (const presc of prescs) {
      const { data: items } = await supabase.from('prescription_items').select('*').eq('prescription_id', presc.id).order('sort_order');
      itemsMap[presc.id] = (items as PrescriptionItem[]) ?? [];
    }
    setPrescriptionItems(itemsMap);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleDownload = async (doc: MedicalDocument) => {
    const { data, error } = await supabase.storage.from(MEDICAL_BUCKET).createSignedUrl(doc.file_path, 3600);
    if (error) { alert(error.message); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = doc.name;
    a.click();
    await logAudit('document_download', 'medical_document', doc.id, doc.name);
  };

  const handleArchiveDoc = async (doc: MedicalDocument) => {
    await supabase.from('medical_documents').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', doc.id);
    await logAudit('document_archive', 'medical_document', doc.id, doc.name);
    setConfirmArchiveDoc(null);
    load();
  };

  const handleDeleteDoc = async (doc: MedicalDocument) => {
    await supabase.storage.from(MEDICAL_BUCKET).remove([doc.file_path]);
    await supabase.from('medical_documents').delete().eq('id', doc.id);
    await logAudit('document_delete', 'medical_document', doc.id, doc.name);
    setConfirmDeleteDoc(null);
    load();
  };

  const handleArchivePatient = async () => {
    if (!patient) return;
    const nowIso = new Date().toISOString();
    await supabase.from('patients').update({
      status: 'archived', archived_at: nowIso, archived_by: profile?.id ?? null,
      archived_by_name: profile?.full_name ?? null, updated_at: nowIso,
    }).eq('id', patient.id);
    await logAudit('PATIENT_ARCHIVED', 'patient', patient.id, `${patient.patient_number} — ${fullName(patient)}`, {
      user: profile?.full_name, role: profile?.role, patient_id: patient.id, pat: patient.patient_number, patient_name: fullName(patient), archived_at: nowIso,
    }, { id: profile?.id, name: profile?.full_name });
    setConfirmArchivePatient(false);
    load();
  };

  const handleRestorePatient = async () => {
    if (!patient) return;
    await supabase.from('patients').update({
      status: 'active', archived_at: null, archived_by: null, archived_by_name: null,
      updated_at: new Date().toISOString(),
    }).eq('id', patient.id);
    await logAudit('PATIENT_RESTORED', 'patient', patient.id, `${patient.patient_number} — ${fullName(patient)}`, {
      user: profile?.full_name, role: profile?.role, patient_id: patient.id, pat: patient.patient_number, patient_name: fullName(patient),
    }, { id: profile?.id, name: profile?.full_name });
    setMoreMenuOpen(false);
    load();
  };

  const handleDeletePatient = async () => {
    if (!patient) return;
    setDeletingPatient(true);
    try {
      const { data: docs } = await supabase.from('medical_documents').select('file_path').eq('patient_id', patient.id);
      const filePaths = ((docs as MedicalDocument[]) ?? []).map((d) => d.file_path).filter(Boolean);
      if (filePaths.length > 0) await supabase.storage.from(MEDICAL_BUCKET).remove(filePaths);

      await logAudit('PATIENT_DELETED', 'patient', patient.id, `${patient.patient_number} — ${fullName(patient)}`, {
        user: profile?.full_name, role: profile?.role, patient_id: patient.id, pat: patient.patient_number, patient_name: fullName(patient),
      });

      const { error: delErr } = await supabase.from('patients').delete().eq('id', patient.id);
      if (delErr) throw delErr;

      setConfirmDeletePatient2(false);
      onBack();
    } catch (e) {
      console.error(e);
    }
    setDeletingPatient(false);
  };

  if (loading) return <Loading />;
  if (!patient) return <EmptyState icon={<User className="w-12 h-12" />} title="Patient introuvable" />;

  const theme = getTheme(patient.sex);
  const initials = `${patient.first_name?.[0] ?? ''}${patient.last_name?.[0] ?? ''}`.toUpperCase();

  // === Next appointment ===
  const todayStr = new Date().toISOString().split('T')[0];
  const nextAppt = appointments
    .filter((a) => a.appointment_date >= todayStr && !['cancelled', 'completed'].includes(a.status))
    .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date) || a.appointment_time.localeCompare(b.appointment_time))[0];

  // === Alert system ===
  type AlertItem = { level: 'critical' | 'important' | 'info'; title: string; content: string; source?: string; date?: string };
  const alerts: AlertItem[] = [];

  for (const a of allergies) {
    alerts.push({
      level: a.severity === 'severe' ? 'critical' : 'important',
      title: 'ALLERGIE',
      content: `${a.name}${a.reaction ? ` — Réaction : ${a.reaction}` : ''}${a.severity ? ` — Gravité : ${SEVERITY_LABELS[a.severity] ?? a.severity}` : ''}`,
      source: 'Allergies',
      date: formatDate(a.created_at),
    });
  }

  for (const c of chronicConditions) {
    alerts.push({
      level: 'important',
      title: 'MALADIE CHRONIQUE',
      content: c.name,
      source: 'Maladies chroniques',
      date: c.diagnosed_date ? formatDate(c.diagnosed_date) : undefined,
    });
  }

  if (patient.sex === 'F' && pregnancy?.is_pregnant) {
    alerts.push({
      level: 'critical',
      title: 'GROSSESSE EN COURS',
      content: `Âge gestationnel : ${pregnancy.gestational_age_weeks ?? '?'} semaines${pregnancy.expected_term_date ? ` — Terme prévu : ${formatDate(pregnancy.expected_term_date)}` : ''}`,
      source: 'Grossesse',
    });
  }

  if (medicalFile?.risk_factors && medicalFile.risk_factors.length > 0) {
    for (const rf of medicalFile.risk_factors) {
      alerts.push({
        level: 'important',
        title: 'FACTEUR DE RISQUE',
        content: rf,
        source: 'Dossier médical',
      });
    }
  }

  if (medicalFile?.usual_medications) {
    alerts.push({
      level: 'info',
      title: 'MÉDICAMENT HABITUEL',
      content: medicalFile.usual_medications,
      source: 'Dossier médical',
    });
  }

  for (const m of medications) {
    alerts.push({
      level: 'info',
      title: 'MÉDICATION ACTIVE',
      content: `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.frequency ? ` — ${m.frequency}` : ''}`,
      source: 'Médicaments actuels',
    });
  }

  for (const mh of medicalHistories) {
    alerts.push({
      level: 'info',
      title: 'ANTÉCÉDENT MÉDICAL',
      content: `${mh.description}${mh.approximate_date ? ` (${formatDate(mh.approximate_date)})` : ''}`,
      source: 'Antécédents médicaux',
    });
  }

  const tabs: { key: Tab; label: string; icon: typeof Stethoscope; count?: number }[] = [
    { key: 'overview', label: 'Vue d\'ensemble', icon: ClipboardList },
    { key: 'consultations', label: 'Consultations', icon: Stethoscope, count: consultations.length },
    ...(canEditMedical ? [{ key: 'prescriptions' as const, label: 'Ordonnances', icon: Pill, count: prescriptions.length }] : []),
    { key: 'documents', label: 'Documents', icon: FileText, count: documents.length },
    { key: 'labs', label: 'Analyses', icon: FlaskConical, count: labResults.length },
    { key: 'radiology', label: 'Radiologie', icon: ScanLine, count: radiologyExams.length },
    { key: 'certificates', label: 'Certificats', icon: Award, count: certificates.length },
    { key: 'followups', label: 'Suivi', icon: BellRing, count: followUps.length },
    { key: 'appointments', label: 'Rendez-vous', icon: Calendar, count: appointments.length },
    { key: 'billing', label: 'Facturation', icon: Activity, count: invoices.length },
    { key: 'timeline', label: 'Chronologie', icon: Clock },
  ];

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Retour à la liste
      </button>

      {/* === PATIENT HEADER === */}
      <div className={`rounded-2xl shadow-sm border ${theme.primaryBorder} overflow-hidden`}>
        <div className={`${theme.primaryBgLight} px-6 py-5`}>
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className={`w-16 h-16 rounded-2xl ${theme.avatarBg} flex items-center justify-center text-white text-2xl font-bold flex-shrink-0 shadow-md`}>
                {initials || <User className="w-8 h-8" />}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{fullName(patient)}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="font-mono text-sm font-medium text-gray-600">{patient.patient_number}</span>
                  {medicalFile && (
                    <>
                      <span className="text-gray-300">•</span>
                      <span className="font-mono text-sm font-medium text-gray-600">{medicalFile.file_number}</span>
                    </>
                  )}
                  <span className="text-gray-300">•</span>
                  <Badge className={theme.badge}>{sexLabel(patient.sex)}</Badge>
                  <Badge className={patient.status === 'active' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                    {patient.status === 'active' ? 'Actif' : 'Archivé'}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {calculateAge(patient.date_of_birth)} ans — Né(e) le {formatDate(patient.date_of_birth)}
                </p>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              {canEditMedical && (
                <button onClick={() => setShowAddConsult(true)} className={`btn-sm ${theme.primaryBg} text-white ${theme.primaryHover} px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium shadow-sm transition-all`}>
                  <Stethoscope className="w-4 h-4" /> Consultation
                </button>
              )}
              {canEditMedical && (
                <button onClick={() => onNavigate(`/prescriptions?patient=${patientId}&new=1`)} className={`btn-sm ${theme.primaryBg} text-white ${theme.primaryHover} px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium shadow-sm transition-all`}>
                  <Pill className="w-4 h-4" /> Ordonnance
                </button>
              )}
              {canManageDocs && patient.status === 'active' && (
                <button onClick={() => setShowAppointment(true)} className="btn-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium shadow-sm transition-all">
                  <Calendar className="w-4 h-4" /> Rendez-vous
                </button>
              )}
              {canManageDocs && (
                <button onClick={() => setShowAddDoc(true)} className="btn-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium shadow-sm transition-all">
                  <FilePlus className="w-4 h-4" /> Document
                </button>
              )}

              {/* More menu */}
              {canManagePatient && (
                <div className="relative" ref={moreMenuRef}>
                  <button onClick={() => setMoreMenuOpen(!moreMenuOpen)} className="btn-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium shadow-sm">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {moreMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                      <button onClick={() => { onNavigate(`/patients?edit=${patient.id}`); setMoreMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                        <Edit2 className="w-4 h-4" /> Modifier le patient
                      </button>
                      <button onClick={() => { window.print(); setMoreMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                        <Printer className="w-4 h-4" /> Imprimer la fiche
                      </button>
                      <div className="border-t border-gray-100 my-1" />
                      {patient.status === 'active' ? (
                        <button onClick={() => { setConfirmArchivePatient(true); setMoreMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                          <Archive className="w-4 h-4" /> Archiver
                        </button>
                      ) : (
                        <button onClick={handleRestorePatient} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4" /> Restaurer
                        </button>
                      )}
                      <button onClick={() => { setConfirmDeletePatient(true); setMoreMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                        <Trash2 className="w-4 h-4" /> Supprimer définitivement
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === CRITICAL ALERTS === */}
      {alerts.filter((a) => a.level === 'critical' || a.level === 'important').length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Informations importantes pour le médecin
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {alerts.filter((a) => a.level === 'critical').map((a, i) => (
              <div key={`c-${i}`} className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert className="w-4 h-4 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-red-700 uppercase tracking-wide">{a.title}</p>
                  <p className="text-sm text-gray-800 mt-0.5">{a.content}</p>
                  {a.date && <p className="text-xs text-gray-400 mt-0.5">{a.date}</p>}
                </div>
              </div>
            ))}
            {alerts.filter((a) => a.level === 'important').map((a, i) => (
              <div key={`i-${i}`} className="flex items-start gap-2.5 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-orange-700 uppercase tracking-wide">{a.title}</p>
                  <p className="text-sm text-gray-800 mt-0.5">{a.content}</p>
                  {a.date && <p className="text-xs text-gray-400 mt-0.5">{a.date}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === SUMMARY CARDS === */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard icon={<Droplet className="w-5 h-5" />} label="Groupe sanguin" value={medicalFile?.blood_type ?? '—'} theme={theme} />
        <SummaryCard icon={<ShieldAlert className="w-5 h-5" />} label="Allergies" value={allergies.length > 0 ? `${allergies.length}` : 'Aucune'} theme={theme} alert={allergies.length > 0} onClick={() => setTab('overview')} />
        <SummaryCard icon={<Activity className="w-5 h-5" />} label="Maladies chroniques" value={chronicConditions.length > 0 ? `${chronicConditions.length}` : 'Aucune'} theme={theme} onClick={() => setTab('overview')} />
        <SummaryCard icon={<Pill className="w-5 h-5" />} label="Médicaments actuels" value={medications.length > 0 ? `${medications.length}` : 'Aucun'} theme={theme} onClick={() => setTab('overview')} />
        <SummaryCard icon={<Stethoscope className="w-5 h-5" />} label="Dernière consultation" value={consultations.length > 0 ? formatDate(consultations[0].created_at) : '—'} theme={theme} onClick={() => setTab('consultations')} />
        <SummaryCard icon={<Calendar className="w-5 h-5" />} label="Prochain rendez-vous" value={nextAppt ? `${formatDate(nextAppt.appointment_date)} ${formatTimeOnly(nextAppt.appointment_time)}` : '—'} theme={theme} onClick={() => setTab('appointments')} />
      </div>

      {/* === TAB NAVIGATION === */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 overflow-x-auto scrollbar-thin">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                active ? `${theme.primaryBorder.replace('border-', 'border-b-')} ${theme.primary600}` : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              style={active ? { borderBottomColor: theme.primary === 'blue' ? '#2563eb' : theme.primary === 'pink' ? '#db2777' : '#4b5563' } : {}}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? theme.primary100 : 'bg-gray-100'} ${active ? theme.primary600 : 'text-gray-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* === TAB CONTENT === */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-5">
        {tab === 'overview' && (
          <OverviewTab
            patient={patient} medicalFile={medicalFile} allergies={allergies} chronicConditions={chronicConditions}
            medications={medications} pregnancy={pregnancy} medicalHistories={medicalHistories}
            surgicalHistories={surgicalHistories} familyHistories={familyHistories}
            consultations={consultations} prescriptions={prescriptions} documents={documents}
            labResults={labResults} radiologyExams={radiologyExams} appointments={appointments}
            theme={theme} canEdit={canManagePatient} onEdit={() => onNavigate(`/patients?edit=${patient.id}`)}
            onTabChange={setTab}
          />
        )}

        {tab === 'consultations' && (
          <div className="space-y-3">
            <SectionHeader title="Consultations" count={consultations.length} icon={<Stethoscope className="w-5 h-5" />} />
            {consultations.length === 0 ? <CompactEmpty icon={<Stethoscope className="w-8 h-8" />} message="Aucune consultation enregistrée" /> :
              consultations.map((c) => (
                <div key={c.id} className="border border-gray-200 rounded-xl p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => onNavigate(`/consultations?id=${c.id}`)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-900">{formatDateTime(c.created_at)}</span>
                    <div className="flex items-center gap-2">
                      {c.doctor && <span className="text-xs text-gray-500">{(c.doctor as Profile).full_name}</span>}
                      <Badge className={c.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' : c.status === 'in_progress' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                        {c.status === 'completed' ? 'Terminée' : c.status === 'in_progress' ? 'En cours' : 'Annulée'}
                      </Badge>
                    </div>
                  </div>
                  {c.chief_complaint && <p className="text-sm text-gray-600"><span className="font-medium">Motif:</span> {c.chief_complaint}</p>}
                  {c.diagnosis && <p className="text-sm text-gray-600 mt-1"><span className="font-medium">Diagnostic:</span> {c.diagnosis}</p>}
                  <button className="btn-ghost btn-sm mt-2 text-blue-600">Ouvrir <ChevronRight className="w-3 h-3" /></button>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'prescriptions' && (
          <div className="space-y-3">
            <SectionHeader title="Ordonnances" count={prescriptions.length} icon={<Pill className="w-5 h-5" />} />
            {prescriptions.length === 0 ? <CompactEmpty icon={<Pill className="w-8 h-8" />} message="Aucune ordonnance enregistrée" /> :
              prescriptions.map((p) => (
                <div key={p.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-medium text-blue-600">{p.prescription_number}</span>
                    <div className="flex items-center gap-2">
                      {p.doctor && <span className="text-xs text-gray-500">{(p.doctor as Profile).full_name}</span>}
                      <span className="text-sm text-gray-500">{formatDate(p.prescription_date ?? p.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{prescriptionItems[p.id]?.length ?? 0} médicament(s)</p>
                  {prescriptionItems[p.id] && prescriptionItems[p.id].length > 0 && (
                    <ul className="text-sm space-y-1 mb-2">
                      {prescriptionItems[p.id].slice(0, 3).map((item) => (
                        <li key={item.id} className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                          {item.name} {item.strength} — {item.dose} {item.frequency}
                        </li>
                      ))}
                      {prescriptionItems[p.id].length > 3 && <li className="text-gray-400 italic text-xs">+{prescriptionItems[p.id].length - 3} autre(s)</li>}
                    </ul>
                  )}
                  <div className="flex gap-1">
                    <button onClick={() => onNavigate(`/prescriptions?id=${p.id}`)} className="btn-ghost btn-sm"><Eye className="w-4 h-4" /> Voir</button>
                    <button onClick={() => window.print()} className="btn-ghost btn-sm"><Printer className="w-4 h-4" /> Imprimer</button>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'documents' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader title="Documents" count={documents.length} icon={<FileText className="w-5 h-5" />} inline />
              {canManageDocs && (
                <button onClick={() => setShowAddDoc(true)} className="btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              )}
            </div>
            {documents.length === 0 ? <CompactEmpty icon={<FileText className="w-8 h-8" />} message="Aucun document. Ajoutez des analyses, radiographies, comptes-rendus..." /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="table-header text-left px-4 py-3">Date</th>
                      <th className="table-header text-left px-4 py-3">Type</th>
                      <th className="table-header text-left px-4 py-3">Document</th>
                      <th className="table-header text-left px-4 py-3">Description</th>
                      <th className="table-header text-left px-4 py-3">Ajouté par</th>
                      <th className="table-header text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {documents.map((d) => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(d.document_date ?? d.created_at)}</td>
                        <td className="px-4 py-3"><Badge className="bg-gray-100 text-gray-600 border-gray-200">{d.document_type ?? d.file_type}</Badge></td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-32 truncate">{d.description ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{d.uploaded_by_name ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setViewingDoc(d)} className="btn-ghost btn-sm" title="Voir"><Eye className="w-4 h-4" /></button>
                            <button onClick={() => handleDownload(d)} className="btn-ghost btn-sm" title="Télécharger"><Download className="w-4 h-4" /></button>
                            <button onClick={() => window.print()} className="btn-ghost btn-sm" title="Imprimer"><Printer className="w-4 h-4" /></button>
                            {canDeleteDocs && (
                              <button onClick={() => setConfirmArchiveDoc(d)} className="btn-ghost btn-sm" title="Archiver"><Archive className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'labs' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader title="Analyses" count={labResults.length} icon={<FlaskConical className="w-5 h-5" />} inline />
              {canManageDocs && (
                <button onClick={() => setShowAddDoc(true)} className="btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              )}
            </div>
            {labResults.length === 0 ? (
              <CompactEmpty icon={<FlaskConical className="w-8 h-8" />} message="Aucune analyse de laboratoire" />
            ) : (
              <div className="space-y-3">
                {labResults.map((lr) => (
                  <div key={lr.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200">{lr.lab_type}</Badge>
                        {lr.lab_subtype && <span className="text-sm text-gray-600 ml-2">{lr.lab_subtype}</span>}
                      </div>
                      <span className="text-sm text-gray-500">{formatDate(lr.result_date)}</span>
                    </div>
                    {lr.comment && <p className="text-sm text-gray-600">{lr.comment}</p>}
                  </div>
                ))}
              </div>
            )}
            {documents.filter((d) => ['lab_result', 'blood_test', 'urinalysis', 'ecg'].includes(d.document_type ?? d.file_type)).length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Documents d'analyse</h4>
                <div className="space-y-2">
                  {documents.filter((d) => ['lab_result', 'blood_test', 'urinalysis', 'ecg'].includes(d.document_type ?? d.file_type)).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 border border-gray-200 rounded-lg p-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{d.name}</p>
                        <p className="text-xs text-gray-500">{formatDate(d.document_date ?? d.created_at)}</p>
                      </div>
                      <button onClick={() => setViewingDoc(d)} className="btn-ghost btn-sm"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => handleDownload(d)} className="btn-ghost btn-sm"><Download className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'radiology' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader title="Radiologie / Imagerie" count={radiologyExams.length} icon={<ScanLine className="w-5 h-5" />} inline />
              {canManageDocs && (
                <button onClick={() => setShowAddDoc(true)} className="btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              )}
            </div>
            {radiologyExams.length === 0 ? (
              <CompactEmpty icon={<ScanLine className="w-8 h-8" />} message="Aucun examen d'imagerie" />
            ) : (
              <div className="space-y-3">
                {radiologyExams.map((re) => (
                  <div key={re.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Badge className="bg-purple-100 text-purple-700 border-purple-200">{re.exam_type}</Badge>
                      <span className="text-sm text-gray-500">{formatDate(re.exam_date)}</span>
                    </div>
                    {re.indication && <p className="text-sm"><span className="font-medium">Indication:</span> {re.indication}</p>}
                    {re.report && <p className="text-sm text-gray-600 mt-1">{re.report}</p>}
                    {re.doctor_name && <p className="text-xs text-gray-500 mt-1">Médecin: {re.doctor_name}</p>}
                  </div>
                ))}
              </div>
            )}
            {documents.filter((d) => ['xray', 'ct_scan', 'mri', 'ultrasound', 'radiography', 'imaging'].includes(d.document_type ?? d.file_type)).length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Documents d'imagerie</h4>
                <div className="space-y-2">
                  {documents.filter((d) => ['xray', 'ct_scan', 'mri', 'ultrasound', 'radiography', 'imaging'].includes(d.document_type ?? d.file_type)).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 border border-gray-200 rounded-lg p-3">
                      <Image className="w-5 h-5 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{d.name}</p>
                        <p className="text-xs text-gray-500">{formatDate(d.document_date ?? d.created_at)}</p>
                      </div>
                      <button onClick={() => setViewingDoc(d)} className="btn-ghost btn-sm"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => handleDownload(d)} className="btn-ghost btn-sm"><Download className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'certificates' && (
          <div className="space-y-3">
            <SectionHeader title="Certificats" count={certificates.length} icon={<Award className="w-5 h-5" />} />
            {certificates.length === 0 ? <CompactEmpty icon={<Award className="w-8 h-8" />} message="Aucun certificat enregistré" /> :
              certificates.map((c) => (
                <div key={c.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-900">{c.title || c.type}</span>
                    <span className="text-sm text-gray-500">{formatDate(c.created_at)}</span>
                  </div>
                  {c.body && <p className="text-sm text-gray-600 line-clamp-2">{c.body}</p>}
                  <button onClick={() => onNavigate(`/certificates?id=${c.id}`)} className="btn-ghost btn-sm mt-2">Ouvrir <ChevronRight className="w-3 h-3" /></button>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'followups' && (
          <div className="space-y-3">
            <SectionHeader title="Suivi" count={followUps.length} icon={<BellRing className="w-5 h-5" />} />
            {followUps.length === 0 ? <CompactEmpty icon={<BellRing className="w-8 h-8" />} message="Aucun suivi enregistré" /> :
              followUps.map((f) => (
                <div key={f.id} className="border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatDate(f.follow_up_date)}</p>
                    <p className="text-xs text-gray-500">{f.reason || '—'}</p>
                  </div>
                  <Badge className={f.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' : f.status === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                    {f.status === 'completed' ? 'Terminé' : f.status === 'pending' ? 'En attente' : 'Annulé'}
                  </Badge>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'appointments' && (
          <div className="space-y-3">
            <SectionHeader title="Rendez-vous" count={appointments.length} icon={<Calendar className="w-5 h-5" />} />
            {appointments.length === 0 ? <CompactEmpty icon={<Calendar className="w-8 h-8" />} message="Aucun rendez-vous enregistré" /> :
              appointments.map((a) => (
                <div key={a.id} className="border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatDate(a.appointment_date)} à {formatTimeOnly(a.appointment_time)}</p>
                    <p className="text-xs text-gray-500">{a.reason || '—'}</p>
                    {a.doctor && <p className="text-xs text-gray-500">{(a.doctor as Profile).full_name}</p>}
                  </div>
                  <Badge className={a.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' : a.status === 'cancelled' ? 'bg-red-100 text-red-700 border-red-200' : a.status === 'scheduled' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                    {STATUS_LABELS[a.status] ?? a.status}
                  </Badge>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'billing' && (
          <div className="space-y-3">
            <SectionHeader title="Facturation" count={invoices.length} icon={<Activity className="w-5 h-5" />} />
            {invoices.length === 0 ? <CompactEmpty icon={<CreditCard className="w-8 h-8" />} message="Aucune facture enregistrée" /> :
              invoices.map((inv) => (
                <div key={inv.id} className="border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-medium text-blue-600">{inv.invoice_number}</p>
                    <p className="text-xs text-gray-500">{formatDate(inv.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{new Intl.NumberFormat('fr-DZ').format(inv.total)} DA</p>
                    <Badge className={inv.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : inv.status === 'partially_paid' ? 'bg-amber-100 text-amber-700 border-amber-200' : inv.status === 'cancelled' ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-red-100 text-red-700 border-red-200'}>
                      {inv.status === 'paid' ? 'Payée' : inv.status === 'partially_paid' ? 'Partiellement payée' : inv.status === 'cancelled' ? 'Annulée' : 'Impayée'}
                    </Badge>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'timeline' && (
          <TimelineTab
            consultations={consultations} prescriptions={prescriptions} certificates={certificates}
            documents={documents} labResults={labResults} radiologyExams={radiologyExams}
            followUps={followUps} appointments={appointments} theme={theme}
          />
        )}
      </div>

      {/* === MODALS === */}
      {showAddDoc && patient && (
        <AddDocumentModal patient={patient} onClose={() => setShowAddDoc(false)} onSaved={() => { setShowAddDoc(false); load(); }} />
      )}
      {showAddConsult && patient && (
        <AddConsultationModal patient={patient} onClose={() => setShowAddConsult(false)} onSaved={() => { setShowAddConsult(false); load(); }} />
      )}
      {showAppointment && patient && (
        <AppointmentModal patient={patient} medicalFile={medicalFile} onClose={() => setShowAppointment(false)} onCreated={() => { setShowAppointment(false); load(); }} />
      )}
      {viewingDoc && <DocumentViewer doc={viewingDoc} onClose={() => setViewingDoc(null)} />}

      <ConfirmDialog
        open={!!confirmArchiveDoc}
        onClose={() => setConfirmArchiveDoc(null)}
        onConfirm={() => confirmArchiveDoc && handleArchiveDoc(confirmArchiveDoc)}
        title="Archiver le document"
        message={`Archiver « ${confirmArchiveDoc?.name} » ? Le document ne sera plus visible mais restera en base.`}
        confirmLabel="Archiver"
      />
      <ConfirmDialog
        open={!!confirmDeleteDoc}
        onClose={() => setConfirmDeleteDoc(null)}
        onConfirm={() => confirmDeleteDoc && handleDeleteDoc(confirmDeleteDoc)}
        title="Supprimer le document"
        message={`Supprimer définitivement « ${confirmDeleteDoc?.name} » ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        danger
      />
      <ConfirmDialog
        open={confirmArchivePatient}
        onClose={() => setConfirmArchivePatient(false)}
        onConfirm={handleArchivePatient}
        title="Archiver le patient"
        message={`Voulez-vous vraiment archiver ${patient ? fullName(patient) : ''} ? Le patient ne sera plus visible dans les listes actives. Aucune donnée ne sera supprimée.`}
        confirmLabel="Archiver"
      />
      <ConfirmDialog
        open={confirmDeletePatient}
        onClose={() => setConfirmDeletePatient(false)}
        onConfirm={() => { setConfirmDeletePatient2(true); setConfirmDeletePatient(false); }}
        title="Suppression définitive"
        message="Attention : la suppression définitive du patient supprimera définitivement ses données et les informations associées. Cette action est irréversible."
        confirmLabel="Continuer"
        danger
      />
      <ConfirmDialog
        open={confirmDeletePatient2}
        onClose={() => setConfirmDeletePatient2(false)}
        onConfirm={handleDeletePatient}
        title="Confirmer la suppression définitive"
        message={`Êtes-vous absolument sûr de vouloir supprimer définitivement ${patient ? fullName(patient) + ' (' + patient.patient_number + ')' : ''} ? Toutes les consultations, ordonnances, documents, factures et historique seront définitivement supprimés. Cette action est IRRÉVERSIBLE.`}
        confirmLabel={deletingPatient ? 'Suppression...' : 'Supprimer définitivement'}
        danger
      />
    </div>
  );
}

// === SUB-COMPONENTS ===

function SummaryCard({ icon, label, value, theme, alert, onClick }: {
  icon: React.ReactNode; label: string; value: string; theme: Theme; alert?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border ${alert ? 'border-red-200' : 'border-gray-100'} shadow-sm p-3.5 hover:shadow-md transition-all ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-8 h-8 rounded-lg ${alert ? 'bg-red-50' : theme.primaryBgLight} flex items-center justify-center ${alert ? 'text-red-600' : theme.primary600}`}>
          {icon}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </button>
  );
}

function SectionHeader({ title, count, icon, inline }: {
  title: string; count?: number; icon: React.ReactNode; inline?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${inline ? '' : 'mb-3'}`}>
      <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500">{icon}</div>
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {count !== undefined && <span className="text-xs text-gray-400">({count})</span>}
    </div>
  );
}

function CompactEmpty({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-gray-400">
      <div className="mb-2 opacity-50">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value || '—'}</p>
    </div>
  );
}

function OverviewTab({
  patient, medicalFile, allergies, chronicConditions, medications, pregnancy,
  medicalHistories, surgicalHistories, familyHistories, consultations, prescriptions,
  documents, labResults, radiologyExams, appointments, theme, canEdit, onEdit, onTabChange,
}: {
  patient: Patient; medicalFile: MedicalFile | null; allergies: Allergy[];
  chronicConditions: ChronicCondition[]; medications: PatientMedication[];
  pregnancy: Pregnancy | null; medicalHistories: MedicalHistoryEntry[];
  surgicalHistories: SurgicalHistoryEntry[]; familyHistories: FamilyHistoryEntry[];
  consultations: Consultation[]; prescriptions: Prescription[]; documents: MedicalDocument[];
  labResults: LabResult[]; radiologyExams: RadiologyExam[]; appointments: Appointment[];
  theme: Theme; canEdit: boolean; onEdit: () => void; onTabChange: (t: Tab) => void;
}) {
  const todayStr = new Date().toISOString().split('T')[0];
  const nextAppt = appointments
    .filter((a) => a.appointment_date >= todayStr && !['cancelled', 'completed'].includes(a.status))
    .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date) || a.appointment_time.localeCompare(b.appointment_time))[0];

  return (
    <div className="space-y-6">
      {/* A. Alert summary (compact if no critical alerts) */}
      {allergies.length === 0 && chronicConditions.length === 0 && !(patient.sex === 'F' && pregnancy?.is_pregnant) && (medicalFile?.risk_factors ?? []).length === 0 && (
        <div className="flex items-center gap-2.5 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-4 h-4 text-green-600" />
          </div>
          <p className="text-sm text-green-700 font-medium">Aucune alerte médicale enregistrée</p>
        </div>
      )}

      {/* B. Personal info */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-gray-400" /> Informations du patient
          </h3>
          {canEdit && (
            <button onClick={onEdit} className="btn-ghost btn-sm text-blue-600">
              <Edit2 className="w-3.5 h-3.5" /> Modifier
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="N° Patient (PAT)" value={patient.patient_number} />
          <InfoRow label="N° Dossier (DM)" value={medicalFile?.file_number} />
          <InfoRow label="Nom" value={patient.last_name} />
          <InfoRow label="Prénom" value={patient.first_name} />
          <InfoRow label="Date de naissance" value={formatDate(patient.date_of_birth)} />
          <InfoRow label="Âge" value={`${calculateAge(patient.date_of_birth)} ans`} />
          <InfoRow label="Sexe" value={sexLabel(patient.sex)} />
          <InfoRow label="CIN" value={patient.cin} />
          <InfoRow label="Téléphone" value={patient.phone} />
          <InfoRow label="Email" value={patient.email} />
          <InfoRow label="Adresse" value={patient.address} />
          <InfoRow label="Wilaya" value={patient.wilaya} />
          <InfoRow label="Commune" value={patient.commune} />
          <InfoRow label="Situation familiale" value={patient.marital_status} />
        </div>
      </div>

      {/* C. Emergency contact */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Phone className="w-5 h-5 text-gray-400" /> Contact d'urgence
          </h3>
          {canEdit && (
            <button onClick={onEdit} className="btn-ghost btn-sm text-blue-600">
              <Edit2 className="w-3.5 h-3.5" /> Modifier
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <InfoRow label="Nom" value={patient.emergency_contact_name} />
          <InfoRow label="Téléphone" value={patient.emergency_contact_phone} />
          <InfoRow label="Lien avec le patient" value={patient.emergency_contact_relationship} />
        </div>
      </div>

      {/* D. Allergies */}
      <div className={`bg-white border ${allergies.length > 0 ? 'border-red-200' : 'border-gray-100'} rounded-xl p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            {allergies.length > 0 ? <ShieldAlert className="w-5 h-5 text-red-500" /> : <ShieldAlert className="w-5 h-5 text-gray-400" />}
            Allergies
            {allergies.length > 0 && <Badge className="bg-red-100 text-red-700 border-red-200">{allergies.length}</Badge>}
          </h3>
          {canEdit && (
            <button onClick={onEdit} className="btn-ghost btn-sm text-blue-600">
              <Edit2 className="w-3.5 h-3.5" /> Modifier
            </button>
          )}
        </div>
        {allergies.length === 0 ? (
          <CompactEmpty icon={<ShieldAlert className="w-8 h-8" />} message="Aucune allergie connue" />
        ) : (
          <div className="space-y-2">
            {allergies.map((a) => (
              <div key={a.id} className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 ${a.severity === 'severe' ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
                <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${a.severity === 'severe' ? 'text-red-600' : 'text-orange-600'}`} />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{a.name}</p>
                  {a.reaction && <p className="text-xs text-gray-600 mt-0.5">Réaction : {a.reaction}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    {a.severity && <Badge className={a.severity === 'severe' ? 'bg-red-100 text-red-700 border-red-200' : a.severity === 'moderate' ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-gray-100 text-gray-600 border-gray-200'}>
                      Gravité : {SEVERITY_LABELS[a.severity] ?? a.severity}
                    </Badge>}
                    {a.allergen && <span className="text-xs text-gray-400">{a.allergen}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* E. Chronic conditions */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-orange-500" /> Maladies chroniques
            {chronicConditions.length > 0 && <Badge className="bg-orange-100 text-orange-700 border-orange-200">{chronicConditions.length}</Badge>}
          </h3>
          {canEdit && (
            <button onClick={onEdit} className="btn-ghost btn-sm text-blue-600">
              <Edit2 className="w-3.5 h-3.5" /> Modifier
            </button>
          )}
        </div>
        {chronicConditions.length === 0 ? (
          <CompactEmpty icon={<Activity className="w-8 h-8" />} message="Aucune maladie chronique enregistrée" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {chronicConditions.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-sm font-medium px-3 py-1.5 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                {c.name}
                {c.diagnosed_date && <span className="text-xs text-orange-400 ml-1">({formatDate(c.diagnosed_date)})</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* F. Current medications */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Pill className={`w-5 h-5 ${theme.primary600}`} /> Médicaments actuels
            {medications.length > 0 && <Badge className={theme.badge}>{medications.length}</Badge>}
          </h3>
        </div>
        {medications.length === 0 ? (
          <CompactEmpty icon={<Pill className="w-8 h-8" />} message="Aucun médicament actuel" />
        ) : (
          <div className="space-y-2">
            {medications.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2.5">
                <div className={`w-8 h-8 rounded-lg ${theme.primaryBgLight} flex items-center justify-center ${theme.primary600} flex-shrink-0`}>
                  <Pill className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{m.name}</p>
                  <p className="text-xs text-gray-500">
                    {[m.dose, m.frequency, m.route, m.duration].filter(Boolean).join(' • ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* G. Medical histories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-gray-400" /> Antécédents médicaux
          </h3>
          {medicalHistories.length === 0 ? (
            <p className="text-xs text-gray-400">Aucun antécédent médical</p>
          ) : (
            <div className="space-y-2">
              {medicalHistories.map((mh) => (
                <div key={mh.id} className="flex items-start gap-2 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-gray-800">{mh.description}</p>
                    {mh.approximate_date && <p className="text-xs text-gray-400">{formatDate(mh.approximate_date)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-gray-400" /> Antécédents chirurgicaux
          </h3>
          {surgicalHistories.length === 0 ? (
            <p className="text-xs text-gray-400">Aucun antécédent chirurgical</p>
          ) : (
            <div className="space-y-2">
              {surgicalHistories.map((sh) => (
                <div key={sh.id} className="flex items-start gap-2 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-gray-800">{sh.intervention}</p>
                    {sh.operation_date && <p className="text-xs text-gray-400">{formatDate(sh.operation_date)}{sh.establishment ? ` — ${sh.establishment}` : ''}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <Heart className="w-4 h-4 text-gray-400" /> Antécédents familiaux
          </h3>
          {familyHistories.length === 0 ? (
            <p className="text-xs text-gray-400">Aucun antécédent familial</p>
          ) : (
            <div className="space-y-2">
              {familyHistories.map((fh) => (
                <div key={fh.id} className="flex items-start gap-2 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-gray-800">{fh.condition_name}</p>
                    {fh.notes && <p className="text-xs text-gray-400">{fh.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* H. Pregnancy (only for female patients) */}
      {patient.sex === 'F' && pregnancy && (
        <div className="bg-pink-50 border border-pink-200 rounded-xl p-4">
          <h3 className="font-semibold text-pink-700 flex items-center gap-2 mb-3">
            <Baby className="w-5 h-5" /> Informations obstétricales
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoRow label="Enceinte" value={pregnancy.is_pregnant ? 'Oui' : 'Non'} />
            <InfoRow label="Grossesses" value={pregnancy.gravidity?.toString()} />
            <InfoRow label="Accouchements" value={pregnancy.parity?.toString()} />
            <InfoRow label="DDR" value={formatDate(pregnancy.lmp_date)} />
            <InfoRow label="Âge gestationnel" value={pregnancy.gestational_age_weeks ? `${pregnancy.gestational_age_weeks} semaines` : null} />
            <InfoRow label="Terme prévu" value={formatDate(pregnancy.expected_term_date)} />
          </div>
          {pregnancy.notes && <p className="text-sm text-gray-600 mt-3 bg-white/50 rounded-lg p-2">{pregnancy.notes}</p>}
        </div>
      )}

      {/* I. Recent consultations */}
      {consultations.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Stethoscope className={`w-5 h-5 ${theme.primary600}`} /> Dernières consultations
            </h3>
            <button onClick={() => onTabChange('consultations')} className="text-sm text-blue-600 hover:underline">Voir tout</button>
          </div>
          <div className="space-y-2">
            {consultations.slice(0, 3).map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-sm border-l-2 border-gray-200 pl-3 py-1">
                <div className="flex-1">
                  <p className="font-medium text-gray-800">{formatDate(c.created_at)}</p>
                  <p className="text-xs text-gray-500">{c.chief_complaint || '—'}</p>
                </div>
                {c.doctor && <span className="text-xs text-gray-400">{(c.doctor as Profile).full_name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* J. Recent prescriptions */}
      {prescriptions.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Pill className={`w-5 h-5 ${theme.primary600}`} /> Dernières ordonnances
            </h3>
            <button onClick={() => onTabChange('prescriptions')} className="text-sm text-blue-600 hover:underline">Voir tout</button>
          </div>
          <div className="space-y-2">
            {prescriptions.slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center gap-3 text-sm border-l-2 border-gray-200 pl-3 py-1">
                <div className="flex-1">
                  <p className="font-mono text-xs text-blue-600">{p.prescription_number}</p>
                  <p className="text-xs text-gray-500">{formatDate(p.prescription_date ?? p.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* K. Recent documents / labs / radiology */}
      {(documents.length > 0 || labResults.length > 0 || radiologyExams.length > 0) && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className={`w-5 h-5 ${theme.primary600}`} /> Derniers documents
            </h3>
            <button onClick={() => onTabChange('documents')} className="text-sm text-blue-600 hover:underline">Voir tout</button>
          </div>
          <div className="space-y-2">
            {documents.slice(0, 3).map((d) => (
              <div key={d.id} className="flex items-center gap-3 text-sm border-l-2 border-gray-200 pl-3 py-1">
                <FileText className="w-4 h-4 text-gray-400" />
                <div className="flex-1">
                  <p className="text-gray-800">{d.name}</p>
                  <p className="text-xs text-gray-400">{formatDate(d.document_date ?? d.created_at)}</p>
                </div>
                <Badge className="bg-gray-100 text-gray-600 border-gray-200">{d.document_type ?? d.file_type}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* L. Next appointment */}
      {nextAppt && (
        <div className={`bg-white border ${theme.primaryBorder} rounded-xl p-4`}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Calendar className={`w-5 h-5 ${theme.primary600}`} /> Prochain rendez-vous
          </h3>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${theme.primaryBgLight} flex items-center justify-center ${theme.primary600}`}>
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{formatDate(nextAppt.appointment_date)} à {formatTimeOnly(nextAppt.appointment_time)}</p>
              <p className="text-xs text-gray-500">{nextAppt.reason || '—'}</p>
            </div>
            <button onClick={() => onTabChange('appointments')} className="ml-auto btn-ghost btn-sm text-blue-600">Voir</button>
          </div>
        </div>
      )}

      {/* Notes */}
      {medicalFile?.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-semibold text-amber-700 text-sm mb-2">Notes du dossier</h3>
          <p className="text-sm text-gray-700">{medicalFile.notes}</p>
        </div>
      )}
    </div>
  );
}

function TimelineTab({
  consultations, prescriptions, certificates, documents, labResults,
  radiologyExams, followUps, appointments, theme,
}: {
  consultations: Consultation[]; prescriptions: Prescription[]; certificates: Certificate[];
  documents: MedicalDocument[]; labResults: LabResult[]; radiologyExams: RadiologyExam[];
  followUps: FollowUp[]; appointments: Appointment[]; theme: Theme;
}) {
  type TimelineItem = { date: string; label: string; desc: string; sub?: string; icon: string };
  const items: TimelineItem[] = [
    ...consultations.map((c) => ({ date: c.created_at, label: 'Consultation', desc: c.chief_complaint ?? '', sub: c.doctor ? (c.doctor as Profile).full_name : undefined, icon: 'stethoscope' })),
    ...prescriptions.map((p) => ({ date: p.prescription_date ?? p.created_at, label: 'Ordonnance', desc: p.prescription_number, icon: 'pill' })),
    ...certificates.map((c) => ({ date: c.created_at, label: 'Certificat', desc: c.title ?? c.type, icon: 'award' })),
    ...documents.map((d) => ({ date: d.created_at, label: 'Document', desc: d.name, icon: 'file' })),
    ...labResults.map((lr) => ({ date: lr.created_at, label: 'Analyse', desc: `${lr.lab_type}${lr.lab_subtype ? ' — ' + lr.lab_subtype : ''}`, icon: 'flask' })),
    ...radiologyExams.map((re) => ({ date: re.created_at, label: 'Radiologie', desc: `${re.exam_type} — ${formatDate(re.exam_date)}`, icon: 'xray' })),
    ...followUps.map((f) => ({ date: f.follow_up_date, label: 'Suivi', desc: f.reason ?? '', icon: 'bell' })),
    ...appointments.map((a) => ({ date: a.appointment_date, label: 'Rendez-vous', desc: a.reason ?? '', icon: 'calendar' })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (items.length === 0) return <CompactEmpty icon={<Clock className="w-8 h-8" />} message="Aucun événement dans la chronologie" />;

  const iconMap: Record<string, typeof Stethoscope> = {
    stethoscope: Stethoscope, pill: Pill, award: Award, file: FileText,
    flask: FlaskConical, xray: ScanLine, bell: BellRing, calendar: Calendar,
  };

  return (
    <div className="relative">
      <div className={`absolute left-4 top-0 bottom-0 w-0.5 ${theme.primaryBgLight}`} />
      <div className="space-y-3">
        {items.map((item, i) => {
          const Icon = iconMap[item.icon] ?? Clock;
          return (
            <div key={i} className="flex gap-3 items-start relative">
              <div className={`w-8 h-8 rounded-full ${theme.primaryBgLight} flex items-center justify-center flex-shrink-0 z-10 border-2 border-white shadow-sm`}>
                <Icon className={`w-4 h-4 ${theme.primary600}`} />
              </div>
              <div className="flex-1 pb-3">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500">{formatDate(item.date)}{item.desc ? ` — ${item.desc}` : ''}</p>
                {item.sub && <p className="text-xs text-gray-400 mt-0.5">{item.sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

