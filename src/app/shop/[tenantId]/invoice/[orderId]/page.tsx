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

const fmt = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

export default function InvoicePage({ params }: { params: Promise<{ tenantId: string; orderId: string }> }) {
  const { tenantId, orderId } = React.use(params);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') || '';
    if (!t) { setErr('This invoice link is missing its key — open it from your order page.'); return; }
    (async () => {
      try {
        const res = await fetch(`/api/retail/order-status?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&t=${encodeURIComponent(t)}`);
        const d = await res.json();
        if (!res.ok) setErr(d.error || 'This invoice could not be loaded.');
        else setData(d);
      } catch {
        setErr('This invoice could not be loaded — check your connection and try again.');
      }
    })();
  }, [tenantId, orderId]);

  if (err) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm font-bold text-muted-foreground">{err}</p>
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
  const credit = Number(o.storeCreditRequestedCents) || 0;
  const paidCents = Math.max(0, (o.totalCents || 0) - credit);
  const cancelled = o.stage === 'cancelled';
  const addr = o.shippingAddress;

  return (
    <div className="mx-auto max-w-2xl p-6 print:p-0">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>

      <div className="no-print mb-4 flex justify-end">
        <button
          onClick={() => window.print()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border-2 px-4 font-black uppercase text-[10px] tracking-widest hover:bg-muted"
        >
          <Printer className="h-4 w-4" aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>

      <div className="rounded-2xl border-2 p-6 print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-4 border-b-2 pb-4">
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest">{data.shopName || 'Invoice'}</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Invoice · Order {num}</p>
          </div>
          <div className="text-right">
            <p className={`text-[10px] font-black uppercase tracking-widest ${cancelled ? 'text-red-600' : 'text-emerald-700'}`}>
              {cancelled ? 'Cancelled' : 'Paid'}
            </p>
            {issued && <p className="text-[10px] font-bold text-muted-foreground">{new Date(issued).toLocaleDateString()}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 py-4 text-sm">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Billed to</p>
            <p className="font-bold">{o.businessName || o.customerName || 'Customer'}</p>
            {o.businessName && o.customerName ? <p className="text-xs font-bold text-muted-foreground">{o.customerName}</p> : null}
            {o.customerEmail ? <p className="text-xs font-bold text-muted-foreground">{o.customerEmail}</p> : null}
            {o.poNumber ? <p className="text-xs font-bold text-muted-foreground">PO: {o.poNumber}</p> : null}
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{o.method === 'ship' ? 'Ship to' : 'Fulfilment'}</p>
            {o.method === 'ship' && addr ? (
              <p className="text-xs font-bold text-muted-foreground">
                {addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}<br />
                {addr.city}, {addr.state} {addr.zip}
              </p>
            ) : (
              <p className="text-xs font-bold text-muted-foreground">Pickup in store</p>
            )}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 text-left text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l: any) => {
              const qty = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
              if (qty === 0 && l.qtyOrdered > 0 && l.status === 'refunded') return null;
              return (
                <tr key={l.lineId} className="border-b">
                  <td className="py-2 font-bold">
                    {l.name}
                    {l.qtyShorted > 0 && l.status === 'backordered' ? (
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-700"> · {l.qtyShorted} backordered</span>
                    ) : null}
                  </td>
                  <td className="py-2 text-right font-mono font-bold">{l.qtyOrdered}</td>
                  <td className="py-2 text-right font-mono font-bold">{fmt(l.unitPriceCents)}</td>
                  <td className="py-2 text-right font-mono font-bold">{fmt(l.unitPriceCents * l.qtyOrdered)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-full max-w-[240px] space-y-1 text-sm">
          <div className="flex justify-between"><span className="font-bold text-muted-foreground">Subtotal</span><span className="font-mono font-bold">{fmt(o.subtotalCents)}</span></div>
          {(o.shippingCents || 0) > 0 && <div className="flex justify-between"><span className="font-bold text-muted-foreground">Shipping</span><span className="font-mono font-bold">{fmt(o.shippingCents)}</span></div>}
          {(o.taxCents || 0) > 0 && <div className="flex justify-between"><span className="font-bold text-muted-foreground">Tax</span><span className="font-mono font-bold">{fmt(o.taxCents)}</span></div>}
          {(o.tipCents || 0) > 0 && <div className="flex justify-between"><span className="font-bold text-muted-foreground">Tip</span><span className="font-mono font-bold">{fmt(o.tipCents)}</span></div>}
          <div className="flex justify-between border-t-2 pt-1"><span className="font-black uppercase text-[10px] tracking-widest">Total</span><span className="font-mono font-black">{fmt(o.totalCents)}</span></div>
          {credit > 0 && (
            <>
              <div className="flex justify-between"><span className="font-bold text-muted-foreground">Store credit applied</span><span className="font-mono font-bold">−{fmt(credit)}</span></div>
              <div className="flex justify-between"><span className="font-black uppercase text-[10px] tracking-widest">Charged</span><span className="font-mono font-black">{fmt(paidCents)}</span></div>
            </>
          )}
          {(o.refundedCents || 0) > 0 && (
            <div className="flex justify-between text-red-700"><span className="font-bold">Refunded</span><span className="font-mono font-bold">−{fmt(o.refundedCents)}</span></div>
          )}
        </div>

        <p className="mt-6 text-[9px] font-bold text-muted-foreground">
          Order {num} · {data.shopName || ''} · Generated {new Date().toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
