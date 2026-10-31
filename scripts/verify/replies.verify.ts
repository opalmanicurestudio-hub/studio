// scripts/verify/replies.verify.ts — Row 15 part 1: the replies playbook (mockup 10G). Ready replies the team picks,
// filled in from the order and editable before they go; the business can reword, hide or add its own, only through the
// server and only with the settings role. What sends on its own: Message received in the shop's own words, and the new
// Report received when a report waits for the shop.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/replies.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'jess', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: ['settings.manage'] };
const told: any[] = [];
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') {
    class R { status: number; body: any; headers: any; constructor(b: any, init?: any) { this.body = b; this.status = init?.status || 200; this.headers = init?.headers || {}; } static json(body: any, init?: any) { return { status: init?.status || 200, body, headers: init?.headers || {} }; } }
    return { NextResponse: R, after: (fn: any) => { void Promise.resolve().then(fn); } };
  }
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { told.push(m); return { ok: true, status: 'sent' }; } };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://shop.test', searchParams: new URLSearchParams('') } }) as any;
const fresh = async (tenant: any = {}) => {
  db = strictTransactions(makeDb()); told.length = 0;
  actor = { uid: 'jess', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: ['settings.manage'] };
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal Studio', ...tenant });
};

(async () => {
  const R = await import('../../src/lib/replies');
  console.log('the playbook');
  const base = R.playbook([]);
  check('built-in replies for asking, declining and messages, each named once', ['claim_ask', 'claim_decline', 'message'].every((s) => base.some((r) => r.situation === s)) && new Set(base.map((r) => r.id)).size === base.length && base.every((r) => r.builtIn));
  check('…in the same {{detail}} form as the shop messages, and only details a reply can fill', base.every((r) => R.checkReply(r).ok));
  const mine = R.playbook([{ id: 'b_running_late', name: 'Late', text: 'Order {{order_number}} is running behind.' }, { id: 'b_looking', hidden: true }, { id: 'x2', situation: 'message', name: 'Second', text: 'Two', createdAt: '2026-10-02' }, { id: 'x1', situation: 'message', name: 'First', text: 'One', createdAt: '2026-10-01' }, { id: 'bad', situation: 'nope', name: 'x', text: 'y' }]);
  const late = mine.find((r) => r.id === 'b_running_late')!;
  check('a reworded built-in keeps its place, marked reworded', late.name === 'Late' && late.changed === true && mine.findIndex((r) => r.id === 'b_running_late') < mine.findIndex((r) => r.id === 'x1'));
  check('a hidden one leaves the reply boxes (the settings page still shows it)', !mine.some((r) => r.id === 'b_looking') && R.playbook([{ id: 'b_looking', hidden: true }], { withHidden: true }).find((r) => r.id === 'b_looking')?.hidden === true);
  check('the business’s own come after, oldest first; a broken one is left out', mine.filter((r) => !r.builtIn).map((r) => r.id).join() === 'x1,x2');
  check('each reply box gets only its own kind', R.repliesFor([], 'claim_decline').every((r) => r.situation === 'claim_decline') && R.repliesFor([], 'claim_decline').length >= 3);

  console.log('filled in from the order');
  const f = R.fillReply('Thanks, {{client_first}}. Order {{order_number}}: {{item}} for {{amount}} from {{studio}}.', { client_first: 'Maya', order_number: '1214', item: 'Rose Cuticle Oil', amount: '$18.00', studio: 'Opal Studio' });
  check('every detail filled', f === 'Thanks, Maya. Order 1214: Rose Cuticle Oil for $18.00 from Opal Studio.' && !R.hasGap(f), f);
  const g = R.fillReply('Could you send a photo of {{item}}?', { client_first: 'Maya' });
  check('a detail the order doesn’t have stays as [label], so the sender sees the gap before it goes', g === 'Could you send a photo of [item]?' && R.hasGap(g));
  check('a detail that isn’t one comes out empty, never as {{machinery}}', R.fillReply('Hi {{nope}}there', {}) === 'Hi there');
  check('the settings page shows details by name', R.readable('Hi {{client_first}}, order {{order_number}}') === 'Hi [first name], order [order number]');

  console.log('saving a reply is checked');
  check('it needs a kind, a name and words', !R.checkReply({ name: 'a', text: 'b' }).ok && !R.checkReply({ situation: 'message', text: 'b' }).ok && !R.checkReply({ situation: 'message', name: 'a', text: '  ' }).ok);
  check('…a short name and a reply under 800 characters', !R.checkReply({ situation: 'message', name: 'x'.repeat(61), text: 'b' }).ok && !R.checkReply({ situation: 'message', name: 'a', text: 'x'.repeat(801) }).ok);
  const unk: any = R.checkReply({ situation: 'message', name: 'a', text: 'Your {{link}} is here' });
  check('…and only details a reply can fill in', !unk.ok && /\{\{link\}\}/.test(unk.error));
  check('…the amount only in a claim reply (a message has none to fill in)', !R.checkReply({ situation: 'message', name: 'a', text: 'That’s {{amount}}' }).ok && R.checkReply({ situation: 'claim_decline', name: 'a', text: 'That’s {{amount}}' }).ok && !R.tokensFor('message').some((t) => t.key === 'amount') && R.tokensFor('claim_ask').some((t) => t.key === 'amount'));

  console.log('picking a reply');
  const RC = await import('../../src/components/orders/ReplyChips');
  check('into an empty box it goes in', RC.pickInto('', null, 'Hi.') === 'Hi.');
  check('…it replaces an earlier pick nobody changed', RC.pickInto('First reply', 'First reply', 'Second') === 'Second');
  check('…and goes under anything they wrote, never over it (after a space in a one-line box)', RC.pickInto('I checked the shelf.', 'First reply', 'Second') === 'I checked the shelf.\n\nSecond' && RC.pickInto('Typed', null, 'Second') === 'Typed\n\nSecond' && RC.pickInto('Typed', null, 'Second', ' ') === 'Typed Second');
  check('a question on a claim fits what a request for more can carry', !R.checkReply({ situation: 'claim_ask', name: 'a', text: 'x'.repeat(401) }).ok && R.checkReply({ situation: 'claim_decline', name: 'a', text: 'x'.repeat(401) }).ok);
  const ctx = RC.replyContext({ customerName: 'Maya Rivera', orderNumber: 31, lines: [{ name: 'Rose Cuticle Oil' }] }, 'Opal Studio');
  check('filled from the order: first name, order number, the item when there’s one', ctx.client_first === 'Maya' && ctx.order_number === '0031' && ctx.item === 'Rose Cuticle Oil' && RC.replyContext({ lines: [{ name: 'a' }, { name: 'b' }] }, '').item === '');

  console.log('changing the playbook (the server only)');
  const API = (await import('../../src/app/api/replies/route')).POST;
  await fresh();
  let r: any = await API(req({ tenantId: 't1', action: 'save', id: 'b_running_late', situation: 'message', name: 'Running behind', text: 'Sorry, order {{order_number}} is running behind. We’ll message you here.' }));
  let d = await get(`${T}/replies/b_running_late`);
  check('a built-in reply reworded', r.status === 200 && d?.name === 'Running behind' && d?.situation === 'message' && d?.updatedBy?.name === 'Jessica Marshall', { s: r.status, d });
  r = await API(req({ tenantId: 't1', action: 'save', id: 'b_running_late', situation: 'claim_ask', name: 'Running behind', text: 'x' }));
  check('…keeps its kind, whatever the screen sends', (await get(`${T}/replies/b_running_late`))?.situation === 'message');
  r = await API(req({ tenantId: 't1', action: 'save', situation: 'claim_decline', name: 'Opened polish', text: 'Opened polish can’t be returned for hygiene reasons, {{client_first}}.' }));
  const newId = r.body.id;
  check('a reply of your own added', r.status === 200 && (await get(`${T}/replies/${newId}`))?.name === 'Opened polish');
  r = await API(req({ tenantId: 't1', action: 'save', id: newId, situation: 'claim_decline', name: 'Opened polish', text: 'Changed words.' }));
  check('…and changed', (await get(`${T}/replies/${newId}`))?.text === 'Changed words.');
  r = await API(req({ tenantId: 't1', action: 'save', situation: 'message', name: 'x', text: 'Hi {{password}}' }));
  check('a reply that doesn’t pass the checks isn’t saved', r.status === 400 && /isn’t a detail/.test(r.body.error));
  r = await API(req({ tenantId: 't1', action: 'hide', id: 'b_looking' }));
  check('a built-in reply hidden', (await get(`${T}/replies/b_looking`))?.hidden === true && !R.playbook((await db.collection(`${T}/replies`).get()).docs.map((x: any) => x.data())).some((x) => x.id === 'b_looking'));
  await API(req({ tenantId: 't1', action: 'save', id: 'b_looking', situation: 'message', name: 'On it', text: 'On it, {{client_first}}.' }));
  r = await API(req({ tenantId: 't1', action: 'reset', id: 'b_looking' }));
  const lk = await get(`${T}/replies/b_looking`);
  check('…back to its built-in words, still hidden', lk?.hidden === true && !lk?.name && !lk?.text, lk);
  r = await API(req({ tenantId: 't1', action: 'show', id: 'b_looking' }));
  check('…and brought back', R.playbook((await db.collection(`${T}/replies`).get()).docs.map((x: any) => x.data())).some((x) => x.id === 'b_looking'));
  r = await API(req({ tenantId: 't1', action: 'remove', id: 'b_packing_photo' }));
  check('a built-in reply can be hidden, not deleted', r.status === 400);
  r = await API(req({ tenantId: 't1', action: 'remove', id: newId }));
  check('one of your own removed', r.status === 200 && !(await get(`${T}/replies/${newId}`)));
  const logs = (await db.collection(`${T}/auditLogs`).get()).docs.map((x: any) => x.data());
  check('each change is in the activity log, with who', logs.some((l: any) => l.action === 'replies.changed' && /Reworded the ready reply/.test(l.summary)) && logs.some((l: any) => /Removed the ready reply “Opened polish”/.test(l.summary)));
  for (let i = 0; i < R.CUSTOM_REPLY_MAX; i++) await db.doc(`${T}/replies/c${i}`).set({ id: `c${i}`, situation: 'message', name: `R${i}`, text: 'x' });
  r = await API(req({ tenantId: 't1', action: 'save', situation: 'message', name: 'One more', text: 'x' }));
  check(`at most ${R.CUSTOM_REPLY_MAX} of your own`, r.status === 400 && /Remove one/.test(r.body.error));
  actor = { uid: 'sam', name: 'Sam Ortiz', role: 'staff', caps: ['checkout.take'] };
  r = await API(req({ tenantId: 't1', action: 'save', situation: 'message', name: 'Mine', text: 'x' }));
  check('only people whose role runs the settings can change it', r.status === 403);

  console.log('what sends on its own');
  await fresh();
  r = await API(req({ tenantId: 't1', action: 'auto', kind: 'claim_received', on: false }));
  check('Report received turned off', r.status === 200 && (await get(T))?.messagePolicy?.claim_received?.emailEnabled === false);
  r = await API(req({ tenantId: 't1', action: 'auto', kind: 'support_ack', on: false }));
  check('…Message received isn’t offered (a message shows on their order page as they send it; nothing is emailed)', r.status === 400 && !(R.AUTOMATIC_KINDS as readonly string[]).includes('support_ack'));
  r = await API(req({ tenantId: 't1', action: 'auto', kind: 'claim_decision', on: false }));
  check('…the claim decision can’t be (they reported a problem; the decision is the point)', r.status === 400 && (await get(T))?.messagePolicy?.claim_decision === undefined);
  r = await API(req({ tenantId: 't1', action: 'auto', kind: 'booking_confirmation', on: false }));
  check('…and only the shop’s own messages are changed here', r.status === 400);

  const P = await import('../../src/lib/message-policy');
  const def = P.MESSAGE_KIND_BY_ID.claim_received;
  check('Report received is a shop message: on unless turned off, with its own wording', !!def && def.group === 'Retail' && def.canDisable && /packing record/.test(def.defaultBody || '') && P.validateOverride('claim_received', 'Hi {{client_first}}, we have it. {{link}}').ok && !P.validateOverride('claim_received', 'Hi {{client_first}}, we have it.').ok);
  const RR = await import('../../src/lib/report-received');
  await fresh();
  const claim = { id: 'c1', orderId: 'o1', orderNumber: 1214, customerName: 'Maya Rivera', customerEmail: 'maya@example.com', type: 'missing', lineName: 'Rose Cuticle Oil' };
  let out = await RR.tellReportReceived(db, 't1', claim, 'https://shop.test');
  let m = told[0];
  check('a report waiting for the shop: they’re told it’s in, by email', out.sent && m?.kind === 'claim_received' && m.to === 'maya@example.com' && m.subject === 'We have your report about order 1214', m);
  check('…about the item, with the built-in wording and a button to their order', /Thank you for letting us know about Rose Cuticle Oil/.test(m.html) && /\/shop\/t1\/order\/o1/.test(m.html) && !/\{\{/.test(m.html) && /Hi Maya/.test(m.text));
  check('…carrying the details, so the shop’s own wording is filled in too', m.tokens?.client_first === 'Maya' && m.tokens?.item === 'Rose Cuticle Oil' && m.tokens?.order_number === '1214' && /\/shop\/t1\/order\/o1/.test(m.tokens?.link || ''), m.tokens);
  // The real email sender, with a stand-in for the email service: the shop's own wording arrives filled in.
  await db.doc(T).update({ 'messagePolicy.claim_received.body': 'Hi {{client_first}}! Got your note about {{item}}. {{link}}', 'messagePolicy.claim_received.subject': 'Order {{order_number}}: we have it' });
  const sent: any[] = []; const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: any) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ id: 'em1' }) }; };
  process.env.RESEND_API_KEY = 'k'; process.env.NOTIFY_FROM_EMAIL = 'Opal <hi@shop.test>';
  const NT = await import('../../src/lib/notify');
  await NT.sendNotification(db, m);
  (globalThis as any).fetch = realFetch;
  const em = sent.find((x) => /resend/.test(x.url))?.body;
  check('…in the shop’s own words when it wrote some, with every detail filled in (none left blank)', !!em && /Hi Maya! Got your note about Rose Cuticle Oil\./.test(em.text || '') && em.subject === 'Order 1214: we have it' && /\/shop\/t1\/order\/o1/.test(em.html || em.text || ''), em ? { subject: em.subject, text: em.text } : sent);
  told.length = 0;
  await db.doc(T).update({ 'messagePolicy.claim_received.emailEnabled': false });
  told.length = 0; out = await RR.tellReportReceived(db, 't1', claim, 'https://shop.test');
  check('…not when the shop turned it off', !out.sent && out.why === 'off' && told.length === 0);
  told.length = 0; out = await RR.tellReportReceived(db, 't1', { ...claim, customerEmail: '' }, 'https://shop.test');
  check('…and not without an email (they saw it on their order page as they sent it)', !out.sent && told.length === 0);
  const cr = fs.readFileSync('src/app/api/retail/claims/route.ts', 'utf8');
  check('the report route tells them only when it waits for the shop (an approval on the spot sends its decision), after answering', /if \(!filed\.approved\) \{\s*const tell = async/.test(cr) && /try \{ after\(tell\); \} catch \{ void tell\(\); \}/.test(cr) && cr.indexOf('tellReportReceived(db') > cr.indexOf('if (filed.dup) return'));
  const cd = P.MESSAGE_KIND_BY_ID.claim_decision;
  check('the claim decision’s own wording has to keep the reason they were declined and the way to their order (to appeal)', cd.requiredTokens.includes('{{reason}}') && cd.requiredTokens.includes('{{link}}') && !P.validateOverride('claim_decision', 'Hi {{client_first}}, we said no.').ok && !P.validateOverride('claim_decision', 'Not this time: {{reason}}').ok && P.validateOverride('claim_decision', 'Hi {{client_first}}, not this time: {{reason}} {{link}}').ok && /\{\{reason\}\}/.test(cd.defaultBody || ''));
  const old = P.resolveMessagePolicy({ messagePolicy: { claim_decision: { body: 'Hi {{client_first}}, we reviewed it. {{link}}' } } }, 'claim_decision', 'email');
  check('…wording saved before that is set aside for the built-in, and says so', !old.custom && /\{\{reason\}\}/.test(old.overrideRejected || '') && /Not in use/.test(fs.readFileSync('src/app/(app)/settings/messages/page.tsx', 'utf8')) && /so the built-in wording goes out instead/.test(fs.readFileSync('src/app/(app)/settings/messages/page.tsx', 'utf8')));
  const cn = fs.readFileSync('src/app/api/retail/claim-notify/route.ts', 'utf8');
  check('…and the decision email carries the details, the reason among them, with the reason made safe for an email', /tokens: \{ client_first: firstName, order_number: [^}]*reason: String\(decision\.declineReason \|\| ''\), link: orderLink, studio: shopName \}/.test(cn) && /String\(decision\.declineReason\)\.replace\(\/&\/g, '&amp;'\)/.test(cn));

  console.log('the Client messages page');
  const MS = await import('../../src/lib/message-settings');
  check('switches, timing and wording are checked one by one', MS.checkMessageSetting('messagePolicy.claim_received.emailEnabled', false).ok && !MS.checkMessageSetting('messagePolicy.claim_decision.emailEnabled', false).ok
    && !MS.checkMessageSetting('messagePolicy.claim_decision.body', 'We said no.').ok && MS.checkMessageSetting('messagePolicy.claim_decision.body', '').ok && !MS.checkMessageSetting('messagePolicy.nope.body', 'x').ok);
  check('…and nothing else on the business can be set from there', !MS.checkMessageSetting('subscriptionStatus', 'active').ok && !MS.checkMessageSetting('messagePolicy.claim_received.emailEnabled', 'yes').ok && !MS.checkMessageSetting('callbackEmail.anything', true).ok
    && (MS.checkMessageSetting('messageQuietHours', { enabled: true, startHour: 21, endHour: 8, extra: 1 }) as any).value?.extra === undefined);
  const MSR = (await import('../../src/app/api/message-settings/route')).POST;
  await fresh();
  r = await MSR(req({ tenantId: 't1', updates: { 'messagePolicy.claim_received.body': 'Hi {{client_first}}, we have it. {{link}}', 'messagePolicy.claim_received.subject': 'Got it' } }));
  check('saved through the server for anyone whose role runs the settings, not only the owner', r.status === 200 && (await get(T))?.messagePolicy?.claim_received?.body === 'Hi {{client_first}}, we have it. {{link}}');
  r = await MSR(req({ tenantId: 't1', updates: { 'messagePolicy.constructor.body': 'x', 'messagePolicy.toString.emailEnabled': true } }));
  check('…an odd name that isn’t a message is refused, not saved and not a crash', r.status === 400 && !(await get(T))?.messagePolicy?.constructor?.body);
  r = await MSR(req({ tenantId: 't1', updates: { ownerId: 'me' } }));
  check('…refusing anything that isn’t a message setting', r.status === 400 && !(await get(T))?.ownerId);
  actor = { uid: 'sam', name: 'Sam Ortiz', role: 'staff', caps: ['checkout.take'] };
  r = await MSR(req({ tenantId: 't1', updates: { 'messagePolicy.claim_received.emailEnabled': false } }));
  check('…and not for anyone else', r.status === 403);
  const mp = fs.readFileSync('src/app/(app)/settings/messages/page.tsx', 'utf8');
  check('the page saves through the server and opens for the settings role', /fetch\('\/api\/message-settings'/.test(mp) && /tenantCtx\.can\('settings\.manage'\)/.test(mp) && !/updateDoc\(/.test(mp));

  console.log('in the reply boxes');
  const cp = fs.readFileSync('src/components/orders/workspace/CustomerPane.tsx', 'utf8');
  const pp = fs.readFileSync('src/components/orders/ProblemPanel.tsx', 'utf8');
  check('the order’s reply box and the Problems message card offer the ready replies', /<ReplyChips className="mb-2" fs=\{fs\} tenantId=\{tenantId\} situation="message"/.test(cp) && /<ReplyChips className="mt-3" fs=\{fs\} tenantId=\{tenantId\} situation="message"/.test(pp) );
  check('…and a reply with a gap left can’t be sent until it’s filled in', /disabled=\{!text\.trim\(\) \|\| !!busy \|\| hasGap\(text\)\}/.test(cp) && /disabled=\{!text\.trim\(\) \|\| !!busy \|\| hasGap\(text\)\}/.test(pp) && /<GapNote text=\{text\} \/>/.test(cp) && /<GapNote text=\{text\} \/>/.test(pp));
  const chips = fs.readFileSync('src/components/orders/ReplyChips.tsx', 'utf8');
  check('…read live from the playbook, with a way in to change it for those allowed', /collection\(fs, `tenants\/\$\{tenantId\}\/replies`\)/.test(chips) && /t\.can\('settings\.manage'\)/.test(chips) && /href="\/settings\/replies"/.test(chips));
  check('…and none shown until the business’s own have loaded, or if they can’t be (never a hidden one’s built-in words)', /if \(!Array\.isArray\(stored\)\) return null;/.test(chips) && /\(\) => setStored\(false\)/.test(chips) && /The replies couldn’t be loaded/.test(fs.readFileSync('src/components/settings/RepliesScreen.tsx', 'utf8')));
  check('a second pick replaces a first nobody changed (the earlier pick is read before the box updates)', [cp, pp].every((x) => /const prev = lastFill\.current; setText\(\(cur\) => pickInto\(cur, prev, t\)\)/.test(x)) && /const prev = lastFill\.current\[`no-\$\{c\.id\}`\] \?\? null; setDeclineWhy\(\(cur\) => pickInto\(cur, prev, t\)\)/.test(fs.readFileSync('src/app/(app)/retail-orders/claims/page.tsx', 'utf8')));
  const cl = fs.readFileSync('src/app/(app)/retail-orders/claims/page.tsx', 'utf8');
  check('asking for something on a claim and declining one offer their replies too, with the gap check', /situation="claim_ask"/.test(cl) && /situation="claim_decline"/.test(cl) && /hasGap\(declineWhy\)/.test(cl) && /hasGap\(askFor\[c\.id\] \|\| ''\)/.test(cl));
  check('…the one-line question box keeps words apart and within 400 characters; no order number is a gap, not 0000', /const one = t\.slice\(0, 400\); const joined = pickInto\(askFor\[c\.id\] \|\| '', lastFill\.current\[`ask-\$\{c\.id\}`\] \?\? null, one, ' '\);\s*const next = joined\.length > 400 \? one : joined;/.test(cl) && /maxLength=\{400\}/.test(cl) && /order_number: c\.orderNumber != null \?/.test(cl));
  check('Settings lists Replies, and the shop messages point to it', /href: '\/settings\/replies'/.test(fs.readFileSync('src/components/settings/SettingsHome.tsx', 'utf8')) && /href="\/settings\/replies"/.test(fs.readFileSync('src/app/(app)/settings/messages/page.tsx', 'utf8')));
  const rs = fs.readFileSync('src/components/settings/RepliesScreen.tsx', 'utf8');
  check('the Replies screen changes things only through the server', /fetch\('\/api\/replies'/.test(rs) && !/setDoc|updateDoc|addDoc|deleteDoc/.test(rs));

  console.log('the wiring');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  check('the playbook: the team reads it, only the server writes it', /match \/tenants\/\{tenantId\}\/replies\/\{replyId\} \{\s+allow read: if isTeam\(tenantId\);\s+allow write: if false;/.test(rules) && /'retailReviews', 'reviews', 'replies',/.test(rules));
  const files = ['src/lib/replies.ts', 'src/lib/report-received.ts', 'src/app/api/replies/route.ts', 'src/components/orders/ReplyChips.tsx', 'src/components/settings/RepliesScreen.tsx', 'src/app/(app)/settings/replies/page.tsx', 'src/lib/message-settings.ts', 'src/app/api/message-settings/route.ts'];
  const words = files.map((x) => fs.readFileSync(x, 'utf8')).join('\n');
  const tool = new RegExp(String.fromCharCode(67, 108, 97, 117, 100, 101), 'i');
  check('no mention of the tool that wrote this, no "call us", no JSX comments, US spelling', !tool.test(words) && !/call us/i.test(words) && !/\{\/\*/.test(words) && !/cancelled/i.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
