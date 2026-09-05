/**
 * /api/booths/account-statement
 *
 * GET ?tenantId=&renterId=[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 * GET ?tenantId=&renterId=&receipt=<rentLedger payment id>
 * GET ?tenantId=&renterId=&mode=full[&from=&to=]
 *
 * mode=full is the FULL ACCOUNT RECORD: the same statement, followed by the
 * whole timeline — every charge, payment, notice (with whether it was opened),
 * maintenance ticket, lease event, autopay change and bar — from the shared
 * renter-timeline module. When there is a dispute, this is the document: the
 * account tells the entire story without anyone assembling it.
 *
 * The statement ends with a REMITTANCE STUB — the tear-off slip from a paper
 * bill: who to make the check out to, where to mail it, the account, the
 * amount due, and "amount enclosed ____". Someone paying by cash or check
 * sends the stub back (or hands it over), which is what makes the payment
 * matchable when it arrives. Payable-to and the mailing address come from the
 * shop's Collections settings, falling back to its name and address.
 *
 * With ?receipt=, the same route renders a PAYMENT RECEIPT for one recorded
 * payment: date, method, amount, which invoices it settled, and the balance
 * left afterwards — the piece of paper that goes back to the person who
 * handed over cash.
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
import { buildRenterTimeline, withRunningBalance, TIMELINE_ACTOR_LABEL } from '@/lib/renter-timeline';

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
  const receiptId = String(sp.get('receipt') || '').trim();
  const fullMode = sp.get('mode') === 'full';

  const db = getAdminDb();
  const [tSnap, rSnap, invSnap, ledSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}/renters/${renterId}`).get(),
    db.collection(`tenants/${tenantId}/rentInvoices`).where('renterId', '==', renterId).get(),
    db.collection(`tenants/${tenantId}/rentLedger`).where('renterId', '==', renterId).get(),
  ]);
  // The rest of the record, only when it will be printed.
  const [leaseSnap, msgSnap, tktSnap, thrSnap] = fullMode ? await Promise.all([
    db.collection(`tenants/${tenantId}/leases`).where('renterId', '==', renterId).get(),
    db.collection(`tenants/${tenantId}/messageLog`).where('recipientId', '==', renterId).get(),
    db.collection(`tenants/${tenantId}/tickets`).where('renterId', '==', renterId).get(),
    db.collection(`tenants/${tenantId}/renterThreads/${renterId}/messages`).get(),
  ]) : [null, null, null, null];
  if (!rSnap.exists) return new NextResponse('Renter not found', { status: 404 });
  const tenant = (tSnap.data() as any) || {};
  const renter = rSnap.data() as any;
  const studio = tenant.name || tenant.businessName || 'The studio';
  const addr = [tenant.address?.street || tenant.address?.line1, tenant.address?.city, tenant.address?.state, tenant.address?.zip || tenant.address?.postalCode].filter(Boolean).join(', ');

  const remit = (tenant.collectionsPolicy || {}) as any;
  const payableTo = String(remit.payableTo || '').trim() || studio;
  const remitAddress = String(remit.remitAddress || '').trim() || addr;
  // The app's own typography — Plus Jakarta Sans, black-weight headings,
  // tracked-out uppercase labels, tabular numerals, 2rem-radius cards on a
  // slate-50 page — so a printed statement reads as a page OF the app, not a
  // document from somewhere else.
  const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap');
  *{box-sizing:border-box}
  body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;margin:0;padding:32px;max-width:860px;background:#f8fafc;-webkit-font-smoothing:antialiased}
  h1{font-size:28px;font-weight:800;margin:0 0 4px;letter-spacing:-.03em;text-transform:uppercase;line-height:1}
  .muted{color:#64748b;font-size:12px;font-weight:600}
  .kicker{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.25em;color:#64748b;opacity:.7;margin-bottom:6px}
  .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px;padding:22px 24px;background:#fff;border:2px solid #e2e8f0;border-radius:2rem}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;padding:20px 24px;background:#fff;border:2px solid #e2e8f0;border-radius:2rem}
  .lbl{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;margin-bottom:4px}
  .card{background:#fff;border:2px solid #e2e8f0;border-radius:2rem;padding:18px 24px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px;font-weight:600}
  th{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;text-align:left;padding:10px 6px;border-bottom:2px solid #e2e8f0}
  td{padding:11px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top} td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:800}
  tr.late_fee td{color:#b91c1c} tr.payment td,tr.credit td{color:#047857} tr.write_off td{color:#64748b;font-style:italic}
  .detail{color:#64748b;font-size:11px;font-weight:600} .totals{margin-top:16px;margin-left:auto;width:340px;font-size:13px;font-weight:700}
  .totals div{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9} .totals .big{font-size:22px;font-weight:800;letter-spacing:-.02em;border-top:2px solid #0f172a;border-bottom:0;padding-top:12px;font-variant-numeric:tabular-nums}
  .foot{margin-top:24px;font-size:11px;font-weight:600;color:#64748b}
  .tear{margin-top:36px;border-top:2px dashed #94a3b8;padding-top:6px;position:relative}
  .tear:before{content:"✂ detach and return with payment";position:absolute;top:-9px;left:0;background:#f8fafc;padding-right:8px;font-size:9px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.14em}
  .stub{display:grid;grid-template-columns:1.2fr 1fr;gap:20px;margin-top:14px;padding:20px 24px;background:#fff;border:2px solid #0f172a;border-radius:2rem;page-break-inside:avoid}
  .stub .field{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600}
  .stub .field span:last-child{font-variant-numeric:tabular-nums;text-align:right;font-weight:800}
  .stub .blank{border-bottom:2px solid #0f172a;min-width:120px;display:inline-block}
  .stamp{display:inline-block;padding:8px 14px;border:2px solid #047857;color:#047857;border-radius:999px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:10px}
  .btn{padding:12px 18px;border:0;background:#0f172a;color:#fff;border-radius:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-family:inherit}
  @media print{body{padding:0;background:#fff} .noprint{display:none} .head,.parties,.card,.stub{border-color:#cbd5e1}}`;

  /* ── Receipt for one payment ─────────────────────────────────────────── */
  if (receiptId) {
    const pd = ledSnap.docs.find((d) => d.id === receiptId);
    if (!pd) return new NextResponse('Payment not found', { status: 404 });
    const pay = pd.data() as any;
    if (pay.type !== 'payment' || (Number(pay.amountCents) || 0) >= 0) return new NextResponse('Not a payment', { status: 400 });
    const paidCents = -Number(pay.amountCents);
    const applied = invSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((i) => i.ledgerEntryId === receiptId);
    const balanceAfter = [...invSnap.docs.map((d) => d.data() as any)]
      .filter((i) => i.status === 'due' || i.status === 'late')
      .reduce((n, i) => n + (Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0) - (Number(i.paidCents) || 0), 0);
    const methodLabel: Record<string, string> = { cash: 'Cash', check: 'Check', zelle: 'Zelle', venmo: 'Venmo', card: 'Card', write_off: 'Write-off' };
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt — ${esc(renter.firstName)} ${esc(renter.lastName)}</title><style>${styles}</style></head><body>
<div class="head">
  <div><div class="kicker">Booth rental</div><h1>Payment receipt</h1><div class="muted">${esc(studio)}${addr ? ` · ${esc(addr)}` : ''}</div></div>
  <div style="text-align:right"><div class="lbl">Receipt no.</div><div style="font-family:ui-monospace,monospace">${esc(receiptId.slice(0, 8).toUpperCase())}</div><div class="lbl" style="margin-top:8px">Date</div><div>${day(pay.paidAt || pay.createdAt)}</div></div>
</div>
<div class="parties">
  <div><div class="lbl">Received from</div><div><strong>${esc(renter.firstName)} ${esc(renter.lastName)}</strong></div><div class="muted">${esc([renter.email, renter.phone].filter(Boolean).join(' · '))}</div></div>
  <div><div class="lbl">Amount received</div><div style="font-size:26px;font-weight:700;color:#047857">${money(paidCents)}</div><div class="muted">by ${esc(methodLabel[String(pay.method || '')] || pay.method || pay.paymentMethod || 'payment')}${pay.note ? ` · ${esc(pay.note)}` : ''}</div></div>
</div>
<div class="card"><table><thead><tr><th>Applied to</th><th class="n">Amount</th></tr></thead><tbody>
  ${applied.length ? applied.map((i) => `<tr><td>Rent — ${esc(i.boothName || 'space')} <span class="detail">due ${day(i.dueDate)}${(Number(i.lateFeeCents) || 0) > 0 ? ` incl. ${money(Number(i.lateFeeCents))} late fee` : ''}</span></td><td class="n">${money((Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0))}${i.status !== 'paid' ? ' <span class="detail">(part)</span>' : ''}</td></tr>`).join('') : `<tr><td>On account</td><td class="n">${money(paidCents)}</td></tr>`}
</tbody></table></div>
<div class="totals">
  <div><span>Received</span><span>${money(paidCents)}</span></div>
  <div class="big"><span>Balance after this payment</span><span style="color:${balanceAfter > 0 ? '#b91c1c' : '#047857'}">${money(Math.max(balanceAfter, 0))}</span></div>
</div>
<p style="margin-top:20px"><span class="stamp">${balanceAfter > 0 ? 'Received — thank you' : 'Paid in full — thank you'}</span></p>
<div class="foot">Keep this receipt for your records. Questions: ${esc(tenant.email || tenant.phone || studio)}.</div>
<div class="noprint" style="margin-top:20px"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

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

  const nextDue = invSnap.docs.map((d) => d.data() as any).filter((i) => i.status === 'due' || i.status === 'late').map((i) => String(i.dueDate || '')).sort()[0] || '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Account statement — ${esc(renter.firstName)} ${esc(renter.lastName)}</title>
<style>${styles}</style></head><body>
<div class="head">
  <div><div class="kicker">Booth rental</div><h1>Account statement</h1><div class="muted">${esc(studio)}${addr ? ` · ${esc(addr)}` : ''}</div></div>
  <div style="text-align:right"><div class="lbl">Prepared</div><div>${day(new Date().toISOString())}</div>${from || to ? `<div class="lbl" style="margin-top:8px">Period</div><div>${from ? day(from) : 'Start'} – ${to ? day(to) : 'Today'}</div>` : ''}</div>
</div>
<div class="parties">
  <div><div class="lbl">Renter</div><div><strong>${esc(renter.firstName)} ${esc(renter.lastName)}</strong></div><div class="muted">${esc([renter.email, renter.phone].filter(Boolean).join(' · '))}</div>${renter.businessName ? `<div class="muted">${esc(renter.businessName)}</div>` : ''}</div>
  <div><div class="lbl">Balance owing</div><div style="font-size:26px;font-weight:700;color:${closing > 0 ? '#b91c1c' : '#047857'}">${money(Math.max(closing, 0))}</div><div class="muted">${closing > 0 ? 'as of today' : 'nothing outstanding'}</div></div>
</div>
<div class="card"><table>
  <thead><tr><th>Date</th><th>Item</th><th class="n">Charge</th><th class="n">Payment</th><th class="n">Balance</th></tr></thead>
  <tbody>
    ${from ? `<tr><td>${day(from)}</td><td><em>Opening balance</em></td><td class="n"></td><td class="n"></td><td class="n">${money(opening)}</td></tr>` : ''}
    ${rows.map((l) => `<tr class="${l.kind}"><td>${day(l.date)}</td><td>${esc(l.label)}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ''}</td><td class="n">${l.cents > 0 ? money(l.cents) : ''}</td><td class="n">${l.cents < 0 ? money(-l.cents) : ''}</td><td class="n">${money(l.running)}</td></tr>`).join('')}
    ${rows.length === 0 ? '<tr><td colspan="5" class="muted">No activity in this period.</td></tr>' : ''}
  </tbody>
</table></div>
<div class="totals">
  <div><span>Charges &amp; fees</span><span>${money(charges)}</span></div>
  <div><span>Payments &amp; credits</span><span>${money(-credits)}</span></div>
  <div class="big"><span>${closing > 0 ? 'Balance owing' : 'Balance'}</span><span>${money(closing)}</span></div>
</div>
<div class="foot">Late fees follow the lease's late-fee policy and grace period. Payments apply to the oldest open invoice first. Questions: ${esc(tenant.email || tenant.phone || studio)}.</div>
${fullMode ? (() => {
  const timeline = withRunningBalance(buildRenterTimeline({
    renter,
    leases: leaseSnap!.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    invoices: invSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    ledger: ledSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    messages: msgSnap!.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    tickets: tktSnap!.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    thread: thrSnap!.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
  })).filter((e) => (!from || String(e.at).slice(0, 10) >= from) && (!to || String(e.at).slice(0, 10) <= to));
  const stamp = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(String(iso).length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}) }); };
  return `
<div class="card" style="margin-top:24px;page-break-before:always">
  <div class="kicker">Full account record</div>
  <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;margin-bottom:12px">Every event on this account, newest first</div>
  <table><thead><tr><th>When</th><th>Event</th><th>By</th><th class="n">Amount</th><th class="n">Balance</th></tr></thead><tbody>
  ${timeline.map((e) => `<tr class="${e.kind}"><td style="white-space:nowrap">${stamp(e.at)}</td><td>${esc(e.title)}${e.detail ? `<div class="detail">${esc(e.detail)}</div>` : ''}</td><td class="detail">${esc(TIMELINE_ACTOR_LABEL[e.actor || ''] || e.actor || '')}</td><td class="n">${typeof e.amountCents === 'number' && e.kind !== 'booking' ? money(e.amountCents) : ''}</td><td class="n">${typeof (e as any).balanceCents === 'number' ? money(Math.max((e as any).balanceCents, 0)) : ''}</td></tr>`).join('')}
  ${timeline.length === 0 ? '<tr><td colspan="5" class="muted">Nothing on record for this period.</td></tr>' : ''}
  </tbody></table>
  <div class="foot">Notices show how far they got — delivered, opened, clicked — from the delivery log. "Automatic" means the app acted under a policy you set; "You" means someone at the studio did it by hand.</div>
</div>`;
})() : ''}

<div class="tear"></div>
<div class="stub">
  <div>
    <div class="lbl">Remit payment to</div>
    <div><strong>${esc(payableTo)}</strong></div>
    ${remitAddress ? `<div class="muted">${esc(remitAddress)}</div>` : ''}
    <div class="muted" style="margin-top:8px">Make checks payable to ${esc(payableTo)}. Write the account number on the memo line, or return this slip with your payment.</div>
    <div class="muted" style="margin-top:8px">Pay online any time: ${esc(`${(tenant.publicOrigin || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/rent/${tenantId}`)}</div>
  </div>
  <div>
    <div class="field"><span>Account</span><span style="font-family:ui-monospace,monospace">${esc(renterId.slice(0, 8).toUpperCase())}</span></div>
    <div class="field"><span>Renter</span><span>${esc(renter.firstName)} ${esc(renter.lastName)}</span></div>
    <div class="field"><span>Statement date</span><span>${day(new Date().toISOString())}</span></div>
    ${nextDue ? `<div class="field"><span>Oldest due date</span><span>${day(nextDue)}</span></div>` : ''}
    <div class="field"><span><strong>Amount due</strong></span><span><strong>${money(Math.max(closing, 0))}</strong></span></div>
    <div class="field" style="border-bottom:0"><span>Amount enclosed</span><span>$<span class="blank"></span></span></div>
  </div>
</div>
<div class="noprint" style="margin-top:20px"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
