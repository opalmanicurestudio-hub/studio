/**
 * /api/booths/statement — v1
 *
 * GET ?tenantId=&renterId=&year=YYYY
 *
 * Returns a print-ready HTML annual rent statement — the document a
 * renter hands their accountant at tax time. Aggregates every payment
 * made in the calendar year across:
 *   - boothReservations (day rentals, confirmed/completed)
 *   - transactions      (lease rent payments, source='booth_rent')
 * matched to the renter by renterId, phone, email, or name.
 *
 * Same zero-dependency approach as the receipt route: returns HTML,
 * auto-triggers print dialog, renter saves as PDF.
 *
 * For the 1099-NEC threshold note: if total rent paid in a calendar year
 * exceeds $600, the studio is required to issue a 1099-NEC to the renter
 * (and file with the IRS). This statement is not a 1099-NEC — it is the
 * renter's own payment record. The route flags the $600 threshold.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { PRINT, PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';

const esc =(s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => { try { return new Date(s.slice(0,10)+'T00:00:00').toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }); } catch { return s.slice(0,10); } };

interface PaymentRow {
  date:        string;
  description: string;
  space:       string;
  period:      string;
  amount:      number;
  method:      string;
  ref:         string;
}

function buildStatementHtml(data: {
  year:           number;
  studioName:     string;
  studioAddress:  string;
  studioPhone:    string;
  studioEmail:    string;
  renterName:     string;
  renterBusiness: string;
  rows:           PaymentRow[];
  totalDollars:   number;
  generatedAt:    string;
}): string {
  const rowsHtml = data.rows.map((r) => `
    <tr>
      <td class="nowrap">${esc(r.date.slice(0,10))}</td>
      <td>${esc(r.space)}</td>
      <td>${esc(r.period)}</td>
      <td class="muted">${esc(r.method)}</td>
      <td class="r nowrap">${fmt(r.amount)}</td>
    </tr>`).join('');

  const threshold = data.totalDollars >= 600;
  const contact = [data.studioAddress, data.studioPhone, data.studioEmail].filter(Boolean).map((s) => esc(s));

  // The app's print look (lib/print-style): a light heading, sentence-case labels in grey, thin lines, soft panels,
  // and amber only for the $600 note that needs a second look.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Annual rent statement ${data.year} — ${esc(data.renterName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" /><link href="${PRINT_FONT_HREF}" rel="stylesheet" />
  <style>
    @page { size: letter; margin: 0.55in; }
    ${PRINT_CSS}
    .pp.page { max-width: 760px; }
    .pp .v { font-size: 13px; font-weight: 500; margin-top: 2px; }
    .pp .parties { margin-bottom: 14px; }
    .pp .sum { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
    .pp .sum .big { font-size: 30px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.1; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .pp tfoot td { border-top: 1px solid ${PRINT.ink}; border-bottom: 0; padding-top: 9px; font-weight: 600; }
    .pp .callout { margin-top: 14px; }
    .pp .callout.warn { background: ${PRINT.amberSoft}; color: ${PRINT.body}; }
    .pp .callout.warn b { color: ${PRINT.amber}; }
    .pp .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 30px; break-inside: avoid; }
    .pp .sig-line { height: 36px; margin-bottom: 6px; border-bottom: 1px solid ${PRINT.ink}; }
    .pp .disclaimer { margin-top: 20px; }
    .pp .empty { text-align: center; padding: 28px 0; }
  </style>
</head>
<body class="pp-screen">
<div class="pp page">

  <div class="head">
    <div>
      <p class="shop">${esc(data.studioName)}</p>
      <h1>Annual rent statement <b>${data.year}</b></h1>
    </div>
    <div class="meta">
      ${contact.map((c) => `<div>${c}</div>`).join('')}
      <div>Generated ${esc(new Date(data.generatedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))}</div>
    </div>
  </div>

  <div class="grid2 parties">
    <div>
      <p class="lbl">Paid to (landlord)</p>
      <p class="v">${esc(data.studioName)}</p>
      ${data.studioAddress ? `<p class="muted">${esc(data.studioAddress)}</p>` : ''}
    </div>
    <div>
      <p class="lbl">Paid by (tenant)</p>
      <p class="v">${esc(data.renterName)}</p>
      ${data.renterBusiness ? `<p class="muted">${esc(data.renterBusiness)}</p>` : ''}
    </div>
  </div>

  <div class="panel sum">
    <div>
      <p class="lbl">Total rent paid · January 1 – December 31, ${data.year}</p>
      <p class="big">${fmt(data.totalDollars)}</p>
    </div>
    <p class="muted">${data.rows.length} payment${data.rows.length===1?'':'s'}</p>
  </div>

  ${data.rows.length === 0 ? '<p class="faint empty">No payments recorded for this period.</p>' : `
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Space</th>
        <th>Period covered</th>
        <th>Method</th>
        <th class="r">Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Total</td>
        <td class="r nowrap">${fmt(data.totalDollars)}</td>
      </tr>
    </tfoot>
  </table>`}

  <div class="panel note callout">
    <b>Tax guidance:</b> Rent paid for a business workspace is typically deductible as a business expense.
    Report on <b>Schedule C, Line 20b</b> (Rent on business property) or your applicable business tax schedule.
    Retain this statement and individual receipts. Consult your tax advisor or CPA to confirm deductibility
    based on your business structure and specific situation.
  </div>

  ${threshold ? `
  <div class="panel note callout warn">
    <b>Note — $600 threshold:</b> Total rent paid to ${esc(data.studioName)} in ${data.year} exceeds $600.
    Under IRS rules, if you paid a landlord more than $600 in rent for business property during the year,
    you may be required to report this on your tax return. The studio may issue a 1099-NEC or equivalent.
    This statement is <em>not</em> a 1099-NEC — keep it alongside any 1099 you receive.
  </div>` : ''}

  <div class="sig">
    <div>
      <div class="sig-line"></div>
      <p class="lbl">Prepared by · ${esc(data.studioName)}</p>
    </div>
    <div>
      <div class="sig-line"></div>
      <p class="lbl">Received by · ${esc(data.renterName)}</p>
    </div>
  </div>

  <p class="note disclaimer">
    This document is a payment record prepared by ${esc(data.studioName)} for informational purposes.
    It is not a legal or accounting document and does not constitute tax advice.
    ${esc(data.studioName)} is not responsible for the tax treatment of these payments.
  </p>

  <div class="foot">
    <span>${esc(data.studioName)} · Annual rent statement · ${data.year}</span>
    <span>Tenant: ${esc(data.renterName)} · ${esc(data.generatedAt.slice(0,10))}</span>
  </div>
</div>

  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))</script>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId  = searchParams.get('tenantId');
    const renterId  = searchParams.get('renterId');
    const yearParam = searchParams.get('year');

    if (!tenantId || !renterId || !yearParam) {
      return new NextResponse('Missing tenantId, renterId, or year.', { status: 400 });
    }
    const year = parseInt(yearParam, 10);
    if (Number.isNaN(year) || year < 2020 || year > 2099) {
      return new NextResponse('Invalid year.', { status: 400 });
    }
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;

    const db = getAdminDb();

    // ── Tenant (studio header) ──
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

    // ── Renter ──
    const renterSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!renterSnap.exists) return new NextResponse('Renter not found.', { status: 404 });
    const renter        = renterSnap.data() as any;
    const renterName    = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || renter.name || 'Renter';
    const renterBusiness = renter.businessName || '';
    const renterPhone   = renter.phone || '';
    const renterEmail   = renter.email || '';

    // ── Gather payments ──
    const rows: PaymentRow[] = [];

    // 1. Day rentals from boothReservations
    const fetchResByField = async (field: string, value: string) => {
      if (!value) return [];
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where(field, '==', value).get();
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    };
    const resByPhone = await fetchResByField('phone', renterPhone);
    const resByEmail = await fetchResByField('email', renterEmail);
    const seen = new Set<string>();
    for (const r of [...resByPhone, ...resByEmail]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (!['confirmed','completed','checked_in'].includes(r.status)) continue;
      const d = r.startDate || '';
      if (d < yearStart || d > yearEnd) continue;
      rows.push({
        date:        r.startDate,
        description: `Day rental`,
        space:       r.boothName || 'Space',
        period:      r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`,
        amount:      (r.amountCents || 0) / 100,
        method:      'Card (Stripe)',
        ref:         r.stripePaymentIntentId || '',
      });
    }

    // 2. Lease payments from transactions
    const fetchTxns = async (field: string, value: string) => {
      if (!value) return [];
      const snap = await db.collection(`tenants/${tenantId}/transactions`)
        .where('source', '==', 'booth_rent')
        .where(field, '==', value).get();
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    };
    // Try by renterId field, then by clientOrVendor name
    const txnsByRenterId    = await fetchTxns('renterId', renterId);
    const txnsByName        = await fetchTxns('clientOrVendor', renterName);
    const txnSeen = new Set<string>();
    for (const t of [...txnsByRenterId, ...txnsByName]) {
      if (txnSeen.has(t.id)) continue;
      txnSeen.add(t.id);
      const d = (t.date || t.createdAt || '').slice(0, 10);
      if (d < yearStart || d > yearEnd) continue;
      const amount = typeof t.amount === 'number' ? t.amount : (t.amountCents || 0) / 100;
      rows.push({
        date:        d,
        description: t.description || 'Booth rent',
        space:       t.boothName || t.description?.split('—')?.[1]?.trim() || 'Space',
        period:      t.periodStart && t.periodEnd ? `${t.periodStart} – ${t.periodEnd}` : d,
        amount,
        method:      t.paymentMethod || 'On file',
        ref:         t.stripePaymentIntentId || t.stripeChargeId || '',
      });
    }

    // Sort by date
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const totalDollars = rows.reduce((s, r) => s + r.amount, 0);

    const html = buildStatementHtml({
      year,
      studioName, studioAddress, studioPhone, studioEmail,
      renterName, renterBusiness,
      rows,
      totalDollars,
      generatedAt: new Date().toISOString(),
    });

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });

  } catch (err) {
    console.error('[booth-statement] failed', err);
    return new NextResponse('Could not generate statement.', { status: 500 });
  }
}
