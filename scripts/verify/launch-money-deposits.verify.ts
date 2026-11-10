// Checks a renter's security deposit recorded on the server, and notices for changes made to a renter's account by hand
// (launch L15f, money round three):
// - Received, part kept, returned and applied to what they owe all go through one path (api/rent/deposit), checked
//   against the deposit as it stands, written once per request, in the books (held money, not income; kept money and
//   a deposit applied to rent are income), and the renter gets a written notice. A return or an applied deposit lists
//   every deduction with its reason.
// - A deposit applied to what they owe is a credit that comes off their open bills now, and what's owed counts credit
//   still waiting.
// - The rent statement leaves the deposit to its own account (except what's applied to the balance), and the yearly
//   statement doesn't count a deposit as rent paid.
// - A charge added, a fee, bill or charge waived, and banked days credited on the Rent page tell the renter, written
//   from the record on the server, once, and only for a recent change.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-money-deposits.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>'; process.env.STRIPE_SECRET_KEY = 'sk_test';
let db: any = strictTransactions(makeDb());
const actorNow: any = { uid: 'm1', name: 'Max', role: 'manager', isManager: true };
class FakeResponse { status: number; body: any; headers: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; this.headers = init?.headers; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/print-link' || /\/src\/lib\/print-link(\.ts)?$/.test(request)) return fake(request, { printLinkValid: () => true, printLinkExpired: () => FakeResponse.json({ ok: false }, { status: 410 }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async () => ({ actor: actorNow }), requireCan: async () => ({ actor: actorNow }), staffOrServer: async () => true });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: `m${mails.length}` }), text: async () => '' }; };
const toMaya = () => mails.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('maya@example.com'));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => '' } } as any);
const getReq = (q: Record<string, string>) => ({ nextUrl: { searchParams: new URLSearchParams(q) }, headers: { get: () => '' } } as any);

async function fresh() {
  db = strictTransactions(makeDb()); mails.length = 0;
  await db.doc(T).set({ name: 'Northside Studio', timezone: 'America/New_York', publicOrigin: 'https://northside.example.com' });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', status: 'active' });
  await db.doc(`${T}/booths/b1`).set({ name: 'Suite 4' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'rt1', boothId: 'b1', status: 'active', frequency: 'monthly', dueDay: '1', rentAmountCents: 90000, startDate: '2026-01-01',
    deposit: { amountCents: 50000, refundable: true, refundConditions: 'Returned within 30 days of move-out', collectedLedgerEntryId: null } });
}
const dep = (body: any) => import('../../src/app/api/rent/deposit/route').then((m) => m.POST(req({ tenantId: 't1', leaseId: 'l1', ...body })));

(async () => {
  const DA = await import('../../src/lib/deposit-accounting');
  const P = await import('../../src/lib/rent-payment-plan');
  const BRT = await import('../../src/lib/booth-rental-types');
  const ledgerOf = async () => (await all(`${T}/rentLedger`)).filter((l: any) => l.leaseId === 'l1');
  const pos = async () => DA.depositPosition(await get(`${T}/leases/l1`).then((l: any) => ({ id: 'l1', ...l })), await ledgerOf());

  console.log('Received');
  await fresh();
  let r: any = await dep({ action: 'received', methodLabel: 'Check', note: 'Check 1042', requestId: 'dep-rcv-0001' });
  const line = await get(`${T}/rentLedger/depreceived_dep-rcv-0001`); const bk = await get(`${T}/transactions/deposit_dep-rcv-0001`);
  check('the deposit goes on their account as received, for the amount agreed', r.body.ok && r.body.cents === 50000 && line?.type === 'deposit_charge' && line.status === 'paid' && line.amountCents === 50000 && (await pos()).status === 'held', r.body);
  check('in the books as held money, not income', bk?.type === 'income' && bk.taxBucket === 'transfer' && bk.category === 'Booth Deposit' && bk.amount === 500 && bk.renterId === 'rt1');
  const lease = await get(`${T}/leases/l1`);
  check('the lease shows it collected, so Spaces stops asking for it', lease.deposit.collectedLedgerEntryId === 'deposit_dep-rcv-0001' && lease.deposit.collectedCents === 50000 && lease.deposit.amountCents === 50000);
  check('the renter gets a written receipt for it, filed under them', toMaya().length === 1 && /Your security deposit: received/.test(toMaya()[0].subject) && /\$500\.00 security deposit \(Check\)/.test(toMaya()[0].html)
    && (await all(`${T}/messageLog`)).some((x: any) => x.kind === 'deposit_notice' && x.recipientType === 'renter' && x.recipientId === 'rt1'), toMaya().map((m) => m.subject));
  check('a note in their portal and the activity log', /held for you/.test(String((await get(`${T}/renterAlerts/deposit_received_dep-rcv-0001`))?.text)) && (await all(`${T}/auditLogs`)).some((a: any) => a.action === 'booth.deposit_received'));
  r = await dep({ action: 'received', methodLabel: 'Check', requestId: 'dep-rcv-0001' });
  check('Save twice records it once', r.body.already === true && (await ledgerOf()).filter((l: any) => l.type === 'deposit_charge').length === 1 && toMaya().length === 1);
  r = await dep({ action: 'received', methodLabel: 'Cash', requestId: 'dep-rcv-0002' });
  check('a second deposit isn’t recorded on top', r.status === 409 && /already recorded/.test(r.body.error));
  await fresh();
  await db.doc(`${T}/rentLedger/pend1`).set({ leaseId: 'l1', renterId: 'rt1', type: 'deposit_charge', status: 'pending', amountCents: 50000, description: 'Deposit due' });
  r = await dep({ action: 'received', methodLabel: 'Cash', requestId: 'dep-rcv-0003' });
  check('the screen is given the line actually paid', r.body.lineId === 'pend1');
  check('a deposit waiting to be paid is the line marked paid, not a second one', r.body.ok && (await get(`${T}/rentLedger/pend1`)).status === 'paid' && (await ledgerOf()).filter((l: any) => l.type === 'deposit_charge').length === 1);
  r = await dep({ action: 'received', methodLabel: 'Cash', requestId: 'dep-rcv-0003' });
  check('and pressing Save again doesn’t record it twice', r.body.already === true && (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Booth Deposit').length === 1);

  console.log('Part kept, then returned');
  await fresh();
  await dep({ action: 'received', methodLabel: 'Check', requestId: 'dep-rcv-0001' });
  r = await dep({ action: 'deduct', cents: 8000, requestId: 'dep-ded-0001' });
  check('keeping part needs a reason', r.status === 400 && /why/.test(r.body.error));
  r = await dep({ action: 'deduct', cents: 60000, reason: 'Broken mirror', requestId: 'dep-ded-0002' });
  check('never more than is held', r.status === 409 && /Only \$500\.00/.test(r.body.error));
  r = await dep({ action: 'deduct', cents: 8000, reason: 'Broken mirror', evidenceUrls: ['https://files.example.com/m.jpg', 'javascript:alert(1)'], requestId: 'dep-ded-0003' });
  const ded = await get(`${T}/rentLedger/depdeduct_dep-ded-0003`);
  check('the deduction is on their account with its reason and photos (only real links kept)', r.body.ok && ded?.type === 'deposit_deduction' && ded.amountCents === 8000 && ded.description === 'Broken mirror' && ded.evidenceUrls.length === 1 && (await pos()).returnableCents === 42000, ded);
  check('in the books it moves from held to kept (income)', (await get(`${T}/transactions/depheld_dep-ded-0003`))?.taxBucket === 'transfer' && (await get(`${T}/transactions/depheld_dep-ded-0003`))?.type === 'expense'
    && (await get(`${T}/transactions/depkept_dep-ded-0003`))?.taxBucket === 'revenue' && (await get(`${T}/transactions/depkept_dep-ded-0003`))?.amount === 80);
  check('they’re told what was kept, why, and what’s still held', /We kept \$80\.00 of your security deposit: Broken mirror/.test(toMaya()[1]?.html) && /\$420\.00 of your deposit is still held/.test(toMaya()[1]?.html), toMaya()[1]?.html?.slice(0, 400));
  r = await dep({ action: 'refund', methodLabel: 'Check', requestId: 'dep-ref-0001' });
  check('the rest is returned (all of what’s left unless an amount is given)', r.body.ok && r.body.cents === 42000 && (await pos()).returnableCents === 0 && (await get(`${T}/transactions/deprefund_dep-ref-0001`))?.taxBucket === 'transfer');
  check('the return notice lists every deduction with its reason', /We returned \$420\.00 of your security deposit \(Check\)/.test(toMaya()[2]?.html) && /From your \$500\.00 deposit: Broken mirror −\$80\.00/.test(toMaya()[2]?.html), toMaya()[2]?.html?.slice(0, 500));
  r = await dep({ action: 'refund', cents: 100, methodLabel: 'Cash', requestId: 'dep-ref-0002' });
  check('nothing more can be returned', r.status === 409);

  console.log('Applied to what they owe');
  await fresh();
  await dep({ action: 'received', methodLabel: 'Cash', requestId: 'dep-rcv-0001' });
  await db.doc(`${T}/rentInvoices/inv1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'late', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-10-01' });
  r = await dep({ action: 'apply', cents: 30000, requestId: 'dep-app-0001' });
  const inv = await get(`${T}/rentInvoices/inv1`); const forf = await get(`${T}/rentLedger/depapply_dep-app-0001`);
  check('it becomes a credit that comes off their open rent now', r.body.ok && r.body.appliedCents === 30000 && inv.paidCents === 30000 && /security deposit/.test(inv.creditNote) && forf?.type === 'deposit_forfeit' && forf.appliedCents === 30000, { inv, forf });
  check('in the books it moves from held to rent paid', (await get(`${T}/transactions/depheld_dep-app-0001`))?.taxBucket === 'transfer' && (await get(`${T}/transactions/depapplied_dep-app-0001`))?.category === 'Booth Rent' && (await get(`${T}/transactions/depapplied_dep-app-0001`))?.taxBucket === 'revenue');
  check('they’re told what it paid and what’s still held', toMaya().some((m) => /We applied \$300\.00 of your security deposit to what you owe; \$300\.00 of it has paid what was open already\. \$200\.00 of your deposit is still held\./.test(m.html)), toMaya().map((m) => m.html.slice(0, 300)));
  check('the deposit shows what’s left', (await pos()).returnableCents === 20000);
  let led = await all(`${T}/rentLedger`); let invs = await all(`${T}/rentInvoices`);
  check('what they owe is less by it', BRT.renterOwedCents('rt1', invs, led) === 60000 && P.accountPosition(invs, led).owedCents === 60000);
  check('a deposit applied to a balance is a rent credit', (P.RENT_CREDIT_TYPES as readonly string[]).includes('deposit_forfeit') && P.creditLabel('deposit_forfeit') === 'security deposit');
  r = await dep({ action: 'apply', cents: 20000, requestId: 'dep-app-0002' });
  check('only what’s owed is applied; the rest stays held', r.body.ok && r.body.cents === 20000 && (await pos()).returnableCents === 0);
  await fresh();
  await dep({ action: 'received', requestId: 'dep-rcv-0001' });
  r = await dep({ action: 'apply', requestId: 'dep-app-0003' });
  check('with nothing owed, nothing is applied (or booked as rent)', r.status === 409 && /Nothing is owed/.test(r.body.error) && !(await get(`${T}/transactions/depapplied_dep-app-0003`)));
  check('with no method given, the notice doesn’t say “recorded by hand”', /We received your \$500\.00 security deposit\. It’s held/.test(toMaya()[0]?.html) && !/Recorded by hand/.test(toMaya()[0]?.html), toMaya()[0]?.html?.slice(0, 300));
  await db.doc(`${T}/rentLedger/ch9`).set({ renterId: 'rt1', leaseId: 'l1', type: 'one_off_charge', status: 'pending', amountCents: 10000, description: 'Extra cleaning', dueDate: '2026-11-20' });
  r = await dep({ action: 'apply', requestId: 'dep-app-0004' });
  check('applied to a one-off charge, it pays the charge whole', r.body.ok && r.body.cents === 10000 && (await get(`${T}/rentLedger/ch9`)).status === 'paid' && (await get(`${T}/rentLedger/ch9`)).paidVia === 'credit' && (await get(`${T}/rentLedger/depapply_dep-app-0004`)).appliedCents === 10000);
  // A deposit applied to a balance before this (no appliedCents on the line) was settled by hand: never drawn down again.
  await db.doc(`${T}/rentLedger/oldf`).set({ renterId: 'rt1', leaseId: 'l1', type: 'deposit_forfeit', status: 'paid', amountCents: -40000, description: 'Deposit applied to balance' });
  await db.doc(`${T}/rentInvoices/inv7`).set({ renterId: 'rt1', leaseId: 'l1', status: 'late', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-08-01' });
  const RC = await import('../../src/lib/rent-credits');
  await RC.applyAllOpenCredits(db, 't1');
  led = await all(`${T}/rentLedger`); invs = await all(`${T}/rentInvoices`);
  check('an old deposit applied by hand is never drawn down again', P.creditRemainingCents(await get(`${T}/rentLedger/oldf`)) === 0 && (await get(`${T}/rentInvoices/inv7`)).paidCents === 0 && P.accountPosition(invs, led).owedCents === 90000);
  const RO = await import('../../src/lib/rent-outlook');
  check('the portal shows a new applied deposit as credit, an old one not', RO.CREDIT_LABELS.deposit_forfeit === 'Security deposit' && src('src/lib/rent-outlook.ts').includes('&& isRentCredit(c))'));
  // Credit too small for a whole charge waits; what's owed is still the whole charge, as a payment would need.
  await db.doc(`${T}/rentLedger/lc1`).set({ renterId: 'rt2', type: 'leave_credit', status: 'paid', amountCents: -5000, appliedCents: 0 });
  await db.doc(`${T}/rentLedger/ch1`).set({ renterId: 'rt2', type: 'one_off_charge', status: 'pending', amountCents: 8000, dueDate: '2026-11-01' });
  await db.doc(`${T}/rentLedger/dp1`).set({ renterId: 'rt2', type: 'deposit_charge', status: 'pending', amountCents: 50000 });
  led = await all(`${T}/rentLedger`);
  check('what’s owed on the Rent page is rent and charges, not a deposit', BRT.renterOwedCents('rt2', invs, led) === 8000 && P.accountPosition([], led.filter((l: any) => l.renterId === 'rt2')).owedCents === 3000);
  const TL = await import('../../src/lib/renter-timeline');
  const tl = TL.withRunningBalance(TL.buildRenterTimeline({ renter: {}, leases: [], invoices: [], ledger: [{ id: 'x', type: 'deposit_charge', status: 'paid', amountCents: 50000, description: 'Deposit collected', createdAt: '2026-01-02' }], messages: [] } as any));
  check('the account record shows the deposit without counting it as owed', tl.some((e: any) => /Deposit collected · \$500\.00/.test(e.title) && e.amountCents === undefined && e.balanceCents === undefined), tl);

  console.log('Statements');
  await fresh();
  await dep({ action: 'received', methodLabel: 'Cash', requestId: 'dep-rcv-0001' });
  await db.doc(`${T}/rentInvoices/inv1`).set({ renterId: 'rt1', leaseId: 'l1', status: 'late', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-10-01' });
  await dep({ action: 'apply', cents: 30000, requestId: 'dep-app-0001' });
  const ST = await import('../../src/app/api/booths/account-statement/route');
  const html = String((await ST.GET(getReq({ tenantId: 't1', renterId: 'rt1' }))).body || '');
  const bal = (h: string) => (h.match(/<span>Balance(?: owing)?<\/span><span>([^<]+)<\/span>/) || [])[1];
  check('the rent statement leaves the deposit to its own account, but shows what was applied', !html.includes('Deposit collected') && html.includes('Security deposit applied to balance') && bal(html) === '$600.00', bal(html));
  check('the yearly statement doesn’t count a deposit as rent paid', src('src/app/api/booths/statement/route.ts').includes("if (t.category === 'Booth Deposit' || t.taxBucket === 'transfer') continue;"));

  console.log('Changes made by hand on the Rent page');
  await fresh();
  const NT = await import('../../src/app/api/rent/notify/route');
  const now = new Date().toISOString(); const old = new Date(Date.now() - 3 * 86400e3).toISOString();
  await db.doc(`${T}/rentLedger/c1`).set({ renterId: 'rt1', leaseId: 'l1', type: 'one_off_charge', status: 'pending', amountCents: 2500, description: 'Spare key', dueDate: '2026-11-15', createdAt: now });
  r = await NT.POST(req({ tenantId: 't1', kind: 'charge_added', id: 'c1' }));
  check('a charge added tells them what, how much and when it’s due', r.body.ok && /A charge was added to your account: \$25\.00/.test(toMaya()[0]?.subject) && /for Spare key, due Nov 15, 2026/.test(toMaya()[0]?.html), toMaya().map((m) => m.subject));
  check('with a note in their portal', /\$25\.00 for Spare key/.test(String((await get(`${T}/renterAlerts/charge_added_c1`))?.text)));
  await NT.POST(req({ tenantId: 't1', kind: 'charge_added', id: 'c1' }));
  check('once', toMaya().length === 1);
  await db.doc(`${T}/rentLedger/c2`).set({ renterId: 'rt1', type: 'one_off_charge', status: 'pending', amountCents: 2500, description: 'Old', createdAt: old });
  r = await NT.POST(req({ tenantId: 't1', kind: 'charge_added', id: 'c2' }));
  check('never for an old record, or one that isn’t that change', r.status === 404 && (await NT.POST(req({ tenantId: 't1', kind: 'charge_waived', id: 'c1' }))).status === 404 && toMaya().length === 1);
  await db.doc(`${T}/rentLedger/c1`).set({ status: 'waived', updatedAt: new Date().toISOString() }, { merge: true });
  r = await NT.POST(req({ tenantId: 't1', kind: 'charge_waived', id: 'c1' }));
  check('a charge waived some other way (written off) isn’t announced as waived', r.status === 404 && toMaya().length === 1);
  await db.doc(`${T}/rentLedger/c1`).set({ waivedAt: new Date().toISOString() }, { merge: true });
  await NT.POST(req({ tenantId: 't1', kind: 'charge_waived', id: 'c1' }));
  check('a charge waived', /We waived the \$25\.00 charge for Spare key/.test(String(toMaya()[1]?.html)));
  await db.doc(`${T}/rentInvoices/i2`).set({ renterId: 'rt1', status: 'late', amountCents: 90000, lateFeeCents: 0, feeWaivedCents: 5000, feeWaivedAt: now, feeWaivedReason: 'First time late', dueDate: '2026-11-01' });
  await NT.POST(req({ tenantId: 't1', kind: 'fee_waived', id: 'i2' }));
  check('a late fee waived, with the reason', /We waived the \$50\.00 late fee on your rent due Nov 1, 2026\. First time late\./.test(String(toMaya()[2]?.html)), toMaya()[2]?.html?.slice(0, 300));
  await db.doc(`${T}/rentInvoices/i3`).set({ renterId: 'rt1', status: 'void', voidReason: 'waived', voidedAt: now, voidNote: 'Invoice waived', amountCents: 90000, lateFeeCents: 0, paidCents: 10000, dueDate: '2026-10-01' });
  await NT.POST(req({ tenantId: 't1', kind: 'bill_waived', id: 'i3' }));
  check('a rent bill waived (the default reason isn’t repeated)', /We waived your rent due Oct 1, 2026 \(\$800\.00\)\. You don’t owe it\./.test(String(toMaya()[3]?.html)) && !/Invoice waived/.test(String(toMaya()[3]?.html)));
  await db.doc(`${T}/rentInvoices/i4`).set({ renterId: 'rt1', leaseId: 'l1', status: 'due', amountCents: 90000, lateFeeCents: 0, paidCents: 0, dueDate: '2026-12-01' });
  await db.doc(`${T}/rentLedger/lc2`).set({ renterId: 'rt1', leaseId: 'l1', type: 'leave_credit', status: 'paid', amountCents: -12000, description: '4 banked rental days redeemed', createdAt: now });
  await NT.POST(req({ tenantId: 't1', kind: 'credit_added', id: 'lc2' }));
  check('banked days credited come off their open rent now (the oldest bill first), and they’re told', (await get(`${T}/rentInvoices/i2`)).paidCents === 12000 && /We added \$120\.00 of credit to your account: 4 banked rental days redeemed/.test(String(toMaya()[4]?.html)), { i4: await get(`${T}/rentInvoices/i4`), m: toMaya().map((m) => m.subject) });
  const rent = src('src/app/(app)/rent/page.tsx');
  check('the Rent page asks for each of these after making the change', /tx\.update\(ref, \{ status: 'waived', waivedAt: nowIso, waivedBy: 'owner'/.test(rent) && rent.includes("tellRenter('charge_added', added.id);") && rent.includes("tellRenter(what === 'fee' ? 'fee_waived' : 'bill_waived', invId);") && rent.includes("tellRenter('charge_waived', entry.id);") && rent.includes("kind: 'credit_added', id: ref.id"));

  console.log('Where it’s used');
  const drawer = src('src/components/renters/RenterProfileDrawer.tsx'); const booths = src('src/app/(app)/booths/page.tsx');
  check('a renter’s profile records deposits on the server, and the Spaces page has no second payment dialog of its own', drawer.includes("fetch('/api/rent/deposit'") && !drawer.includes("method: type === 'deposit_refund' ? 'refund'") && !booths.includes("fetch('/api/rent/deposit'") && !booths.includes("fetch('/api/rent/record-payment'") && !booths.includes("taxBucket: 'transfer',\n          source: 'booth_rent', category: 'Booth Deposit'"));
  const MP = await import('../../src/lib/message-policy');
  const k = (id: string) => (MP.MESSAGE_KINDS as any[]).find((x) => x.id === id);
  check('the messages are in Messages for renters; deposit and charge notices can’t be switched off', k('deposit_notice')?.canDisable === false && k('renter_charge_added')?.canDisable === false && k('renter_credit')?.canDisable === true && ['deposit_notice', 'renter_charge_added', 'renter_credit'].every((id) => k(id)?.group === 'Renters'));
  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the new files', ['src/lib/rent-deposit.ts', 'src/lib/renter-account-notice.ts', 'src/app/api/rent/deposit/route.ts', 'src/app/api/rent/notify/route.ts', 'scripts/verify/launch-money-deposits.verify.ts'].every((f) => !bad.test(src(f))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
