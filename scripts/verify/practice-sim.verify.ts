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
      else if (n.kind === 'pay') G.checkout(s, n.pid, { offerProduct: !!bot.offers, offerRebook: !!bot.offers });
      else if (n.kind === 'break') G.takeBreak(s, n.pid);
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
  const n = G.needs(s).find((x) => x.kind === 'pay')!; const t0 = G.ticketFor(s, n.pid)!;
  check('a ticket has the service and the client’s tip', t0.lines[0].kind === 'service' && t0.total === t0.subtotal + t0.tip, t0);
  const shelf = G.shelfFor(s, n.pid); check('products that fit the service come first', shelf[0].for.includes(s.flags[`kind:${n.pid}`]), shelf[0]);
  const r1 = G.recommend(s, n.pid, shelf[0].key); if (r1.yes) G.scan(s, n.pid, shelf[0].key);
  check('a yes adds it to the ticket when scanned', !r1.yes || G.ticketFor(s, n.pid)!.lines.some((l) => l.kind === 'retail'), r1);
  const before = s.people[n.pid].patience; G.recommend(s, n.pid, shelf[5].key); G.recommend(s, n.pid, shelf[6].key);
  check('pushing a third product costs goodwill', s.people[n.pid].patience < before, { before, after: s.people[n.pid].patience });
  G.askRebook(s, n.pid);
  const tk = G.ticketFor(s, n.pid)!;
  if (tk.method === 'cash') check('wrong change is refused', !G.pay(s, n.pid, { change: tk.given - tk.total + 5 }).ok);
  const took = s.takings; const r = G.pay(s, n.pid, { change: tk.method === 'cash' ? tk.given - tk.total : undefined });
  check('payment adds to takings and pops a reward', r.ok && s.takings > took && s.pops.some((p) => p.tone === 'gold'), r);
  check('then they leave', s.people[n.pid].afterArrive === 'leave');
  check('the level ladder', G.levelOf(0).name === 'Front desk' && G.levelOf(160).n === 2 && G.levelOf(5000).name === 'Owner');
}
console.log('Drinks, breaks, personalities, regulars');
{ const s = G.newShift('opening'); for (let i = 0; i < 200 && !s.people.theo?.need; i++) { for (const n of G.needs(s)) { if (n.kind === 'check_in') G.checkIn(s, n.pid); else if (n.kind === 'seat' && n.to) G.moveTo(s, n.pid, n.to); else if (n.kind === 'pay') G.checkout(s, n.pid, { offerProduct: false, offerRebook: false }); } G.advance(s, 0.25); }
  const theo = s.people.theo; check('Theo is in a hurry and has notes', theo?.trait === 'hurry' && !!theo.notes, theo?.trait);
  for (let i = 0; i < 100 && theo.need?.kind !== 'drink'; i++) { for (const n of G.needs(s)) { if (n.kind === 'check_in') G.checkIn(s, n.pid); else if (n.kind === 'seat' && n.to && n.pid !== 'theo') G.moveTo(s, n.pid, n.to); } G.advance(s, 0.25); }
  theo.need = { kind: 'drink', item: 'a coffee', since: s.t }; const w = G.freeTeam(s, theo)[0]; check('someone is free to make the coffee', !!w); G.serve(s, w.id, 'theo');
  check('the drink leaves the Needs you tray once someone is on it', !G.needs(s).some((n) => n.pid === 'theo' && n.kind === 'drink'));
  let brewed = false; for (let i = 0; i < 200 && theo.need?.kind === 'drink'; i++) { G.advance(s, 0.1); if (s.people[w.id].task?.kind === 'brew') brewed = true; }
  check('they walk to the drinks bar and make it first', brewed);
  check('then bring it over', theo.need?.kind !== 'drink');
  theo.need = { kind: 'drink', item: 'water', since: s.t }; check('a second drink request shows up again', G.needs(s).some((n) => n.pid === 'theo' && n.kind === 'drink'));
  const a = G.newShift('opening'); a.tutorial = 9; a.people.jess.energy = 0.2; a.people.jess.state = 'idle'; G.advance(a, 0.5);
  check('a tired team member asks for a break', a.people.jess.need?.kind === 'break' && G.needs(a).some((n) => n.kind === 'break'));
  check('a break sends them to the back office', G.takeBreak(a, 'jess').ok); for (let i = 0; i < 80; i++) G.advance(a, 0.25);
  check('and they come back refreshed', (a.people.jess.energy ?? 0) > 0.9 && !a.people.jess.task, a.people.jess);
  const back = G.newShift('opening', { regulars: ['nina'] }); back.tutorial = 9; for (let i = 0; i < 120; i++) G.advance(back, 0.25);
  check('a client you rebooked comes back as a regular', back.people.nina?.trait === 'regular' && back.log.some((l) => /Back again/.test(l.text)), back.people.nina?.trait);
}
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
