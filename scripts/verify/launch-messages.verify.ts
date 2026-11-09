// Checks a business's messages go out as that business (launch L12):
// - Its emails carry its own name as the sender (the shared sending address stays the same), a renter's carry the
//   renter's name, and mail to the owner about their own account keeps the app's name.
// - An email sent when a text couldn't go out does the same.
// - A receipt by text goes through the business's own texting: its number, a client who replied STOP gets none, and
//   receipts switched off in Messages stay off. It used to call the texting provider straight from another setting.
// - Starter menus fit more than salons, and the shared screens use plain words.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-messages.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db: any = makeDb();
let gate = { send: true, reason: '' };
const M: any = Module as any; const load = M._load;
// Dynamic imports arrive as a path: the module's cache entry is swapped for the stand-in.
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin' }], initializeApp: () => ({ name: 'admin' }), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/route-guard') return { staffOrServer: async () => true };
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return fake(request, { gateMessage: async () => gate });
  if (request === './audit' || request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');
type Sent = { url: string; body: any };
let sent: Sent[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  const raw = String(init?.body || '');
  sent.push({ url: String(url), body: raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)) });
  return { ok: true, status: 200, json: async () => ({ id: 'x1', sid: 'SM1', status: 'queued' }) };
};

(async () => {
  process.env.RESEND_API_KEY = 'test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>';
  process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+15550009999';
  const N = await import('../../src/lib/notify');

  console.log('The sender’s name');
  check('a business’s name goes in front of the shared address', N.fromLine('Fern & Co') === '"Fern & Co" <hello@mail.example.com>', N.fromLine('Fern & Co'));
  check('a name can’t break the line (quotes, brackets, new lines)', N.fromLine('Bad "Name" <x@y>\nBcc: z@q') === '"Bad Name x@y Bcc: z@q" <hello@mail.example.com>', N.fromLine('Bad "Name" <x@y>\nBcc: z@q'));
  check('control characters are dropped, and a long name is cut without splitting a character', N.fromLine('Fern\u0000 &\u0007 Co') === '"Fern & Co" <hello@mail.example.com>' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(N.fromLine('x'.repeat(69) + '\u{1F600}rest')), N.fromLine('Fern\u0000 &\u0007 Co'));
  check('no name: the app’s own line', N.fromLine('') === 'ClarityFlow <hello@mail.example.com>' && N.fromLine(null) === 'ClarityFlow <hello@mail.example.com>');
  process.env.NOTIFY_FROM_EMAIL = 'hello@mail.example.com';
  check('a bare sending address works too', N.fromLine('Fern & Co') === '"Fern & Co" <hello@mail.example.com>');
  process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>';

  await db.doc('tenants/t1').set({ name: 'Fern & Co', email: 'hello@fern.test' });
  const mail = () => sent.filter((x) => x.url.includes('resend')).pop()?.body;
  sent = []; await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'dana@x.test', subject: 'See you soon', text: 'Your visit is tomorrow.', recipientType: 'client' } as any);
  check('a client’s email is from the business', mail()?.from === '"Fern & Co" <hello@mail.example.com>', mail()?.from);
  sent = []; await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'mia@x.test', subject: 'Your shifts', text: 'Your week.', recipientType: 'staff' } as any);
  check('so is the team’s', mail()?.from === '"Fern & Co" <hello@mail.example.com>', mail()?.from);
  sent = []; await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'dana@x.test', subject: 'From Kira', text: 'See you.', fromName: 'Kira Nails', recipientType: 'client' } as any);
  check('a renter’s email is in the renter’s name', mail()?.from === '"Kira Nails" <hello@mail.example.com>', mail()?.from);
  sent = []; await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'owner@x.test', subject: 'New applicant', text: 'A new application.', recipientType: 'other', recipientName: 'Owner' } as any);
  check('mail to the owner about their account keeps the app’s name', mail()?.from === 'ClarityFlow <hello@mail.example.com>', mail()?.from);
  sent = []; await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'dana@x.test', text: 'A note.', recipientType: 'client' } as any);
  check('with no subject, it says who it’s from (never "your studio")', mail()?.subject === 'A note from Fern & Co' && !/studio/i.test(String(mail()?.html || '')), mail()?.subject);

  console.log('An email in place of a text');
  const { sendTenantSms } = await import('../../src/lib/sms');
  await db.doc('tenants/t1/private/smsOptOuts').set({ '15555550123': true });
  sent = []; const r0 = await sendTenantSms(db, 't1', '(555) 555-0123', 'Your order is ready.', { email: 'dana@x.test', subject: 'Order ready' }, { kind: 'order_ready', recipientType: 'client' });
  check('a client who replied STOP gets the email instead, from the business', r0.ok && r0.via === 'email' && mail()?.from === '"Fern & Co" <hello@mail.example.com>' && !sent.some((x) => x.url.includes('twilio')), { r0, from: mail()?.from });
  check('and it says who it’s from at the end, never "the studio"', /Fern & Co \(sent by email because your phone couldn’t receive our text\)$/.test(String(mail()?.text || '')), mail()?.text);

  console.log('A receipt by text');
  const R = await import('../../src/app/api/notifications/send-receipt/route');
  const receipt = { clientName: 'Dana Fox', studioName: 'Fern & Co', studioPhone: '(555) 010-0000', lineItems: [{ label: 'Haircut', amount: 40 }], subtotal: 40, tax: 0, tip: 5, discount: 0, recovery: 0, total: 45, tendered: 50, change: 5, paymentMethod: 'Cash', date: 'Nov 8, 3:10 PM' };
  const post = async (b: any) => { const r: any = await R.POST({ json: async () => b, headers: { get: () => null } } as any); return { status: r.status, ...r.body }; };
  await db.doc('tenants/t1').set({ sms: { fromNumber: '+15550001111' } }, { merge: true });
  sent = []; const s1 = await post({ type: 'sms', contact: '(555) 222-3344', tenantId: 't1', receipt });
  const tw = sent.find((x) => x.url.includes('twilio'))?.body;
  check('it goes out on the business’s own number, with its name once', s1.ok && tw?.From === '+15550001111' && tw?.To === '+15552223344' && /^Fern & Co: Your receipt, Nov 8, 3:10 PM/.test(tw?.Body) && (tw?.Body.match(/Fern & Co/g) || []).length === 1, { s1, tw });
  check('and it’s in the business’s message log as a receipt to a client', (await db.collection('tenants/t1/messageLog').get()).docs.some((d: any) => { const x = d.data(); return x.kind === 'receipt' && x.recipientType === 'client' && x.channel === 'sms'; }), (await db.collection('tenants/t1/messageLog').get()).docs.map((d: any) => d.data()));
  sent = []; const s2 = await post({ type: 'sms', contact: '(555) 555-0123', tenantId: 't1', receipt });
  check('a client who replied STOP gets no receipt by text', !s2.ok && /STOP/.test(s2.reason) && !sent.some((x) => x.url.includes('twilio')), s2);
  gate = { send: false, reason: 'Receipts are off in Messages.' };
  sent = []; const s3 = await post({ type: 'sms', contact: '(555) 222-3344', tenantId: 't1', receipt });
  check('receipts switched off stay off', !s3.ok && s3.reason === 'Receipts are off in Messages.' && !sent.length, s3);
  gate = { send: true, reason: '' };
  const s4 = await post({ type: 'sms', contact: '(555) 222-3344', receipt });
  check('a receipt needs its business', s4.status === 400, s4);
  const rs = read('src/app/api/notifications/send-receipt/route.ts');
  check('staff see the server’s own reason when a text receipt can’t go', /throw new Error\(String\(data\?\.reason \|\| data\?\.error \|\| ''\)\)/.test(read('src/components/pos/CashCheckout.tsx')) && /description: why \|\| \(/.test(read('src/components/pos/CashCheckout.tsx')));
  check('an emailed receipt without a business name says just "Your receipt"', /\? `Your receipt from \$\{String\(receipt\.studioName\)\.trim\(\)\}` : 'Your receipt'/.test(read('src/app/api/notifications/send-receipt/route.ts')));
  check('the route never calls the texting provider itself', !/api\.twilio\.com|TWILIO_PHONE_NUMBER/.test(rs) && /sendTenantSms\(/.test(rs));

  console.log('Every kind of business');
  const S = await import('../../src/lib/starter-menus');
  check('starter menus for clinics, tattoo, fitness, venues and anything else', ['medspa', 'tattoo', 'fitness', 'events', 'general'].every((id) => (S.STARTER_MENUS.find((m) => m.id === id)?.services.length || 0) >= 5));
  check('none of them priced, every one with a length', S.STARTER_MENUS.every((m) => m.services.every((x: any) => x.duration > 0 && !('price' in x))));
  const { guessNiche } = await import('../../src/lib/niche');
  check('a menu a business started from tells what kind it is', guessNiche({ movingIn: { starterMenu: 'tattoo' } }) === 'tattoo' && guessNiche({ movingIn: { starterMenu: 'fitness' } }) === 'fitness' && guessNiche({ movingIn: { starterMenu: 'general' } }) === 'general');
  const dash = read('src/app/(app)/dashboard/page.tsx');
  check('the first screen is in plain words, without salon or lounge jargon', !/Command Hub|Hospitality Priority|Live Studio Pulse|Studio Performance|Asset Safeguard|Arrears Recovery|Technical Sessions|Yield Dossier/.test(dash) && /AppHeader title="Today"/.test(dash));
  check('the lounge sections show only for a business that uses its lounge', /const usesLounge = moduleEnabled\(selectedTenant, 'hospitality'\) && \(/.test(dash) && (dash.match(/\{usesLounge && \(/g) || []).length === 2);
  check('what’s owed shows in amber, not the red kept for deleting', !/destructive/.test(dash.slice(dash.indexOf('const owed ='))));
  const side = read('src/components/shared/AppSidebar.tsx'); const add = read('src/components/staff/AddStaffDialog.tsx');
  check('shared screens use plain words, not salon ones', !/area: 'Studio'|label="Studio"|'Your studio'/.test(side) && !/Studio Role|technician|studio credentials/.test(add));
  check('the stray old mail file is gone', !existsSync('src/notify.ts'));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
