import { useState, useRef } from 'react';
import { Upload, X, FileText, AlertCircle } from 'lucide-react';
import { supabase, MEDICAL_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { Modal } from '@/components/ui';
import type { Patient, MedicalDocument } from '@/types';

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'lab_result', label: 'Analyse de laboratoire' },
  { value: 'blood_test', label: 'Bilan sanguin' },
  { value: 'urinalysis', label: 'Analyse d\'urine' },
  { value: 'ecg', label: 'ECG' },
  { value: 'xray', label: 'Radiographie / Radio' },
  { value: 'ct_scan', label: 'Scanner / CT' },
  { value: 'mri', label: 'IRM' },
  { value: 'ultrasound', label: 'Échographie' },
  { value: 'report', label: 'Compte rendu' },
  { value: 'medical_report', label: 'Rapport médical' },
  { value: 'hospital_doc', label: 'Document hospitalier' },
  { value: 'certificate', label: 'Certificat' },
  { value: 'other', label: 'Autre document médical' },
];

const ACCEPTED = '.pdf,.jpg,.jpeg,.png';
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function AddDocumentModal({ patient, onClose, onSaved }: {
  patient: Patient;
  onClose: () => void;
  onSaved: (doc: MedicalDocument) => void;
}) {
  const { profile } = useAuth();
  const [docType, setDocType] = useState('lab_result');
  const [docName, setDocName] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File | null) => {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext ?? '')) {
      setError('Format non autorisé. Utilisez PDF, JPG, JPEG ou PNG.');
      return;
    }
    if (f.size > MAX_SIZE) {
      setError('Fichier trop volumineux. Taille maximum: 10 MB.');
      return;
    }
    setError(null);
    setFile(f);
    if (!docName) setDocName(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!file) { setError('Veuillez sélectionner un fichier.'); return; }
    setUploading(true);
    setError(null);
    try {
      const { data: medicalFile } = await supabase.from('medical_files').select('id').eq('patient_id', patient.id).maybeSingle();
      const ext = file.name.split('.').pop();
      const filePath = `${patient.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from(MEDICAL_BUCKET).upload(filePath, file);
      if (uploadErr) { setError(uploadErr.message); setUploading(false); return; }

      const { data: newDoc, error: insertErr } = await supabase.from('medical_documents').insert({
        patient_id: patient.id,
        medical_file_id: (medicalFile as { id: string })?.id ?? null,
        uploaded_by: profile?.id,
        uploaded_by_name: profile?.full_name ?? null,
        name: docName || file.name,
        description: description || null,
        file_type: docType,
        document_type: docType,
        document_date: docDate || null,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type || `application/${ext}`,
        status: 'active',
      }).select().single();

      if (insertErr) { setError(insertErr.message); setUploading(false); return; }

      await logAudit('document_upload', 'medical_document', patient.id, `${docName || file.name} — ${patient.first_name} ${patient.last_name}`);
      onSaved(newDoc as MedicalDocument);
    } catch (e: any) {
      setError(e.message ?? 'Erreur lors de l\'upload');
    }
    setUploading(false);
  };

  return (
    <Modal open onClose={onClose} title={`Ajouter un document — ${patient.first_name} ${patient.last_name}`} size="lg">
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Type de document *</label>
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOCUMENT_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date du document</label>
            <input type="date" className="input" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Nom du document *</label>
          <input className="input" value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Ex: Bilan sanguin septembre 2026" />
        </div>

        <div>
          <label className="label">Description / observation</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description optionnelle" />
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleDrop(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <div className="flex items-center justify-center gap-2 text-sm text-green-700">
              <FileText className="w-5 h-5" />
              <span className="font-medium">{file.name}</span>
              <span className="text-gray-500">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
              <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-red-500 hover:text-red-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Glissez un fichier ici ou cliquez pour parcourir</p>
              <p className="text-xs text-gray-400 mt-1">PDF, JPG, JPEG, PNG — 10 MB max</p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={submit} disabled={!file || uploading} className="btn-primary">
            {uploading ? 'Téléversement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  );

  function handleDrop(files: FileList | null) {
    if (files && files.length > 0) handleFile(files[0]);
  }
}
