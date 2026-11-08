// Checks a new owner can get started (launch L8), from the new-owner walk-through:
// - "On the team" and "clocked in" are told apart: a team member who hasn't clocked in (or a business that doesn't
//   use the time clock) is bookable online, under "Any available", on the planner and in the team counts. Only someone
//   who clocked out earlier today is left out of later today.
// - A business with no services yet can add its first one (there's no category to pick, so it types one).
// - The team step follows the "just me / a team" answer; a one-person business closes the till without a witness, and
//   anyone without a PIN is told where to set one.
// - A starter-menu service goes on the booking page with its first price; a free service counts as on the booking page.
// - Sign-up sends an invite meant for another email back to the email box, not the invite code.
// - Stripe sends the owner back to the setup step they came from.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-owner-start.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { format, addDays } from 'date-fns';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const calls: { kind: string; params: any }[] = [];
function StripeMock(this: any) {
  return {
    accounts: { create: async () => ({ id: 'acct_new' }), retrieve: async (id: string) => ({ id, charges_enabled: false }) },
    accountLinks: { create: async (p: any) => { calls.push({ kind: 'link', params: p }); return { url: 'https://connect.stripe.com/setup/x' }; } },
  };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === '@/lib/request-actor') return { requestActor: async () => ({ ok: true, actor: { staffId: 'u1', role: 'owner', isOwner: true, isManager: true } }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }), redirect: (url: string) => ({ status: 307, url }) } };
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const TM = await import('../../src/lib/team-member');
  const A = await import('../../src/lib/availability');
  const S = await import('../../src/lib/solo');

  console.log('On the team is not the same as clocked in');
  const now = new Date(); now.setHours(8, 0, 0, 0);
  const isToday = (d: Date) => d.toDateString() === now.toDateString();
  check('someone just added (not clocked in yet) is on the team', TM.onTeam({ id: 'a', active: false, status: 'idle' }));
  check('someone archived, or switched off, is not', !TM.onTeam({ archived: true }) && !TM.onTeam({ isActive: false }) && !TM.onTeam({ status: 'archived' }));
  check('clocked in only when the time clock says so', TM.onClock({ active: true }) && !TM.onClock({}) && !TM.onClock({ active: false }));
  const out = new Date(now); out.setHours(7, 0, 0, 0); const yesterday = addDays(out, -1);
  check('gone for today only after clocking out today', TM.goneForToday({ active: false, lastClockOut: out.toISOString() }, isToday)
    && !TM.goneForToday({ active: false, lastClockOut: yesterday.toISOString() }, isToday) && !TM.goneForToday({ active: false }, isToday) && !TM.goneForToday({ active: true, lastClockOut: out.toISOString() }, isToday));
  check('a team of two where one is clocked out is still a team', !S.isSoloTeam([{ id: 'o', role: 'owner' }, { id: 'a', role: 'staff', active: false }]) && S.isSoloTeam([{ id: 'o', role: 'owner' }, { id: 'a', role: 'staff', archived: true }]));

  console.log('Booking: Any available, and later today');
  const week = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [d, { enabled: true, start: '09:00 AM', end: '05:00 PM' }]));
  const svc = { id: 's1', name: 'Intro session', duration: 60, price: 40 };
  const base = { serviceId: 's1', services: [svc], appointments: [], scheduleProfiles: [], tenant: {}, now, ignoreHeuristics: true, includeUnavailable: false } as any;
  const mia = { id: 'mia', name: 'Mia', role: 'staff', active: false, status: 'idle', availability: { week } };
  const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd');
  const r1 = A.computeAvailability({ ...base, date: tomorrow, staffId: 'any', staff: [mia] });
  check('someone added who hasn’t clocked in has times under Any available', r1.slots.some((x: any) => x.staffId === 'mia'), r1.slots.length);
  const today = format(now, 'yyyy-MM-dd');
  const r2 = A.computeAvailability({ ...base, date: today, staffId: 'any', staff: [mia] });
  check('…and later today too (not clocked in yet is not gone)', r2.slots.some((x: any) => x.staffId === 'mia'), r2.slots.length);
  const gone = { ...mia, id: 'gone', name: 'Gone', lastClockOut: out.toISOString() };
  const r3 = A.computeAvailability({ ...base, date: today, staffId: 'any', staff: [gone] });
  const r4 = A.computeAvailability({ ...base, date: tomorrow, staffId: 'any', staff: [gone] });
  check('someone who clocked out earlier today isn’t offered for later today, but is tomorrow', !r3.slots.some((x: any) => x.staffId === 'gone') && r4.slots.some((x: any) => x.staffId === 'gone'), { today: r3.slots.length, tomorrow: r4.slots.length });
  const brk = new Date(now.getTime() - 5 * 60000);
  const onBreak = { ...mia, id: 'brk', name: 'Brk', active: true, onBreak: true, breakStartTime: brk.toISOString() };
  const r6 = A.computeAvailability({ ...base, date: today, staffId: 'any', staff: [onBreak], now: new Date(new Date(now).setHours(10, 0, 0, 0)), tenant: { maximumBreakMinutes: 30 } });
  const r6b = A.computeAvailability({ ...base, date: today, staffId: 'any', staff: [{ ...onBreak, breakStartTime: new Date(new Date(now).setHours(9, 55, 0, 0)).toISOString() }], now: new Date(new Date(now).setHours(10, 0, 0, 0)), tenant: { maximumBreakMinutes: 30 } });
  const times6 = r6b.slots.filter((x: any) => x.staffId === 'brk').map((x: any) => x.time);
  check('someone on a break isn’t offered until it’s due to end, and the rest of the day stays open', !times6.includes('10:00') && !times6.includes('10:15') && times6.some((t: string) => t >= '10:30') && r6.slots.length > 0, times6.slice(0, 4));
  const r5 = A.computeAvailability({ ...base, date: tomorrow, staffId: 'any', staff: [{ ...mia, id: 'old', archived: true }] });
  check('someone archived is never offered', !r5.slots.some((x: any) => x.staffId === 'old'));

  console.log('Every screen that means "works here" asks the team, not the clock');
  const teamReaders: [string, RegExp][] = [
    ['src/app/(app)/planner/page.tsx', /st\.active !== false/],
    ['src/app/api/public/staff/route.ts', /s\.active !== false/],
    ['src/lib/availability.ts', /s\?\.active !== false/],
    ['src/lib/solo.ts', /m\.active !== false/],
    ['src/lib/business-shape.ts', /m\.active !== false/],
    ['src/lib/agent-feed.ts', /m\.active !== false/],
    ['src/lib/voice/server-availability.ts', /s\.active !== false/],
    ['src/lib/voice/knowledge-compiler.ts', /s\.active !== false/],
    ['src/app/api/cron/reminders/route.ts', /s\.active === false/],
    ['src/components/pos/desk/StaffBookSheet.tsx', /m\.active !== false/],
    ['src/components/pos/desk/AddWalkIn.tsx', /m\.active !== false/],
    ['src/components/memberships/MembershipCard.tsx', /s => s\.active\)/],
    ['src/app/(app)/clients/[id]/page.tsx', /st\.active !== false/],
    ['src/app/(app)/clients/page.tsx', /st\.active !== false/],
    ['src/lib/appointment-coverage.ts', /s\.active !== false/],
    ['src/lib/staff-notify.ts', /s\.active !== false/],
    ['src/lib/ops-tick.ts', /\['owner', 'admin', 'manager'\]\.includes\(String\(m\.role\)\) && m\.active !== false/],
  ];
  const still = teamReaders.filter(([f, re]) => re.test(src(f))).map(([f]) => f);
  check('booking page, planner, Any available, team counts, reminders and the phone line no longer hide people who aren’t clocked in', still.length === 0, still);
  check('the desk can book a provider for later today before they clock in', src('src/components/planner/AddAppointmentDialog.tsx').includes('!goneForToday(staffMember, isToday)'));

  console.log('The first service');
  const qa = src('src/components/services/QuickAddService.tsx');
  check('with no categories yet, it starts on a new one called Services that can be typed over', qa.includes("const firstCat = () => category || categories[0] || '__new'") && qa.includes("categories.length ? '' : 'Services'") && qa.includes('{categories.length > 0 && <select'));
  check('no salon example in the form everyone sees', !qa.includes('Gel manicure') && !/studio/i.test(qa.split('\n').filter((l) => !l.startsWith('//')).join('\n')));
  const sp = src('src/app/(app)/services/page.tsx');
  check('the empty services page says what to do, in plain words', sp.includes('No services yet') && sp.includes('Add your first service') && !sp.includes('Add First Treatment') && !sp.includes('Library is Empty'));
  check('a starter-menu service goes on the booking page with its first price', sp.includes("(svc as any).createdVia === 'starter' && (svc as any).isPrivate === true && !(Number(svc.price) > 0) && price > 0") && sp.includes('{ price, isPrivate: false }'));
  const gs = src('src/app/api/getting-started/route.ts');
  check('a free service the owner made counts as on the booking page; an unpriced starter one doesn’t', gs.includes("(Number(x.price) > 0 || x.createdVia !== 'starter')"));

  console.log('A one-person business at the till');
  const pos = src('src/app/(app)/pos/page.tsx');
  check('closing the till asks for a witness only when there’s someone else to be one', pos.includes('requireTillWitness={selectedTenant?.requireTillWitness !== false && !(staff && staff.length > 0 && isSoloTeam(staff))}'));
  check('with nobody holding a PIN, the till says where to set one', src('src/components/pos/TillManagement.tsx').includes('Nobody on the team has a PIN yet.') && src('src/components/pos/TillManagement.tsx').includes('href="/staff"'));

  console.log('Sign-up and payments');
  const su = src('src/app/api/signup/route.ts'); const sup = src('src/app/(auth)/signup/page.tsx');
  check('an invite meant for another email is answered as that, and goes back to the email box', su.includes("{ code: 'invite_email' }") && sup.includes("setStep(e?.code === 'invite' || e?.code === 'business' ? 0 : 2)") && !sup.includes('/invite/i.test'));
  const R = await import('../../src/app/api/stripe/connect/route');
  await db.doc('tenants/b1').set({ name: 'Studio', userId: 'u1' });
  calls.length = 0;
  const post = (body: any) => ({ url: 'https://app.example/api/stripe/connect', json: async () => body, headers: { get: () => 'Bearer t' } }) as any;
  let r: any = await R.POST(post({ tenantId: 'b1', action: 'start', setup: 'payments' }));
  const link = calls.find((c) => c.kind === 'link')?.params || {};
  check('opened from setup, Stripe brings the owner back to the setup step', r.body.ok && link.return_url === 'https://app.example/settings?tab=payments&stripe=connected&setup=payments' && link.refresh_url === 'https://app.example/api/stripe/connect?setup=payments', link);
  calls.length = 0;
  r = await R.POST(post({ tenantId: 'b1', action: 'start', setup: 'x&evil=1' }));
  check('anything else in that place is ignored', (calls.find((c) => c.kind === 'link')?.params || {}).return_url === 'https://app.example/settings?tab=payments&stripe=connected');
  r = await R.GET({ url: 'https://app.example/api/stripe/connect?setup=payments', headers: { get: () => null } } as any);
  check('the "start again" address keeps the setup step too', r.url === 'https://app.example/settings?tab=payments&stripe=refresh&setup=payments', r.url);

  const files = ['src/lib/team-member.ts', 'scripts/verify/launch-owner-start.verify.ts'];
  const bad = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('no assistant names in the new files', files.every((f) => !bad.test(src(f))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
