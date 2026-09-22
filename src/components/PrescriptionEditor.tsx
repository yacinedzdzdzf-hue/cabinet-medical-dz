/*
 * PrescriptionEditor — l'unique interface d'ordonnance de CMDZ.
 *
 * Disposition : aperçu A5 (148 × 210 mm) à gauche, édition de la prescription à
 * droite. Le même composant sert toutes les entrées du dossier médical, de la
 * consultation et de la page Ordonnances, ainsi que la modification d'une
 * ordonnance existante et la duplication.
 *
 * Le patient peut être pré-sélectionné (dossier médical, consultation) ou choisi
 * manuellement (page Ordonnances). Tant qu'aucun patient n'est associé, aucun QR
 * n'est affiché.
 */

import { useEffect, useRef, useState } from 'react';
import { Pill, Plus, Printer, Save, Search, Trash2, AlertCircle, Eraser } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useCabinetInfo, toSheetCabinet } from '@/lib/cabinet';
import { ensurePrescriptionQr, loadQrSettings, renderQrSvg, resolveQrBaseUrl } from '@/lib/qr';
import { formatDate, formatDateTime, fullName, calculateAge, sexLabel } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui';
import { OrdonnanceSheet, type PaperSize } from '@/components/OrdonnanceSheet';
import { OrdonnancePreviewBox } from '@/components/OrdonnancePreviewBox';
import {
  emptyItem, isFilled, loadPrescriptionItems, nextPrescriptionNumber,
  savePrescription, toEditable, type EditableItem,
} from '@/lib/prescriptions';
import { loadPatientContext, type PatientContext } from '@/lib/patientContext';
import type { Medication, Patient, Prescription } from '@/types';

type Props = {
  /** Ordonnance existante à modifier. Absente pour une nouvelle ordonnance. */
  prescription?: Prescription | null;
  /** Patient imposé par l'entrée (dossier médical, consultation). */
  patient?: Patient | null;
  /** Consultation d'origine, pour rattacher l'ordonnance. */
  consultationId?: string | null;
  /** Auteur de l'ordonnance (médecin en cours). */
  doctorId?: string | null;
  /** Lignes pré-remplies : duplication d'une ordonnance existante. */
  initialItems?: EditableItem[];
  /** Recommandations pré-remplies (duplication). */
  initialNotes?: string;
  /** Lance l'impression dès que l'aperçu est prêt. */
  autoPrint?: boolean;
  /** Aperçu seul : la feuille A5 et l'impression, sans panneau d'édition. */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (prescriptionId: string, number: string) => void;
};

const INPUT_LABELS: { key: keyof EditableItem; label: string; placeholder: string }[] = [
  { key: 'dose', label: 'Posologie', placeholder: '1 comprimé' },
  { key: 'frequency', label: 'Fréquence', placeholder: '3 fois par jour' },
  { key: 'duration', label: 'Durée', placeholder: '5 jours' },
  { key: 'route', label: 'Voie', placeholder: 'Voie orale' },
  { key: 'qsp', label: 'QSP', placeholder: '5 jours, 1 mois' },
  { key: 'instructions', label: 'Instructions', placeholder: 'Après le repas' },
];

export function PrescriptionEditor({ prescription, patient, consultationId, doctorId, initialItems, initialNotes, autoPrint, readOnly, onClose, onSaved }: Props) {
  const { profile, hasRole } = useAuth();
  // Défense supplémentaire : même si un appelant oubliait de filtrer, l'éditeur
  // refuse de s'ouvrir pour un rôle sans droit médical. La base refuse de son côté.
  const allowed = hasRole('ADMIN', 'DOCTOR');
  const { cabinet } = useCabinetInfo();

  const [patientId, setPatientId] = useState<string>(prescription?.patient_id ?? patient?.id ?? '');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(patient ?? null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientContext, setPatientContext] = useState<PatientContext | null>(null);
  const [fileNumber, setFileNumber] = useState('');
  const [notes, setNotes] = useState(prescription?.notes ?? initialNotes ?? '');
  const [items, setItems] = useState<EditableItem[]>(initialItems ?? [emptyItem()]);
  const [number, setNumber] = useState(prescription?.prescription_number ?? '');
  // Nom imprimé sur l'ordonnance : valeur propre à cette ordonnance, le
  // patient_id n'est jamais modifié.
  const [displayName, setDisplayName] = useState(
    prescription?.patient_display_name ?? (patient ? fullName(patient) : ''),
  );
  // Date réellement choisie par le médecin (yyyy-mm-dd pour l'input date).
  const [prescriptionDate, setPrescriptionDate] = useState(
    prescription?.prescription_date ?? new Date().toISOString().slice(0, 10),
  );
  const [medications, setMedications] = useState<Medication[]>([]);
  const [medSearch, setMedSearch] = useState<Record<string, string>>({});
  const [openSearchKey, setOpenSearchKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!prescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EditableItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [printing, setPrinting] = useState(false);

  // QR : uniquement pour une ordonnance réellement enregistrée
  const [qr, setQr] = useState<{ svg: string; label: string } | null>(null);
  // Format du papier à l'impression, indépendant du zoom d'affichage.
  const [printSize, setPrintSize] = useState<PaperSize>('A5');
  const [qrLoading, setQrLoading] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const savedId = prescription?.id ?? null;
  const patientRef = useRef(patientId);
  patientRef.current = patientId;

  // Catalogue des médicaments (recherche par nom commercial ou DCI)
  useEffect(() => {
    supabase.from('medications').select('*').eq('is_active', true).order('commercial_name')
      .then(({ data }) => setMedications((data as Medication[]) ?? []));
  }, []);

  // Nouvelle ordonnance : numéro réservé côté base
  useEffect(() => {
    if (!prescription) {
      nextPrescriptionNumber().then((n) => {
        if (n) setNumber(n);
        else setError("Impossible d'obtenir un numéro d'ordonnance. Vérifiez votre connexion.");
      });
    }
  }, [prescription]);

  // Modification : chargement des lignes réellement enregistrées
  useEffect(() => {
    if (!prescription) return;
    let cancelled = false;
    setLoading(true);
    loadPrescriptionItems(prescription.id).then((rows) => {
      if (cancelled) return;
      setItems(rows.length > 0 ? rows.map(toEditable) : [emptyItem()]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [prescription]);

  // Recherche serveur des patients : nom, prénom, PAT, numéro de dossier (DM),
  // téléphone et CIN. Le DM n'est pas une colonne de « patients » : il vit dans
  // « medical_files », c'est donc le serveur qui doit faire le rapprochement.
  useEffect(() => {
    if (patient) return;
    let cancelled = false;
    const term = patientSearch.trim();
    const timer = setTimeout(() => {
      supabase.rpc('search_patients', {
        p_search: term || null,
        p_status: 'active',
        p_sort: 'name_asc',
        p_limit: 8,
        p_offset: 0,
      }).then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[ORDONNANCES] recherche patients:', error);
          setPatients([]);
          return;
        }
        const rows = (data as { patient: Patient }[]) ?? [];
        setPatients(rows.map((r) => r.patient));
      });
    }, term ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [patient, patientSearch]);

  // Sélection d'un patient (ou patient imposé) : on propose son nom réel comme
  // nom imprimé, sauf si le médecin a déjà saisi un nom personnalisé.
  useEffect(() => {
    if (selectedPatient) setDisplayName(fullName(selectedPatient));
  }, [selectedPatient]);

  // Dossier médical : numéro de dossier + contexte patient
  useEffect(() => {
    if (!patientId) { setPatientContext(null); setFileNumber(''); return; }
    let cancelled = false;
    supabase.from('medical_files').select('file_number').eq('patient_id', patientId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setFileNumber((data as { file_number: string } | null)?.file_number ?? ''); });
    loadPatientContext(patientId).then((ctx) => { if (!cancelled) setPatientContext(ctx); });
    return () => { cancelled = true; };
  }, [patientId]);

  // Le QR suit l'ordonnance réellement enregistrée, jamais un autre patient
  useEffect(() => {
    if (!savedId || !patientId) { setQr(null); return; }
    let cancelled = false;
    setQrLoading(true);
    (async () => {
      const settings = await loadQrSettings();
      const { baseUrl } = resolveQrBaseUrl(settings.baseUrl);
      const token = await ensurePrescriptionQr(savedId, baseUrl);
      if (!token) { if (!cancelled) { setQr(null); setQrLoading(false); } return; }
      const svg = await renderQrSvg(token.url, 220);
      if (!cancelled) { setQr({ svg, label: 'Accès sécurisé au dossier patient' }); setQrLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [savedId, patientId]);

  function medsFor(key: string): Medication[] {
    const q = (medSearch[key] ?? '').trim().toLowerCase();
    const list = q
      ? medications.filter((m) =>
          m.commercial_name.toLowerCase().includes(q) || (m.dci ?? '').toLowerCase().includes(q))
      : medications;
    return list.slice(0, 6);
  }

  function updateItem(key: string, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function pickMedication(key: string, med: Medication) {
    updateItem(key, {
      medication_id: med.id,
      name: med.commercial_name,
      dci: med.dci ?? '',
      strength: med.strength ?? '',
      form: med.form ?? med.pharmaceutical_form ?? '',
      dose: med.default_dosage ?? '',
      frequency: med.default_frequency ?? '',
      duration: med.default_duration ?? '',
      route: med.route ?? '',
      instructions: med.instructions ?? '',
    });
    setOpenSearchKey(null);
    setMedSearch((s) => ({ ...s, [key]: '' }));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length === 1 ? [emptyItem()] : prev.filter((it) => it.key !== key)));
    setConfirmDelete(null);
  }

  function moveItem(key: string, direction: -1 | 1) {
    setItems((prev) => {
      const index = prev.findIndex((it) => it.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  async function handleSave() {
    if (!patientId) { setError('Sélectionnez un patient avant d’enregistrer.'); return; }
    if (!items.some(isFilled)) { setError('Ajoutez au moins un médicament à la prescription.'); return; }

    setSaving(true);
    setError(null);
    const result = await savePrescription({
      id: savedId,
      patientId,
      doctorId: doctorId ?? profile?.id ?? null,
      consultationId: consultationId ?? prescription?.consultation_id ?? null,
      notes,
      items,
      patientDisplayName: displayName,
      prescriptionDate,
    });
    setSaving(false);

    if (!result.ok) { setError(result.message); return; }

    setSavedNotice(`Ordonnance ${result.number} enregistrée.`);
    onSaved(result.prescriptionId, result.number);
  }

  const print = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 60);
  };

  // Impression demandée depuis l'historique : on attend que l'aperçu soit prêt.
  const autoPrintDone = useRef(false);
  useEffect(() => {
    if (!autoPrint || autoPrintDone.current || loading || qrLoading) return;
    autoPrintDone.current = true;
    const t = setTimeout(print, 150);
    return () => clearTimeout(t);
  }, [autoPrint, loading, qrLoading]);

  const patientForSheet = selectedPatient;

  if (!allowed) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-gray-900 font-medium">Accès refusé</p>
        <p className="text-sm text-gray-500 mt-1">
          L’édition des ordonnances est réservée aux médecins et aux administrateurs.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">Chargement de l’ordonnance…</div>
    );
  }

  return (
    <div className={readOnly ? '' : 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)] gap-5'}>
      {/* ---------------- Aperçu A5 (gauche) ---------------- */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="no-print">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Pill className="w-4 h-4 text-blue-600" />
              {prescription ? `Ordonnance ${prescription.prescription_number}` : 'Nouvelle ordonnance'}
            </h2>
            <p className="text-xs text-gray-500">Aperçu à l’écran — le document reste en A5, l’impression suit le format choisi</p>
          </div>
          {readOnly && (
            <div className="no-print flex items-center gap-2">
              <button onClick={onClose} className="btn-secondary btn-sm">Fermer</button>
            </div>
          )}
        </div>

        <OrdonnancePreviewBox
          sheetRef={sheetRef}
          printSize={printSize}
          onPrintSizeChange={setPrintSize}
          onPrint={print}
          printing={printing}
          storageKey="cmdz-ordonnance-print-size"
        >
          {(zoom, size) => (
            <OrdonnanceSheet
              cabinet={toSheetCabinet({ ...cabinet, doctor_name: cabinet.doctor_name || (profile?.full_name ?? '') })}
              patient={patientForSheet ? {
                fullName: displayName.trim() || fullName(patientForSheet),
                patientNumber: patientForSheet.patient_number ?? '',
                fileNumber,
                dateOfBirth: patientForSheet.date_of_birth ? formatDate(patientForSheet.date_of_birth) : null,
                age: calculateAge(patientForSheet.date_of_birth),
                sexLabel: sexLabel(patientForSheet.sex),
                cin: patientForSheet.cin ?? '',
              } : null}
              number={number}
              dateLabel={formatDate(prescriptionDate)}
              items={items.filter(isFilled).map((it) => ({
                id: it.key, name: it.name, dci: it.dci, strength: it.strength, form: it.form,
                dose: it.dose, frequency: it.frequency, duration: it.duration, route: it.route,
                timing: it.timing, instructions: it.instructions, qsp: it.qsp,
              }))}
              recommendations={notes}
              printSize={size}
              zoom={zoom}
              qr={patientId ? { svg: qr?.svg ?? '', label: qr?.label ?? 'Accès sécurisé au dossier patient', loading: qrLoading } : null}
            />
          )}
        </OrdonnancePreviewBox>
      </div>

      {/* ---------------- Éditeur de prescription (droite) ---------------- */}
      {!readOnly && (
      <div className="no-print space-y-4">
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Ordonnance</h3>

          {!patient ? (
            <div>
              <label className="label">Patient</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  className="input pl-9"
                  placeholder="Rechercher un patient (nom, PAT, DM, téléphone, CIN)"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                />
              </div>
              {!selectedPatient ? (
                <div className="mt-2 border border-gray-200 dark:border-slate-800 rounded-lg divide-y divide-gray-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                  {patients.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-400">Aucun patient trouvé</p>
                  ) : patients.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPatient(p); setPatientId(p.id); }}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{fullName(p)}</p>
                      <p className="text-xs text-gray-500 font-mono">{p.patient_number}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{fullName(selectedPatient)}</p>
                    <p className="text-xs text-gray-600 font-mono">
                      {selectedPatient.patient_number}{fileNumber ? ` • ${fileNumber}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => { setSelectedPatient(null); setPatientId(''); }}
                    className="text-xs text-blue-700 hover:underline"
                  >
                    Changer
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 px-3 py-2.5">
              <p className="text-xs text-gray-500">Patient</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{fullName(patient)}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                {patient.patient_number}{fileNumber ? ` • ${fileNumber}` : ''}
              </p>
            </div>
          )}

          <div className="mt-3">
            <label className="label" htmlFor="presc-display-name">Nom et prénom du patient</label>
            <input
              id="presc-display-name"
              className="input font-medium"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nom imprimé sur l’ordonnance"
            />
            <p className="text-xs text-gray-500 mt-1">
              Ce nom figure sur l’ordonnance. Le dossier du patient n’est pas modifié.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="label" htmlFor="presc-date">Date de prescription</label>
              <input
                id="presc-date"
                type="date"
                className="input"
                value={prescriptionDate}
                onChange={(e) => setPrescriptionDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">N° ordonnance</label>
              <input className="input font-mono" value={number} disabled />
            </div>
          </div>

          {prescription?.updated_at && (
            <p className="text-xs text-gray-500 mt-2">
              Dernière modification : {formatDateTime(prescription.updated_at)}
            </p>
          )}

          {selectedPatient && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Date de naissance</label>
                <input className="input" value={selectedPatient.date_of_birth ? formatDate(selectedPatient.date_of_birth) : '—'} disabled readOnly />
              </div>
              <div>
                <label className="label">Âge</label>
                <input className="input" value={`${calculateAge(selectedPatient.date_of_birth)} ans`} disabled readOnly />
              </div>
            </div>
          )}

          {patientContext && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-medium text-amber-800">Contexte médical</p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                {[
                  patientContext.allergies.length ? `Allergies : ${patientContext.allergies.map((a) => a.allergen || a.name).join(', ')}` : '',
                  patientContext.histories.length ? `Antécédents : ${patientContext.histories.map((h) => h.description).join(', ')}` : '',
                ].filter(Boolean).join(' — ') || 'Aucun élément signalé'}
              </p>
            </div>
          )}
        </div>

        {/* Médicaments */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">Médicaments</h3>
            <span className="text-xs text-gray-500">{items.filter(isFilled).length} prescrit(s)</span>
          </div>

          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={item.key} className="border border-gray-200 dark:border-slate-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-blue-600">{String(index + 1).padStart(2, '0')}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveItem(item.key, -1)} disabled={index === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Monter">↑</button>
                    <button onClick={() => moveItem(item.key, 1)} disabled={index === items.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Descendre">↓</button>
                    <button onClick={() => (isFilled(item) ? setConfirmDelete(item) : removeItem(item.key))} className="p-1 text-gray-400 hover:text-red-600" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <input
                    className="input font-medium"
                    placeholder="Médicament (nom commercial)"
                    value={item.name}
                    onFocus={() => setOpenSearchKey(item.key)}
                    onChange={(e) => { updateItem(item.key, { name: e.target.value, medication_id: null }); setOpenSearchKey(item.key); }}
                  />
                  {openSearchKey === item.key && (
                    <>
                      <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpenSearchKey(null)} aria-label="Fermer la liste" />
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                        <input
                          className="input border-0 border-b border-gray-100 dark:border-slate-800 rounded-none text-sm"
                          placeholder="Filtrer par nom ou DCI…"
                          value={medSearch[item.key] ?? ''}
                          onChange={(e) => setMedSearch((s) => ({ ...s, [item.key]: e.target.value }))}
                        />
                        {medsFor(item.key).length === 0 ? (
                          <p className="px-3 py-2.5 text-sm text-gray-400">Aucun médicament trouvé — saisie libre conservée</p>
                        ) : medsFor(item.key).map((m) => (
                          <button key={m.id} onClick={() => pickMedication(item.key, m)} className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-800">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {m.commercial_name}{m.strength ? ` ${m.strength}` : ''}
                            </p>
                            <p className="text-xs text-gray-500">{[m.dci, m.form ?? m.pharmaceutical_form].filter(Boolean).join(' • ')}</p>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input className="input" placeholder="Dosage (ex. 1 g)" value={item.strength} onChange={(e) => updateItem(item.key, { strength: e.target.value })} />
                  <input className="input" placeholder="DCI" value={item.dci} onChange={(e) => updateItem(item.key, { dci: e.target.value })} />
                </div>
                <input className="input mt-2" placeholder="Forme (ex. comprimé)" value={item.form} onChange={(e) => updateItem(item.key, { form: e.target.value })} />

                <div className="grid grid-cols-2 gap-2 mt-2">
                  {INPUT_LABELS.map((f) => (
                    <div key={f.key}>
                      <label className="text-[11px] text-gray-500">{f.label}</label>
                      <input
                        className="input"
                        placeholder={f.placeholder}
                        value={String(item[f.key] ?? '')}
                        onChange={(e) => updateItem(item.key, { [f.key]: e.target.value } as Partial<EditableItem>)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button onClick={addItem} className="btn-secondary w-full mt-3">
            <Plus className="w-4 h-4" /> Ajouter un médicament
          </button>
        </div>

        {/* Recommandations */}
        <div className="card p-4">
          <label className="label">Recommandations</label>
          <textarea
            className="input min-h-[90px]"
            placeholder="Repos, régime, conseils au patient…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {savedNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            {savedNotice}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center">
            <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button onClick={print} disabled={printing} className="btn-secondary">
            <Printer className="w-4 h-4" /> {printing ? 'Préparation…' : 'Imprimer / PDF'}
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            disabled={savedId !== null}
            className="btn-secondary text-red-600"
            title={savedId ? 'Une ordonnance enregistrée ne peut pas être vidée ici' : 'Vider la prescription en cours'}
          >
            <Eraser className="w-4 h-4" /> Effacer
          </button>
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>

        {!savedId && (
          <p className="text-xs text-gray-500">
            Enregistrez l’ordonnance pour générer son QR code d’accès au dossier.
          </p>
        )}
      </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          setItems([emptyItem()]);
          setNotes('');
          setError(null);
          setSavedNotice(null);
          setConfirmClear(false);
          // Nouveau numéro : une ordonnance vidée devient une nouvelle ordonnance
          nextPrescriptionNumber().then((n) => { if (n) setNumber(n); });
        }}
        title="Effacer la prescription"
        message="Vider tous les médicaments et les recommandations de cet écran ?"
        confirmLabel="Effacer"
        danger
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removeItem(confirmDelete.key)}
        title="Supprimer ce médicament"
        message={confirmDelete ? `Retirer « ${confirmDelete.name} » de la prescription ?` : ''}
        confirmLabel="Supprimer"
        danger
      />
    </div>
  );
}

