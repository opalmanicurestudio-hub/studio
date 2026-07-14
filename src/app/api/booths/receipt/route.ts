/**
 * /api/booths/receipt — v1
 *
 * GET ?tenantId=&type=reservation|ledger&id=
 *
 * Returns a complete, self-contained HTML document styled for printing /
 * browser print-to-PDF. No external PDF library — matches the approach
 * already used in the Ledger page (buildPrintHtml) and client report
 * page (window.print). Zero new dependencies.
 *
 * Document types:
 *  - reservation: a paid day-rental receipt from boothReservations/{id}
 *  - ledger:      a lease-payment receipt from transactions/{id}
 *    (used for manual rent entries recorded via the booth-rental service)
 *
 * The HTML response is opened in a new tab and the browser's
 * native print dialog handles PDF export. This is the same pattern
 * your existing codebase uses for financial documents.
 *
 * SECURITY: Admin SDK only — never publicly readable. Caller must be
 * an authenticated staff member (enforced by the tenant doc read: if
 * the tenant doesn't match, the record won't be found).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function buildReceiptHtml(data: {
  receiptNumber: string;
  issuedAt:      string;
  studioName:    string;
  studioAddress: string;
  studioPhone:   string;
  studioEmail:   string;
  renterName:    string;
  renterBusiness:string;
  spaceName:     string;
  periodLabel:   string;
  lineItems:     { description: string; amountDollars: number }[];
  totalDollars:  number;
  paymentMethod: string;
  paymentRef:    string;
  notes:         string;
}): string {
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows = data.lineItems.map(li => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;">${esc(li.description)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${fmt(li.amountDollars)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Receipt ${esc(data.receiptNumber)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;background:#fff;padding:40px;max-width:680px;margin:auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:3px solid #111}
    .studio-name{font-size:22px;font-weight:900;letter-spacing:-0.5px}
    .studio-meta{font-size:11px;color:#6b7280;margin-top:4px;line-height:1.6}
    .receipt-label{text-align:right}
    .receipt-label h1{font-size:28px;font-weight:900;letter-spacing:-1px;color:#111}
    .receipt-label .num{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.1em;margin-top:4px}
    .receipt-label .date{font-size:11px;color:#6b7280;margin-top:2px}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px}
    .party-block .label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#9ca3af;margin-bottom:6px}
    .party-block .name{font-size:14px;font-weight:800}
    .party-block .meta{font-size:12px;color:#6b7280;margin-top:2px}
    .period-block{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:center}
    .period-block .label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#9ca3af}
    .period-block .value{font-size:14px;font-weight:800;margin-top:3px}
    table{width:100%;border-collapse:collapse}
    thead th{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#9ca3af;padding-bottom:10px;border-bottom:2px solid #111;text-align:left}
    thead th:last-child{text-align:right}
    .total-row td{padding:16px 0 4px;font-size:16px;font-weight:900;border-top:2px solid #111}
    .total-row td:last-child{text-align:right}
    .payment-row{font-size:11px;color:#6b7280;padding:6px 0 0}
    .payment-row td{padding:6px 0 0}
    .footer{margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af}
    .tax-note{margin-top:20px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:11px;color:#166534;line-height:1.6}
    @media print{body{padding:20px}@page{margin:1cm}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="studio-name">${esc(data.studioName)}</div>
      <div class="studio-meta">
        ${data.studioAddress ? esc(data.studioAddress) + '<br>' : ''}
        ${data.studioPhone ? esc(data.studioPhone) + '<br>' : ''}
        ${data.studioEmail ? esc(data.studioEmail) : ''}
      </div>
    </div>
    <div class="receipt-label">
      <h1>RECEIPT</h1>
      <div class="num">#${esc(data.receiptNumber)}</div>
      <div class="date">Issued ${esc(new Date(data.issuedAt).toLocaleDateString('en-US', { year:'numeric',month:'long',day:'numeric' }))}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party-block">
      <div class="label">Billed to</div>
      <div class="name">${esc(data.renterName)}</div>
      ${data.renterBusiness ? `<div class="meta">${esc(data.renterBusiness)}</div>` : ''}
    </div>
    <div class="party-block">
      <div class="label">Space</div>
      <div class="name">${esc(data.spaceName)}</div>
    </div>
  </div>

  <div class="period-block">
    <div>
      <div class="label">Period</div>
      <div class="value">${esc(data.periodLabel)}</div>
    </div>
    <div style="text-align:right">
      <div class="label">Status</div>
      <div class="value" style="color:#16a34a">✓ Paid</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tr class="total-row">
      <td>Total paid</td>
      <td>${fmt(data.totalDollars)}</td>
    </tr>
    <tr class="payment-row">
      <td>Payment method: ${esc(data.paymentMethod)}</td>
      <td style="text-align:right;font-size:11px;color:#6b7280">${data.paymentRef ? `Ref: ${esc(data.paymentRef.slice(0,20))}` : ''}</td>
    </tr>
  </table>

  ${data.notes ? `<p style="margin-top:20px;font-size:12px;color:#6b7280">${esc(data.notes)}</p>` : ''}

  <div class="tax-note">
    <strong>Tax note:</strong> This receipt serves as documentation for business space rental expenses.
    Retain for your records — it may be deductible as a business expense on Schedule C or your applicable business tax return.
    Consult your tax advisor to confirm deductibility in your specific situation.
  </div>

  <div class="footer">
    <span>${esc(data.studioName)} · Space Rental Receipt</span>
    <span>Receipt ${esc(data.receiptNumber)} · Generated ${new Date().toLocaleDateString()}</span>
  </div>

  <script>
    // Auto-open print dialog when loaded in a new tab.
    window.addEventListener('load', () => setTimeout(() => window.print(), 400));
  </script>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId  = searchParams.get('tenantId');
    const type      = searchParams.get('type');   // 'reservation' | 'ledger'
    const id        = searchParams.get('id');

    if (!tenantId || !type || !id) {
      return new NextResponse('Missing parameters.', { status: 400 });
    }

    const db = getAdminDb();

    // ── 1. Fetch the tenant (studio info for the receipt header) ──
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) return new NextResponse('Not found.', { status: 404 });
    const tenant = tenantSnap.data() as any;

    const studioName    = tenant.name || tenant.businessName || 'Studio';
    const studioAddress = [
      tenant.address?.street || tenant.address?.line1,
      tenant.address?.city,
      tenant.address?.state,
      tenant.address?.zip || tenant.address?.postalCode,
    ].filter(Boolean).join(', ') || tenant.address?.formatted || '';
    const studioPhone   = tenant.phone || '';
    const studioEmail   = tenant.email || tenant.contactEmail || '';

    let receiptData: Parameters<typeof buildReceiptHtml>[0];

    if (type === 'reservation') {
      // ── Day-rental receipt (from boothReservations) ──
      const resSnap = await db.doc(`tenants/${tenantId}/boothReservations/${id}`).get();
      if (!resSnap.exists) return new NextResponse('Reservation not found.', { status: 404 });
      const r = resSnap.data() as any;
      if (r.status !== 'confirmed' && r.status !== 'completed' && r.status !== 'checked_in') {
        return new NextResponse('Receipt only available for confirmed reservations.', { status: 400 });
      }

      const amountDollars = (r.amountCents || 0) / 100;
      const numDays       = r.numDays || 1;
      const dayRate       = amountDollars / numDays;

      receiptData = {
        receiptNumber:  `RES-${id.slice(-8).toUpperCase()}`,
        issuedAt:       r.confirmedAt || r.createdAt || new Date().toISOString(),
        studioName,
        studioAddress,
        studioPhone,
        studioEmail,
        renterName:     r.name || 'Guest',
        renterBusiness: '',
        spaceName:      r.boothName || 'Space',
        periodLabel:    r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`,
        lineItems: [{
          description:   `Space rental — ${r.boothName || 'Space'} (${numDays} day${numDays === 1 ? '' : 's'} × ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(dayRate)}/day)`,
          amountDollars,
        }],
        totalDollars:   amountDollars,
        paymentMethod:  'Card (Stripe)',
        paymentRef:     r.stripePaymentIntentId || '',
        notes:          '',
      };

    } else if (type === 'ledger') {
      // ── Lease payment receipt (from transactions) ──
      const txnSnap = await db.doc(`tenants/${tenantId}/transactions/${id}`).get();
      if (!txnSnap.exists) return new NextResponse('Transaction not found.', { status: 404 });
      const t = txnSnap.data() as any;

      // Try to get renter details from the linked reservation or renter collection
      let renterName    = t.clientOrVendor || 'Renter';
      let renterBusiness = '';
      if (t.renterId) {
        const renterSnap = await db.doc(`tenants/${tenantId}/renters/${t.renterId}`).get();
        if (renterSnap.exists) {
          const rd = renterSnap.data() as any;
          renterName     = `${rd.firstName || ''} ${rd.lastName || ''}`.trim() || renterName;
          renterBusiness = rd.businessName || '';
        }
      }

      const amountDollars = typeof t.amount === 'number' ? t.amount : (t.amountCents || 0) / 100;
      receiptData = {
        receiptNumber:  t.receiptNumber || `TXN-${id.slice(-8).toUpperCase()}`,
        issuedAt:       t.createdAt || t.date || new Date().toISOString(),
        studioName,
        studioAddress,
        studioPhone,
        studioEmail,
        renterName,
        renterBusiness,
        spaceName:      t.boothName || t.description?.split('—')[1]?.trim() || 'Space',
        periodLabel:    t.periodStart && t.periodEnd ? `${t.periodStart} – ${t.periodEnd}` : (t.date || '').slice(0, 10),
        lineItems:      (t.lineItems || [{ description: t.description || t.category || 'Booth rent', amountDollars }])
          .map((li: any) => ({ description: li.description, amountDollars: li.amountDollars ?? (li.amountCents || 0) / 100 })),
        totalDollars:   amountDollars,
        paymentMethod:  t.paymentMethod || 'On file',
        paymentRef:     t.stripePaymentIntentId || t.stripeChargeId || '',
        notes:          '',
      };
    } else {
      return new NextResponse('Unknown type.', { status: 400 });
    }

    const html = buildReceiptHtml(receiptData);
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });

  } catch (err) {
    console.error('[booth-receipt] failed', err);
    return new NextResponse('Could not generate receipt.', { status: 500 });
  }
}
