// Checks Find my booking (/api/booking/find) and the soonest open times (/api/booking/public-data, action soonest)
// against a stand-in database, with nothing sent for real.
//   Find: a link goes only to the phone or email typed, matched however the phone was saved; an international number
//   is never taken for a US one; renters' own clients, visits that are over or not happening, and visits without a
//   page are left out; the answer is the same whether or not anyone has a booking, and comes before the lookup.
//   Soonest: the business's booking window is respected, a service nobody can do gets no time, a busy studio still
//   gets its times when many are asked for at once, and the answer is times only.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/find-booking.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
process.env.TZ = 'UTC';   // as the server runs

let db = makeDb();
const sent: any[] = []; let later: Promise<any>[] = []; const bumps: Record<string, number> = {};
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, visitorIp: () => '1.2.3.4', bump: async (id: string, max: number) => { const n = bumps[id] || 0; if (n >= max) return false; bumps[id] = n + 1; return true; } };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, input: any) => { sent.push(input); return { ok: true }; } };
  if (request === 'next/server') return {
    NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body, json: async () => body }) },
    after: (fn: any) => { later.push(Promise.resolve().then(() => fn())); },
  };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const hours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
const req = (body: any) => ({ json: async () => body, nextUrl: { origin: 'https://opal.example', searchParams: new URLSearchParams() }, headers: { get: () => null } }) as any;

async function seedFind(tenant: any = {}) {
  db = makeDb();
  const put = (p: string, v: any) => db.doc(p).set(v);
  await put(T, { name: 'Opal', timezone: 'America/New_York', ...tenant });
  await put(`${T}/clients/c1`, { name: 'dana smith', phone: '+12079460958', email: 'Dana@Example.com', searchKeys: ['dana', 'dana@example.com', '2079460958'] });
  await put(`${T}/clients/c2`, { name: 'Eve Dot', phone: '555.123.4567', searchKeys: ['5551234567'] });
  await put(`${T}/clients/c5`, { name: 'Ray Abroad', phone: '+447911123456', searchKeys: ['7911123456'] });
  await put(`${T}/clients/c6`, { name: 'Rita Renter', phone: '+16665550000', ownerRenterId: 'r1', searchKeys: ['6665550000'] });
  await put(`${T}/clients/c7`, { name: 'Ten Abroad', phone: '+441234567890', searchKeys: ['1234567890'] });
  await put(`${T}/clients/c8`, { name: 'Many Visits', phone: '+13335550000', searchKeys: ['3335550000'] });
  const visit = (id: string, clientId: string, h: number, x: any = {}) => put(`${T}/appointments/${id}`, { clientId, checkInToken: `TOK_${id}`, startTime: hours(h), endTime: hours(h + 1), status: 'confirmed', serviceName: `Svc ${id}`, ...x });
  await visit('a1', 'c1', 24, { serviceName: 'Gel manicure' });
  await visit('a2', 'c1', 48, { status: 'cancelled' });
  await visit('a3', 'c1', 72, { status: 'expired' });
  await visit('a4', 'c1', 96, { status: 'released' });
  await visit('a5', 'c1', 100, { checkInToken: undefined });
  await visit('a6', 'c1', -0.5, { status: 'checked_in', serviceName: 'Under way' });
  await visit('a7', 'c1', -3);
  await visit('b1', 'c2', 30); await visit('b5', 'c5', 30); await visit('b6', 'c6', 30); await visit('b7', 'c7', 30);
  for (let i = 0; i < 12; i++) await visit(`m${i}`, 'c8', 200 + i);
}
async function find(contact: string) {
  const { POST } = await import('../../src/app/api/booking/find/route');
  sent.length = 0; later = []; for (const k of Object.keys(bumps)) delete bumps[k];
  const res: any = await POST(req({ tenantId: 't1', contact }));
  const before = sent.length; await Promise.all(later);
  return { status: res.status, body: res.body, before, msg: sent[0] };
}

const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const week = (on: string[]) => ({ week: Object.fromEntries(names.map((d) => [d, { enabled: on.includes(d), start: '09:00', end: '19:00' }])) });
async function seedSoon(tenant: any, nServices: number, availability: any, nStaff: number, extra: (put: (p: string, v: any) => Promise<any>) => Promise<void> = async () => {}) {
  db = makeDb();
  const put = (p: string, v: any) => db.doc(p).set(v);
  await put(T, { name: 'Opal', timezone: 'America/New_York', ...tenant });
  for (let i = 0; i < nStaff; i++) await put(`${T}/staff/s${i}`, { name: `Staff ${i}`, isActive: true, availability, skillSet: [] });
  for (let i = 0; i < nServices; i++) await put(`${T}/services/v${i}`, { name: `Svc ${i}`, duration: 30 + 15 * (i % 4), price: 40, isActive: true, menuOrder: i });
  await extra(put);
}
async function soonest(serviceIds: string[], pairs: any[]) {
  const { POST } = await import('../../src/app/api/booking/public-data/route');
  const res: any = await POST(req({ tenantId: 't1', action: 'soonest', serviceIds, pairs }));
  return res.body;
}

(async () => {
  const { todayIn, addDays } = await import('../../src/lib/tenant-time');
  const today = todayIn('America/New_York'); const dayName = (ds: string) => names[new Date(ds + 'T12:00:00Z').getUTCDay()];

  console.log('1. Find my booking: who gets a link');
  await seedFind();
  for (const typed of ['2079460958', '(207) 946-0958', '+1 207 946 0958', '1-207-946-0958']) {
    const r = await find(typed);
    check(`${typed} → a text to +12079460958 only`, r.msg?.channel === 'sms' && r.msg?.to === '+12079460958', r.msg?.to);
  }
  for (const typed of ['+44 20 7946 0958', '+91 2079460958', '0012079460958', '+44 7911 123456']) {
    const r = await find(typed);
    check(`${typed} → refused as not a US number, nothing sent`, r.status === 400 && !r.msg, { status: r.status, to: r.msg?.to });
  }
  check('a saved 555.123.4567 is found from (555) 123-4567', (await find('(555) 123-4567')).msg?.to === '+15551234567');
  check('a 10-digit number saved abroad (+44…) is never texted as a US one', !(await find('1234567890')).msg);
  check('a renter’s own client gets nothing from the business’s page', !(await find('6665550000')).msg);
  const e = await find('DANA@EXAMPLE.COM');
  check('an email in any case finds the client, and goes to that address', e.msg?.channel === 'email' && e.msg?.to === 'DANA@EXAMPLE.COM' && typeof e.msg?.text === 'string' && /TOK_a1/.test(e.msg?.html || ''));
  check('…and each link in the email is a real one to tap', /<a href="https:\/\/[^"]+\/check-in\/TOK_a1"/.test(e.msg?.html || ''), (e.msg?.html || '').slice(0, 300));
  await seedFind({ messagePolicy: { find_booking: { smsBody: 'Hi {{client_first}}, here you go.' } } });
  check('wording the business saved without the links still sends them (the built-in wording goes out instead)', /TOK_a1/.test(String((await find('2079460958')).msg?.text || '')));
  await seedFind();

  console.log('2. Find my booking: what the message holds');
  const d = await find('2079460958'); const text = String(d.msg?.text || '');
  check('the visits still to come or under way, each with its own page', /TOK_a1/.test(text) && /TOK_a6/.test(text), text);
  check('…never one that is cancelled, expired, released, over, or without a page', !/TOK_a2|TOK_a3|TOK_a4|TOK_a7|undefined/.test(text), text);
  check('the greeting names them properly, however the name was saved', d.msg?.tokens?.client_first === 'Dana', d.msg?.tokens?.client_first);
  await db.doc(`${T}/clients/c1`).set({ name: 'xhttps://evil.example/pay smith' }, { merge: true });
  const odd = await find('DANA@EXAMPLE.COM');
  check('a name typed as a web address never becomes a link in the greeting (letters only are kept)', /^[A-Za-z]+$/.test(String(odd.msg?.tokens?.client_first)) && !/href="[^"]*evil/.test(String(odd.msg?.html || '')) && !/evil\.example/.test(odd.msg?.html || '') && !/evil\.example/.test(odd.msg?.text || ''), odd.msg?.tokens?.client_first);
  await seedFind();
  const many = await find('3335550000'); const mt = String(many.msg?.text || '');
  check('a text carries the next four, and says truthfully how the rest come', (mt.match(/TOK_m/g) || []).length === 4 && /And 8 more after these\. Ask again once these have passed/.test(mt), mt);
  await seedFind({ privacy: { discreet: true } });
  const disc = String((await find('2079460958')).msg?.text || '');
  check('a discreet business’s message names no treatment', /TOK_a1/.test(disc) && !/Gel manicure|Under way/.test(disc) && /Your visit/.test(disc), disc);

  console.log('3. Find my booking: the answer tells nobody anything');
  await seedFind();
  const yes = await find('2079460958'); const no = await find('9998887777');
  check('the same answer whether or not there is a booking', JSON.stringify(yes.body) === JSON.stringify(no.body) && yes.status === no.status && yes.body?.ok === true, [yes.body, no.body]);
  check('…and it comes back before anything is looked up or sent', yes.before === 0 && !!yes.msg);
  const { POST } = await import('../../src/app/api/booking/find/route');
  sent.length = 0; later = []; for (const k of Object.keys(bumps)) delete bumps[k];
  for (let i = 0; i < 5; i++) await POST(req({ tenantId: 't1', contact: '2079460958' }));
  await Promise.all(later);
  check('no more than three messages an hour to one number, however often it is asked', sent.length === 3, sent.length);

  console.log('4. Soonest times');
  const only5 = dayName(addDays(today, 5));
  await seedSoon({}, 1, week([only5]), 1);
  check('the first opening (five days out) is found', (await soonest(['v0'], [])).soonest?.v0?.date === addDays(today, 5));
  await seedSoon({ bookingRelease: { mode: 'rolling', horizonDays: 2 } }, 1, week([only5]), 1);
  check('…but never past the business’s booking window', !(await soonest(['v0'], [])).soonest?.v0);
  await seedSoon({}, 14, week([only5]), 5);
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`); const pairs = Array.from({ length: 5 }, (_, i) => ({ serviceId: 'v0', staffId: `s${i}` }));
  const busy = (await soonest(ids, pairs)).soonest || {};
  check('a busy studio (first opening five days out) still gets a time for all 17 things asked at once', Object.keys(busy).length === 17, Object.keys(busy).length);
  await seedSoon({}, 12, week(names), 5, async (put) => { for (let i = 0; i < 3000; i++) { const day = addDays(today, i % 14); const h = 9 + (i % 9); await put(`${T}/appointments/p${i}`, { staffId: `s${i % 5}`, serviceId: 'v1', status: 'confirmed', startTime: `${day}T${String(h + 5).padStart(2, '0')}:00:00.000Z`, endTime: `${day}T${String(h + 6).padStart(2, '0')}:00:00.000Z`, duration: 60 }); } });
  const t0 = Date.now(); const heavy = (await soonest(ids, pairs)).soonest || {}; const ms = Date.now() - t0;
  check(`a full day book (3000 visits) is still worked out within the time limit (${ms} ms)`, ms < 2500 && Object.keys(heavy).length > 0, { ms, answers: Object.keys(heavy).length });
  await seedSoon({}, 4, week(names), 2, async (put) => { await put(`${T}/services/v1`, { name: 'Certified only', duration: 30, price: 40, isActive: true, certifiedStaffIds: ['nobody'] }); });
  const r = await soonest(['v1', 'v0'], [{ serviceId: 'v1', staffId: 's1' }, { serviceId: 'v0', staffId: 's1' }]);
  await seedSoon({}, 1, week(names), 1, async (put) => { for (const n of [0, 1]) { const day = addDays(today, n); await put(`${T}/appointments/full${n}`, { staffId: 's0', serviceId: 'v0', status: 'confirmed', startTime: `${day}T13:00:00.000Z`, endTime: `${day}T23:59:00.000Z`, duration: 659 }); } });
  const later2 = (await soonest(['v0'], [])).soonest?.v0;
  check('a fully booked today and tomorrow move the first opening to the day after', later2?.date === addDays(today, 2), later2);
  check('a service nobody is certified for gets no time, and the rest still do', !r.soonest?.v1 && !r.soonest?.['v1|s1'] && !!r.soonest?.v0 && !!r.soonest?.['v0|s1'], Object.keys(r.soonest || {}));
  const first: any = Object.values(r.soonest || {})[0] || {};
  check('the answer is a date and a time, nothing about who', JSON.stringify(Object.keys(first).sort()) === JSON.stringify(['date', 'label', 'time']), Object.keys(first));
  check('nothing asked, nothing worked out', JSON.stringify((await soonest([], [])).soonest) === '{}');

  console.log(failures ? `\n${failures} check(s) failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
