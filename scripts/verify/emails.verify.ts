// scripts/verify/emails.verify.ts — ONE SHELL FOR EVERY MESSAGE (ClientEmails board 15G). Every email the business
// sends is drawn by one frame (lib/email-template): its color in a line across the top, its logo or first letter and
// its name, a small label in its color, the news in big type, a details panel, amount rows, one pill button, quiet
// links and a footer with its name (and its address only when it shares it). The shop's emails (lib/email-shell) use
// the same frame. Most senders only know the business's name, so the sender (lib/notify) puts the business's look on
// from its settings, and only on an email in its own name. Plus: the confirmation, reminder and receipt in that shape,
// and the card a visit link shows when it's sent (lib/visit-preview): whose link it is, nothing about the visit.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/emails.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, FV } from './fake-db';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
let db: any = makeDb();
let notifyStub: any = null;
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === './audit' || request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
  if (request === '@/lib/notify' && notifyStub) return notifyStub;
  if (request === '@/lib/route-guard') return { staffOrServer: async () => true };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin' }], initializeApp: () => ({ name: 'admin' }), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};

(async () => {
  const T = await import('../../src/lib/email-template');
  const S = await import('../../src/lib/email-shell');
  const V = await import('../../src/lib/visit-email');

  // ── the shell, before the business's look goes on
  const plain = T.brandedEmailHtml({ studioName: 'Opal Manicure Studio', eyebrow: 'Booking confirmed', title: 'See you', titleBold: 'Saturday',
    details: { big: 'Sat, Nov 8 · 3:30 PM', lines: ['Gel manicure with Mia · 1 hr'] }, amounts: [{ label: 'Deposit paid', value: '$20.00' }, { label: 'Total', value: '$65.00', strong: true }],
    cta: { label: 'See or change your booking', url: 'https://app.test/check-in/abc' }, links: [{ label: 'Add to calendar', url: 'https://app.test/ics?a=1&b=2' }],
    smallPrint: 'Free changes until Fri.', notes: { title: 'Good to know', lines: ['Cancel up to 24 hours before.'] } });
  ok(/data-cf="bar"/.test(plain) && /data-cf="btn"/.test(plain) && /data-cf="btn-fg"/.test(plain) && /data-cf="eyebrow"/.test(plain) && /data-cf="link"/.test(plain) && /<!--cf-mark-->/.test(plain) && /<!--cf-place-->/.test(plain), 'the shell marks where the business’s look goes');
  ok(/See you <b style="font-weight:700">Saturday<\/b>/.test(plain) && />Sat, Nov 8 · 3:30 PM</.test(plain) && />Deposit paid</.test(plain) && />Good to know</.test(plain), 'label, big title with its bold end, details, amounts, notes');
  ok(!/text-transform:\s*uppercase/i.test(plain) && !/letter-spacing:\.2/i.test(plain) && /border-radius:999px/.test(plain), 'no all-caps labels; one pill button');
  ok(/href="https:\/\/app\.test\/ics\?a=1&amp;b=2"/.test(plain), 'links are escaped once');
  const evil = T.brandedEmailHtml({ studioName: 'A<script>', title: '<img src=x onerror=1>', bodyLines: ['<b>hi</b>'], cta: { label: 'Go', url: 'javascript:alert(1)' } });
  ok(!/<script>|<img src=x|<b>hi<\/b>/.test(evil) && /href="#"/.test(evil), 'names, titles and lines are escaped; a script link becomes #');
  ok(!/Button not working/.test(plain), 'no long raw link under the button');

  // ── the business's look, put on by the sender
  const look = { name: 'Opal Manicure Studio', accent: '#1f7a4d', logoUrl: 'https://cdn.example.com/logo.png', place: 'Brooklyn' };
  const branded = T.applyEmailBrand(plain, look, { replies: true });
  ok((branded.match(/#1f7a4d/g) || []).length >= 4 && /data-cf="bar" style="background:#1f7a4d/.test(branded) && /data-cf="btn" align="center" style="background:#1f7a4d/.test(branded), 'its color on the line, the button, the label and the links');
  ok(/src="https:\/\/cdn\.example\.com\/logo\.png"/.test(branded) && />Opal Manicure Studio · Brooklyn</.test(branded), 'its logo by its name; its name and area at the foot');
  ok(/Reply to this email to reach Opal Manicure Studio\./.test(branded) && !/Reply to this email/.test(T.applyEmailBrand(plain, look, { replies: false })), '"reply to reach" only when replies reach the business');
  const pale = T.applyEmailBrand(plain, { ...look, accent: '#f4d35e', logoUrl: null });
  ok(/data-cf="btn-fg"[^>]*style="color:#16171a/.test(pale) && /data-cf="eyebrow" style="color:#16171a/.test(pale) && /data-cf="bar" style="background:#f4d35e/.test(pale), 'a pale color: ink words on its button, ink label and links');
  ok(/>O<\/td>/.test(pale) && !/<img/.test(pale), 'no logo: its first letter in its color');
  const renterHtml = T.brandedEmailHtml({ studioName: 'Nails by Kira', title: 'Booked', bodyLines: ['See you soon.'] });
  ok(T.applyEmailBrand(renterHtml, look, { replies: true }) === renterHtml, 'an email in another name (a renter’s) keeps its own plain look');
  ok(T.applyEmailBrand(T.brandedEmailHtml({ studioName: 'ClarityFlow', title: 'New applicant' }), look) .includes('>C</td>'), 'the app’s own notes to the owner stay plain');
  ok(T.applyEmailBrand('<p>custom</p>', look) === '<p>custom</p>', 'an email the shell didn’t draw is left alone');
  const sneaky = T.brandedEmailHtml({ studioName: 'Opal Manicure Studio', title: 'x', bodyLines: ['<td data-cf="bar" style="background:#000000">', 'data-cf="link" style="color:#000000'] });
  const sneakyOut = T.applyEmailBrand(sneaky, look);
  ok(!/<td data-cf="bar" style="background:#000000/.test(sneaky) && sneakyOut.includes('#000000') && !/data-cf="link" style="color:#1f7a4d/.test(sneakyOut.replace(/<a data-cf[^>]*>/g, '')), 'text that spells out a mark is escaped and never recolored');
  ok(T.applyEmailBrand(T.brandedEmailHtml({ studioName: 'The studio', title: 'x' }), look).includes('#1f7a4d'), 'the shell’s stand-in names count as the business’s own');
  ok(/&nbsp;&zwnj;/.test(T.brandedEmailHtml({ studioName: 'x', title: 'x', preheader: 'Hi' })), 'the inbox line doesn’t run on into the email');
  const given = T.brandedEmailHtml({ studioName: 'x', title: 'Hi', brand: look });
  ok(!/data-cf=/.test(given) && /#1f7a4d/.test(given), 'a caller with the look passes it, and the email is drawn in it');

  // ── the business's look from its settings
  const L0 = T.emailLookOf({ name: 'Opal', address: { line1: '214 Bedford Ave', city: 'Brooklyn', state: 'NY', zip: '11249' } });
  ok(L0.place === 'Brooklyn' && L0.accent === '#16171a' && L0.logoUrl === null, 'never set: the city only, never the street (a home-based business’s address stays private); ink when no color is chosen', L0);
  const L1 = T.emailLookOf({ name: 'Opal', addressPolicy: { mode: 'always' }, address: { line1: '214 Bedford Ave', city: 'Brooklyn', state: 'NY', zip: '11249' } });
  ok(L1.place === '214 Bedford Ave, Brooklyn, NY 11249', 'the full address only when the business said to share it in every message', L1);
  const L3 = T.emailLookOf({ name: 'Opal', businessName: 'Opal Goods', logoUrl: 'https://x/l.png', retailSettings: { shopBrand: { show: 'name' } } });
  ok(L3.show === 'name' && /^Opal Goods$/.test((L3.alsoNamed || [])[0] || '') && !T.applyEmailBrand(T.brandedEmailHtml({ studioName: 'opal goods', title: 'x' }), L3).includes('<img'), 'the logo as the business shows it (name only: no logo); either of its names counts as its own', L3);
  const L2 = T.emailLookOf({ name: 'Opal', address: { line1: '9 Home St', city: 'Austin' }, addressPolicy: { mode: 'on_confirm', areaLabel: 'East Austin' } });
  ok(L2.place === 'East Austin', 'a business that holds its address back: its area only, in every email footer', L2);
  ok(T.emailLookOf({ name: 'Opal', addressPolicy: { mode: 'before_event' }, address: { line1: '9 Home St' } }).place === null, 'no area set: nothing');
  ok(T.emailLookOf({ name: 'Opal', addressPolicy: { mode: 'always' }, studioAddress: '1 Main St' }).place === '1 Main St' && T.emailLookOf({ name: 'Opal', logoUrl: 'http://x/l.png' }).logoUrl === null && T.emailLookOf({ name: 'Opal', logoUrl: 'https://x/l.png" onerror="1' }).logoUrl === null, 'the one-line address works too; only a clean https logo');

  // ── the shop's emails, in the same frame
  const sb = S.brandFromTenant({ businessName: 'Opal Goods', retailSettings: { shopTheme: { brand: '#7a3b69' } } });
  const shop = S.brandedEmail(sb, `<p>Hi</p>${S.emailButton('https://x/order?a=1&amp;b=2', 'View my order', sb)}`, { title: 'Out for delivery today', tag: 'Order 1042', preheader: 'Arriving <today>' });
  ok(!/data-cf=/.test(shop) && /background:#7a3b69/.test(shop) && />Order 1042</.test(shop) && />Out for delivery today</.test(shop), 'the shop’s own color, label and title; nothing for the sender to change');
  ok(/href="https:\/\/x\/order\?a=1&amp;b=2"/.test(shop) && /Arriving &lt;today&gt;/.test(shop), 'an already-escaped link is escaped once; the preheader (it can quote a customer) is escaped');
  ok(/Plus Jakarta Sans/.test(shop) && !/text-transform:\s*uppercase/i.test(shop), 'Jakarta first, no all caps');

  // ── the sender puts the look on (lib/notify)
  process.env.RESEND_API_KEY = 'test';
  let sentBody: any = null;
  (globalThis as any).fetch = async (_u: string, init: any) => { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({ id: 'em_1' }) }; };
  db = makeDb();
  await db.doc('tenants/t1').set({ name: 'Opal Manicure Studio', email: 'hello@opal.test', bookingPageSettings: { cfPageConfig: { accentColor: '#1f7a4d' } }, address: { line1: '214 Bedford Ave', city: 'Brooklyn', state: 'NY', zip: '11249' } });
  const N = await import('../../src/lib/notify');
  const r1 = await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'dana@x.test', subject: 'A note', text: 'Your visit is tomorrow.\n\nOpen it here https://app.test/check-in/abc', recipientType: 'client' } as any);
  ok(r1.ok && sentBody && /Your visit is tomorrow\./.test(sentBody.html) && /Open it here/.test(sentBody.html) && /href="https:\/\/app\.test\/check-in\/abc"/.test(sentBody.html), 'words without html get the shell, paragraph by paragraph, with the link as the button');
  ok(/data-cf="bar" style="background:#(?!16171a)[0-9a-f]{6}/i.test(sentBody.html) && /Reply to this email to reach Opal Manicure Studio/.test(sentBody.html) && sentBody.reply_to === 'hello@opal.test', 'the business’s color and the reply line go on; replies go to the business', { reply: sentBody?.reply_to });
  await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'dana@x.test', subject: 'Reminder from Kira', text: 'Hi Dana, see you tomorrow with Kira.', fromName: 'Kira Nails', kind: 'renter_client_reminder', recipientType: 'client' } as any);
  ok(/>Kira Nails</.test(sentBody.html) && !/Reply to this email/.test(sentBody.html) && !/Bedford|Brooklyn/.test(sentBody.html) && /data-cf="bar" style="background:#16171a/.test(sentBody.html), 'a renter’s email is in the renter’s name, without the business’s look, address or reply line');
  await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'kira@x.test', subject: 'Your portal', text: 'Open your renter portal https://app.test/rent/t1', kind: 'renter_portal_invite', recipientType: 'renter' } as any);
  ok(!/data-cf="bar" style="background:#16171a/.test(sentBody.html) && /Reply to this email to reach Opal Manicure Studio/.test(sentBody.html), 'what the business itself sends its renters is in its own look');
  ok(/subject, fromName: v\.renterName,/.test(src('src/lib/renter-comms.ts')) && !/\^renter_/.test(src('src/lib/notify.ts')), 'a renter writing to their clients is named as the sender; no guessing from the kind');
  await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'owner@x.test', subject: 'New applicant', text: 'A new booth application.', kind: 'booth_application_owner', recipientType: 'other', recipientName: 'Owner' } as any);
  ok(!/Reply to this email/.test(sentBody.html), 'the owner isn’t told to reply to reach their own business');
  await db.doc('tenants/t2').set({ name: 'Calm Clinic', privacy: { discreet: true } });
  await N.sendNotification(db, { tenantId: 't2', channel: 'email', to: 'pat@x.test', subject: 'Note', text: 'A note.', recipientType: 'client' } as any);
  ok(!/fonts\.googleapis/.test(sentBody.html) && /Plus Jakarta Sans/.test(sentBody.html), 'a discreet business’s emails load no web font (opening them tells no one else)');
  ok(/fonts\.googleapis/.test(T.brandedEmailHtml({ studioName: 'x', title: 'x' })), 'other emails load Jakarta where the mail app allows');
  await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'mia@x.test', subject: 'Approve this', text: 'Please approve.', kind: 'approval_request', recipientType: 'staff' } as any);
  ok(!/Reply to this email/.test(sentBody.html) && />Opal Manicure Studio<!--/.test(sentBody.html) && !/data-cf="bar" style="background:#16171a/.test(sentBody.html), 'the team gets the business’s look, without "reply to reach" or the place line');
  await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'dana@x.test', subject: 'Shop', html: shop, recipientType: 'client' } as any);
  ok(sentBody.html === shop, 'a shop email arrives exactly as the shop drew it');
  const nsrc = src('src/lib/notify.ts');
  ok(/applyEmailBrand\(html, emailLookOf\(biz\), \{ replies: !!replyTo && !team, place: !team \}\)/.test(nsrc) && (nsrc.match(/await replyToFor\(db, tenantId, input\)/g) || []).length === 1, 'one lookup for the reply address, used for both');
  ok(/return brandedEmailHtml\(\{ studioName, title, bodyHtml \}\)/.test(nsrc), 'the older emailShell is the same shell');
  ok(/out = applyEmailBrand\(h, emailLookOf\(tenant\)\)/.test(src('src/lib/sms.ts')) && (src('src/lib/sms.ts').match(/body, studioName, tenantDoc, fallback\?\.fromName \|\| null, !!\(meta as any\)\?\.renterId\)/g) || []).length === 2 && /return discreet \? out\.replace/.test(src('src/lib/sms.ts')), 'a text that falls back to email arrives in the business’s look');

  // ── the words at the top of a visit email
  const wall = (iso: string) => new Date(iso);
  ok(V.seeYouDay(wall('2026-11-08T15:30:00Z'), wall('2026-11-08T09:00:00Z')) === 'today' && V.seeYouDay(wall('2026-11-09T15:30:00Z'), wall('2026-11-08T23:00:00Z')) === 'tomorrow', 'today, tomorrow');
  ok(V.seeYouDay(wall('2026-11-14T15:30:00Z'), wall('2026-11-08T09:00:00Z')) === 'Saturday' && V.seeYouDay(wall('2026-11-22T15:30:00Z'), wall('2026-11-08T09:00:00Z')) === 'Sun, Nov 22', 'the weekday within the week, the date after that');
  ok(V.wallWhen(wall('2026-11-08T15:30:00Z')).big === 'Sun, Nov 8 · 3:30 PM' && V.whatLine('Gel manicure', 'Mia', 60) === 'Gel manicure with Mia · 1 hr' && V.whatLine('Pedicure', null, 45) === 'Pedicure · 45 min', 'the details panel’s lines');

  // ── the confirmation, the reminder and the receipt
  const book = src('src/app/api/appointments/book/route.ts');
  ok(/eyebrow: 'Booking confirmed',\s*title: 'See you',\s*titleBold: seeYouDay\(local/.test(book) && /label: 'See or change your booking'/.test(book) && /label: 'Add to calendar'/.test(book) && /notes: policyLines\.length \? \{ title: 'Good to know', lines: policyLines \}/.test(book), 'the confirmation: "See you Saturday", details, one button, the policies under it');
  ok(/eyebrow: 'Request received',\s*title: 'Not booked',\s*titleBold: 'yet'/.test(book) && !/bigCode[^\n]*isRequest/.test(book), 'a request is never mistaken for a booking');
  ok(/if \(!tAny\.addressPolicy\?\.mode\) return pol\.areaLabel \|\| null;/.test(book) && /resolveAddressForMessage\(pol, \{ fullAddress: fullAddressOf\(tAny\), confirmed/.test(book) && /detailsFor\(false\)/.test(book), 'the address follows the setting the business chose (its area until it chooses, as in the footer)');
  ok(/codeLabel: 'Your check-in code'/.test(book) && /r\.shortCode && studioVisit/.test(book), 'the check-in code only for visits at the business');
  const rem = src('src/app/api/cron/reminders/route.ts');
  ok(/eyebrow: depositDue \? 'Deposit needed' : daysBefore === 0 \? 'Today' : daysBefore === 1 \? 'Tomorrow' : 'Coming up'/.test(rem) && /`\$\{depositDue \? 'Held for you' : 'See you'\} \$\{dayWord\} at`/.test(rem) && /label: 'Running late', url: `\$\{link\}\?do=late`/.test(rem), 'the reminder: "See you tomorrow at 3:30 PM", running late a tap away');
  const rec = src('src/app/api/receipts/route.ts');
  ok(/eyebrow: 'Receipt', title: first === 'there' \? 'Thanks for coming in' : 'Thanks for coming in,'/.test(rec) && /label: 'Total', value: \$\(r\.total\), strong: true/.test(rec) && /label: 'Book again'/.test(rec), 'the receipt: thanks, the rows with the total, book again');
  ok(!/Tax \(7%\)/.test(src('src/app/api/notifications/send-receipt/route.ts')) && /brandedEmailHtml\(\{ studioName: r\.studioName/.test(src('src/app/api/notifications/send-receipt/route.ts')), 'the cash receipt uses the same shell, and never claims a tax rate');
  ok(/confirmed \? \(where \|\| addressFor\(true\)\) : addressFor\(false\)/.test(book), 'a request or a held time never sends the video link, call-in number or home address before it’s confirmed');
  ok(/label: 'To pay now', value: money\$\(depCents \+ \(r as any\)\.balanceCollectCents\), strong: true/.test(book), 'a hold that also collects an old balance shows the deposit, the balance and the total');
  ok((rem.match(/\|\| awaitingApproval\(a\)( \|\| a\.isRenterBooking)?\) continue;/g) || []).length === 2 && /a\?\.voiceApproval === 'pending'/.test(rem) && /i\.a\.status === 'deposit_pending'/.test(rem) && /eyebrow: depositDue \? 'Deposit needed'/.test(rem) && /'Held for you' : 'See you'/.test(rem) && /links: link && !group \?/.test(rem), 'a pending request isn’t reminded; a held time says what’s needed; a group gets no one-person links');
  ok((rem.match(/fromName: rp\.name/g) || []).length === 5 && /fromName: brand\.name/.test(src('src/lib/renter-aftercare.ts')), 'renters’ reminders, thanks and reconnects go out in the renter’s name');
  ok(/\(r\.detail\?\.lines \|\| \[\]\)\.some\(\(l: any\) => l\.kind === 'service'\)/.test(rec) && /!isPlaceholderName\(full\)/.test(rec), '"Book again" only after a visit; a walk-in’s placeholder name isn’t used');
  ok(/preheader: line \}/.test(src('src/app/api/retail/collected-notify/route.ts')), 'the collected email’s inbox line is escaped once');
  ok(!/has been cancelled|'Appointment cancelled'/.test(src('src/lib/cancel-notice.ts') + src('src/lib/cancellation-events.ts')) && /kind: 'appointment_cancelled'/.test(src('src/lib/cancel-notice.ts')), 'both cancellation messages say "canceled"; the stored kinds are unchanged');
  // A cash receipt for a walk-in: no "Guest", the payment line as it was, the time in the business's own zone.
  db = makeDb(); await db.doc('tenants/t1').set({ name: 'Opal Manicure Studio', timezone: 'America/Chicago' });
  const mails: any[] = []; notifyStub = { sendNotification: async (_db: any, x: any) => { mails.push(x); return { ok: true, status: 'sent' }; } };
  const SR = await import('../../src/app/api/notifications/send-receipt/route'); sentBody = null;
  const rr: any = await SR.POST({ json: async () => ({ tenantId: 't1', type: 'email', contact: 'walkin@x.test', receipt: { clientName: 'Walk-in Guest', studioName: 'Opal Manicure Studio', studioPhone: '', lineItems: [{ label: 'Polish change', amount: 20 }], subtotal: 20, tax: 1.65, tip: 0, discount: 0, recovery: 0, total: 21.65, tendered: 40, change: 18.35, paymentMethod: 'Cash', date: '2/11/2026, 15:30:12' } }) } as any);
  const rh = String(mails[0]?.html || sentBody?.html || '');   // through the real sender when the stand-in isn't picked up
  ok(rr.body?.ok && /Thanks for coming in</.test(rh) && !/Guest|Walk/.test(rh) && />Cash tendered</.test(rh) && />\$40\.00</.test(rh) && />Change returned</.test(rh) && !/2\/11\/2026|15:30:12/.test(rh) && /[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} [AP]M/.test(rh), 'a walk-in’s cash receipt: no "Guest", "Cash tendered", the time in the business’s zone', { ok: rr.body, h1: rh.match(/<h1[^>]*>.*?<\/h1>/)?.[0], det: rh.match(/font-size:21px[^>]*>[^<]*/)?.[0], n: mails.length });
  notifyStub = null;
  ok(/\|\| awaitingApproval\(a\) \|\| a\.isRenterBooking\) continue;/.test(rem) && /if \(a\.ownReminder === true && !a\.isRenterBooking\) continue;/.test(rem), 'a renter’s client is reminded by the renter, never in the studio’s voice, whatever timing they chose');
  ok(/recipientName: 'Owner' \}/.test(src('src/app/api/school/route.ts')) && /fromName: String\(o\.facts\.business\)/.test(src('src/lib/opportunities-server.ts')), 'the school’s owner alerts and a renter’s follow-up texts that fall back to email are addressed right');
  ok(!/has been cancelled/.test(src('src/app/api/portal/renter/route.ts')) && /'renter_client_cancelled'/.test(src('src/app/api/portal/renter/route.ts')), 'a renter’s cancellation messages say "canceled"; the stored kind is unchanged');
  ok(V.isPlaceholderName('Walk-in customer') && V.isPlaceholderName(' guest ') && V.isPlaceholderName('A client') && !V.isPlaceholderName('Dana Reyes') && !V.isPlaceholderName('Guestina'), 'one test for a desk’s placeholder names');
  ok(/'Thank you!'/.test(src('src/app/api/notifications/send-receipt/route.ts')) && /color: fg,/.test(src('src/app/check-in/[token]/opengraph-image.tsx')), 'the receipt text never thanks "Guest"; the card’s words read on any color');
  const share = src('src/app/api/notifications/share-image/route.ts');
  ok(/\$\{esc\(firstName\)\}/.test(share) && /\$\{esc\(safeNote\)\}/.test(share) && /\$\{esc\(img\)\}/.test(share), 'the photo email escapes the name, the note and the address');

  // ── the card a visit link shows when it's sent
  db = makeDb();
  await db.doc('appointmentCheckIns/tok_abcdefgh').set({ tenantId: 't1', id: 'a1', serviceName: 'Brazilian wax', staffName: 'Mia', startTime: '2026-11-08T15:30:00Z' });
  await db.doc('tenants/t1').set({ name: 'Opal Manicure Studio', bookingPageSettings: { cfPageConfig: { accentColor: '#1f7a4d' } }, stripeSecret: 'sk_never' });
  const P = await import('../../src/lib/visit-preview');
  const p = await P.visitPreviewOf('tok_abcdefgh');
  ok(p && Object.keys(p).sort().join() === 'accent,name,origin' && p.name === 'Opal Manicure Studio' && /^#[0-9a-f]{6}$/i.test(p.accent), 'the card knows only the business’s name, color and link address', p);
  ok(P.previewTitle(p) === 'Your visit · Opal Manicure Studio' && P.previewTitle(null) === 'Your visit' && (await P.visitPreviewOf('bad token!')) === null && (await P.visitPreviewOf('tok_missing0')) === null, '"Your visit · Opal Manicure Studio"; a link that isn’t one gets the plain title');
  const og = src('src/app/check-in/[token]/opengraph-image.tsx'); const lay = src('src/app/check-in/[token]/layout.tsx');
  ok(!/serviceName|staffName|startTime|clientName/.test(og + lay + src('src/lib/visit-preview.ts').replace(/never the service[^\n]*/i, '')), 'nothing about the visit in the card or its picture');
  ok(/openGraph: \{ title, description: PREVIEW_DESCRIPTION/.test(lay) && /robots: \{ index: false, follow: false \}/.test(lay) && /manifest: `\/check-in\/\$\{id\}\/app\.webmanifest`/.test(lay), 'the layout gives the card its title and keeps the link out of search');
  ok(/plus-jakarta-sans-latin-300-normal\.woff/.test(og) && fs.existsSync('src/assets/fonts/plus-jakarta-sans-latin-300-normal.woff') && fs.existsSync('src/assets/fonts/plus-jakarta-sans-latin-600-normal.woff') && fs.existsSync('src/assets/fonts/OFL.txt'), 'the picture is set in Jakarta (the font and its license ship with it)');
  ok(!/export (const|function) (?!runtime|alt|size|contentType|default)/.test(og.replace(/export default/g, '')), 'the picture file exports only what Next allows');
  ok(/'Cache-Control': p \? 'public, max-age=3600, s-maxage=86400' : 'no-store'/.test(og) && /join\(process\.cwd\(\), 'src\/assets\/fonts\/plus-jakarta-sans-latin-600-normal\.woff'\)/.test(og), 'the picture is kept an hour (never when the business wasn’t found), and its fonts are named in full so the build keeps them');
  ok(/metadataBase: base/.test(lay) && /p\?\.origin \|\| linkOrigin\(null/.test(lay), 'the card’s picture is fetched from the business’s own link address');
  const vp = src('src/lib/visit-preview.ts');
  ok(/Promise\.race\(\[lookUp\(id\)/.test(vp) && /WAIT_MS = 1500/.test(vp) && /MISS_MS = 60_000/.test(vp) && /clearTimeout\(timer\)/.test(vp), 'the page never waits long on the card; a link that isn’t one is remembered for a minute');

  // ── the house rules
  const all = ['src/lib/email-template.ts', 'src/lib/email-shell.ts', 'src/lib/visit-email.ts', 'src/lib/visit-preview.ts', 'src/app/check-in/[token]/opengraph-image.tsx', 'src/app/check-in/[token]/layout.tsx', 'src/app/api/email-preview/route.ts', 'src/app/api/receipts/route.ts', 'src/app/api/notifications/send-receipt/route.ts'].map(src).join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\bcancell?ed\b/.test(all.replace(/'cancelled'/g, '')) && !/colour/i.test(all) && !/\{\/\*/.test(all), 'house rules: no tool names, no "call us", US spelling, no JSX comments');
  ok(/type: 'confirm'|confirm: \(s\)/.test(src('src/app/api/email-preview/route.ts')) && /applyEmailBrand\(brandedEmailHtml\(SAMPLES\[type\]\(studio\)\)/.test(src('src/app/api/email-preview/route.ts')), 'the preview page shows the real shell in a business’s look');

  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
