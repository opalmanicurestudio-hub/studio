import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { toteOf } from '@/lib/totes';
import { methodWords } from '@/lib/order-method';
import { orderTags } from '@/lib/order-tags';
import { effectiveUnitCents, taxShareCents } from '@/lib/restocking';
import { PRINT_FONT_STACK } from '@/lib/print-style';

// src/components/print/slip.tsx — ONE PACKING SLIP for an order picked up at the shop: the staff half above the cut
// line and the tear-off customer card below it. Shared by the single-slip page and the bulk print page so a slip looks
// the same either way. In the app's own print look (lib/print-style, like the smart slip for shipped orders): light
// headings, sentence-case labels in grey, thin lines, a soft card for the customer. Scoped under .ps, so it sits beside
// the smart slip (.ss) on the bulk page without either restyling the other.

export const SLIP_CSS = `
          @page { size: letter; margin: 0.5in; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #fff; }
          .ps { font-family: ${PRINT_FONT_STACK}; color: #16171a; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .ps p { margin: 0; }
          .ps .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid #ececee; }
          .ps .shop { font-size: 13px; font-weight: 600; }
          .ps .title { font-size: 26px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.15; margin-top: 2px; }
          .ps .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
          .ps .pill { display: inline-flex; align-items: center; font-size: 11px; font-weight: 500; border-radius: 999px; padding: 3px 10px; background: #f5f5f7; color: #45474c; white-space: nowrap; }
          .ps .pill.ok { background: #eaf6ef; color: #1f7a4d; } .ps .pill.warn { background: #fdf3e7; color: #b45309; }
          .ps .num { font-size: 26px; font-weight: 300; letter-spacing: -0.02em; text-align: right; font-variant-numeric: tabular-nums; }
          .ps .num small { display: block; font-size: 11px; color: #6d7075; font-weight: 400; letter-spacing: 0; }
          .ps .slots { display: flex; gap: 6px; margin-top: 10px; }
          .ps .slot { display: inline-flex; padding: 4px 12px; border: 1px solid #16171a; border-radius: 10px; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
          .ps .slot.tote { border-style: dashed; }
          .ps .meta { display: flex; flex-wrap: wrap; gap: 12px 28px; padding: 14px 0; border-bottom: 1px solid #ececee; }
          .ps .lbl { font-size: 11px; font-weight: 500; color: #6d7075; margin-bottom: 2px; }
          .ps .note { margin-top: 12px; padding: 9px 12px; border-radius: 12px; background: #f5f5f7; font-size: 12.5px; }
          .ps .note b { font-weight: 600; }
          .ps .val { font-size: 13px; font-weight: 500; }
          .ps table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          .ps th { text-align: left; font-size: 11px; font-weight: 500; color: #6d7075; padding: 8px 6px; border-bottom: 1px solid #ececee; }
          .ps td { font-size: 13px; padding: 10px 6px; border-bottom: 1px solid #ececee; vertical-align: top; font-variant-numeric: tabular-nums; }
          .ps .box { display: inline-block; width: 14px; height: 14px; border: 1px solid #9a9ca1; border-radius: 4px; vertical-align: middle; }
          .ps .box.done { background: #16171a; border-color: #16171a; }
          .ps .muted { color: #6d7075; }
          .ps .flag { display: block; margin-top: 3px; font-size: 11.5px; color: #b45309; }
          .ps .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 20px; }
          .ps .qr { width: 132px; height: 132px; border-radius: 14px; border: 1px solid #ececee; padding: 6px; display: block; }
          .ps .qr-note { font-size: 11px; color: #6d7075; margin-top: 6px; max-width: 150px; }
          .ps .totals { min-width: 230px; }
          .ps .totals .line { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; font-size: 12.5px; font-variant-numeric: tabular-nums; }
          .ps .totals .grand { border-top: 1px solid #16171a; margin-top: 6px; padding-top: 7px; font-size: 15px; font-weight: 600; }
          .ps .cut { margin: 26px 0 0; border-top: 1.5px dashed #c9cacd; position: relative; }
          .ps .cut span { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 10px; font-size: 11px; color: #9a9ca1; }
          .ps .card { background: #f5f5f7; border-radius: 16px; padding: 16px 18px; margin-top: 18px; display: flex; gap: 18px; align-items: flex-start; }
          .ps .card .body { flex: 1; min-width: 0; }
          .ps .card h2 { font-size: 18px; font-weight: 300; letter-spacing: -0.01em; margin: 0 0 4px; }
          .ps .card h2 b { font-weight: 600; }
          .ps .card .lede { font-size: 12px; color: #45474c; margin: 0 0 10px; line-height: 1.55; }
          .ps .card .why { font-size: 12px; font-weight: 600; margin: 12px 0 4px; }
          .ps .card ul { margin: 0; padding-left: 16px; }
          .ps .card li { font-size: 12px; color: #45474c; line-height: 1.6; }
          .ps .card .contact { font-size: 12px; margin: 10px 0 0; }
          .ps .cqr { width: 116px; height: 116px; border-radius: 12px; background: #fff; padding: 6px; display: block; }
          .ps .cqr-note { font-size: 11px; color: #6d7075; margin: 5px 0 0; text-align: center; width: 116px; line-height: 1.4; }
          .ps .short-box { background: #fff; border-radius: 12px; padding: 10px 12px; margin: 10px 0 0; border: 1px solid #f1dcc2; }
          .ps .short-box .t { font-size: 12px; font-weight: 600; color: #b45309; margin-bottom: 4px; }
          .ps .short-box p { font-size: 12px; color: #45474c; line-height: 1.55; }
          @media print { .noprint { display: none; } .ps .card, .ps .short-box { break-inside: avoid; } .ps tr { break-inside: avoid; } }
        `;

const money = (c: number) => `$${(Math.round(Number(c) || 0) / 100).toFixed(2)}`;

export async function printOrigin(): Promise<string> {
  const hdrs = await headers();
  const envOrigin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || '';
  const proto = hdrs.get('x-forwarded-proto') || 'https';
  return envOrigin || (host ? `${proto}://${host}` : '');
}

export async function SlipSheet({ tenantId, orderId, order, tenant, origin }: { tenantId: string; orderId: string; order: any; tenant: any; origin: string }) {
  const shopName = tenant.businessName || tenant.name || 'Shop';
  const qrDataUrl = await QRCode.toDataURL(`clarityflow://order/${order.qrToken}`, { width: 320, margin: 1 });
  const num = `#${String(order.orderNumber).padStart(4, '0')}`;

  const orderUrl = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';
  const customerQr = orderUrl ? await QRCode.toDataURL(orderUrl, { width: 360, margin: 1 }) : '';

  const retailSettings = tenant.retailSettings || {};
  const returnDays = Math.max(1, Math.floor(Number(retailSettings.returnWindowDays) || 30));
  const contactBits = [tenant.phone, tenant.email, tenant.website].filter(Boolean).map(String);
  const missing = (order.lines || []).filter((l: any) => (Number(l.qtyShorted) || 0) > 0);
  const firstName = String(order.customerName || '').split(' ')[0];
  const method = methodWords(order.method, retailSettings).long;
  // The order's tags the packer should see (lib/order-tags): wholesale, a gift, waiting on stock, the shop's own.
  const tags = orderTags(order, retailSettings).filter((t) => t.onSlip);
  const tote = toteOf(order);
  // What each missing item gave back: what was paid for it, with its tax (lib/restocking).
  const backFor = (l: any) => { const items = effectiveUnitCents(l) * (Number(l.qtyShorted) || 0); return items + taxShareCents(order, items); };

  return (
    <div className="ps">
      <div className="head">
        <div>
          <p className="shop">{shopName}</p>
          <p className="title">Packing slip</p>
          <div className="tags">
            <span className="pill">{method}</span>
            {tags.map((t) => <span key={t.id} className={`pill ${t.tone || ''}`}>{t.label}</span>)}
          </div>
          {(order.shelfSlot && order.method !== 'ship') || tote ? (
            <div className="slots">
              {order.shelfSlot && order.method !== 'ship' ? <span className="slot">Shelf {String(order.shelfSlot)}</span> : null}
              {tote ? <span className="slot tote">Tote {String(tote)}</span> : null}
            </div>
          ) : null}
        </div>
        <p className="num">{num}<small>{order.paidAt ? new Date(order.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</small></p>
      </div>

      <div className="meta">
        <div><p className="lbl">Customer</p><p className="val">{order.customerName}</p></div>
        {order.businessName ? <div><p className="lbl">Business</p><p className="val">{order.businessName}</p></div> : null}
        {order.poNumber ? <div><p className="lbl">PO</p><p className="val">{order.poNumber}</p></div> : null}
        {order.shippingAddress ? (
          <div>
            <p className="lbl">Ship to</p>
            <p className="val">
              {order.shippingAddress.name}, {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
            </p>
          </div>
        ) : null}
      </div>

      {order.staffNote?.text ? <p className="note"><b>Note</b> · {String(order.staffNote.text)}{order.staffNote.by ? <span className="muted"> · {String(order.staffNote.by)}</span> : null}</p> : null}

      <table>
        <thead>
          <tr><th style={{ width: '6%' }}><span className="box" aria-label="Packed" /></th><th>Item</th><th style={{ width: '10%' }}>Qty</th><th style={{ width: '14%', textAlign: 'right' }}>Price</th></tr>
        </thead>
        <tbody>
          {(order.lines || []).map((l: any, i: number) => {
            const qty = l.qtyOrdered - (l.qtyShorted || 0);
            const done = l.qtyScanned >= l.qtyOrdered || ['shorted', 'refunded', 'backordered'].includes(l.status);
            return (
              <tr key={i}>
                <td><span className={`box${done ? ' done' : ''}`} /></td>
                <td>
                  {l.name}
                  {(l as any).optionsLabel ? <span className="muted"> · {(l as any).optionsLabel}</span> : null}
                  {l.sku ? <span className="muted"> · {l.sku}</span> : null}
                  {(l.qtyShorted || 0) > 0 ? (
                    <span className="flag">
                      {l.status === 'backordered' ? `${l.qtyShorted} on backorder: sent on its own when it’s back in` : `${l.qtyShorted} not available: refunded`}
                    </span>
                  ) : null}
                </td>
                <td>{qty}</td>
                <td style={{ textAlign: 'right' }}>{money(Math.max(0, l.unitPriceCents * qty - (Number(l.lineDiscountCents) || 0)))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="foot">
        <div>
          <img className="qr" src={qrDataUrl} alt="Order QR" />
          <p className="qr-note">Scan at handover. It works even if their phone is dead.</p>
        </div>
        <div className="totals">
          <p className="line"><span>Subtotal</span><span>{money(order.subtotalCents || 0)}</span></p>
          {(order.promo?.cents || 0) > 0 ? <p className="line"><span>{String(order.promo.label || order.promo.code)}</span><span>−{money(order.promo.cents)}</span></p> : null}
          {order.taxCents > 0 ? <p className="line"><span>Tax</span><span>{money(order.taxCents)}</span></p> : null}
          {order.shippingCents > 0 ? <p className="line"><span>{order.method === 'ship' ? 'Shipping' : 'Delivery'}</span><span>{money(order.shippingCents)}</span></p> : null}
          {order.tipCents > 0 ? <p className="line"><span>Tip</span><span>{money(order.tipCents)}</span></p> : null}
          {order.refundedCents > 0 ? <p className="line" style={{ color: '#b45309' }}><span>Refunded</span><span>−{money(order.refundedCents)}</span></p> : null}
          <p className="line grand"><span>Total</span><span>{money(order.totalCents || 0)}</span></p>
        </div>
      </div>

      <div className="cut"><span>Tear here: this half goes in the bag</span></div>

      <div className="card">
        <div className="body">
          <h2>{shopName} · <b>Order {num}</b></h2>
          <p className="lede">
            {firstName ? `${firstName}, thank you.` : 'Thank you.'} Everything you need is on this card, so you never have to look for an email address.
          </p>

          {missing.length > 0 ? (
            <div className="short-box">
              <p className="t">Not in this bag</p>
              {missing.map((l: any, i: number) => (
                <p key={i}>
                  {l.qtyShorted} × {l.name}
                  {l.status === 'backordered'
                    ? ': we came up short. It comes on its own as soon as it’s back in, at no extra cost.'
                    : `: we came up short and refunded ${money(backFor(l))}. It goes back the way you paid (a card refund takes 5 to 10 business days).`}
                </p>
              ))}
              <p style={{ marginTop: 5 }}>Would you rather have it the other way? Scan the code and send us a message, and we’ll switch it.</p>
            </div>
          ) : null}

          <p className="why">Scan the code to</p>
          <ul>
            <li>See this order and what’s in it</li>
            <li>Start a return or exchange within {returnDays} days, no email needed</li>
            <li>Message us about anything and get the answer on the same page</li>
            <li>Leave a review once you’ve used it</li>
          </ul>

          {contactBits.length > 0 ? (
            <p className="contact">Or reach us: {contactBits.join(' · ')}</p>
          ) : null}
        </div>

        {customerQr ? (
          <div>
            <img className="cqr" src={customerQr} alt="Scan for your order" />
            <p className="cqr-note">Point your camera here · order {num}</p>
          </div>
        ) : null}
      </div>
    </div>);
}
