'use client';
// src/components/gift/GiftCardFace.tsx — ONE GIFT CARD, drawn like a real card (lib/gift-designs). The art comes from the
// design; the business's name and logo, an occasion line, the chip, the amount, the code and who it's for go on top.
// Drawn at 420 × 265 and scaled to `width`, so it looks the same on a phone, at the desk and in print.
import * as React from 'react';
import { designById, type GiftDesign } from '@/lib/gift-designs';

const CHIP = (a: string, b: string, id: string) => `<svg width="44" height="34" viewBox="0 0 44 34"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs><rect x=".5" y=".5" width="43" height="33" rx="6" fill="url(#${id})" stroke="rgba(0,0,0,.18)"/><path d="M0 12h14M0 22h14M30 12h14M30 22h14M14 0v34M30 0v34M14 12h16v10H14z" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1"/></svg>`;

/** Give each drawing's gradient and filter names a unique suffix, so two cards on one page don't borrow each other's. */
const scope = (svg: string, k: string) => svg.replace(/id="([^"]+)"/g, `id="$1${k}"`).replace(/url\(#([^)]+)\)/g, `url(#$1${k})`);

export function GiftCardFace({ design, width = 340, brand, amount, name, code, line, className, style, expires }: {
  expires?: string | null;   // ISO date, or nothing for "Never"
  design?: string | GiftDesign | null; width?: number; brand: { name: string; logo?: string | null; accent?: string | null };
  amount: string; name?: string | null; code?: string | null; line?: string | null; className?: string; style?: React.CSSProperties;
}) {
  const d = typeof design === 'object' && design ? design : designById(design as string);
  const k = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const acc = brand.accent || '#7c3aed'; const s = width / 420;
  const bg = d.brand ? `linear-gradient(135deg, color-mix(in srgb, ${acc} 78%, #fff) 0%, ${acc} 45%, color-mix(in srgb, ${acc} 70%, #000) 100%)` : d.bg;
  const sh = d.glow ? (d.dark ? '0 1px 10px rgba(0,0,0,.35)' : '0 1px 10px rgba(255,255,255,.7)') : 'none';
  const lineText = line === undefined ? d.line : line;
  const initial = (brand.name || '?').trim().charAt(0).toUpperCase();
  return (
    <div className={className} role="img" aria-label={`${brand.name} gift card, ${amount}${name ? `, for ${name}` : ''}`}
      style={{ width, height: Math.round(265 * s), position: 'relative', flexShrink: 0, ...style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 420, height: 265, transform: `scale(${s})`, transformOrigin: '0 0', borderRadius: 20, overflow: 'hidden', background: bg,
        border: d.border, color: d.ink, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", boxShadow: `0 24px 50px rgba(22,23,26,${d.dark ? '.36' : '.14'})`, boxSizing: 'border-box' }}>
        {d.svg ? <div aria-hidden style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: scope(d.svg, k) }} /> : null}
        {d.sheen && d.sheen !== 'none' ? <div aria-hidden style={{ position: 'absolute', inset: 0, background: d.sheen }} /> : null}
        <div aria-hidden className="gcf-sheen" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,transparent 35%,rgba(255,255,255,.18) 48%,transparent 60%)' }} />
        <div style={{ position: 'absolute', top: 24, left: 26, right: 120, display: 'flex', alignItems: 'center', gap: 9, textShadow: sh }}>
          {brand.logo ? <img src={brand.logo} alt="" style={{ width: 30, height: 30, borderRadius: 9, objectFit: 'cover', background: '#fff' }} />
            : <span style={{ width: 30, height: 30, borderRadius: 9, background: d.tileAccent ? acc : 'rgba(255,255,255,.16)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, textShadow: 'none' }}>{initial}</span>}
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand.name}</span></div>
        <span style={{ position: 'absolute', top: 28, right: 26, fontSize: 12, fontWeight: 500, color: d.sub }}>Gift card</span>
        {lineText ? <span style={{ position: 'absolute', top: 64, left: 26, maxWidth: 240, fontSize: 12.5, fontWeight: 600, color: d.lineColor || (d.tileAccent ? acc : d.ink), textShadow: sh, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(lineText)}</span> : null}
        <div aria-hidden style={{ position: 'absolute', top: 92, left: 26 }} dangerouslySetInnerHTML={{ __html: CHIP(d.chip[0], d.chip[1], `chip${k}`) }} />
        <div style={{ position: 'absolute', top: 84, right: 26, textAlign: 'right', textShadow: sh, fontSize: amount.length > 7 ? 34 : 46, fontWeight: 300, letterSpacing: '-.035em', lineHeight: 1, color: d.amountAccent ? acc : d.ink }}>{amount}</div>
        <div style={{ position: 'absolute', left: 26, bottom: 56, fontSize: 19, fontWeight: 500, letterSpacing: '.08em', fontVariantNumeric: 'tabular-nums', textShadow: sh }}>{code ? code.replace('-', '  ') : '••••  ••••'}</div>
        <div style={{ position: 'absolute', left: 26, right: 26, bottom: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', textShadow: sh }}>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 10, color: d.sub }}>For</div><div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{name || 'You'}</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: d.sub }}>Expires</div><div style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{expires ? new Date(expires).toLocaleDateString('en-US', { month: '2-digit', year: '2-digit' }) : 'Never'}</div></div></div>
      </div>
    </div>);
}
