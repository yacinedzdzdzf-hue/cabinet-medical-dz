import { useState, useEffect, useCallback } from 'react';
import { X, Download, Printer, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { supabase, MEDICAL_BUCKET } from '@/lib/supabase';
import type { MedicalDocument } from '@/types';

export function DocumentViewer({ doc, onClose }: { doc: MedicalDocument; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const loadUrl = useCallback(async () => {
    const { data, error } = await supabase.storage.from(MEDICAL_BUCKET).createSignedUrl(doc.file_path, 3600);
    if (error) { setError(error.message); return; }
    setUrl(data.signedUrl);
  }, [doc.file_path]);

  useEffect(() => { loadUrl(); }, [loadUrl]);

  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
  };

  const handlePrint = () => {
    if (!url) return;
    const w = window.open(url, '_blank');
    if (w) w.onload = () => w.print();
  };

  const isImage = doc.mime_type?.startsWith('image/');
  const isPdf = doc.mime_type === 'application/pdf';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">{doc.name}</span>
          <span className="text-xs text-gray-400">{doc.mime_type} — {doc.document_type ?? doc.file_type}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isImage && (
            <>
              <button onClick={() => setZoom(Math.max(0.25, zoom - 0.25))} className="p-2 hover:bg-gray-700 rounded-lg" title="Dézoomer">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(Math.min(4, zoom + 0.25))} className="p-2 hover:bg-gray-700 rounded-lg" title="Zoomer">
                <ZoomIn className="w-4 h-4" />
              </button>
              <button onClick={() => setZoom(1)} className="p-2 hover:bg-gray-700 rounded-lg" title="Taille réelle">
                <Maximize2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button onClick={handleDownload} className="p-2 hover:bg-gray-700 rounded-lg" title="Télécharger">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={handlePrint} className="p-2 hover:bg-gray-700 rounded-lg" title="Imprimer">
            <Printer className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg" title="Fermer">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {error ? (
          <div className="text-center text-white">
            <p className="text-red-400 mb-2">Erreur: {error}</p>
            <button onClick={loadUrl} className="btn-primary btn-sm">Réessayer</button>
          </div>
        ) : !url ? (
          <div className="text-gray-400">
            <div className="w-8 h-8 border-2 border-gray-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm">Chargement...</p>
          </div>
        ) : isImage ? (
          <img
            src={url}
            alt={doc.name}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            className="max-w-full max-h-full transition-transform rounded-lg shadow-2xl"
          />
        ) : isPdf ? (
          <iframe src={url} className="w-full h-full bg-white rounded-lg" title={doc.name} />
        ) : (
          <div className="text-center text-white">
            <p className="text-gray-400 mb-3">Aperçu non disponible pour ce type de fichier</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm">Télécharger</a>
          </div>
        )}
      </div>
    </div>
  );
}
