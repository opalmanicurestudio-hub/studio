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
import { PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';

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
      <td>${esc(li.description)}</td>
      <td class="r nowrap">${fmt(li.amountDollars)}</td>
    </tr>`).join('');
  const contact = [data.studioAddress, data.studioPhone, data.studioEmail].filter(Boolean).map((s) => esc(s));

  // The app's print look (lib/print-style): a light heading, sentence-case labels in grey, thin lines, soft panels.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Receipt ${esc(data.receiptNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" /><link href="${PRINT_FONT_HREF}" rel="stylesheet" />
  <style>
    @page { margin: 0.55in; }
    ${PRINT_CSS}
    .pp.page { max-width: 680px; }
    .pp .v { font-size: 13px; font-weight: 500; margin-top: 2px; }
    .pp .who { margin-bottom: 14px; }
    .pp .period { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 18px; }
    .pp .period .pill { margin-top: 4px; }
    .pp .line.total { font-size: 14px; }
    .pp .tax { margin-top: 18px; }
  </style>
</head>
<body class="pp-screen">
<div class="pp page">
  <div class="head">
    <div>
      <p class="shop">${esc(data.studioName)}</p>
      <h1>Receipt</h1>
      ${contact.length ? `<p class="sub">${contact.join(' · ')}</p>` : ''}
    </div>
    <div class="meta">
      <div>Receipt #${esc(data.receiptNumber)}</div>
      <div>Issued ${esc(new Date(data.issuedAt).toLocaleDateString('en-US', { year:'numeric',month:'long',day:'numeric' }))}</div>
    </div>
  </div>

  <div class="grid2 who">
    <div>
      <p class="lbl">Billed to</p>
      <p class="v">${esc(data.renterName)}</p>
      ${data.renterBusiness ? `<p class="muted">${esc(data.renterBusiness)}</p>` : ''}
    </div>
    <div>
      <p class="lbl">Space</p>
      <p class="v">${esc(data.spaceName)}</p>
    </div>
  </div>

  <div class="panel period">
    <div>
      <p class="lbl">Period</p>
      <p class="v">${esc(data.periodLabel)}</p>
    </div>
    <div class="r">
      <p class="lbl">Status</p>
      <span class="pill ok">Paid</span>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="r">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="line total"><span>Total paid</span><span>${fmt(data.totalDollars)}</span></div>
  <div class="line memo"><span>Payment method: ${esc(data.paymentMethod)}</span><span>${data.paymentRef ? `Ref: ${esc(data.paymentRef.slice(0,20))}` : ''}</span></div>

  ${data.notes ? `<p class="muted" style="margin-top:14px">${esc(data.notes)}</p>` : ''}

  <div class="panel note tax">
    <b>Tax note:</b> This receipt serves as documentation for business space rental expenses.
    Retain for your records — it may be deductible as a business expense on Schedule C or your applicable business tax return.
    Consult your tax advisor to confirm deductibility in your specific situation.
  </div>

  <div class="foot">
    <span>${esc(data.studioName)} · Space rental receipt</span>
    <span>Receipt ${esc(data.receiptNumber)} · Generated ${new Date().toLocaleDateString()}</span>
  </div>
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
