// Checks printers (L20 round 10): lib/printing (the paper, for Star text, Epson ePOS-Print XML and a tablet's print
// dialog), lib/printing-server, the printers' own addresses (api/printer/star, api/printer/epson), api/printers, and
// "Print the check" and "Taken off" through api/tab.
// - A networked printer asks for work by itself: new tickets for its stations print once each, a table's course or an
//   order on one slip, the allergy set off so it can't be missed; an allergy changed after printing prints an update.
// - What the printer says is kept: printed, or not (tried again a few times, then the screens say so).
// - Something printed then taken off a tab prints "Taken off" there. The check prints at the check printer, or comes
//   back as paper for the tablet's own print dialog.
// - The printer's address carries a secret key; a wrong one is told nothing.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/printing.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 's1', name: 'Rae Kim', role: 'staff', isManager: false, caps: [] };
class NR { status: number; body: any; headers: Record<string, string>; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {}; }
  static json(body: any, init?: any) { return new NR(body, init); } }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR };
  if (request === 'stripe') { const S: any = function () { return {}; }; return Object.assign(S, { default: S }); }
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager }, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: NR.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 }) } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams() } }) as any;
const preq = (o: { json?: any; text?: string; query?: string } = {}) => ({ json: async () => o.json || {}, text: async () => o.text || '', headers: { get: () => null }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams(o.query || '') } }) as any;
const ctx = (printerId: string, key: string) => ({ params: Promise.resolve({ tenantId: 't1', printerId, key }) });
const src = (p: string) => readFileSync(p, 'utf8');
const iso = (t: number) => new Date(t).toISOString();

(async () => {
  const P = await import('../../src/lib/printing');
  const K = await import('../../src/lib/kitchen');
  const now = Date.now(); const ago = (m: number) => iso(now - m * 60000);
  console.log('the paper');
  const D = P.cleanPrinter({});
  check('a Star printer at 48 a line, printing every station’s tickets, not checks, by default; cleaned', D.kind === 'star' && D.cols === 48 && D.tickets && !D.checks && D.stations.length === 0
    && P.cleanPrinter({ kind: 'epson' }).cols === 42 && P.cleanPrinter({ cols: 200 }).cols === 48 && P.cleanPrinter({ cols: 32 }).cols === 32 && P.printsWords(P.cleanPrinter({ stations: ['Kitchen', 'Grill'], checks: true })) === 'Kitchen and Grill tickets, and checks');
  check('plain letters for the printer’s own font', P.ascii('Rae’s “crème brûlée” — 2 × €') === 'Rae\'s "creme brulee" - 2 x ');
  const raw = (id: string, o: any) => ({ id, status: 'pending', source: 'tab', tableNumber: 'Table 4', guestName: 'Okafor', quantity: 1, createdAt: ago(1), firedAt: ago(1), madeAt: 'Kitchen', visitId: 'v4', course: 3, courseName: 'Mains', ...o });
  const tix = [raw('k1', { itemName: 'Ribeye', quantity: 2, choicesText: 'Medium rare' }), raw('k2', { itemName: 'Bream', seatNumber: '2', allergies: [{ name: 'Tree nuts', severity: 'severe' }], allergyNote: 'Carries an EpiPen' })];
  const doc = P.ticketDoc(tix.map((r) => K.ticketFrom(r, 'kdsTickets')), { tz: 'America/New_York', at: iso(now), station: null, buzz: true });
  const txt = P.renderText(doc, 48);
  check('a kitchen slip: the table, the course, each dish with its choices and seat, the allergy set off, whose it is', /^Table 4\s+\d{1,2}:\d{2} [ap]m$/m.test(txt) && /^Mains$/m.test(txt) && /^2  Ribeye$/m.test(txt) && /^   Medium rare$/m.test(txt)
    && /^1  Bream$/m.test(txt) && /^   Seat 2$/m.test(txt) && /^>> Allergy, seat 2: tree nuts, severe <<$/m.test(txt) && /Allergy note: Carries an EpiPen/.test(txt) && /#k1\s*$/m.test(txt.split('\n').find((l) => /#k1/.test(l)) || ''), txt);
  check('…never wider than the paper', txt.split('\n').every((l) => l.length <= 48) && P.renderText(doc, 32).split('\n').every((l) => l.length <= 32));
  const xml = P.renderEpos(doc, 42);
  check('for an Epson printer: big heading, the allergy white on black, a cut, its own markup kept safe', xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">') && /<text dw="true" dh="true" em="true">Table 4&#10;<\/text>/.test(xml)
    && /<text reverse="true" em="true">Allergy, seat 2: tree nuts, severe&#10;<\/text>/.test(xml) && /<cut type="feed"\/><\/epos-print>$/.test(xml) && P.renderEpos({ blocks: [{ k: 'text', text: 'Fish & <chips>' }] }, 42).includes('Fish &amp; &lt;chips&gt;'));
  const chk = P.checkDoc({ business: 'Linden', table: 'Table 4', name: 'Okafor', size: 2, lines: [{ name: 'Ribeye', price: 32, comped: false }, { name: 'Ribeye', price: 32, comped: false }, { name: 'Tea', price: 3, comped: true }],
    subtotal: 64, discount: 0, tax: 5.68, total: 69.68, paid: 20, payUrl: 'https://app.test/bill/t1/tok', at: iso(now), tz: null });
  const ct = P.renderText(chk, 48);
  check('the check: the same things together, totals, what’s paid and left, how to pay at the table', /^2  Ribeye\s+\$64\.00$/m.test(ct) && /^1  Tea\s+On the house$/m.test(ct) && /^Total\s+\$69\.68$/m.test(ct) && /^Paid\s+-\$20\.00$/m.test(ct) && /^Left to pay\s+\$49\.68$/m.test(ct)
    && /Pay at your table/.test(ct) && /https:\/\/app\.test\/bill\/t1\/tok/.test(ct) && /qrcode_model_2/.test(P.renderEpos(chk, 42)), ct);
  const long = P.renderText({ blocks: [{ k: 'text', text: 'https://app.test/bill/t1/' + 'x'.repeat(70) }] }, 32);
  check('a word longer than the paper is broken across lines, never cut short', long.split('\n').every((l) => l.length <= 32) && long.replace(/\n/g, '').includes('x'.repeat(70)), long);
  const odd = P.renderText({ blocks: [{ k: 'alert', text: 'Allergy, seat 1: 胡麻' }] }, 48);
  check('an allergy in letters the printer can’t print: marked, and pointed to the screen', /: \? \(see the screen\) <<$/m.test(odd) && /^>> /m.test(odd), odd);
  check('…and as a page for a tablet’s own print dialog', /<b style="font-size:20px">Table 4<\/b>/.test(P.renderHtml(doc, { font: 'x', fontHref: 'y' })) && /@page\{margin:0;size:80mm auto;\}/.test(P.renderHtml(doc, { font: 'x', fontHref: 'y' })));

  console.log('which tickets');
  const PS = await import('../../src/lib/printing-server');
  const pr = (o: any) => ({ ...P.cleanPrinter(o), id: o.id || 'p1', key: 'k'.repeat(24), addedAt: ago(30), lastSeenAt: null, statusCode: null, lastError: null, lastErrorAt: null, gaveUpAt: null });
  const raws = [...tix, raw('b1', { itemName: 'Negroni', madeAt: 'Bar', visitId: 'v4', course: 1 }), raw('old', { itemName: 'Soup', createdAt: ago(200), firedAt: null }), raw('later', { itemName: 'Pie', holdUntil: iso(now + 600000) }),
    raw('done', { itemName: 'Salad', printed: { p1: { job: 'j0', sig: '//' } } }), raw('chg', { itemName: 'Cake', printed: { p1: { job: 'j0', sig: 'stale' } }, allergies: ['Milk'] })];
  const w = PS.ticketsFor(raws, pr({ stations: ['Kitchen'] }), ['Kitchen', 'Bar'], now);
  check('a printer’s stations only; a table’s course on one slip; not one from before it was set up, not one held for later, not one printed already', w.fresh.length === 1 && w.fresh[0].map((r) => r.id).join() === 'k1,k2' && !w.fresh.flat().some((r) => ['b1', 'old', 'later', 'done'].includes(r.id)));
  check('…and an allergy that changed on one it printed', w.changed.length === 1 && w.changed[0][0].id === 'chg');
  check('a printer for every station takes the bar’s too', PS.ticketsFor(raws, pr({}), ['Kitchen', 'Bar'], now).fresh.flat().some((r) => r.id === 'b1'));

  console.log('setting printers up');
  await db.doc(T).set({ name: 'Linden', timezone: 'America/New_York', kitchenSettings: { stations: ['Kitchen', 'Bar'], tablePay: { on: true } }, salesTax: { configured: true, productsPct: 10 } });
  const Pr = await import('../../src/app/api/printers/route');
  manager = false;
  let r: any = await Pr.POST(req({ tenantId: 't1', action: 'save', name: 'Kitchen printer' }));
  check('a manager adds printers', r.status === 403);
  manager = true;
  r = await Pr.POST(req({ tenantId: 't1', action: 'save', name: 'Kitchen printer', kind: 'star', stations: ['Kitchen', 'Nowhere'], tickets: true, checks: false }));
  const kpId = r.body.id; const kp = await get(`${T}/printers/${kpId}`);
  check('added, with its own secret key; only the business’s own stations kept', r.body.ok && kp.key.length >= 20 && kp.stations.join() === 'Kitchen' && kp.kind === 'star');
  r = await Pr.POST(req({ tenantId: 't1', action: 'save', name: 'Bar printer', kind: 'epson', stations: ['Bar'], tickets: true, checks: true }));
  const bpId = r.body.id; const bp = await get(`${T}/printers/${bpId}`);
  r = await Pr.POST(req({ tenantId: 't1', action: 'list' }));
  const kl = r.body.printers.find((p: any) => p.id === kpId);
  check('a manager sees its address to put in the printer; it’s waiting to hear from it', r.body.ok && kl.url === `https://app.test/api/printer/star/t1/${kpId}/${kp.key}` && !kl.ok && /Waiting to hear/.test(kl.words) && r.body.stations.join() === 'Kitchen,Bar');
  manager = false; r = await Pr.POST(req({ tenantId: 't1', action: 'list' })); manager = true;
  check('…anyone else sees how it’s doing, never the address', r.body.ok && r.body.printers.every((p: any) => !p.url));

  console.log('a Star printer');
  const Star = await import('../../src/app/api/printer/star/[tenantId]/[printerId]/[key]/route');
  r = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, 'x'.repeat(24)));
  check('a wrong address is told nothing', r.status === 404);
  for (const t of raws) await db.doc(`${T}/kdsTickets/${t.id}`).set({ ...t, printed: undefined, ...(t.id === 'done' || t.id === 'chg' ? { status: 'delivered' } : {}) });
  const added = await get(`${T}/printers/${kpId}`);
  await db.doc(`${T}/printers/${kpId}`).set({ addedAt: ago(30) }, { merge: true }); PS.forgetPrinter(T, kpId); void added;
  r = await Star.POST(preq({ json: { statusCode: '200%20OK', printerMAC: '00:11:62:aa:bb:cc', printingInProgress: false } }), ctx(kpId, kp.key));
  const job1 = r.body.jobToken;
  check('it asks: a slip is ready, as plain text', r.body.jobReady === true && r.body.mediaTypes.join() === 'text/plain' && !!job1);
  const k1 = await get(`${T}/kdsTickets/k1`); const b1 = await get(`${T}/kdsTickets/b1`);
  check('…the tickets are marked printed by it, in the same save; the bar’s isn’t', k1.printed[kpId].job === job1 && !!(await get(`${T}/kdsTickets/k2`)).printed[kpId] && !b1.printed);
  check('…and what it said about itself is kept', (await get(`${T}/printers/${kpId}`)).statusCode === '200 OK' && !!(await get(`${T}/printers/${kpId}`)).lastSeenAt);
  r = await Star.GET(preq({ query: `mac=00%3A11&type=text%2Fplain&token=${job1}` }), ctx(kpId, kp.key));
  check('it fetches the slip: the table, the dishes, the allergy; cut after, a beep', r.status === 200 && /Table 4/.test(r.body) && /2  Ribeye/.test(r.body) && /tree nuts, severe/.test(r.body) && r.headers['X-Star-Cut'] === 'partial; feed=true' && r.headers['X-Star-Buzzerstartpattern'] === '1', r.body);
  r = await Star.GET(preq({ query: `type=image%2Fpng&token=${job1}` }), ctx(kpId, kp.key));
  check('…only as text', r.status === 415);
  r = await Star.POST(preq({ json: { statusCode: '200%20OK', jobToken: job1, printingInProgress: true } }), ctx(kpId, kp.key));
  check('busy printing: nothing new', r.body.jobReady === false);
  r = await Star.DELETE(preq({ query: `code=200%20OK&token=${job1}` }), ctx(kpId, kp.key));
  check('it says it printed: done', r.status === 200 && (await get(`${T}/printJobs/${job1}`)).status === 'done' && (await get(`${T}/printJobs/${job1}`)).open === false);
  PS.forgetPending(T);
  r = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, kp.key));
  check('…and the same tickets never print twice', r.body.jobReady === false);

  console.log('when it goes wrong');
  await db.doc(`${T}/kdsTickets/k2`).set({ allergies: [{ name: 'Tree nuts', severity: 'severe' }, { name: 'Sesame' }] }, { merge: true }); PS.forgetPending(T);
  r = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, kp.key));
  const job2 = r.body.jobToken; const g2: any = await Star.GET(preq({ query: `token=${job2}` }), ctx(kpId, kp.key));
  check('an allergy changed after printing: an update prints', r.body.jobReady && /^Allergy update/m.test(g2.body) && /sesame/.test(g2.body) && (await get(`${T}/printJobs/${job2}`)).kind === 'allergy', g2.body);
  await Star.DELETE(preq({ query: `code=410%20Paper%20empty&token=${job2}` }), ctx(kpId, kp.key));
  r = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, kp.key));
  check('it says it didn’t print: not sent the same slip again straight away', r.body.jobReady === false && !!(await get(`${T}/printJobs/${job2}`)).retryAt);
  for (let i = 0; i < 4; i++) {
    if (i) await Star.DELETE(preq({ query: `code=410%20Paper%20empty&token=${job2}` }), ctx(kpId, kp.key));
    await db.doc(`${T}/printJobs/${job2}`).set({ retryAt: null }, { merge: true });
    PS.forgetPrinter(T, kpId);
    r = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, kp.key));
  }
  const j2 = await get(`${T}/printJobs/${job2}`);
  check('it says it didn’t print: tried again, then given up, and the business told', j2.status === 'failed' && j2.open === false && /Paper empty/.test(j2.code) && /Paper empty/.test((await get(`${T}/printers/${kpId}`)).lastError || ''), j2);
  const k2now = await get(`${T}/kdsTickets/k2`);
  check('…a ticket still waiting on a slip given up on prints again (after a minute’s pause)', k2now.printed[kpId] === null && !!(await get(`${T}/printers/${kpId}`)).gaveUpAt, k2now.printed);
  await db.doc(`${T}/printers/${kpId}`).set({ gaveUpAt: ago(2) }, { merge: true }); PS.forgetPrinter(T, kpId); PS.forgetPending(T);
  await PS.nextJob(db, T, async () => await get(T), (await PS.printerOf(db, T, kpId))!);
  check('…and after the pause, it’s on a new slip', (await all(`${T}/printJobs`)).some((j: any) => j.id !== job2 && j.kind === 'ticket' && j.open && j.ticketIds.join() === 'k2'));
  check('…just that one, not the tickets that did print', !(await all(`${T}/printJobs`)).some((j: any) => j.id !== job1 && j.kind === 'ticket' && j.ticketIds.includes('k1')));
  PS.forgetPrinter(T, kpId);
  const st = PS.printerState((await PS.printerOf(db, T, kpId))!, Date.now(), null);
  check('…“didn’t print” until one does', !st.ok && /didn’t print/.test(st.words));
  r = await Star.POST(preq({ json: { statusCode: '410%20Paper%20empty' } }), ctx(kpId, kp.key)); PS.forgetPrinter(T, kpId);
  const st2 = PS.printerState((await PS.printerOf(db, T, kpId))!, Date.now(), null);
  check('a printer out of paper is given nothing, and the screens say so', r.body.jobReady === false && !st2.ok && /Paper empty/.test(st2.words));
  await db.doc(`${T}/printers/${kpId}`).set({ lastSeenAt: ago(5) }, { merge: true }); PS.forgetPrinter(T, kpId);
  check('…and one not heard from in a while', /Not heard from since/.test(PS.printerState((await PS.printerOf(db, T, kpId))!, Date.now(), 'America/New_York').words));

  console.log('an Epson printer');
  const Ep = await import('../../src/app/api/printer/epson/[tenantId]/[printerId]/[key]/route');
  await db.doc(`${T}/printers/${bpId}`).set({ addedAt: ago(30) }, { merge: true }); PS.forgetPrinter(T, bpId);
  r = await Ep.POST(preq({ text: 'ConnectionType=GetRequest&ID=' }), ctx(bpId, bp.key));
  const pj = (String(r.body).match(/<printjobid>([^<]+)<\/printjobid>/) || [])[1];
  check('it asks: the bar’s ticket, as ePOS-Print XML', r.status === 200 && /^<\?xml version="1\.0" encoding="utf-8"\?><PrintRequestInfo Version="2\.00"><ePOSPrint><Parameter><devid>local_printer<\/devid>/.test(String(r.body)) && /Negroni/.test(String(r.body)) && !!pj
    && r.headers['Content-Type'] === 'text/xml; charset=utf-8', r.body);
  r = await Ep.POST(preq({ text: `ConnectionType=SetResponse&ID=&ResponseFile=${encodeURIComponent(`<PrintResponseInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><printjobid>${pj}</printjobid></Parameter><PrintResponse><response success="true" code="" status="251658262" battery="0"/></PrintResponse></ePOSPrint></PrintResponseInfo>`)}` }), ctx(bpId, bp.key));
  check('…it says it printed: done', r.status === 200 && (await get(`${T}/printJobs/${pj}`)).status === 'done');
  r = await Ep.POST(preq({ text: 'ConnectionType=GetRequest&ID=' }), ctx(bpId, bp.key));
  check('…nothing more: an empty answer', r.status === 200 && r.body === null);
  r = await Ep.POST(preq({ text: 'ConnectionType=GetRequest' }), ctx(kpId, kp.key));
  check('a Star printer’s address doesn’t work as an Epson one', r.status === 404);

  console.log('from a server’s tab');
  await db.doc(`${T}/inventory/rib`).set({ name: 'Ribeye', type: 'refreshment', msrp: 32 });
  await db.doc(`${T}/parties/p4`).set({ name: 'Okafor', size: 2, status: 'seated', sessionId: 's1', unitIds: ['u4'] });
  await db.doc(`${T}/appointments/v4`).set({ isTable: true, status: 'servicing', partyId: 'p4', tableName: '4', clientName: 'Okafor', tab: [{ lineId: 'l1', itemId: 'rib', itemType: 'product', name: 'Ribeye', price: 32, quantity: 1, kdsId: 'k1' }, { lineId: 'l2', itemId: 'rib', itemType: 'product', name: 'Ribeye', price: 32, quantity: 1, kdsId: 'k2' }] });
  const Tab = await import('../../src/app/api/tab/route');
  r = await Tab.POST(req({ tenantId: 't1', action: 'print_check', visitId: 'v4' }));
  const cj = (await all(`${T}/printJobs`)).find((j: any) => j.kind === 'check');
  check('“Print the check”: to the check printer, with what they had and how to pay at the table', r.body.ok && r.body.printer === 'Bar printer' && !!cj && cj.printerId === bpId
    && /2  Ribeye/.test(P.renderText(cj.doc, 42)) && cj.doc.blocks.some((b: any) => b.k === 'qr' && /\/bill\/t1\//.test(b.data)), r.body);
  await db.doc(`${T}/printers/${bpId}`).set({ checks: false }, { merge: true }); PS.forgetPrinter(T, bpId);
  r = await Tab.POST(req({ tenantId: 't1', action: 'print_check', visitId: 'v4' }));
  check('…no check printer: back as paper for the tablet’s own print dialog', r.body.ok && r.body.printer === null && r.body.doc.blocks.length > 5);
  await db.doc(`${T}/printers/${bpId}`).set({ checks: true, lastSeenAt: ago(5) }, { merge: true }); PS.forgetPrinter(T, bpId);
  r = await Tab.POST(req({ tenantId: 't1', action: 'print_check', visitId: 'v4' }));
  check('…the check printer not answering: paper for the tablet, saying which printer isn’t', r.body.ok && r.body.printer === null && r.body.down === 'Bar printer' && r.body.doc.blocks.length > 5, r.body);
  await db.doc(`${T}/printers/${bpId}`).set({ lastSeenAt: iso(Date.now()), statusCode: '200 OK', lastError: null }, { merge: true }); PS.forgetPrinter(T, bpId);
  await Tab.POST(req({ tenantId: 't1', action: 'print_check', visitId: 'v4' })); r = await Tab.POST(req({ tenantId: 't1', action: 'print_check', visitId: 'v4' }));
  const checks = (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'check' && j.visitId === 'v4');
  check('…asked twice before it printed: one check, the newer one', r.body.printer === 'Bar printer' && checks.filter((j: any) => j.open).length === 1 && checks.some((j: any) => j.status === 'replaced'), checks.map((j: any) => j.status));
  const openCheck = checks.find((j: any) => j.open);
  await db.doc(`${T}/printJobs/${openCheck.id}`).set({ createdAt: ago(30) }, { merge: true });
  await db.doc(`${T}/printJobs/q1`).set({ printerId: bpId, kind: 'test', doc: { blocks: [] }, status: 'queued', open: true, tries: 0, createdAt: ago(29) });
  await db.doc(`${T}/printJobs/q0`).set({ printerId: bpId, kind: 'void', doc: { blocks: [] }, status: 'queued', open: true, tries: 0, createdAt: ago(28) });
  await db.doc(`${T}/kdsTickets/b2`).set(raw('b2', { itemName: 'Spritz', madeAt: 'Bar', visitId: 'v9', course: 1 })); PS.forgetPending(T);
  const bpNow = (await PS.printerOf(db, T, bpId, { fresh: true }))!;
  const nj = await PS.nextJob(db, T, async () => await get(T), bpNow);
  const stale = await get(`${T}/printJobs/${openCheck.id}`);
  check('a check or test page left half an hour isn’t printed; “Taken off” still is', stale.status === 'failed' && /Too old/.test(stale.code) && (await get(`${T}/printJobs/q1`)).status === 'failed' && nj?.id === 'q0', { stale, nj });
  await db.doc(`${T}/printJobs/q0`).set({ open: false, status: 'done' }, { merge: true });
  const nb2 = await get(`${T}/printJobs/${(await PS.nextJob(db, T, async () => await get(T), bpNow))?.id}`);
  check('…and a new ticket isn’t held up behind them', nb2?.kind === 'ticket' && nb2.ticketIds.includes('b2'), nb2);
  const sigOld = (await import('../../src/lib/allergens')).allergySig({ allergies: [] } as any);
  await db.doc(`${T}/kdsTickets/ip1`).set(raw('ip1', { itemName: 'Risotto', status: 'in_progress', visitId: 'v7', allergies: [{ name: 'Milk', severity: 'severe' }], printed: { [kpId]: { job: 'jz', sig: sigOld } } })); PS.forgetPending(T);
  await PS.nextJob(db, T, async () => await get(T), (await PS.printerOf(db, T, kpId, { fresh: true }))!);
  const upd = (await all(`${T}/printJobs`)).find((j: any) => j.kind === 'allergy' && j.ticketIds.includes('ip1'));
  check('an allergy changed on a ticket the kitchen is already making: an update prints', !!upd && /milk, severe/i.test(P.renderText(upd.doc, 48)), upd && P.renderText(upd.doc, 48));
  await db.doc(`${T}/printJobs/${upd.id}`).set({ tries: 4, status: 'queued', createdAt: ago(40) }, { merge: true });
  await PS.nextJob(db, T, async () => await get(T), (await PS.printerOf(db, T, kpId, { fresh: true }))!);
  check('…given up on, a ticket being made isn’t sent round again (the screens have it)', (await get(`${T}/printJobs/${upd.id}`)).status === 'failed' && (await get(`${T}/kdsTickets/ip1`)).printed[kpId]?.job === upd.id);
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v4', lineId: 'l1', reason: 'Wrong item' }));
  const vj = (await all(`${T}/printJobs`)).find((j: any) => j.kind === 'void' && (j.ticketIds || []).includes('k1'));
  check('something printed taken off the tab: “Taken off” at the printer that printed it', r.body.ok && !!vj && vj.printerId === kpId && /^Taken off/m.test(P.renderText(vj.doc, 48)) && /2  Ribeye/.test(P.renderText(vj.doc, 48)) && /By Rae Kim/.test(P.renderText(vj.doc, 48)), r.body);
  r = await Pr.POST(req({ tenantId: 't1', action: 'test', id: kpId }));
  check('a test page', r.body.ok && (await all(`${T}/printJobs`)).some((j: any) => j.kind === 'test' && j.printerId === kpId));
  r = await Pr.POST(req({ tenantId: 't1', action: 'rekey', id: kpId })); PS.forgetPrinter(T, kpId);
  const old: any = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, kp.key));
  check('a new address: the old one stops working', r.body.ok && old.status === 404);

  r = await Star.POST(preq({ json: { statusCode: '200%E0%A4%A' } }), ctx(bpId, bp.key));
  const kpNew = await get(`${T}/printers/${kpId}`);
  r = await Star.POST(preq({ json: { statusCode: '%E0%A4%A' } }), ctx(kpId, kpNew.key));
  check('a garbled status from a printer is read safely', r.status === 200 && r.body.jobReady === false);
  let reads = 0; const realDoc = db.doc.bind(db); db.doc = (x: string) => { if (/\/printers\//.test(x)) reads += 1; return realDoc(x); };
  for (let i = 0; i < 30; i++) await Star.POST(preq({ json: {} }), ctx(`nope${i}`, 'w'.repeat(24)));
  const before = reads; r = await Star.POST(preq({ json: {} }), ctx('nope99', 'w'.repeat(24)));
  check('someone trying made-up addresses is turned away without a read', r.status === 404 && reads === before && before >= 30);
  r = await Star.POST(preq({ json: { statusCode: '200%20OK' } }), ctx(kpId, kpNew.key)); db.doc = realDoc;
  check('…while a printer that’s working keeps going', r.status === 200);

  console.log('the screens');
  const page = src('src/app/(app)/settings/printers/page.tsx'); const kds = src('src/app/kds/[tenantId]/page.tsx'); const tab = src('src/components/host/TableTab.tsx');
  check('Printers settings: add, make, paper, stations, checks, the address, a test', /Add a printer/.test(page) && /Star \(CloudPRNT\)/.test(page) && /Epson \(Server Direct Print\)/.test(page) && /80 mm/.test(page) && /For which stations/.test(page) && /Prints checks/.test(page) && /Print a test/.test(page) && /Copy/.test(page)
    && /id: 'printers'/.test(src('src/lib/settings-registry.ts')) && /'\/settings\/printers'/.test(src('src/lib/modules.ts')));
  check('the kitchen screen: says when a printer isn’t printing; prints new tickets on its own tablet', /isn’t printing/.test(kds) && /Print new tickets here/.test(kds) && /printFrame\(/.test(kds) && /printers: Array\.isArray\(d\.printers\)/.test(kds) && /printerSummary/.test(src('src/app/api/kitchen/route.ts')));
  check('the server’s tab: “Print the check”', /Print the check/.test(tab) && /action: 'print_check'/.test(tab));
  const fresh = src('src/lib/printing.ts') + src('src/lib/printing-server.ts') + page;
  check('no emoji, all caps, niche words in what’s new (red only to take a printer away)', !/[\u{1F300}-\u{1FAFF}]/u.test(fresh) && !/\buppercase\b|font-black/.test(fresh) && !/\b(salon|stylist|booth|chair)\b/i.test(fresh) && (page.match(/#b42318/g) || []).length === 1);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
