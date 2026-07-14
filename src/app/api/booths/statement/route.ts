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

const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  const rowsHtml = data.rows.map((r, i) => `
    <tr style="background:${i%2===0?'#f9fafb':'#fff'}">
      <td style="padding:9px 12px;font-size:12px;border-bottom:1px solid #e5e7eb">${esc(r.date.slice(0,10))}</td>
      <td style="padding:9px 12px;font-size:12px;border-bottom:1px solid #e5e7eb">${esc(r.space)}</td>
      <td style="padding:9px 12px;font-size:12px;border-bottom:1px solid #e5e7eb">${esc(r.period)}</td>
      <td style="padding:9px 12px;font-size:12px;border-bottom:1px solid #e5e7eb">${esc(r.method)}</td>
      <td style="padding:9px 12px;font-size:12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${fmt(r.amount)}</td>
    </tr>`).join('');

  const threshold = data.totalDollars >= 600;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Annual Rent Statement ${data.year} — ${esc(data.renterName)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;background:#fff;padding:48px;max-width:760px;margin:auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:24px;border-bottom:3px solid #111}
    .studio-name{font-size:20px;font-weight:900;letter-spacing:-0.5px}
    .studio-meta{font-size:11px;color:#6b7280;margin-top:4px;line-height:1.7}
    .doc-type{text-align:right}
    .doc-type h1{font-size:24px;font-weight:900;letter-spacing:-0.5px}
    .doc-type .year{font-size:36px;font-weight:900;color:#111;line-height:1;letter-spacing:-1px}
    .doc-type .gen{font-size:10px;color:#9ca3af;margin-top:4px}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;padding:20px;background:#f9fafb;border-radius:12px}
    .party .label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#9ca3af;margin-bottom:6px}
    .party .name{font-size:14px;font-weight:800}
    .party .meta{font-size:12px;color:#6b7280;margin-top:2px}
    .total-bar{display:flex;justify-content:space-between;align-items:center;background:#111;color:#fff;border-radius:12px;padding:16px 24px;margin-bottom:24px}
    .total-bar .label{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;opacity:0.6}
    .total-bar .amount{font-size:32px;font-weight:900;letter-spacing:-1px}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    thead th{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;padding:10px 12px;border-bottom:2px solid #111;text-align:left}
    thead th:last-child{text-align:right}
    .note{border-radius:10px;padding:14px 18px;font-size:11px;line-height:1.7;margin-bottom:16px}
    .note.tax{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
    .note.threshold{background:#fefce8;border:1px solid #fef08a;color:#713f12}
    .note.disclaimer{background:#f8fafc;border:1px solid #e2e8f0;color:#64748b}
    .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af}
    .sig-block{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:32px;padding-top:24px;border-top:2px solid #111}
    .sig-line{border-bottom:1px solid #111;height:36px;margin-bottom:6px}
    .sig-label{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em}
    @media print{body{padding:24px}@page{margin:1.5cm;size:letter}}
  </style>
</head>
<body>

  <div class="header">
    <div>
      <div class="studio-name">${esc(data.studioName)}</div>
      <div class="studio-meta">
        ${data.studioAddress ? esc(data.studioAddress)+'<br>' : ''}
        ${data.studioPhone ? esc(data.studioPhone)+'<br>' : ''}
        ${data.studioEmail ? esc(data.studioEmail) : ''}
      </div>
    </div>
    <div class="doc-type">
      <h1>ANNUAL RENT STATEMENT</h1>
      <div class="year">${data.year}</div>
      <div class="gen">Generated ${esc(new Date(data.generatedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="label">Paid to (Landlord)</div>
      <div class="name">${esc(data.studioName)}</div>
      ${data.studioAddress ? `<div class="meta">${esc(data.studioAddress)}</div>` : ''}
    </div>
    <div class="party">
      <div class="label">Paid by (Tenant)</div>
      <div class="name">${esc(data.renterName)}</div>
      ${data.renterBusiness ? `<div class="meta">${esc(data.renterBusiness)}</div>` : ''}
    </div>
  </div>

  <div class="total-bar">
    <div>
      <div class="label">Total rent paid · January 1 – December 31, ${data.year}</div>
      <div class="amount">${fmt(data.totalDollars)}</div>
    </div>
    <div style="text-align:right;font-size:12px;font-weight:700;opacity:0.7">${data.rows.length} payment${data.rows.length===1?'':'s'}</div>
  </div>

  ${data.rows.length === 0 ? '<p style="text-align:center;color:#9ca3af;padding:32px;font-size:13px">No payments recorded for this period.</p>' : `
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Space</th>
        <th>Period covered</th>
        <th>Method</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="padding:12px;font-size:13px;font-weight:900;border-top:2px solid #111">TOTAL</td>
        <td style="padding:12px;font-size:15px;font-weight:900;border-top:2px solid #111;text-align:right">${fmt(data.totalDollars)}</td>
      </tr>
    </tfoot>
  </table>`}

  <div class="note tax">
    <strong>Tax guidance:</strong> Rent paid for a business workspace is typically deductible as a business expense.
    Report on <strong>Schedule C, Line 20b</strong> (Rent on business property) or your applicable business tax schedule.
    Retain this statement and individual receipts. Consult your tax advisor or CPA to confirm deductibility
    based on your business structure and specific situation.
  </div>

  ${threshold ? `
  <div class="note threshold">
    <strong>Note — $600 threshold:</strong> Total rent paid to ${esc(data.studioName)} in ${data.year} exceeds $600.
    Under IRS rules, if you paid a landlord more than $600 in rent for business property during the year,
    you may be required to report this on your tax return. The studio may issue a 1099-NEC or equivalent.
    This statement is <em>not</em> a 1099-NEC — keep it alongside any 1099 you receive.
  </div>` : ''}

  <div class="sig-block">
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Prepared by · ${esc(data.studioName)}</div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Received by · ${esc(data.renterName)}</div>
    </div>
  </div>

  <div class="note disclaimer" style="margin-top:24px">
    This document is a payment record prepared by ${esc(data.studioName)} for informational purposes.
    It is not a legal or accounting document and does not constitute tax advice.
    ${esc(data.studioName)} is not responsible for the tax treatment of these payments.
  </div>

  <div class="footer">
    <span>${esc(data.studioName)} · Annual Rent Statement · ${data.year}</span>
    <span>Tenant: ${esc(data.renterName)} · ${esc(data.generatedAt.slice(0,10))}</span>
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
