// src/components/print/SmartSlip.tsx — THE SMART PACKING SLIP, drawn from lib/order-slip's model, in the app's own
// look: Plus Jakarta Sans, light headings, sentence-case labels, rounded cards, plenty of white. Plain markup and one
// stylesheet, so the same slip renders on the print pages (server) and in the settings preview (browser).
// On a 4 × 6 label printer everything is solid ink (thermal printers can't print grey), with outlined cards; on
// regular paper the app's soft greys, muted text, and product photos come through.
import * as React from 'react';
import type { SlipModel, SlipSize } from '@/lib/order-slip';

export const SMART_SLIP_CSS = `
.ss { box-sizing: border-box; background: #fff; color: #16171a; font-family: 'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ss * { box-sizing: border-box; }
.ss.s4x6 { width: 4in; height: 6in; padding: 0.22in 0.22in 0.2in; gap: 0.12in; font-size: 11px; color: #000; }
.ss.shalf { width: 5.5in; height: 8.5in; padding: 0.36in 0.4in 0; gap: 0.14in; font-size: 11.5px; }
.ss.sletter { width: 8.5in; height: 11in; padding: 0.7in 0.75in 0; gap: 0.26in; font-size: 14px; }
.ss .shop { font-size: 0.95em; font-weight: 600; }
.ss .title { font-size: 2.7em; font-weight: 300; letter-spacing: -0.02em; line-height: 1.1; }
.ss .sub { font-size: 1em; }
.ss.shalf .sub, .ss.sletter .sub { color: #6d7075; }
.ss .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.ss .head > div { display: flex; flex-direction: column; gap: 3px; }
.ss .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 0.85em; font-weight: 600; color: #1f7a4d; background: #eaf6ef; border-radius: 999px; padding: 5px 10px; white-space: nowrap; }
.ss .lbl { font-size: 0.95em; font-weight: 600; margin-bottom: 5px; }
.ss.shalf .lbl, .ss.sletter .lbl { color: #6d7075; }
.ss .list { border: 1.5px solid #000; border-radius: 14px; display: flex; flex-direction: column; }
.ss.shalf .list, .ss.sletter .list { border: 1px solid #ececee; border-radius: 16px; }
.ss .row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; font-size: 1.05em; }
.ss .row + .row { border-top: 1px solid #000; }
.ss.shalf .row, .ss.sletter .row { padding: 10px 16px; font-size: 1.1em; }
.ss.shalf .row + .row, .ss.sletter .row + .row { border-top: 1px solid #ececee; }
.ss .row .ck { width: 14px; height: 14px; border-radius: 7px; border: 1.5px solid #000; flex-shrink: 0; }
.ss .row .ph { width: 0.42in; height: 0.42in; border-radius: 10px; background: #f5f5f7; object-fit: cover; flex-shrink: 0; }
.ss .row .nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ss .row .nm small { font-size: 0.82em; }
.ss.shalf .row .nm small, .ss.sletter .row .nm small, .ss .row .pr { color: #6d7075; }
.ss .row .q { font-weight: 600; }
.ss .card { border: 1.5px solid #000; border-radius: 14px; padding: 8px 12px; display: flex; gap: 10px; align-items: flex-start; }
.ss.shalf .card, .ss.sletter .card { border: none; background: #f5f5f7; border-radius: 16px; padding: 13px 16px; }
.ss .card svg { flex-shrink: 0; margin-top: 1px; }
.ss .card div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ss .card b { font-size: 1.05em; font-weight: 600; }
.ss .card p { margin: 0; line-height: 1.42; }
.ss.shalf .card p, .ss.sletter .card p { color: #45474c; }
.ss .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ss.s4x6 .grid { display: flex; flex-direction: column; gap: 0.1in; }
.ss .note { font-size: 1.25em; font-weight: 300; line-height: 1.45; }
.ss .msg { border: 1.5px solid #000; border-radius: 18px; padding: 14px 16px; font-size: 1.45em; font-weight: 300; line-height: 1.5; }
.ss.shalf .msg, .ss.sletter .msg { border: none; background: #f5f5f7; }
.ss .foot { margin-top: auto; display: flex; gap: 12px; align-items: center; }
.ss.shalf .foot, .ss.sletter .foot { margin-top: 0; border: 1px solid #ececee; border-radius: 16px; padding: 13px 16px; }
.ss .foot img { width: 0.7in; height: 0.7in; flex-shrink: 0; }
.ss.shalf .foot img, .ss.sletter .foot img { width: 0.8in; height: 0.8in; }
.ss .foot b { display: block; font-size: 1.05em; font-weight: 600; }
.ss .foot p { margin: 2px 0 0; line-height: 1.42; font-size: 0.95em; }
.ss.shalf .foot p, .ss.sletter .foot p { color: #6d7075; }
.ss .useby { display: flex; flex-direction: column; gap: 3px; }
.ss .tear { margin-top: auto; border-top: 1.5px dashed #c9cacd; padding: 14px 0 0.32in; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.ss .tear b { display: block; font-weight: 600; } .ss .tear p { margin: 2px 0 0; color: #6d7075; line-height: 1.4; font-size: 0.92em; }
.ss .tear .big { font-size: 1.9em; font-weight: 300; letter-spacing: -0.01em; }
.ss.s4x6.dense { gap: 0.08in; font-size: 9.6px; } .ss.s4x6.dense .title { font-size: 2.4em; } .ss.s4x6.dense .card { padding: 6px 10px; } .ss.s4x6.dense .row { padding: 5px 10px; } .ss.s4x6.dense .foot img { width: 0.6in; height: 0.6in; }
`;

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const Icon = ({ d }: { d: React.ReactNode }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const I = {
  later: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  swap: <path d="M7 7h11l-3-3M17 17H6l3 3" />,
  boxes: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /></>,
  care: <path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" />,
  damage: <><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4M12 17v.5" /></>,
};
function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className="card"><Icon d={icon} /><div><b>{title}</b>{children}</div></div>;
}

export function SmartSlip({ m, size, shopName, qr, giftQr }: { m: SlipModel; size: SlipSize; shopName: string; qr?: string; giftQr?: string }) {
  const paper = size !== '4x6';
  const weight = m.notInBox.length + m.swaps.length * 1.5 + m.care.length + (m.useBy.length ? 1 : 0) + m.inBox.length * 0.45 + (m.damage ? 1.2 : 0);
  // A busy order on a 4 × 6 slip tightens up, and the damage note moves into the footer, so everything fits one label.
  const dense = !paper && weight > 5;
  const boxLine = m.boxes > 1 ? `${m.boxes} boxes` : '';

  if (m.gift) {
    return (
      <div className={`ss s${size}`}>
        <span className="shop">{shopName}</span>
        <div className="head"><div><span className="sub">A gift for</span><span className="title" style={{ fontSize: '3.4em' }}>{m.gift.to || 'you'}</span></div></div>
        {m.gift.message ? <div className="msg">“{m.gift.message}”</div> : null}
        <div><div className="lbl">In this box</div><div className="list">{m.inBox.map((l, i) => <div className="row" key={i}><span className="nm">{l.name}</span><span className="q">{l.qty}</span></div>)}</div></div>
        {m.notInBox.some((x) => x.later) && <Card icon={I.later} title="More is on its way">{m.notInBox.filter((x) => x.later).map((x, i) => <p key={i}>{x.name} is coming separately.</p>)}</Card>}
        {m.boxes > 1 ? <p style={{ margin: 0 }}>This gift comes in {m.boxes} boxes.</p> : null}
        {m.care.length > 0 && <Card icon={I.care} title="How to use">{m.care.map((c, i) => <p key={i}>{c.name}: {c.note}</p>)}</Card>}
        {m.returns ? <div className="foot">{giftQr ? <img src={giftQr} alt="Gift exchange code" /> : null}<div><b>Gift exchange</b><p>{m.returns}</p></div></div> : null}
      </div>);
  }

  const cards = (
    <>
      {m.notInBox.length > 0 && <Card icon={I.later} title={m.notInBox.every((x) => x.later) ? 'Still to come' : 'Not in this box'}>{m.notInBox.map((x, i) => <p key={i}>{x.name}{x.qty > 1 ? ` ×${x.qty}` : ''} {x.text}</p>)}</Card>}
      {m.swaps.length > 0 && <Card icon={I.swap} title="We made a swap">{m.swaps.map((x, i) => <p key={i}>{x.from} sold out, so we sent {x.to}, as you agreed. {x.text}</p>)}</Card>}
      {m.boxes > 1 && paper && <Card icon={I.boxes} title={`Sent in ${m.boxes} boxes`}><p>Each box has its own tracking. Track them all from your order page.</p></Card>}
      {m.care.length > 0 && <Card icon={I.care} title="How to use">{m.care.map((c, i) => <p key={i}>{c.name}: {c.note}</p>)}</Card>}
      {m.damage && !paper && !dense && <Card icon={I.damage} title="Arrived damaged?"><p>{m.damage}</p></Card>}
    </>);

  const track = m.boxes === 2 ? 'Tracking for both boxes' : m.boxes > 2 ? `Tracking for all ${m.boxes} boxes` : 'Tracking';
  const footText = `${track}, receipt, ${m.returns ? 'returns, ' : ''}reorder and reviews.${paper && m.damage ? ` Arrived damaged? ${m.damage}` : ''}${!paper && m.returns ? ` ${m.returns}` : ''}${dense && m.damage ? ` Arrived damaged? ${m.damage}` : ''} Questions? Reply to your order email.`;

  return (
    <div className={`ss s${size}${dense ? ' dense' : ''}`}>
      <div className="head">
        <div>
          <span className="shop">{shopName}</span>
          <span className="title">Thanks{m.firstName ? `, ${m.firstName}` : ''}.</span>
          <span className="sub">{[`Order ${m.orderNo}`, paper && m.packedOn ? `packed ${m.packedOn}${m.packedBy ? ` by ${m.packedBy}` : ''}` : '', boxLine].filter(Boolean).join(' · ')}</span>
        </div>
        {paper && m.notInBox.length === 0 && m.swaps.length === 0 ? <span className="pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>Everything you ordered</span> : null}
      </div>
      <div>
        <div className="lbl">In this box</div>
        <div className="list">
          {m.inBox.map((l, i) => (
            <div className="row" key={i}>
              {paper ? (l.imageUrl ? <img className="ph" src={l.imageUrl} alt="" /> : <span className="ph" />) : <span className="ck" />}
              <span className="nm">{l.name}{l.swapFor && paper ? <small>Sent instead of {l.swapFor}</small> : null}</span>
              {m.showPrices && l.priceCents != null ? <span className="pr">{money(l.priceCents)}</span> : null}
              <span className="q">{l.qty}</span>
            </div>))}
        </div>
      </div>
      {paper ? <div className="grid">{cards}</div> : cards}
      {m.useBy.length > 0 && <div className="useby"><div className="lbl" style={{ marginBottom: 0 }}>Use by</div>{m.useBy.map((u, i) => <span key={i}>{u.name} · {u.text}</span>)}</div>}
      <div className="foot">
        {qr ? <img src={qr} alt="Your order page" /> : null}
        <div><b>Your order page</b><p>{footText}</p></div>
      </div>
      {paper && m.returns ? (
        <div className="tear"><div><b>Returning something?</b><p>{m.returns} Put this strip in the box.</p></div><div className="big">{m.orderNo}</div></div>
      ) : null}
    </div>);
}
