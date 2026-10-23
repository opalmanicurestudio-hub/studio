/**
 * /api/booths/account-statement
 *
 * GET ?tenantId=&renterId=[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 * GET ?tenantId=&renterId=&receipt=<rentLedger payment id>
 * GET ?tenantId=&renterId=&mode=full[&from=&to=]
 * GET ?tenantId=&renterId=&mode=deposit      — deposit accounting
 * GET ?tenantId=&renterId=&mode=final        — move-out / final statement
 *
 * mode=deposit: agreed, collected, each deduction with its reason and date,
 * refunded, and what is returnable now — the document a deposit dispute is
 * settled with. mode=final: what they still owe (rent incl. fees, other
 * charges), the deposit position, and the net — refund due to them or
 * balance due from them — signed off by both parties. Both read the same
 * arithmetic as the renter card (deposit-accounting), so no two documents
 * can disagree about the money.
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
import { depositPosition, moveOutSummary, DEPOSIT_STATUS_LABEL } from '@/lib/deposit-accounting';
import { PRINT, PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';

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
  const mode = String(sp.get('mode') || '');
  const fullMode = mode === 'full';
  const depositMode = mode === 'deposit';
  const finalMode = mode === 'final';

  const db = getAdminDb();
  const [tSnap, rSnap, invSnap, ledSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}/renters/${renterId}`).get(),
    db.collection(`tenants/${tenantId}/rentInvoices`).where('renterId', '==', renterId).get(),
    db.collection(`tenants/${tenantId}/rentLedger`).where('renterId', '==', renterId).get(),
  ]);
  // The rest of the record, only when it will be printed.
  const leaseDocs = (depositMode || finalMode)
    ? (await db.collection(`tenants/${tenantId}/leases`).where('renterId', '==', renterId).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    : [];
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
  // The app's print look (lib/print-style) — Plus Jakarta Sans, light
  // headings, sentence-case labels in grey, thin lines, soft rounded panels,
  // tabular figures — so a printed statement reads as a page OF the app, not a
  // document from somewhere else. Money in is green; anything still owed, and
  // a late fee or deduction, is amber.
  const styles = `@page { margin: 0.55in; }
  ${PRINT_CSS}
  .pp .v { font-size: 13px; font-weight: 500; margin-top: 2px; }
  .pp .who { margin-bottom: 18px; }
  .pp .big { font-size: 26px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.15; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .pp .n { text-align: right; white-space: nowrap; }
  .pp .detail { font-size: 11px; color: ${PRINT.muted}; }
  .pp .detail a { color: ${PRINT.muted}; }
  .pp tr.late_fee td { color: ${PRINT.amber}; } .pp tr.payment td, .pp tr.credit td { color: ${PRINT.green}; } .pp tr.write_off td { color: ${PRINT.muted}; }
  .pp .totals { width: 320px; margin: 10px 0 0 auto; }
  .pp .totals .line.total { font-size: 14px; }
  .pp .stamp { margin-top: 18px; }
  .pp p.note { margin-top: 14px; }
  .pp .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 8px; }
  .pp .sig-line { height: 40px; border-bottom: 1px solid ${PRINT.ink}; }
  .pp .sig .lbl { margin-top: 6px; }
  .pp .tick { display: inline-block; width: 12px; height: 12px; margin: 0 4px 0 10px; border: 1px solid ${PRINT.faint}; border-radius: 3px; vertical-align: -2px; }
  .pp .tear { position: relative; margin: 34px 0 16px; border-top: 1.5px dashed #c9cacd; }
  .pp .tear span { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); padding: 0 10px; background: #fff; font-size: 11px; color: ${PRINT.faint}; white-space: nowrap; }
  .pp .stub { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; }
  .pp .stub .line > :last-child { white-space: normal; text-align: right; }
  .pp .stub .gap { margin-top: 8px; }
  .pp .blank { display: inline-block; min-width: 120px; border-bottom: 1px solid ${PRINT.ink}; }
  .pp .actions { margin-top: 20px; }
  .pp .btn { height: 40px; padding: 0 18px; border: 0; border-radius: 999px; background: ${PRINT.ink}; color: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }`;
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="${PRINT_FONT_HREF}" rel="stylesheet"><style>${styles}</style></head><body class="pp-screen"><div class="pp page">${body}</div></body></html>`;
  const head = (title: string, meta: string[]) => `<div class="head"><div><p class="shop">${esc(studio)}</p><h1>${title}</h1><p class="sub">Booth rental${addr ? ` · ${esc(addr)}` : ''}</p></div><div class="meta">${meta.map((m) => `<div>${m}</div>`).join('')}</div></div>`;
  const printButton = '<div class="no-print actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>';

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
    const html = page(`Receipt — ${esc(renter.firstName)} ${esc(renter.lastName)}`, `
${head('Payment <b>receipt</b>', [`Receipt no. ${esc(receiptId.slice(0, 8).toUpperCase())}`, day(pay.paidAt || pay.createdAt)])}
<div class="panel grid2 who">
  <div><p class="lbl">Received from</p><p class="v">${esc(renter.firstName)} ${esc(renter.lastName)}</p><p class="muted">${esc([renter.email, renter.phone].filter(Boolean).join(' · '))}</p></div>
  <div><p class="lbl">Amount received</p><p class="big ok">${money(paidCents)}</p><p class="muted">by ${esc(methodLabel[String(pay.method || '')] || pay.method || pay.paymentMethod || 'payment')}${pay.note ? ` · ${esc(pay.note)}` : ''}</p></div>
</div>
<table><thead><tr><th>Applied to</th><th class="n">Amount</th></tr></thead><tbody>
  ${applied.length ? applied.map((i) => `<tr><td>Rent — ${esc(i.boothName || 'space')} <span class="detail">due ${day(i.dueDate)}${(Number(i.lateFeeCents) || 0) > 0 ? ` incl. ${money(Number(i.lateFeeCents))} late fee` : ''}</span></td><td class="n">${money((Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0))}${i.status !== 'paid' ? ' <span class="detail">(part)</span>' : ''}</td></tr>`).join('') : `<tr><td>On account</td><td class="n">${money(paidCents)}</td></tr>`}
</tbody></table>
<div class="totals">
  <div class="line"><span>Received</span><span>${money(paidCents)}</span></div>
  <div class="line total"><span>Balance after this payment</span><span class="${balanceAfter > 0 ? 'warn' : 'ok'}">${money(Math.max(balanceAfter, 0))}</span></div>
</div>
<p class="stamp"><span class="pill ok">${balanceAfter > 0 ? 'Received — thank you' : 'Paid in full — thank you'}</span></p>
<p class="note">Keep this receipt for your records. Questions: ${esc(tenant.email || tenant.phone || studio)}.</p>
${printButton}`);
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  if (depositMode || finalMode) {
    const ledger = ledSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const invoices = invSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    // The lease this is about: the live one, else the most recently ended.
    const lease = leaseDocs.find((l) => ['active', 'on_leave', 'pending_signature'].includes(String(l.status)))
      || [...leaseDocs].sort((a, b) => String(b.endedAt || b.endDate || '').localeCompare(String(a.endedAt || a.endDate || '')))[0];
    if (!lease) return new NextResponse('No lease on record for this renter', { status: 404 });
    const dep = depositPosition(lease, ledger);
    const mo = moveOutSummary(lease, invoices, ledger);
    const space = lease.boothName || 'space';
    const title = depositMode ? 'Deposit accounting' : 'Move-out statement';
    const html = page(`${title} — ${esc(renter.firstName)} ${esc(renter.lastName)}`, `
${head(depositMode ? 'Deposit <b>accounting</b>' : 'Move-out <b>statement</b>', [`Prepared ${day(new Date().toISOString())}`, `Lease: ${esc(space)} · ${day(lease.startDate)}${lease.endDate || lease.endedAt ? ` – ${day(lease.endedAt || lease.endDate)}` : ' – present'}`])}
<div class="panel grid2 who">
  <div><p class="lbl">Renter</p><p class="v">${esc(renter.firstName)} ${esc(renter.lastName)}</p><p class="muted">${esc([renter.email, renter.phone].filter(Boolean).join(' · '))}</p></div>
  <div><p class="lbl">${finalMode ? (mo.netCents >= 0 ? 'Refund due to renter' : 'Balance due from renter') : 'Returnable today'}</p><p class="big ${(finalMode ? mo.netCents : dep.returnableCents) >= 0 ? 'ok' : 'warn'}">${money(Math.abs(finalMode ? mo.netCents : dep.returnableCents))}</p><p class="muted">${DEPOSIT_STATUS_LABEL[dep.status]}</p></div>
</div>

<div>
  <h2>Deposit</h2>
  <table><thead><tr><th>Item</th><th class="n">Amount</th></tr></thead><tbody>
    <tr><td>Agreed in the lease${dep.conditions ? `<div class="detail">${esc(dep.conditions)}</div>` : ''}${dep.refundable ? '' : '<div class="detail">Non-refundable</div>'}</td><td class="n">${money(dep.agreedCents)}</td></tr>
    <tr><td>Collected</td><td class="n">${money(dep.collectedCents)}</td></tr>
    ${dep.deductions.map((d) => `<tr class="late_fee"><td>Deduction — ${esc(d.reason)}<div class="detail">${day(d.at)}${d.by ? ` · ${esc(d.by)}` : ''}${(d.evidenceUrls || []).length ? ` · ${(d.evidenceUrls || []).map((u, i) => `<a href="${esc(u)}">photo ${i + 1}</a>`).join(', ')}` : ''}</div></td><td class="n">−${money(d.cents)}</td></tr>`).join('')}
    ${dep.refundedCents > 0 ? `<tr class="payment"><td>Refunded</td><td class="n">−${money(dep.refundedCents)}</td></tr>` : ''}
    ${dep.forfeitedCents > 0 ? `<tr class="write_off"><td>Applied to balance</td><td class="n">−${money(dep.forfeitedCents)}</td></tr>` : ''}
  </tbody></table>
  <div class="totals">
    <div class="line"><span>Held by the studio</span><span>${money(dep.heldCents)}</span></div>
    <div class="line"><span>Less deductions</span><span>−${money(dep.deductedCents)}</span></div>
    <div class="line total"><span>Returnable</span><span>${money(dep.returnableCents)}</span></div>
  </div>
</div>

${finalMode ? `
<div>
  <h2>Still owed at move-out</h2>
  <table><thead><tr><th>Item</th><th class="n">Amount</th></tr></thead><tbody>
    ${invoices.filter((i) => i.leaseId === lease.id && (i.status === 'due' || i.status === 'late')).map((i) => `<tr><td>Rent due ${day(i.dueDate)}${(Number(i.lateFeeCents) || 0) > 0 ? `<div class="detail">incl. ${money(Number(i.lateFeeCents))} late fee</div>` : ''}${(Number(i.paidCents) || 0) > 0 ? `<div class="detail">less ${money(Number(i.paidCents))} paid</div>` : ''}</td><td class="n">${money((Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0) - (Number(i.paidCents) || 0))}</td></tr>`).join('')}
    ${mo.otherChargesCents > 0 ? `<tr><td>Other open charges<div class="detail">keys, damages, incidentals</div></td><td class="n">${money(mo.otherChargesCents)}</td></tr>` : ''}
    ${mo.owedCents === 0 ? '<tr><td class="muted">Nothing outstanding</td><td class="n">$0.00</td></tr>' : ''}
  </tbody></table>
  <div class="totals">
    <div class="line"><span>Owed by renter</span><span>${money(mo.owedCents)}</span></div>
    <div class="line"><span>Deposit returnable</span><span>${money(dep.returnableCents)}</span></div>
    <div class="line total"><span>${mo.netCents >= 0 ? 'Refund due to renter' : 'Balance due from renter'}</span><span class="${mo.netCents >= 0 ? 'ok' : 'warn'}">${money(Math.abs(mo.netCents))}</span></div>
  </div>
</div>
<div class="keep">
  <h2>Acknowledged</h2>
  <div class="sig">
    <div><div class="sig-line"></div><p class="lbl">Renter · date</p></div>
    <div><div class="sig-line"></div><p class="lbl">${esc(studio)} · date</p></div>
  </div>
  <p class="note">Keys, access cards and studio property returned:<span class="tick"></span>Yes<span class="tick"></span>No — note: ______________________</p>
</div>` : ''}
<p class="note">${depositMode ? 'Deductions are itemized with their reason and date. Anything not listed here has not been deducted.' : 'The deposit returnable is applied against the balance owed; the difference is what moves, and in which direction.'} Questions: ${esc(tenant.email || tenant.phone || studio)}.</p>
${printButton}`);
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
  const html = page(`Account statement — ${esc(renter.firstName)} ${esc(renter.lastName)}`, `
${head('Account <b>statement</b>', [`Prepared ${day(new Date().toISOString())}`, ...(from || to ? [`Period ${from ? day(from) : 'Start'} – ${to ? day(to) : 'Today'}`] : [])])}
<div class="panel grid2 who">
  <div><p class="lbl">Renter</p><p class="v">${esc(renter.firstName)} ${esc(renter.lastName)}</p><p class="muted">${esc([renter.email, renter.phone].filter(Boolean).join(' · '))}</p>${renter.businessName ? `<p class="muted">${esc(renter.businessName)}</p>` : ''}</div>
  <div><p class="lbl">Balance owing</p><p class="big ${closing > 0 ? 'warn' : 'ok'}">${money(Math.max(closing, 0))}</p><p class="muted">${closing > 0 ? 'as of today' : 'nothing outstanding'}</p></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Item</th><th class="n">Charge</th><th class="n">Payment</th><th class="n">Balance</th></tr></thead>
  <tbody>
    ${from ? `<tr><td class="nowrap">${day(from)}</td><td class="muted">Opening balance</td><td class="n"></td><td class="n"></td><td class="n">${money(opening)}</td></tr>` : ''}
    ${rows.map((l) => `<tr class="${l.kind}"><td class="nowrap">${day(l.date)}</td><td>${esc(l.label)}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ''}</td><td class="n">${l.cents > 0 ? money(l.cents) : ''}</td><td class="n">${l.cents < 0 ? money(-l.cents) : ''}</td><td class="n">${money(l.running)}</td></tr>`).join('')}
    ${rows.length === 0 ? '<tr><td colspan="5" class="muted">No activity in this period.</td></tr>' : ''}
  </tbody>
</table>
<div class="totals">
  <div class="line"><span>Charges &amp; fees</span><span>${money(charges)}</span></div>
  <div class="line"><span>Payments &amp; credits</span><span>${money(-credits)}</span></div>
  <div class="line total"><span>${closing > 0 ? 'Balance owing' : 'Balance'}</span><span>${money(closing)}</span></div>
</div>
<p class="note">Late fees follow the lease's late-fee policy and grace period. Payments apply to the oldest open invoice first. Questions: ${esc(tenant.email || tenant.phone || studio)}.</p>
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
<div class="break">
  <h2>Full account record</h2>
  <p class="muted" style="margin-bottom:10px">Every event on this account, newest first</p>
  <table><thead><tr><th>When</th><th>Event</th><th>By</th><th class="n">Amount</th><th class="n">Balance</th></tr></thead><tbody>
  ${timeline.map((e) => `<tr class="${e.kind}"><td class="nowrap">${stamp(e.at)}</td><td>${esc(e.title)}${e.detail ? `<div class="detail">${esc(e.detail)}</div>` : ''}</td><td class="detail">${esc(TIMELINE_ACTOR_LABEL[e.actor || ''] || e.actor || '')}</td><td class="n">${typeof e.amountCents === 'number' && e.kind !== 'booking' ? money(e.amountCents) : ''}</td><td class="n">${typeof (e as any).balanceCents === 'number' ? money(Math.max((e as any).balanceCents, 0)) : ''}</td></tr>`).join('')}
  ${timeline.length === 0 ? '<tr><td colspan="5" class="muted">Nothing on record for this period.</td></tr>' : ''}
  </tbody></table>
  <p class="note">Notices show how far they got — delivered, opened, clicked — from the delivery log. "Automatic" means the app acted under a policy you set; "You" means someone at the studio did it by hand.</p>
</div>`;
})() : ''}

<div class="keep">
<div class="tear"><span>Detach and return with your payment</span></div>
<div class="box stub">
  <div>
    <p class="lbl">Remit payment to</p>
    <p class="v">${esc(payableTo)}</p>
    ${remitAddress ? `<p class="muted">${esc(remitAddress)}</p>` : ''}
    <p class="muted gap">Make checks payable to ${esc(payableTo)}. Write the account number on the memo line, or return this slip with your payment.</p>
    <p class="muted gap">Pay online any time: ${esc(`${(tenant.publicOrigin || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/rent/${tenantId}`)}</p>
  </div>
  <div>
    <div class="line"><span>Account</span><span>${esc(renterId.slice(0, 8).toUpperCase())}</span></div>
    <div class="line"><span>Renter</span><span>${esc(renter.firstName)} ${esc(renter.lastName)}</span></div>
    <div class="line"><span>Statement date</span><span>${day(new Date().toISOString())}</span></div>
    ${nextDue ? `<div class="line"><span>Oldest due date</span><span>${day(nextDue)}</span></div>` : ''}
    <div class="line"><span><b>Amount due</b></span><span><b>${money(Math.max(closing, 0))}</b></span></div>
    <div class="line" style="border-bottom:0"><span>Amount enclosed</span><span>$<span class="blank"></span></span></div>
  </div>
</div>
</div>
${printButton}`);

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
