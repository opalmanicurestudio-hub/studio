'use client';
// /r/[tenantId]/[id]?k=… — a RECEIPT, or a VOID SLIP once the sale is voided. Printable (the buttons don't print).
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { designsSync } from '@/lib/gift-designs';
import { PRINT_FONT_STACK } from '@/lib/print-style';

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;

// The paper, in the app's print look (lib/print-style): Plus Jakarta Sans, a light heading, labels in grey, thin lines,
// a soft panel for rewards and a soft red one when the sale was voided. On a narrow receipt printer it turns to solid
// black ink with outlined panels, because thermal paper can't print grey.
const RC_CSS = `
.rc { position: relative; max-width: 380px; margin: 0 auto; padding: 22px 20px 20px; background: #fff; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
  font-family: ${PRINT_FONT_STACK}; color: #16171a; font-size: 13.5px; line-height: 1.5; font-weight: 400; font-variant-numeric: tabular-nums;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rc-top { text-align: center; margin-bottom: 10px; }
.rc-shop { font-size: 15px; font-weight: 600; }
.rc-contact { font-size: 12px; color: #6d7075; }
.rc-title { text-align: center; font-size: 24px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.2; margin: 6px 0 12px; }
.rc-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.rc-row > :last-child { text-align: right; }
.rc-meta { font-size: 12.5px; color: #45474c; }
.rc-meta .rc-row > :first-child { color: #6d7075; }
.rc-rule { border: 0; border-top: 1px solid #ececee; margin: 10px 0; }
.rc-line { margin-bottom: 5px; }
.rc-sub, .rc-note, .rc-dim, .rc-share { color: #6d7075; }
.rc-sub { font-size: 12px; }
.rc-share { padding-left: 12px; font-size: 12.5px; }
.rc-lbl { font-size: 12px; font-weight: 500; color: #6d7075; margin-bottom: 2px; }
.rc-line + .rc-lbl { margin-top: 10px; }
.rc-strong { font-weight: 600; }
.rc-total { margin-top: 6px; padding-top: 7px; border-top: 1px solid #16171a; font-size: 15px; font-weight: 600; }
.rc-warn { color: #b45309; }
.rc-panel, .rc-void { margin-top: 14px; padding: 12px 14px; border-radius: 14px; background: #f5f5f7; }
.rc-void { background: #fdecea; }
.rc-head { font-weight: 600; margin-bottom: 2px; }
.rc-void .rc-head { color: #b42318; }
.rc-link { display: inline-block; margin-top: 6px; font-weight: 600; color: #16171a; }
.rc-fine { margin-top: 6px; font-size: 12px; color: #6d7075; }
.rc-sign { margin-top: 30px; padding-top: 4px; border-top: 1px solid #16171a; font-size: 12px; color: #6d7075; }
.rc-thanks { text-align: center; color: #6d7075; margin-top: 16px; }
.rc-mark { position: absolute; top: 72px; left: 0; right: 0; text-align: center; transform: rotate(-12deg); font-size: 60px; font-weight: 300; letter-spacing: -0.02em; color: rgba(180, 35, 24, .16); pointer-events: none; }
@media print {
  body { background: #fff !important; } .no-print { display: none !important; } main { background: #fff !important; padding: 0 !important; }
  .rc { box-shadow: none; border-radius: 0; }
}
@media print and (max-width: 90mm) {
  .rc { max-width: none; padding: 0; color: #000; font-size: 12.5px; }
  .rc :is(.rc-contact, .rc-meta, .rc-sub, .rc-note, .rc-dim, .rc-share, .rc-lbl, .rc-warn, .rc-fine, .rc-sign, .rc-thanks, .rc-head) { color: #000; }
  .rc .rc-meta .rc-row > :first-child, .rc .rc-void .rc-head { color: #000; }
  .rc .rc-rule { border-top: 1px dashed #000; }
  .rc .rc-total, .rc .rc-sign { border-top-color: #000; }
  .rc .rc-panel, .rc .rc-void { background: none; border: 1px solid #000; border-radius: 10px; }
  .rc .rc-mark { position: static; transform: none; font-size: 32px; color: #000; margin-bottom: 6px; }
}
`;
export default function ReceiptPage() {
  const { tenantId, id } = useParams() as { tenantId: string; id: string };
  const k = useSearchParams().get('k') || '';
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { fetch(`/api/receipts?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This receipt isn’t available.'))).catch(() => setErr('We couldn’t load this receipt.')); }, [tenantId, id, k]);
  // "Give one to a friend" — when the business sells gift cards online (lib/gift-shop). Never printed.
  const [gift, setGift] = React.useState<any>(null);
  React.useEffect(() => { fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((x) => setGift(x?.ok && x.open ? x : null)).catch(() => {}); }, [tenantId]);
  if (!d) return <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>{err || 'Loading…'}</main>;
  const { business: b, receipt: r } = d; const tz = b.timezone || undefined;
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const cash = String(r.paymentMethod) === 'cash';
  const row = (l: React.ReactNode, v: React.ReactNode, cls = '') => <div className={cls ? `rc-row ${cls}` : 'rc-row'}><span>{l}</span><span>{v}</span></div>;
  return (
    <main style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#1c1917', background: '#f7f5f2', minHeight: '100vh', padding: '24px 12px' }}>
      <style>{RC_CSS}</style>
      <div className="rc cf-paper">
        {r.voided && <div aria-hidden className="rc-mark">Voided</div>}
        <div className="rc-top">
          <div className="rc-shop">{b.name}</div>
          {b.address && <div className="rc-contact">{b.address}</div>}
          {(b.phone || b.email) && <div className="rc-contact">{[b.phone, b.email].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="rc-title">{r.voided ? 'Void slip' : 'Receipt'}</div>
        <div className="rc-meta">
          {row('Sale', when(r.date))}{r.clientName && row('Client', r.clientName)}{r.paidBy && r.paidBy !== r.clientName && row('Paid by', r.paidBy)}{r.cashierName && row('Served by', r.cashierName)}{row('Receipt', `#${String(id).slice(-8).toUpperCase()}`)}
        </div>
        <hr className="rc-rule" />
        {r.detail ? (() => {
          // The full receipt: every line and who did it, fees by reason, each discount, what was already paid, the tax,
          // each provider's share of the tip, every payment and the card used, and what's left on an account.
          const D = r.detail; const sub = (t: React.ReactNode) => <div className="rc-sub">{t}</div>;
          const card = (x: any) => x.method === 'cash' ? 'Cash' : x.brand ? `${String(x.brand).replace(/^\w/, (c: string) => c.toUpperCase())} ••${x.last4 || ''}${x.wallet ? ` (${String(x.wallet).split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')})` : ''}` : x.method === 'card' || x.method === 'card_on_file' || x.method === 'terminal' ? 'Card' : String(x.method || 'Payment').replace(/_/g, ' ');
          return (<>
            {(D.lines || []).map((l: any, i: number) => (
              <div key={i} className="rc-line">
                {l.kind === 'note' ? <div className="rc-note">{l.label}</div>
                  : row(<span>{l.kind === 'addon' ? '+ ' : ''}{l.label}{l.qty > 1 ? <span className="rc-dim"> · {l.qty} × {money(l.unit)}</span> : null}</span>, l.redeemed ? 'Included' : money(l.amount))}
                {[l.staff && (l.bookedWith ? `Done by ${l.staff} (booked with ${l.bookedWith})` : `With ${l.staff}`), l.soldBy && `Sold by ${l.soldBy}`, l.for && `For ${l.for}`,
                  l.collectedFor && `Collected for ${l.collectedFor} (independent provider)`, l.redeemed && 'From their package or membership'].filter(Boolean).length > 0
                  && sub([l.staff && (l.bookedWith ? `Done by ${l.staff} (booked with ${l.bookedWith})` : `With ${l.staff}`), l.soldBy && `Sold by ${l.soldBy}`, l.for && `For ${l.for}`,
                    l.collectedFor && `Collected for ${l.collectedFor} (independent provider)`, l.redeemed && 'From their package or membership'].filter(Boolean).join(' · '))}
              </div>))}
            {(D.fees || []).length > 0 && <>
              <div className="rc-lbl">Fees paid</div>
              {D.fees.map((f: any, i: number) => <div key={`f${i}`}>{row(<span>{f.label}{f.date ? <span className="rc-dim"> · {/^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) ? new Date(`${f.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : new Date(f.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })}</span> : null}{f.for ? <span className="rc-dim"> · for {f.for}</span> : null}</span>, money(f.amount))}</div>)}
            </>}
            <hr className="rc-rule" />
            {row('Subtotal', money(r.subtotal))}
            {Array.isArray(r.discounts) && r.discounts.length ? r.discounts.map((d: any, i: number) => <React.Fragment key={i}>{row(d.label, `−${money(d.amount)}`)}</React.Fragment>) : Number(r.discount) > 0 && row('Discounts', `−${money(r.discount)}`)}
            {Number(r.tax) > 0 && row(r.taxLabel || 'Tax', money(r.tax))}
            {Number(D.cardSurcharge) > 0 && row('Card fee', money(D.cardSurcharge))}
            {Number(r.tip) > 0 && row('Tip', money(r.tip))}
            {Number(r.tip) > 0 && (D.tipShares || []).length > 0 && D.tipShares.map((t: any, i: number) => <div key={`t${i}`} className="rc-share">{row(t.name, money(t.amount))}</div>)}
            {Number(D.depositUsed) > 0 && row('Deposit already paid', `−${money(D.depositUsed)}`)}
            {Number(D.storeCredit) > 0 && row('Store credit used', `−${money(D.storeCredit)}`)}
            {row('Total', money(r.total), 'rc-total')}
            {Array.isArray(r.refunds) && r.refunds.map((x: any, i: number) => <React.Fragment key={`rf${i}`}>{row(`Refunded${x.reason ? ` — ${String(x.reason).toLowerCase()}` : ''}`, `−${money(x.cents / 100)}`, 'rc-warn')}</React.Fragment>)}
            <hr className="rc-rule" />
            <div className="rc-lbl">{(D.payments || []).length > 1 ? 'Payments' : 'Payment'}</div>
            {(D.payments || []).map((x: any, i: number) => <div key={`p${i}`}>{row(<span>{card(x)}{x.payer ? <span className="rc-dim"> · {x.payer}</span> : null}</span>, money(Number(x.amount) + Number(x.tip || 0)))}</div>)}
            {cash && Number(r.amountTendered) > 0 && <>{row('Cash given', money(r.amountTendered))}{row('Change', money(r.change))}</>}
            {(D.accounts || []).length > 0 && <>
              <hr className="rc-rule" />
              {D.accounts.map((a: any, i: number) => <div key={`a${i}`}>{row(a.kind === 'rent' ? `Rent — ${a.name}` : `Tuition — ${a.name}${a.program ? ` (${a.program})` : ''}`,
                a.kind === 'rent' ? (Number(a.owedAfterCents) > 0 ? `Still owed ${money(a.owedAfterCents / 100)}` : Number(a.creditCents) > 0 ? `${money(a.creditCents / 100)} paid ahead` : 'All paid up')
                  : Number(a.remainingCents) > 0 ? `Remaining ${money(a.remainingCents / 100)}` : 'Paid in full')}</div>)}
            </>}
          </>);
        })() : (<>
        {(r.lineItems || []).map((l: any, i: number) => <div key={i}>{row(<span>{l.label}{l.for ? <span className="rc-dim"> — for {l.for}</span> : null}{l.staff ? <span className="rc-dim"> · {l.staff}</span> : null}</span>, money(l.amount))}</div>)}
        <hr className="rc-rule" />
        {row('Subtotal', money(r.subtotal))}
        {Array.isArray(r.discounts) && r.discounts.length ? r.discounts.map((d: any, i: number) => <React.Fragment key={i}>{row(d.label, `−${money(d.amount)}`)}</React.Fragment>)
          : Number(r.discount) > 0 && row('Discounts', `−${money(r.discount)}`)}
        {Number(r.tax) > 0 && row(r.taxLabel, money(r.tax))}
        {Number(r.tip) > 0 && row('Tip', money(r.tip))}
        {row('Total', money(r.total), 'rc-total')}
        {Array.isArray(r.refunds) && r.refunds.map((x: any, i: number) => <React.Fragment key={`rf${i}`}>{row(`Refunded${x.reason ? ` — ${String(x.reason).toLowerCase()}` : ''}`, `−${money(x.cents / 100)}`, 'rc-warn')}</React.Fragment>)}
        {row('Paid by', cash ? 'Cash' : 'Card')}
        {cash && Number(r.amountTendered) > 0 && <>{row('Cash given', money(r.amountTendered))}{row('Change', money(r.change))}</>}
        </>)}
        {d?.loyalty && (d.loyalty.earned > 0 || d.loyalty.used > 0) && <div className="rc-panel">
          <div className="rc-head">Rewards</div>
          {d.loyalty.earned > 0 && row(`Earned this visit`, `+${d.loyalty.earned} ${d.loyalty.unit}`)}
          {d.loyalty.used > 0 && row(`Used`, `−${d.loyalty.used} ${d.loyalty.unit}`)}
          {row('Your balance', `${d.loyalty.balance} ${d.loyalty.unit}`, 'rc-strong')}
          <a className="no-print rc-link" href={d.loyalty.url}>See your rewards</a></div>}
        {r.voided && <>
          <div className="rc-void">
            <div className="rc-head">This sale was voided</div>
            {row('Voided', when(r.voidedAt))}
            {r.voidReason && row('Reason', r.voidReason)}
            {r.voidedBy && row('Approved by', r.voidedBy)}
            {r.requestedBy && r.requestedBy !== r.voidedBy && row('Done by', r.requestedBy)}
            {r.refunded && row('Refunded to card', money(r.total), 'rc-strong')}
            {r.cashReturned ? row('Cash returned', money(r.cashReturned), 'rc-strong') : null}
            {r.refunded && <div className="rc-fine">Refunds usually show within 5–10 business days, depending on the bank.</div>}
          </div>
          {r.cashReturned ? <>
            <div className="rc-sign">Client signature — cash received</div>
            <div className="rc-sign">Staff signature — cash handed back</div></> : null}
        </>}
        <div className="rc-thanks">Thank you</div>
      </div>
      <div className="no-print" style={{ maxWidth: 380, margin: '12px auto 0', display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => window.print()} style={{ flex: 1, height: 44, borderRadius: 999, border: 0, background: '#1c1917', color: '#fff', fontWeight: 600 }}>Print</button>
      </div>
      {gift && !r.voided && (() => { const ds = designsSync().filter((x) => gift.designs.includes(x.id)); const pick = ds.find((x) => x.id === 'o-thanks') || ds.find((x) => x.collection !== 'Occasions') || ds[0]; return pick ? (
        <a href={`/gift/${encodeURIComponent(tenantId)}`} className="no-print" style={{ maxWidth: 380, margin: '14px auto 0', display: 'flex', gap: 14, alignItems: 'center', background: '#fff', borderRadius: 16, padding: 14, border: '1px solid #ece6df', textDecoration: 'none', color: '#1c1917' }}>
          <GiftCardFace design={pick} brand={gift.brand} amount={`$${gift.amounts?.[1] || 50}`} name="A friend" width={128} />
          <span style={{ fontSize: 14, lineHeight: 1.45 }}><b>Give one to a friend</b><br /><span style={{ color: '#78716c' }}>A gift card, sent by text or email — now or on the day.</span></span></a>) : null; })()}
    </main>
  );
}
