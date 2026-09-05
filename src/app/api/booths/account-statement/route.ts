/**
 * /api/booths/account-statement
 *
 * GET ?tenantId=&renterId=[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * A print-ready account statement for one renter: every invoice (with its
 * late fee), every payment, every write-off, in date order, with a running
 * balance — the document you hand someone who asks "what do I owe and why",
 * and the one a former renter gets with a final demand.
 *
 * The annual statement (/api/booths/statement) totals PAYMENTS for a tax
 * year; it never shows a charge or a fee. The single receipt shows one
 * transaction. Neither could answer "how did this balance get here" — this
 * one exists to. Self-contained HTML, browser print-to-PDF, no library —
 * the same approach as the other two.
 *
 * Sources, merged:
 *   rentInvoices — the charges (amount + lateFeeCents, status, dueDate)
 *   rentLedger   — payments (type 'payment', negative cents) and write-offs
 *                  (status 'waived'); rent_charge rows there are skipped when
 *                  an invoice already represents them (ledgerEntryId), and
 *                  included otherwise so pre-invoice history still shows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: any) => {
  const s = String(iso || '').slice(0, 10);
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

type Line = { date: string; kind: 'invoice' | 'late_fee' | 'payment' | 'write_off' | 'charge' | 'credit'; label: string; detail: string; cents: number; status?: string };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim();
  const renterId = String(sp.get('renterId') || '').trim();
  const from = String(sp.get('from') || '').slice(0, 10);
  const to = String(sp.get('to') || '').slice(0, 10);
  if (!tenantId || !renterId) return new NextResponse('Missing tenantId or renterId', { status: 400 });

  const db = getAdminDb();
  const [tSnap, rSnap, invSnap, ledSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}/renters/${renterId}`).get(),
    db.collection(`tenants/${tenantId}/rentInvoices`).where('renterId', '==', renterId).get(),
    db.collection(`tenants/${tenantId}/rentLedger`).where('renterId', '==', renterId).get(),
  ]);
  if (!rSnap.exists) return new NextResponse('Renter not found', { status: 404 });
  const tenant = (tSnap.data() as any) || {};
  const renter = rSnap.data() as any;
  const studio = tenant.name || tenant.businessName || 'The studio';
  const addr = [tenant.address?.street || tenant.address?.line1, tenant.address?.city, tenant.address?.state, tenant.address?.zip || tenant.address?.postalCode].filter(Boolean).join(', ');

  const lines: Line[] = [];
  const represented = new Set<string>();

  for (const d of invSnap.docs) {
    const i = d.data() as any;
    if (i.ledgerEntryId) represented.add(String(i.ledgerEntryId));
    if (i.status === 'void') continue;
    lines.push({
      date: String(i.dueDate || i.createdAt || '').slice(0, 10),
      kind: 'invoice', label: `Rent — ${i.boothName || 'space'}`,
      detail: `Invoice due ${day(i.dueDate)}${i.status === 'late' ? ' · late' : i.status === 'paid' ? ` · paid ${day(i.paidAt)}` : ''}`,
      cents: Number(i.amountCents) || 0, status: i.status,
    });
    if ((Number(i.lateFeeCents) || 0) > 0) {
      lines.push({
        date: String(i.lateFeeAppliedAt || i.dueDate || '').slice(0, 10),
        kind: 'late_fee', label: 'Late fee', detail: `On rent due ${day(i.dueDate)}`,
        cents: Number(i.lateFeeCents) || 0,
      });
    }
  }

  for (const d of ledSnap.docs) {
    const e = d.data() as any;
    const cents = Number(e.amountCents) || 0;
    const date = String(e.paidAt || e.dueDate || e.createdAt || '').slice(0, 10);
    if (e.type === 'rent_charge') {
      if (represented.has(d.id)) continue;               // the invoice shows it
      if (e.status === 'waived' && /written off/i.test(String(e.description || ''))) continue;
      lines.push({ date, kind: 'charge', label: e.description || 'Rent', detail: e.dueDate ? `Due ${day(e.dueDate)}` : '', cents, status: e.status });
    } else if (e.type === 'payment') {
      const isWriteOff = e.method === 'write_off' || /written off/i.test(String(e.description || ''));
      lines.push({
        date, kind: isWriteOff ? 'write_off' : 'payment',
        label: isWriteOff ? 'Balance written off' : `Payment — ${e.method || e.paymentMethod || 'received'}`,
        detail: e.note || '', cents,
      });
    } else if (e.type === 'late_fee') {
      lines.push({ date, kind: 'late_fee', label: e.description || 'Late fee', detail: '', cents });
    } else if (cents < 0) {
      lines.push({ date, kind: 'credit', label: e.description || 'Credit', detail: e.note || '', cents });
    } else if (cents > 0) {
      lines.push({ date, kind: 'charge', label: e.description || 'Charge', detail: e.note || '', cents, status: e.status });
    }
  }

  lines.sort((a, b) => a.date.localeCompare(b.date) || (a.cents > 0 ? -1 : 1));
  const inRange = (l: Line) => (!from || l.date >= from) && (!to || l.date <= to);

  // Opening balance = everything before the window.
  let running = 0;
  const opening = from ? lines.filter((l) => l.date < from).reduce((n, l) => n + l.cents, 0) : 0;
  running = opening;
  const shown = lines.filter(inRange);
  const rows = shown.map((l) => { running += l.cents; return { ...l, running }; });
  const charges = shown.filter((l) => l.cents > 0).reduce((n, l) => n + l.cents, 0);
  const credits = shown.filter((l) => l.cents < 0).reduce((n, l) => n + l.cents, 0);
  const closing = running;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Account statement — ${esc(renter.firstName)} ${esc(renter.lastName)}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:32px;max-width:860px}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em} .muted{color:#6b7280;font-size:12px}
  .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #111}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;padding:16px;background:#f9fafb;border-radius:12px}
  .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#6b7280;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:13px} th{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;text-align:left;padding:8px 6px;border-bottom:1px solid #e5e7eb}
  td{padding:9px 6px;border-bottom:1px solid #f3f4f6;vertical-align:top} td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tr.fee td{color:#b91c1c} tr.payment td,tr.credit td{color:#047857} tr.write_off td{color:#6b7280;font-style:italic}
  .detail{color:#6b7280;font-size:11px} .totals{margin-top:16px;margin-left:auto;width:320px;font-size:13px}
  .totals div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6} .totals .big{font-size:18px;font-weight:700;border-top:2px solid #111;border-bottom:0;padding-top:10px}
  .foot{margin-top:28px;font-size:11px;color:#6b7280}
  @media print{body{padding:0} .noprint{display:none}}
</style></head><body>
<div class="head">
  <div><h1>Account statement</h1><div class="muted">${esc(studio)}${addr ? ` · ${esc(addr)}` : ''}</div></div>
  <div style="text-align:right"><div class="lbl">Prepared</div><div>${day(new Date().toISOString())}</div>${from || to ? `<div class="lbl" style="margin-top:8px">Period</div><div>${from ? day(from) : 'Start'} – ${to ? day(to) : 'Today'}</div>` : ''}</div>
</div>
<div class="parties">
  <div><div class="lbl">Renter</div><div><strong>${esc(renter.firstName)} ${esc(renter.lastName)}</strong></div><div class="muted">${esc([renter.email, renter.phone].filter(Boolean).join(' · '))}</div>${renter.businessName ? `<div class="muted">${esc(renter.businessName)}</div>` : ''}</div>
  <div><div class="lbl">Balance owing</div><div style="font-size:26px;font-weight:700;color:${closing > 0 ? '#b91c1c' : '#047857'}">${money(Math.max(closing, 0))}</div><div class="muted">${closing > 0 ? 'as of today' : 'nothing outstanding'}</div></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Item</th><th class="n">Charge</th><th class="n">Payment</th><th class="n">Balance</th></tr></thead>
  <tbody>
    ${from ? `<tr><td>${day(from)}</td><td><em>Opening balance</em></td><td class="n"></td><td class="n"></td><td class="n">${money(opening)}</td></tr>` : ''}
    ${rows.map((l) => `<tr class="${l.kind}"><td>${day(l.date)}</td><td>${esc(l.label)}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ''}</td><td class="n">${l.cents > 0 ? money(l.cents) : ''}</td><td class="n">${l.cents < 0 ? money(-l.cents) : ''}</td><td class="n">${money(l.running)}</td></tr>`).join('')}
    ${rows.length === 0 ? '<tr><td colspan="5" class="muted">No activity in this period.</td></tr>' : ''}
  </tbody>
</table>
<div class="totals">
  <div><span>Charges &amp; fees</span><span>${money(charges)}</span></div>
  <div><span>Payments &amp; credits</span><span>${money(-credits)}</span></div>
  <div class="big"><span>${closing > 0 ? 'Balance owing' : 'Balance'}</span><span>${money(closing)}</span></div>
</div>
<div class="foot">Late fees follow the lease's late-fee policy and grace period. Payments apply to the oldest open invoice first. Questions: ${esc(tenant.email || tenant.phone || studio)}.</div>
<div class="noprint" style="margin-top:20px"><button onclick="window.print()" style="padding:10px 16px;border:2px solid #111;background:#111;color:#fff;border-radius:10px;font-weight:700">Print / Save as PDF</button></div>
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
