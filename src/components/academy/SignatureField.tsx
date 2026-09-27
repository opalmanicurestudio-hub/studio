'use client';
// src/components/academy/SignatureField.tsx — sign with your finger or mouse.
// Returns a trimmed, transparent PNG (data URL) or null while empty. Used for
// enrolment agreements and school documents; the drawn signature goes onto
// the signed PDF kept in the student's file.
import { useEffect, useRef, useState } from 'react';

export function SignatureField({ onChange, label = 'Sign here', clearLabel = 'Clear', color = '#1c1917' }: { onChange: (png: string | null) => void; label?: string; clearLabel?: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null); const last = useRef<{ x: number; y: number } | null>(null); const [inked, setInked] = useState(false);
  useEffect(() => { const c = ref.current; if (!c) return; const r = c.getBoundingClientRect(); const k = Math.min(3, window.devicePixelRatio || 1); c.width = Math.round(r.width * k); c.height = Math.round(r.height * k); }, []);
  const pt = (e: React.PointerEvent) => { const c = ref.current!, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => { const c = ref.current!; const x = c.getContext('2d')!; x.strokeStyle = '#111827'; x.lineWidth = Math.max(2.5, c.width / 220); x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); };
  /** Trim to the ink and export (keeps the file small). */
  const exportPng = () => {
    const c = ref.current!; const x = c.getContext('2d')!; const d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) { const px = ((i - 3) / 4) % c.width, py = Math.floor((i - 3) / 4 / c.width); if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    if (x1 < 0) return null; const pad = 8; const w = Math.min(c.width, x1 + pad) - Math.max(0, x0 - pad), h = Math.min(c.height, y1 + pad) - Math.max(0, y0 - pad);
    const k = Math.min(1, 600 / w); const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(w * k)); o.height = Math.max(1, Math.round(h * k));
    o.getContext('2d')!.drawImage(c, Math.max(0, x0 - pad), Math.max(0, y0 - pad), w, h, 0, 0, o.width, o.height); return o.toDataURL('image/png');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><span className="text-[13px] font-medium text-stone-700">{label}</span>{inked && <button type="button" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setInked(false); onChange(null); }} className="text-[13px] underline">{clearLabel}</button>}</div>
      <canvas ref={ref} className="h-36 w-full touch-none rounded-2xl border-2 border-dashed bg-white" style={{ borderColor: inked ? color : '#d6d3d1' }} aria-label={label}
        onPointerDown={(e) => { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); last.current = pt(e); }}
        onPointerMove={(e) => { if (!last.current) return; const p = pt(e); line(last.current, p); last.current = p; if (!inked) setInked(true); }}
        onPointerUp={() => { last.current = null; if (ref.current) onChange(exportPng()); }} onPointerCancel={() => { last.current = null; }} />
    </div>
  );
}
