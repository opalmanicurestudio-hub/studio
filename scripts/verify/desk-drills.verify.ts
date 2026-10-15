// scripts/verify/desk-drills.verify.ts — the desk drills (lib/practice/desk-drills): every step has one right answer,
// and the waitlist answers still agree with the real offer rules (lib/waitlist-engine, lib/waitlist-party).
import { DESK_DRILLS, score } from '../../src/lib/practice/desk-drills';
import * as E from '../../src/lib/waitlist-engine';
import { partySet } from '../../src/lib/waitlist-party';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
for (const d of DESK_DRILLS) for (const [i, s] of d.steps.entries()) {
  ok(s.choices.filter((c) => c.right).length === 1, `${d.id} step ${i + 1}: exactly one right answer`);
  ok(s.choices.filter((c) => !c.right).every((c) => c.why), `${d.id} step ${i + 1}: every wrong answer says why`);
}
ok(!JSON.stringify(DESK_DRILLS).match(/call us/i), 'no “call us”');
const H = 3600e3, MIN = 60000, NOW = Date.parse('2026-10-14T12:00:00-04:00');
ok(E.offerModeFor(NOW + 26 * H, NOW) === 'one' && E.HOLD_ONE_MIN === 30, '“fill”: a day ahead → one at a time, 30 minutes');
ok(E.offerModeFor(NOW + 2 * H, NOW) === 'first' && E.FIRST_BATCH === 3, '“today”: two hours → top three, first to tap');
ok(E.offerModeFor(NOW + 40 * MIN, NOW) === 'desk', '“soon”: 40 minutes → the desk');
// "fill": Priya first, then Jen; Ivy leaves a scrap; Dana can't come.
const op: any = { id: 'o', staffId: 'maya', start: '2026-10-15T18:00:00.000Z', end: '2026-10-15T19:00:00.000Z', minutes: 60, chainDepth: 0 };
const base = { now: NOW, tz: { weekday: 4, hour: 14, date: '2026-10-15' }, shortest: 30, bookable: true, sameDayBooked: false };
const ppl: any[] = [{ id: 'priya', status: 'waiting', staffId: 'maya', windows: { 4: ['afternoon'] }, createdAt: '2026-10-05', m: 60 }, { id: 'jen', status: 'waiting', createdAt: '2026-10-10', m: 60 }, { id: 'ivy', status: 'waiting', createdAt: '2026-10-01', m: 45 }, { id: 'dana', status: 'waiting', windows: { 6: ['morning'] }, createdAt: '2026-09-28', m: 60 }];
const fits = ppl.map((p) => ({ p, f: E.fitFor(p, op, { ...base, serviceMinutes: p.m }) })).filter((x) => x.f.ok).map((x) => ({ e: x.p, leftover: (x.f as any).leftover }));
ok(E.rank(fits as any).map((x: any) => x.e.id).join() === 'priya,jen', 'the engine agrees: Priya, then Jen');
// "today": two missed visits → no same-day offer.
ok(!E.fitFor({ id: 'marco', status: 'waiting', reliability: 'misses' } as any, { ...op, start: new Date(NOW + 2 * H).toISOString() }, { ...base, serviceMinutes: 60 }).ok, 'the engine agrees: Marco not offered same-day');
// "party": two times 15 minutes apart with different providers make a set.
ok(partySet([{ id: 'a', staffId: 'maya', start: '2026-10-15T19:00:00Z' }, { id: 'b', staffId: 'jo', start: '2026-10-15T19:15:00Z' }], 2)?.length === 2, 'the party rules agree');
const s = score([{ drill: 'leak', step: 0, picked: 1, right: false }, { drill: 'leak', step: 0, picked: 0, right: true }, { drill: 'leak', step: 1, picked: 0, right: true }]);
ok(s.asked === 2 && s.right === 1 && s.points === 10, 'only the first try counts');
if (bad) process.exit(1); console.log('desk drills ok');
