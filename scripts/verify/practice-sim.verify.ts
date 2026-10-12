// Checks lib/practice/sim: the practice shift plays start to finish, choices change the outcome, and moves are validated.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/practice-sim.verify.ts
import { check, failures } from './fake-db';
import * as G from '../../src/lib/practice/sim';

function play(choices: Record<string, string>, opts: { serveWater?: boolean; moveNina?: boolean; checkIn?: boolean; seatNext?: boolean } = {}) {
  const s = G.newShift(); let guard = 0;
  while (!s.ended && guard++ < 5000) {
    for (const d of [...s.open]) G.decide(s, d.id, choices[d.id] || d.options[0].id);
    if (opts.serveWater && s.people.gia.need === 'water') { const w = G.freeTeam(s, s.people.gia)[0]; if (w) G.serve(s, w.id, 'gia'); }
    for (const q of [...s.prompts]) {
      const p = s.people[q.personId]; if (!p || p.state === 'walking') continue;
      if (q.to && (opts.moveNina || q.personId !== 'nina') && opts.seatNext !== false) { G.moveTo(s, q.personId, q.to); }
      else if (!q.to && p.need === 'check_in' && opts.checkIn) { const r = G.checkIn(s, q.personId); if (r.ok) s.prompts = s.prompts.filter((x) => x !== q); }
      else if (!q.to && p.need !== 'check_in' && p.state === 'waiting' && opts.seatNext !== false) { const free = G.freeSpots(s, 'client', ['lounge']).find((x) => !x.accessible); if (free) G.moveTo(s, q.personId, free.id); s.prompts = s.prompts.filter((x) => x !== q); }
    }
    G.advance(s, 0.25);
  }
  return { s, r: G.report(s) };
}

console.log('A good shift');
const good = play({ callout: 'choose', late: 'shorten', walkin: 'queue', wash: 'andre' }, { serveWater: true, moveNina: true, checkIn: true });
check('the shift ends at 12:00', good.s.ended && good.s.t === 90 && G.clock(good.s.t) === '12:00 PM', G.clock(good.s.t));
check('every moment came up', ['water', 'callout', 'late', 'marcus', 'walkin', 'wash', 'olivia'].every((k) => good.s.fired[k]), good.s.fired);
check('Gia got her water', good.s.people.gia.need === null);
check('Nina was seen by Tia', good.s.people.nina.provider === 'tia' && ['service', 'gone', 'walking'].includes(good.s.people.nina.state), good.s.people.nina.state);
check('texts went out in the app’s voice', good.s.texts.some((t) => t.to === 'Nina' && /so sorry/.test(t.body)) && good.s.texts.length >= 4, good.s.texts.length);
check('a visit within 3 hours went to the call list (callout rule)', (good.s.flags.callList || []).includes('Ms. Patel'), good.s.flags.callList);
check('Olivia’s text was read as running late', good.s.flags.lateIntent === 'late');
check('money came in', good.r.takings > 300, good.r.takings);
check('a good report', good.r.happy >= 70 && good.r.policy !== 'Needs work', good.r);

console.log('A rough shift');
const rough = play({ callout: 'call', late: 'hold', walkin: 'away', wash: 'wait' }, { serveWater: false, moveNina: true, checkIn: true });
check('ignoring Gia leaves her unhappy', G.moodOf(rough.s.people.gia) !== 'ok', rough.s.people.gia.patience);
check('the coach says why', rough.r.coach.length >= 2 && rough.s.coach.some((c) => /desk/.test(c)), rough.r.coach);
check('a rougher score', rough.r.happy < good.r.happy || rough.r.stars < good.r.stars, { rough: rough.r, good: good.r });
check('the walk-in left', rough.s.people.ben.state === 'gone');

console.log('Moves');
{ const s = G.newShift();
  check('a client can’t take a team spot', !G.moveTo(s, 'nina', 'desk').ok);
  check('a taken chair is refused', !G.moveTo(s, 'nina', 'nail1').ok);
  check('someone in a service can’t be moved', !G.moveTo(s, 'rosa', 'sofa2').ok);
  check('a free chair works', G.moveTo(s, 'nina', 'nail3').ok && s.people.nina.path.length > 0);
  s.people.marcus = (G as any).newShift().people.nina; s.people.marcus.id = 'marcus'; s.people.marcus.look = { ...s.people.marcus.look, wheelchair: true }; s.people.marcus.at = 'door'; s.people.marcus.to = null;
  check('a wheelchair user isn’t sent to a sofa', !G.moveTo(s, 'marcus', 'sofa2').ok && G.moveTo(s, 'marcus', 'lounge-open').ok);
  const path = G.route(3.4, 1.9, 24.35, 9.75); check('paths follow the aisles', path.every((p, i) => i === 0 || i === path.length - 1 || [5.6, 12].includes(p.z) || [11, 21.4].includes(p.x)), path);
  check('check-in needs someone at the desk', (() => { const t = G.newShift(); G.moveTo(t, 'zoe', 'office'); for (let i = 0; i < 40; i++) G.advance(t, 0.1); t.people.x = { ...t.people.nina, id: 'x', need: 'check_in' } as any; return !G.checkIn(t, 'x').ok; })());
}
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
