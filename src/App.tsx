import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { FullPageLoading } from '@/components/ui';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import PatientsPage from '@/pages/PatientsPage';
import MedicalFilesPage from '@/pages/MedicalFilesPage';
import AppointmentsPage from '@/pages/AppointmentsPage';
import WaitingQueuePage from '@/pages/WaitingQueuePage';
import WaitingScreenPage from '@/pages/WaitingScreenPage';
import ConsultationsPage from '@/pages/ConsultationsPage';
import PrescriptionsPage from '@/pages/PrescriptionsPage';
import CertificatesPage from '@/pages/CertificatesPage';
import DocumentsPage from '@/pages/DocumentsPage';
import FollowUpsPage from '@/pages/FollowUpsPage';
import InvoicesPage from '@/pages/InvoicesPage';
import PaymentsPage from '@/pages/PaymentsPage';
import ReceiptsPage from '@/pages/ReceiptsPage';
import DebtsPage from '@/pages/DebtsPage';
import ReportsPage from '@/pages/ReportsPage';
import MessagesPage from '@/pages/MessagesPage';
import SettingsPage from '@/pages/SettingsPage';
import UsersPage from '@/pages/UsersPage';
import BackupsPage from '@/pages/BackupsPage';
import AuditPage from '@/pages/AuditPage';
import MedicationsPage from '@/pages/MedicationsPage';
import QrAccessPage from '@/pages/QrAccessPage';
import { ShieldAlert } from 'lucide-react';

function parseHash(): { path: string; params: URLSearchParams } {
  const hash = window.location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  return { path: path || '/', params: new URLSearchParams(query ?? '') };
}

function navigate(path: string) {
  window.location.hash = path;
}

/**
 * Page affichée lorsqu'un utilisateur connecté ouvre une partie de CMDZ que son
 * rôle ne couvre pas. Elle propose un retour vers une page qu'il peut voir, ce
 * qui évite toute boucle de redirection.
 */
function AccessDenied({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <ShieldAlert className="w-6 h-6 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Accès refusé</h1>
        <p className="text-sm text-gray-600 mt-2">
          Votre rôle ne permet pas d’accéder à cette partie de CMDZ.
          Les ordonnances sont réservées aux médecins et aux administrateurs.
        </p>
        <button onClick={() => onNavigate('/')} className="btn-primary mt-5">
          Retour au tableau de bord
        </button>
      </div>
    </div>
  );
}

function AppContent() {
  const { session, profile, loading } = useAuth();
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
  }, []);

  if (loading) return <FullPageLoading />;

  if (!session || !profile) return <LoginPage />;

  const { path, params } = route;

  // Ordonnances : réservé aux médecins et administrateurs. Le contrôle est ici,
  // donc les accès directs par URL (?new=1, ?patient=…, ?id=…) sont couverts.
  // La base applique la même règle de son côté.
  const isMedicalRole = profile.role === 'ADMIN' || profile.role === 'DOCTOR';
  if (path === '/prescriptions' && !isMedicalRole) {
    return <AccessDenied onNavigate={handleNavigate} />;
  }

  // Waiting screens are full-screen, no layout
  if (path === '/waiting-screen/male') return <WaitingScreenPage screenType="H" />;
  if (path === '/waiting-screen/female') return <WaitingScreenPage screenType="F" />;

  // QR scanné : le dossier s'ouvre après connexion et vérification du rôle.
  // La route est conservée pendant la connexion, donc rien n'est perdu.
  if (path.startsWith('/qr/p/')) {
    if (!session || !profile) return <LoginPage />;
    return <QrAccessPage token={path.slice('/qr/p/'.length)} onNavigate={handleNavigate} />;
  }

  const renderPage = () => {
    switch (path) {
      case '/': return <DashboardPage onNavigate={handleNavigate} />;
      case '/patients': return <PatientsPage onNavigate={handleNavigate} />;
      case '/medical-files': return <MedicalFilesPage onNavigate={handleNavigate} params={params} />;
      case '/appointments': return <AppointmentsPage onNavigate={handleNavigate} />;
      case '/waiting': return <WaitingQueuePage onNavigate={handleNavigate} />;
      case '/consultations': return <ConsultationsPage params={params} onNavigate={handleNavigate} />;
      case '/medications': return <MedicationsPage />;
      case '/prescriptions': return <PrescriptionsPage params={params} />;
      case '/certificates': return <CertificatesPage params={params} />;
      case '/documents': return <DocumentsPage params={params} />;
      case '/follow-ups': return <FollowUpsPage />;
      case '/invoices': return <InvoicesPage />;
      case '/payments': return <PaymentsPage />;
      case '/receipts': return <ReceiptsPage />;
      case '/debts': return <DebtsPage />;
      case '/reports': return <ReportsPage />;
      case '/messages': return <MessagesPage />;
      case '/settings': return <SettingsPage />;
      case '/users': return <UsersPage />;
      case '/backups': return <BackupsPage />;
      case '/audit': return <AuditPage />;
      default: return <DashboardPage onNavigate={handleNavigate} />;
    }
  };

  return (
    <AppLayout currentPath={path} onNavigate={handleNavigate}>
      {renderPage()}
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
