// Checks practice a rush (L20 round 7): lib/practice/rush on the real host stand rules (lib/table-stage, lib/seat-next,
// lib/wait-line, lib/nudges), and its page. Nothing in it is real.
// - The night starts with tables mid-meal and parties waiting; the suggestions are the host stand's own.
// - Seating checks the table is free, fits and has what they need; the coach says when a better table was free.
// - "Needs you" is the real nudges plus the check and a booking that didn't come; each can be taken care of.
// - Left alone, food sits at the pass, tables wait to pay and walk-ins leave; the same choices make the same night.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/practice-rush.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const R = await import('../../src/lib/practice/rush');
  console.log('the night as it starts');
  let s = R.newRush();
  const parties = Object.values(s.parties);
  check('twelve tables, eight in their meal, two parties waiting, the rest still to come', s.tables.length === 12 && parties.filter((p) => p.status === 'seated').length === 8 && parties.filter((p) => p.status === 'waiting').length === 2 && parties.filter((p) => p.status === 'coming').length === 11);
  const st = R.stagesOf(s);
  check('each seated table’s stage from the real host stand rules', st.u5.words.includes('pass') || st.u5.key === 'cooking' || st.u5.key === 'at_pass', st.u5);
  const sg = R.suggestions(s);
  check('who to seat next: the host stand’s own suggestions, with why', sg.some((x) => x.partyId === 'chris' && x.tableName === '6' && x.action === 'seat') && sg.some((x) => x.partyId === 'lee' && x.tableName === '2') && sg.every((x) => x.reasons.length > 0), sg);
  check('what needs you: a table that hasn’t ordered, from the real nudges', R.needsOf(s).some((n) => n.kind === 'no_order' && n.table === 'Table 3'), R.needsOf(s));

  console.log('seating');
  check('not at a table with guests at it', R.seat(s, 'lee', 'u1').ok === false);
  check('not at a table too small', /seats 2/.test(R.seat(s, 'chris', 'u2').error || ''));
  check('Lee at Table 6 (a table for 4): seated, and the coach says Table 2 fit better', R.seat(s, 'lee', 'u6').ok && s.parties.lee.status === 'seated' && /Table 2 fit Lee better/.test(s.coach || '') && s.tips.size === 1, s.coach);
  check('Chris at Table 11: seated', R.seat(s, 'chris', 'u11').ok && s.seated === 2);

  console.log('what needs you');
  R.tick(s, 3);
  let needs = R.needsOf(s);
  const pass = needs.find((n) => n.kind === 'at_pass');
  check('food at the pass: run it', !!pass && R.act(s, pass.key).ok && s.tips.pass === 1, needs);
  const order = needs.find((n) => n.kind === 'no_order');
  check('a table that hasn’t ordered: their server takes it', !!order && R.act(s, order.key).ok && s.parties.moss.orderedAt !== null);
  const chk = R.needsOf(s).find((n) => n.kind === 'check');
  check('a table that asked for the check: paid, and they leave soon after', !!chk && R.act(s, chk.key).ok && !!s.parties[chk.partyId].paidAt);
  R.tick(s, 28);
  const ns = R.needsOf(s).find((n) => n.kind === 'no_show');
  check('a booking that didn’t come: charge or let it go', !!ns && /\$140/.test(ns.action) && R.act(s, ns.key).ok && s.parties.ward.status === 'no_show', R.needsOf(s));
  check('guests arrive, walk-ins told a wait from the real wait line', parties.length > 0 && Object.values(s.parties).filter((p) => p.kind === 'walkin' && p.status !== 'coming' && p.joinedAt && p.arrive > 0).every((p) => (p.quotedMinutes || 0) >= 5));
  const s2 = R.newRush(); R.tick(s2, 10.5);
  Object.assign(s2.parties.moss, { status: 'finished', finishedAt: '2026-11-14T18:00:00.000Z', clearedAt: '2026-11-14T18:05:00.000Z' });
  const r2 = R.seat(s2, 'patel', 'u3');
  check('a booking with step-free access can’t go at a table without it', s2.parties.patel.status === 'waiting' && !r2.ok && /step-free/.test(r2.error || ''), r2);

  console.log('left alone');
  const lazy = R.newRush(); R.tick(lazy, R.RUSH_MIN);
  const sc = R.scoreOf(lazy);
  check('the rush ends, and left alone walk-ins leave and guests are less happy', lazy.ended && sc.walkedOut > 0 && sc.happy < 90 && lazy.log.some((l) => /waited \d+ min to pay|at the pass/.test(l.text)) && lazy.tips.late > 0, sc);
  check('the night’s seeded tables were ordered before anything was served', Object.values(R.newRush().parties).filter((p) => p.orderedAt !== null).every((p) => p.tab.every((l) => !p.tickets[l.kdsId].deliveredAt || Date.parse(p.tickets[l.kdsId].deliveredAt!) >= Date.parse(l.at))));
  check('…what to take from it, in a few lines', R.lessons(lazy).length >= 2 && /left after waiting well past/.test(R.lessons(lazy)[0]), R.lessons(lazy));
  const again = R.newRush(); R.tick(again, R.RUSH_MIN);
  check('the same choices make the same night', JSON.stringify(R.scoreOf(again)) === JSON.stringify(sc));
  s = R.newRush();
  for (let i = 0; i < 40; i++) { R.tick(s, 1); for (const x of R.suggestions(s)) if (x.action === 'seat') R.seat(s, x.partyId, x.tableId); for (const n of R.needsOf(s)) if (n.kind !== 'no_show') R.act(s, n.key); }
  const good = R.scoreOf(s);
  check('played well (the suggested table, needs taken care of): nobody leaves, more seated and happier', good.walkedOut === 0 && good.seated > R.scoreOf(lazy).seated && good.happy > sc.happy, { good, sc });
  check('…and the step-free booking gets a table that has it', s.parties.patel.status !== 'waiting' && s.tables.find((t) => t.id === s.parties.patel.unitIds[0])?.tags.includes('step-free'), s.parties.patel);
  check('a walk-in who left counts in the longest wait', Object.values(lazy.parties).filter((p) => p.status === 'left').every((p) => (p.waited || 0) > 0 && sc.longestWait >= (p.waited || 0)));
  check('the lessons follow what happened', R.lessons(s).some((l) => /Nobody waited past/.test(l)) && !R.lessons(lazy).some((l) => /Nobody waited past/.test(l)), R.lessons(s));

  console.log('the page');
  const page = src('src/app/practice/rush/page.tsx');
  check('said to be practice; start, pause and double speed; pick a table; needs you; how it went; play again', /Nothing here is real/.test(page) && /Start the rush/.test(page) && /Pause/.test(page) && /2×/.test(page) && /Pick a table/.test(page) && /Needs you/.test(page) && /How the rush went/.test(page) && /Play again/.test(page));
  check('on the practice page', /href="\/practice\/rush"/.test(src('src/app/practice/page.tsx')));
  check('no emoji, all caps, red or niche words in the new screen', !/[\u{1F300}-\u{1FAFF}]/u.test(page) && !/\buppercase\b|font-black|#b42318/.test(page) && !/\b(salon|stylist|booth|chair)\b/i.test(page));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
