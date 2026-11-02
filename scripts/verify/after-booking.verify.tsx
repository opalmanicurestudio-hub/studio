// scripts/verify/after-booking.verify.tsx — THE PAGES AFTER BOOKING, IN ONE LOOK (ClientManage board 15F): find my
// booking, the waitlist (join, a time opened up, still hoping), gift cards (the card, the wallet, find my card), and the
// older manage and cancel links, which now open the visit link. Each page is the visit link's shell with the business's
// own name, color, mood and logo, sent by its route in one small shape (lib/public-look) — never the settings themselves.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/after-booking.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { makeDb, FV } from './fake-db';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
let db: any = makeDb();
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body, headers: init?.headers }) }, after: () => {} };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
  if (request === '@/lib/notify') return { sendNotification: async () => ({ ok: true }), ensureApptToken: async () => null };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const TENANT = { name: 'Opal Manicure Studio', timezone: 'America/Chicago', logoUrl: 'https://cdn.example.com/logo.png', phone: '(512) 555-0142',
  bookingPageSettings: { cfPageConfig: { accentColor: '#8b5e57' }, studio: { mood: 'night', color: '#8b5e57' } }, stripeSecret: 'sk_live_never', billing: { plan: 'pro' } };
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams() } } as any);
const getReq = (q: string) => ({ nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams(q) }, headers: { get: () => null } } as any);

(async () => {
  // ── The look, in one small shape ───────────────────────────────────────
  const { publicLook, cleanLook } = await import('../../src/lib/public-look');
  const look = publicLook(TENANT);
  ok(Object.keys(look).sort().join(',') === 'accent,logoUrl,mood,name,zone' && look.name === 'Opal Manicure Studio' && /^#[0-9a-f]{6}$/i.test(look.accent) && look.zone === 'America/Chicago' && look.logoUrl === 'https://cdn.example.com/logo.png', 'a page gets the name, color, mood, logo and time zone, nothing else', look);
  ok(!JSON.stringify(look).includes('sk_live') && !JSON.stringify(look).includes('pro'), 'never the business’s settings');
  ok(publicLook({ name: 'X', logoUrl: 'javascript:alert(1)' }).logoUrl === null && publicLook({ name: 'X', logoUrl: '//evil.example/x.png' }).logoUrl === null, 'a logo that isn’t a safe address is left out');
  ok(cleanLook({ accent: 'red', name: 'x' }) === null && cleanLook({ accent: '#123456', mood: 'neon', name: 'x' })?.mood === 'soft' && cleanLook({ accent: '#123456', logoUrl: 'data:x', name: 'x' })?.logoUrl === null, 'a remembered or received look is checked before it’s used');

  // ── Find my booking ────────────────────────────────────────────────────
  db = makeDb(); await db.doc(T).set(TENANT);
  const { GET: findGet } = await import('../../src/app/api/booking/find/route');
  const fg: any = await findGet(getReq('tenantId=t1'));
  ok(fg.body.ok && fg.body.accent === look.accent && fg.body.mood === look.mood && fg.body.zone === 'America/Chicago' && !('bookingPageSettings' in fg.body), 'find my booking sends the business’s look', fg.body);
  const find = src('src/app/(booking)/book/[tenantId]/find/page.tsx');
  ok(find.includes('<VisitShell brand={brand} title={<>Find <b>your booking</b></>}') && find.includes('useLook(tenantId)') && find.includes("'Send me my link'"), 'find my booking is the visit link’s shell, in the business’s look (board: Find)');
  ok(find.includes('<VisitSaid text={err} />') && find.includes('htmlFor="find-contact"') && find.includes("aria-describedby={err ? 'find-err' : 'find-help'}"), 'a mistake is said in amber under the field, which keeps its label');
  ok((find.match(/>Book a visit<\/VisitButton>/g) || []).length === 2, 'there’s always a way to book, before and after sending');
  const sc = src('src/app/api/appointments/self-cancel/route.ts');
  ok(sc.includes("'renter_client_cancelled'") && src('src/app/api/portal/renter/route.ts').includes("'renter_client_cancelled'"), 'stored message types are never renamed (the renter’s message log reads them)');
  ok(!/'[^'\n]*\bcancelled\b[^'\n]*'/.test(sc.replace(/status === 'cancelled'|status: 'cancelled'|'cancelled', `|'renter_client_cancelled'/g, '')) && !/Cancelling|cancelling|contact us/.test(sc), 'what the cancel screen says is in US spelling, and never “contact us”');

  // ── The older manage and cancel links open the visit link ──────────────
  await db.doc(`${T}/appointments/a1`).set({ id: 'a1', tenantId: 't1', clientId: 'c1', clientName: 'Dana Reyes', status: 'confirmed', startTime: new Date(Date.now() + 3 * 864e5).toISOString(), checkInToken: 'tokVisit12345678901', manageToken: 'mgmtKey0123456789abc' });
  const { POST: appt } = await import('../../src/app/api/appt/route');
  const viaManage: any = await appt(req({ action: 'visit_link', tenantId: 't1', apptId: 'a1', k: 'mgmtKey0123456789abc' }));
  ok(viaManage.body.ok && viaManage.body.token === 'tokVisit12345678901' && viaManage.body.look?.accent === look.accent, 'an old “manage my appointment” link is answered with the visit link (its key checked first)', viaManage.body);
  const viaVisit: any = await appt(req({ action: 'visit_link', tenantId: 't1', apptId: 'a1', k: 'tokVisit12345678901' }));
  ok(viaVisit.body.token === 'tokVisit12345678901', 'the visit link’s own key works too');
  const wrong: any = await appt(req({ action: 'visit_link', tenantId: 't1', apptId: 'a1', k: 'someoneElsesKey00000' }));
  ok(wrong.status === 401 && !wrong.body.token, 'a wrong key learns nothing');
  await db.doc(`${T}/appointments/a1`).set({ linkRevokedAt: new Date().toISOString() }, { merge: true });
  const off: any = await appt(req({ action: 'visit_link', tenantId: 't1', apptId: 'a1', k: 'mgmtKey0123456789abc' }));
  ok(off.status === 410 && off.body.code === 'revoked' && !off.body.token, 'a link turned off (“Not you?”) never hands out the visit link');
  const fwd = src('src/components/visit/OldLinkForward.tsx');
  ok(src('src/app/(booking)/appt/[tenantId]/[apptId]/page.tsx').includes('<OldLinkForward kind="manage"') && src('src/app/cancel/[tenantId]/[appointmentId]/page.tsx').includes('<OldLinkForward kind="cancel"'), 'the old manage and cancel pages are retired: both open the visit link');
  ok(fwd.includes("window.location.replace(`/check-in/${encodeURIComponent(d.token)}${kind === 'cancel' ? '?do=cancel' : ''}`)") && !fwd.includes("encodeURIComponent(k)}?do=cancel") && fwd.includes('const TOKEN = /^[A-Za-z0-9_-]{16,120}$/;'), 'both old links open the visit link only after the server checks the key (a cancel link opens it on Cancel), so a cut-off link never lands on a blank page');
  ok(fwd.includes('<VisitButton href={`/book/${encodeURIComponent(tenantId)}/find`}>Find my booking</VisitButton>') && fwd.includes('Booked with one of the independent providers here? Reply to the message they sent you.'), 'a link that can’t be opened is never a dead end, and says what to do for a renter’s booking too');
  ok(fwd.includes("if (!d || status === 0 || status >= 500) { setSaid({ title: 'We couldn’t open your visit just now', kind: 'offline' }); return; }") && fwd.includes('>Try again</VisitButton>'), 'no connection is never mistaken for a dead link: Try again');
  ok(fwd.includes("title=\"Taking you to your visit…\"") && fwd.includes('if (!ready) return'), 'while it checks, it says where it’s taking them, in the business’s look');
  ok(fwd.includes("d.code === 'revoked' ? { title: 'This link has been turned off', kind: 'off' }") && fwd.includes('subtitle="Reply to your confirmation message, and we’ll send you a new link."'), 'a link turned off never sends them to a resend of the same link');

  // ── The waitlist ───────────────────────────────────────────────────────
  const ws = src('src/lib/waitlist-server.ts');
  ok((ws.match(/look: publicLook\(tenant\)/g) || []).length === 3 && ws.includes("heldFrom: offer.mode === 'one' ? offer.sentAt || null : null"), 'every waitlist answer a client sees carries the look, and an offer says when its hold began');
  ok(src('src/app/api/waitlist/route.ts').includes('look: publicLook(tenant),'), 'joining the waitlist gets the look too');
  const offer = src('src/app/w/[tenantId]/[token]/page.tsx');
  ok(offer.includes("<>A time <b>opened up</b></>") && offer.includes("'Take it'") && offer.includes("'No thanks, keep me on the list'") && offer.includes('If the time runs out, it goes to the next person waiting.'), 'a time opened up: what it is, Take it, and keeping their place (board: Waitlist)');
  ok(offer.includes('function HoldRing') && offer.includes('role="timer"') && offer.includes("strokeDashoffset={C * (1 - frac)}") && offer.includes('onEnd={holdEnded}'), 'a ring counts the hold down, and the page looks again the moment it ends');
  const join = src('src/app/w/[tenantId]/page.tsx'); const keep = src('src/app/w/[tenantId]/keep/[token]/page.tsx');
  ok([offer, join, keep].every((s) => s.includes('useLook(tenantId') && s.includes('brandFromLook(look, tenantId)') && s.includes('if (!ready) return <div className="min-h-dvh" aria-busy="true" />;')), 'every waitlist page is in the business’s own look, never a flash of another');
  ok(join.includes('choose “No thanks” and you will keep your place.') && !join.includes('Not this time'), 'the join page names the button the offer really has');
  { const lf = (s: string) => (/^[A-Z][a-z]+(?: [a-z]+)*$/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
    ok(offer.includes("for your ${lowerFirst(String(v.service || 'visit'))}.") && offer.includes('/^[A-Z][a-z]+(?: [a-z]+)*$/.test(s)') && keep.includes('`a ${lowerFirst(String(v.service))}`')
      && lf('Gel manicure') === 'gel manicure' && lf('BIAB Fill') === 'BIAB Fill' && lf('Gel Manicure') === 'Gel Manicure' && lf('Gel-X Full Set') === 'Gel-X Full Set', 'a service name is lowered mid-sentence only when it’s written in plain sentence case', { a: lf('Gel Manicure') }); }
  ok([offer, join].every((s) => !/#b42318|#e7e2dc|#f1eee9|#ececee/.test(s)) && join.includes('<VisitSaid text={err} />') && (join.match(/<VisitCheckRow/g) || []).length === 2 && join.includes('className="v-pill pub-press"'), 'mistakes in amber, controls in the mood’s colors, 44px choices and tick rows');

  // ── Gift cards ─────────────────────────────────────────────────────────
  ok(src('src/app/api/gift-cards/route.ts').includes('mood: (await import(\'@/lib/public-look\')).publicLook(t).mood') && (src('src/lib/gift-shop.ts').match(/mood: publicLook\(t\)\.mood/g) || []).length === 2, 'gift card answers carry the mood');
  const gift = src('src/app/gift/[tenantId]/[id]/page.tsx'); const wallet = src('src/app/gift/[tenantId]/wallet/page.tsx'); const gfind = src('src/app/gift/[tenantId]/find/page.tsx');
  ok(gift.includes('<VisitShell brand={brand} chip="Gift card">') && gift.indexOf('>Book with it</VisitButton>') < gift.indexOf('>Copy the code</VisitButton>') && gift.includes('navigator.clipboard.writeText(String(c.code))'), 'the gift card: the card, the note, Book with it first, then Copy the code (board: Gift)');
  ok(gift.includes('<VisitLabel>From {from}</VisitLabel>') && gift.includes("'This card was canceled.'") && !gift.includes('cancelled'), 'the sender’s note under their name; US spelling');
  ok([gift, wallet, gfind].every((s) => s.includes('<VisitShell') && s.includes('useLook(tenantId)')) && !/#f7f7f8|#b42318/.test(gift + wallet + gfind) && [gift, wallet].every((s) => s.includes('if (!ready && !d) return <div className="min-h-dvh" aria-busy="true" />;')), 'the card, the wallet and find my gift card share the visit link’s shell, with no flash of another look');
  ok(gift.includes("setCopied({ text: 'Press and hold the code to copy it.', ok: false })") && gift.includes('logo: brand.logo, accent: d.brand.accent') && gift.includes('select-all font-mono') && gift.includes('min-h-11 items-center justify-center px-3 text-[14px] underline'), 'copying that can’t happen says how to copy instead; “Have another card?” is a full-size tap');
  ok(src('src/components/gift/gift-brand.ts').includes("/^(https:\\/\\/|\\/(?![/\\\\]))/.test(d.brand.logo)"), 'a gift card’s logo address is checked like every other');
  const spend = src('src/components/gift/SpendSuggestions.tsx');
  ok(!/WHAT YOUR|COVERS</.test(spend) && spend.includes('What your {money(bal)} covers') && !/#ececee|#6d7075/.test(spend.replace(/^\/\/.*$/gm, '')), 'what the card covers: no all-caps label, in the mood’s colors');
  ok(fs.existsSync('src/components/gift/gift-brand.ts') && !/export function giftBrand/.test(gift), 'page files export only the page');

  // ── House rules ────────────────────────────────────────────────────────
  const files = ['src/lib/public-look.ts', 'src/components/visit/OldLinkForward.tsx', 'src/app/(booking)/book/[tenantId]/find/page.tsx', 'src/app/w/[tenantId]/[token]/page.tsx', 'src/app/w/[tenantId]/page.tsx',
    'src/app/w/[tenantId]/keep/[token]/page.tsx', 'src/app/gift/[tenantId]/[id]/page.tsx', 'src/app/gift/[tenantId]/wallet/page.tsx', 'src/app/gift/[tenantId]/find/page.tsx', 'src/components/gift/SpendSuggestions.tsx', 'src/components/gift/gift-brand.ts'];
  const tool = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(files.every((p) => { const s = src(p); return !tool.test(s) && !/[\u{1F300}-\u{1FAFF}\u{2728}]/u.test(s) && !/call us/i.test(s) && !/\{\/\*/.test(s) && !/\buppercase\b/.test(s); }), 'no tool names, emojis, “call us”, JSX comments or all-caps');

  if (bad) { console.error(`\n${bad} failed`); process.exit(1); }
  console.log('\nafter booking: all good');
})();
