// src/lib/markup/model.ts — ONE MARKUP TOOL FOR CLIENTS AND THE TEAM (boards 17A–17D): what a marked-up photo is.
// Every mark is kept as a shape, never burned in, so it can be moved, changed, undone, read out in plain words and
// shown on its own layer (the client's marks, the team's, and private team notes). Marks are kept in the original
// photo's own pixels, so cropping, turning, flipping or straightening the photo never moves or loses them: the view
// (crop, turn, flip, straighten) is applied when the photo is shown. Pure: no browser, no database.

export type Pt = { x: number; y: number };
export type Layer = 'client' | 'team' | 'private';
export type MarkKind = 'pen' | 'highlight' | 'line' | 'arrow' | 'circle' | 'rect' | 'text' | 'stamp' | 'nail' | 'pin' | 'lens' | 'blur';
export type StampKind = 'heart' | 'star' | 'sparkle' | 'tick' | 'cross' | 'warning' | 'target' | 'arrow';
export type NailShape = 'square' | 'round' | 'almond' | 'coffin' | 'stiletto';
export type NailLength = 'short' | 'medium' | 'long' | 'xl';
export type Turn = 0 | 90 | 180 | 270;

export interface Mark {
  id: string;
  kind: MarkKind;
  layer: Layer;
  color: string;
  /** Line weight (and the size of stamps, text and guides), as a share of the photo's width. */
  size: number;
  /** 0.1 to 1. */
  opacity: number;
  /** Radians, about the mark's center. */
  rotation: number;
  dash?: boolean;
  /** Pen and highlight: drawn as is when false (smoothing off). */
  smooth?: boolean;
  /** pen/highlight: the stroke; line/arrow: from, to; circle/rect/blur: two corners; lens: the spot, then where the
   *  close-up sits; text/stamp/nail/pin: the one point it sits at. */
  pts: Pt[];
  text?: string;
  stamp?: StampKind;
  nail?: { shape: NailShape; length: NailLength };
  /** A numbered pin: its number never changes, whatever else is removed, and it has its own note. */
  pin?: { n: number; note: string };
  /** The close-up's zoom. */
  zoom?: 2 | 3 | 4;
  /** Who made it (first name), for the layers list. */
  by?: string;
}

export interface MarkupView {
  /** The crop, in the turned and straightened photo's pixels; none is the whole photo. */
  crop: { x: number; y: number; w: number; h: number } | null;
  turn: Turn;
  flip: boolean;
  /** Degrees, -15 to 15: the photo is zoomed just enough that no empty corners show. */
  straighten: number;
}

export interface MarkupDoc {
  v: 1;
  /** The original photo's size in pixels. */
  w: number; h: number;
  marks: Mark[];
  /** The next pin's number (numbers are never reused, so notes never get mixed up). */
  nextPin: number;
  view: MarkupView;
  /** Shades picked from the photo (Colors I love), as #rrggbb. */
  colors: string[];
  note: string;
}

export const SIZES: { key: 'S' | 'M' | 'L'; v: number }[] = [{ key: 'S', v: 0.006 }, { key: 'M', v: 0.012 }, { key: 'L', v: 0.022 }];
/** Eight colors plus a custom one (the booking tool had eight, the team's six: every one of the team's is here or a
 *  close match, and the custom color covers the rest). */
export const PALETTE = ['#e11d48', '#f472b6', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#ffffff', '#111827'];
export const STAMPS: { key: StampKind; label: string }[] = [
  { key: 'heart', label: 'Heart' }, { key: 'star', label: 'Star' }, { key: 'sparkle', label: 'Sparkle' }, { key: 'tick', label: 'Check' },
  { key: 'cross', label: 'Cross' }, { key: 'warning', label: 'Warning' }, { key: 'target', label: 'Target' }, { key: 'arrow', label: 'Arrow' }];
export const NAIL_SHAPES: { key: NailShape; label: string }[] = [
  { key: 'square', label: 'Square' }, { key: 'round', label: 'Round' }, { key: 'almond', label: 'Almond' }, { key: 'coffin', label: 'Coffin' }, { key: 'stiletto', label: 'Stiletto' }];
export const NAIL_LENGTHS: { key: NailLength; label: string; k: number }[] = [
  { key: 'short', label: 'Short', k: 0.75 }, { key: 'medium', label: 'Medium', k: 1 }, { key: 'long', label: 'Long', k: 1.3 }, { key: 'xl', label: 'Extra long', k: 1.65 }];
export const LIMITS = { marks: 300, points: 600, text: 60, note: 300, pinNote: 200, colors: 6 };

export const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const isHex = (v: any) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function emptyDoc(w: number, h: number): MarkupDoc {
  return { v: 1, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), marks: [], nextPin: 1, view: { crop: null, turn: 0, flip: false, straighten: 0 }, colors: [], note: '' };
}

// ── The view: original photo → what's shown ─────────────────────────────────────────────────────────────────────
/** An affine map [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f (the canvas's own order). */
export type M = [number, number, number, number, number, number];
export const I: M = [1, 0, 0, 1, 0, 0];
export const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
export const ap = (m: M, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export function inv(m: M): M {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
/** How much the map scales lengths. */
export const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
/** The map's own turn, in radians (so a stamp can stay upright on a turned photo). */
export const angleOf = (m: M) => Math.atan2(m[1], m[0]);

/** The turned photo's size. */
export const turnedSize = (doc: Pick<MarkupDoc, 'w' | 'h' | 'view'>) => (doc.view.turn % 180 === 0 ? { w: doc.w, h: doc.h } : { w: doc.h, h: doc.w });
/** How far a straightened photo is zoomed so no empty corners show. */
export function straightenZoom(w: number, h: number, deg: number) {
  const a = Math.abs((deg * Math.PI) / 180); if (!a) return 1;
  return Math.max((w * Math.cos(a) + h * Math.sin(a)) / w, (w * Math.sin(a) + h * Math.cos(a)) / h);
}
/** Original photo → the turned, flipped and straightened photo (before the crop). */
export function orientMatrix(doc: Pick<MarkupDoc, 'w' | 'h' | 'view'>): M {
  const { w, h } = doc; const t = doc.view.turn; const ts = turnedSize(doc);
  let m: M = t === 90 ? [0, 1, -1, 0, h, 0] : t === 180 ? [-1, 0, 0, -1, w, h] : t === 270 ? [0, -1, 1, 0, 0, w] : I;
  if (doc.view.flip) m = mul([-1, 0, 0, 1, ts.w, 0], m);
  const deg = clamp(Number(doc.view.straighten) || 0, -15, 15);
  if (deg) {
    const a = (deg * Math.PI) / 180, k = straightenZoom(ts.w, ts.h, deg), cx = ts.w / 2, cy = ts.h / 2;
    const r: M = [k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), 0, 0];
    m = mul(mul([1, 0, 0, 1, cx, cy], mul(r, [1, 0, 0, 1, -cx, -cy])), m);
  }
  return m;
}
/** The crop actually used (kept inside the photo, never smaller than 16 pixels). */
export function cropOf(doc: Pick<MarkupDoc, 'w' | 'h' | 'view'>) {
  const ts = turnedSize(doc); const c = doc.view.crop;
  if (!c) return { x: 0, y: 0, w: ts.w, h: ts.h };
  const x = clamp(c.x, 0, ts.w - 16), y = clamp(c.y, 0, ts.h - 16);
  return { x, y, w: clamp(c.w, 16, ts.w - x), h: clamp(c.h, 16, ts.h - y) };
}
/** Original photo → what's shown, and the size of what's shown (in the original's pixels). */
export function viewOf(doc: Pick<MarkupDoc, 'w' | 'h' | 'view'>): { m: M; w: number; h: number } {
  const c = cropOf(doc);
  return { m: mul([1, 0, 0, 1, -c.x, -c.y], orientMatrix(doc)), w: c.w, h: c.h };
}
/** Fixed crop shapes (width : height), in the turned photo, centered and as large as fits. */
export function cropTo(doc: MarkupDoc, ratio: 'free' | 'square' | '4:5' | '3:4'): MarkupView['crop'] {
  if (ratio === 'free') return null;
  const ts = turnedSize(doc); const r = ratio === 'square' ? 1 : ratio === '4:5' ? 4 / 5 : 3 / 4;
  let w = ts.w, h = w / r; if (h > ts.h) { h = ts.h; w = h * r; }
  return { x: Math.round((ts.w - w) / 2), y: Math.round((ts.h - h) / 2), w: Math.round(w), h: Math.round(h) };
}
/** Turn what's shown a quarter clockwise (the crop turns with the photo). A flipped photo turns the other way
 *  underneath, so it still looks clockwise. */
export function turnQuarter(doc: MarkupDoc): MarkupView {
  const ts = turnedSize(doc); const c = doc.view.crop;
  const turn = (((doc.view.turn + (doc.view.flip ? 270 : 90)) % 360) as Turn);
  // A crop (x, y, w, h) in the old turned photo becomes (H - y - h, x, h, w) in the new one, where H is the old height.
  return { ...doc.view, turn, crop: c ? { x: ts.h - c.y - c.h, y: c.x, w: c.h, h: c.w } : null };
}

// ── Marks ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The mark's center (what rotation turns about, and where a moved mark is held). */
export function centerOf(mk: Mark): Pt {
  if (mk.kind === 'lens') return mk.pts[1] || mk.pts[0];
  if (mk.pts.length === 1) return mk.pts[0];
  const xs = mk.pts.map((p) => p.x), ys = mk.pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
/** Point marks: their size in the original's pixels (stamps, pins, text height, nail guides). */
export const unitOf = (mk: Pick<Mark, 'size'>, w: number) => Math.max(18, mk.size * w * 7);
export const nailHeight = (mk: Mark, w: number) => unitOf(mk, w) * 2 * 1.6 * (NAIL_LENGTHS.find((l) => l.key === mk.nail?.length)?.k || 1);
export const lensRadius = (mk: Mark, w: number) => Math.max(24, mk.size * w * 9);

/** Moved by (dx, dy). The close-up moves with its spot. */
export const moved = (mk: Mark, dx: number, dy: number): Mark => ({ ...mk, pts: mk.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
/** Scaled about its center: shapes by their points, point marks by their size. */
export function scaled(mk: Mark, k: number): Mark {
  if (['text', 'stamp', 'nail', 'pin', 'lens'].includes(mk.kind)) return { ...mk, size: clamp(mk.size * k, 0.002, 0.08) };
  const c = centerOf(mk);
  return { ...mk, pts: mk.pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k })) };
}
/** A copy, a little down and to the right (a pin copy gets the next number). */
export function duplicated(doc: MarkupDoc, mk: Mark): { mark: Mark; nextPin: number } {
  const d = doc.w * 0.04; const mark = { ...moved(mk, d, d), id: uid() };
  if (mk.kind === 'pin') return { mark: { ...mark, pin: { n: doc.nextPin, note: mk.pin?.note || '' } }, nextPin: doc.nextPin + 1 };
  return { mark, nextPin: doc.nextPin };
}
/** To the front or the back of its own layer's marks. */
export function restacked(marks: Mark[], id: string, to: 'front' | 'back'): Mark[] {
  const mk = marks.find((x) => x.id === id); if (!mk) return marks;
  const rest = marks.filter((x) => x.id !== id);
  return to === 'front' ? [...rest, mk] : [mk, ...rest];
}
/** One nail guide's shape and length on every nail guide. */
export const toEveryNail = (marks: Mark[], from: Mark): Mark[] => marks.map((x) => (x.kind === 'nail' && x.id !== from.id && x.layer === from.layer ? { ...x, nail: { ...from.nail! } } : x));
/** A pin's note. */
export const withPinNote = (marks: Mark[], id: string, note: string): Mark[] => marks.map((x) => (x.id === id && x.kind === 'pin' ? { ...x, pin: { n: x.pin!.n, note: note.slice(0, LIMITS.pinNote) } } : x));

/** A stroke's points as drawn (its turn worked into them), so the eraser meets what's on the screen. */
export function unturned(mk: Mark): Mark {
  if (!mk.rotation) return mk;
  const c = centerOf(mk); const cs = Math.cos(mk.rotation), sn = Math.sin(mk.rotation);
  return { ...mk, rotation: 0, pts: mk.pts.map((p) => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs })) };
}
/** Points no further apart than `gap` (so a long straight piece can be rubbed out in the middle). */
function filled(pts: Pt[], gap: number): Pt[] {
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const a = pts[i - 1];
    if (a) { const d = Math.hypot(p.x - a.x, p.y - a.y); const n = Math.floor(d / gap); for (let j = 1; j <= n; j++) { const t = j / (n + 1); out.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t }); } }
    out.push(p);
  });
  return out;
}
/** The eraser, for drawn lines: whatever of a pen or highlight stroke lies within r of the eraser's path is rubbed out
 *  (a stroke split in two becomes two). Nothing else is touched (other marks are deleted on their own). */
export function erased(marks: Mark[], path: Pt[], r: number, layer: Layer | Layer[]): Mark[] {
  const on = Array.isArray(layer) ? layer : [layer];
  const near = (p: Pt) => path.some((q, i) => {
    const a = path[i - 1] || q; const dx = q.x - a.x, dy = q.y - a.y; const L = dx * dx + dy * dy;
    const t = L ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= r;
  });
  const out: Mark[] = [];
  // The eraser's own reach, so strokes nowhere near it are passed over at once.
  const ex0 = Math.min(...path.map((p) => p.x)) - r, ex1 = Math.max(...path.map((p) => p.x)) + r, ey0 = Math.min(...path.map((p) => p.y)) - r, ey1 = Math.max(...path.map((p) => p.y)) + r;
  let room = LIMITS.marks - marks.length;   // a split never takes the photo past its limit (the stroke is left whole)
  for (const mk0 of marks) {
    if ((mk0.kind !== 'pen' && mk0.kind !== 'highlight') || !on.includes(mk0.layer)) { out.push(mk0); continue; }
    const mk = unturned(mk0);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of mk.pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (x1 < ex0 || x0 > ex1 || y1 < ey0 || y0 > ey1) { out.push(mk0); continue; }
    const pts = filled(mk.pts, Math.max(1, r / 2));
    if (!pts.some(near)) { out.push(mk0); continue; }
    let run: Pt[] = []; const runs: Pt[][] = [];
    for (const p of pts) { if (near(p)) { if (run.length) runs.push(run); run = []; } else run.push(p); }
    if (run.length) runs.push(run);
    const pieces = runs.filter((r2) => r2.length > 1);
    if (pieces.length - 1 > room) { out.push(mk0); continue; }
    room -= Math.max(0, pieces.length - 1);
    pieces.forEach((r2, i) => out.push({ ...mk, id: i ? uid() : mk.id, pts: r2.length > LIMITS.points ? simplified(r2, 0.5) : r2 }));
  }
  return out;
}

/** Fewer points on a long stroke (keeps its shape: drops points closer than `tol` to the line through their
 *  neighbors). */
export function simplified(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!; let best = -1, at = -1;
    const a = pts[s], b = pts[e]; const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    // Distance to the segment (a closed loop, whose ends meet, measures from that one point).
    for (let i = s + 1; i < e; i++) {
      const t = L2 ? Math.min(1, Math.max(0, ((pts[i].x - a.x) * dx + (pts[i].y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(pts[i].x - (a.x + t * dx), pts[i].y - (a.y + t * dy)); if (d > best) { best = d; at = i; }
    }
    if (best > tol && at > 0) { keep[at] = true; stack.push([s, at], [at, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── Kept as JSON ───────────────────────────────────────────────────────────────────────────────────────────────
const KINDS: MarkKind[] = ['pen', 'highlight', 'line', 'arrow', 'circle', 'rect', 'text', 'stamp', 'nail', 'pin', 'lens', 'blur'];
const r1 = (v: number) => Math.round(v * 10) / 10;
/** A doc from anywhere (a saved copy, a request): anything that isn't a real mark is dropped, numbers are kept in
 *  range, and text is cut to length. Pins keep their numbers. Never throws. */
export function cleanDoc(raw: any): MarkupDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = typeof raw.w === 'number' ? Math.round(raw.w) : NaN, h = typeof raw.h === 'number' ? Math.round(raw.h) : NaN;
  if (!(w > 0 && w <= 20000 && h > 0 && h <= 20000)) return null;
  const pt = (p: any): Pt | null => (typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: r1(clamp(p.x, -w, 2 * w)), y: r1(clamp(p.y, -h, 2 * h)) } : null);
  const num = (v: any, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const marks: Mark[] = [];
  let top = 0;
  for (const m of (Array.isArray(raw.marks) ? raw.marks : []).slice(0, LIMITS.marks)) {
    if (!m || !KINDS.includes(m.kind)) continue;
    const pts = (Array.isArray(m.pts) ? m.pts : []).slice(0, LIMITS.points).map(pt).filter(Boolean) as Pt[];
    const one = ['text', 'stamp', 'nail', 'pin'].includes(m.kind);
    if (!pts.length || (!one && m.kind !== 'pen' && m.kind !== 'highlight' && pts.length < 2)) continue;
    const mk: Mark = { id: String(m.id || uid()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || uid(), kind: m.kind, layer: m.layer === 'team' || m.layer === 'private' ? m.layer : 'client',
      color: isHex(m.color) ? m.color.toLowerCase() : PALETTE[0], size: clamp(num(m.size, SIZES[1].v) || SIZES[1].v, 0.002, 0.08), opacity: clamp(num(m.opacity, 1), 0.1, 1),
      rotation: num(m.rotation, 0) % (2 * Math.PI), pts: one ? pts.slice(0, 1) : m.kind === 'pen' || m.kind === 'highlight' ? pts : pts.slice(0, 2) };
    if (m.dash) mk.dash = true;
    if (m.smooth === false) mk.smooth = false;
    if (m.by) mk.by = String(m.by).slice(0, 40);
    if (m.kind === 'text') { const t = String(m.text || '').trim().slice(0, LIMITS.text); if (!t) continue; mk.text = t; }
    if (m.kind === 'stamp') { if (!STAMPS.some((s) => s.key === m.stamp)) continue; mk.stamp = m.stamp; }
    if (m.kind === 'nail') mk.nail = { shape: NAIL_SHAPES.some((s) => s.key === m.nail?.shape) ? m.nail.shape : 'almond', length: NAIL_LENGTHS.some((l) => l.key === m.nail?.length) ? m.nail.length : 'medium' };
    if (m.kind === 'pin') { const n = clamp(Math.round(num(m.pin?.n, 1)), 1, 999); top = Math.max(top, n); mk.pin = { n, note: String(m.pin?.note || '').slice(0, LIMITS.pinNote) }; }
    if (m.kind === 'lens') mk.zoom = m.zoom === 2 || m.zoom === 4 ? m.zoom : 3;
    marks.push(mk);
  }
  const v = raw.view || {};
  const turn = ([0, 90, 180, 270].includes(Number(v.turn)) ? Number(v.turn) : 0) as Turn;
  const c = v.crop && [v.crop.x, v.crop.y, v.crop.w, v.crop.h].every((n: any) => typeof n === 'number' && Number.isFinite(n)) ? { x: Math.round(v.crop.x), y: Math.round(v.crop.y), w: Math.round(v.crop.w), h: Math.round(v.crop.h) } : null;
  return { v: 1, w, h, marks, nextPin: clamp(Math.max(top + 1, Math.round(num(raw.nextPin, 1))), 1, 1000), view: { crop: c, turn, flip: v.flip === true, straighten: clamp(num(v.straighten, 0), -15, 15) },
    colors: (Array.isArray(raw.colors) ? raw.colors : Array.isArray(raw.colours) ? raw.colours : []).filter(isHex).map((x: string) => x.toLowerCase()).slice(0, LIMITS.colors), note: String(raw.note || '').slice(0, LIMITS.note) };
}
/** The doc as kept: points rounded, long strokes thinned (more each try) and anything at its usual value left out, so a
 *  photo's marks stay small. Null when it still won't fit (the flattened photo is always kept, so nothing is lost but
 *  the chance to change the marks later). */
export function packDoc(doc: MarkupDoc, maxChars = 15000): string | null {
  for (const f of [1, 3, 8]) {
    const tol = Math.max(0.6, doc.w / 1500) * f;
    const marks = doc.marks.map((m) => {
      const o: any = { ...m, pts: (m.kind === 'pen' || m.kind === 'highlight' ? simplified(m.pts, tol) : m.pts).map((p) => ({ x: r1(p.x), y: r1(p.y) })) };
      if (o.layer === 'client') delete o.layer; if (o.opacity === 1) delete o.opacity; if (!o.rotation) delete o.rotation; if (o.size === SIZES[1].v) delete o.size; if (o.color === PALETTE[0]) delete o.color;
      return o;
    });
    const s = JSON.stringify({ ...doc, marks });
    if (s.length <= maxChars) return s;
  }
  return null;
}

/** Marks sent with a photo (a booking, the visit link), as they're kept: checked and packed again, or null. From a
 *  client (as: 'client') every mark is theirs: nothing can be put on the team's layers, and no name is kept with it. */
export function keepMarkup(raw: any, o: { as?: Layer } = {}): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 16000) return null;
  try {
    const d = cleanDoc(JSON.parse(raw)); if (!d) return null;
    if (o.as) d.marks = d.marks.filter((m) => m.layer !== 'private').map((m) => { const { by: _by, ...rest } = m; return { ...rest, layer: o.as! }; });
    return packDoc(d);
  } catch { return null; }
}
