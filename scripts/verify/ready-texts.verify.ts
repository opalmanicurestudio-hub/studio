// Checks a text when it's ready and Order again (design board "Ready texts and order again"; lib/ready-text).
// - Only when the guest asks (the kiosk after paying, ordering ahead, or the counter for them): a 10-digit number, on a
//   counter, kiosk or order-ahead order that isn't done; never where the business can't text or turned it off.
// - One text, the moment every part of the order is ready (not before, not twice); handed over first, or voided, the
//   number goes; one waiting six hours is let go; only the last four digits stay.
// - What it says: the order and where to pick it up; placed ahead, how (drive-thru, curbside, inside) and its page.
// - A number that replied STOP gets nothing, and it isn't tried again.
// - The kitchen's ready and picked-up steps send it; the kiosk, order page, counter page and Menu page ask or switch it.
// - Order again: kept on the guest's own phone, favorites and the last few, checked against today's menu.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ready-texts.verify.ts
import * as fs from 'fs';
import { makeDb, check, failures } from './fake-db';

process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+18325550100';
process.env.ORDER_TRACK_SECRET = 'track-secret-for-tests';
delete process.env.VERCEL_PROJECT_PRODUCTION_URL; delete process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
const texts: { to: string; body: string }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('twilio')) { const p = new URLSearchParams(String(init?.body || '')); texts.push({ to: String(p.get('To')), body: String(p.get('Body')) }); }
  return { ok: true, status: 201, json: async () => ({ sid: `SM${texts.length}` }) };
};

const src = (p: string) => fs.readFileSync(p, 'utf8');
const T = 'tenants/t1';
const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

(async () => {
  const R = await import('@/lib/ready-text');
  const db: any = makeDb();
  const tenant: any = { name: 'North Pier Coffee', publicOrigin: 'https://app.example.com' };
  await db.doc(T).set(tenant);
  const order = (id: string, o: any) => db.doc(`${T}/counterOrders/${id}`).set({ id, number: 'C24', channel: 'counter', status: 'sent', ...o });
  const ticket = (id: string, o: any) => db.doc(`${T}/kdsTickets/${id}`).set({ id, channel: 'counter', status: 'pending', ...o });
  const rt = async (id: string) => ((await db.doc(`${T}/counterOrders/${id}`).get()).data() || {}).readyText;

  console.log('Offered only where it can go');
  check('on where the business can text and hasn’t turned it off', R.readyTextsOn(tenant) === true && R.readyTextsOn({ readyTexts: { off: true } }) === false);
  const sid = process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_ACCOUNT_SID;
  check('off where texting isn’t set up', R.readyTextsOn(tenant) === false);
  process.env.TWILIO_ACCOUNT_SID = sid;

  console.log('Only when asked, and only a real number');
  await order('c1', { status: 'building' });
  let r: any = await R.askReadyText(db, 't1', tenant, 'c1', '(832) 555-0142', 'counter');
  check('the counter asks for them while it’s being taken: kept on the order, the last four for showing', r.ok && r.last4 === '0142' && r.sent === false && (await rt('c1')).to === '+18325550142' && (await rt('c1')).via === 'counter' && !!(await rt('c1')).pendingSince, [r, await rt('c1')]);
  r = await R.askReadyText(db, 't1', tenant, 'c1', '555-12', 'counter');
  check('not ten digits: said', !r.ok && r.status === 400 && r.code === 'phone');
  await order('d1', { channel: 'drive-thru' });
  r = await R.askReadyText(db, 't1', tenant, 'd1', '8325550142', 'counter');
  check('not for a drive-thru car (it waits at the window)', !r.ok && r.status === 404 && !(await rt('d1')));
  await order('v1', { status: 'voided' });
  r = await R.askReadyText(db, 't1', tenant, 'v1', '8325550142', 'counter');
  check('not for an order that’s done or voided', !r.ok && r.code === 'done');
  r = await R.askReadyText(db, 't1', { readyTexts: { off: true } }, 'c1', '8325550142', 'counter');
  check('not where the business turned it off', !r.ok && r.code === 'off');
  r = await R.askReadyText(db, 't1', tenant, 'c1', null, 'counter');
  check('taken back: the number goes', r.ok && (await rt('c1')).to === null && (await rt('c1')).last4 === null && (await rt('c1')).pendingSince === null);
  check('…and nothing shows for it', R.readyTextView({ readyText: await rt('c1') }) === null);

  console.log('One text, when every part is ready');
  texts.length = 0;
  await order('c2', {});
  await ticket('k1', { orderId: 'c2', status: 'ready' }); await ticket('k2', { orderId: 'c2', status: 'in_progress' });
  r = await R.askReadyText(db, 't1', tenant, 'c2', '8325550142', 'counter');
  check('asked while it’s being made: not sent yet', r.ok && r.sent === false && texts.length === 0);
  check('the order shows it’s waiting to text', JSON.stringify(R.readyTextView({ readyText: await rt('c2') })) === JSON.stringify({ last4: '0142', sent: false, failed: false }));
  check('one part ready, one not: nothing yet', await R.textWhenTicketsReady(db, 't1', ['k1']) === 0 && texts.length === 0);
  await ticket('k2', { orderId: 'c2', status: 'ready' });
  const n = await R.textWhenTicketsReady(db, 't1', ['k2']);
  check('all of it ready: one text, the business’s name first', n === 1 && texts.length === 1 && texts[0].to === '+18325550142' && /^North Pier Coffee: Order C24 is ready\. Pick it up at the counter\./.test(texts[0].body), texts);
  const after = await rt('c2');
  check('…and the number goes once it’s sent (only the last four stay)', after.to === null && after.last4 === '0142' && !!after.sentAt && after.ok === true && after.pendingSince === null, after);
  check('…shown as sent', R.readyTextView({ readyText: after })?.sent === true && R.readyTextView({ readyText: after })?.failed === false);
  const logs = (await db.collection(`${T}/private/smsLog/messages`).get()).docs.map((d: any) => d.data());
  check('the business’s text log keeps the last four digits only, and the words without a link', logs.length === 1 && logs[0].to === '···0142' && /Order C24 is ready/.test(logs[0].body) && !/8325550142/.test(JSON.stringify(logs)), logs);
  check('…and it isn’t added to the message log of conversations', (await db.collection(`${T}/messageLog`).get()).size === 0);
  check('the STOP list can still find the number (the first-text record keeps it, as for every text)', !!((await db.doc(`${T}/private/smsRecipients`).get()).data() || {})['18325550142']);
  const sentAt = (m: number) => new Date(Date.now() - m * 60000).toISOString();
  check('sent with no answer yet: shown as sent for a minute or two', R.readyTextView({ readyText: { last4: '1', to: null, sentAt: sentAt(0.5), ok: null } })?.failed === false);
  check('…then said it may not have gone (never “texted” for one that didn’t)', R.readyTextView({ readyText: { last4: '1', to: null, sentAt: sentAt(5), ok: null } })?.failed === true);
  check('never twice (marked ready again, or picked up)', await R.textWhenTicketsReady(db, 't1', ['k1', 'k2']) === 0 && texts.length === 1);
  r = await R.askReadyText(db, 't1', tenant, 'c2', '8325550199', 'counter');
  check('asked again after it went: said, and not sent', !r.ok && r.code === 'sent' && texts.length === 1);

  console.log('Asked once it’s ready already');
  await order('c3', { number: 'K12', channel: 'kiosk' });
  await ticket('k3', { orderId: 'c3', channel: 'kiosk', status: 'ready' });
  r = await R.askReadyText(db, 't1', tenant, 'c3', '8325550143', 'kiosk');
  check('the kiosk’s paid screen, with it ready already: it goes now', r.ok && r.sent === true && texts.length === 2 && /Order K12 is ready\. Pick it up at the counter\./.test(texts[1].body), texts[1]);

  console.log('Not when nothing is waiting');
  await order('c4', {}); await ticket('k4', { orderId: 'c4', status: 'pending', holdUntil: new Date(Date.now() + 3600000).toISOString() }); await ticket('k5', { orderId: 'c4', status: 'ready' });
  await R.askReadyText(db, 't1', tenant, 'c4', '8325550144', 'counter');
  check('a part held for later isn’t ready', await R.textWhenTicketsReady(db, 't1', ['k5']) === 0 && texts.length === 2);
  await order('c5', {}); await ticket('k6', { orderId: 'c5', status: 'delivered' });
  await db.doc(`${T}/counterOrders/c5`).set({ readyText: { to: '+18325550145', last4: '0145', via: 'counter', pendingSince: ago(0.1), sentAt: null } }, { merge: true });
  check('all picked up before it was ever ready: no text, and the number goes', await R.textWhenTicketsReady(db, 't1', ['k6']) === 0 && texts.length === 2 && (await rt('c5')).to === null && (await rt('c5')).pendingSince === null);
  await order('c6', {}); await ticket('k7', { orderId: 'c6', status: 'ready' });
  await db.doc(`${T}/counterOrders/c6`).set({ status: 'voided', readyText: { to: '+18325550146', last4: '0146', via: 'counter', pendingSince: ago(0.1), sentAt: null } }, { merge: true });
  check('voided: no text, and the number goes', await R.textIfReady(db, 't1', ['c6']) === 0 && texts.length === 2 && (await rt('c6')).to === null);
  check('a drive-thru ticket never sends one', R.READY_CHANNELS.includes('drive-thru') === false);

  console.log('A number that said STOP');
  await db.doc(`${T}/private/smsOptOuts`).set({ '18325550147': true });
  await order('c7', {}); await ticket('k8', { orderId: 'c7', status: 'ready' });
  r = await R.askReadyText(db, 't1', tenant, 'c7', '8325550147', 'counter');
  const stop = await rt('c7');
  check('gets nothing, it’s marked so, and it’s never tried again', r.ok && r.sent === false && texts.length === 2 && stop.failed === 'stopped' && stop.ok === false && !!stop.sentAt && stop.to === null, stop);
  check('…and the order says the text didn’t go', R.readyTextView({ readyText: stop })?.failed === true);

  console.log('Placed ahead: how to pick it up, and the order’s page');
  await order('a1', { number: '42', channel: 'ahead', ahead: { way: 'inside' } });
  await ticket('k9', { orderId: 'a1', channel: 'ahead', status: 'ready' });
  r = await R.askReadyText(db, 't1', tenant, 'a1', '8325550148', 'ahead');
  const { aheadSig } = await import('@/lib/counter-ahead');
  check('inside: show the code at the counter, with a link to the order’s own page', r.sent && texts.length === 3 && texts[2].body.includes('Order 42 is ready. Show your code at the counter. Your order: https://app.example.com/order/t1?o=a1&s=' + encodeURIComponent(String(aheadSig('t1', 'a1')))), texts[2]);
  const aheadLog = (await db.collection(`${T}/private/smsLog/messages`).get()).docs.map((d: any) => d.data()).find((x: any) => /Order 42/.test(x.body));
  check('…and the log keeps it without the link (it opens their order)', !!aheadLog && !/https?:/.test(aheadLog.body) && aheadLog.to === '···0148', aheadLog);
  check('the drive-thru: pull in and say the code', R.readyWords({ number: '42', channel: 'ahead', ahead: { way: 'drive-thru' } }, null) === 'Order 42 is ready. Pull into the drive-thru and say your code at the speaker.');
  check('curbside: I’m here when they park', R.readyWords({ number: '42', channel: 'ahead', ahead: { way: 'curbside' } }, 'https://x.test/o') === 'Order 42 is ready. Tap I’m here when you park, and we’ll bring it out. Your order: https://x.test/o');
  check('no number on it: “Your order”', R.readyWords({ channel: 'counter' }, null) === 'Your order is ready. Pick it up at the counter.');

  console.log('A number waiting too long');
  await order('c8', { readyText: { to: '+18325550149', last4: '0149', via: 'counter', pendingSince: ago(7), sentAt: null } });
  await order('c9', { readyText: { to: '+18325550150', last4: '0150', via: 'counter', pendingSince: ago(1), sentAt: null } });
  const swept = await R.sweepReadyTexts(db, 't1');
  check('six hours on, it’s let go; an hour on, it waits', swept === 1 && (await rt('c8')).to === null && (await rt('c8')).pendingSince === null && (await rt('c9')).to === '+18325550150', swept);

  console.log('Where it’s sent and asked for');
  const kitchen = src('src/app/api/kitchen/route.ts');
  check('the kitchen screen sends it when a ticket is marked ready, made from a held batch, bumped, or picked up',
    (kitchen.match(/textWhenTicketsReady\(/g) || []).length === 3 && /\(step === 'ready' \|\| step === 'deliver'\) && col === 'kdsTickets' && !r\.already\) await textWhenTicketsReady/.test(kitchen)
    && /await tellPassReady\(db, tenantId, id\); await textWhenTicketsReady\(db, tenantId, \[id\]\);/.test(kitchen) && /step === 'ready' \? readied : kitchen\.map/.test(kitchen));
  check('a send that throws is marked not sent, and the logs are told to forget the number', /catch \(e: any\) \{ r = \{ ok: false, error: e\?\.message \}; \}/.test(src('src/lib/ready-text.ts')) && /skipMessageLog: true, forget: true, logBody: readyWords\(claim\.or, null\)/.test(src('src/lib/ready-text.ts')));
  check('dropped at the counter before it was sent: the number goes', /cancelledBy: by, \.\.\.\(o\.readyText\?\.to \? \{ readyText: \{ to: null, pendingSince: null \} \} : \{\}\)/.test(src('src/app/api/counter/route.ts')));
  check('voided at the counter or handed over: the number goes',
    /\.\.\.\(o\.readyText\?\.to \? \{ readyText: \{ to: null, pendingSince: null \} \} : \{\}\)/.test(src('src/lib/counter-server.ts')) && /doneAt: nowIso, \.\.\.\(order\.readyText\?\.to \? \{ readyText: \{ to: null, pendingSince: null \} \} : \{\}\)/.test(src('src/app/api/counter/route.ts')));
  const ahead = src('src/lib/counter-ahead.ts');
  check('an order placed ahead and never paid: the number goes', (ahead.match(/readyText\?\.to \? \{ readyText: \{ to: null, pendingSince: null \} \} : \{\}/g) || []).length === 2);
  const cron = src('src/app/api/cron/retail-payments/route.ts');
  check('the sweep runs for every business, card payments or not', cron.indexOf('sweepReadyTexts') > 0 && cron.indexOf('sweepReadyTexts') < cron.indexOf('if (!tenant.stripeAccountId && !tenant.stripeConnectAccountId)'));
  const kiosk = src('src/lib/kiosk.ts'), kioskApi = src('src/app/api/kiosk/route.ts');
  check('the kiosk: its own order, paid in the last half hour, and only so many an hour', /export async function kioskTextMe/.test(kiosk) && /!or\.paidAt \|\| Date\.now\(\) - \(Date\.parse\(String\(or\.paidAt\)\) \|\| 0\) > 30 \* 60000/.test(kiosk)
    && /'textMe'/.test(kioskApi) && /limitPublic\(req, 'kiosk_text'/.test(kioskApi) && /texts: readyTextsOn\(tenant\)/.test(kiosk));
  const aheadApi = src('src/app/api/counter/ahead/route.ts');
  check('ordering ahead: asked when placing (ticked), or on the order’s own signed page once it’s paid',
    /\['done', 'track', 'here', 'onway', 'textMe'\]\.includes\(action\) && \(!ID\.test\(orderId\) \|\| !aheadSigOk/.test(aheadApi) && /limitPublic\(req, 'order_ahead_text', tenantId, \{ perHour: 8, perDay: 3000 \}\)/.test(aheadApi) && /!o\.paidAt\) return reply\(\{ ok: false, error: 'Once it’s paid, you can ask for a text\.' \}, 409\)/.test(aheadApi)
    && /const textTo = b\.textMe === true && phone && readyTextsOn\(tenant\) \? toE164\(phone\) : null;/.test(ahead) && /text: !!textTo(, \.\.\.\(deliv \? [^\n]*\))? \}\);/.test(ahead) && /readyText: \{ to: textTo, last4: lastFour\(textTo\), via: 'ahead'/.test(ahead));
  check('the order’s page shows it, and can put the same order together again (what was picked comes with each line)', /text: readyTextView\(or\), texts: readyTextsOn\(tenant\)/.test(ahead) && /itemId: String\(l\.itemId \|\| ''\), picks: picksOf\(l\.choices\)/.test(ahead));
  const counterApi = src('src/app/api/counter/route.ts');
  check('the counter: its own line’s orders only, kept on record, shown on the order and the waiting list', (counterApi.match(/'staffMeal', 'readyText'(, 'merged')?(, 'lineClear')?(, 'deliveryOut', 'deliveryDone', 'deliveryFailed'(, 'deliverySlow')?)?(, 'appStart', 'appSend', 'appCode', 'appCancel'|, 'appSend', 'appCode', 'appCancel')?\]\.includes\(action\)/g) || []).length === 2
    && /action: 'counter\.ready_text'/.test(counterApi) && /text: readyTextView\(o\) \?/.test(counterApi) && /texts: readyTextsOn\(tenant\)(, lanes: [^}]+)? \}/.test(counterApi));
  const menuApi = src('src/app/api/menu/route.ts'), menuPage = src('src/app/(app)/menu/page.tsx');
  check('the Menu page switches it on or off for the business (offered only where texting is set up)', /if \(typeof b\.readyTexts === 'boolean'\)/.test(menuApi) && /readyTexts: \{ off: !b\.readyTexts \}/.test(menuApi) && /readyTexts: smsConfigured\(\) \? td\.readyTexts\?\.off !== true : null/.test(menuApi)
    && /A text when it’s ready/.test(menuPage) && /\[\[true, 'Offer it'\], \[false, 'Don’t offer it'\]\]/.test(menuPage));

  console.log('The screens');
  const kp = src('src/app/drive-thru/[tenantId]/kiosk/page.tsx');
  check('kiosk: Text me when it’s ready after paying, a number pad, one text; it waits while they type and forgets it after',
    /menu\?\.texts && placed\?\.orderId && key && <button[^\n]*>Text me when it’s ready<\/button>/.test(kp) && /function TextMe/.test(kp) && /aria-label="Number pad"/.test(kp) && /One text, just for this order\./.test(kp)
    && /texting \? now - touched\.current > IDLE_MS : now - paidAt\.current > PAID_MS/.test(kp) && /setTexting\(false\); setTexted\(null\);/.test(kp));
  const op = src('src/app/order/[tenantId]/page.tsx');
  check('ordering ahead: Text me when it’s ready is a box they tick (never ticked for them the first time), with the phone',
    /const \[textMe, setTextMe\] = React\.useState\(false\);/.test(op) && /setTextMe\(read\('cf\.ahead\.textMe'\) === '1'\)/.test(op) && /Text me when \{way === 'delivery' \? 'it’s on its way' : 'it’s ready'\}<\/label>/.test(op) && /Add your mobile number for the text, or untick Text me when \$\{deliver \? 'it’s on its way' : 'it’s ready'\}\./.test(op)
    && /\.\.\.\(wantText \? \{ textMe: true \} : \{\}\)/.test(op));
  check('the order’s page: what was asked, Don’t text me, or Text me when it’s ready while it’s being made', /function ReadyTextLine/.test(op) && /const when = onWay \? 'it’s on its way' : 'it’s ready';/.test(op) && /We’ll text you at ···\{t\.text\.last4\} when \{when\}\./.test(op) && /Don’t text me/.test(op) && /if \(!t\.texts \|\| \(!onWay && \(t\.kitchen === 'ready' \|\| t\.kitchen === 'handed'\)\)\) return null;/.test(op));
  const cp = src('src/app/(app)/counter/page.tsx');
  check('the counter page: Text them when it’s ready, if they ask; Don’t text; the waiting list says if it went', /Text them when it’s ready, if they ask/.test(cp) && /action: 'readyText', orderId: order\.id, phone: textDigits/.test(cp) && /Don’t text/.test(cp) && /Gets a text when it’s ready/.test(cp));

  console.log('Order again');
  check('kept on the guest’s own phone only: favorites (5 at most) and the last few (3)', /const pastKey = \(t: string\) => `cf\.ahead\.past\.\$\{t\}`;/.test(op) && /const FAVS_MAX = 5, RECENT_MAX = 3;/.test(op) && !/action: 'again'/.test(op));
  check('a paid order is kept from its own page (however it was paid), and can be made a favorite there', /const list = rememberPast\(tenantId, \{ o, at: new Date\(\)\.toISOString\(\), lines: paidLines \}\);/.test(op) && /aria-pressed=\{fav\} onClick=\{toggleFav\}/.test(op) && />Order this again</.test(op));
  check('today’s menu decides: gone, sold out, or with new choices is left out and said; quantities kept within 1 to 20',
    /isn’t on the menu now/.test(op) && /is sold out right now/.test(op) && /has new choices, so add it from the menu/.test(op) && /Math\.max\(1, Math\.min\(20, Math\.floor\(Number\(l\.quantity\)\) \|\| 1\)\)/.test(op));
  check('at the top of the menu, each with Favorite and Add to order, and what adding did said aloud', /id="again-title"[^\n]*>Order again</.test(op) && /aria-label=\{`Favorite: \$\{words\}`\}/.test(op) && /aria-label=\{`Add to order: \$\{words\}`\}/.test(op) && /aria-live="polite"/.test(op));
  check('Order this again from an order’s page is added once the menu’s loaded', /write\(`cf\.ahead\.again\.\$\{tenantId\}`, JSON\.stringify\(paidLines\)\)/.test(op) && /const k = `cf\.ahead\.again\.\$\{tenantId\}`; const raw = read\(k\); if \(!raw\) return; write\(k, null\);/.test(op));

  console.log('Wording');
  const ours = [src('src/lib/ready-text.ts'), kp, op, cp].join('\n').replace(/^import .*$/gm, '');
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us|salon|stylist|booth|chair\b|studio/i.test(ours.replace(/studio-page/g, '')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
