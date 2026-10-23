'use client';
// src/components/refunds/RefundSheets.tsx — the printed pieces for a cash refund pickup: the envelope slip (#10 envelope,
// 9.5 × 4.125 in) and the note card that goes inside (A2, 5.5 × 4.25 in). In the app's print look (lib/print-style):
// light headings, sentence-case labels in grey, thin lines, a soft panel for the money and big light tabular numbers,
// with the business's own logo or color. The paper keeps its own colors; only the Print button follows the app's theme.
import * as React from 'react';
import { settingsOf } from '@/lib/making-it-right';
import { PRINT, PRINT_FONT_STACK } from '@/lib/print-style';

const INK = 'hsl(var(--foreground))';
const money = (c: number) => `$${(Math.round(c || 0) / 100).toFixed(2)}`;
const tl = (t: string) => { const h = Number(t.slice(0, 2)); const m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`; };
const dl = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
function bills(cents: number) {
  let left = Math.round(cents); const out: { label: string; count: number }[] = [];
  for (const [v, label] of [[10000, '$100'], [5000, '$50'], [2000, '$20'], [1000, '$10'], [500, '$5'], [100, '$1'], [25, '25¢'], [10, '10¢'], [5, '5¢'], [1, '1¢']] as [number, string][]) { const n = Math.floor(left / v); if (n > 0) { out.push({ label, count: n }); left -= n * v; } }
  return out;
}
function accentOf(t: any) {
  const c = t?.bookingPageSettings?.cfPageConfig?.accentColor || t?.bookingPageSettings?.theme?.primaryColor || t?.brandColor || '';
  return typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim()) ? (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`) : PRINT.ink;
}
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: PRINT.muted };

export function RefundSheets({ p, tenant, onPrint }: { p: any; tenant: any; onPrint?: () => void }) {
  const selectedTenant = tenant;
  const name = selectedTenant?.name || selectedTenant?.businessName || ''; const accent = accentOf(selectedTenant); const logo = selectedTenant?.logoUrl || selectedTenant?.logo || null;
  const signer = settingsOf(selectedTenant).cashRefund.signer || '';
  const Logo = ({ s }: { s: number }) => logo ? <img src={logo} alt="" style={{ width: s, height: s, borderRadius: s * 0.3, objectFit: 'cover' }} /> : <span style={{ width: s, height: s, borderRadius: s * 0.3, background: accent, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: s * 0.42, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>{name.slice(0, 1)}</span>;
  const [first, ...rest] = String(p.noteText || '').split(/\n\s*\n/);
  return (
    <div className="sheets" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, letterSpacing: '-0.01em', background: 'hsl(var(--card))' }}>
      <style>{`@page slip { size: 9.5in 4.125in; margin: 0 } @page card { size: 5.5in 4.25in; margin: 0 }
        .slip { page: slip; width: 9.5in; height: 4.125in; } .card { page: card; width: 5.5in; height: 4.25in; }
        .sheet { box-sizing: border-box; break-after: page; overflow: hidden; background: #fff; font-family: ${PRINT_FONT_STACK}; color: ${PRINT.ink}; font-weight: 400; letter-spacing: normal; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .sheet.card { break-after: auto; } @media print { .sheets, main, body { page: card } }
        @media screen { body { background: #f7f7f8 } .sheet { margin: 24px auto; box-shadow: 0 1px 3px rgba(0,0,0,.12); background: #fff } }
        @media print { header, nav, aside, ol.fixed, nextjs-portal { display: none !important } html, body, main { height: auto !important; min-height: 0 !important; background: #fff !important } }`}</style>
      <section className="sheet slip cf-paper" style={{ padding: '0.22in' }}>
        <div style={{ height: '100%', boxSizing: 'border-box', border: `1px solid ${PRINT.line}`, borderRadius: 16, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1.3, padding: '0.22in 0.26in', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Logo s={36} /><div><div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>{selectedTenant?.studioAddress && <div style={{ fontSize: 11, color: PRINT.muted, maxWidth: '3.6in', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedTenant.studioAddress}</div>}</div></div>
            <div><div style={LBL}>Refund for</div><div style={{ fontSize: 42, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1.05 }}>{p.clientName}</div>
              {p.pickup && <div style={{ fontSize: 13.5, color: PRINT.body, marginTop: 6 }}>{dl(p.pickup.date)} · {tl(p.pickup.start)}–{tl(p.pickup.end)} · front desk</div>}</div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: PRINT.amber }}>Release only when the pickup code matches</div>
          </div>
          <div style={{ flex: 1, background: PRINT.soft, padding: '0.22in 0.24in', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}><span style={LBL}>{p.number ? `Case ${p.number}` : 'Refund'}</span><span style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{money(p.amountCents)}</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{bills(p.amountCents).map((b) => <div key={b.label} style={{ background: '#fff', borderRadius: 10, padding: '5px 9px', minWidth: 52 }}><div style={{ fontSize: 16, fontWeight: 600 }}>{b.count}</div><div style={{ fontSize: 11, color: PRINT.muted }}>× {b.label}</div></div>)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 'auto' }}>
              {['Prepared', 'Counted', 'Sealed at'].map((l) => <div key={l} style={LBL}><div style={{ borderBottom: `1px solid ${PRINT.ink}`, height: 22 }} /><span style={{ display: 'block', paddingTop: 4 }}>{l}</span></div>)}
              <div style={{ ...LBL, display: 'flex', alignItems: 'flex-end', gap: 8 }}><span style={{ width: 14, height: 14, border: `1px solid ${PRINT.faint}`, borderRadius: 4, background: '#fff', display: 'inline-block', flexShrink: 0 }} />Note inside</div>
            </div>
          </div>
        </div>
      </section>
      <section className="sheet card cf-paper" style={{ padding: '0.36in 0.4in', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Logo s={28} /><span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span></div>
        <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.12, marginTop: 4 }}>{first}</div>
        {rest.map((para, i) => <p key={i} style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: PRINT.body }}>{para}</p>)}
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, borderTop: `1px solid ${PRINT.line}`, paddingTop: 10 }}>
          <div><div style={{ fontSize: 14, fontWeight: 600 }}>{signer || name}</div>{signer && <div style={{ fontSize: 11.5, color: PRINT.muted }}>{name}</div>}</div>
          {p.number && <div style={LBL}>Case {p.number}</div>}
        </div>
      </section>
      <div className="no-print" style={{ textAlign: 'center', padding: 16 }}><button type="button" onClick={() => (onPrint ? onPrint() : window.print())} style={{ height: 44, padding: '0 20px', borderRadius: 999, background: INK, color: 'hsl(var(--background))', border: 0, fontSize: 15 }}>Print</button></div>
      <style>{`@media print { .no-print { display: none } }`}</style>
    </div>);
}
