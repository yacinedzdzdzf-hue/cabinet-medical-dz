import { useEffect, useState } from 'react';
import { Link2, ShieldAlert, LogIn, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { resolveQrToken } from '@/lib/qr';

/**
 * Point d'entrée d'un QR code scanné.
 *
 * Le jeton du QR ne donne aucun accès en soi : cette page demande au serveur de
 * le résoudre, ce qui exige une session et un rôle autorisé à consulter les
 * dossiers patients. Sans session, l'utilisateur est invité à se connecter puis
 * revient ici. Un rôle non autorisé (écran de salle d'attente, par exemple) est
 * refusé sans exception.
 */
export default function QrAccessPage({ token, onNavigate }: {
  token: string;
  onNavigate: (path: string) => void;
}) {
  const { session, profile, loading, hasRole } = useAuth();
  const [state, setState] = useState<'checking' | 'ok' | 'needs_auth' | 'denied' | 'invalid' | 'error'>('checking');

  useEffect(() => {
    if (loading) return;

    if (!session || !profile) {
      // L'application affiche l'écran de connexion puis revient sur cette même
      // URL : le jeton du QR reste dans l'adresse, rien à mémoriser.
      setState('needs_auth');
      return;
    }

    if (!hasRole('ADMIN', 'DOCTOR', 'RECEPTION')) {
      setState('denied');
      return;
    }

    let cancelled = false;
    setState('checking');
    resolveQrToken(token).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        sessionStorage.removeItem('cmdz-qr-token');
        onNavigate(`/medical-files?patient=${result.patientId}`);
        return;
      }
      setState(result.status === 'error' ? 'error' : result.status);
    });

    return () => { cancelled = true; };
  }, [loading, session, profile, hasRole, token, onNavigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-7 text-center">
        {state === 'checking' && (
          <>
            <Loader2 className="w-9 h-9 text-blue-600 animate-spin mx-auto mb-3" />
            <h1 className="font-semibold text-gray-900 dark:text-white">Vérification du QR code…</h1>
            <p className="text-sm text-gray-500 mt-1">Recherche du dossier correspondant.</p>
          </>
        )}

        {state === 'needs_auth' && (
          <>
            <LogIn className="w-9 h-9 text-blue-600 mx-auto mb-3" />
            <h1 className="font-semibold text-gray-900 dark:text-white">Connexion requise</h1>
            <p className="text-sm text-gray-500 mt-1">
              Ce QR code ouvre un dossier médical. Connectez-vous avec votre compte CMDZ pour continuer.
            </p>
          </>
        )}

        {state === 'denied' && (
          <>
            <ShieldAlert className="w-9 h-9 text-red-500 mx-auto mb-3" />
            <h1 className="font-semibold text-gray-900 dark:text-white">Accès non autorisé au dossier médical.</h1>
            <p className="text-sm text-gray-500 mt-1">
              Votre rôle ne permet pas de consulter les dossiers patients.
            </p>
          </>
        )}

        {(state === 'invalid' || state === 'error') && (
          <>
            <Link2 className="w-9 h-9 text-amber-500 mx-auto mb-3" />
            <h1 className="font-semibold text-gray-900 dark:text-white">
              {state === 'invalid' ? 'QR code invalide ou expiré' : 'Impossible de vérifier ce QR code'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {state === 'invalid'
                ? 'Ce code ne correspond à aucune ordonnance active. Demandez une nouvelle impression.'
                : 'Vérifiez la connexion au réseau du cabinet, puis réessayez.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
