// Checks cook ahead (design board "Cook ahead"; lib/cook-ahead, lib/cook-ahead-server, the kitchen screen's Holding row).
// - A usual day like today: the same weekday, the last four weeks, in 15-minute steps, planned for the busier ones; with
//   fewer than two days selling it, nothing is said.
// - The next hour only: a stretch as long as its holding time, less what's held and still good then, in whole batches.
// - By when: the first time what's held won't cover it, less the time to make; already late, now.
// - Past midnight, the small hours of the same business day (and its weekday).
// - Read from the kitchen tickets (cancelled, voided, unpaid and a part made at another station left out), by the local
//   clock; a past day kept, small; a day too busy to read whole left out; one read per day at a time; a read that fails
//   waits; a slow first read never holds the screen up.
// - On the kitchen screen before the batches, with Start a batch, and in Spanish.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/cook-ahead.verify.ts
import * as fs from 'fs';
import { makeDb, check, failures } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');
const T = 'tenants/t1';
const blank = () => Array.from({ length: 96 }, () => 0);
/** A past day where an item sold `n` in each of these 15-minute steps (by the hour and minute they start). */
const day = (id: string, at: [string, number][]) => { const s = blank(); for (const [hm, n] of at) { const [h, m] = hm.split(':').map(Number); s[(h * 60 + m) / 15] += n; } return { [id]: s }; };

(async () => {
  const C = await import('@/lib/cook-ahead');
  const fries = { id: 'fries', name: 'Fries', holdMinutes: 20, batchSize: 6, makeSeconds: 180 };
  const now = Date.parse('2026-11-20T16:32:00Z');   // (11:32 on the local clock in the pure checks: nowMin is given)
  const m = (hm: string) => { const [h, mi] = hm.split(':').map(Number); return h * 60 + mi; };

  console.log('A usual day like today, planned for the busier ones');
  const busy = day('fries', [['11:45', 8], ['12:00', 7]]), quiet = day('fries', [['11:45', 2], ['12:00', 2]]), mid = day('fries', [['11:45', 6], ['12:00', 5]]);
  const u = C.usualOf([busy, quiet, mid, {}], 'fries')!;
  check('the busier half of the days that sold it: 11:45 is (8 + 6) / 2 = 7', !!u && u.days === 3 && u.slots[m('11:45') / 15] === 7 && u.slots[m('12:00') / 15] === 6, u && [u.slots[47], u.slots[48]]);
  check('one day selling it isn’t enough to go on', C.usualOf([busy, {}, {}, {}], 'fries') === null && C.cookAhead([fries], [busy], [], m('11:32'), now).length === 0);
  check('a step partly in the stretch counts in part', Math.abs(C.soldBetween(u.slots, m('11:52') + 0.5, m('12:00')) - 7 * (7.5 / 15)) < 1e-9);

  console.log('What to cook, and by when');
  let plan = C.cookAhead([fries], [busy, quiet, mid, {}], [], m('11:32'), now);
  check('nothing held: by 11:45 less its 3 minutes to make, for the 20 minutes from 11:45 (7 + 6 × 1/3 = 9): 2 batches of 6',
    plan.length === 1 && plan[0].byMin === m('11:42') && plan[0].fromMin === m('11:45') && plan[0].toMin === m('12:05') && plan[0].need === 9 && plan[0].batches === 2 && plan[0].held === 0, plan);
  const bin = (q: number, mins: number) => ({ itemId: 'fries', quantity: q, status: 'held', expiresAt: new Date(now + mins * 60000).toISOString() });
  plan = C.cookAhead([fries], [busy, quiet, mid, {}], [bin(6, 25)], m('11:32'), now);
  check('6 held and still good then: 1 batch more', plan.length === 1 && plan[0].batches === 1 && plan[0].held === 6, plan);
  plan = C.cookAhead([fries], [busy, quiet, mid, {}], [bin(6, 5)], m('11:32'), now);
  check('held, but past its time by then: it doesn’t count', plan[0]?.batches === 2 && plan[0].held === 6, plan);
  plan = C.cookAhead([fries], [busy, quiet, mid, {}], [bin(12, 40)], m('11:32'), now);
  check('12 held until 12:12, but 13 sell by 12:15: one more batch by 11:57, for the stretch from 12:00', plan.length === 1 && plan[0].batches === 1 && plan[0].fromMin === m('12:00') && plan[0].byMin === m('11:57'), plan);
  plan = C.cookAhead([fries], [busy, quiet, mid, {}], [bin(14, 60)], m('11:32'), now);
  check('enough held for the next hour: nothing said', plan.length === 0, plan);
  plan = C.cookAhead([fries], [busy, quiet, mid, {}], [], m('11:44'), now);
  check('already late: now', plan[0]?.byMin === null && plan[0].fromMin === m('11:45'), plan);
  plan = C.cookAhead([fries], [busy, quiet, mid, {}], [], m('10:00'), now);
  check('only the next hour: 11:45 is too far off at 10:00', plan.length === 0, plan);
  plan = C.cookAhead([{ ...fries, id: 'other' }, fries], [busy, quiet, mid, {}], [{ ...bin(6, 40), status: 'tossed' }], m('11:50'), now);
  check('a batch thrown out isn’t held; an item with no usual day isn’t said; the most urgent first', plan.length === 1 && plan[0].itemId === 'fries' && plan[0].held === 0 && plan[0].byMin === null, plan);
  const late = day('fries', [['00:00', 8], ['00:15', 6]]);
  check('past midnight it carries on into the small hours of the same day', Math.abs(C.soldBetween(late.fries, m('23:50'), 24 * 60 + 20) - (8 + 6 * 5 / 15)) < 1e-9);
  plan = C.cookAhead([fries], [late, late], [], m('23:40'), now);
  check('…so at 23:40 it says to have 2 batches by 23:57, for 00:00 to 00:20', plan.length === 1 && plan[0].byMin === 24 * 60 - 3 && plan[0].fromMin === 24 * 60 && plan[0].toMin === 24 * 60 + 20 && plan[0].need === 10 && plan[0].batches === 2, plan);

  console.log('Read from the kitchen tickets');
  const db: any = makeDb();
  const tenant: any = { name: 'North Pier', timezone: 'America/New_York' };
  await db.doc(T).set(tenant);
  const S = await import('@/lib/cook-ahead-server');
  const { addDays, tonight, nightBounds } = await import('@/lib/night-close-server');
  const nowAt = Date.parse('2026-11-20T16:32:00Z');   // Friday 11:32 in New York
  const today = tonight(tenant, new Date(nowAt));
  let k = 0;
  const sold = async (P: string, d: string, hm: string, q: number, o: any = {}) => {
    const [h, mi] = hm.split(':').map(Number);
    const at = new Date(Date.parse(nightBounds(tenant, d).start) + 0).toISOString();
    // (The local time on that day: from the day's start, which is the business's cutover hour; before it, the small hours after.)
    const startLocalH = Number(new Date(at).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })) % 24;
    const t = new Date(Date.parse(at) + (((h < startLocalH ? h + 24 : h) - startLocalH) * 60 + mi) * 60000).toISOString();
    await db.doc(`${P}/kdsTickets/k${++k}`).set({ itemId: 'fries', menuItemId: 'fries', quantity: q, status: 'delivered', createdAt: t, ...o });
  };
  for (const w of [1, 2, 3]) { const d = addDays(today, -7 * w); await sold(T, d, '11:46', w === 3 ? 2 : 8); await sold(T, d, '12:01', w === 3 ? 2 : 6); }
  await sold(T, addDays(today, -7), '11:50', 50, { status: 'cancelled' });
  await sold(T, addDays(today, -7), '11:50', 50, { partOf: 'k1' });   // a part made at another station
  await sold(T, addDays(today, -1), '11:50', 50);   // yesterday: not the same weekday
  const got = await S.cookAheadFor(db, T, tenant, [fries], [], nowAt);
  check('the same weekday, the last four weeks, by the local clock (a cancelled ticket, a part made at another station and another weekday left out)', got.length === 1 && got[0].need === 10 && got[0].batches === 2 && got[0].weekday === 'Friday', got);
  check('…the times as moments: by 11:42, for 11:45 to 12:05', got[0]?.by === new Date(nowAt + 10 * 60000).toISOString() && got[0].from === new Date(nowAt + 13 * 60000).toISOString() && got[0].to === new Date(nowAt + 33 * 60000).toISOString(), got[0]);
  const kept: any = (await db.doc(`${T}/private/cookAhead_${addDays(today, -7)}`).get()).data();
  check('a past day’s counts are kept, small (only the steps that sold)', !!kept && JSON.stringify(kept.slots) === JSON.stringify({ fries: { 47: 8, 48: 6 } }), kept);
  const T3 = 'tenants/t3'; await db.doc(T3).set(tenant);
  for (const w of [1, 2]) await db.doc(`${T3}/private/cookAhead_${addDays(today, -7 * w)}`).set({ day: addDays(today, -7 * w), slots: { fries: { 47: 8, 48: 6 } } });
  const fromKept = await S.cookAheadFor(db, T3, tenant, [fries], [], nowAt);
  check('…and read back from there, with no tickets to read', fromKept.length === 1 && fromKept[0].need === 10, fromKept);

  console.log('A late night is still the day that began');
  const T2 = 'tenants/t2'; await db.doc(T2).set(tenant);
  for (const w of [1, 2]) { const d = addDays(today, -7 * w); await sold(T2, d, '00:46', 8); await sold(T2, d, '01:01', 6); }
  const lateAt = Date.parse('2026-11-21T05:30:00Z');   // Saturday 00:30 in New York: still Friday’s business day
  const night = await S.cookAheadFor(db, T2, tenant, [fries], [], lateAt);
  check('Saturday 00:30 reads past Fridays’ small hours and says Friday: 2 batches by 00:42', night.length === 1 && night[0].weekday === 'Friday' && night[0].need === 10 && night[0].by === new Date(lateAt + 12 * 60000).toISOString(), night);

  console.log('Never holding the kitchen screen up');
  /** A stand-in database: counts the reads, can be slow or down, and says how many tickets each read finds. */
  const stand = (o: { size: (from: string, to: string) => number; delay?: number; fail?: boolean }) => {
    const calls = { q: 0, set: 0 };
    const db: any = {
      collection: () => { const w: any = {}; const c: any = {
        where: (_f: string, op: string, v: string) => { if (op === '>=') w.from = v; else w.to = v; return c; }, limit: () => c,
        get: async () => { calls.q++; if (o.delay) await new Promise((r) => setTimeout(r, o.delay)); if (o.fail) throw new Error('down');
          const n = o.size(w.from, w.to); return { size: n, docs: Array.from({ length: n }, () => ({ data: () => ({ itemId: 'fries', quantity: 1, status: 'delivered', createdAt: w.from }) })) }; } }; return c; },
      doc: () => ({ get: async () => ({ data: () => undefined }), set: async () => { calls.set++; } }),
    };
    return { db, calls };
  };
  const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3600000;
  let sd = stand({ size: (f, t) => hours(f, t) > 2 ? 4000 : 10 });
  await S.cookAheadFor(sd.db, 'tenants/m1', tenant, [fries], [], nowAt);
  check('a day with more tickets than one read holds is read an hour at a time, and kept', sd.calls.q === 4 * 25 && sd.calls.set === 4, sd.calls);
  sd = stand({ size: () => 4000 });
  const busyDay = await S.cookAheadFor(sd.db, 'tenants/m2', tenant, [fries], [], nowAt);
  check('…even an hour more than a read holds: left out, never counted in part or kept', busyDay.length === 0 && sd.calls.set === 0 && sd.calls.q === 4 * 2, sd.calls);
  await S.cookAheadFor(sd.db, 'tenants/m2', tenant, [fries], [], nowAt);
  check('…and not read again on the next poll', sd.calls.q === 4 * 2, sd.calls);
  sd = stand({ size: () => 3, delay: 60 });
  await Promise.all([S.cookAheadFor(sd.db, 'tenants/m3', tenant, [fries], [], nowAt), S.cookAheadFor(sd.db, 'tenants/m3', tenant, [fries], [], nowAt)]);
  check('two screens asking at once: one read per day', sd.calls.q === 4, sd.calls);
  sd = stand({ size: () => 3, fail: true });
  const down = await S.cookAheadFor(sd.db, 'tenants/m4', tenant, [fries], [], nowAt);
  await S.cookAheadFor(sd.db, 'tenants/m4', tenant, [fries], [], nowAt);
  check('a read that fails: nothing said, and it waits before trying again', down.length === 0 && sd.calls.q === 4, sd.calls);
  sd = stand({ size: () => 3, delay: 2500 });
  let kept2: Promise<unknown> | null = null;
  let t0 = Date.now(); const slow = await S.cookAheadSoon(sd.db, 'tenants/m5', tenant, [fries], [], nowAt, (p) => { kept2 = p; }); const took = Date.now() - t0;
  check('a first read that takes long: the screen gets its tickets without it, in a moment, and the host is asked to let it finish', slow.length === 0 && took < 2200 && !!kept2, took);
  let askedFast = false; await S.cookAheadSoon(db, T, tenant, [fries], [], nowAt, () => { askedFast = true; });
  check('…a quick one isn’t handed on', !askedFast);
  await new Promise((r) => setTimeout(r, 1300));
  t0 = Date.now(); await S.cookAheadSoon(sd.db, 'tenants/m5', tenant, [fries], [], nowAt);
  check('…and it’s there on the next poll, with no more reads', sd.calls.q === 4 && Date.now() - t0 < 200, sd.calls);

  console.log('On the kitchen screen');
  const api = src('src/app/api/kitchen/route.ts'), kds = src('src/app/kds/[tenantId]/page.tsx');
  check('sent with the tickets, for what can be held, with its time to make; a read that fails just leaves it off',
    /makeSeconds: makeSecondsOf\(r\.x\)/.test(api) && /const cook = holdable\.length \? await \(await import\('@\/lib\/cook-ahead-server'\)\)\.cookAheadSoon\(db, T, tenant, holdable, holds as any, Date\.now\(\), \(p\) => after\(p\)\)\.catch\(\(\) => \[\]\) : \[\];/.test(api) && /import \{ NextRequest, NextResponse, after \} from 'next\/server';/.test(api) && /holdable, tossedToday, cook, printers/.test(api));
  check('before the batches, with what, by when, why (a usual day, and what’s held), and Start a batch (the same tap as the +)',
    /\{cook\.map\(\(c\) => \{/.test(kds) && kds.indexOf('{cook.map((c) => {') < kds.indexOf('{holds.map((b) => {') && /say\('A usual \{day\} sells about \{n\} from \{from\} to \{to\}\.'/.test(kds) && /onClick=\{\(\) => onHold\(h\)\} aria-label=\{say\('Start a batch of \{n\} \{name\}', \{ n: h\.batchSize, name: h\.name \}\)\}[^\n]*\{say\('Start a batch of \{n\}'/.test(kds)
    && /cook=\{data\.cook \|\| \[\]\} tz=\{data\.business\.timeZone\}/.test(kds) && /cook: Array\.isArray\(d\.cook\) \? d\.cook : \[\]/.test(kds));
  const L = await import('@/lib/screen-lang');
  const words = ['Cook ahead', 'Cook ahead: {name}', '1 batch ({q}) by {time}', '{n} batches ({q}) by {time}', '1 batch ({q}) now', '{n} batches ({q}) now', 'A usual {day} sells about {n} from {from} to {to}.', '{n} held now.', 'None held now.', 'Start a batch of {n}', 'Start a batch of {n} {name}', 'Friday', 'Sunday'];
  check('every word of it in Spanish', words.every((w) => L.hasSpanish(w)) && L.tr('es', 'A usual {day} sells about {n} from {from} to {to}.', { day: L.tr('es', 'Friday'), n: 9, from: '11:45 AM', to: '12:05 PM' }) === 'Un viernes normal se venden unos 9 de 11:45 AM a 12:05 PM.'
    && L.tr('es', '{n} batches ({q}) by {time}', { n: 2, q: 12, time: '11:45 AM' }) === '2 tandas (12) para 11:45 AM', words.filter((w) => !L.hasSpanish(w)));
  const ours = (src('src/lib/cook-ahead.ts') + src('src/lib/cook-ahead-server.ts')).replace(/^import .*$/gm, '');
  check('in the app’s own words', !/salon|stylist|booth|chair\b|studio|\buppercase\b|font-black/i.test(ours));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
