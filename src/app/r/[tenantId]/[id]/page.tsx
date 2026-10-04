'use client';
// /r/[tenantId]/[id]?k=… — a RECEIPT, or a VOID SLIP once the sale is voided. Printable (the buttons don't print).
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
export default function ReceiptPage() {
  const { tenantId, id } = useParams() as { tenantId: string; id: string };
  const k = useSearchParams().get('k') || '';
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { fetch(`/api/receipts?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This receipt isn’t available.'))).catch(() => setErr('We couldn’t load this receipt.')); }, [tenantId, id, k]);
  if (!d) return <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>{err || 'Loading…'}</main>;
  const { business: b, receipt: r } = d; const tz = b.timezone || undefined;
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const cash = String(r.paymentMethod) === 'cash';
  const row = (l: React.ReactNode, v: React.ReactNode, bold = false) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: bold ? 700 : 400 }}><span>{l}</span><span>{v}</span></div>;
  return (
    <main style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#1c1917', background: '#f7f5f2', minHeight: '100vh', padding: '24px 12px' }}>
      <style>{`@media print { body { background: #fff !important; } .no-print { display: none !important; } main { background: #fff !important; padding: 0 !important; } .paper { box-shadow: none !important; border: none !important; } }`}</style>
      <div className="paper" style={{ maxWidth: 380, margin: '0 auto', background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.08)', position: 'relative', fontSize: 14, lineHeight: 1.5 }}>
        {r.voided && <div aria-hidden style={{ position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', transform: 'rotate(-12deg)', fontSize: 56, fontWeight: 800, color: 'rgba(185,28,28,.18)', letterSpacing: 6 }}>VOIDED</div>}
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{b.name}</div>
          {b.address && <div style={{ color: '#57534e' }}>{b.address}</div>}
          {(b.phone || b.email) && <div style={{ color: '#57534e' }}>{[b.phone, b.email].filter(Boolean).join(' · ')}</div>}
        </div>
        <div style={{ textAlign: 'center', fontWeight: 700, margin: '8px 0' }}>{r.voided ? 'VOID SLIP' : 'RECEIPT'}</div>
        <div style={{ color: '#57534e', marginBottom: 8 }}>
          {row('Sale', when(r.date))}{r.clientName && row('Client', r.clientName)}{r.paidBy && r.paidBy !== r.clientName && row('Paid by', r.paidBy)}{r.cashierName && row('Served by', r.cashierName)}{row('Receipt', `#${String(id).slice(-8).toUpperCase()}`)}
        </div>
        <hr style={{ border: 0, borderTop: '1px dashed #d6d3d1', margin: '8px 0' }} />
        {(r.lineItems || []).map((l: any, i: number) => <div key={i}>{row(<span>{l.label}{l.for ? <span style={{ color: '#78716c' }}> — for {l.for}</span> : null}{l.staff ? <span style={{ color: '#78716c' }}> · {l.staff}</span> : null}</span>, money(l.amount))}</div>)}
        <hr style={{ border: 0, borderTop: '1px dashed #d6d3d1', margin: '8px 0' }} />
        {row('Subtotal', money(r.subtotal))}
        {Array.isArray(r.discounts) && r.discounts.length ? r.discounts.map((d: any, i: number) => <React.Fragment key={i}>{row(d.label, `−${money(d.amount)}`)}</React.Fragment>)
          : Number(r.discount) > 0 && row('Discounts', `−${money(r.discount)}`)}
        {Number(r.tax) > 0 && row(r.taxLabel, money(r.tax))}
        {Number(r.tip) > 0 && row('Tip', money(r.tip))}
        {row('Total', money(r.total), true)}
        {Array.isArray(r.refunds) && r.refunds.map((x: any, i: number) => <React.Fragment key={`rf${i}`}>{row(`Refunded${x.reason ? ` — ${String(x.reason).toLowerCase()}` : ''}`, `−${money(x.cents / 100)}`)}</React.Fragment>)}
        {row('Paid by', cash ? 'Cash' : 'Card')}
        {cash && Number(r.amountTendered) > 0 && <>{row('Cash given', money(r.amountTendered))}{row('Change', money(r.change))}</>}
        {r.voided && <>
          <hr style={{ border: 0, borderTop: '2px solid #1c1917', margin: '12px 0 8px' }} />
          <div style={{ fontWeight: 700 }}>This sale was voided</div>
          {row('Voided', when(r.voidedAt))}
          {r.voidReason && row('Reason', r.voidReason)}
          {r.voidedBy && row('Approved by', r.voidedBy)}
          {r.requestedBy && r.requestedBy !== r.voidedBy && row('Done by', r.requestedBy)}
          {r.refunded && row('Refunded to card', money(r.total), true)}
          {r.cashReturned && <>{row('Cash returned', money(r.cashReturned), true)}
            <div style={{ marginTop: 28 }}><div style={{ borderTop: '1px solid #1c1917', paddingTop: 4, color: '#57534e' }}>Client signature — cash received</div></div>
            <div style={{ marginTop: 28 }}><div style={{ borderTop: '1px solid #1c1917', paddingTop: 4, color: '#57534e' }}>Staff signature — cash handed back</div></div></>}
          {r.refunded && <div style={{ color: '#57534e', marginTop: 6 }}>Refunds usually show within 5–10 business days, depending on the bank.</div>}
        </>}
        <div style={{ textAlign: 'center', color: '#78716c', marginTop: 14 }}>Thank you</div>
      </div>
      <div className="no-print" style={{ maxWidth: 380, margin: '12px auto 0', display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => window.print()} style={{ flex: 1, height: 44, borderRadius: 999, border: 0, background: '#1c1917', color: '#fff', fontWeight: 600 }}>Print</button>
      </div>
    </main>
  );
}
