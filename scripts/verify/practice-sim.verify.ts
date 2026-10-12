// Checks lib/practice/sim: both shifts play start to finish, the loops (check in, seat, pay, rebook) work, choices
// change the outcome, the first shift waits for you while you learn, and moves are validated.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/practice-sim.verify.ts
import { check, failures } from './fake-db';
import * as G from '../../src/lib/practice/sim';

type Bot = { choices?: Record<string, string>; help?: boolean; offers?: boolean; ignoreDecisions?: boolean };
function play(shift: G.ShiftId, bot: Bot) {
  const s = G.newShift(shift); let guard = 0;
  while (!s.ended && guard++ < 8000) {
    for (const n of G.needs(s)) {
      const p = s.people[n.pid];
      if (n.kind === 'decide') { if (!bot.ignoreDecisions) G.decide(s, n.decision!, bot.choices?.[n.decision!] || s.decisions[n.decision!].options[0].id); continue; }
      if (!bot.help && n.kind !== 'check_in' && n.kind !== 'seat' && n.kind !== 'pay') continue;
      if (n.kind === 'check_in') G.checkIn(s, n.pid);
      else if (n.kind === 'seat') { const to = n.to && G.canGo(s, p, s.spots[n.to]) == null ? n.to : G.freeSpots(s, 'client', ['lounge']).find((x) => G.canGo(s, p, x) == null)?.id; if (to) G.moveTo(s, n.pid, to); }
      else if (n.kind === 'pay') { const b = G.billFor(s, n.pid)!; G.checkout(s, n.pid, { offerProduct: !!bot.offers, offerRebook: !!bot.offers, change: b.method === 'cash' ? b.given - b.total : undefined }); }
      else if (n.kind === 'drink') { const w = G.freeTeam(s, p)[0]; if (w) G.serve(s, w.id, n.pid); }
    }
    G.advance(s, 0.25);
  }
  return { s, r: G.report(s) };
}

console.log('Shift 1: Saturday opening (with the first-shift coaching)');
{ const s = G.newShift('opening');
  for (let i = 0; i < 40; i++) G.advance(s, 0.25);
  check('time waits while Rosa needs checking in', s.people.rosa?.need?.kind === 'check_in' && G.paused(s) && s.t < 6, { t: s.t, need: s.people.rosa?.need });
  check('check-in works with someone at the desk', G.checkIn(s, 'rosa').ok && s.tutorial === 2);
  check('then she needs seating at Ana’s table', s.people.rosa.need?.kind === 'seat' && s.people.rosa.need?.to === 'nail1', s.people.rosa.need);
  check('a client can’t take the wrong provider’s chair', !G.moveTo(s, 'rosa', 'nail3').ok);
  check('seating her lets time run again', G.moveTo(s, 'rosa', 'nail1').ok && s.tutorial === 3 && !G.paused(s));
}
const o1 = play('opening', { help: true, offers: true });
check('the shift ends', o1.s.ended && o1.s.t === 60, o1.s.t);
check('arrivals were checked in and paid', o1.s.takings >= 250 && Object.values(o1.s.people).filter((p) => p.paid).length >= 4, { takings: o1.s.takings, paid: Object.values(o1.s.people).filter((p) => p.paid).map((p) => p.name) });
check('rebooking counts', o1.s.rebooked >= 2, o1.s.rebooked);
check('tips and products', o1.s.tips > 0 && o1.s.retail > 0, { tips: o1.s.tips, retail: o1.s.retail });
check('Theo got his coffee', o1.s.fired.coffee && !Object.values(o1.s.people).some((p) => p.need?.kind === 'drink'));
check('XP was earned', o1.s.xp > 80, o1.s.xp);
check('a good report', o1.r.stars >= 2 && o1.r.goals.length === 4, o1.r);
const o2 = play('opening', { help: false, offers: false });
check('skipping offers earns less', o2.s.rebooked === 0 && o2.s.xp < o1.s.xp, { xp: o2.s.xp });

console.log('Shift 2: Saturday rush');
const r1 = play('rush', { help: true, offers: true, choices: { callout: 'choose', late: 'shorten', walkin: 'queue', wash: 'andre' } });
check('every moment came up', ['water', 'callout', 'late', 'walkin', 'wash', 'olivia'].every((k) => r1.s.fired[k]), r1.s.fired);
check('a visit within 3 hours went on the call list (callout rule)', (r1.s.flags.callList || []).includes('Ms. Patel'), r1.s.flags.callList);
check('Olivia’s text was read as running late', r1.s.flags.lateIntent === 'late');
check('Nina was seen by Tia', r1.s.people.nina.provider === 'tia' && (r1.s.people.nina.paid || r1.s.people.nina.state === 'service'), r1.s.people.nina.state);
check('Priya was rinsed and finished', r1.s.people.priya.paid || r1.s.people.priya.state === 'service', r1.s.people.priya.state);
check('texts in the app’s voice', r1.s.texts.some((t) => /so sorry/.test(t.body)));
check('money came in', r1.s.takings > 500, r1.s.takings);
const r2 = play('rush', { help: true, offers: true, ignoreDecisions: true });
check('ignored moments are handled by the team, with a note', r2.s.coach.some((c) => /Nobody decided/.test(c)) && r2.s.flags.callout === 'move_all', r2.s.coach);
check('ignoring them costs', r2.r.goals.find((g) => g.id === 'happy')!.value <= r1.r.goals.find((g) => g.id === 'happy')!.value || r2.s.xp < r1.s.xp, { r1: r1.s.xp, r2: r2.s.xp });

console.log('Payments');
{ const s = G.newShift('opening'); G.checkIn(s, 'rosa' as any);
  for (let i = 0; i < 200 && !G.needs(s).some((n) => n.kind === 'pay'); i++) { for (const n of G.needs(s)) { if (n.kind === 'check_in') G.checkIn(s, n.pid); if (n.kind === 'seat' && n.to) G.moveTo(s, n.pid, n.to); } G.advance(s, 0.25); }
  const n = G.needs(s).find((x) => x.kind === 'pay')!; const b = G.billFor(s, n.pid)!;
  check('a bill has the service, a tip and a product to suggest', b.total === b.service + b.tip && !!b.product, b);
  if (b.method === 'cash') check('wrong change is refused', !G.checkout(s, n.pid, { offerProduct: false, offerRebook: false, change: b.given - b.total + 5 }).ok);
  const before = s.takings; const r = G.checkout(s, n.pid, { offerProduct: true, offerRebook: true, change: b.method === 'cash' ? b.given - b.total : undefined });
  check('payment adds to takings and pops a reward', r.ok && s.takings > before && s.pops.some((p) => p.tone === 'gold'), r);
  check('then they leave', s.people[n.pid].afterArrive === 'leave');
  check('the level ladder', G.levelOf(0).name === 'Front desk' && G.levelOf(160).n === 2 && G.levelOf(5000).name === 'Owner');
}
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
