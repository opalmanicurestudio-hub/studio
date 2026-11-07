// src/lib/markup/draw.ts — DRAWING A MARKED-UP PHOTO (boards 17A–17D). The photo is drawn through its view (crop,
// turn, flip, straighten) and every mark on the layers shown is drawn over it, the same way in the editor, in the
// flattened copy that's sent, and in the team's view. Blurred areas are drawn first, as coarse blocks, so nothing
// personal shows through (and it works in every browser). Text, stamps and pins stay upright on a turned photo;
// lines, shapes and nail guides turn with it. Browser only (a canvas), but no React.
import { type Mark, type MarkupDoc, type Layer, type Pt, type M, viewOf, mul, ap, inv, scaleOf, angleOf, unitOf, nailHeight, lensRadius, centerOf, NAIL_LENGTHS } from './model';

export type DrawOpts = {
  /** Canvas pixels per original-photo pixel of what's shown. */
  k: number;
  /** The layers drawn (all by default). */
  layers?: Layer[];
  /** Just the photo (hold to see the original). */
  original?: boolean;
  /** A mark being drawn right now. */
  live?: Mark | null;
  /** The editor's own aids: blurred areas outlined. Never in a copy that's sent. */
  chrome?: boolean;
  /** Stamps and labels that just landed grow in (0..1). */
  pop?: { id: string; k: number } | null;
  /** Makes a scratch canvas (for blurring). */
  scratch?: (w: number, h: number) => any;
};

/** Each photo's copy with its blurs on (for close-ups), kept while the blurs stay the same. */
const blurred = new WeakMap<object, { key: string; canvas: any }>();
/** Original photo → canvas pixels. */
export const canvasMatrix = (doc: MarkupDoc, k: number): M => mul([k, 0, 0, k, 0, 0], viewOf(doc).m);
const setM = (ctx: CanvasRenderingContext2D, m: M) => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
const lineW = (mk: Mark, doc: MarkupDoc) => Math.max(2, mk.size * doc.w);
const FONT = `'Plus Jakarta Sans', system-ui, sans-serif`;
const contrast = (hex: string) => { const n = parseInt(hex.slice(1), 16); const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? '#16171a' : '#ffffff'; };

export function drawDoc(ctx: CanvasRenderingContext2D, doc: MarkupDoc, img: CanvasImageSource, o: DrawOpts) {
  const M = canvasMatrix(doc, o.k);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
  ctx.save(); setM(ctx, M); ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, doc.w, doc.h); ctx.restore();
  if (o.original) return;
  const on = (mk: Mark) => !o.layers || o.layers.includes(mk.layer);
  const marks = [...doc.marks.filter(on), ...(o.live ? [o.live] : [])];
  // Blurred areas first, so they hide the photo under every other mark; a close-up shows the photo as blurred too, so
  // it can never show what a blur hides.
  const blurs = marks.filter((m) => m.kind === 'blur');
  blurs.forEach((m) => drawBlur(ctx, m, doc, img, M, o));
  let src: CanvasImageSource = img;
  if (blurs.length && marks.some((m) => m.kind === 'lens')) {
    // Made again only when the blurs change (it's the size of the whole photo).
    const key = JSON.stringify(blurs.map((m) => [m.pts, m.rotation]));
    const kept = blurred.get(img as object);
    if (kept && kept.key === key) src = kept.canvas;
    else {
      const c = o.scratch ? o.scratch(doc.w, doc.h) : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: doc.w, height: doc.h }) : null);
      if (c) { const x = c.getContext('2d'); x.drawImage(img, 0, 0, doc.w, doc.h); blurs.forEach((m) => drawBlur(x, m, doc, img, [1, 0, 0, 1, 0, 0] as M, { ...o, chrome: false })); src = c; blurred.set(img as object, { key, canvas: c }); }
    }
  }
  marks.filter((m) => m.kind !== 'blur').forEach((m) => drawMark(ctx, m, doc, src, M, o.pop && o.pop.id === m.id ? o.pop.k : 1));
}

function rectOf(a: Pt, b: Pt) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }; }
/** Turned about the mark's own center (in the original's pixels). */
function withTurn(ctx: CanvasRenderingContext2D, M: M, mk: Mark) {
  setM(ctx, M);
  if (mk.rotation) { const c = centerOf(mk); ctx.translate(c.x, c.y); ctx.rotate(mk.rotation); ctx.translate(-c.x, -c.y); }
}

function drawBlur(ctx: CanvasRenderingContext2D, mk: Mark, doc: MarkupDoc, img: CanvasImageSource, M: M, o: DrawOpts) {
  if (mk.pts.length < 2) return;
  const r = rectOf(mk.pts[0], mk.pts[1]); if (r.w < 2 || r.h < 2) return;
  const block = Math.max(6, doc.w / 60); const tw = Math.max(1, Math.ceil(r.w / block)), th = Math.max(1, Math.ceil(r.h / block));
  const tiny = o.scratch ? o.scratch(tw, th) : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: tw, height: th }) : null);
  ctx.save(); withTurn(ctx, M, mk);
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  if (tiny) {
    const t = tiny.getContext('2d'); t.imageSmoothingEnabled = true; t.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tiny, 0, 0, tw, th, r.x, r.y, r.w, r.h);
  } else { ctx.fillStyle = '#d6d3d1'; ctx.fillRect(r.x, r.y, r.w, r.h); }
  ctx.restore();
  if (o.chrome) { ctx.save(); withTurn(ctx, M, mk); ctx.lineWidth = 2 / scaleOf(M); ctx.setLineDash([8 / scaleOf(M), 6 / scaleOf(M)]); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore(); }
}

export function drawMark(ctx: CanvasRenderingContext2D, mk: Mark, doc: MarkupDoc, img: CanvasImageSource, M: M, pop = 1) {
  const lw = lineW(mk, doc); const s = scaleOf(M);
  ctx.save(); ctx.globalAlpha = mk.opacity ?? 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = mk.color; ctx.fillStyle = mk.color;
  const dash = () => ctx.setLineDash(mk.dash ? [lw * 2.2, lw * 1.8] : []);
  const k = mk.kind;
  if (k === 'pen' || k === 'highlight') {
    withTurn(ctx, M, mk); dash();
    if (k === 'highlight') { ctx.globalAlpha = 0.35 * (mk.opacity ?? 1); ctx.lineWidth = lw * 3.2; } else ctx.lineWidth = lw;
    const p = mk.pts; ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
    if (mk.smooth === false) for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    else { for (let i = 1; i < p.length - 1; i++) { const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2; ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my); } if (p.length > 1) ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y); }
    if (p.length === 1) ctx.lineTo(p[0].x + 0.1, p[0].y);
    ctx.stroke();
  } else if ((k === 'line' || k === 'arrow') && mk.pts.length > 1) {
    withTurn(ctx, M, mk); dash(); ctx.lineWidth = lw;
    const [a, b] = [mk.pts[0], mk.pts[1]]; const ang = Math.atan2(b.y - a.y, b.x - a.x); const head = lw * 4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    if (k === 'arrow') ctx.lineTo(b.x - head * 0.6 * Math.cos(ang), b.y - head * 0.6 * Math.sin(ang)); else ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (k === 'arrow') { ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45)); ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill(); }
  } else if ((k === 'circle' || k === 'rect') && mk.pts.length > 1) {
    withTurn(ctx, M, mk); dash(); ctx.lineWidth = lw;
    const r = rectOf(mk.pts[0], mk.pts[1]);
    ctx.beginPath();
    if (k === 'circle') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(1, r.w / 2), Math.max(1, r.h / 2), 0, 0, Math.PI * 2); else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.stroke();
  } else if (k === 'nail' && mk.nail) {
    // A dashed guide on the nail: its shape, and its length from the cuticle (the rounded end) to the free edge.
    setM(ctx, M); const p = mk.pts[0]; ctx.translate(p.x, p.y); ctx.rotate(mk.rotation || 0);
    const u = unitOf(mk, doc.w) * 2 * pop; const h = nailHeight(mk, doc.w) * pop; const w = u * 0.55;
    nailPath(ctx, mk.nail.shape, w, h);
    ctx.lineWidth = Math.max(2, lw * 0.8); ctx.setLineDash([lw * 1.6, lw * 1.2]); ctx.stroke();
  } else if (k === 'lens' && mk.pts.length > 1) {
    // A close-up: a small ring on the spot, a dashed line to a round lens that shows it zoomed in.
    setM(ctx, M); const [spot, at] = mk.pts; const R = lensRadius(mk, doc.w); const z = mk.zoom || 3; const ring = Math.max(2, 3 / s);
    ctx.save(); ctx.beginPath(); ctx.arc(at.x, at.y, R, 0, Math.PI * 2); ctx.clip();
    ctx.translate(at.x, at.y); ctx.scale(z, z); ctx.translate(-spot.x, -spot.y); ctx.drawImage(img, 0, 0, doc.w, doc.h); ctx.restore();
    ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = ring * 1.6;
    ctx.beginPath(); ctx.arc(at.x, at.y, R, 0, Math.PI * 2); ctx.stroke();
    const r0 = R / z; ctx.lineWidth = ring; ctx.beginPath(); ctx.arc(spot.x, spot.y, r0, 0, Math.PI * 2); ctx.stroke();
    const d = Math.hypot(at.x - spot.x, at.y - spot.y);
    if (d > R + r0) { const ux = (at.x - spot.x) / d, uy = (at.y - spot.y) / d; ctx.setLineDash([6 / s, 5 / s]); ctx.beginPath(); ctx.moveTo(spot.x + ux * r0, spot.y + uy * r0); ctx.lineTo(at.x - ux * R, at.y - uy * R); ctx.stroke(); }
  } else if (k === 'text' && mk.text) {
    const q = ap(M, mk.pts[0]); ctx.setTransform(1, 0, 0, 1, q.x, q.y); ctx.rotate(mk.rotation || 0);
    const fs = Math.max(14, mk.size * doc.w * 3.4) * s * pop; ctx.font = `600 ${fs}px ${FONT}`; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(mk.text).width, pad = fs * 0.35;
    const a0 = ctx.globalAlpha; ctx.globalAlpha = 0.88 * a0; ctx.fillStyle = mk.color.toLowerCase() === '#ffffff' ? '#16171a' : '#ffffff';
    roundRect(ctx, -pad, -fs * 0.7, tw + pad * 2, fs * 1.4, fs * 0.5); ctx.fill();
    ctx.globalAlpha = a0; ctx.fillStyle = mk.color; ctx.fillText(mk.text, 0, 0);
  } else if (k === 'pin' && mk.pin) {
    const q = ap(M, mk.pts[0]); ctx.setTransform(1, 0, 0, 1, q.x, q.y);
    const r = unitOf(mk, doc.w) * 0.42 * s * pop;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = Math.max(2, r * 0.18); ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.fillStyle = contrast(mk.color); ctx.font = `700 ${r * 1.05}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(mk.pin.n), 0, r * 0.06);
  } else if (k === 'stamp' && mk.stamp) {
    // An arrow stamp points the same way on the photo when it's turned; the others stay upright.
    const q = ap(M, mk.pts[0]); ctx.setTransform(1, 0, 0, 1, q.x, q.y); ctx.rotate(mk.stamp === 'arrow' ? (M[0] * M[3] - M[1] * M[2] < 0 ? angleOf(M) - (mk.rotation || 0) : angleOf(M) + (mk.rotation || 0)) : (mk.rotation || 0));
    const u = unitOf(mk, doc.w) * s * pop;
    stampPath(ctx, mk.stamp, u);
    if (['tick', 'cross', 'target'].includes(mk.stamp)) { ctx.lineWidth = Math.max(2, lw * s * 1.4); ctx.stroke(); }
    else { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = u * 0.12; ctx.fill(); if (mk.stamp === 'warning') { ctx.shadowBlur = 0; ctx.fillStyle = contrast(mk.color); ctx.font = `800 ${u * 0.7}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, u * 0.12); } }
  }
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/** A nail guide about (0, 0): the free edge up, the cuticle end (rounded) down. */
export function nailPath(ctx: CanvasRenderingContext2D, shape: string, w: number, h: number) {
  const top = -h / 2, bot = h / 2, l = -w / 2, r = w / 2;
  ctx.beginPath(); ctx.moveTo(l, bot);
  if (shape === 'square') { ctx.lineTo(l, top); ctx.lineTo(r, top); }
  else if (shape === 'round') { ctx.lineTo(l, top + w / 2); ctx.arc(0, top + w / 2, w / 2, Math.PI, 0); }
  else if (shape === 'almond') { ctx.lineTo(l, -h * 0.1); ctx.quadraticCurveTo(l, top + h * 0.05, 0, top - h * 0.05); ctx.quadraticCurveTo(r, top + h * 0.05, r, -h * 0.1); }
  else if (shape === 'coffin') { ctx.lineTo(l + w * 0.12, top + h * 0.05); ctx.lineTo(-w * 0.25, top - h * 0.05); ctx.lineTo(w * 0.25, top - h * 0.05); ctx.lineTo(r - w * 0.12, top + h * 0.05); }
  else { ctx.lineTo(l, -h * 0.05); ctx.lineTo(0, top - h * 0.2); ctx.lineTo(r, -h * 0.05); }
  ctx.lineTo(r, bot); ctx.arc(0, bot, w / 2, 0, Math.PI);
}

/** A stamp about (0, 0), s across. */
export function stampPath(ctx: CanvasRenderingContext2D, kind: string, s: number) {
  ctx.beginPath();
  if (kind === 'heart') { ctx.moveTo(0, s * 0.35); ctx.bezierCurveTo(-s * 0.9, -s * 0.25, -s * 0.35, -s * 0.85, 0, -s * 0.35); ctx.bezierCurveTo(s * 0.35, -s * 0.85, s * 0.9, -s * 0.25, 0, s * 0.35); }
  else if (kind === 'star') { for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.4 : s * 0.9, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(r * Math.cos(a), r * Math.sin(a)); } ctx.closePath(); }
  else if (kind === 'sparkle') { for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.18 : s * 0.9, a = -Math.PI / 2 + (i * Math.PI) / 4; ctx.lineTo(r * Math.cos(a), r * Math.sin(a)); } ctx.closePath(); }
  else if (kind === 'tick') { ctx.moveTo(-s * 0.6, 0); ctx.lineTo(-s * 0.15, s * 0.45); ctx.lineTo(s * 0.65, -s * 0.5); }
  else if (kind === 'cross') { ctx.moveTo(-s * 0.5, -s * 0.5); ctx.lineTo(s * 0.5, s * 0.5); ctx.moveTo(s * 0.5, -s * 0.5); ctx.lineTo(-s * 0.5, s * 0.5); }
  else if (kind === 'warning') { ctx.moveTo(0, -s * 0.75); ctx.lineTo(s * 0.8, s * 0.6); ctx.lineTo(-s * 0.8, s * 0.6); ctx.closePath(); }
  else if (kind === 'target') { ctx.arc(0, 0, s * 0.75, 0, Math.PI * 2); ctx.moveTo(s * 0.4, 0); ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2); ctx.moveTo(-s * 0.95, 0); ctx.lineTo(-s * 0.55, 0); ctx.moveTo(s * 0.55, 0); ctx.lineTo(s * 0.95, 0); ctx.moveTo(0, -s * 0.95); ctx.lineTo(0, -s * 0.55); ctx.moveTo(0, s * 0.55); ctx.lineTo(0, s * 0.95); }
  else if (kind === 'arrow') { ctx.moveTo(-s * 0.8, -s * 0.18); ctx.lineTo(s * 0.15, -s * 0.18); ctx.lineTo(s * 0.15, -s * 0.5); ctx.lineTo(s * 0.85, 0); ctx.lineTo(s * 0.15, s * 0.5); ctx.lineTo(s * 0.15, s * 0.18); ctx.lineTo(-s * 0.8, s * 0.18); ctx.closePath(); }
}

// ── Where a mark is on the canvas (for picking it up, and its handles) ─────────────────────────────────────────
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** The mark's box on the canvas (upright, in canvas pixels). */
export function boxOf(mk: Mark, doc: MarkupDoc, M: M, ctx?: CanvasRenderingContext2D | null): Box {
  const s = scaleOf(M); const k = mk.kind;
  if (k === 'text' || k === 'pin' || k === 'stamp') {
    const q = ap(M, mk.pts[0]);
    if (k === 'pin') { const r = unitOf(mk, doc.w) * 0.42 * s; return { x0: q.x - r, y0: q.y - r, x1: q.x + r, y1: q.y + r }; }
    if (k === 'stamp') { const u = unitOf(mk, doc.w) * s; return { x0: q.x - u, y0: q.y - u, x1: q.x + u, y1: q.y + u }; }
    const fs = Math.max(14, mk.size * doc.w * 3.4) * s; let tw = fs * 0.58 * (mk.text || '').length;
    if (ctx) { ctx.save(); ctx.font = `600 ${fs}px ${FONT}`; tw = ctx.measureText(mk.text || '').width; ctx.restore(); }
    const corners = [{ x: -fs * 0.35, y: -fs * 0.7 }, { x: tw + fs * 0.35, y: -fs * 0.7 }, { x: tw + fs * 0.35, y: fs * 0.7 }, { x: -fs * 0.35, y: fs * 0.7 }]
      .map((p) => ({ x: q.x + p.x * Math.cos(mk.rotation) - p.y * Math.sin(mk.rotation), y: q.y + p.x * Math.sin(mk.rotation) + p.y * Math.cos(mk.rotation) }));
    return around(corners);
  }
  let pts: Pt[];
  if (k === 'nail') {
    const w = unitOf(mk, doc.w) * 2 * 0.55 / 2, h = nailHeight(mk, doc.w) * 0.62; const p = mk.pts[0]; const c = Math.cos(mk.rotation), sn = Math.sin(mk.rotation);
    pts = [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }].map((d) => ({ x: p.x + d.x * c - d.y * sn, y: p.y + d.x * sn + d.y * c }));
  } else if (k === 'lens') {
    const R = lensRadius(mk, doc.w); const [a, b] = [mk.pts[0], mk.pts[1] || mk.pts[0]]; const r0 = R / (mk.zoom || 3);
    pts = [{ x: a.x - r0, y: a.y - r0 }, { x: a.x + r0, y: a.y + r0 }, { x: b.x - R, y: b.y - R }, { x: b.x + R, y: b.y + R }];
  } else {
    const pad = k === 'highlight' ? mk.size * doc.w * 1.6 : mk.size * doc.w;
    const xs = mk.pts.map((p) => p.x), ys = mk.pts.map((p) => p.y);
    const c = centerOf(mk); const cs = Math.cos(mk.rotation || 0), sn = Math.sin(mk.rotation || 0);
    pts = [{ x: Math.min(...xs) - pad, y: Math.min(...ys) - pad }, { x: Math.max(...xs) + pad, y: Math.min(...ys) - pad }, { x: Math.max(...xs) + pad, y: Math.max(...ys) + pad }, { x: Math.min(...xs) - pad, y: Math.max(...ys) + pad }]
      .map((p) => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }));
  }
  return around(pts.map((p) => ap(M, p)));
}
const around = (ps: Pt[]): Box => ({ x0: Math.min(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), x1: Math.max(...ps.map((p) => p.x)), y1: Math.max(...ps.map((p) => p.y)) });

/** The topmost mark under a canvas point (on the layers that can be changed), or null. Strokes and lines are picked up
 *  by their line, not their whole box, so a long stroke never hides what's inside it. */
export function hitMark(doc: MarkupDoc, M: M, q: Pt, o: { layers: Layer[]; slop?: number; ctx?: CanvasRenderingContext2D | null }): Mark | null {
  const slop = o.slop ?? 12; const s = scaleOf(M); const base = ap(inv(M), q);
  for (let i = doc.marks.length - 1; i >= 0; i--) {
    const mk = doc.marks[i]; if (!o.layers.includes(mk.layer)) continue;
    if (mk.kind === 'pen' || mk.kind === 'highlight' || mk.kind === 'line' || mk.kind === 'arrow') {
      const c = centerOf(mk); const cs = Math.cos(-(mk.rotation || 0)), sn = Math.sin(-(mk.rotation || 0));
      const p = { x: c.x + (base.x - c.x) * cs - (base.y - c.y) * sn, y: c.y + (base.x - c.x) * sn + (base.y - c.y) * cs };
      const reach = (mk.kind === 'highlight' ? mk.size * doc.w * 1.6 : mk.size * doc.w / 2) + slop / s;
      const pts = mk.kind === 'line' || mk.kind === 'arrow' ? mk.pts.slice(0, 2) : mk.pts;
      for (let j = 0; j < pts.length; j++) { const a = pts[j - 1] || pts[j], b = pts[j]; if (segDist(p, a, b) <= reach) return mk; }
      continue;
    }
    if (mk.kind === 'lens' && mk.pts.length > 1) {
      // The close-up and the spot it shows, never the empty space between them.
      const R = lensRadius(mk, doc.w) * s; const a = ap(M, mk.pts[0]), c = ap(M, mk.pts[1]);
      if (Math.hypot(q.x - c.x, q.y - c.y) <= R + slop || Math.hypot(q.x - a.x, q.y - a.y) <= R / (mk.zoom || 3) + slop) return mk;
      continue;
    }
    const b = boxOf(mk, doc, M, o.ctx);
    if (!(q.x >= b.x0 - slop && q.x <= b.x1 + slop && q.y >= b.y0 - slop && q.y <= b.y1 + slop)) continue;
    if ((mk.kind === 'circle' || mk.kind === 'rect') && mk.pts.length > 1 && b.x1 - b.x0 > 4 * slop && b.y1 - b.y0 > 4 * slop) {
      // A large circle or box is picked up by its outline, so what's inside it can still be picked up.
      const c = centerOf(mk); const cs = Math.cos(-(mk.rotation || 0)), sn = Math.sin(-(mk.rotation || 0));
      const p = { x: c.x + (base.x - c.x) * cs - (base.y - c.y) * sn, y: c.y + (base.x - c.x) * sn + (base.y - c.y) * cs };
      const rx = Math.abs(mk.pts[1].x - mk.pts[0].x) / 2, ry = Math.abs(mk.pts[1].y - mk.pts[0].y) / 2; const reach = mk.size * doc.w / 2 + slop / s;
      const off = mk.kind === 'circle'
        ? Math.abs(Math.hypot((p.x - c.x) / (rx || 1), (p.y - c.y) / (ry || 1)) - 1) * Math.min(rx, ry)
        : Math.min(Math.abs(Math.abs(p.x - c.x) - rx) + Math.max(0, Math.abs(p.y - c.y) - ry), Math.abs(Math.abs(p.y - c.y) - ry) + Math.max(0, Math.abs(p.x - c.x) - rx));
      if (off <= reach) return mk;
      continue;
    }
    return mk;
  }
  return null;
}
function segDist(p: Pt, a: Pt, b: Pt) { const dx = b.x - a.x, dy = b.y - a.y; const L = dx * dx + dy * dy; const t = L ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0; return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }

export const nailLengthK = (len: string) => NAIL_LENGTHS.find((l) => l.key === len)?.k || 1;

/** The flattened copy that's sent: what's shown, on the layers given, at most `max` pixels on its longer side. */
export function flatten(doc: MarkupDoc, img: CanvasImageSource, layers: Layer[], max = 1600): { canvas: HTMLCanvasElement; k: number } {
  const v = viewOf(doc); const k = Math.min(1, max / Math.max(v.w, v.h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(v.w * k)); c.height = Math.max(1, Math.round(v.h * k));
  const x = c.getContext('2d')!;
  drawDoc(x, doc, img, { k, layers });
  // A white ground under it all (a JPEG has nothing see-through).
  x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over';
  return { canvas: c, k };
}
