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
        {r.detail ? (() => {
          // The full receipt: every line and who did it, fees by reason, each discount, what was already paid, the tax,
          // each provider's share of the tip, every payment and the card used, and what's left on an account.
          const D = r.detail; const sub = (t: React.ReactNode) => <div style={{ color: '#78716c', fontSize: 12, marginTop: -2 }}>{t}</div>;
          const card = (x: any) => x.method === 'cash' ? 'Cash' : x.brand ? `${String(x.brand).replace(/^\w/, (c: string) => c.toUpperCase())} ••${x.last4 || ''}${x.wallet ? ` (${String(x.wallet).split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')})` : ''}` : x.method === 'card' || x.method === 'card_on_file' || x.method === 'terminal' ? 'Card' : String(x.method || 'Payment').replace(/_/g, ' ');
          return (<>
            {(D.lines || []).map((l: any, i: number) => (
              <div key={i} style={{ marginBottom: 4 }}>
                {l.kind === 'note' ? <div style={{ color: '#78716c', fontStyle: 'italic' }}>{l.label}</div>
                  : row(<span>{l.kind === 'addon' ? '+ ' : ''}{l.label}{l.qty > 1 ? <span style={{ color: '#78716c' }}> · {l.qty} × {money(l.unit)}</span> : null}</span>, l.redeemed ? 'Included' : money(l.amount))}
                {[l.staff && (l.bookedWith ? `Done by ${l.staff} (booked with ${l.bookedWith})` : `With ${l.staff}`), l.soldBy && `Sold by ${l.soldBy}`, l.for && `For ${l.for}`,
                  l.collectedFor && `Collected for ${l.collectedFor} (independent provider)`, l.redeemed && 'From their package or membership'].filter(Boolean).length > 0
                  && sub([l.staff && (l.bookedWith ? `Done by ${l.staff} (booked with ${l.bookedWith})` : `With ${l.staff}`), l.soldBy && `Sold by ${l.soldBy}`, l.for && `For ${l.for}`,
                    l.collectedFor && `Collected for ${l.collectedFor} (independent provider)`, l.redeemed && 'From their package or membership'].filter(Boolean).join(' · '))}
              </div>))}
            {(D.fees || []).length > 0 && <>
              <div style={{ fontWeight: 600, marginTop: 8 }}>Fees paid</div>
              {D.fees.map((f: any, i: number) => <div key={`f${i}`}>{row(<span>{f.label}{f.date ? <span style={{ color: '#78716c' }}> · {/^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) ? new Date(`${f.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : new Date(f.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })}</span> : null}{f.for ? <span style={{ color: '#78716c' }}> · for {f.for}</span> : null}</span>, money(f.amount))}</div>)}
            </>}
            <hr style={{ border: 0, borderTop: '1px dashed #d6d3d1', margin: '8px 0' }} />
            {row('Subtotal', money(r.subtotal))}
            {Array.isArray(r.discounts) && r.discounts.length ? r.discounts.map((d: any, i: number) => <React.Fragment key={i}>{row(d.label, `−${money(d.amount)}`)}</React.Fragment>) : Number(r.discount) > 0 && row('Discounts', `−${money(r.discount)}`)}
            {Number(r.tax) > 0 && row(r.taxLabel || 'Tax', money(r.tax))}
            {Number(D.cardSurcharge) > 0 && row('Card fee', money(D.cardSurcharge))}
            {Number(r.tip) > 0 && row('Tip', money(r.tip))}
            {Number(r.tip) > 0 && (D.tipShares || []).length > 0 && D.tipShares.map((t: any, i: number) => <div key={`t${i}`} style={{ paddingLeft: 12, color: '#57534e' }}>{row(t.name, money(t.amount))}</div>)}
            {Number(D.depositUsed) > 0 && row('Deposit already paid', `−${money(D.depositUsed)}`)}
            {Number(D.storeCredit) > 0 && row('Store credit used', `−${money(D.storeCredit)}`)}
            {row('Total', money(r.total), true)}
            {Array.isArray(r.refunds) && r.refunds.map((x: any, i: number) => <React.Fragment key={`rf${i}`}>{row(`Refunded${x.reason ? ` — ${String(x.reason).toLowerCase()}` : ''}`, `−${money(x.cents / 100)}`)}</React.Fragment>)}
            <hr style={{ border: 0, borderTop: '1px dashed #d6d3d1', margin: '8px 0' }} />
            <div style={{ fontWeight: 600 }}>{(D.payments || []).length > 1 ? 'Payments' : 'Payment'}</div>
            {(D.payments || []).map((x: any, i: number) => <div key={`p${i}`}>{row(<span>{card(x)}{x.payer ? <span style={{ color: '#78716c' }}> · {x.payer}</span> : null}</span>, money(Number(x.amount) + Number(x.tip || 0)))}</div>)}
            {cash && Number(r.amountTendered) > 0 && <>{row('Cash given', money(r.amountTendered))}{row('Change', money(r.change))}</>}
            {(D.accounts || []).length > 0 && <>
              <hr style={{ border: 0, borderTop: '1px dashed #d6d3d1', margin: '8px 0' }} />
              {D.accounts.map((a: any, i: number) => <div key={`a${i}`}>{row(a.kind === 'rent' ? `Rent — ${a.name}` : `Tuition — ${a.name}${a.program ? ` (${a.program})` : ''}`,
                a.kind === 'rent' ? (Number(a.owedAfterCents) > 0 ? `Still owed ${money(a.owedAfterCents / 100)}` : Number(a.creditCents) > 0 ? `${money(a.creditCents / 100)} paid ahead` : 'All paid up')
                  : Number(a.remainingCents) > 0 ? `Remaining ${money(a.remainingCents / 100)}` : 'Paid in full')}</div>)}
            </>}
          </>);
        })() : (<>
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
        </>)}
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
