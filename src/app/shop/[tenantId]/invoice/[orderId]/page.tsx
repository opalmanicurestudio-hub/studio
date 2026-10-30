'use client';

// ─── /shop/[tenantId]/invoice/[orderId] ──────────────────────────────────────
// A printable invoice the customer opens from their order page. Access =
// the order's own link token (same capability as the order page itself);
// data comes from the existing token-authed order-status endpoint, so this
// page holds no Firestore access and no secrets of its own. Print styles
// produce a clean A4/letter document; browsers' "Save as PDF" is the
// download path — no server PDF generation to maintain.
//
// Wholesale-aware: shows the buyer's business name and PO number when
// present, and discloses store credit applied so the paper matches the
// money that actually moved.

import { Loader, Printer } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';

const fmt = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

// The invoice in the app's print look (lib/print-style): a white sheet on screen, plain paper when printed, and one
// ink line in the totals, above the amount the customer actually paid.
const INVOICE_CSS = `
@page { margin: 0.55in; }
.pp.inv { background: #fff; border: 1px solid #ececee; border-radius: 20px; padding: 28px 30px; }
.pp.inv .head .meta .pill { margin-bottom: 4px; }
.pp.inv .parties { margin-bottom: 18px; }
.pp.inv .parties .lbl { margin-bottom: 3px; }
.pp.inv .parties .v { font-weight: 500; }
.pp.inv td .pill { margin-left: 6px; }
.pp.inv .totals { margin: 16px 0 0 auto; max-width: 260px; }
.pp.inv .totals .line { border-bottom: 0; padding: 3px 0; }
.pp.inv .totals .line.mid { font-weight: 600; border-top: 1px solid #ececee; margin-top: 4px; padding-top: 6px; }
.pp.inv .totals .line.total { font-size: 14px; margin-top: 6px; padding-top: 7px; }
@media screen { .pp.inv { font-size: 13px; } }
@media print { .no-print { display: none !important; } body { background: #fff; } .pp.inv { border: 0; border-radius: 0; padding: 0; } }
`;

export default function InvoicePage({ params }: { params: Promise<{ tenantId: string; orderId: string }> }) {
  const { tenantId, orderId } = React.use(params);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') || '';
    if (!t) { setErr('This invoice link is missing its key — open it from your order page.'); return; }
    (async () => {
      try {
        // The pass the order page keeps on this device (lib/order-pass): with it the invoice shows the full address.
        let pass = '';
        try { pass = window.localStorage.getItem(`cfshop-pass-${tenantId}-${orderId}`) || ''; } catch { /* private browsing */ }
        const res = await fetch(`/api/retail/order-status?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&t=${encodeURIComponent(t)}${pass ? `&pass=${encodeURIComponent(pass)}` : ''}`);
        const d = await res.json();
        if (!res.ok) setErr(d.error || 'This invoice could not be loaded.');
        else if (d.expired) setErr('This order’s link has expired. Open your order page and confirm it’s you, then print the invoice from there.');
        else setData(d);
      } catch {
        setErr('This invoice could not be loaded — check your connection and try again.');
      }
    })();
  }, [tenantId, orderId]);

  if (err) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">{err}</p>
      </div>
    );
  }
  if (!data?.order) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading invoice" />
      </div>
    );
  }

  const o = data.order;
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const issued = o.timestamps?.paidAt || o.timestamps?.placedAt || '';
  // How it was paid: by card, store credit and gift card (orders paid before this was kept show the credit asked for).
  const tn = o.tenders || null;
  const credit = tn ? Number(tn.creditCents) || 0 : Number(o.storeCreditRequestedCents) || 0;
  const gift = tn ? Number(tn.giftCents) || 0 : 0;
  const paidCents = tn ? Number(tn.cardCents) || 0 : Math.max(0, (o.totalCents || 0) - credit);
  const split = credit > 0 || gift > 0;
  const cancelled = o.stage === 'cancelled';
  const addr = o.shippingAddress;

  return (
    <div className="mx-auto max-w-2xl p-6 print:p-0">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href={PRINT_FONT_HREF} rel="stylesheet" />
      <style>{PRINT_CSS + INVOICE_CSS}</style>

      {o.method === 'ship' && addr?.masked ? (
        <p className="no-print mb-3 text-[13px] text-muted-foreground">The street address shows once you confirm it’s you on your order page.</p>
      ) : null}
      <div className="no-print mb-4 flex justify-end">
        <button
          onClick={() => window.print()}
          className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold hover:bg-muted"
        >
          <Printer className="h-4 w-4" aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>

      <div className="pp inv">
        <div className="head">
          <div>
            {data.shopLogoUrl ? <img src={data.shopLogoUrl} alt="" className="shop-logo" style={{ height: 34, width: 'auto', maxWidth: 160, objectFit: 'contain', marginBottom: 8 }} /> : null}
            {data.shopName ? <p className="shop">{data.shopName}</p> : null}
            <h1>Invoice</h1>
            <p className="sub">Order {num}</p>
          </div>
          <div className="meta">
            <span className={`pill ${cancelled ? 'warn' : 'ok'}`}>{cancelled ? 'Cancelled' : 'Paid'}</span>
            {issued && <div>{new Date(issued).toLocaleDateString()}</div>}
          </div>
        </div>

        <div className="grid2 parties">
          <div>
            <p className="lbl">Billed to</p>
            <p className="v">{o.businessName || o.customerName || 'Customer'}</p>
            {o.businessName && o.customerName ? <p className="muted">{o.customerName}</p> : null}
            {o.customerEmail ? <p className="muted">{o.customerEmail}</p> : null}
            {o.poNumber ? <p className="muted">PO: {o.poNumber}</p> : null}
          </div>
          <div>
            <p className="lbl">{o.method === 'ship' ? 'Ship to' : o.method === 'delivery' ? 'Deliver to' : 'Fulfillment'}</p>
            {(o.method === 'ship' || o.method === 'delivery') && addr ? (
              <p className="body">
                {addr.masked ? null : <>{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}<br /></>}
                {addr.city}, {addr.state} {addr.masked ? '' : addr.postalCode || addr.zip || ''}
              </p>
            ) : (
              <p className="body">Pickup in store</p>
            )}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Qty</th>
              <th className="r">Unit</th>
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l: any) => {
              const qty = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
              if (qty === 0 && l.qtyOrdered > 0 && l.status === 'refunded') return null;
              return (
                <tr key={l.lineId}>
                  <td>
                    {l.name}
                    {l.qtyShorted > 0 && l.status === 'backordered' ? (
                      <span className="pill warn">{l.qtyShorted} backordered</span>
                    ) : null}
                  </td>
                  <td className="r">{l.qtyOrdered}</td>
                  <td className="r">{fmt(l.unitPriceCents)}</td>
                  <td className="r">{fmt(l.unitPriceCents * l.qtyOrdered)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="totals">
          <div className="line"><span className="muted">Subtotal</span><span>{fmt(o.subtotalCents)}</span></div>
          {(o.promo?.cents || 0) > 0 && <div className="line ok"><span>{String(o.promo.label || o.promo.code)}</span><span>−{fmt(o.promo.cents)}</span></div>}
          {(o.offerSavings?.cents || 0) > 0 && <div className="line ok"><span>{String(o.offerSavings.label)}</span><span>−{fmt(o.offerSavings.cents)}</span></div>}
          {(o.shippingCents || 0) > 0 && <div className="line"><span className="muted">{o.method === 'delivery' ? 'Delivery' : 'Shipping'}</span><span>{fmt(o.shippingCents)}</span></div>}
          {(o.taxCents || 0) > 0 && <div className="line"><span className="muted">Tax</span><span>{fmt(o.taxCents)}</span></div>}
          {(o.tipCents || 0) > 0 && <div className="line"><span className="muted">Tip</span><span>{fmt(o.tipCents)}</span></div>}
          <div className={`line ${split ? 'mid' : 'total'}`}><span>Total</span><span>{fmt(o.totalCents)}</span></div>
          {split && (
            <>
              {credit > 0 ? <div className="line"><span className="muted">Store credit applied</span><span>−{fmt(credit)}</span></div> : null}
              {gift > 0 ? <div className="line"><span className="muted">Gift card applied</span><span>−{fmt(gift)}</span></div> : null}
              <div className="line total"><span>{paidCents > 0 ? 'Charged to card' : 'Charged'}</span><span>{fmt(paidCents)}</span></div>
            </>
          )}
          {(o.refundedCents || 0) > 0 && (
            <div className="line warn"><span>Refunded</span><span>−{fmt(o.refundedCents)}</span></div>
          )}
        </div>

        <div className="foot">
          <span>Order {num}{data.shopName ? ` · ${data.shopName}` : ''}</span>
          <span>Generated {new Date().toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
