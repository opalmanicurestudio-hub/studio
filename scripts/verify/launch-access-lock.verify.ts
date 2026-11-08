// Checks pausing and closing a business actually works (launch L2):
// - One rule says when a business is locked: paused by HQ, its subscription ended, or a late payment past its grace
//   period. A business on early access, not set up yet, or paying late but still inside its grace period is open.
// - Every route that starts a booking or takes money for a business refuses a locked one, with a plain line for the
//   client that never says why; finding your own gift cards still works.
// - The team's app closes for a locked business (the suspended page, nothing of the business behind it), and every app
//   screen asks a signed-out person to sign in. The old browser-cookie lock is gone.
// - The public booking page says online booking isn't open; the shop says so along its top.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-access-lock.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const A = await import('../../src/lib/tenant-access');
  const now = Date.parse('2026-11-08T15:00:00Z');
  console.log('When a business is locked');
  check('early access (active): open', !A.accessLockOf({ subscriptionStatus: 'active' }, now).locked);
  check('just signed up, not set up yet (inactive): open', !A.accessLockOf({ subscriptionStatus: 'inactive' }, now).locked);
  check('no business at all: open (the route’s own checks answer)', !A.accessLockOf(null, now).locked);
  check('paused by HQ: locked, as paused', JSON.stringify(A.accessLockOf({ subscriptionStatus: 'active', accessLocked: true, accessLockedAt: '2026-11-01T00:00:00Z' }, now)) === '{"locked":true,"reason":"paused"}');
  check('subscription ended (either spelling): locked, as ended', A.accessLockOf({ subscriptionStatus: 'cancelled' }, now).reason === 'cancelled' && A.accessLockOf({ subscriptionStatus: 'canceled' }, now).reason === 'cancelled');
  check('paying late, inside the grace period: open', !A.accessLockOf({ subscriptionStatus: 'past_due', gracePeriodEndsAt: '2026-11-12T00:00:00Z' }, now).locked);
  check('paying late, grace period over: locked, as payment', A.accessLockOf({ subscriptionStatus: 'past_due', gracePeriodEndsAt: '2026-11-07T00:00:00Z' }, now).reason === 'grace_expired');
  check('locked by the old grace-period lock: locked, as payment', A.accessLockOf({ subscriptionStatus: 'past_due', accessLocked: true }, now).reason === 'grace_expired');
  check('an HQ pause outlasts a paid-up subscription', A.accessLockOf({ subscriptionStatus: 'active', accessLocked: true, accessLockedAt: 'x' }, now).reason === 'paused');
  check('the older "suspended" flag: locked', A.accessLockOf({ suspended: true }, now).locked);
  check('what clients are told never says why', !/paus|cancel|subscri|payment|billing/i.test(A.CLOSED_FOR_CLIENTS) && /isn’t taking online bookings or orders right now/.test(A.CLOSED_FOR_CLIENTS));

  console.log('Routes that book or take money');
  const S = await import('../../src/lib/tenant-open-server');
  const db = makeDb();
  await db.doc('tenants/open').set({ name: 'Open Co', subscriptionStatus: 'active' });
  await db.doc('tenants/paused').set({ name: 'Paused Co', subscriptionStatus: 'active', accessLocked: true, accessLockedAt: '2026-11-01T00:00:00Z' });
  const r1: any = await S.closedReplyFor(db, 'paused');
  check('a locked business gets a refusal with the plain line for clients', r1 && r1.status === 403 && r1.body.closed === true && r1.body.error === A.CLOSED_FOR_CLIENTS, r1);
  check('an open business goes ahead', (await S.closedReplyFor(db, 'open')) === null);
  check('an unreadable or missing business is left to the route', (await S.closedReplyFor(db, 'nobody')) === null && (await S.closedReplyFor({ doc: () => ({ get: async () => { throw new Error('down'); } }) }, 'x')) === null);

  const routes: [string, RegExp][] = [
    ['src/app/api/appointments/book/route.ts', /closedReply\(tenant\)/],
    ['src/app/api/appointments/book-group/route.ts', /closedReply\(tenant\)/],
    ['src/app/api/stripe/deposit/route.ts', /closedReply\(tenantSnap\.data\(\)\)/],
    ['src/app/api/stripe/booking-card/route.ts', /closedReply\(tenant\)/],
    ['src/app/api/stripe/checkout/route.ts', /closedReply\(tenantSnap\.data\(\)\)/],
    ['src/app/api/stripe/completion/route.ts', /closedReply\(tenantSnap\.data\(\)\)/],
    ['src/app/api/retail/checkout/route.ts', /closedReplyFor\(db, tenantId\)/],
    ['src/app/api/academy/public/route.ts', /closedReply\(t\)/],
    ['src/app/api/stripe/renter-membership/route.ts', /closedReplyFor\(db, tenantId\)/],
    ['src/app/api/stripe/renter-package/route.ts', /closedReplyFor\(db, tenantId\)/],
    ['src/app/api/walkins/route.ts', /if \(action === 'join'\) \{ const closed = await closedReplyFor\(getAdminDb\(\), tenantId\)/],
    ['src/app/api/booths/reserve/route.ts', /closedReplyFor\(db, tenantId\)[\s\S]*closedReply\(tSnap\.data\(\)\)|closedReply\(tSnap\.data\(\)\)[\s\S]*closedReplyFor\(db, tenantId\)/],
    ['src/app/api/booths/kiosk/route.ts', /closedReply\(kioskTenant\)/],
    ['src/app/api/gift-cards/shop/route.ts', /closedReplyFor\(db, String\(tenantId\)\)/],
  ];
  for (const [p, re] of routes) { const src = read(p); check(`${p.replace('src/app/api/', '').replace('/route.ts', '')} asks first`, re.test(src) && /from '@\/lib\/tenant-open-server'/.test(src)); }
  for (const [p] of routes) { const src = read(p); const imp = (src.match(/import \{ ([^}]+) \} from '@\/lib\/tenant-open-server'/) || [])[1] || ''; const unused = imp.split(',').map((x) => x.trim()).filter(Boolean).filter((n) => (src.split(n).length - 1) < 2);
    check(`${p.replace('src/app/api/', '').replace('/route.ts', '')} imports only what it uses`, !unused.length, unused); }
  const acad = read('src/app/api/academy/public/route.ts');
  check('academy: only enrolling and paying stop; students keep their courses', /\['checkout', 'apply', 'app-pay', 'tuition-pay'\]\.includes\(String\(b\.action \|\| ''\)\)\) \{ const closed = closedReply\(t\)/.test(acad));
  const voice = read('src/lib/booking/create-booking.ts');
  check('the phone receptionist books nothing for a locked business, and says so kindly', /if \(accessLockOf\(tenant\)\.locked\) return \{ ok: false, error: 'closed', spoken: 'I’m sorry, bookings can’t be made right now\.' \}/.test(voice));
  const gift = read('src/app/api/gift-cards/shop/route.ts');
  check('gift cards: selling, deposits and chip-ins refused; finding your own cards still works', /\['start', 'deposit', 'bulk-request', 'bulk-pay', 'group-start', 'chip'\]\.includes\(action\)/.test(gift) && !/'find'\]\.includes/.test(gift));

  console.log('The team’s app');
  const gate = read('src/components/auth/AccessGate.tsx');
  check('a locked business opens the suspended page, showing nothing behind it', /accessLockOf\(t\)/.test(gate) && /router\.replace\(`\/suspended\?reason=\$\{lock\.reason\}`\)/.test(gate) && /if \(waiting \|\| blocked\) \{\s*return <div/.test(gate));
  check('an owner with another business that’s open is switched to it, not shut out', /ctx\.setSelectedTenant\(openOne\)/.test(gate) && /!accessLockOf\(x\)\.locked/.test(gate));
  check('nothing of the business shows until it’s known to be open', /const waiting = !!ctx\?\.isLoading \|\| \(!t && /.test(gate) && /if \(waiting \|\| blocked\)/.test(gate));
  const portal = read('src/app/staff-portal/[tenantId]/layout.tsx');
  check('the team’s portal app is closed too', /if \(!accessLockOf\(t\)\.locked\) return children;/.test(portal) && /The team app is closed for now\./.test(portal) && /export const dynamic = 'force-dynamic';/.test(portal));
  const layout = read('src/app/(app)/layout.tsx');
  check('the gate wraps the app and the printed sheets', (layout.match(/<AccessGate>/g) || []).length === 2);
  const guard = read('src/components/auth/AuthGuard.tsx');
  check('every app screen needs a sign-in (not a short list)', /const isAppRoute = \(pathname: string\) => !pathname\.startsWith\('\/book'\);/.test(guard) && !/protectedRoutes/.test(guard));
  const mw = read('src/middleware.ts');
  check('the old browser-cookie lock is gone; the live-address forward stays', !/clarityflow_tenant_id/.test(mw) && !/FIREBASE_ADMIN_REST_TOKEN/.test(mw) && /VERCEL_PROJECT_PRODUCTION_URL/.test(mw));
  check('the lock route only the old middleware called is gone', !existsSync('src/app/api/internal/lock-tenant/route.ts'));
  const sus = read('src/app/suspended/page.tsx');
  check('suspended page: billing problems go to Your ClarityFlow, which exists', /href: '\/subscriptions'/.test(sus) && !/settings\/billing/.test(sus));
  check('suspended page: plain words, sign out always there, no shouting', /This account is paused/.test(sus) && /Sign out/.test(sus) && !/uppercase/i.test(sus) && !/Contact Support/i.test(sus));
  check('suspended page: the support email only when one is set', /NEXT_PUBLIC_SUPPORT_EMAIL/.test(sus) && /\{SUPPORT && /.test(sus));

  console.log('Public pages');
  const book = read('src/app/(booking)/book/[tenantId]/page.tsx');
  check('the booking page says online booking isn’t open', /if \(accessLockOf\(tenant\)\.locked\)/.test(book) && /Online booking isn’t open right now\./.test(book));
  check('the booking page still starts with use client', book.startsWith("'use client';"));
  const shop = read('src/app/shop/[tenantId]/layout.tsx');
  check('the shop says so along its top, and order pages still open', /announcement: accessLockOf\(data\)\.locked \? CLOSED_FOR_CLIENTS/.test(shop) && /\{children\}/.test(shop));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
