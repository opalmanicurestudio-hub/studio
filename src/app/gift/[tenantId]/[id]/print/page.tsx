'use client';
// src/app/gift/[tenantId]/[id]/print/page.tsx — PRINT A GIFT CARD at real card size (3.375 × 2.125 in): the front in its
// design, and the back with a QR code to the card's own page, the rules in one line and how to reach the business.
// Printed on a letter page with cut marks (front and back side by side — fold or glue), or sent to a card printer.
import { bonusWhen } from '@/lib/gift-offers';
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';

const W = 324, H = 204;   // 3.375 × 2.125 in at 96 px per inch
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
export default function PrintGiftCard() {
  const p = useParams<{ tenantId: string; id: string }>(); const k = useSearchParams()?.get('k') || '';
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState(''); const [qr, setQr] = React.useState('');
  React.useEffect(() => { fetch(`/api/gift-cards?tenantId=${encodeURIComponent(String(p?.tenantId || ''))}&id=${encodeURIComponent(String(p?.id || ''))}&k=${encodeURIComponent(k)}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this.')); }, [p, k]);
  React.useEffect(() => { if (!d) return; const url = `${window.location.origin}/gift/${encodeURIComponent(String(p?.tenantId))}/${encodeURIComponent(String(p?.id))}?k=${encodeURIComponent(k)}`;
    import('qrcode').then((m: any) => (m.default || m).toDataURL(url, { margin: 0, width: 240 })).then(setQr).catch(() => {}); }, [d, p, k]);
  if (err) return <p style={{ padding: 24, fontFamily: 'system-ui' }}>{err}</p>;
  if (!d) return <p style={{ padding: 24, fontFamily: 'system-ui', color: '#6d7075' }}>Loading…</p>;
  const c = d.card;
  const mark = (pos: React.CSSProperties) => <span aria-hidden style={{ position: 'absolute', width: 12, height: 12, borderColor: '#999', borderStyle: 'solid', borderWidth: 0, ...pos }} />;
  const cut = (child: React.ReactNode) => (
    <div style={{ position: 'relative', width: W, height: H, margin: 14 }}>
      {mark({ left: -14, top: -1, borderTopWidth: 1 })}{mark({ left: -1, top: -14, borderLeftWidth: 1 })}{mark({ right: -14, top: -1, borderTopWidth: 1 })}{mark({ right: -1, top: -14, borderRightWidth: 1 })}
      {mark({ left: -14, bottom: -1, borderBottomWidth: 1 })}{mark({ left: -1, bottom: -14, borderLeftWidth: 1 })}{mark({ right: -14, bottom: -1, borderBottomWidth: 1 })}{mark({ right: -1, bottom: -14, borderRightWidth: 1 })}
      <div style={{ width: W, height: H, borderRadius: 14, overflow: 'hidden' }}>{child}</div></div>);
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#16171a', padding: 24 }}>
      <style>{`@page { size: letter; margin: 0.5in } @media print { .no-print { display: none !important } body { background: #fff } * { -webkit-print-color-adjust: exact; print-color-adjust: exact } }`}</style>
      <div className="no-print" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => window.print()} style={{ height: 44, padding: '0 22px', borderRadius: 999, border: 0, background: '#16171a', color: '#fff', fontWeight: 600, fontSize: 15 }}>Print</button>
        <span style={{ fontSize: 13.5, color: '#6d7075', maxWidth: 520 }}>Prints at real card size. Turn on “Background graphics” in the print settings. Cut along the marks, then fold or glue front to back — or send this page to a card printer.</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {cut(<GiftCardFace design={c.design} brand={d.brand} amount={c.kind === 'service' ? '1 visit' : money(c.initialCents)} name={c.recipientName} code={c.code} line={c.line || ''} expires={c.expiresAt} width={W} style={{ boxShadow: 'none' }} />)}
        {cut(<div style={{ position: 'relative', width: W, height: H, background: '#fff', border: '1px solid #ececee', borderRadius: 14, boxSizing: 'border-box', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 26, background: '#16171a', margin: '-16px -16px 0' }} />
          <div style={{ display: 'flex', gap: 12 }}>
            {qr ? <img src={qr} alt="" style={{ width: 78, height: 78, flexShrink: 0 }} /> : <div style={{ width: 78, height: 78, background: '#f3f3f5' }} />}
            <div style={{ fontSize: 9.5, lineHeight: 1.45 }}><b style={{ fontSize: 10.5 }}>Scan to see what’s left and book.</b><br /><span style={{ color: '#6d7075' }}>{c.promo ? `A thank-you bonus${c.offerName ? ` (${c.offerName})` : ''}. ${bonusWhen(c)}. Use it at the studio — not for cash.` : d.rules}</span></div>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6d7075' }}><span>{[d.brand?.name, d.brand?.phone, d.site].filter(Boolean).join(' · ')}</span><span style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '.1em', whiteSpace: 'nowrap', marginLeft: 8 }}>{c.code}</span></div>
        </div>)}
      </div>
    </div>);
}
