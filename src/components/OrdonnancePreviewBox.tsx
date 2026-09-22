/*
 * OrdonnancePreviewBox — aperçu à l'écran de la feuille d'ordonnance.
 *
 * Trois choses bien distinctes :
 *
 * - LA MISE EN PAGE du document : toujours en A5 (148 × 210 mm). Le contenu, les
 *   sauts de page et l'ordre des médicaments ne dépendent jamais de l'affichage.
 *
 * - L'AFFICHAGE : zoom (50 % → 160 %) et déplacement à la souris (pan). Les deux
 *   sont purement visuels. Le zoom change la taille perçue ; le pan déplace le
 *   contenu **à l'intérieur** de la zone d'aperçu, jamais la page.
 *
 * - L'IMPRESSION : le format réel du papier (A5 ou A4) est choisi séparément.
 *   Le zoom et le pan sont neutralisés à l'impression : seule la feuille sort.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, Maximize2, Printer, ChevronDown, Check, Hand } from 'lucide-react';
import type { PaperSize } from '@/components/OrdonnanceSheet';

const ZOOM_MIN = 50;
const ZOOM_MAX = 160;
const ZOOM_STEP = 25;
/** En dessous de cette largeur, le panneau d'édition occupe tout : on adapte. */
const AUTO_FIT_WIDTH = 1180;
/** Largeur d'une feuille A5 en pixels à 96 dpi (148 mm), zoom 100 %. */
const A5_WIDTH_PX = 559;

type Point = { x: number; y: number };
type Size = { w: number; h: number };

const ORIGIN: Point = { x: 0, y: 0 };

/**
 * Le contenu ne peut se déplacer que s'il est plus grand que la zone visible.
 * Il ne peut jamais sortir : le déplacement est borné sur les deux axes, ce qui
 * évite de perdre la feuille hors de l'écran.
 */
function clampPan(pan: Point, viewport: Size, content: Size): Point {
  const maxX = Math.max(0, content.w - viewport.w);
  const maxY = Math.max(0, content.h - viewport.h);
  return {
    x: Math.min(0, Math.max(-maxX, pan.x)),
    y: Math.min(0, Math.max(-maxY, pan.y)),
  };
}

/** Position de base : la feuille est centrée tant qu'elle tient dans la zone. */
function baseOffset(viewport: Size, content: Size): Point {
  return {
    x: content.w <= viewport.w ? Math.max(0, (viewport.w - content.w) / 2) : 0,
    y: content.h <= viewport.h ? Math.max(0, (viewport.h - content.h) / 2) : 0,
  };
}

export function OrdonnancePreviewBox({
  children,
  sheetRef,
  printSize,
  onPrintSizeChange,
  onPrint,
  printing,
  storageKey,
}: {
  children: (zoom: number, printSize: PaperSize) => ReactNode;
  sheetRef: React.RefObject<HTMLDivElement>;
  printSize: PaperSize;
  onPrintSizeChange: (size: PaperSize) => void;
  onPrint: () => void;
  printing: boolean;
  /** Mémorise le dernier format d'impression choisi. */
  storageKey?: string;
}) {
  const [zoom, setZoom] = useState(90);
  const [autoFit, setAutoFit] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ w: 0, h: 0 });
  const [contentSize, setContentSize] = useState<Size>({ w: 0, h: 0 });
  const [pan, setPan] = useState<Point>(ORIGIN);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pointer: Point; pan: Point } | null>(null);

  const pannable = contentSize.w > viewportSize.w + 1 || contentSize.h > viewportSize.h + 1;

  // Format d'impression mémorisé : A5 par défaut, comme demandé.
  useEffect(() => {
    if (!storageKey) return;
    const saved = localStorage.getItem(storageKey);
    if (saved === 'A4' || saved === 'A5') onPrintSizeChange(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, printSize);
  }, [storageKey, printSize]);

  // Mesure de la zone visible et de la feuille, pour borner le déplacement.
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = sheetRef.current;
    if (!viewport) return;

    const measure = () => {
      setViewportSize({ w: viewport.clientWidth, h: viewport.clientHeight });
      if (content) {
        const rect = content.getBoundingClientRect();
        setContentSize({ w: rect.width, h: rect.height });
      }
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (content) observer.observe(content);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [sheetRef, zoom]);

  // Le déplacement reste borné quand la taille change (zoom, fenêtre).
  useEffect(() => {
    setPan((prev) => clampPan(prev, viewportSize, contentSize));
  }, [viewportSize, contentSize]);

  const recentre = useCallback(() => setPan(ORIGIN), []);

  const fitToWidth = useCallback(() => {
    const available = viewportRef.current?.clientWidth ?? 0;
    if (available > 0) {
      // 24 px de marge pour ne pas coller la feuille aux bords.
      const ratio = ((available - 24) / A5_WIDTH_PX) * 100;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(ratio / 5) * 5));
      setZoom(next);
    } else {
      setZoom(90);
    }
    recentre();
  }, [recentre]);

  // Sur écran étroit, la colonne d'édition passe en dessous : on réduit d'office.
  useEffect(() => {
    if (window.innerWidth < AUTO_FIT_WIDTH) {
      setZoom(70);
      setAutoFit(false);
    }
  }, []);

  const applyZoom = (value: number) => {
    setAutoFit(false);
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value)));
    // Un changement de zoom repart d'une position centrée : la feuille ne peut
    // pas se retrouver hors de la zone visible après un agrandissement.
    recentre();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pannable || e.button !== 0) return;
    dragStart.current = { pointer: { x: e.clientX, y: e.clientY }, pan };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!dragging || !start) return;
    const next = {
      x: start.pan.x + (e.clientX - start.pointer.x),
      y: start.pan.y + (e.clientY - start.pointer.y),
    };
    setPan(clampPan(next, viewportSize, contentSize));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    dragStart.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const base = baseOffset(viewportSize, contentSize);


  return (
    <div>
      {/* Barre d'outils : jamais imprimée, toujours accessible pendant le pan */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-1">
          <button
            onClick={() => applyZoom(zoom - ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30"
            title="Réduire l’affichage"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-12 text-center tabular-nums">
            {Math.round(zoom)} %
          </span>
          <button
            onClick={() => applyZoom(zoom + ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30"
            title="Agrandir l’affichage"
          >
            <Plus className="w-4 h-4" />
          </button>
          <span className="w-px h-5 bg-gray-200 dark:bg-slate-700 mx-1" />
          <button
            onClick={() => { setAutoFit(true); fitToWidth(); }}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 ${autoFit ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
            title="Ajuster à l’écran"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyZoom(100)}
            className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-slate-800"
            title="Taille réelle"
          >
            100 %
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Indication de déplacement : visible seulement quand c'est utile */}
          {pannable && (
            <span className="no-print hidden sm:flex items-center gap-1.5 text-xs text-gray-500">
              <Hand className="w-3.5 h-3.5" /> Déplacer avec la souris
            </span>
          )}

          {/* Format d'impression — indépendant du zoom et du déplacement */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="btn-secondary btn-sm"
              title="Format du papier à l’impression"
            >
              Format papier : {printSize} <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} aria-label="Fermer" />
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1">
                  {(['A5', 'A4'] as PaperSize[]).map((size) => (
                    <button
                      key={size}
                      onClick={() => { onPrintSizeChange(size); setMenuOpen(false); }}
                      className="w-full flex items-start gap-2 rounded px-2.5 py-2 text-left hover:bg-blue-50 dark:hover:bg-slate-800"
                    >
                      <span className="w-4 mt-0.5">{printSize === size && <Check className="w-4 h-4 text-blue-600" />}</span>
                      <span>
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">{size}</span>
                        <span className="block text-xs text-gray-500">
                          {size === 'A5' ? '148 × 210 mm — format réel de l’ordonnance' : '210 × 297 mm — agrandi sans déformation'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button onClick={onPrint} disabled={printing} className="btn-primary btn-sm">
            <Printer className="w-4 h-4" /> {printing ? 'Préparation…' : 'Imprimer / PDF'}
          </button>
        </div>
      </div>

      {/* Zone d'aperçu : le déplacement se fait ici, et nulle part ailleurs. */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`ordonnance-print-host bg-gray-100 dark:bg-slate-950 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden h-[min(78vh,860px)] min-h-[420px] touch-none ${
          pannable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        } ${dragging ? 'select-none' : ''}`}
      >
        <div
          className="ordonnance-pan-layer will-change-transform"
          style={{ transform: `translate(${base.x + pan.x}px, ${base.y + pan.y}px)` }}
        >
          <div ref={sheetRef} className="py-5 px-3">
            {children(zoom / 100, printSize)}
          </div>
        </div>
      </div>
    </div>
  );
}
