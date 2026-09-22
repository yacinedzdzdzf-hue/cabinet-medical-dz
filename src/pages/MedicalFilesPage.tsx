import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, calculateAge, sexLabel, fullName } from '@/lib/format';
import { Loading, EmptyState, PageHeader, Badge } from '@/components/ui';
import { PatientDetailPage } from '@/components/PatientDetailPage';
import type { Patient, MedicalFile } from '@/types';

export default function MedicalFilesPage({ onNavigate, params }: { onNavigate: (path: string) => void; params: URLSearchParams }) {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<MedicalFile[]>([]);
  const [search, setSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const patientFilter = params.get('patient');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('medical_files').select('*, patient:patients(*)');
    if (patientFilter) {
      query = query.eq('patient_id', patientFilter);
    }
    if (search.trim()) {
      query = query.or(`file_number.ilike.%${search}%,patient.first_name.ilike.%${search}%,patient.last_name.ilike.%${search}%`);
    }
    query = query.order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }
    const loaded = (data as MedicalFile[]) ?? [];
    setFiles(loaded);
    if (patientFilter && loaded.length > 0) {
      setSelectedPatientId(loaded[0].patient_id);
    }
    setLoading(false);
  }, [search, patientFilter]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  if (selectedPatientId) {
    return (
      <PatientDetailPage
        patientId={selectedPatientId}
        onBack={() => { setSelectedPatientId(null); if (patientFilter) onNavigate('/medical-files'); }}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div>
      <PageHeader title="Dossiers médicaux" subtitle={`${files.length} dossier(s)`} />

      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par numéro, nom du patient..."
          className="input pl-10"
        />
      </div>

      {files.length === 0 ? (
        <EmptyState icon={<FolderOpen className="w-12 h-12" />} title="Aucun dossier médical" description="Les dossiers médicaux sont créés automatiquement lors de l'enregistrement d'un nouveau patient." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((f) => (
            <button key={f.id} onClick={() => setSelectedPatientId(f.patient_id)} className="card p-4 text-left hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-sm font-medium text-blue-600">{f.file_number}</span>
                <Badge className={f.patient?.sex === 'M' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-pink-100 text-pink-700 border-pink-200'}>
                  {sexLabel(f.patient?.sex)}
                </Badge>
              </div>
              <p className="font-semibold text-gray-900">{fullName(f.patient)}</p>
              <p className="text-sm text-gray-500 mt-1">
                {calculateAge(f.patient?.date_of_birth)} ans — {f.patient?.phone || 'Pas de téléphone'}
              </p>
              <p className="text-xs text-gray-400 mt-2">Créé le {formatDate(f.created_at)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
