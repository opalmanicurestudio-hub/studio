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
 * The 1099 note: rent goes the other way. A business that pays rent of
 * $2,000 or more in a year ($600 for 2025 and earlier) to a landlord that
 * isn't a corporation usually sends the landlord a Form 1099-MISC, so the
 * renter may owe the studio one; the studio doesn't send the renter one for
 * rent. This statement is the renter's own payment record, not a 1099. The
 * route flags the threshold for the year.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { printLinkValid, printLinkExpired } from '@/lib/print-link';
import { PRINT, PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';

const esc =(s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => { try { return new Date(s.slice(0,10)+'T00:00:00').toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }); } catch { return s.slice(0,10); } };

interface PaymentRow {
  date:        string;
  description: string;
  space:       string;
  period:      string;
  amount:      number;
  method:      string;
  ref:         string;
  /** Rent itself (not a fee or an add-on), paid some way other than by card or a payment app: what the 1099-MISC test
   *  counts (card and payment-app payments are reported by the processor instead). */
  rentByHand?: boolean;
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
  byHandDollars?: number;
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

  const limit = data.year >= 2026 ? 2000 : 600;
  const threshold = (data.byHandDollars || 0) >= limit;
  const contact = [data.studioAddress, data.studioPhone, data.studioEmail].filter(Boolean).map((s) => esc(s));

  // The app's print look (lib/print-style): a light heading, sentence-case labels in grey, thin lines, soft panels,
  // and amber only for the 1099 note that needs a second look.
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
      <p class="lbl">Total rent paid, January 1 to December 31, ${data.year}</p>
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
    <b>A Form 1099-MISC for rent:</b> rent paid to ${esc(data.studioName)} in ${data.year} by check, cash, bank transfer or taken off rent is
    ${fmt(data.byHandDollars || 0)}, which is $${limit.toLocaleString('en-US')} or more. A business that pays a landlord that much rent in a year
    usually sends the landlord a Form 1099-MISC, unless the landlord is a corporation. Rent paid by card or a payment app
    is left out: the processor reports it. Ask your accountant whether you need to send one to ${esc(data.studioName)}.
    This statement is your own record of what you paid, not a 1099.
  </div>` : ''}

  <div class="sig">
    <div>
      <div class="sig-line"></div>
      <p class="lbl">Prepared by ${esc(data.studioName)}</p>
    </div>
    <div>
      <div class="sig-line"></div>
      <p class="lbl">Received by ${esc(data.renterName)}</p>
    </div>
  </div>

  <p class="note disclaimer">
    This document is a payment record prepared by ${esc(data.studioName)} for informational purposes.
    It is not a legal or accounting document and does not constitute tax advice.
    ${esc(data.studioName)} is not responsible for the tax treatment of these payments.
  </p>

  <div class="foot">
    <span>${esc(data.studioName)}, annual rent statement, ${data.year}</span>
    <span>Renter: ${esc(data.renterName)}, ${esc(data.generatedAt.slice(0,10))}</span>
  </div>
</div>

  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))</script>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (!printLinkValid('/api/booths/statement', searchParams)) return printLinkExpired();   // opens only from a short-lived signed link (lib/print-link)
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
    const resById = new Map<string, any>();
    const counted = new Set<string>();   // bookings that are on this statement as bookings
    for (const r of [...resByPhone, ...resByEmail]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id); resById.set(String(r.id), r);
      if (!['confirmed','completed','checked_in'].includes(r.status)) continue;
      const d = r.startDate || '';
      if (d < yearStart || d > yearEnd) continue;
      counted.add(String(r.id));
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
    // By renter id and their own records, never by name: someone else with the same name is someone else
    // (lib/renter-rent-history).
    const { renterRentPayments, rentTakeBacks, rentLineCents, rentLineTarget, rentCreditsUsed } = await import('@/lib/renter-rent-history');
    // (Then any undo, void or correction of one of those payments, which carries none of the renter's ids.)
    const pays = await renterRentPayments(db, tenantId, { renterId });
    const byId = new Map<string, any>();
    for (const t of [...pays, ...await rentTakeBacks(db, tenantId, pays.map((p: any) => String(p.id)))]) byId.set(String(t.id), t);
    // A booking's own payment is already counted above (as the booking). Its other lines (overage, incidentals,
    // refunds) are separate money and stay; anything taking that payment back goes with it.
    const asBooking = new Set<string>();
    for (const t of byId.values()) {
      const bk = t.sourceId && counted.has(String(t.sourceId)) ? resById.get(String(t.sourceId)) : null;
      if (bk && (String(t.id) === `boothrent_${String(t.sourceId).replace(/[^A-Za-z0-9_-]/g, '')}` || (!!t.stripePaymentIntentId && t.stripePaymentIntentId === bk.stripePaymentIntentId && t.category === 'Booth Rent' && !/^(Overage|Incidental)/i.test(String(t.description || ''))))) asBooking.add(String(t.id));
    }
    // (Card and payment-app payments are reported by the processor on a 1099-K, so the 1099-MISC test leaves them out.)
    const BY_PROCESSOR = /card|stripe|apple pay|google pay|paypal|venmo|cash ?app|square/i;
    for (const t of byId.values()) {
      if (asBooking.has(String(t.id)) || asBooking.has(rentLineTarget(t))) continue;
      const d = (t.date || t.createdAt || '').slice(0, 10);
      if (d < yearStart || d > yearEnd) continue;
      // A security deposit is their money held, not rent paid (one applied to what they owe is, and is booked as rent).
      // A refund to their card, an undo or a void comes off what they paid (lib/renter-rent-history rentLineCents).
      const cents = rentLineCents(t, byId); if (!cents) continue;
      const orig = byId.get(rentLineTarget(t)) || t;
      rows.push({
        date:        d,
        description: t.description || 'Booth rent',
        space:       t.boothName || orig.boothName || t.description?.split('—')?.[1]?.trim() || 'Space',
        period:      t.periodStart && t.periodEnd ? `${t.periodStart} – ${t.periodEnd}` : d,
        amount:      cents / 100,
        method:      t.paymentMethod || 'On file',
        ref:         t.stripePaymentIntentId || t.stripeChargeId || '',
        rentByHand:  orig.category === 'Booth Rent' && !BY_PROCESSOR.test(String(orig.paymentMethod || t.paymentMethod || '')),
      });
    }

    // 3. Money the studio owed them that went toward rent instead of being paid out (front-desk collections, studio gift
    // cards, online shop sales), as it was used on a rent bill: paid all the same, and no card processor reports it.
    const ledger = (await db.collection(`tenants/${tenantId}/rentLedger`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    for (const c of rentCreditsUsed(ledger, year)) {
      rows.push({ date: c.date, description: `Paid from ${c.what}`, space: 'Rent', period: c.date, amount: c.cents / 100, method: 'Taken off rent', ref: '', rentByHand: true });
    }

    // Sort by date
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const totalDollars = rows.reduce((s, r) => s + r.amount, 0);
    const byHandDollars = rows.filter((r) => r.rentByHand).reduce((s, r) => s + r.amount, 0);

    const html = buildStatementHtml({
      year,
      studioName, studioAddress, studioPhone, studioEmail,
      renterName, renterBusiness,
      rows,
      totalDollars,
      byHandDollars,
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
