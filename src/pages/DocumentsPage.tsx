import { useState, useEffect, useCallback } from 'react';
import { Plus, FileText, Search, Download, Eye, Archive, RotateCcw, Upload } from 'lucide-react';
import { supabase, MEDICAL_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { fullName, formatDate, formatCurrency } from '@/lib/format';
import { DOCUMENT_TYPES } from '@/lib/constants';
import { Loading, EmptyState, Modal, PageHeader, Badge } from '@/components/ui';
import type { Patient, MedicalDocument } from '@/types';

const ACCEPTED = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx';

export default function DocumentsPage({ params }: { params: URLSearchParams }) {
  const { hasRole, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<MedicalDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const filterPatientId = params.get('patient');
  const canEdit = hasRole('ADMIN', 'DOCTOR', 'RECEPTION');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('medical_documents').select('*, patient:patients(*)').order('created_at', { ascending: false });
    if (filterPatientId) q = q.eq('patient_id', filterPatientId);
    if (search.trim()) q = q.or(`name.ilike.%${search}%`);
    const { data } = await q;
    setDocuments((data as MedicalDocument[]) ?? []);
    const { data: p } = await supabase.from('patients').select('*').eq('status', 'active').order('last_name');
    setPatients((p as Patient[]) ?? []);
    setLoading(false);
  }, [filterPatientId, search]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (patientId: string, files: FileList, fileType: string, description: string) => {
    setUploading(true);
    try {
      const { data: medicalFile } = await supabase.from('medical_files').select('id').eq('patient_id', patientId).maybeSingle();
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop();
        const fileName = `${patientId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from(MEDICAL_BUCKET).upload(fileName, file);
        if (uploadErr) { alert(`Erreur upload: ${uploadErr.message}`); continue; }
        await supabase.from('medical_documents').insert({
          patient_id: patientId,
          medical_file_id: (medicalFile as { id: string })?.id ?? null,
          uploaded_by: profile?.id,
          name: file.name,
          description,
          file_type: fileType,
          file_path: fileName,
          file_size: file.size,
          mime_type: file.type,
          status: 'active',
        });
        await logAudit('document_upload', 'medical_document', patientId, file.name);
      }
      setShowUpload(false);
      load();
    } catch (e: any) {
      alert(e.message);
    }
    setUploading(false);
  };

  const handleDownload = async (doc: MedicalDocument) => {
    const { data, error } = await supabase.storage.from(MEDICAL_BUCKET).createSignedUrl(doc.file_path, 3600);
    if (error) { alert(error.message); return; }
    window.open(data.signedUrl, '_blank');
    await logAudit('document_download', 'medical_document', doc.id, doc.name);
  };

  const handlePreview = async (doc: MedicalDocument) => {
    const { data, error } = await supabase.storage.from(MEDICAL_BUCKET).createSignedUrl(doc.file_path, 3600);
    if (error) { alert(error.message); return; }
    setPreviewUrl(data.signedUrl);
    setPreviewDoc(doc);
  };

  const handleArchive = async (doc: MedicalDocument) => {
    await supabase.from('medical_documents').update({ status: 'archived' }).eq('id', doc.id);
    await logAudit('document_archive', 'medical_document', doc.id, doc.name);
    load();
  };

  const handleRestore = async (doc: MedicalDocument) => {
    await supabase.from('medical_documents').update({ status: 'active' }).eq('id', doc.id);
    await logAudit('document_restore', 'medical_document', doc.id, doc.name);
    load();
  };

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Documents médicaux"
        subtitle={`${documents.length} document(s)`}
        actions={canEdit && <button onClick={() => setShowUpload(true)} className="btn-primary"><Upload className="w-4 h-4" /> Téléverser</button>}
      />

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input className="input pl-10" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {documents.length === 0 ? (
        <EmptyState icon={<FileText className="w-12 h-12" />} title="Aucun document" description="Téléversez des radiographies, résultats d’analyses, comptes-rendus, etc." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((d) => (
            <div key={d.id} className="card p-4">
              <div className="flex items-start gap-3">
                <FileText className="w-8 h-8 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{d.name}</p>
                  <p className="text-xs text-gray-500">{fullName((d as any).patient)}</p>
                  <p className="text-xs text-gray-400">{formatDate(d.created_at)}</p>
                  <Badge className="mt-2 bg-gray-100 text-gray-600 border-gray-200">
                    {DOCUMENT_TYPES.find((t) => t.value === d.file_type)?.label ?? d.file_type}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-3">
                <button onClick={() => handlePreview(d)} className="btn-ghost btn-sm"><Eye className="w-4 h-4" /></button>
                <button onClick={() => handleDownload(d)} className="btn-ghost btn-sm"><Download className="w-4 h-4" /></button>
                {canEdit && (d.status === 'active' ? (
                  <button onClick={() => handleArchive(d)} className="btn-ghost btn-sm" title="Archiver"><Archive className="w-4 h-4" /></button>
                ) : (
                  <button onClick={() => handleRestore(d)} className="btn-ghost btn-sm" title="Restaurer"><RotateCcw className="w-4 h-4" /></button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadModal patients={patients} uploading={uploading} onClose={() => setShowUpload(false)} onUpload={handleUpload} />}

      {previewDoc && (
        <Modal open onClose={() => { setPreviewDoc(null); setPreviewUrl(null); }} title={previewDoc.name} size="xl">
          {previewUrl && (
            <div className="text-center">
              {previewDoc.mime_type?.startsWith('image/') ? (
                <img src={previewUrl} alt={previewDoc.name} className="max-w-full max-h-[60vh] mx-auto rounded-lg" />
              ) : previewDoc.mime_type === 'application/pdf' ? (
                <iframe src={previewUrl} className="w-full h-[60vh] border border-gray-200 rounded-lg" title={previewDoc.name} />
              ) : (
                <div className="py-12 text-center">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">Aperçu non disponible pour ce type de fichier</p>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm mt-3">Télécharger</a>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function UploadModal({ patients, uploading, onClose, onUpload }: {
  patients: Patient[];
  uploading: boolean;
  onClose: () => void;
  onUpload: (patientId: string, files: FileList, fileType: string, description: string) => void;
}) {
  const [patientId, setPatientId] = useState('');
  const [fileType, setFileType] = useState('xray');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setFiles(e.dataTransfer.files);
  };

  return (
    <Modal open onClose={onClose} title="Téléverser des documents" size="lg">
      <div className="space-y-4">
        <div>
          <label className="label">Patient *</label>
          <select className="input" required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{fullName(p)} — {p.patient_number}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type de document</label>
          <select className="input" value={fileType} onChange={(e) => setFileType(e.target.value)}>
            {DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description optionnelle" />
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
        >
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Glissez vos fichiers ici ou</p>
          <label className="btn-secondary btn-sm mt-2 cursor-pointer">
            <input type="file" multiple accept={ACCEPTED} className="hidden" onChange={(e) => setFiles(e.target.files)} />
            Parcourir
          </label>
          {files && files.length > 0 && (
            <p className="text-sm text-green-600 mt-2">{files.length} fichier(s) sélectionné(s)</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={() => patientId && files && onUpload(patientId, files, fileType, description)} disabled={!patientId || !files || uploading} className="btn-primary">
            {uploading ? 'Téléversement...' : 'Téléverser'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
