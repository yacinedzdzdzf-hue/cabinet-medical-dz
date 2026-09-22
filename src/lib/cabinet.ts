import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Informations du cabinet telles qu'enregistrées dans les paramètres. */
export type CabinetInfo = {
  name: string;
  doctor_name: string;
  specialty: string;
  address: string;
  commune: string;
  wilaya: string;
  phone: string;
  email: string;
  nif: string;
  nis: string;
  rc: string;
  registration_number: string;
  logo_url: string;
  stamp_url: string;
  signature_url: string;
  footer_note: string;
};

export const EMPTY_CABINET: CabinetInfo = {
  name: '',
  doctor_name: '',
  specialty: '',
  address: '',
  commune: '',
  wilaya: '',
  phone: '',
  email: '',
  nif: '',
  nis: '',
  rc: '',
  registration_number: '',
  logo_url: '',
  stamp_url: '',
  signature_url: '',
  footer_note: '',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Normalise les paramètres du cabinet. Aucune valeur n'est inventée. */
export function normalizeCabinet(raw: Record<string, unknown> | null | undefined): CabinetInfo {
  const d = raw ?? {};
  return {
    name: str(d.name),
    doctor_name: str(d.doctor_name) || str(d.doctor) || str(d.name),
    specialty: str(d.specialty),
    address: str(d.address),
    commune: str(d.commune),
    wilaya: str(d.wilaya),
    phone: str(d.phone),
    email: str(d.email),
    nif: str(d.nif),
    nis: str(d.nis),
    rc: str(d.rc),
    registration_number: str(d.registration_number),
    logo_url: str(d.logo_url),
    stamp_url: str(d.stamp_url),
    signature_url: str(d.signature_url),
    footer_note: str(d.footer_note),
  };
}

/** Paramètres du cabinet depuis la base. Retourne des valeurs vides si absents. */
export async function loadCabinetInfo(): Promise<CabinetInfo> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'clinic')
    .maybeSingle();
  if (error) console.error('[CABINET] load error:', error);
  return normalizeCabinet((data as { value: Record<string, unknown> } | null)?.value);
}

/** Paramètres du cabinet, chargés une fois pour l'affichage des documents. */
export function useCabinetInfo(): { cabinet: CabinetInfo; loading: boolean } {
  const [cabinet, setCabinet] = useState<CabinetInfo>(() => normalizeCabinet(null));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadCabinetInfo().then((info) => {
      if (cancelled) return;
      setCabinet(info);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { cabinet, loading };
}

/** Conversion des paramètres du cabinet vers le format de la feuille A4. */
export function toSheetCabinet(c: CabinetInfo) {
  return {
    name: c.name,
    doctorName: c.doctor_name,
    specialty: c.specialty,
    address: [c.address, [c.commune, c.wilaya].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    commune: c.commune,
    wilaya: c.wilaya,
    phone: c.phone,
    email: c.email,
    nif: c.nif,
    nis: c.nis,
    rc: c.rc,
    logoUrl: c.logo_url,
    stampUrl: c.stamp_url,
    signatureUrl: c.signature_url,
    footerNote: c.footer_note,
  };
}
