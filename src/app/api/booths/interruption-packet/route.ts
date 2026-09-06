// src/app/api/booths/interruption-packet/route.ts
//
// THE PACKET. One print of a business interruption: timeline, the spaces it
// took out of service, what each renter was owed and what they were given,
// what was done about it and when, and every message the renters were sent.
// That is what goes to the shop's insurer; each renter's slice is what goes
// to theirs.
//
// Same rule as every print route here: it renders its own <html>, carries its
// own font link (globals never reach it), and reads the SAME arithmetic the
// card on /maintenance reads — so the number on the screen and the number on
// the page cannot disagree.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { INTERRUPTION_TYPE_LABEL, abatementProposals, exposureCents, interruptionDays, lossesByRenter, lossTotals, type InterruptionRecord } from '@/lib/interruptions';

export const dynamic = 'force-dynamic';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: any) => {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || '—';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim();
  const id = String(sp.get('id') || '').trim();
  // ?renter=<portalToken> → the RENTER'S statement: their slice only, proven
  // by the token their portal link carries. Without it, this is the shop's
  // packet on a capability URL like the account statement.
  const renterToken = String(sp.get('renter') || '').trim();
  if (!tenantId || !id) return new NextResponse('Missing tenantId or id', { status: 400 });

  const db = getAdminDb();
  const [tSnap, iSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}/interruptions/${id}`).get(),
  ]);
  if (!iSnap.exists) return new NextResponse('Interruption not found', { status: 404 });
  const tenant = (tSnap.data() as any) || {};
  const rec = { id: iSnap.id, ...(iSnap.data() as any) } as InterruptionRecord;
  const studio = String(tenant.name || tenant.businessName || 'The studio');

  const [leaseSnap, renterSnap, boothSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/leases`).get(),
    db.collection(`tenants/${tenantId}/renters`).get(),
    db.collection(`tenants/${tenantId}/booths`).get(),
  ]);
  const leases = leaseSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const renterById = new Map<string, any>(renterSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as any) }]));
  const boothById = new Map<string, any>(boothSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as any) }]));

  let renterScope: any = null;
  if (renterToken) {
    renterScope = [...renterById.values()].find((r) => r.portalToken && r.portalToken === renterToken) || null;
    if (!renterScope) return new NextResponse('That link is not valid', { status: 403 });
  }

  const lossSnap = await db.collection(`tenants/${tenantId}/interruptionLosses`).where('interruptionId', '==', id).get();
  const allLosses = lossSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const today = new Date().toISOString().slice(0, 10);
  const props = abatementProposals(rec, leases, boothById, renterById, today);
  const exp = exposureCents(props);
  const days = interruptionDays(rec.startDate, rec.endDate, today);

  // Every credit actually posted for this interruption, from the ledger —
  // the packet reports what was DONE, not what the card proposed.
  const ledgerSnap = await db.collection(`tenants/${tenantId}/rentLedger`).where('interruptionId', '==', id).get();
  const credits = ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  // What the renters were told: the shared remedy notes, in order.
  const shared = (rec.remedy || []).filter((r) => r.sharedWithRenters);
  const scope = (rec.affectedBoothIds || []).length === 0
    ? 'Whole studio — every leased space'
    : rec.affectedBoothIds.map((b) => boothById.get(b)?.name || 'Space').join(', ');

  if (renterScope) {
    const mine = allLosses.filter((l) => l.renterId === renterScope.id).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const tot = lossTotals(mine);
    const myCredit = credits.filter((c) => c.renterId === renterScope.id).reduce((a, c) => a + Math.abs(Number(c.amountCents) || 0), 0);
    const myProp = props.find((p) => p.renterId === renterScope.id);
    const name = `${renterScope.firstName || ''} ${renterScope.lastName || ''}`.trim() || 'Renter';
    const rs = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap');
    *{box-sizing:border-box} body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;margin:0;padding:32px;max-width:760px;background:#f8fafc}
    h1{font-size:26px;font-weight:800;margin:0 0 4px;letter-spacing:-.03em;text-transform:uppercase;line-height:1} h2{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:#64748b;margin:0 0 12px}
    .muted{color:#64748b;font-size:12px;font-weight:600} .kicker{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.25em;color:#64748b;opacity:.7;margin-bottom:6px}
    .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px;padding:22px 24px;background:#fff;border:2px solid #e2e8f0;border-radius:2rem}
    .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px} .fact{background:#fff;border:2px solid #e2e8f0;border-radius:1.25rem;padding:14px 16px}
    .lbl{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;margin-bottom:4px} .big{font-size:22px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
    .card{background:#fff;border:2px solid #e2e8f0;border-radius:2rem;padding:18px 24px;margin-bottom:20px;break-inside:avoid}
    table{width:100%;border-collapse:collapse;font-size:13px;font-weight:600} th{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;text-align:left;padding:10px 6px;border-bottom:2px solid #e2e8f0}
    td{padding:11px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top} td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:800} .detail{color:#64748b;font-size:11px;font-weight:600}
    .sig{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:28px} .sig div{border-top:2px solid #0f172a;padding-top:6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b}
    .foot{margin-top:24px;font-size:11px;font-weight:600;color:#64748b} @media print{body{background:#fff;padding:0}}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loss statement — ${esc(name)}</title><style>${rs}</style></head><body>
    <div class="head"><div><div class="kicker">Business interruption · loss statement</div><h1>${esc(name)}</h1><div class="muted">Renting at ${esc(studio)} · ${esc(myProp?.boothName || 'their space')}</div></div>
      <div style="text-align:right"><div class="lbl">Event</div><div style="font-weight:800">${esc(rec.title)}</div><div class="muted">${esc(INTERRUPTION_TYPE_LABEL[rec.type] || rec.type)} · ${day(rec.startDate)} – ${day(rec.endDate || today)}${rec.endDate ? '' : ' (ongoing)'}</div><div class="lbl" style="margin-top:8px">Printed</div><div class="muted">${day(today)}</div></div></div>
    <div class="facts"><div class="fact"><div class="lbl">Days logged</div><div class="big">${tot.days}</div></div><div class="fact"><div class="lbl">Appointments lost</div><div class="big">${tot.appointmentsLost}</div></div><div class="fact"><div class="lbl">Income lost · own estimate</div><div class="big">${money(tot.lostCents)}</div></div></div>
    <div class="card"><h2>Day by day · as recorded by the renter</h2>
      <table><thead><tr><th>Day</th><th>Appointments lost</th><th>Note</th><th style="text-align:right">Income lost</th></tr></thead><tbody>
      ${mine.length === 0 ? `<tr><td colspan="4" class="detail">Nothing logged.</td></tr>` : mine.map((l) => `<tr><td>${day(l.date)}</td><td>${Number(l.appointmentsLost) || 0}</td><td class="detail">${esc(l.note || '')}</td><td class="n">${money(Number(l.lostCents) || 0)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card"><h2>Rent, for the same days</h2>
      <div class="detail">Rent credited back by the studio for this event: <strong style="color:#047857">${money(myCredit)}</strong>${myProp ? ` · ${myProp.days} day${myProp.days === 1 ? '' : 's'} at ${money(myProp.dailyCents)}/day` : ''}. A rent credit covers the space; the losses above are the renter's own business income and are separate from it.</div></div>
    <div class="sig"><div>${esc(name)}</div><div>Date</div></div>
    <div class="foot">The day-by-day figures were entered by the renter in their own portal at the time; the studio can read them and cannot edit them. Event dates and the rent credit are from the studio's records. Amounts marked "own estimate" are the renter's estimate, not an audited figure.</div>
    </body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap');
  *{box-sizing:border-box}
  body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;margin:0;padding:32px;max-width:860px;background:#f8fafc;-webkit-font-smoothing:antialiased}
  h1{font-size:28px;font-weight:800;margin:0 0 4px;letter-spacing:-.03em;text-transform:uppercase;line-height:1}
  h2{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:#64748b;margin:0 0 12px}
  .muted{color:#64748b;font-size:12px;font-weight:600}
  .kicker{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.25em;color:#64748b;opacity:.7;margin-bottom:6px}
  .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px;padding:22px 24px;background:#fff;border:2px solid #e2e8f0;border-radius:2rem}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
  .fact{background:#fff;border:2px solid #e2e8f0;border-radius:1.25rem;padding:14px 16px}
  .lbl{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;margin-bottom:4px}
  .big{font-size:22px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .card{background:#fff;border:2px solid #e2e8f0;border-radius:2rem;padding:18px 24px;margin-bottom:20px;break-inside:avoid}
  table{width:100%;border-collapse:collapse;font-size:13px;font-weight:600}
  th{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;text-align:left;padding:10px 6px;border-bottom:2px solid #e2e8f0}
  td{padding:11px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top} td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:800}
  .detail{color:#64748b;font-size:11px;font-weight:600}
  .line{display:flex;gap:14px;padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600}
  .line .when{flex:0 0 110px;font-weight:800;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.08em;padding-top:2px}
  .tag{display:inline-block;margin-left:8px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#047857}
  .foot{margin-top:24px;font-size:11px;font-weight:600;color:#64748b}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:28px} .sig div{border-top:2px solid #0f172a;padding-top:6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b}
  @media print{body{background:#fff;padding:0}.head,.card,.fact{border-color:#cbd5e1}}
  `;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interruption packet — ${esc(rec.title)}</title><style>${styles}</style></head><body>
  <div class="head">
    <div><div class="kicker">Business interruption · packet</div><h1>${esc(rec.title)}</h1>
      <div class="muted">${esc(INTERRUPTION_TYPE_LABEL[rec.type] || rec.type)} · ${esc(studio)}</div></div>
    <div style="text-align:right"><div class="lbl">Status</div><div style="font-weight:800">${rec.status === 'open' ? 'Open — still going on' : 'Resolved'}</div>
      <div class="lbl" style="margin-top:8px">Printed</div><div class="muted">${day(today)}</div></div>
  </div>

  <div class="facts">
    <div class="fact"><div class="lbl">First day</div><div class="big" style="font-size:16px">${day(rec.startDate)}</div></div>
    <div class="fact"><div class="lbl">${rec.endDate ? 'Last day' : 'Counted to'}</div><div class="big" style="font-size:16px">${day(rec.endDate || today)}</div></div>
    <div class="fact"><div class="lbl">Days out of service</div><div class="big">${days}</div></div>
    <div class="fact"><div class="lbl">Rent credited</div><div class="big">${money(exp.paidCents)}</div></div>
  </div>

  <div class="card"><h2>Scope</h2>
    <div style="font-weight:700">${esc(scope)}</div>
    ${rec.note ? `<div class="detail" style="margin-top:8px">${esc(rec.note)}</div>` : ''}
  </div>

  <div class="card"><h2>Renters affected · rent owed back at a day's rent per unusable day</h2>
    <table><thead><tr><th>Renter</th><th>Space</th><th>Their rate</th><th>Days</th><th style="text-align:right">Owed</th><th style="text-align:right">Credited</th><th style="text-align:right">Still open</th></tr></thead><tbody>
    ${props.length === 0 ? `<tr><td colspan="7" class="detail">No active leases were affected.</td></tr>` : props.map((p) => `<tr>
      <td>${esc(p.renterName)}</td><td>${esc(p.boothName)}</td><td>${money(p.dailyCents)}/day</td><td>${p.days}</td>
      <td class="n">${money(p.fullCents)}</td><td class="n" style="color:#047857">${money(p.paidCents)}</td><td class="n">${money(p.owedCents)}</td></tr>`).join('')}
    </tbody></table>
    <div class="detail" style="margin-top:10px">Priced off each renter's own lease. Renters already on approved leave are excluded — their rent was already paused or reduced for these dates. Shop exposure at full abatement: ${money(exp.fullCents)}.</div>
  </div>

  <div class="card"><h2>Credits posted</h2>
    ${credits.length === 0 ? `<div class="detail">None yet.</div>` : credits.map((c) => {
      const r = renterById.get(c.renterId);
      return `<div class="line"><div class="when">${day(c.paidAt || c.createdAt)}</div><div style="flex:1">${esc(r ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : 'Renter')} · ${esc(c.description || 'Rent abatement')}</div><div class="n" style="font-weight:800;font-variant-numeric:tabular-nums;color:#047857">${money(Math.abs(Number(c.amountCents) || 0))}</div></div>`;
    }).join('')}
  </div>

  <div class="card"><h2>What renters say it cost them · their own logs</h2>
    ${allLosses.length === 0 ? `<div class="detail">No renter has logged losses for this event.</div>` : lossesByRenter(allLosses).map((g) => `
      <div class="line"><div class="when">${esc(g.renterName)}</div><div style="flex:1">${g.totals.days} day${g.totals.days === 1 ? '' : 's'} · ${g.totals.appointmentsLost} appointment${g.totals.appointmentsLost === 1 ? '' : 's'} lost</div><div class="n" style="font-weight:800;font-variant-numeric:tabular-nums">${money(g.totals.lostCents)}</div></div>`).join('')}
    <div class="detail" style="margin-top:10px">Entered by each renter from their own portal, not by the studio. These are their figures for their own insurer; they are not owed by the studio and are separate from rent credits.</div>
  </div>

  <div class="card"><h2>Remedy log · what was done, and when</h2>
    ${(rec.remedy || []).length === 0 ? `<div class="detail">Nothing logged.</div>` : (rec.remedy || []).map((r) => `<div class="line"><div class="when">${day(r.at)}</div><div style="flex:1">${esc(r.text)}${r.sharedWithRenters ? '<span class="tag">sent to renters</span>' : ''}</div></div>`).join('')}
  </div>

  <div class="card"><h2>What renters were told</h2>
    ${shared.length === 0 ? `<div class="detail">No updates were sent to renters from this record.</div>` : shared.map((r) => `<div class="line"><div class="when">${day(r.at)}</div><div style="flex:1">${esc(r.text)}</div></div>`).join('')}
    <div class="detail" style="margin-top:10px">Each message was also emailed and texted to every affected renter and sits in their portal thread, with delivery status, under Renters → Messages.</div>
  </div>

  <div class="sig"><div>For ${esc(studio)}</div><div>Date</div></div>
  <div class="foot">Prepared from records kept as the interruption happened. Rent credits shown are those actually posted to renter accounts; amounts still open are proposals, not commitments.</div>
  </body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
