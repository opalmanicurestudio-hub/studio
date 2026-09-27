'use client';
// src/components/booking/PhotoMarkup.tsx — inspiration photos, marked up.
//
// Clients add up to 4 photos (camera or library) and mark each one up so the
// provider sees exactly what they mean:
//   Move · Pen (smoothed) · Highlight · Arrow · Circle · Text · Stamps · Colour picker
//   Stamps: heart, star, sparkle, tick, cross + nail-shape guides (square,
//           round, almond, coffin, stiletto) to show shape and length
//   Colour picker: tap the photo to grab that exact shade → "Colours I love",
//           added to the photo's note automatically (#hex)
//   Move any mark (drag), resize stamps/text (Size), delete; Undo / Redo
//   Pinch or +/− to zoom, two fingers to pan; "Hold to see original"
// Every mark is kept as a shape and redrawn, so Undo/Redo are exact. On Done
// the photo is flattened to a JPEG and saved through the server
// (/api/booking/photo) — no dependence on Storage rules for visitors.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface InspoPhoto { url: string; note: string; local?: string; colours?: string[] }
type Tool = 'move' | 'pen' | 'highlight' | 'arrow' | 'circle' | 'text' | 'stamp' | 'pick';
type Pt = { x: number; y: number };
type Mark = { id: string; tool: Exclude<Tool, 'move' | 'pick'>; color: string; size: number; pts: Pt[]; text?: string; stamp?: string };

const PALETTE = ['#e11d48', '#f472b6', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#ffffff', '#111827'];
const SIZES: [string, number][] = [['S', 0.006], ['M', 0.012], ['L', 0.022]];
const TOOLS: [Tool, string][] = [['move', 'Move'], ['pen', 'Pen'], ['highlight', 'Highlight'], ['arrow', 'Arrow'], ['circle', 'Circle'], ['text', 'Text'], ['stamp', 'Stamps'], ['pick', 'Pick colour']];
const STAMPS: [string, string][] = [['heart', 'Heart'], ['star', 'Star'], ['sparkle', 'Sparkle'], ['tick', 'Tick'], ['cross', 'Cross'],
  ['nail-square', 'Square nail'], ['nail-round', 'Round nail'], ['nail-almond', 'Almond nail'], ['nail-coffin', 'Coffin nail'], ['nail-stiletto', 'Stiletto nail']];
const uid = () => Math.random().toString(36).slice(2, 9);
const buzz = () => { try { (navigator as any).vibrate?.(8); } catch { /* no haptics */ } };
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// ── Drawing ──────────────────────────────────────────────────────────────
function stampPath(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, s: number) {
  ctx.beginPath();
  if (kind === 'heart') { ctx.moveTo(cx, cy + s * 0.35); ctx.bezierCurveTo(cx - s * 0.9, cy - s * 0.25, cx - s * 0.35, cy - s * 0.85, cx, cy - s * 0.35); ctx.bezierCurveTo(cx + s * 0.35, cy - s * 0.85, cx + s * 0.9, cy - s * 0.25, cx, cy + s * 0.35); }
  else if (kind === 'star') { for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.4 : s * 0.9, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } ctx.closePath(); }
  else if (kind === 'sparkle') { for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.18 : s * 0.9, a = -Math.PI / 2 + (i * Math.PI) / 4; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } ctx.closePath(); }
  else if (kind === 'tick') { ctx.moveTo(cx - s * 0.6, cy); ctx.lineTo(cx - s * 0.15, cy + s * 0.45); ctx.lineTo(cx + s * 0.65, cy - s * 0.5); }
  else if (kind === 'cross') { ctx.moveTo(cx - s * 0.5, cy - s * 0.5); ctx.lineTo(cx + s * 0.5, cy + s * 0.5); ctx.moveTo(cx + s * 0.5, cy - s * 0.5); ctx.lineTo(cx - s * 0.5, cy + s * 0.5); }
  else if (kind.startsWith('nail-')) {
    const w = s * 0.55, h = s * 1.6, top = cy - h / 2, bot = cy + h / 2, l = cx - w / 2, r = cx + w / 2;
    ctx.moveTo(l, bot); // cuticle end is the bottom (rounded), free edge on top
    if (kind === 'nail-square') { ctx.lineTo(l, top); ctx.lineTo(r, top); }
    else if (kind === 'nail-round') { ctx.lineTo(l, top + w / 2); ctx.arc(cx, top + w / 2, w / 2, Math.PI, 0); }
    else if (kind === 'nail-almond') { ctx.lineTo(l, cy - h * 0.1); ctx.quadraticCurveTo(l, top + h * 0.05, cx, top - h * 0.05); ctx.quadraticCurveTo(r, top + h * 0.05, r, cy - h * 0.1); }
    else if (kind === 'nail-coffin') { ctx.lineTo(l + w * 0.12, top + h * 0.05); ctx.lineTo(cx - w * 0.25, top - h * 0.05); ctx.lineTo(cx + w * 0.25, top - h * 0.05); ctx.lineTo(r - w * 0.12, top + h * 0.05); }
    else if (kind === 'nail-stiletto') { ctx.lineTo(l, cy - h * 0.05); ctx.lineTo(cx, top - h * 0.2); ctx.lineTo(r, cy - h * 0.05); }
    ctx.lineTo(r, bot); ctx.arc(cx, bot, w / 2, 0, Math.PI);
  }
}
function drawMark(ctx: CanvasRenderingContext2D, m: Mark, W: number, pop = 1) {
  const lw = Math.max(2, m.size * W);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = m.color; ctx.fillStyle = m.color;
  if (m.tool === 'pen' || m.tool === 'highlight') {
    if (m.tool === 'highlight') { ctx.globalAlpha = 0.35; ctx.lineWidth = lw * 3.2; } else ctx.lineWidth = lw;
    const p = m.pts; ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length - 1; i++) { const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2; ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my); }
    if (p.length > 1) ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y); else ctx.lineTo(p[0].x + 0.1, p[0].y);
    ctx.stroke();
  } else if (m.tool === 'arrow' && m.pts.length > 1) {
    const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]]; const ang = Math.atan2(b.y - a.y, b.x - a.x); const head = lw * 4;
    ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x - (head * 0.6) * Math.cos(ang), b.y - (head * 0.6) * Math.sin(ang)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45)); ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
  } else if (m.tool === 'circle' && m.pts.length > 1) {
    const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
    ctx.lineWidth = lw; ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2 || 1, Math.abs(b.y - a.y) / 2 || 1, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (m.tool === 'text' && m.text) {
    const fs = Math.max(14, m.size * W * 3.4) * pop; ctx.font = `600 ${fs}px 'Plus Jakarta Sans', system-ui, sans-serif`; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(m.text).width, pad = fs * 0.35;
    ctx.globalAlpha = 0.85; ctx.fillStyle = m.color === '#ffffff' ? '#111827' : '#ffffff'; roundRect(ctx, m.pts[0].x - pad, m.pts[0].y - fs * 0.7, tw + pad * 2, fs * 1.4, fs * 0.5); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = m.color; ctx.fillText(m.text, m.pts[0].x, m.pts[0].y);
  } else if (m.tool === 'stamp' && m.stamp) {
    const s = Math.max(18, m.size * W * 7) * (m.stamp.startsWith('nail-') ? 2 : 1) * pop; const outline = m.stamp.startsWith('nail-') || m.stamp === 'tick' || m.stamp === 'cross';
    stampPath(ctx, m.stamp, m.pts[0].x, m.pts[0].y, s);
    if (outline) { ctx.lineWidth = lw * (m.stamp.startsWith('nail-') ? 0.8 : 1.4); ctx.setLineDash(m.stamp.startsWith('nail-') ? [lw * 1.6, lw * 1.2] : []); ctx.stroke(); }
    else { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = s * 0.12; ctx.fill(); }
  }
  ctx.restore();
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function bbox(m: Mark, W: number, ctx?: CanvasRenderingContext2D) {
  if (m.tool === 'stamp') { const s = Math.max(18, m.size * W * 7) * (m.stamp?.startsWith('nail-') ? 2 : 1); return { x0: m.pts[0].x - s, y0: m.pts[0].y - s * 1.1, x1: m.pts[0].x + s, y1: m.pts[0].y + s * 1.1 }; }
  if (m.tool === 'text' && ctx) { const fs = Math.max(14, m.size * W * 3.4); ctx.font = `600 ${fs}px sans-serif`; const tw = ctx.measureText(m.text || '').width; return { x0: m.pts[0].x - fs * 0.4, y0: m.pts[0].y - fs * 0.8, x1: m.pts[0].x + tw + fs * 0.4, y1: m.pts[0].y + fs * 0.8 }; }
  const xs = m.pts.map((p) => p.x), ys = m.pts.map((p) => p.y), pad = Math.max(12, m.size * W * 2);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

// ── The editor ───────────────────────────────────────────────────────────
function Editor({ src, onDone, onCancel, accent, initialNote = '', initialColours = [] }: {
  src: string; onDone: (dataUrl: string, note: string, colours: string[]) => void; onCancel: () => void; accent: string; initialNote?: string; initialColours?: string[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null); const img = useRef<HTMLImageElement | null>(null); const sample = useRef<CanvasRenderingContext2D | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]); const [redo, setRedo] = useState<Mark[][]>([]); const hist = useRef<Mark[][]>([]);
  const live = useRef<Mark | null>(null); const drag = useRef<{ id: string; from: Pt; orig: Pt[] } | null>(null);
  const [tool, setTool] = useState<Tool>('pen'); const [color, setColor] = useState(PALETTE[0]); const [size, setSize] = useState(SIZES[1][1]);
  const [stamp, setStamp] = useState('heart'); const [text, setText] = useState(''); const [note, setNote] = useState(initialNote);
  const [colours, setColours] = useState<string[]>(initialColours); const [sel, setSel] = useState<string | null>(null);
  const [ready, setReady] = useState(false); const [peek, setPeek] = useState(false); const [pop, setPop] = useState<{ id: string; t: number } | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 }); const touches = useRef(new Map<number, Pt>()); const pinch = useRef<{ d: number; k: number; mid: Pt; x: number; y: number } | null>(null);

  const commit = (next: Mark[]) => { hist.current.push(marks); setMarks(next); setRedo([]); };
  const undo = () => { const prev = hist.current.pop(); if (prev) { setRedo((r) => [marks, ...r]); setMarks(prev); setSel(null); buzz(); } };
  const redoOne = () => { const [n, ...rest] = redo; if (n) { hist.current.push(marks); setMarks(n); setRedo(rest); buzz(); } };

  const render = useCallback((extra?: Mark | null) => {
    const c = canvas.current, i = img.current; if (!c || !i) return; const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(i, 0, 0, c.width, c.height);
    if (peek) return; // hold to see the original
    const now = performance.now();
    [...marks, ...(extra ? [extra] : [])].forEach((m) => {
      const k = pop && pop.id === m.id ? Math.min(1, 0.6 + (now - pop.t) / 250) : 1;
      drawMark(ctx, m, c.width, k);
    });
    if (sel) { const m = marks.find((x) => x.id === sel); if (m) { const b = bbox(m, c.width, ctx); ctx.save(); ctx.setLineDash([8, 6]); ctx.lineWidth = Math.max(2, c.width / 400); ctx.strokeStyle = accent; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.restore(); } }
  }, [marks, peek, sel, pop, accent]);

  useEffect(() => {
    const i = new Image(); i.onload = () => {
      const k = Math.min(1, 1600 / Math.max(i.width, i.height)); const c = canvas.current!; c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); img.current = i;
      const off = document.createElement('canvas'); off.width = c.width; off.height = c.height; const octx = off.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D; octx.drawImage(i, 0, 0, c.width, c.height); sample.current = octx;
      setReady(true);
    }; i.src = src;
  }, [src]);
  useEffect(() => { if (ready) render(); }, [ready, render]);
  useEffect(() => { // the little "pop" when a stamp or label lands
    if (!pop) return; let raf = 0; const tick = () => { render(); if (performance.now() - pop.t < 260) raf = requestAnimationFrame(tick); else setPop(null); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [pop, render]);

  const pt = (e: { clientX: number; clientY: number }) => { const c = canvas.current!, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const hit = (p: Pt) => { const c = canvas.current!, ctx = c.getContext('2d')!; for (let i = marks.length - 1; i >= 0; i--) { const b = bbox(marks[i], c.width, ctx); if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return marks[i]; } return null; };

  const down = (e: React.PointerEvent) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (touches.current.size === 2) { // pinch / pan with two fingers
      live.current = null; drag.current = null; const [a, b] = [...touches.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: view.x, y: view.y }; return;
    }
    const p = pt(e);
    if (tool === 'pick') {
      const d = sample.current?.getImageData(Math.max(0, Math.round(p.x)), Math.max(0, Math.round(p.y)), 1, 1).data; if (!d) return;
      const h = hex(d[0], d[1], d[2]); setColor(h); setColours((cs) => (cs.includes(h) ? cs : [...cs, h].slice(-6))); buzz(); return;
    }
    if (tool === 'move') { const m = hit(p); setSel(m?.id || null); if (m) drag.current = { id: m.id, from: p, orig: m.pts.map((q) => ({ ...q })) }; return; }
    if (tool === 'text') { if (!text.trim()) return; const m: Mark = { id: uid(), tool: 'text', color, size, pts: [p], text: text.trim() }; commit([...marks, m]); setText(''); setPop({ id: m.id, t: performance.now() }); buzz(); return; }
    if (tool === 'stamp') { const m: Mark = { id: uid(), tool: 'stamp', color, size, pts: [p], stamp }; commit([...marks, m]); setPop({ id: m.id, t: performance.now() }); buzz(); return; }
    live.current = { id: uid(), tool: tool as Mark['tool'], color, size, pts: [p] };
  };
  const move = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.min(5, Math.max(1, pinch.current.k * (d / (pinch.current.d || 1))));
      setView({ k, x: pinch.current.x + (mid.x - pinch.current.mid.x), y: pinch.current.y + (mid.y - pinch.current.mid.y) }); return;
    }
    const p = pt(e);
    if (drag.current) { const { id, from, orig } = drag.current; const dx = p.x - from.x, dy = p.y - from.y; setMarks((ms) => ms.map((m) => (m.id === id ? { ...m, pts: orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : m))); return; }
    const m = live.current; if (!m) return; if (m.tool === 'pen' || m.tool === 'highlight') m.pts.push(p); else m.pts = [m.pts[0], p]; render(m);
  };
  const up = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null;
    if (drag.current) { const { id, orig } = drag.current; drag.current = null; const moved = marks.find((m) => m.id === id); if (moved && (moved.pts[0].x !== orig[0].x || moved.pts[0].y !== orig[0].y)) { hist.current.push(marks.map((m) => (m.id === id ? { ...m, pts: orig } : m))); setRedo([]); } return; }
    const m = live.current; live.current = null; if (m && (m.pts.length > 1 || m.tool === 'pen')) { commit([...marks, m]); buzz(); }
  };
  const zoom = (f: number) => setView((v) => { const k = Math.min(5, Math.max(1, v.k * f)); return k === 1 ? { k: 1, x: 0, y: 0 } : { ...v, k }; });
  const resizeSel = (f: number) => { if (!sel) return; commit(marks.map((m) => (m.id === sel ? { ...m, size: Math.min(0.06, Math.max(0.003, m.size * f)) } : m))); };
  const done = () => { const c = canvas.current; if (!c) return; setSel(null); setPeek(false); requestAnimationFrame(() => { render(); const extra = colours.length ? `${note.trim() ? '\n' : ''}Colours I picked: ${colours.join(', ')}` : ''; onDone(c.toDataURL('image/jpeg', 0.86), (note.trim() + extra).slice(0, 400), colours); }); };

  const chip = (on: boolean) => `h-10 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition active:scale-95 ${on ? 'text-white shadow' : 'bg-white text-stone-700'}`;
  return (
    <div className="fixed inset-0 z-[400] flex flex-col bg-[#1c1917]" role="dialog" aria-label="Mark up your photo" style={{ paddingTop: 'env(safe-area-inset-top,0px)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <button type="button" onClick={onCancel} className="text-[15px]">Cancel</button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={undo} disabled={!hist.current.length} aria-label="Undo" className="h-9 w-9 rounded-full bg-white/10 disabled:opacity-30">↶</button>
          <button type="button" onClick={redoOne} disabled={!redo.length} aria-label="Redo" className="h-9 w-9 rounded-full bg-white/10 disabled:opacity-30">↷</button>
          <button type="button" onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} aria-label="Hold to see the original" className="h-9 rounded-full bg-white/10 px-3 text-[12px]">Hold: original</button>
        </div>
        <button type="button" onClick={done} className="rounded-full px-4 py-1.5 text-[15px] font-medium text-white" style={{ background: accent }}>Done</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3">
        <canvas ref={canvas} className="max-h-full max-w-full touch-none rounded-xl shadow-2xl" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: 'center', cursor: tool === 'move' ? 'grab' : tool === 'pick' ? 'copy' : tool === 'text' || tool === 'stamp' ? 'cell' : 'crosshair' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Your photo — draw on it" />
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5"><button type="button" onClick={() => zoom(1.4)} aria-label="Zoom in" className="h-9 w-9 rounded-full bg-white/90 text-lg">+</button><button type="button" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out" className="h-9 w-9 rounded-full bg-white/90 text-lg">−</button></div>
        {tool === 'pick' && <p className="pointer-events-none absolute top-2 rounded-full bg-black/60 px-3 py-1 text-[12px] text-white">Tap the photo to pick that exact colour</p>}
      </div>
      <div className="space-y-2.5 rounded-t-3xl bg-[#faf8f5] px-4 pb-3 pt-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">{TOOLS.map(([k, l]) => <button key={k} type="button" onClick={() => { setTool(k); setSel(null); buzz(); }} aria-pressed={tool === k} className={chip(tool === k)} style={tool === k ? { background: accent } : undefined}>{l}</button>)}</div>
        {tool === 'stamp' && <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">{STAMPS.map(([k, l]) => <button key={k} type="button" onClick={() => { setStamp(k); buzz(); }} aria-pressed={stamp === k} className={`h-9 shrink-0 rounded-full px-3 text-[12px] ${stamp === k ? 'bg-stone-800 text-white' : 'bg-white'}`}>{l}</button>)}</div>}
        {tool === 'text' && <input value={text} onChange={(e) => setText(e.target.value.slice(0, 40))} placeholder="Type a label, then tap the photo to place it" className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-[15px]" aria-label="Label text" />}
        {tool === 'move' && <div className="flex items-center gap-2 text-[13px]">{sel ? <>
          <button type="button" onClick={() => resizeSel(0.8)} className="h-9 rounded-full bg-white px-3">Smaller</button><button type="button" onClick={() => resizeSel(1.25)} className="h-9 rounded-full bg-white px-3">Bigger</button>
          <button type="button" onClick={() => { commit(marks.filter((m) => m.id !== sel)); setSel(null); buzz(); }} className="h-9 rounded-full bg-white px-3 text-red-700">Delete</button></> : <span className="text-stone-500">Tap a mark to move, resize or delete it</span>}</div>}
        <div className="flex items-center gap-2 overflow-x-auto">
          {PALETTE.map((c) => <button key={c} type="button" onClick={() => { setColor(c); buzz(); }} aria-label={`Colour ${c}`} aria-pressed={color === c} className="h-8 w-8 shrink-0 rounded-full border-2 transition active:scale-90" style={{ background: c, borderColor: color === c ? accent : '#d6d3d1', boxShadow: color === c ? `0 0 0 2px ${accent}` : undefined }} />)}
          <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-stone-300" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} aria-label="Custom colour"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 opacity-0" /></label>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-stone-500"><span>Size</span>
          {SIZES.map(([l, v]) => <button key={l} type="button" onClick={() => setSize(v)} aria-pressed={size === v} aria-label={`Size ${l}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${size === v ? 'bg-stone-800' : 'bg-white'}`}><span className="rounded-full" style={{ width: 4 + v * 400, height: 4 + v * 400, background: size === v ? '#fff' : '#57534e' }} /></button>)}
        </div>
        {colours.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-[12px]"><span className="text-stone-500">Colours I love:</span>{colours.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className="flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-sm"><span className="h-4 w-4 rounded-full border" style={{ background: c }} />{c}</button>)}<button type="button" onClick={() => setColours([])} className="text-stone-400 underline">clear</button></div>}
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Add a note (optional) — e.g. this shape, a little shorter" className="w-full rounded-xl border border-stone-300 bg-white p-2.5 text-[15px]" aria-label="Note for this photo" />
      </div>
    </div>
  );
}

// ── The photo list on the booking sheet ─────────────────────────────────
export function PhotoMarkup({ tenantId, value, onChange, accent = '#7c3aed', max = 4 }: { tenantId: string; value: InspoPhoto[]; onChange: (v: InspoPhoto[]) => void; accent?: string; max?: number }) {
  const [editing, setEditing] = useState<{ src: string; index: number | null; note: string; colours: string[] } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  // The editor opens at the top of the page, outside the area that defines
  // --accent — so resolve the business's real colour here and hand it over.
  const root = useRef<HTMLDivElement>(null);
  const realAccent = () => { if (!accent.startsWith('var(')) return accent; const v = root.current ? getComputedStyle(root.current).getPropertyValue('--accent').trim() : ''; return v || (accent.match(/,\s*([^)]+)\)/)?.[1] || '#7c3aed'); };
  const pick = (files: FileList | null) => {
    const f = files?.[0]; if (!f) return; setErr('');
    if (!/^image\//.test(f.type)) { setErr('That file isn’t a photo.'); return; }
    const r = new FileReader(); r.onload = () => setEditing({ src: String(r.result), index: null, note: '', colours: [] }); r.readAsDataURL(f);
  };
  const save = async (dataUrl: string, note: string, colours: string[]) => {
    const idx = editing?.index ?? null; setEditing(null); setBusy(true); setErr('');
    try {
      const res = await fetch('/api/booking/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, dataUrl }) });
      const d = await res.json().catch(() => ({}));
      if (!d?.ok || !d.url) { setErr(d?.error || 'Couldn’t save that photo — please try again.'); return; }
      const item: InspoPhoto = { url: d.url, note, local: dataUrl, colours };
      const next = [...value]; if (idx === null) next.push(item); else next[idx] = item;
      onChange(next.slice(0, max));
    } catch { setErr('Couldn’t save that photo — check your connection and try again.'); } finally { setBusy(false); }
  };
  return (
    <div ref={root} className="space-y-2">
      {value.length > 0 && <div className="grid grid-cols-2 gap-2">{value.map((p, i) => (
        <figure key={p.url} className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <img src={p.local || p.url} alt={`Inspiration photo ${i + 1}`} className="aspect-square w-full object-cover" />
          <figcaption className="space-y-1 p-2 text-[12px]">
            {(p.colours || []).length > 0 && <div className="flex gap-1">{p.colours!.map((c) => <span key={c} className="h-4 w-4 rounded-full border" style={{ background: c }} title={c} />)}</div>}
            {p.note && <p className="line-clamp-2 text-stone-600">{p.note}</p>}
            <div className="flex gap-3"><button type="button" onClick={() => setEditing({ src: p.local || p.url, index: i, note: (p.note || '').replace(/\n?Colours I picked:[\s\S]*$/, ''), colours: p.colours || [] })} className="underline underline-offset-2">Mark up</button><button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-stone-500 underline underline-offset-2">Remove</button></div>
          </figcaption>
        </figure>
      ))}</div>}
      {value.length < max && <div className="grid grid-cols-2 gap-2">
        <label className="flex h-12 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white text-[14px] transition active:scale-[.98]">Take a photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} aria-label="Take an inspiration photo" /></label>
        <label className="flex h-12 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white text-[14px] transition active:scale-[.98]">Choose a photo<input type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} aria-label="Choose an inspiration photo" /></label>
      </div>}
      <p className="text-[12px] text-stone-500">{busy ? 'Saving your photo…' : `Up to ${max} photos — draw, stamp a nail shape, or pick an exact colour from the photo.`}</p>
      {err && <p className="text-[13px] text-red-700" role="alert">{err}</p>}
      {/* Opened at the top of the page (a portal), so no animated or scrolling
          parent can shrink it or put the page's buttons on top of it. */}
      {editing && typeof document !== 'undefined' && createPortal(<Editor src={editing.src} accent={realAccent()} initialNote={editing.note} initialColours={editing.colours} onCancel={() => setEditing(null)} onDone={save} />, document.body)}
    </div>
  );
}
