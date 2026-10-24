'use client';
// src/components/inventory/LabelMarks.tsx — A PRODUCT LABEL, DRAWN: the marks lib/product-labels places (words, bars,
// the QR code), as SVG in points. The preview, the printed sheet and the PDF draw the same marks, so what's on screen is
// what prints. The bars and the QR code are each one path, black on white, so a laser scanner and a phone camera read
// them at any size.
import * as React from 'react';
import type { Mark } from '@/lib/product-labels';

const INK = '#16171a';
const MUTED = '#6d7075';
const FONT = "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/** The bars as one path: each run of bars one rectangle. */
function barsPath(m: Extract<Mark, { t: 'bars' }>): string {
  let d = ''; let i = 0; const b = m.bits;
  while (i < b.length) {
    if (b[i] !== '1') { i++; continue; }
    let j = i; while (j < b.length && b[j] === '1') j++;
    const x = m.x + i * m.module; const w = (j - i) * m.module;
    d += `M${x.toFixed(3)} ${m.y.toFixed(3)}h${w.toFixed(3)}v${m.h.toFixed(3)}h${(-w).toFixed(3)}z`;
    i = j;
  }
  return d;
}

/** The QR code as one path: each run of dark squares in a row one rectangle. */
function qrPath(m: Extract<Mark, { t: 'qr' }>): string {
  const s = m.side / m.n; let d = '';
  for (let r = 0; r < m.n; r++) {
    let c = 0;
    while (c < m.n) {
      if (m.bits[r * m.n + c] !== '1') { c++; continue; }
      let e = c; while (e < m.n && m.bits[r * m.n + e] === '1') e++;
      // A hair wider than the square, so neighboring squares meet without a seam on screen.
      d += `M${(m.x + c * s).toFixed(3)} ${(m.y + r * s).toFixed(3)}h${((e - c) * s + 0.02).toFixed(3)}v${(s + 0.02).toFixed(3)}h${(-((e - c) * s + 0.02)).toFixed(3)}z`;
      c = e;
    }
  }
  return d;
}

/** One label's marks, at (x, y) in the page's points. */
export function LabelMarks({ marks, x = 0, y = 0, image, w, h }: { marks: Mark[]; x?: number; y?: number; image?: string; w?: number; h?: number }) {
  if (image && w && h) return <image href={image} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" />;
  return (
    <g transform={`translate(${x} ${y})`}>
      {marks.map((m, i) => {
        if (m.t === 'text') return <text key={i} x={m.x} y={m.y} fontSize={m.size} fontWeight={m.weight} fill={m.muted ? MUTED : INK} letterSpacing={m.spacing || undefined} style={{ fontFamily: FONT }}>{m.text}</text>;
        if (m.t === 'bars') return <path key={i} d={barsPath(m)} fill="#000" shapeRendering="crispEdges" />;
        return <path key={i} d={qrPath(m)} fill="#000" shapeRendering="crispEdges" />;
      })}
    </g>);
}

export const LABEL_FONT = FONT;
