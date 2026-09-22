/*
 * OrdonnanceSheet — feuille A4 (210 × 297 mm) de l'ordonnance CMDZ.
 *
 * Rendu unique réutilisé partout : aperçu à l'écran, impression et PDF.
 * Palette : bleu médical + blanc + gris très clair. Le bleu reste un accent
 * (filet, surtitre, numéros, titres) ; le fond est blanc pour rester imprimable.
 *
 * Les médicaments sont paginés par blocs : une ligne n'est jamais coupée entre
 * deux pages (`break-inside: avoid`), l'en-tête est répété au-delà de la
 * première page et un pied de page indique « Page X / Y » dès qu'il y en a
 * plusieurs.
 *
 * Aucune information absente n'est inventée : chaque champ vide est masqué.
 */

import type { ReactNode } from 'react';

export type SheetCabinet = {
  name: string;
  doctorName: string;
  specialty: string;
  address: string;
  commune: string;
  wilaya: string;
  phone: string;
  email: string;
  nif: string;
  nis: string;
  rc: string;
  logoUrl: string;
  stampUrl: string;
  signatureUrl: string;
  footerNote: string;
};

export type SheetPatient = {
  /** Nom imprimé sur l'ordonnance. Peut être corrigé sans changer le dossier. */
  fullName: string;
  patientNumber: string;
  fileNumber: string;
  dateOfBirth: string | null;
  age: number | string;
  sexLabel: string;
  cin: string;
};

export type SheetItem = {
  id?: string;
  name: string;
  dci?: string | null;
  strength?: string | null;
  form?: string | null;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  route?: string | null;
  timing?: string | null;
  instructions?: string | null;
  qsp?: string | null;
};

/** Format physique du papier à l'impression. N'affecte jamais le contenu. */
export type PaperSize = 'A4' | 'A5';

export type OrdonnanceSheetProps = {
  cabinet: SheetCabinet;
  patient: SheetPatient | null;
  number: string;
  dateLabel: string;
  items: SheetItem[];
  recommendations?: string | null;
  /** Nombre de lignes par page (la première page en contient une de moins : titre et identité patient). */
  maxItemsPerPage?: number;
  /**
   * Format physique à l'impression et au PDF. Le document lui-même est toujours
   * mis en page en A5 ; ce choix ne change que le papier réellement imprimé.
   */
  printSize?: PaperSize;
  /**
   * Zoom d'affichage à l'écran uniquement. Il ne modifie ni la mise en page, ni
   * l'impression : la feuille conserve toujours ses proportions.
   */
  zoom?: number;
  /**
   * QR d'accès au dossier patient. Absent tant qu'aucun patient réel n'est
   * associé (ordonnance vierge) — on n'affiche alors aucun QR.
   */
  qr?: { svg: string; loading?: boolean; label: string } | null;
};

const BLEU = '#0f4c81';
const BLEU_CLAIR = '#3b82a8';
const GRIS = '#6b7280';
const GRIS_CLAIR = '#e5e7eb';

function val(v: string | null | undefined): string {
  return (v ?? '').toString().trim();
}

/** « Dr NOM PRÉNOM » — sans doublon si le nom est déjà préfixé. */
function doctorDisplay(name: string): string {
  const n = val(name);
  if (!n) return '';
  return /^(dr|docteur)\b/i.test(n) ? n : `Dr ${n}`;
}

/**
 * Découpe les lignes en pages en tenant compte de l'espace occupé : la première
 * page réserve la place du titre et de l'identité patient, les suivantes sont
 * plus denses. Une ligne n'est jamais coupée entre deux pages.
 */
function paginate<T>(items: T[], firstPageSize: number, otherPageSize: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [items.slice(0, firstPageSize)];
  let i = firstPageSize;
  while (i < items.length) {
    pages.push(items.slice(i, i + otherPageSize));
    i += otherPageSize;
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* Éléments du document                                               */
/* ------------------------------------------------------------------ */

function Letterhead({ cabinet, number }: { cabinet: SheetCabinet; number: string }) {
  const lines = [cabinet.specialty, cabinet.address, cabinet.commune, cabinet.wilaya].filter(Boolean);
  const contact = [cabinet.phone ? `Tél. ${cabinet.phone}` : '', cabinet.email].filter(Boolean).join(' • ');
  const legal = [
    cabinet.nif ? `NIF ${cabinet.nif}` : '',
    cabinet.nis ? `NIS ${cabinet.nis}` : '',
    cabinet.rc ? `RC ${cabinet.rc}` : '',
  ].filter(Boolean).join('  •  ');

  return (
    <header style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
      {cabinet.logoUrl && (
        <img
          src={cabinet.logoUrl}
          alt=""
          style={{ width: '58px', height: '58px', objectFit: 'contain', flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            {cabinet.name && (
              <div style={{ fontSize: '15pt', fontWeight: 700, color: BLEU, letterSpacing: '0.01em', lineHeight: 1.15 }}>
                {cabinet.name}
              </div>
            )}
            {cabinet.doctorName && (
              <div style={{ fontSize: '11.5pt', fontWeight: 600, color: '#111827', marginTop: '2px' }}>
                {doctorDisplay(cabinet.doctorName)}
              </div>
            )}
          </div>
          {number && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '7pt', color: GRIS, letterSpacing: '0.12em', textTransform: 'uppercase' }}>N° ordonnance</div>
              <div style={{ fontSize: '11pt', fontWeight: 700, color: BLEU, fontVariantNumeric: 'tabular-nums' }}>{number}</div>
            </div>
          )}
        </div>
        {lines.length > 0 && (
          <div style={{ fontSize: '8.5pt', color: GRIS, marginTop: '5px', lineHeight: 1.45 }}>{lines.join(' • ')}</div>
        )}
        {contact && <div style={{ fontSize: '8.5pt', color: GRIS, lineHeight: 1.45 }}>{contact}</div>}
        {legal && <div style={{ fontSize: '7.5pt', color: GRIS, lineHeight: 1.5, letterSpacing: '0.01em' }}>{legal}</div>}
      </div>
    </header>
  );
}

function Title() {
  return (
    <div style={{ textAlign: 'center', marginTop: '14px' }}>
      <div style={{ fontSize: '17pt', fontWeight: 700, color: BLEU, letterSpacing: '0.16em' }}>ORDONNANCE</div>
      <div style={{ fontSize: '8pt', color: GRIS, letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: '2px' }}>
        Ordonnance médicale
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '8px' }}>
        <span style={{ height: '1px', width: '54px', background: GRIS_CLAIR }} />
        <span style={{ width: '5px', height: '5px', borderRadius: '999px', background: BLEU_CLAIR }} />
        <span style={{ height: '1px', width: '54px', background: GRIS_CLAIR }} />
      </div>
    </div>
  );
}

function PatientBlock({ patient, dateLabel }: { patient: SheetPatient | null; dateLabel: string }) {
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 180px',
        gap: '18px',
        marginTop: '16px',
        paddingBottom: '12px',
        borderBottom: `1px solid ${GRIS_CLAIR}`,
      }}
    >
      <div>
        <div style={{ fontSize: '7.5pt', color: BLEU_CLAIR, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>
          Patient
        </div>
        {patient ? (
          <>
            <div style={{ fontSize: '13pt', fontWeight: 600, color: '#111827', marginTop: '3px' }}>{patient.fullName}</div>
            <div style={{ fontSize: '8.5pt', color: GRIS, marginTop: '4px', lineHeight: 1.6 }}>
              {patient.dateOfBirth && <span>Né(e) le {patient.dateOfBirth} ({patient.age} ans)</span>}
              {patient.dateOfBirth && patient.sexLabel && <span> • </span>}
              {patient.sexLabel && <span>{patient.sexLabel}</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '5px' }}>
              {patient.patientNumber && (
                <span style={{ fontSize: '8.5pt', fontWeight: 600, color: '#1f2937', fontVariantNumeric: 'tabular-nums' }}>
                  {patient.patientNumber}
                </span>
              )}
              {patient.patientNumber && patient.fileNumber && <span style={{ color: GRIS_CLAIR }}>|</span>}
              {patient.fileNumber && (
                <span style={{ fontSize: '8.5pt', fontWeight: 600, color: '#1f2937', fontVariantNumeric: 'tabular-nums' }}>
                  {patient.fileNumber}
                </span>
              )}
              {patient.cin && (
                <>
                  <span style={{ color: GRIS_CLAIR }}>|</span>
                  <span style={{ fontSize: '8.5pt', color: '#374151' }}>CIN : {patient.cin}</span>
                </>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '10pt', color: '#9ca3af', marginTop: '3px' }}>Non renseigné</div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '7.5pt', color: BLEU_CLAIR, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>
          Date de prescription
        </div>
        <div style={{ fontSize: '12pt', fontWeight: 600, color: '#111827', marginTop: '3px', fontVariantNumeric: 'tabular-nums' }}>
          {dateLabel || '—'}
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: '9pt', fontWeight: 700, color: BLEU, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function ItemRow({ item, index }: { item: SheetItem; index: number }) {
  const name = val(item.name);
  if (!name) return null;

  const doseLine = [val(item.dose), val(item.frequency)].filter(Boolean).join(', ');
  const durationLine = [val(item.duration), val(item.route)].filter(Boolean).join(' • ');
  const subline = [val(item.dci), val(item.form)].filter(Boolean).join(' • ');
  const qsp = val(item.qsp);
  const instructions = val(item.instructions);
  const timing = val(item.timing);

  return (
    <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid', paddingBottom: '11px', marginBottom: '11px', borderBottom: `1px solid #f1f3f5` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: '10px' }}>
        <div style={{ fontSize: '10pt', fontWeight: 700, color: BLEU_CLAIR, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
          {String(index).padStart(2, '0')}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11.5pt', fontWeight: 700, color: '#111827', lineHeight: 1.35 }}>
            {name}{val(item.strength) ? ` ${val(item.strength)}` : ''}
          </div>
          {subline && <div style={{ fontSize: '8.5pt', color: GRIS, marginTop: '2px' }}>{subline}</div>}

          {doseLine && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontSize: '7.5pt', color: GRIS, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Posologie</div>
              <div style={{ fontSize: '10pt', color: '#1f2937', lineHeight: 1.45 }}>{doseLine}</div>
            </div>
          )}

          {(durationLine || timing) && (
            <div style={{ marginTop: '5px' }}>
              <div style={{ fontSize: '7.5pt', color: GRIS, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Durée et voie</div>
              <div style={{ fontSize: '9.5pt', color: '#1f2937', lineHeight: 1.45 }}>
                {[durationLine, timing].filter(Boolean).join(' • ')}
              </div>
            </div>
          )}

          {(qsp || instructions) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              {qsp && (
                <span style={{
                  display: 'inline-block', border: `1px solid ${BLEU}`, color: BLEU,
                  borderRadius: '3px', padding: '1px 7px', fontSize: '8.5pt', fontWeight: 600,
                }}>
                  QSP : {qsp}
                </span>
              )}
              {instructions && <span style={{ fontSize: '9pt', color: '#4b5563', fontStyle: 'italic' }}>{instructions}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyPrescription() {
  return (
    <div style={{ marginTop: '10px', border: `1px dashed ${GRIS_CLAIR}`, borderRadius: '4px', padding: '16px', minHeight: '190px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ borderBottom: `1px solid #eef1f4`, height: '1px' }} />
        ))}
      </div>
    </div>
  );
}

function SignatureBlock({ cabinet }: { cabinet: SheetCabinet }) {
  return (
    <section style={{ marginTop: '20px', breakInside: 'avoid', pageBreakInside: 'avoid', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '210px', textAlign: 'center' }}>
        <div style={{ fontSize: '8pt', color: GRIS, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Signature et cachet</div>
        <div style={{ height: '68px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '4px' }}>
          {cabinet.signatureUrl && (
            <img src={cabinet.signatureUrl} alt="" style={{ maxHeight: '64px', maxWidth: '96px', objectFit: 'contain' }} />
          )}
          {cabinet.stampUrl && (
            <img src={cabinet.stampUrl} alt="" style={{ maxHeight: '68px', maxWidth: '96px', objectFit: 'contain' }} />
          )}
        </div>
        <div style={{ borderTop: `1px solid #cbd5e1`, paddingTop: '5px', marginTop: '4px' }}>
          {cabinet.doctorName && (
            <div style={{ fontSize: '9.5pt', fontWeight: 600, color: '#111827' }}>{doctorDisplay(cabinet.doctorName)}</div>
          )}
          {cabinet.specialty && <div style={{ fontSize: '8pt', color: GRIS, marginTop: '1px' }}>{cabinet.specialty}</div>}
        </div>
      </div>
    </section>
  );
}

/** QR d'accès sécurisé, aligné avec le bloc signature. Fond blanc garanti autour du code. */
function QrBlock({ qr }: { qr: NonNullable<OrdonnanceSheetProps['qr']> }) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        marginTop: '14px', breakInside: 'avoid', pageBreakInside: 'avoid',
      }}
    >
      <div
        style={{
          width: '26mm', height: '26mm', padding: '2mm', background: '#ffffff',
          border: `1px solid ${GRIS_CLAIR}`, borderRadius: '3px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {qr.loading ? (
          <div style={{ fontSize: '6pt', color: GRIS, textAlign: 'center' }}>QR…</div>
        ) : (
          <div
            style={{ width: '100%', height: '100%' }}
            // SVG généré localement par la bibliothèque QR, jamais du HTML externe
            dangerouslySetInnerHTML={{ __html: qr.svg }}
          />
        )}
      </div>
      <div style={{ fontSize: '6.5pt', color: GRIS, marginTop: '3px', textAlign: 'center', lineHeight: 1.3 }}>
        {qr.label}
      </div>
    </div>
  );
}

function PageFooter({ cabinet, page, total }: { cabinet: SheetCabinet; page?: number; total: number }) {
  const legal = [
    cabinet.nif ? `NIF ${cabinet.nif}` : '',
    cabinet.nis ? `NIS ${cabinet.nis}` : '',
    cabinet.rc ? `RC ${cabinet.rc}` : '',
  ].filter(Boolean).join('  •  ');
  const contact = [cabinet.address, cabinet.phone ? `Tél. ${cabinet.phone}` : '', cabinet.email].filter(Boolean).join(' • ');

  return (
    <footer style={{ marginTop: 'auto', paddingTop: '8px' }}>
      <div style={{ borderTop: `1px solid ${GRIS_CLAIR}`, paddingTop: '5px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ fontSize: '7pt', color: GRIS, lineHeight: 1.5 }}>
          {contact}
          {legal && <div>{legal}</div>}
          {cabinet.footerNote && !legal && <div>{cabinet.footerNote}</div>}
        </div>
        {total > 1 && (
          <div style={{ fontSize: '7pt', color: GRIS, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            Page {page ?? 1} / {total}
          </div>
        )}
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Feuille complète                                                   */
/* ------------------------------------------------------------------ */

export function OrdonnanceSheet({
  cabinet, patient, number, dateLabel, items, recommendations, maxItemsPerPage = 5,
  printSize = 'A5', zoom = 1, qr,
}: OrdonnanceSheetProps) {
  const prescriptionItems = items.filter((i) => val(i.name));
  const showRecommendations = !!(recommendations ?? '').trim();

  const isEmptySheet = prescriptionItems.length === 0;
  // Mise en page unique, en A5. Le format d'impression (A5 ou A4) ne change que
  // le papier : le contenu, les sauts de page et l'ordre restent identiques.
  const pages = isEmptySheet
    ? [prescriptionItems]
    : paginate(prescriptionItems, maxItemsPerPage, maxItemsPerPage + 1);
  let runningIndex = 0;

  return (
    <div
      className={`ordonnance-sheet ordonnance-sheet--${printSize.toLowerCase()}`}
      id="ordonnance-sheet"
      data-print-size={printSize}
      style={{ zoom }}
    >
      {pages.map((pageItems, pageIndex) => (
        <article key={pageIndex} className="ordonnance-page">
          <Letterhead cabinet={cabinet} number={pageIndex === 0 ? number : ''} />
          {pageIndex === 0 && <Title />}
          {pageIndex === 0 && <PatientBlock patient={patient} dateLabel={dateLabel} />}
          {pageIndex > 0 && (
            <div style={{ marginTop: '12px', paddingBottom: '8px', borderBottom: `1px solid ${GRIS_CLAIR}`, display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: GRIS }}>
              <span>{number && `Ordonnance N° ${number}`}</span>
              {patient && <span>{patient.fullName}{patient.patientNumber ? ` • ${patient.patientNumber}` : ''}</span>}
            </div>
          )}

          <section style={{ marginTop: '16px', flex: 1 }}>
            <SectionLabel>Prescription</SectionLabel>
            <div style={{ marginTop: '9px' }}>
              {isEmptySheet ? (
                <EmptyPrescription />
              ) : (
                pageItems.map((item, i) => {
                  runningIndex += 1;
                  return <ItemRow key={item.id ?? `${pageIndex}-${i}`} item={item} index={runningIndex} />;
                })
              )}
            </div>

            {pageIndex === pages.length - 1 && showRecommendations && (
              <div style={{ marginTop: '16px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <SectionLabel>Recommandations</SectionLabel>
                <div style={{ marginTop: '6px', fontSize: '10pt', color: '#1f2937', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {recommendations}
                </div>
              </div>
            )}

            {pageIndex === pages.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' }}>
                <div>{qr ? <QrBlock qr={qr} /> : null}</div>
                <SignatureBlock cabinet={cabinet} />
              </div>
            )}
          </section>

          <PageFooter cabinet={cabinet} page={pageIndex + 1} total={pages.length} />
        </article>
      ))}
    </div>
  );
}
