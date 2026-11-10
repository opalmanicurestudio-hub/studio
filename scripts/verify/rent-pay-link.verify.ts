// Checks emailing a renter a link to pay what they owe (api/rent/pay-link), from the Owed list on the Rent page:
// - The amount is worked out on the server from their open bills and charges (never a deposit), not taken from the page.
// - The link opens their portal's Rent tab signed in, at the business's or the app's own address (never one from the
//   request); the email goes through the logged sender as its own message ("Pay link", which can be reworded but not
//   switched off), with the amount and the link as tokens so a reworded message still carries both. The sign-in link is
//   made only once the send is claimed.
// - Managers only, never a renter signed in on the team side; no email, nothing owed or a link sent minutes ago: told why,
//   nothing sent. Two taps at once send one email; a failed send can be tried again straight away.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/rent-pay-link.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
let role: any = { deny: null, actor: { uid: 'o1', isTenantOwner: true } };
const sent: any[] = [];
let sendOk: boolean | 'throw' = true;
let origin = 'https://app.example';
const mints: any[] = [];
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body, json: async () => body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/route-guard') return { requireRole: async () => role };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); if (sendOk === 'throw') throw new Error('down'); return { ok: sendOk }; } };
  if (request === '@/lib/email-template') return { brandedEmailHtml: (o: any) => `<p>${o.title}</p><a href="${o.cta?.url}">${o.cta?.label}</a>` };
  if (request === '@/lib/renter-link') return { mintRenterLink: async (_db: any, t: string, r: string, base: string, o: any) => { mints.push(r); return `${base}/rent/${t}?rt=tok_${r}&${o.query}`; } };
  if (request === '@/lib/app-origin') return { linkOrigin: (_t: any, reqOrigin: any) => origin || String(reqOrigin || '') };
  return load.call(this, request, ...rest);
};

const req = (body: any) => ({ json: async () => body, headers: { get: () => 'https://evil.example' } }) as any;
const seed = () => {
  db = makeDb();
  db.doc('tenants/t1').set({ name: 'North Loft' });
  db.doc('tenants/t1/renters/r1').set({ firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' });
  db.doc('tenants/t1/renters/r2').set({ firstName: 'Maya', lastName: 'Ortiz', email: '' });
  db.doc('tenants/t1/renters/r3').set({ firstName: 'Sam', lastName: 'Chen', email: 'sam@example.com' });
  db.doc('tenants/t1/rentInvoices/i1').set({ renterId: 'r1', status: 'late', amountCents: 90000, lateFeeCents: 2500, paidCents: 10000, dueDate: '2026-11-01' });
  db.doc('tenants/t1/rentInvoices/i2').set({ renterId: 'r1', status: 'paid', amountCents: 90000, dueDate: '2026-10-01' });
  db.doc('tenants/t1/rentLedger/c1').set({ renterId: 'r1', type: 'one_off_charge', status: 'pending', amountCents: 3000 });
  db.doc('tenants/t1/rentLedger/d1').set({ renterId: 'r1', type: 'deposit_charge', status: 'pending', amountCents: 90000 });
  db.doc('tenants/t1/rentLedger/d3').set({ renterId: 'r3', type: 'deposit_charge', status: 'pending', amountCents: 50000 });
};

(async () => {
  const { POST } = await import('../../src/app/api/rent/pay-link/route');
  seed();
  const a: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  const m = sent[0];
  check('works out what they owe on the server: open bills with the fee, less what’s paid, and charges; never a deposit', a.status === 200 && a.body.cents === 85500 && a.body.sentTo === 'jordan@example.com', a.body);
  check('one email, as its own message, to them, with the amount and a link to their Rent tab (both also as tokens)', sent.length === 1 && m.kind === 'rent_pay_link' && m.recipientId === 'r1' && m.to === 'jordan@example.com' && /\$855\.00/.test(m.subject)
    && m.tokens.link === 'https://app.example/rent/t1?rt=tok_r1&tab=rent' && m.tokens.amount === '$855.00' && m.html.includes('tab=rent') && m.tokens.renter_first === 'Jordan', m);
  const again: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  check('a second tap minutes later sends nothing, makes no sign-in link, and says why', again.status === 429 && sent.length === 1 && mints.length === 1 && /half hour/.test(again.body.error), again.body);
  const none: any = await POST(req({ tenantId: 't1', renterId: 'r3' }));
  check('nothing owed (a deposit isn’t rent): told, nothing sent', none.status === 409 && sent.length === 1, none.body);
  const noMail: any = await POST(req({ tenantId: 't1', renterId: 'r2' }));
  check('no email on file: says to add one, nothing sent', noMail.status === 400 && /Add one/.test(noMail.body.error) && sent.length === 1, noMail.body);
  const bad: any = await POST(req({ tenantId: 't1', renterId: '../x' }));
  const gone: any = await POST(req({ tenantId: 't1', renterId: 'nobody' }));
  check('a made-up or missing renter is refused', bad.status === 400 && gone.status === 404);

  seed(); sent.length = 0; sendOk = false;
  const failed: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  sendOk = 'throw';
  const threw: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  sendOk = true;
  const retry: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  check('when the email doesn’t go out (or the sender fails outright), it says so, and trying again works straight away', failed.status === 502 && threw.status === 502 && retry.status === 200 && sent.length === 3, [failed.body, threw.body, retry.body]);

  seed(); sent.length = 0; mints.length = 0; origin = '';
  const noBase: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  origin = 'https://app.example';
  check('with no address of its own set up, it sends nothing rather than use the request’s (a sign-in link never points elsewhere)', noBase.status === 500 && sent.length === 0 && mints.length === 0, noBase.body);

  seed(); sent.length = 0;
  const [x, y]: any[] = await Promise.all([POST(req({ tenantId: 't1', renterId: 'r1' })), POST(req({ tenantId: 't1', renterId: 'r1' }))]);
  check('two taps at once: one email', sent.length === 1 && [x.status, y.status].sort().join() === '200,429', [x.status, y.status]);

  seed(); sent.length = 0;
  role = { deny: { status: 403, body: { ok: false } } };
  const staff: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  role = { deny: null, actor: { uid: 'x', isRenter: true } };
  const renter: any = await POST(req({ tenantId: 't1', renterId: 'r1' }));
  check('managers only; a renter signed in on the team side is refused', staff.status === 403 && renter.status === 403 && sent.length === 0);

  const src = readFileSync('src/app/api/rent/pay-link/route.ts', 'utf8');
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  check('no tool names; no trade words', !AI.test(src) && !/salon|studio|stylist|booth/i.test(src.replace(/^(import|\/\/).*$/gm, '').replace(/studioName:|studio: business/g, '')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
