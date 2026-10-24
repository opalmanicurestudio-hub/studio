// Checks the team changing a customer's contact details on an order (lib/contact-change, api/retail/customer-contact):
// managers and the front desk may, a provider or a renter may not, and an email change on an order held for review is a
// manager's. The order, its follow-ups and the open cases on them take the new details; the customer's profile keeps
// its own. The new email gets the order link and the old one is told; a new mobile gets one text. Texts can be turned
// off for an order, and its updates then come by email. Every change is on the record with who made it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/customer-contact.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
let actor: any = {};
const sent: any[] = [];
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: { name: 'Opal' } }) };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, orderId = 'o1') => ({ json: async () => ({ tenantId: 't1', orderId, ...body }), headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
const kai = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false };
const fresh = async (o: any = {}) => {
  db = makeDb(); sent.length = 0; actor = kai;
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal' });
  await db.doc(`${T}/retailOrders/o1`).set({ orderNumber: 1204, stage: 'packed', method: 'ship', customerName: 'Priya Shah', customerEmail: 'priya.shah@example.com', customerPhone: '(503) 555-0148', clientId: 'c1', ...o });
  // A backorder made from it, the open case about it, and her profile.
  await db.doc(`${T}/retailOrders/o2`).set({ orderNumber: 1205, stage: 'paid', parentOrderId: 'o1', customerName: 'Priya Shah', customerEmail: 'priya.shah@example.com', customerPhone: '5035550148' });
  await db.doc(`${T}/retailSupport/s1`).set({ orderId: 'o1', customerEmail: 'priya.shah@example.com', status: 'open' });
  await db.doc(`${T}/retailClaims/cl1`).set({ orderId: 'o2', customerEmail: 'priya.shah@example.com', status: 'in_review' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Priya Shah', email: 'priya.shah@example.com' });
};

(async () => {
  const { POST } = await import('../../src/app/api/retail/customer-contact/route');
  const { mayEditContact, cleanContact, maskEmail, contactDiff } = await import('../../src/lib/contact-change');
  const run = (body: any, orderId = 'o1') => POST(req(body, orderId)) as any;

  // ── Who may ──
  const t = { roles: { shift_lead: { name: 'Shift lead', base: 'front_desk', caps: [] }, stylist_plus: { name: 'Senior stylist', base: 'staff', caps: [] } } };
  check('managers and the front desk may change contact details', ['owner', 'admin', 'manager', 'front_desk'].every((r) => mayEditContact({}, { role: r })) && mayEditContact({}, { isTenantOwner: true }));
  check('…and a role a business built on the front desk', mayEditContact(t, { role: 'shift_lead' }));
  check('a provider, an assistant, a renter (or a role built on a provider) may not', !mayEditContact(t, { role: 'staff' }) && !mayEditContact(t, { role: 'assistant' }) && !mayEditContact(t, { role: 'renter' })
    && !mayEditContact(t, { role: 'stylist_plus' }) && !mayEditContact(t, { role: 'manager', isRenter: true }) && !mayEditContact(t, null));

  await fresh(); actor = { uid: 's9', name: 'Lee', role: 'staff', isManager: false };
  let r = await run({ email: 'priya@shahstudio.com' });
  check('the server refuses a provider, and nothing changes', r.status === 403 && (await get(`${T}/retailOrders/o1`)).customerEmail === 'priya.shah@example.com' && !sent.length);

  // ── A new email ──
  await fresh();
  r = await run({ email: 'Priya@ShahStudio.com' });
  const o1 = await get(`${T}/retailOrders/o1`);
  check('the front desk changes the email: saved in lower case, with who changed it', r.body.ok && o1.customerEmail === 'priya@shahstudio.com' && o1.contactChangedBy === 'Kai Park', r.body);
  check('…its backorder takes the new email too', (await get(`${T}/retailOrders/o2`)).customerEmail === 'priya@shahstudio.com');
  check('…and the open case and report on them reply to it', (await get(`${T}/retailSupport/s1`)).customerEmail === 'priya@shahstudio.com' && (await get(`${T}/retailClaims/cl1`)).customerEmail === 'priya@shahstudio.com');
  check('…her profile keeps its own email', (await get(`${T}/clients/c1`)).email === 'priya.shah@example.com');
  const toNew = sent.find((m) => m.to === 'priya@shahstudio.com');
  const toOld = sent.find((m) => m.to === 'priya.shah@example.com');
  check('the new email gets the order link', !!toNew && toNew.channel === 'email' && toNew.kind === 'contact_changed' && /\/shop\/t1\/order\/o1/.test(toNew.html) && toNew.orderId === 'o1', toNew);
  check('the old email is told it changed, without showing the whole new address', !!toOld && toOld.kind === 'contact_changed_notice' && /p•••@shahstudio\.com/.test(toOld.html) && !/priya@shahstudio\.com/.test(toOld.html), toOld?.html);
  const ev = (await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.meta?.kind === 'contact_changed');
  check('the record says what changed and who changed it', !!ev && ev.actorName === 'Kai Park' && /Email changed from priya\.shah@example\.com to priya@shahstudio\.com/.test(ev.meta.text), ev);
  check('the answer says what happened', /order link went to priya@shahstudio\.com/.test(r.body.message) && /old email was told/.test(r.body.message), r.body.message);

  // ── A new mobile, texts off ──
  await fresh();
  r = await run({ phone: '(206) 555-0199' });
  check('a new mobile: the order and its backorder take it, and it gets one text with the link',
    r.body.ok && (await get(`${T}/retailOrders/o1`)).customerPhone === '(206) 555-0199' && (await get(`${T}/retailOrders/o2`)).customerPhone === '(206) 555-0199'
    && sent.filter((m) => m.channel === 'sms').length === 1 && sent[0].to === '(206) 555-0199' && /\/shop\/t1\/order\/o1/.test(sent[0].text), sent);
  await fresh();
  r = await run({ textsOff: true });
  check('texts turned off for the order: saved, on the record, nothing sent', r.body.ok && (await get(`${T}/retailOrders/o1`)).textsOff === true && !sent.length
    && /Texts about this order turned off/.test((await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.meta?.kind === 'contact_changed')?.meta?.text || ''));
  const inbox = fs.readFileSync('src/lib/order-inbox.ts', 'utf8');
  check('…and its updates are nudged by email instead of text', /order\.textsOff !== true && smsConfigured\(\)/.test(inbox));

  // ── Safeguards ──
  await fresh({ holdForReview: true });
  r = await run({ email: 'someone@else.com' });
  check('an order held for review: the front desk can’t change its email', r.status === 403 && (await get(`${T}/retailOrders/o1`)).customerEmail === 'priya.shah@example.com');
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true };
  r = await run({ email: 'someone@else.com' });
  check('…a manager can', r.body.ok && (await get(`${T}/retailOrders/o1`)).customerEmail === 'someone@else.com');
  await fresh({ holdForReview: true });
  r = await run({ phone: '(206) 555-0199' });
  check('…nor its mobile (the new number would get the order’s link)', r.status === 403 && (await get(`${T}/retailOrders/o1`)).customerPhone === '(503) 555-0148' && !sent.length);

  await fresh();
  await db.doc(`${T}/retailOrders/o1`).set({ holdForReview: true }, { merge: true });
  r = await run({ email: 'someone@else.com' }, 'o2');
  check('…not even from a follow-up of a held order (the change would reach it)', r.status === 403 && (await get(`${T}/retailOrders/o1`)).customerEmail === 'priya.shah@example.com' && (await get(`${T}/retailOrders/o2`)).customerEmail === 'priya.shah@example.com', r.body);

  // ── The whole family ──
  await fresh();
  await db.doc(`${T}/retailOrders/o3`).set({ orderNumber: 1206, stage: 'paid', parentOrderId: 'o2', customerName: 'Priya Shah', customerEmail: 'priya.shah@example.com', customerPhone: '5035550148' });
  await db.doc(`${T}/retailSupport/s3`).set({ orderId: 'o3', customerEmail: 'priya.shah@example.com', customerPhone: '503-555-0148', status: 'open' });
  r = await run({ email: 'priya@shahstudio.com', phone: '(206) 555-0199' });
  check('a backorder of a backorder takes the new details too', r.body.ok && (await get(`${T}/retailOrders/o3`)).customerEmail === 'priya@shahstudio.com' && (await get(`${T}/retailOrders/o3`)).customerPhone === '(206) 555-0199', await get(`${T}/retailOrders/o3`));
  check('…and the case on it replies to the new email and mobile', (await get(`${T}/retailSupport/s3`)).customerEmail === 'priya@shahstudio.com' && (await get(`${T}/retailSupport/s3`)).customerPhone === '(206) 555-0199');
  await fresh();
  r = await run({ email: 'priya@shahstudio.com' }, 'o2');
  check('changed from a follow-up, the order it came from changes too', r.body.ok && (await get(`${T}/retailOrders/o1`)).customerEmail === 'priya@shahstudio.com', r.body);

  // ── Only through here ──
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  check('a browser can’t change an order’s name, email, mobile or texts setting (only this route can)', /'customerEmail', 'customerPhone', 'customerName', 'textsOff', 'clientId'/.test(rules));
  check('…nor where a case or a problem report replies to (a report isn’t written from a browser at all)', /match \/tenants\/\{tenantId\}\/retailSupport\/\{caseId\} \{[\s\S]{0,300}?caseContactKeys\(\)/.test(rules) && /match \/tenants\/\{tenantId\}\/retailClaims\/\{claimId\} \{\s*allow read: if isTeam\(tenantId\);\s*allow create, update, delete: if false;/.test(rules)
    && /'retailSupport', 'retailClaims',/.test(rules));

  await fresh();
  r = await run({ email: 'not-an-email' });
  check('an email that isn’t one is refused in plain words', r.status === 400 && /doesn’t look right/.test(r.body.error));
  r = await run({ phone: '555-01' });
  check('a mobile without an area code is refused', r.status === 400 && /area code/.test(r.body.error));
  r = await run({ email: 'PRIYA.SHAH@example.com' });
  check('the same email in different capitals isn’t a change', r.body.ok && r.body.unchanged && !sent.length);
  r = await run({ email: '' });
  check('an order’s email can’t be taken away (receipts and updates go there)', r.status === 400);
  check('the clean-up keeps what isn’t being changed', cleanContact({ customerName: 'A B', customerEmail: 'a@b.co', customerPhone: '' }, { phone: '2065550199' }).next.email === 'a@b.co');
  check('masked emails show one letter and the domain', maskEmail('priya@shahstudio.com') === 'p•••@shahstudio.com' && maskEmail('nope') === '');
  check('a different format of the same mobile isn’t a change', contactDiff({ customerName: 'A', customerEmail: 'a@b.co', customerPhone: '(503) 555-0148' }, { name: 'A', email: 'a@b.co', phone: '503-555-0148', textsOff: false }).length === 0);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
