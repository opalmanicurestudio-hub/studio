// Checks launch L4: the dead ends a first business would hit.
// - "Try the demo" has a page; text-message consent links land on a real text-message terms page.
// - Waitlist "Notify" really sends, and only says "Client told" when it did; the Money page charges a card through the
//   route that exists; a cash-desk receipt only says "sent" when it went.
// - A missing page and a crash on the booking page or the shop each get a plain screen with a way back.
// - Nothing an owner, their team or their clients can see names a developer key, the hosting service or a vendor.
// - Every kind of business starts with plain words, not salon words, from sign-up and in the planner.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-dead-ends.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

// The waitlist route runs against an in-memory database, signed in as the owner, with the sender stood in for.
const db = makeDb();
let delivered = true; const sends: any[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: 'owner1' }) }) };
  if (request === '@/lib/notify') return { sendNotification: async (_d: any, m: any) => { sends.push(m); return delivered ? { ok: true, status: 'sent' } : { ok: false, status: 'skipped_no_provider' }; } };
  return load.call(this, request, ...rest);
};
const post = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: new URL('https://app.example/api/waitlist') }) as any;

const read = (p: string) => readFileSync(p, 'utf8');
// A message is a quoted string an owner, a team member or a client can read: the text inside '…', "…" or `…`.
const strings = (src: string) => (src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []);

(async () => {
console.log('Pages that were missing');
check('the demo page exists and opens on the visitor’s kind of business', existsSync('src/app/demo/page.tsx') && /<DemoApp initialNiche=\{niche\} \/>/.test(read('src/app/demo/page.tsx')));
check('the text-message terms page exists, with STOP, HELP, rates and frequency', (() => {
  const p = read('src/app/legal/sms/page.tsx');
  return /Reply STOP/.test(p) && /Reply HELP/.test(p) && /Message and data rates may apply/.test(p) && /Message frequency varies/.test(p) && /never a condition of booking/.test(p);
})());
for (const f of ['src/components/shared/SmsConsent.tsx', 'src/components/rent/studio.tsx']) {
  const s = read(f);
  check(`consent links in ${f.split('/').pop()} go to /legal/sms and /legal/privacy`, /href="\/legal\/sms"/.test(s) && /href="\/legal\/privacy"/.test(s) && !/href="\/(terms|privacy)"/.test(s) && !/#sms/.test(s));
}

console.log('Buttons that said they worked');
const wl = read('src/hooks/useWaitlist.ts');
check('waitlist Notify sends through the waitlist route', /fetch\('\/api\/waitlist'/.test(wl) && /action: 'notify', entryId: entry\.id, message/.test(wl) && /staffAuthHeader\(\)/.test(wl));
check('…sends the hold and the offered spot with it, and says "Client told" only after the server says it went', /holdMinutes: HOLD_MINUTES, offeredSlot: \{ date: slotDate, time: slotTime \}/.test(wl) && wl.indexOf('if (!res?.ok)') > -1 && wl.indexOf('if (!res?.ok)') < wl.indexOf("title: 'Client told'") && !/status: 'notified'/.test(wl));
check('…and a second tap while it’s sending does nothing', /notifying\.current\.has\(entry\.id\)/.test(wl) && /finally \{ notifying\.current\.delete\(entry\.id\); \}/.test(wl));
const { POST } = await import('../../src/app/api/waitlist/route');
await db.doc('tenants/t1').set({ name: 'Opal', userId: 'owner1' });
await db.doc('tenants/t1/waitlist/w1').set({ status: 'waiting', clientName: 'Ana Ruiz', phone: '+14045550101' });
delivered = false;
let out: any = await (await POST(post({ tenantId: 't1', action: 'notify', entryId: 'w1', message: 'A spot opened.', holdMinutes: 15, offeredSlot: { date: '2026-11-12', time: '14:00' } }))).json();
let w: any = (await db.doc('tenants/t1/waitlist/w1').get()).data();
check('nothing could be sent: the desk is told, and the entry is neither marked told nor held', out.ok === false && /not set up yet/.test(out.error) && w.status === 'waiting' && !w.holdExpiresAt && !w.offeredSlot, { out, w });
delivered = true;
out = await (await POST(post({ tenantId: 't1', action: 'notify', entryId: 'w1', message: 'A spot opened.', holdMinutes: 15, offeredSlot: { date: '2026-11-12', time: '14:00' } }))).json();
w = (await db.doc('tenants/t1/waitlist/w1').get()).data();
const left = (Date.parse(w.holdExpiresAt) - Date.now()) / 60000;
check('sent: marked told, held for 15 minutes, with the spot offered', out.ok === true && w.status === 'notified' && left > 14 && left <= 15 && w.offeredSlot?.date === '2026-11-12' && w.offeredSlot?.time === '14:00', { out, w });
check('the business’s own words went out', sends.at(-1)?.text === 'A spot opened.' && sends.at(-1)?.channel === 'sms');
await db.doc('tenants/t1/waitlist/w1').set({ status: 'booked' }, { merge: true });
out = await (await POST(post({ tenantId: 't1', action: 'notify', entryId: 'w1', message: 'Again' }))).json();
check('someone already booked from the list isn’t texted', out.ok === false && sends.at(-1)?.text !== 'Again');
const bd = read('src/components/ledger/BadDebtAgingCard.tsx');
check('Money "Charge card" uses the card-charge route, once per fee, staff only', /fetch\('\/api\/stripe\/charge-card'/.test(bd) && /idempotencyKey: `owed-fee-/.test(bd) && /staffAuthHeader\(\)/.test(bd) && /data\?\.ok|data\.ok/.test(bd));
check('…and the route it calls exists', existsSync('src/app/api/stripe/charge-card/route.ts'));
check('Charge is offered when the client has a saved card where the route looks for it', /hasCard: !!\(client\.cardOnFile\?\.customerId && client\.cardOnFile\?\.paymentMethodId\)/.test(bd) && /cardOnFile/.test(read('src/app/api/stripe/charge-card/route.ts')));
check('two fees of the same amount get different keys, and a declined card can be tried again', /fee\.createdAt \|\| fee\.appointmentDate/.test(bd) && /\$\{declines \? `-r\$\{declines\}` : ''\}/.test(bd) && /!data\.unknown/.test(bd) && /const declines = declinesOf\(feeKey\);/.test(bd) && /localStorage\.setItem\(`cf-fee-declines-/.test(bd));
check('a second tap while charging does nothing', /if \(!item \|\| inFlight\.current\) return;/.test(bd));
const cc = read('src/components/pos/CashCheckout.tsx');
check('a desk receipt says "sent" only when the server says it went', /if \(!res\.ok \|\| !data\?\.ok\) throw/.test(cc) && /title: 'Receipt not sent'/.test(cc));

console.log('Missing pages and crashes');
const nf = read('src/app/not-found.tsx');
check('a missing page has a plain screen with a way home', /This page isn’t here/.test(nf) && /href="\/"/.test(nf));
for (const [f, back] of [['src/app/(booking)/book/[tenantId]/error.tsx', '/book/'], ['src/app/shop/[tenantId]/error.tsx', '/shop/']] as const) {
  const s = read(f);
  check(`${f.includes('book') ? 'booking' : 'shop'} crash: reported, Reload, and a way back to its start`, /reportCrash\(/.test(s) && /isStaleCopy\(error\) && reloadOnce\(\)/.test(s) && /window\.location\.reload\(\)/.test(s) && s.includes('`' + back + '${'));
}

console.log('No developer words in what people read');
const CHECKED = [
  'src/lib/ai.ts', 'src/app/api/academy/admin/route.ts', 'src/app/api/plaid/route.ts', 'src/app/api/booths/reserve/route.ts',
  'src/app/api/campaigns/send/route.ts', 'src/app/(app)/academy/page.tsx', 'src/lib/billing.ts', 'src/app/api/completion/upload-file/route.ts',
  'src/components/rent/studio.tsx', 'src/app/api/client-screen/route.ts', 'src/components/settings/ClientScreenCard.tsx',
  'src/app/api/voice/provision-number/route.ts', 'src/app/api/voice/outbound-call/route.ts', 'src/lib/sms.ts',
  'src/app/api/notifications/send-receipt/route.ts', 'src/lib/maintenance-server.ts',
];
const vendor = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
const dev = /Vercel|redeploy|Firebase Console|[A-Z]{3,}_(API_KEY|SECRET|TOKEN|KEY|ID)\b|env var|environment variable|Twilio|Resend|Mux\b|MUX_|RETELL|CRON_SECRET|NEXT_PUBLIC_/;
for (const f of CHECKED) {
  const src = read(f);
  // What a person can read: strings outside console.* lines and outside comments.
  const shown = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/console\.(error|warn|log)\([^;]*\);?/g, '')).join('\n');
  // Only sentences count (a model id, a URL, a header or a setting's name has no spaces), and log tags in [brackets] don't.
  const bad = strings(shown).filter((s) => /\s/.test(s) && (dev.test(s) || vendor.test(s)) && !/^['"`]\[/.test(s) && !/process\.env\./.test(s));
  check(`${f.replace(/^src\//, '')}: no key, host or vendor names in its messages`, bad.length === 0, bad.slice(0, 3));
}

console.log('Plain words for every kind of business');
const su = read('src/app/api/signup/route.ts');
check('sign-up seeds plain names: Personal budget, Business costs, Regular hours, Services', /name: 'Personal budget'/.test(su) && /name: 'Business costs'/.test(su) && /name: 'Regular hours'/.test(su) && /servicesSectionTitle: 'Services'/.test(su));
check('no salon or studio words, and no all-caps labels, in what sign-up seeds', !/Studio|Lifestyle|Checkout Hub|The Menu/.test(su.slice(su.indexOf('batch.set(db.doc(`tenants/${tenantId}`)'), su.indexOf('// 4. The invite'))) && !/label: '[A-Z ]{6,}'/.test(su));
const st = read('src/app/(app)/settings/page.tsx');
check('Settings’ defaults match sign-up', /label: 'Long wait'/.test(st) && !/label: '[A-Z ]{6,}'/.test(st) && !/Checkout Hub/.test(st));
check('the planner’s whole-business lane says Business', /\{ id: 'business', name: 'Business', isBusiness: true \}/.test(read('src/app/(app)/planner/page.tsx')));
const bs = read('src/components/booking/BookingServices.tsx');
check('the booking services heading falls back to Services, with no spa line', /servicesSectionTitle \|\| 'Services'/.test(bs) && !/Curated treatments/.test(bs));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
})();
