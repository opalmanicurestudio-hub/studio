// src/components/print/SmartSlip.tsx — THE SMART PACKING SLIP, drawn from lib/order-slip's model. Plain markup and
// one stylesheet, so the same slip renders on the print pages (server) and in the settings preview (browser).
// Sizes: 4 × 6 for a label printer, half-letter or full letter for regular paper. Black on white throughout so it
// prints cleanly on a thermal printer.
import * as React from 'react';
import type { SlipModel, SlipSize } from '@/lib/order-slip';

export const SMART_SLIP_CSS = `
.ss { box-sizing: border-box; background: #fff; color: #000; font-family: 'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; overflow: hidden; }
.ss * { box-sizing: border-box; }
.ss.s4x6 { width: 4in; height: 6in; padding: 0.18in 0.2in; gap: 0.09in; font-size: 10px; }
.ss.s4x6.dense { gap: 0.06in; font-size: 8.6px; } .ss.s4x6.dense .no { font-size: 2.6em; } .ss.s4x6.dense .card { padding: 5px 8px; } .ss.s4x6.dense .foot img { width: 0.65in; height: 0.65in; }
.ss.shalf { width: 5.5in; height: 8.5in; padding: 0.35in 0.4in 0; gap: 0.14in; font-size: 11px; }
.ss.sletter { width: 8.5in; height: 11in; padding: 0.6in 0.7in 0; gap: 0.18in; font-size: 12px; }
.ss .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.ss .shop { font-size: 1em; font-weight: 700; }
.ss .no { font-size: 3em; font-weight: 800; line-height: 1.05; }
.ss.shalf .no, .ss.sletter .no { font-size: 1.1em; font-weight: 600; color: #333; }
.ss .hello { font-size: 2.4em; font-weight: 300; line-height: 1.1; margin-top: 6px; }
.ss .who { font-size: 1.2em; font-weight: 600; }
.ss .badge { border: 2px solid #000; padding: 3px 8px; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.ss .badge span { font-size: 0.8em; font-weight: 800; letter-spacing: .06em; } .ss .badge b { font-size: 1.7em; line-height: 1; font-weight: 800; }
.ss .rule { height: 2px; background: #000; }
.ss .cap { font-size: 0.9em; font-weight: 800; letter-spacing: .08em; }
.ss .items { display: flex; flex-direction: column; gap: 4px; }
.ss .it { display: flex; gap: 8px; align-items: flex-start; font-size: 1.1em; font-weight: 600; }
.ss .it .bx { width: 11px; height: 11px; border: 1.5px solid #000; flex-shrink: 0; margin-top: 2px; }
.ss .it .nm { flex: 1; } .ss .it .sm { font-weight: 500; }
.ss .card { border: 2px solid #000; padding: 7px 10px; display: flex; flex-direction: column; gap: 3px; }
.ss .card.dash { border-style: dashed; }
.ss .card b.t { font-size: 1.1em; font-weight: 800; }
.ss .card p { margin: 0; font-weight: 500; line-height: 1.35; }
.ss .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ss.s4x6 .grid { display: flex; flex-direction: column; gap: 0.08in; }
.ss .msg { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 12px 4px; font-size: 1.45em; font-style: italic; line-height: 1.4; }
.ss .foot { margin-top: auto; display: flex; gap: 12px; align-items: flex-end; }
.ss.shalf .foot, .ss.sletter .foot { margin-top: 0; background: #f2f2f2; padding: 10px; border-radius: 10px; align-items: center; }
.ss .foot img { width: 0.8in; height: 0.8in; flex-shrink: 0; }
.ss .foot b { font-size: 1.1em; font-weight: 800; display: block; }
.ss .foot p { margin: 2px 0 0; font-weight: 500; line-height: 1.35; font-size: 0.95em; }
.ss .tear { margin-top: auto; border-top: 2px dashed #000; padding: 12px 0 0.3in; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.ss .tear b { display: block; font-size: 1.1em; } .ss .tear p { margin: 2px 0 0; line-height: 1.35; } .ss .tear .big { font-size: 1.8em; font-weight: 800; }
`;

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export function SmartSlip({ m, size, shopName, qr, giftQr }: { m: SlipModel; size: SlipSize; shopName: string; qr?: string; giftQr?: string }) {
  const paper = size !== '4x6';
  // A busy order on a 4 × 6 slip tightens up, and the damage note moves into the footer, so everything fits one label.
  const weight = m.notInBox.length + m.swaps.length * 1.5 + m.care.length + (m.useBy.length ? 1 : 0) + m.inBox.length * 0.4 + (m.damage ? 1.2 : 0);
  const dense = !paper && weight > 5;
  const boxBadge = m.boxes > 1 ? <div className="badge"><span>BOXES</span><b>{m.boxes}</b></div> : null;

  if (m.gift) {
    return (
      <div className={`ss s${size}`}>
        <div className="top"><span className="shop">{shopName}</span><span className="shop">{m.orderNo}</span></div>
        <div><div className="who">A gift for</div><div className="hello">{m.gift.to || 'you'}</div></div>
        {m.gift.message ? <div className="msg">“{m.gift.message}”</div> : null}
        <div className="items"><span className="cap">IN THIS BOX</span>{m.inBox.map((l, i) => <div className="it" key={i}><span className="nm">{l.name}</span><span>×{l.qty}</span></div>)}</div>
        {m.boxes > 1 ? <p style={{ margin: 0, fontWeight: 600 }}>This gift comes in {m.boxes} boxes.</p> : null}
        {m.notInBox.some((x) => x.later) && <div className="card"><b className="t">More is on its way</b>{m.notInBox.filter((x) => x.later).map((x, i) => <p key={i}><b>{x.name}</b> is coming separately.</p>)}</div>}
        {m.care.length > 0 && <div className="card"><b className="t">How to use</b>{m.care.map((c, i) => <p key={i}><b>{c.name}:</b> {c.note}</p>)}</div>}
        {m.returns ? <div className="foot">{giftQr ? <img src={giftQr} alt="Gift exchange code" /> : null}<div><b>Gift exchange</b><p>{m.returns}</p></div></div> : null}
      </div>);
  }

  const notes = (
    <>
      {m.notInBox.length > 0 && <div className="card"><b className="t">Not in this box</b>{m.notInBox.map((x, i) => <p key={i}><b>{x.name}{x.qty > 1 ? ` ×${x.qty}` : ''}</b> {x.text}</p>)}</div>}
      {m.swaps.length > 0 && <div className="card"><b className="t">We made a swap</b>{m.swaps.map((x, i) => <p key={i}>You ordered <b>{x.from}</b>. It sold out, so we sent <b>{x.to}</b>, as you agreed. {x.text}</p>)}</div>}
      {m.boxes > 1 && paper && <div className="card"><b className="t">Sent in {m.boxes} boxes</b><p>Each box has its own tracking. Track them all from your order page.</p></div>}
      {m.care.length > 0 && <div className="card"><b className="t">How to use</b>{m.care.map((c, i) => <p key={i}><b>{c.name}:</b> {c.note}</p>)}</div>}
      {m.damage && (paper || !dense) && <div className="card dash"><b className="t">Arrived damaged?</b><p>{m.damage}</p></div>}
    </>);

  return (
    <div className={`ss s${size}${dense ? ' dense' : ''}`}>
      <div className="top">
        <div>
          <div className="shop">{shopName}</div>
          {paper ? <div className="hello">Thanks{m.firstName ? `, ${m.firstName}` : ''}.</div> : null}
          <div className="no">{paper ? `Order ${m.orderNo}${m.packedOn ? ` · packed ${m.packedOn}${m.packedBy ? ` by ${m.packedBy}` : ''}` : ''}` : m.orderNo}</div>
          {!paper ? <div className="who">For {m.customerName}</div> : null}
        </div>
        {boxBadge}
      </div>
      <div className="rule" />
      <div className="items">
        <span className="cap">IN THIS BOX{m.notInBox.length === 0 && m.swaps.length === 0 ? ' · EVERYTHING YOU ORDERED' : ''}</span>
        {m.inBox.map((l, i) => (
          <div className="it" key={i}><span className="bx" /><span className="nm">{l.name}{l.swapFor ? <span className="sm"> (swap)</span> : null}</span><span>×{l.qty}</span>{m.showPrices && l.priceCents != null ? <span style={{ width: '0.8in', textAlign: 'right' }}>{money(l.priceCents)}</span> : null}</div>))}
      </div>
      {paper ? <div className="grid">{notes}</div> : notes}
      {m.useBy.length > 0 && <div className="items"><span className="cap">USE BY</span>{m.useBy.map((u, i) => <div key={i} style={{ fontWeight: 600 }}>{u.name} · {u.text}</div>)}</div>}
      <div className="foot">
        {qr ? <img src={qr} alt="Your order page" /> : null}
        <div><b>Your order page</b><p>{m.boxes > 1 && !paper ? (m.boxes === 2 ? 'Tracking for both boxes' : `Tracking for all ${m.boxes} boxes`) : 'Tracking'}, receipt, {m.returns ? 'returns, ' : ''}reorder and reviews. {m.returns && !paper ? `${m.returns} ` : ''}{dense && m.damage ? `Arrived damaged? ${m.damage} ` : ''}Questions? Reply to your order email.</p></div>
      </div>
      {paper && m.returns ? (
        <div className="tear"><div><b>Returning something?</b><p>{m.returns} Cut off this strip and put it in the box.</p></div><div className="big">{m.orderNo}</div></div>
      ) : null}
    </div>);
}
