import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';

/**
 * QR code sécurisé des ordonnances CMDZ.
 *
 * Le QR ne contient qu'une URL portant un jeton opaque. Aucune donnée
 * personnelle ni médicale n'est encodée : c'est le serveur qui déduit le
 * patient à partir du jeton, après vérification de la session et du rôle.
 */

export type QrSettings = { baseUrl: string };

const QR_SETTINGS_KEY = 'qr';

/** Adresse du serveur CMDZ configurée dans les paramètres (vide si non renseignée). */
export async function loadQrSettings(): Promise<QrSettings> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', QR_SETTINGS_KEY)
    .maybeSingle();
  if (error) console.error('[QR] settings error:', error);
  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const baseUrl = typeof value.base_url === 'string' ? value.base_url.trim() : '';
  return { baseUrl };
}

/**
 * Adresse utilisée pour construire le lien du QR.
 * Si l'adresse configurée est absente ou invalide, on retombe sur l'adresse par
 * laquelle l'utilisateur accède à CMDZ (donc la même machine, même réseau).
 */
export function resolveQrBaseUrl(configured: string): { baseUrl: string; fromSettings: boolean } {
  const candidate = configured.trim();
  if (candidate) {
    try {
      const url = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { baseUrl: `${url.protocol}//${url.host}`, fromSettings: true };
      }
    } catch {
      console.error('[QR] adresse de serveur invalide dans les paramètres:', candidate);
    }
  }
  return { baseUrl: `${window.location.protocol}//${window.location.host}`, fromSettings: false };
}

/**
 * Lien encodé dans le QR. La route est celle de CMDZ : le dossier du patient
 * est résolu par le serveur à partir du seul jeton.
 */
export function buildQrUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/#/qr/p/${token}`;
}

export type PrescriptionQr = { token: string; url: string };

/**
 * Crée (ou renouvelle) le jeton du QR d'une ordonnance réellement enregistrée.
 * Le patient n'est jamais transmis : le serveur le déduit de l'ordonnance.
 */
export async function ensurePrescriptionQr(prescriptionId: string, baseUrl: string): Promise<PrescriptionQr | null> {
  const { data, error } = await supabase.rpc('ensure_prescription_qr_token', { p_prescription_id: prescriptionId });
  if (error) {
    console.error('[QR] token error:', error);
    return null;
  }
  const token = (data as { token?: string } | null)?.token;
  if (!token) {
    console.error('[QR] réponse inattendue du serveur');
    return null;
  }
  return { token, url: buildQrUrl(baseUrl, token) };
}

/** Rend le QR en SVG autonome (net à l'impression, aucun appel réseau). */
export async function renderQrSvg(text: string, size = 200): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

/**
 * Résolution d'un jeton scanné.
 * `needsAuth` distingue « connectez-vous » de « accès refusé ».
 */
export type QrResolution =
  | { status: 'ok'; patientId: string; prescriptionId: string }
  | { status: 'needs_auth' }
  | { status: 'denied' }
  | { status: 'invalid' }
  | { status: 'error' };

export async function resolveQrToken(token: string): Promise<QrResolution> {
  const { data, error } = await supabase.rpc('resolve_prescription_qr', { p_token: token });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('AUTHENTICATION_REQUIRED')) return { status: 'needs_auth' };
    if (message.includes('non autorisé')) return { status: 'denied' };
    if (message.includes('invalide')) return { status: 'invalid' };
    console.error('[QR] resolve error:', error);
    return { status: 'error' };
  }
  const result = data as { patient_id?: string; prescription_id?: string } | null;
  if (!result?.patient_id) return { status: 'invalid' };
  return { status: 'ok', patientId: result.patient_id, prescriptionId: result.prescription_id ?? '' };
}
