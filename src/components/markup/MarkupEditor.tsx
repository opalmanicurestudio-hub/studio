'use client';
// src/components/markup/MarkupEditor.tsx — THE ONE MARKUP TOOL (board 17A), for clients and the team. Every tool the
// booking photos and the team's markup had, plus shapes, nail guides with length, pins with notes, magnify, blur, an
// eraser and crop:
//   Move · Pen · Highlight · Arrow · Circle · Shapes (box, straight line) · Text · Stamps · Nail guide · Pins ·
//   Pick color · Magnify · Blur · Eraser · Crop
// Any mark can be moved, resized from its corners, turned from its handle (or with two fingers), recolored, made
// see-through, copied, brought forward or back, or deleted; undo and redo; hold to see the original; pinch, the
// wheel or +/- to zoom (where the fingers or pointer are), and drag with Move or two fingers to look around. Marks
// are kept as shapes (lib/markup) on the editor's own layer; marks on other layers are shown but not changed here. On
// Done the photo is flattened (what's shown, on the layers that are sent) and handed back with its marks, and the
// editor stays open until the caller says it's saved (or why it isn't), so nothing is lost on a slow connection.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Move, Pencil, Highlighter, ArrowUpRight, Circle, Shapes, Type, Star, MapPin, Pipette, ZoomIn, Droplet, Eraser, Crop, Undo2, Redo2, Minus, Plus, X } from 'lucide-react';
import { type Mark, type MarkupDoc, type Layer, type Pt, type StampKind, type NailShape, type NailLength, emptyDoc, cleanDoc, uid, ap, inv, scaleOf, centerOf, moved, scaled, duplicated, restacked, toEveryNail, withPinNote, erased, simplified, cropTo, turnQuarter, turnedSize, viewOf, unitOf, lensRadius,
  SIZES, PALETTE, STAMPS, NAIL_SHAPES, NAIL_LENGTHS, LIMITS } from '@/lib/markup/model';
import { drawDoc, canvasMatrix, boxOf, hitMark, flatten, nailPath, type Box } from '@/lib/markup/draw';
import { altText, pinLines } from '@/lib/markup/describe';
import { markupToolsHidden, type Niche } from '@/lib/niche';

export type Tool = 'move' | 'pen' | 'highlight' | 'arrow' | 'circle' | 'shapes' | 'text' | 'stamp' | 'nail' | 'pin' | 'pick' | 'magnify' | 'blur' | 'eraser' | 'crop';
export type MarkupResult = { dataUrl: string; doc: MarkupDoc; note: string; colors: string[] };

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', WARN = '#b45309', RED = '#b42318', GOOD = '#1f7a4d';
const NailIcon = (p: any) => (<svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M8 21V9.5C8 6 10 3 12 3s4 3 4 6.5V21" strokeDasharray="2.4 2" /><path d="M8 21h8" /></svg>);
const TOOLS: { k: Tool; label: string; Icon: any }[] = [
  { k: 'move', label: 'Move', Icon: Move }, { k: 'pen', label: 'Pen', Icon: Pencil }, { k: 'highlight', label: 'Highlight', Icon: Highlighter }, { k: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
  { k: 'circle', label: 'Circle', Icon: Circle }, { k: 'shapes', label: 'Shapes', Icon: Shapes }, { k: 'text', label: 'Text', Icon: Type }, { k: 'stamp', label: 'Stamps', Icon: Star },
  { k: 'nail', label: 'Nail guide', Icon: NailIcon }, { k: 'pin', label: 'Pins', Icon: MapPin }, { k: 'pick', label: 'Pick color', Icon: Pipette }, { k: 'magnify', label: 'Magnify', Icon: ZoomIn },
  { k: 'blur', label: 'Blur', Icon: Droplet }, { k: 'eraser', label: 'Eraser', Icon: Eraser }, { k: 'crop', label: 'Crop', Icon: Crop }];
/** One key for each tool, on a computer. */
const KEYS: Record<string, Tool | 'line'> = { v: 'move', p: 'pen', h: 'highlight', a: 'arrow', o: 'circle', r: 'shapes', l: 'line', t: 'text', s: 'stamp', g: 'nail', n: 'pin', i: 'pick', m: 'magnify', b: 'blur', e: 'eraser', c: 'crop' };
const KEY_OF: Partial<Record<Tool, string>> = Object.fromEntries(Object.entries(KEYS).filter(([, t]) => t !== 'line').map(([k, t]) => [t, k.toUpperCase()]));
/** Two rows, in reading order (the grid fills down each column, so the list is laid out to suit). */
/** The tools in two columns, down then across (the phone's tool sheet). */
const gridOf = (list: typeof TOOLS) => Array.from({ length: Math.ceil(list.length / 2) }).flatMap((_, i) => [list[i], list[i + Math.ceil(list.length / 2)]].filter(Boolean));
const NAMES: Record<string, string> = { pen: 'Line', highlight: 'Highlight', line: 'Straight line', arrow: 'Arrow', circle: 'Circle', rect: 'Box', text: 'Label', stamp: 'Stamp', nail: 'Nail guide', pin: 'Pin', lens: 'Close-up', blur: 'Blurred area' };
/** Marks turned on the photo itself (a flipped photo turns them the other way on the screen). */
const PHOTO_TURNED = ['pen', 'highlight', 'line', 'arrow', 'circle', 'rect', 'nail'];
/** Marks that don't turn: a pin's number stays upright, a close-up stays round, and a blur stays where it hides. */
const NO_TURN = ['pin', 'lens', 'blur'];
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const buzz = () => { try { (navigator as any).vibrate?.(8); } catch { /* no haptics */ } };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const contrast = (c: string) => { const n = parseInt(c.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62 ? INK : '#ffffff'; };
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

type Gesture =
  | { t: 'draw'; mark: Mark; center?: Pt }
  | { t: 'move' | 'resize' | 'rotate' | 'length' | 'spot' | 'lens'; id: string; from: Pt; orig: Mark; before: MarkupDoc; cur: MarkupDoc; c?: Pt }
  | { t: 'pinchMark'; id: string; d0: number; a0: number; orig: Mark; before: MarkupDoc; cur: MarkupDoc }
  | { t: 'erase'; last: Pt; before: MarkupDoc; cur: MarkupDoc }
  | { t: 'pan'; from: Pt; x: number; y: number }
  | { t: 'pick' }
  | { t: 'crop'; part: 'move' | 0 | 1 | 2 | 3; from: Pt; orig: { x: number; y: number; w: number; h: number } };

export function MarkupEditor({ src, doc: start, layer = 'client', editLayers, showLayers, sendLayers, title, accent = INK, by, onCancel, onDone, initialNote = '', initialColors = [], startTool = 'pen', format = 'jpeg', doneLabel = 'Done', backLabel, layerNames, clientName, inline = false, alt, aside, headerExtra, niche }: {
  src: string; doc?: MarkupDoc | null; layer?: Layer;
  /** Layers whose marks can be changed here (the editor's own, by default). */
  editLayers?: Layer[];
  /** Layers shown (all but private notes, by default). */
  showLayers?: Layer[];
  /** Layers in the flattened copy (the client's and the team's, by default: never private notes). */
  sendLayers?: Layer[];
  title?: string; accent?: string; by?: string;
  onCancel: () => void;
  /** Saves it: resolves to nothing when it's saved (and the caller closes the editor), or to what went wrong. */
  onDone: (r: MarkupResult) => Promise<string | null | void> | void;
  initialNote?: string; initialColors?: string[];
  /** Opens on this tool (Crop, from a photo's card). */
  startTool?: Tool;
  /** The flattened copy: a JPEG (smaller), or a PNG for screens that keep one. */
  format?: 'jpeg' | 'png';
  /** What Done says ("Save markup", "Send to Dana"), and what leaving goes back to on a computer ("Dana Reyes"). */
  doneLabel?: string; backLabel?: string;
  /** What each layer is called in the layers list ("Dana's marks", "Mia's marks"), and the client's first name. */
  layerNames?: Partial<Record<Layer, string>>; clientName?: string;
  /** Drawn where it's placed, not at the end of the page (inside another screen's own dialog, which keeps the keys). */
  inline?: boolean;
  /** A second, quieter way to finish ("Save for the team" beside "Send to Dana"), saved the same way. */
  alt?: { label: string; onDone: (r: MarkupResult) => Promise<string | null | void> | void };
  /** More about the photo, above the settings (the client's own note, say). */
  aside?: React.ReactNode;
  /** Beside the title on a computer, and under it on a phone (other views of the photo: Compare). */
  headerExtra?: React.ReactNode;
  /** The kind of business the owner chose (lib/niche chosenNiche): a tool that can't fit it (the nail guide outside
   *  nails) is left out. A guess never takes a tool away. Marks already made with it still show and can be moved or
   *  removed. */
  niche?: Niche | null;
}) {
  const hiddenTools = markupToolsHidden(niche);
  const tools = React.useMemo(() => TOOLS.filter((x) => !markupToolsHidden(niche).includes(x.k)), [niche]);
  const toolGrid = React.useMemo(() => gridOf(tools), [tools]);
  const root = React.useRef<HTMLDivElement>(null); const stage = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null); const img = React.useRef<HTMLImageElement | null>(null); const sample = React.useRef<{ ctx: CanvasRenderingContext2D; k: number } | null>(null);
  const [doc, setDoc] = React.useState<MarkupDoc | null>(null); const [note, setNote] = React.useState(initialNote);
  const [past, setPast] = React.useState<MarkupDoc[]>([]); const [future, setFuture] = React.useState<MarkupDoc[]>([]);
  const [tool, setTool] = React.useState<Tool>(hiddenTools.includes(startTool) ? 'pen' : startTool); const [color, setColor] = React.useState(PALETTE[0]); const [size, setSize] = React.useState(SIZES[1].v);
  const [dash, setDash] = React.useState(false); const [smooth, setSmooth] = React.useState(true); const [shape, setShape] = React.useState<'rect' | 'line'>('rect'); const [round, setRound] = React.useState(false);
  const [stamp, setStamp] = React.useState<StampKind | 'number'>('heart'); const [nail, setNail] = React.useState<{ shape: NailShape; length: NailLength }>({ shape: 'almond', length: 'medium' });
  const [zoomLens, setZoomLens] = React.useState<2 | 3 | 4>(3); const [label, setLabel] = React.useState('');
  const [sel, setSel] = React.useState<string | null>(null); const [peek, setPeek] = React.useState(false);
  const [live, setLive] = React.useState<Mark | null>(null); const [loupe, setLoupe] = React.useState<{ q: Pt; c: string } | null>(null);
  const [view, setView] = React.useState({ k: 1, x: 0, y: 0 });
  const [failed, setFailed] = React.useState<string | null>(null); const [locked, setLocked] = React.useState(false);
  const [said, setSaid] = React.useState<string | null>(null); const [saving, setSaving] = React.useState<false | 'main' | 'alt'>(false); const [leaving, setLeaving] = React.useState(false);
  const [ratio, setRatio] = React.useState<'free' | 'square' | '4:5' | '3:4'>('free'); const [cropDraft, setCropDraft] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pop, setPop] = React.useState<{ id: string; t: number } | null>(null); const [, tick] = React.useState(0); const [focusPin, setFocusPin] = React.useState<string | null>(null);
  const gesture = React.useRef<Gesture | null>(null); const touches = React.useRef(new Map<number, Pt>());
  const pinch = React.useRef<{ d: number; k: number; mid: Pt; x: number; y: number } | null>(null);
  const cssPx = React.useRef(1);   // canvas pixels per screen pixel
  const shift = React.useRef(false);
  const mine: Layer[] = editLayers || [layer];
  // The layers shown (each can be hidden while working), and the one new marks go on.
  const [shown, setShown] = React.useState<Layer[]>(() => (showLayers || (['client', 'team', 'private'] as Layer[])).filter((l) => l !== 'private' || mine.includes('private') || layer === 'private'));
  const [active, setActive] = React.useState<Layer>(mine.includes(layer) ? layer : mine[0]);
  const reachable = mine.filter((l) => shown.includes(l));
  const [wide, setWide] = React.useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches);   // a computer's screen: tools down the side, settings on the right
  React.useEffect(() => { const q = window.matchMedia?.('(min-width: 1024px)'); if (!q) return; const f = () => setWide(q.matches); f(); q.addEventListener?.('change', f); return () => q.removeEventListener?.('change', f); }, []);
  const space = React.useRef(false); const [spacing, setSpacing] = React.useState(false);
  const holdSpace = (on: boolean) => { space.current = on; setSpacing(on); };
  // Keys held when the window lost focus never come back up: let go of them all.
  React.useEffect(() => {
    const letGo = () => { setPeek(false); holdSpace(false); shift.current = false; };
    const vis = () => { if (document.visibilityState === 'hidden') letGo(); };
    window.addEventListener('blur', letGo); document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('blur', letGo); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const sent: Layer[] = sendLayers || ['client', 'team'];

  // ── Load the photo ─────────────────────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    let gone = false;
    const open = (cors: boolean) => {
      const i = new Image(); if (cors) i.crossOrigin = 'anonymous';
      i.onload = () => {
        if (gone) return; img.current = i;
        const kept = start ? cleanDoc(start) : null;   // checked again, whatever it came from
        const d0 = kept && kept.w === i.naturalWidth && kept.h === i.naturalHeight ? kept : emptyDoc(i.naturalWidth, i.naturalHeight);
        setDoc({ ...d0, colors: d0.colors.length ? d0.colors : initialColors.slice(0, LIMITS.colors) }); setNote(d0.note || initialNote);
        if (start && d0 !== kept) setSaid('The earlier marks didn’t fit this copy of the photo, so it starts fresh.');
        try { const k = Math.min(1, 2000 / Math.max(i.naturalWidth, i.naturalHeight)); const off = document.createElement('canvas'); off.width = Math.round(i.naturalWidth * k); off.height = Math.round(i.naturalHeight * k);
          const octx = off.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D; octx.drawImage(i, 0, 0, off.width, off.height); octx.getImageData(0, 0, 1, 1); sample.current = { ctx: octx, k }; }
        catch { sample.current = null; if (!cors) setLocked(true); }
      };
      // A photo from another site that won't share itself can still be looked at, but not changed or saved here.
      i.onerror = () => { if (gone) return; if (cors) open(false); else setFailed('This photo couldn’t be opened. Please try another.'); };
      i.src = src;
    };
    open(/^https?:/.test(src));
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const cropping = tool === 'crop';
  const shownDoc = React.useMemo(() => (doc ? (cropping ? { ...doc, view: { ...doc.view, crop: null } } : doc) : null), [doc, cropping]);
  const v = shownDoc ? viewOf(shownDoc) : { w: 1, h: 1 };
  const kc = Math.min(1, 1600 / Math.max(v.w, v.h));
  const M = shownDoc ? canvasMatrix(shownDoc, kc) : null;
  const flipped = !!M && M[0] * M[3] - M[1] * M[2] < 0;
  const selMark = doc && sel ? doc.marks.find((m) => m.id === sel) || null : null;

  // ── History ────────────────────────────────────────────────────────────────────────────────────────────────
  // Typing and sliders change the photo as they go; the step undone is the whole edit (from the first change to
  // letting go). Any other step closes an open edit first, so history never jumps.
  const editFrom = React.useRef<MarkupDoc | null>(null);
  const flushEdit = () => { const b = editFrom.current; editFrom.current = null; if (b && doc && !same(b, doc)) { setPast((p) => [...p.slice(-80), b]); setFuture([]); } };
  const editStart = () => { if (!editFrom.current) editFrom.current = doc; };
  const editEnd = flushEdit;
  const commit = (next: MarkupDoc, before: MarkupDoc | null = doc) => {
    const open = editFrom.current; editFrom.current = null;
    const steps: MarkupDoc[] = [...(open && before && !same(open, before) ? [open] : []), ...(before ? [before] : [])];
    setPast((p) => [...p, ...steps].slice(-80)); setFuture([]); setDoc(next);
  };
  const undo = () => {
    if (!doc) return; const open = editFrom.current; editFrom.current = null;
    const p = open && !same(open, doc) ? [...past, open] : past; if (!p.length) return;
    setFuture([doc, ...future]); setDoc(p[p.length - 1]); setPast(p.slice(0, -1)); setSel(null); buzz();
  };
  const redo = () => {
    if (!doc) return; const open = editFrom.current; editFrom.current = null;
    if (open && !same(open, doc)) { setPast([...past, open].slice(-80)); setFuture([]); return; }   // a change made since: nothing to redo
    if (!future.length) return;
    setPast([...past, doc].slice(-80)); setDoc(future[0]); setFuture(future.slice(1)); buzz();
  };
  const change = (fn: (m: Mark) => Mark) => { if (!doc || !selMark) return; commit({ ...doc, marks: doc.marks.map((m) => (m.id === selMark.id ? fn(m) : m)) }); };
  /** A change as it's being made (a slider, a color being dragged): one undo step for the whole of it. */
  const changeLive = (fn: (m: Mark) => Mark) => { if (!doc || !selMark) return; editStart(); setDoc({ ...doc, marks: doc.marks.map((m) => (m.id === selMark.id ? fn(m) : m)) }); };
  const full = () => { if (doc && doc.marks.length >= LIMITS.marks) { setSaid('This photo has as many marks as it can hold. Delete one to add another.'); return true; } return false; };
  const add = (mk: Mark, extra: Partial<MarkupDoc> = {}) => { if (!doc || full()) return; commit({ ...doc, ...extra, marks: [...doc.marks, mk] }); setPop({ id: mk.id, t: performance.now() }); buzz(); };

  // ── Handles on the selected mark (canvas pixels) ──────────────────────────────────────────────────────────
  type Handle = { id: 'c0' | 'c1' | 'c2' | 'c3' | 'rot' | 'len'; x: number; y: number; from: Pt };
  const handlesOf = (mk: Mark, b: Box): Handle[] => {
    if (!doc || !M) return [];
    const gap = 26 * cssPx.current; const cx = (b.x0 + b.x1) / 2;
    const list: Handle[] = [{ id: 'c0', x: b.x0, y: b.y0, from: { x: cx, y: b.y0 } }, { id: 'c1', x: b.x1, y: b.y0, from: { x: cx, y: b.y0 } }, { id: 'c2', x: b.x1, y: b.y1, from: { x: cx, y: b.y0 } }, { id: 'c3', x: b.x0, y: b.y1, from: { x: cx, y: b.y0 } }];
    if (mk.kind === 'nail') {
      // On the guide itself, however it's turned: its free edge sets the length, and a handle past the cuticle turns it.
      const p = mk.pts[0]; const h = unitOf(mk, doc.w) * 3.2 * (NAIL_LENGTHS.find((l) => l.key === mk.nail?.length)?.k || 1);
      const along = (d: number) => ap(M, { x: p.x - Math.sin(mk.rotation) * d, y: p.y + Math.cos(mk.rotation) * d });
      const tip = along(-h / 2); const base = along(h * 0.62); const out = along(h * 0.62 + gap / scaleOf(M));
      list.push({ id: 'len', x: tip.x, y: tip.y, from: tip }, { id: 'rot', x: out.x, y: out.y, from: base });
    } else if (!NO_TURN.includes(mk.kind)) list.push({ id: 'rot', x: cx, y: b.y0 - gap, from: { x: cx, y: b.y0 } });
    return list;
  };

  // ── Draw (once a frame at most) ─────────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const c = canvas.current; const i = img.current; if (!c || !i || !shownDoc || !M) return;
      const W = Math.max(1, Math.round(v.w * kc)), H = Math.max(1, Math.round(v.h * kc));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const r = c.getBoundingClientRect(); if (r.width) cssPx.current = c.width / r.width;
      const ctx = c.getContext('2d')!;
      const pk = pop ? { id: pop.id, k: Math.min(1, 0.6 + (performance.now() - pop.t) / 250) } : null;
      drawDoc(ctx, shownDoc, i, { k: kc, layers: shown, original: peek, live, chrome: true, pop: pk });
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const px = cssPx.current;
      if (selMark && !peek && !cropping) {
        const b = boxOf(selMark, shownDoc, M, ctx);
        ctx.setLineDash([7 * px, 5 * px]); ctx.lineWidth = 1.6 * px; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        ctx.setLineDash([]);
        for (const h of handlesOf(selMark, b)) {
          if (h.id === 'rot') { ctx.beginPath(); ctx.moveTo(h.from.x, h.from.y); ctx.lineTo(h.x, h.y); ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
          ctx.beginPath(); ctx.arc(h.x, h.y, (h.id === 'len' ? 7 : 8) * px, 0, Math.PI * 2); ctx.fillStyle = h.id === 'len' ? INK : '#ffffff'; ctx.fill(); ctx.strokeStyle = h.id === 'len' ? '#ffffff' : INK; ctx.lineWidth = 1.6 * px; ctx.stroke();
        }
      }
      if (cropping && cropDraft) {
        const r2 = { x: cropDraft.x * kc, y: cropDraft.y * kc, w: cropDraft.w * kc, h: cropDraft.h * kc };
        ctx.fillStyle = 'rgba(22,23,26,.55)'; ctx.beginPath(); ctx.rect(0, 0, c.width, c.height); ctx.rect(r2.x, r2.y, r2.w, r2.h); ctx.fill('evenodd');
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * px; ctx.strokeRect(r2.x, r2.y, r2.w, r2.h);
        ctx.lineWidth = 1 * px; ctx.globalAlpha = 0.6; for (const f of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.moveTo(r2.x + r2.w * f, r2.y); ctx.lineTo(r2.x + r2.w * f, r2.y + r2.h); ctx.moveTo(r2.x, r2.y + r2.h * f); ctx.lineTo(r2.x + r2.w, r2.y + r2.h * f); ctx.stroke(); } ctx.globalAlpha = 1;
        for (const [x, y] of [[r2.x, r2.y], [r2.x + r2.w, r2.y], [r2.x + r2.w, r2.y + r2.h], [r2.x, r2.y + r2.h]]) { ctx.beginPath(); ctx.arc(x, y, 9 * px, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); }
      }
      if (loupe) {
        // The exact spot, magnified, with its shade.
        const R = 46 * px, q = loupe.q, o = { x: clamp(q.x, R, c.width - R), y: q.y - R * 1.6 < R ? q.y + R * 1.6 : q.y - R * 1.6 };
        ctx.save(); ctx.beginPath(); ctx.arc(o.x, o.y, R, 0, Math.PI * 2); ctx.clip(); ctx.imageSmoothingEnabled = false;
        const z = 6; ctx.drawImage(c, q.x - R / z, q.y - R / z, (2 * R) / z, (2 * R) / z, o.x - R, o.y - R, 2 * R, 2 * R); ctx.restore();
        ctx.lineWidth = 4 * px; ctx.strokeStyle = loupe.c; ctx.beginPath(); ctx.arc(o.x, o.y, R, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 2 * px; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(o.x, o.y, R + 3 * px, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1.5 * px; ctx.beginPath(); ctx.moveTo(o.x - 7 * px, o.y); ctx.lineTo(o.x + 7 * px, o.y); ctx.moveTo(o.x, o.y - 7 * px); ctx.lineTo(o.x, o.y + 7 * px); ctx.stroke();
        ctx.font = `700 ${12 * px}px 'Plus Jakarta Sans', system-ui, sans-serif`; const t = loupe.c.toUpperCase(); const tw = ctx.measureText(t).width + 16 * px;
        ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect?.(o.x - tw / 2, o.y + R + 8 * px, tw, 24 * px, 12 * px); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, o.x, o.y + R + 20 * px);
      }
      ctx.restore();
    });
    return () => cancelAnimationFrame(raf);
  });
  React.useEffect(() => { if (!pop) return; let raf = 0; const go = () => { tick((n) => n + 1); if (performance.now() - pop.t < 260) raf = requestAnimationFrame(go); else setPop(null); }; raf = requestAnimationFrame(go); return () => cancelAnimationFrame(raf); }, [pop]);
  // A new pin's note is ready to type into (once the tap that placed it is over).
  React.useEffect(() => { if (!focusPin) return; const t = setTimeout(() => { (document.getElementById(`pin-note-${focusPin}`) as HTMLInputElement | null)?.focus(); setFocusPin(null); }, 60); return () => clearTimeout(t); }, [focusPin]);

  // ── Crop ───────────────────────────────────────────────────────────────────────────────────────────────────
  const wholeOf = (d: MarkupDoc) => { const ts = turnedSize(d); return { x: 0, y: 0, w: ts.w, h: ts.h }; };
  React.useEffect(() => { if (cropping && doc) setCropDraft(doc.view.crop || wholeOf(doc)); }, [cropping, !!doc]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The crop is applied when the crop tool is left (or Done). */
  const applyCrop = (d: MarkupDoc): MarkupDoc => {
    if (!cropDraft) return d; const ts = turnedSize(d);
    const whole = cropDraft.x <= 0 && cropDraft.y <= 0 && cropDraft.w >= ts.w - 1 && cropDraft.h >= ts.h - 1;
    return { ...d, view: { ...d.view, crop: whole ? null : { x: Math.round(cropDraft.x), y: Math.round(cropDraft.y), w: Math.round(cropDraft.w), h: Math.round(cropDraft.h) } } };
  };
  const pickTool = (t: Tool) => {
    if (cropping && t !== 'crop' && doc) { const d2 = applyCrop(doc); if (!same(d2.view, doc.view)) commit(d2); setCropDraft(null); }
    setTool(t); setSel(null); setLoupe(null); setSaid(null); setPeek(false); buzz();
  };
  const setCropRatio = (r: typeof ratio) => { if (!doc) return; setRatio(r); setCropDraft(cropTo(doc, r) || wholeOf(doc)); };
  const turn = () => { if (!doc) return; const nv = turnQuarter(applyCrop(doc)); commit({ ...doc, view: nv }); setCropDraft(nv.crop || wholeOf({ ...doc, view: nv })); setRatio('free'); };
  const flip = () => { if (!doc) return; const ts = turnedSize(doc); const c = cropDraft; commit({ ...doc, view: { ...doc.view, flip: !doc.view.flip } }); if (c) setCropDraft({ ...c, x: ts.w - c.x - c.w }); };
  const straighten = (deg: number) => { if (!doc) return; editStart(); setDoc({ ...doc, view: { ...doc.view, straighten: clamp(deg, -15, 15) } }); };

  // ── Zoom and look around ───────────────────────────────────────────────────────────────────────────────────
  /** Zoomed by f about a point on the screen (it stays under the finger or pointer). */
  const zoomAt = (f: number, at?: Pt) => setView((v0) => {
    const k = clamp(v0.k * f, 1, 5); if (k === 1) return { k: 1, x: 0, y: 0 };
    const r = stage.current?.getBoundingClientRect(); if (!r || !at) return { ...v0, k };
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; const u = { x: (at.x - c.x - v0.x) / v0.k, y: (at.y - c.y - v0.y) / v0.k };
    return { k, x: at.x - c.x - k * u.x, y: at.y - c.y - k * u.y };
  });
  React.useEffect(() => {
    const el = stage.current; if (!el) return;
    // The wheel (and a trackpad pinch) zooms the photo, never the page.
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY }); };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  });

  // ── Pointer ────────────────────────────────────────────────────────────────────────────────────────────────
  const at = (e: { clientX: number; clientY: number }): Pt => { const c = canvas.current!, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const toBase = (q: Pt) => ap(inv(M!), q);
  const newMark = (kind: Mark['kind'], pts: Pt[], extra: Partial<Mark> = {}): Mark => ({ id: uid(), kind, layer: active, color, size, opacity: 1, rotation: 0, pts, ...(dash && ['pen', 'highlight', 'line', 'arrow', 'circle', 'rect'].includes(kind) ? { dash: true } : {}), ...(!smooth && (kind === 'pen' || kind === 'highlight') ? { smooth: false } : {}), ...(by ? { by } : {}), ...extra });
  const pickAt = (q: Pt) => {
    if (!sample.current || !doc) return null; const b = toBase(q); const s = sample.current;
    try { const d = s.ctx.getImageData(clamp(Math.round(b.x * s.k), 0, s.ctx.canvas.width - 1), clamp(Math.round(b.y * s.k), 0, s.ctx.canvas.height - 1), 1, 1).data; return hex(d[0], d[1], d[2]); } catch { return null; }
  };
  const live2 = (g: Gesture | null) => (g && 'cur' in g ? g : null);

  const down = (e: React.PointerEvent) => {
    if (!doc || !M || locked) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      // Two fingers on a selected mark (with Move) resize and turn it; otherwise they zoom and pan, and whatever one
      // finger had started is dropped.
      const g0 = live2(gesture.current);
      if (tool === 'move' && selMark && (!g0 || g0.t === 'move')) {
        const base = g0 ? g0.before : doc; const orig = base.marks.find((m) => m.id === selMark.id) || selMark;
        gesture.current = { t: 'pinchMark', id: selMark.id, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), orig, before: base, cur: base }; setDoc(base); return;
      }
      if (g0) setDoc(g0.before);
      gesture.current = null; setLive(null); setLoupe(null);
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: view.x, y: view.y }; return;
    }
    // Holding Space (on a computer) drags the photo around, whatever the tool.
    if (space.current) { gesture.current = { t: 'pan', from: { x: e.clientX, y: e.clientY }, x: view.x, y: view.y }; return; }
    const q = at(e); const p = toBase(q); const px = cssPx.current; const reach = 22 * px;
    if (!shown.includes(active) && !['move', 'pick', 'crop', 'eraser'].includes(tool)) { setSaid(`The layer you’re adding to (${nameOf(active)}) is hidden. Show it to add to it.`); return; }
    if (cropping && cropDraft) {
      const r2 = { x: cropDraft.x * kc, y: cropDraft.y * kc, w: cropDraft.w * kc, h: cropDraft.h * kc };
      const corners = [[r2.x, r2.y], [r2.x + r2.w, r2.y], [r2.x + r2.w, r2.y + r2.h], [r2.x, r2.y + r2.h]];
      const hitC = corners.findIndex(([x, y]) => Math.hypot(q.x - x, q.y - y) <= reach);
      if (hitC >= 0) gesture.current = { t: 'crop', part: hitC as 0 | 1 | 2 | 3, from: q, orig: { ...cropDraft } };
      else if (q.x >= r2.x && q.x <= r2.x + r2.w && q.y >= r2.y && q.y <= r2.y + r2.h) gesture.current = { t: 'crop', part: 'move', from: q, orig: { ...cropDraft } };
      return;
    }
    if (tool === 'pick') {
      if (!sample.current) { setSaid('Colors can’t be picked from this photo. Choose it again from your photos to pick one.'); return; }
      const c = pickAt(q); if (c) { setLoupe({ q, c }); gesture.current = { t: 'pick' }; } return;
    }
    if (tool === 'move') {
      if (selMark) {
        const b = boxOf(selMark, doc, M, canvas.current!.getContext('2d'));
        const h = handlesOf(selMark, b).find((x) => Math.hypot(q.x - x.x, q.y - x.y) <= reach);
        if (h) {
          const c = selMark.kind === 'text' || selMark.kind === 'stamp' || selMark.kind === 'pin' || selMark.kind === 'nail' ? ap(M, selMark.pts[0]) : ap(M, centerOf(selMark));
          gesture.current = { t: h.id === 'rot' ? 'rotate' : h.id === 'len' ? 'length' : 'resize', id: selMark.id, from: q, orig: selMark, before: doc, cur: doc, c }; return;
        }
        if (selMark.kind === 'lens') {
          const R = lensRadius(selMark, doc.w) * scaleOf(M); const spot = ap(M, selMark.pts[0]), lens = ap(M, selMark.pts[1]);
          if (Math.hypot(q.x - lens.x, q.y - lens.y) <= R) { gesture.current = { t: 'lens', id: selMark.id, from: p, orig: selMark, before: doc, cur: doc }; return; }
          if (Math.hypot(q.x - spot.x, q.y - spot.y) <= Math.max(reach, R / (selMark.zoom || 3))) { gesture.current = { t: 'spot', id: selMark.id, from: p, orig: selMark, before: doc, cur: doc }; return; }
        }
      }
      const hit = hitMark(doc, M, q, { layers: reachable, slop: 12 * px, ctx: canvas.current!.getContext('2d') });
      setSel(hit?.id || null);
      if (hit) gesture.current = { t: 'move', id: hit.id, from: p, orig: hit, before: doc, cur: doc };
      else if (view.k > 1) gesture.current = { t: 'pan', from: { x: e.clientX, y: e.clientY }, x: view.x, y: view.y };   // dragging the photo looks around it
      return;
    }
    if (tool === 'text') { const t = label.trim(); if (!t) { setSaid('Type a label first, then tap the photo to place it.'); return; } add(newMark('text', [p], { text: t.slice(0, LIMITS.text) })); setLabel(''); return; }
    if (tool === 'stamp') {
      if (stamp === 'number') { add(newMark('pin', [p], { pin: { n: doc.nextPin, note: '' } }), { nextPin: doc.nextPin + 1 }); return; }
      add(newMark('stamp', [p], { stamp })); return;
    }
    if (tool === 'pin') { if (full()) return; const mk = newMark('pin', [p], { pin: { n: doc.nextPin, note: '' } }); add(mk, { nextPin: doc.nextPin + 1 }); setFocusPin(mk.id); return; }
    if (tool === 'nail') { add(newMark('nail', [p], { nail: { ...nail } })); return; }
    if (tool === 'magnify') {
      if (full()) return;
      const mk0 = newMark('lens', [p, p], { zoom: zoomLens }); const R = lensRadius(mk0, doc.w); const vc = toBase({ x: canvas.current!.width / 2, y: canvas.current!.height / 2 });
      const dx = vc.x >= p.x ? 1 : -1, dy = vc.y >= p.y ? 1 : -1;
      const lens = { x: clamp(p.x + dx * R * 1.7, R, doc.w - R), y: clamp(p.y + dy * R * 1.7, R, doc.h - R) };
      const mk = { ...mk0, pts: [p, lens] }; add(mk); setSel(mk.id); return;
    }
    if (tool === 'eraser') {
      // A line rubbed out in the middle becomes two marks: at the limit, the eraser can't split one.
      if (doc.marks.length >= LIMITS.marks) setSaid('This photo has as many marks as it can hold, so the eraser can’t split a line in two. Delete a mark first.');
      gesture.current = { t: 'erase', last: p, before: doc, cur: doc }; return;
    }
    if (full()) return;
    const kind = tool === 'shapes' ? shape : tool === 'blur' ? 'blur' : (tool as Mark['kind']);
    const mk = newMark(kind, [p]); gesture.current = { t: 'draw', mark: mk, ...(kind === 'circle' ? { center: p } : {}) }; setLive(mk);
  };

  const move = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (touches.current.size === 2 && (pinch.current || g?.t === 'pinchMark')) {
      const [a, b] = [...touches.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (g?.t === 'pinchMark') {
        let next = scaled(g.orig, clamp(d / g.d0, 0.15, 8));
        if (!NO_TURN.includes(g.orig.kind)) { const da = Math.atan2(b.y - a.y, b.x - a.x) - g.a0; next = { ...next, rotation: g.orig.rotation + (flipped && PHOTO_TURNED.includes(g.orig.kind) ? -da : da) }; }
        g.cur = { ...g.before, marks: g.before.marks.map((m) => (m.id === g.id ? next : m)) }; setDoc(g.cur); return;
      }
      const p0 = pinch.current!; const k = clamp(p0.k * (d / (p0.d || 1)), 1, 5);
      const r = stage.current?.getBoundingClientRect();
      if (k === 1 || !r) { setView({ k: 1, x: 0, y: 0 }); return; }
      // The point that was between the fingers stays between them.
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; const u = { x: (p0.mid.x - c.x - p0.x) / p0.k, y: (p0.mid.y - c.y - p0.y) / p0.k };
      setView({ k, x: mid.x - c.x - k * u.x, y: mid.y - c.y - k * u.y }); return;
    }
    if (!g || !doc || !M) return;
    if (g.t === 'pan') { setView((v0) => ({ ...v0, x: g.x + (e.clientX - g.from.x), y: g.y + (e.clientY - g.from.y) })); return; }
    const q = at(e); const p = toBase(q);
    if (g.t === 'pick') { const c = pickAt(q); if (c) setLoupe({ q, c }); return; }
    if (g.t === 'crop') {
      const ts = turnedSize(doc); const dx = (q.x - g.from.x) / kc, dy = (q.y - g.from.y) / kc; const o = g.orig;
      if (g.part === 'move') { setCropDraft({ ...o, x: clamp(o.x + dx, 0, ts.w - o.w), y: clamp(o.y + dy, 0, ts.h - o.h) }); return; }
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (g.part === 0 || g.part === 3) x0 = clamp(x0 + dx, 0, x1 - 32); else x1 = clamp(x1 + dx, x0 + 32, ts.w);
      if (g.part === 0 || g.part === 1) y0 = clamp(y0 + dy, 0, y1 - 32); else y1 = clamp(y1 + dy, y0 + 32, ts.h);
      const r = ratio === 'square' ? 1 : ratio === '4:5' ? 0.8 : ratio === '3:4' ? 0.75 : 0;
      if (r) { const w = x1 - x0; const h = w / r; if (g.part === 0 || g.part === 1) y0 = Math.max(0, y1 - h); else y1 = Math.min(ts.h, y0 + h); const h2 = y1 - y0; const w2 = h2 * r; if (g.part === 0 || g.part === 3) x0 = x1 - w2; else x1 = x0 + w2; }
      setCropDraft({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); return;
    }
    if (g.t === 'draw') {
      const mk = g.mark;
      if (mk.kind === 'pen' || mk.kind === 'highlight') {
        // Close points are skipped, and a very long stroke is thinned as it goes, so it never just stops.
        const last = mk.pts[mk.pts.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) < Math.max(1, doc.w / 1000)) return;
        mk.pts = [...mk.pts, p]; if (mk.pts.length >= LIMITS.points) mk.pts = simplified(mk.pts, Math.max(0.6, doc.w / 1500) * 2);
      } else if (g.center && (round || shift.current)) { const r = Math.hypot(p.x - g.center.x, p.y - g.center.y); mk.pts = [{ x: g.center.x - r, y: g.center.y - r }, { x: g.center.x + r, y: g.center.y + r }]; }
      else if (mk.kind === 'rect' && shift.current) { const a = mk.pts[0]; const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y)); mk.pts = [a, { x: a.x + Math.sign(p.x - a.x || 1) * s, y: a.y + Math.sign(p.y - a.y || 1) * s }]; }
      else mk.pts = [mk.pts[0], p];
      setLive({ ...mk }); return;
    }
    if (g.t === 'erase') { const r = Math.max(6, size * doc.w * 3); g.cur = { ...g.cur, marks: erased(g.cur.marks, [g.last, p], r, reachable) }; g.last = p; setDoc(g.cur); return; }
    if (g.t === 'pinchMark') return;
    const dx = p.x - g.from.x, dy = p.y - g.from.y;
    let next: Mark = g.orig;
    if (g.t === 'move') next = moved(g.orig, dx, dy);
    else if (g.t === 'spot') next = { ...g.orig, pts: [{ x: g.orig.pts[0].x + dx, y: g.orig.pts[0].y + dy }, g.orig.pts[1]] };
    else if (g.t === 'lens') next = { ...g.orig, pts: [g.orig.pts[0], { x: g.orig.pts[1].x + dx, y: g.orig.pts[1].y + dy }] };
    else if (g.t === 'resize' && g.c) { const d0 = Math.hypot(g.from.x - g.c.x, g.from.y - g.c.y) || 1; next = scaled(g.orig, clamp(Math.hypot(q.x - g.c.x, q.y - g.c.y) / d0, 0.15, 8)); }
    else if (g.t === 'rotate' && g.c) {
      const a0 = Math.atan2(g.from.y - g.c.y, g.from.x - g.c.x), a1 = Math.atan2(q.y - g.c.y, q.x - g.c.x); const da = a1 - a0;
      let r = g.orig.rotation + (flipped && PHOTO_TURNED.includes(g.orig.kind) ? -da : da); const deg = (r * 180) / Math.PI; const snap = Math.round(deg / 45) * 45; if (Math.abs(deg - snap) < 4) r = (snap * Math.PI) / 180;
      next = { ...g.orig, rotation: r };
    } else if (g.t === 'length') {
      // The free edge sets the length: whichever length is nearest where it's dragged to (it sits half the guide's
      // height from its middle).
      const want = (2 * Math.hypot(p.x - g.orig.pts[0].x, p.y - g.orig.pts[0].y)) / (unitOf(g.orig, doc.w) * 3.2);
      const best = NAIL_LENGTHS.reduce((a, b) => (Math.abs(b.k - want) < Math.abs(a.k - want) ? b : a));
      next = { ...g.orig, nail: { ...g.orig.nail!, length: best.key } };
    }
    g.cur = { ...g.before, marks: g.before.marks.map((m) => (m.id === g.orig.id ? next : m)) }; setDoc(g.cur);
  };

  const up = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null;
    const g = gesture.current;
    if (g?.t === 'pinchMark' && touches.current.size) return;   // one finger still down: the pinch carries on until both lift
    gesture.current = null; if (!g || !doc) return;
    if (g.t === 'pick') { const c = loupe?.c; setLoupe(null); if (c) { setColor(c); if (!doc.colors.includes(c)) commit({ ...doc, colors: [...doc.colors, c].slice(-LIMITS.colors) }); buzz(); } return; }
    if (g.t === 'crop' || g.t === 'pan') return;
    if (g.t === 'draw') {
      setLive(null); const mk = g.mark;
      const big = mk.pts.length > 1 && Math.hypot(mk.pts[mk.pts.length - 1].x - mk.pts[0].x, mk.pts[mk.pts.length - 1].y - mk.pts[0].y) > doc.w * 0.01;
      if (mk.kind === 'pen' || mk.kind === 'highlight' ? mk.pts.length >= 1 : big) add(mk);
      return;
    }
    if (!same(g.cur.marks, g.before.marks)) commit(g.cur, g.before);
  };

  // ── Keys, Back, focus ──────────────────────────────────────────────────────────────────────────────────────
  const dirty = past.length > 0 || note !== initialNote;
  const askLeave = () => { if (saving) return; if (dirty) setLeaving(true); else onCancel(); };
  const remove = () => { if (!doc || !selMark) return; commit({ ...doc, marks: doc.marks.filter((m) => m.id !== selMark.id) }); setSel(null); root.current?.focus({ preventScroll: true }); buzz(); };
  React.useEffect(() => {
    const before = document.activeElement as HTMLElement | null; root.current?.focus({ preventScroll: true });
    return () => { try { before?.focus?.({ preventScroll: true }); } catch { /* gone */ } };
  }, []);
  React.useEffect(() => {
    // The phone's Back button (from the booking sheet, components/booking/StudioFlow) lets go of a mark, then asks to leave.
    // Only when this is the screen on top (Compare open over it takes Back for itself).
    const back = () => { const all = document.querySelectorAll('[data-markup-editor]'); if (all.length && all[all.length - 1] !== root.current) return; if (sel) setSel(null); else askLeave(); };
    window.addEventListener('cf-markup-back', back); return () => window.removeEventListener('cf-markup-back', back);
  });
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement; const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
    if (e.key === 'Shift') shift.current = true;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (leaving) setLeaving(false); else if (sel) setSel(null); else askLeave(); return; }
    if (e.key === 'Tab' && root.current) {
      // Tab goes round the editor alone.
      const f = Array.from(root.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === root.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      return;
    }
    if (typing) return;
    // On a computer: one key for each tool, \\ held to see the original, Space held to look around. Never while typing,
    // and Space and the arrows are left to a button that has the focus (Space presses it).
    const onBtn = !!t.closest('button,a,summary,[role=switch],[role=slider]');
    if (!locked && (e.code === 'Backslash' || e.key === '\\')) { e.preventDefault(); setPeek(true); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !locked) {
      if (e.key === ' ' && !onBtn) { e.preventDefault(); holdSpace(true); return; }
      // (The key's own letter first; a key's place on the keyboard only when it types no letter at all, as on a
      // keyboard in another alphabet, so a different layout never picks the wrong tool.)
      const k0 = KEYS[e.key.toLowerCase()] ?? (/^[a-z]$/i.test(e.key) ? undefined : KEYS[/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : '']);
      const k = k0 && !hiddenTools.includes(k0) ? k0 : undefined;   // a tool left out has no key either
      if (k) { e.preventDefault(); if (k === 'line') { setShape('line'); pickTool('shapes'); } else if (k === 'shapes') { setShape('rect'); pickTool('shapes'); } else pickTool(k); return; }
    }
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) { e.preventDefault(); if (cropping) return; if (e.shiftKey || e.key.toLowerCase() === 'y') redo(); else undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selMark && !onBtn) { e.preventDefault(); remove(); return; }
    if (selMark && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && !onBtn && M && doc) {
      // Nudged a little (a lot with Shift), the way it looks on the screen.
      e.preventDefault(); const step = (e.shiftKey ? 10 : 1) * cssPx.current; const d = { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 };
      const o = toBase({ x: 0, y: 0 }), w = toBase(d); changeLive((m) => moved(m, w.x - o.x, w.y - o.y));   // one undo step for the whole nudge
    }
  };

  const done = async (which: 'main' | 'alt' = 'main') => {
    const i = img.current; if (!doc || !i || saving) return;
    const save = which === 'alt' && alt ? alt.onDone : onDone;
    flushEdit(); const d = { ...(cropping ? applyCrop(doc) : doc), note: note.trim() };
    let dataUrl = '';
    // What's sent is what's shown: a layer hidden while working is left out of the copy (its marks are kept).
    const out = sent.filter((l) => shown.includes(l));
    try { dataUrl = format === 'png' ? flatten(d, i, out).canvas.toDataURL('image/png') : flatten(d, i, out).canvas.toDataURL('image/jpeg', 0.86); }
    catch { setSaid(layer === 'client' ? 'This photo can’t be saved from here. Please choose it again from your photos.' : 'This photo can’t be saved from here. Please open it again.'); return; }
    setSaving(which); setSaid(null); root.current?.focus({ preventScroll: true });   // (Done is off while it saves: keep the keys here)
    try { const err = await save({ dataUrl, doc: d, note: d.note, colors: d.colors }); if (err) setSaid(err); }
    catch { setSaid('Your photo didn’t save. Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  // ── The screen ─────────────────────────────────────────────────────────────────────────────────────────────
  const heading = selMark ? `${NAMES[selMark.kind] || 'Mark'} selected` : tool === 'move' ? (title || 'Mark up') : TOOLS.find((x) => x.k === tool)?.label || title || 'Mark up';
  const chip = 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-[14px] font-semibold transition active:scale-95';
  const chipStyle = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` });
  const setColorTo = (c: string, liveDrag = false) => { if (selMark) (liveDrag ? changeLive : change)((m) => ({ ...m, color: c })); setColor(c); };
  const Swatches = () => (
    <div className={wide ? 'flex flex-wrap items-center' : '-mx-3 flex items-center overflow-x-auto px-2'} role="group" aria-label="Colors">
      {[...PALETTE, ...(doc ? doc.colors.filter((c) => !PALETTE.includes(c)) : [])].map((c) => { const on = (selMark?.color || color) === c; return (
        <button key={c} type="button" onClick={() => { setColorTo(c); buzz(); }} aria-label={PALETTE.includes(c) ? `Color ${c}` : `Color ${c}, picked from the photo`} aria-pressed={on}
          className="grid h-11 w-11 shrink-0 place-items-center transition active:scale-90"><span className="h-8 w-8 rounded-full" style={{ background: c, boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px ${INK}` : `inset 0 0 0 1px ${LINE}` }} /></button>); })}
      <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center" aria-label="Custom color"><span className="relative h-8 w-8 overflow-hidden rounded-full" style={{ background: 'conic-gradient(#e11d48, #f59e0b, #16a34a, #2563eb, #7c3aed, #e11d48)' }}>
        <input type="color" value={selMark?.color || color} onChange={(e) => setColorTo(e.target.value, true)} onBlur={editEnd} className="absolute inset-0 cursor-pointer opacity-0" /></span></label>
    </div>);
  const Sizes = ({ withLine = true }: { withLine?: boolean }) => (
    <div className={wide ? 'flex flex-wrap items-center gap-1.5' : '-mx-3 flex items-center gap-1.5 overflow-x-auto px-3'}>
      {SIZES.map((s) => { const on = Math.abs((selMark?.size ?? size) - s.v) < 1e-6; return <button key={s.key} type="button" aria-label={`Size ${s.key}`} aria-pressed={on} onClick={() => { if (selMark) change((m) => ({ ...m, size: s.v })); setSize(s.v); }} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold" style={chipStyle(on)}>{s.key}</button>; })}
      {withLine && <><span className="mx-1 h-6 w-px shrink-0" style={{ background: LINE }} />
        <button type="button" aria-pressed={!(selMark ? selMark.dash : dash)} onClick={() => { if (selMark) change((m) => ({ ...m, dash: false })); setDash(false); }} className={chip} style={chipStyle(!(selMark ? selMark.dash : dash))}>Solid</button>
        <button type="button" aria-pressed={!!(selMark ? selMark.dash : dash)} onClick={() => { if (selMark) change((m) => ({ ...m, dash: true })); setDash(true); }} className={chip} style={chipStyle(!!(selMark ? selMark.dash : dash))}>Dashed</button></>}
      {(tool === 'pen' || tool === 'highlight') && !selMark && <button type="button" aria-pressed={smooth} onClick={() => setSmooth((x) => !x)} className={chip} style={chipStyle(smooth)}>{smooth ? 'Smooth on' : 'Smooth off'}</button>}
    </div>);
  const slider = { onPointerDown: editStart, onFocus: editStart, onKeyDown: editStart, onPointerUp: editEnd, onPointerCancel: editEnd, onKeyUp: editEnd, onBlur: editEnd };

  const pins = doc ? doc.marks.filter((m) => m.kind === 'pin' && shown.includes(m.layer)).sort((a, b) => a.pin!.n - b.pin!.n) : [];
  const panel = () => {
    if (!doc) return null;
    if (selMark) {
      const k = selMark.kind;
      return (
        <div className="space-y-3">
          {k === 'text' && <input value={selMark.text || ''} onChange={(e) => { editStart(); setDoc({ ...doc, marks: doc.marks.map((m) => (m.id === selMark.id ? { ...m, text: e.target.value.slice(0, LIMITS.text) } : m)) }); }} onBlur={editEnd} aria-label="Label text" className="h-11 w-full rounded-xl px-3 text-[16px]" style={{ boxShadow: `inset 0 0 0 1px ${LINE}`, background: '#fff' }} />}
          {k === 'pin' && <input value={selMark.pin?.note || ''} placeholder={`A note for pin ${selMark.pin?.n}`} onBlur={editEnd} onChange={(e) => { editStart(); setDoc({ ...doc, marks: withPinNote(doc.marks, selMark.id, e.target.value) }); }} aria-label={`Note for pin ${selMark.pin?.n}`} className="h-11 w-full rounded-xl px-3 text-[16px]" style={{ boxShadow: `inset 0 0 0 1px ${LINE}`, background: '#fff' }} />}
          {k === 'nail' && <NailChoices value={selMark.nail!} onChange={(n) => change((m) => ({ ...m, nail: n }))} />}
          {k === 'lens' && <div className="flex gap-2">{([2, 3, 4] as const).map((z) => <button key={z} type="button" aria-pressed={selMark.zoom === z} onClick={() => change((m) => ({ ...m, zoom: z }))} className={chip} style={chipStyle(selMark.zoom === z)}>{z}×</button>)}</div>}
          <div className="-mx-1 flex flex-wrap gap-2 px-1">
            {!NO_TURN.includes(k) && <button type="button" onClick={() => change((m) => ({ ...m, rotation: m.rotation + Math.PI / 12 }))} className={chip} style={chipStyle(false)}>Rotate</button>}
            <button type="button" onClick={() => { if (full()) return; const r = duplicated(doc, selMark); commit({ ...doc, nextPin: r.nextPin, marks: [...doc.marks, r.mark] }); setSel(r.mark.id); }} className={chip} style={chipStyle(false)}>Duplicate</button>
            <button type="button" onClick={() => commit({ ...doc, marks: restacked(doc.marks, selMark.id, 'front') })} className={chip} style={chipStyle(false)}>To front</button>
            <button type="button" onClick={() => commit({ ...doc, marks: restacked(doc.marks, selMark.id, 'back') })} className={chip} style={chipStyle(false)}>To back</button>
            {k === 'nail' && <button type="button" onClick={() => commit({ ...doc, marks: toEveryNail(doc.marks, selMark) })} className={chip} style={chipStyle(false)}>Copy to every nail</button>}
            <button type="button" onClick={remove} className={chip} style={{ background: '#fff', color: RED, boxShadow: `inset 0 0 0 1px ${LINE}` }}>Delete</button>
          </div>
          {k !== 'lens' && k !== 'blur' && Swatches()}
          {k !== 'blur' && Sizes({ withLine: ['pen', 'highlight', 'line', 'arrow', 'circle', 'rect'].includes(k) })}
          {k !== 'blur' && <label className="flex items-center gap-3 text-[14px]" style={{ color: INK }}><span className="w-16 shrink-0">Opacity</span>
            <input type="range" min={10} max={100} step={5} value={Math.round((selMark.opacity ?? 1) * 100)} onChange={(e) => changeLive((m) => ({ ...m, opacity: Number(e.target.value) / 100 }))} {...slider} className="h-11 flex-1" aria-label="Opacity" />
            <span className="w-12 text-right tabular-nums" style={{ color: MUTED }}>{Math.round((selMark.opacity ?? 1) * 100)}%</span></label>}
        </div>);
    }
    if (tool === 'text') return <div className="space-y-3"><input value={label} onChange={(e) => setLabel(e.target.value.slice(0, LIMITS.text))} placeholder="Type a label, then tap the photo to place it" aria-label="Label text" className="h-11 w-full rounded-xl px-3 text-[16px]" style={{ boxShadow: `inset 0 0 0 1px ${LINE}`, background: '#fff' }} />{Swatches()}{Sizes({ withLine: false })}</div>;
    if (tool === 'stamp') return (
      <div className="space-y-3"><div className="flex flex-wrap gap-2">{[...STAMPS.map((s) => ({ k: s.key as StampKind | 'number', l: s.label })), { k: 'number' as const, l: 'Number' }].map((s) => <button key={s.k} type="button" aria-pressed={stamp === s.k} onClick={() => setStamp(s.k)} className={chip} style={chipStyle(stamp === s.k)}>{s.l}</button>)}</div>
        {Swatches()}{Sizes({ withLine: false })}<Hint>Tap the photo to place it. Numbers keep their number when one is removed.</Hint></div>);
    if (tool === 'nail') return <div className="space-y-3"><NailChoices value={nail} onChange={setNail} />{Swatches()}<Hint>Tap each nail to place a guide. With Move, drag the top of a guide to set its length, or copy one guide to every nail.</Hint></div>;
    if (tool === 'pin') return (
      <div className="space-y-2">
        {pins.length > 0 && <div className="overflow-hidden rounded-2xl" style={{ boxShadow: `inset 0 0 0 1px ${LINE}`, background: '#fff' }}>{pins.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3 px-3" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold" style={{ background: m.color, color: contrast(m.color), boxShadow: `inset 0 0 0 1px ${LINE}` }}>{m.pin!.n}</span>
            <input id={`pin-note-${m.id}`} value={m.pin!.note} disabled={!mine.includes(m.layer)} placeholder="Add a note" onFocus={() => setSel(null)} onBlur={editEnd} onChange={(e) => { editStart(); setDoc({ ...doc, marks: withPinNote(doc.marks, m.id, e.target.value) }); }} aria-label={`Note for pin ${m.pin!.n}`} className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
            {mine.includes(m.layer) && <button type="button" onClick={() => { commit({ ...doc, marks: doc.marks.filter((x) => x.id !== m.id) }); root.current?.focus({ preventScroll: true }); }} aria-label={`Remove pin ${m.pin!.n}`} className="grid h-11 w-11 place-items-center rounded-full" style={{ color: MUTED }}><X size={16} /></button>}
          </div>))}</div>}
        <Hint>Tap the photo to add pin {doc.nextPin}. Pins keep their number when one is removed, so notes never get mixed up.</Hint>{Swatches()}</div>);
    if (tool === 'pick') return (
      <div className="space-y-2"><p className="text-[13px] font-semibold" style={{ color: MUTED }}>{layer === 'client' ? 'Colors I love' : 'Colors picked'}</p>
        <div className="flex flex-wrap items-center gap-3">{doc.colors.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className="flex min-h-11 flex-col items-center gap-1 text-[12px]" style={{ color: MUTED }} aria-label={`Use ${c}`}><span className="h-11 w-11 rounded-xl" style={{ background: c, boxShadow: `inset 0 0 0 1px ${LINE}` }} />{c.slice(1).toUpperCase()}</button>)}
          {doc.colors.length > 0 && <button type="button" onClick={() => commit({ ...doc, colors: [] })} className="min-h-11 px-2 text-[13px] font-semibold" style={{ color: MUTED }}>Clear</button>}</div>
        <Hint>{!sample.current ? 'Colors can’t be picked from this photo.' : doc.colors.length ? (layer === 'client' ? 'Added to your note so the exact shades are seen.' : 'Added to the note with the photo.') : `Touch the photo and move to the exact spot. The shade is added to ${layer === 'client' ? 'Colors I love' : 'the colors picked'}.`}</Hint></div>);
    if (tool === 'magnify' || tool === 'blur') return (
      <div className="space-y-3"><div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={tool === 'magnify'} onClick={() => pickTool('magnify')} className={chip} style={chipStyle(tool === 'magnify')}>Magnify</button>
        <button type="button" aria-pressed={tool === 'blur'} onClick={() => pickTool('blur')} className={chip} style={chipStyle(tool === 'blur')}>Blur</button>
        {tool === 'magnify' && <span className="ml-auto flex gap-2">{([2, 3, 4] as const).map((z) => <button key={z} type="button" aria-pressed={zoomLens === z} onClick={() => setZoomLens(z)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[14px] font-semibold" style={chipStyle(zoomLens === z)}>{z}×</button>)}</span>}</div>
        <Hint>{tool === 'magnify' ? 'Tap a spot to show a close-up of it, right on the photo. Move the close-up anywhere.' : 'Drag over a face, a tattoo or anything personal to hide it. The photo is sent blurred, and the blur can’t be taken off it later.'}</Hint></div>);
    if (tool === 'eraser') return <div className="space-y-3">{Sizes({ withLine: false })}<Hint>Rub over drawn lines to take them away. Other marks are removed with Move, then Delete.</Hint></div>;
    if (tool === 'crop') return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{([['free', 'Free'], ['square', 'Square'], ['4:5', '4:5'], ['3:4', '3:4']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={ratio === k} onClick={() => setCropRatio(k)} className={chip} style={chipStyle(ratio === k)}>{l}</button>)}</div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={turn} className={chip} style={chipStyle(false)}>Rotate 90°</button><button type="button" aria-pressed={!!doc.view.flip} onClick={flip} className={chip} style={chipStyle(!!doc.view.flip)}>Flip</button></div>
        <label className="flex items-center gap-3 text-[14px]" style={{ color: INK }}><span className="w-24 shrink-0">Straighten</span>
          <input type="range" min={-15} max={15} step={0.5} value={doc.view.straighten} onChange={(e) => straighten(Number(e.target.value))} {...slider} className="h-11 flex-1" aria-label="Straighten" />
          <span className="w-12 text-right tabular-nums" style={{ color: MUTED }}>{doc.view.straighten.toFixed(1)}°</span></label>
        <Hint>Marks stay where you put them when the photo is cropped or turned.</Hint></div>);
    if (tool === 'move') return <Hint>Tap a mark to move it, resize it from a corner, or turn it from its handle. Two fingers on a selected mark resize and turn it too.</Hint>;
    return (
      <div className="space-y-3">
        {tool === 'shapes' && <div className="flex gap-2"><button type="button" aria-pressed={shape === 'rect'} onClick={() => setShape('rect')} className={chip} style={chipStyle(shape === 'rect')}>Box</button><button type="button" aria-pressed={shape === 'line'} onClick={() => setShape('line')} className={chip} style={chipStyle(shape === 'line')}>Straight line</button></div>}
        {tool === 'circle' && <div className="flex gap-2"><button type="button" aria-pressed={!round} onClick={() => setRound(false)} className={chip} style={chipStyle(!round)}>Oval</button><button type="button" aria-pressed={round} onClick={() => setRound(true)} className={chip} style={chipStyle(round)}>Round, from the middle</button></div>}
        {Swatches()}{Sizes({})}</div>);
  };

  // ── Layers ─────────────────────────────────────────────────────────────────────────────────────────────────
  function nameOf(l: Layer): string {
    if (layerNames?.[l]) return layerNames[l]!;
    if (l === 'private') return 'Private team notes';
    if (l === 'client') return layer === 'client' ? 'Your marks' : `${clientName ? `${clientName}’s` : 'The client’s'} marks`;
    return layer === 'client' ? 'The team’s marks' : `${by ? `${by}’s` : 'The team’s'} marks`;
  }
  const layerList: Layer[] = doc ? (['client', 'team', 'private'] as Layer[]).filter((l) => (l !== 'private' || mine.includes('private')) && (mine.includes(l) || doc.marks.some((m) => m.layer === l))) : [];
  const summaryOf = (l: Layer) => {
    if (l === 'private') return `Never shown to ${clientName || 'the client'}`;
    const ms = doc ? doc.marks.filter((m) => m.layer === l) : []; const n = ms.filter((m) => m.kind === 'pin').length; const r = ms.length - n;
    return ms.length ? [r ? `${r} mark${r === 1 ? '' : 's'}` : '', n ? `${n} pin${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') : 'No marks yet';
  };
  const toggleLayer = (l: Layer) => {
    const on = shown.includes(l); const next = on ? shown.filter((x) => x !== l) : [...shown, l]; setShown(next);
    if (!on && mine.includes(l)) setSaid(null);
    if (on && selMark?.layer === l) setSel(null);
    // Hiding the layer being added to moves to another that can be changed (or says there isn't one).
    if (on && l === active) { const other = mine.find((x) => x !== l && next.includes(x)); if (other) setActive(other); else setSaid('Every layer you can change is hidden. Show one to keep marking up.'); }
  };
  const Layers = () => (layerList.length > 1 || mine.length > 1 ? (
    <section aria-label="Layers" className="space-y-1.5">
      <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Layers</p>
      {mine.length > 1 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="New marks go on">
        <span className="text-[13px]" style={{ color: MUTED }}>Adding to</span>
        {mine.map((l) => <button key={l} type="button" aria-pressed={active === l} onClick={() => { setActive(l); if (!shown.includes(l)) setShown([...shown, l]); }} className={chip} style={chipStyle(active === l)}>{nameOf(l)}</button>)}</div>}
      <div className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: `inset 0 0 0 1px ${LINE}` }}>
        {layerList.map((l, i) => { const on = shown.includes(l); return (
          <div key={l} className="flex items-center gap-3 pl-3" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l === 'client' ? INK : l === 'team' ? GOOD : MUTED }} />
            <div className="min-w-0 flex-1 py-2"><p className="text-[14.5px]">{nameOf(l)}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{summaryOf(l)}</p></div>
            <button type="button" role="switch" aria-checked={on} aria-label={`Show ${nameOf(l)}`} onClick={() => toggleLayer(l)} className="grid h-11 w-14 shrink-0 place-items-center">
              <span className="relative h-[26px] w-[44px] rounded-full transition" style={on ? { background: GOOD } : { background: LINE, boxShadow: `inset 0 0 0 1.5px ${MUTED}` }}><span className="absolute top-[2px] h-[22px] w-[22px] rounded-full transition-all" style={{ left: on ? 20 : 2, background: '#fff', boxShadow: `0 1px 3px rgba(22,23,26,.3)` }} /></span></button>
          </div>); })}
      </div>
    </section>) : null);

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const canvasEl = failed ? <p className="px-6 text-center text-[15px]" role="alert" style={{ color: WARN }}>{failed}</p>
    : <canvas ref={canvas} role="img" tabIndex={0} aria-label={doc ? altText(doc, note, shown) : 'Your photo'} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}
        className="max-h-full max-w-full touch-none select-none outline-none" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: 'center', cursor: spacing ? 'grab' : tool === 'move' ? (view.k > 1 ? 'grab' : 'default') : tool === 'pick' ? 'copy' : tool === 'crop' ? 'move' : ['text', 'stamp', 'pin', 'nail', 'magnify'].includes(tool) ? 'cell' : 'crosshair' }} />;
  const leaveBar = leaving && <div className="flex flex-wrap items-center gap-2 px-3 pb-2" role="alertdialog" aria-label="Leave without saving?">
    <p className="mr-auto text-[14px]">Leave without saving your marks?</p>
    <button type="button" autoFocus onClick={() => { setLeaving(false); root.current?.focus({ preventScroll: true }); }} className={chip} style={chipStyle(true)}>Keep marking up</button>
    <button type="button" onClick={onCancel} className={chip} style={{ background: '#fff', color: RED, boxShadow: `inset 0 0 0 1px ${LINE}` }}>Leave</button></div>;
  const notice = (said || locked) && <p className="text-[14px] leading-snug" role="alert" style={{ color: WARN }}>{said || (layer === 'client' ? 'This photo can be looked at here, but not changed. Choose it again from your photos to mark it up.' : 'This photo came from another site, so it can be looked at here, but not marked up.')}</p>;
  const noteBox = doc && <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, LIMITS.note))} rows={2} placeholder={layer === 'client' ? 'Add a note (optional), like this shape but a little shorter' : 'A note with the photo (optional)'} aria-label="Note for this photo" className="w-full rounded-2xl p-3 text-[16px]" style={{ background: '#fff', boxShadow: `inset 0 0 0 1px ${LINE}` }} />;
  const holdProps = { onPointerDown: () => setPeek(true), onPointerUp: () => setPeek(false), onPointerLeave: () => setPeek(false), onPointerCancel: () => setPeek(false), onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') setPeek(true); }, onKeyUp: () => setPeek(false) };
  const rootProps = { ref: root, tabIndex: -1, 'data-markup-editor': '', onKeyDown: onKey, ...(inline ? { role: 'group' as const } : { role: 'dialog' as const, 'aria-modal': true as const }), 'aria-label': title ? `Mark up: ${title}` : 'Mark up your photo',
    onKeyUp: (e: React.KeyboardEvent) => { if (e.key === 'Shift') shift.current = false; if (e.code === 'Backslash' || e.key === '\\') setPeek(false); if (e.key === ' ') holdSpace(false); if (/^Arrow/.test(e.key)) editEnd(); } };

  if (typeof document === 'undefined') return null;
  const place = (node: React.ReactElement) => (inline ? node : createPortal(node, document.body));
  // ── A computer: tools down the left (with their keys), the photo in the middle, settings, layers and pins on the right.
  if (wide) {
    const darkChip = 'inline-flex min-h-11 items-center gap-1 rounded-full px-3.5 text-[13.5px] font-medium disabled:opacity-40';
    const darkStyle = { background: 'rgba(255,255,255,.12)', color: '#fff' };
    return place(
      <div {...rootProps} className="fixed inset-0 z-[400] grid outline-none" style={{ gridTemplateColumns: 'clamp(180px,17vw,220px) minmax(0,1fr) clamp(280px,26vw,340px)', gridTemplateRows: 'auto minmax(0,1fr)', background: '#fff', color: INK }}>
        <header className="col-span-3 flex min-h-[64px] items-center gap-3 px-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          <button type="button" onClick={askLeave} disabled={!!saving} className="inline-flex min-h-11 items-center px-2 text-[15px] disabled:opacity-40" style={{ color: MUTED }}>{backLabel ? `‹ ${backLabel}` : 'Cancel'}</button>
          <p className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold" aria-live="polite">{title || heading}</p>
          {headerExtra}
          {alt && <button type="button" onClick={() => void done('alt')} disabled={!doc || !!saving || locked} className="inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold disabled:opacity-40" style={{ background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{saving === 'alt' ? 'Saving…' : alt.label}</button>}
          <button type="button" onClick={() => void done()} disabled={!doc || !!saving || locked} className="inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-semibold disabled:opacity-40" style={{ background: INK, color: '#fff' }}>{saving === 'main' ? 'Saving…' : doneLabel}</button>
        </header>
        <nav role="toolbar" aria-label="Tools" aria-orientation="vertical" className="min-h-0 space-y-0.5 overflow-y-auto p-2" style={{ borderRight: `1px solid ${LINE}` }}>
          {tools.map(({ k, label: l, Icon }) => { const on = tool === k; return (
            <button key={k} type="button" onClick={() => pickTool(k)} aria-pressed={on} disabled={locked} aria-keyshortcuts={KEY_OF[k]} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14.5px] disabled:opacity-40" style={on ? { background: INK, color: '#fff', fontWeight: 600 } : { color: INK }}>
              <Icon size={17} aria-hidden /><span className="flex-1">{l}</span>{KEY_OF[k] && <span className="text-[12px] tabular-nums" style={{ color: on ? 'rgba(255,255,255,.7)' : MUTED }} aria-hidden>{KEY_OF[k]}</span>}</button>); })}
          <p className="px-3 pt-2 text-[12px]" style={{ color: MUTED }}>L draws a straight line.</p>
        </nav>
        <div className="relative flex min-h-0 flex-col" style={{ background: INK }}>
          {leaving && <div className="bg-white pt-2">{leaveBar}</div>}
          <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">{canvasEl}</div>
          <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4">
            <button type="button" onClick={undo} disabled={!past.length || cropping} className={darkChip} style={darkStyle}>Undo <span aria-hidden className="opacity-70">{mac ? '⌘Z' : 'Ctrl+Z'}</span></button>
            <button type="button" onClick={redo} disabled={!future.length || cropping} className={darkChip} style={darkStyle}>Redo <span aria-hidden className="opacity-70">{mac ? '⇧⌘Z' : 'Ctrl+Y'}</span></button>
            <button type="button" {...holdProps} className={`${darkChip} touch-none select-none`} style={peek ? { background: '#fff', color: INK } : darkStyle}>Hold \ to see original</button>
            <span className="inline-flex items-center rounded-full" style={darkStyle}>
              <button type="button" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out" className="grid h-11 w-11 place-items-center"><Minus size={15} /></button>
              <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Reset view" className="h-11 min-w-11 text-[13px] tabular-nums">{Math.round(view.k * 100)}%</button>
              <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" className="grid h-11 w-11 place-items-center"><Plus size={15} /></button></span>
            <span className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[13.5px]" style={{ color: 'rgba(255,255,255,.7)' }}>Space to look around</span>
          </div>
        </div>
        <aside className="min-h-0 space-y-4 overflow-y-auto p-4" style={{ borderLeft: `1px solid ${LINE}`, background: '#fff' }} aria-label="Settings">
          {notice}
          {aside}
          {selMark && <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Selected: {(NAMES[selMark.kind] || 'mark').toLowerCase()}{selMark.pin ? ` ${selMark.pin.n}` : ''}</p>}
          {!locked && panel()}
          {Layers()}
          {pins.length > 0 && tool !== 'pin' && <section aria-label="Pins and notes" className="space-y-1.5"><p className="text-[13px] font-semibold" style={{ color: MUTED }}>Pins and notes</p>
            <div className="overflow-hidden rounded-2xl" style={{ boxShadow: `inset 0 0 0 1px ${LINE}` }}>{pins.map((m, i) => (
              React.createElement(mine.includes(m.layer) && shown.includes(m.layer) ? 'button' : 'div', { key: m.id, ...(mine.includes(m.layer) && shown.includes(m.layer) ? { type: 'button', onClick: () => { pickTool('move'); setSel(m.id); } } : {}), className: 'flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left', style: i ? { borderTop: `1px solid ${LINE}` } : undefined },
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: m.color, color: contrast(m.color), boxShadow: `inset 0 0 0 1px ${LINE}` }}>{m.pin!.n}</span>,
                <span className="text-[14px]" style={{ color: m.pin!.note ? INK : MUTED }}>{m.pin!.note || 'No note'}</span>)))}</div></section>}
          {noteBox}
          {doc && <p className="sr-only">{pinLines(doc, shown).join('. ')}</p>}
        </aside>
      </div>);
  }
  return place(
    <div {...rootProps} className="fixed inset-0 z-[400] flex flex-col outline-none"
      style={{ background: '#ffffff', color: INK, paddingTop: 'env(safe-area-inset-top,0px)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
      <div className="flex items-center justify-between gap-2 px-3" style={{ minHeight: 52 }}>
        <button type="button" onClick={askLeave} disabled={!!saving} className="inline-flex min-h-11 items-center px-2 text-[16px] disabled:opacity-40" style={{ color: MUTED }}>Cancel</button>
        <p className="truncate text-[16px] font-semibold" aria-live="polite">{heading}</p>
        <button type="button" onClick={() => void done()} disabled={!doc || !!saving || locked} className="inline-flex min-h-11 items-center px-2 text-[16px] font-semibold disabled:opacity-40" style={{ color: accent }}>{saving === 'main' ? 'Saving…' : doneLabel}</button>
      </div>
      {headerExtra && <div className="-mt-1 flex items-center justify-center gap-2 overflow-x-auto px-3 pb-2">{headerExtra}</div>}
      {leaveBar}
      <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" style={{ background: LINE }}>
        {canvasEl}
        {!failed && <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-full p-0.5" style={{ background: 'rgba(255,255,255,.94)', boxShadow: '0 4px 14px -6px rgba(22,23,26,.35)' }}>
          <button type="button" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out" className="grid h-11 w-11 place-items-center rounded-full" style={{ color: INK }}><Minus size={16} /></button>
          <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Reset view" className="h-11 min-w-11 px-1 text-center text-[13px] tabular-nums" style={{ color: MUTED }}>{Math.round(view.k * 100)}%</button>
          <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" className="grid h-11 w-11 place-items-center rounded-full" style={{ color: INK }}><Plus size={16} /></button>
        </div>}
      </div>
      <div className="max-h-[52dvh] space-y-2.5 overflow-y-auto px-3 pb-3 pt-2.5" style={{ background: SOFT, borderTop: `1px solid ${LINE}` }}>
        {notice}
        <div role="toolbar" aria-label="Tools" className="-mx-3 grid auto-cols-[56px] grid-flow-col grid-rows-2 gap-y-1 overflow-x-auto px-2">
          {toolGrid.map(({ k, label: l, Icon }) => { const on = tool === k; return (
            <button key={k} type="button" onClick={() => pickTool(k)} aria-pressed={on} disabled={locked} className="flex min-h-[56px] flex-col items-center justify-start gap-1 rounded-xl pt-0.5 text-center text-[12px] leading-[1.1] transition active:scale-95 disabled:opacity-40" style={on ? { color: INK, fontWeight: 600 } : { color: MUTED }}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]" style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}><Icon size={17} aria-hidden /></span><span className="block w-full break-words px-0.5">{l}</span></button>); })}
        </div>
        {!locked && panel()}
        <div className="flex items-center gap-2">
          <button type="button" onClick={undo} disabled={!past.length || cropping} aria-label="Undo" className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-35" style={chipStyle(false)}><Undo2 size={18} /></button>
          <button type="button" onClick={redo} disabled={!future.length || cropping} aria-label="Redo" className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-35" style={chipStyle(false)}><Redo2 size={18} /></button>
          <button type="button" {...holdProps} className={`${chip} touch-none select-none`} style={chipStyle(peek)}>Hold to see original</button>
        </div>
        {aside}
        {Layers()}
        {noteBox}
        {alt && <button type="button" onClick={() => void done('alt')} disabled={!doc || !!saving || locked} className={`${chip} w-full`} style={chipStyle(false)}>{saving === 'alt' ? 'Saving…' : alt.label}</button>}
        {doc && pinLines(doc, shown).length > 0 && tool !== 'pin' && <p className="sr-only">{pinLines(doc, shown).join('. ')}</p>}
      </div>
    </div>);
}

const Hint = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] leading-snug" style={{ color: MUTED }}>{children}</p>;

/** Nail guides: the shape and the length. */
function NailChoices({ value, onChange }: { value: { shape: NailShape; length: NailLength }; onChange: (v: { shape: NailShape; length: NailLength }) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">{NAIL_SHAPES.map((s) => { const on = value.shape === s.key; return (
        <button key={s.key} type="button" aria-pressed={on} onClick={() => onChange({ ...value, shape: s.key })} className="flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-2xl text-[12px] font-medium" style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>
          <NailGlyph shape={s.key} />{s.label}</button>); })}</div>
      <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold">Length</span>
        {NAIL_LENGTHS.map((l) => { const on = value.length === l.key; return <button key={l.key} type="button" aria-pressed={on} onClick={() => onChange({ ...value, length: l.key })} className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[14px] font-semibold" style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{l.label}</button>; })}</div>
    </div>);
}
function NailGlyph({ shape }: { shape: NailShape }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => { const c = ref.current; if (!c) return; const x = c.getContext('2d'); if (!x) return; x.clearRect(0, 0, 44, 44); x.save(); x.translate(22, 23); x.strokeStyle = getComputedStyle(c).color; x.lineWidth = 1.6; x.setLineDash([2.5, 2]); nailPath(x, shape, 13, 26); x.stroke(); x.restore(); });
  return <canvas ref={ref} width={44} height={44} className="h-6 w-6" aria-hidden />;
}
