// Checks staff numbers (lib/staff-kpis) and one-on-ones (lib/staff-kpis-server).
// Run: npx tsx scripts/verify/staff-kpis.verify.ts
import { numbersFor, suggestedTopics, goalsOf, towardGoal, weekly } from '../../src/lib/staff-kpis';
import { bookOneOnOne, addTopic, closeOneOnOne, startingAgenda } from '../../src/lib/staff-kpis-server';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const now = Date.parse('2026-10-11T18:00:00Z'); const day = 864e5; const at = (d: number, h = 15) => new Date(now - d * day + (h - 18) * 3600e3).toISOString();
const appts = [
  { id: 'a1', staffId: 'm', clientId: 'c1', status: 'completed', startTime: at(10), revenue: 60, duration: 60, actualStartTime: at(10), feedback: { rating: 5 } },
  { id: 'a2', staffId: 'm', clientId: 'c2', status: 'completed', startTime: at(5), revenue: 40, duration: 60, actualStartTime: new Date(Date.parse(at(5)) + 12 * 60000).toISOString() },
  { id: 'a3', staffId: 'm', clientId: 'c1', status: 'confirmed', startTime: at(-20), createdAt: at(9), duration: 60 },   // c1 rebooked a day after
  { id: 'a4', staffId: 'j', clientId: 'c3', status: 'completed', startTime: at(3), revenue: 80, duration: 90 },
  { id: 'a5', staffId: 'm', clientId: 'c4', status: 'cancelled', startTime: at(4), revenue: 99, duration: 60 },
  { id: 'a0', staffId: 'm', clientId: 'c5', status: 'completed', startTime: at(40), revenue: 50, duration: 60 },
];
const x = { appointments: appts, retail: [{ staffId: 'm', amount: 10, date: at(6) }, { staffId: 'j', amount: 4, date: at(2) }], shifts: [{ staffId: 'm', date: at(10).slice(0, 10), startTime: '09:00', endTime: '13:00', breakMinutes: 0, status: 'published' }, { staffId: 'm', date: at(5).slice(0, 10), startTime: '09:00', endTime: '13:00', status: 'draft' }],
  cases: [{ fix: { kind: 'redo' }, visit: { appointmentId: 'a2' } }] };
const m = numbersFor(x as any, 'm', now - 30 * day, now);
ok(m.visits === 2 && m.revenue === 100 && m.avgVisit === 50, 'two finished visits, $100, $50 average (cancelled and older ones left out)');
ok(m.rebookPct === 50, 'rebooked: one of two clients booked again within a week');
ok(m.retailPerVisit === 5, 'retail per visit: $10 over 2 visits');
ok(m.chairPct === 50, 'chair time: 120 booked minutes of a 240-minute shift (the draft shift doesn’t count)');
ok(m.onTimePct === 50 && m.redos === 1 && m.redoPct === 50 && m.rating === 5, 'on time 1 of 2 (12 min late isn’t), one redo, rating 5');
const team = numbersFor(x as any, null, now - 30 * day, now); ok(team.visits === 3 && team.revenue === 180, 'the team: everyone’s finished visits');
const g = goalsOf({}); const topics = suggestedTopics(m, team, g);
ok(topics.some((t) => /Rebooking 50%/.test(t)) && topics.some((t) => /redo/.test(t)) && topics.some((t) => /on time/i.test(t)), 'suggested topics come from what’s below the goal');
ok(towardGoal('redoPctMax', 2, g) === 100 && towardGoal('rebookPct', 35, g) === 50, 'bars: under the redo limit is full; half the rebook goal is half');
ok(goalsOf({ teamGoals: { rebookPct: 150, avgVisit: 'x' } }).rebookPct === 100 && goalsOf({ teamGoals: { avgVisit: 'x' } }).avgVisit === 60, 'goals are kept in range');
ok(weekly(x as any, 'm', now).length === 12, 'twelve weeks of revenue');

// One-on-ones
const store: Record<string, any> = {}; let n = 0;
const docRef = (p: string) => ({ id: p.split('/').pop(), get: async () => ({ exists: !!store[p], data: () => store[p] }), set: async (v: any, o?: any) => { store[p] = o?.merge ? { ...(store[p] || {}), ...v } : v; }, delete: async () => { delete store[p]; } });
const coll = (p: string) => { const rows = () => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
  const q = (f: (d: any) => boolean) => ({ get: async () => ({ docs: rows().filter((d) => f(d.data())) }) });
  return { get: async () => ({ docs: rows() }), where: (f: string, op: string, v: any) => q((d) => (op === '==' ? d[f] === v : op === '>=' ? String(d[f]) >= String(v) : true)), doc: (id?: string) => docRef(`${p}/${id || `n${++n}`}`) }; };
const db: any = { doc: docRef, collection: coll };
(async () => {
  store['tenants/t'] = { timezone: 'America/New_York' }; store['tenants/t/staff/ri'] = { name: 'Ri S', role: 'stylist' }; store['tenants/t/staff/boss'] = { name: 'Jessica M', role: 'owner' };
  const when = new Date(Date.now() + 2 * day).toISOString();
  store['tenants/t/appointments/busy'] = { staffId: 'ri', startTime: when, endTime: new Date(Date.parse(when) + 3600e3).toISOString(), status: 'confirmed' };
  let r: any = await bookOneOnOne(db, 't', { staffId: 'boss', name: 'Jessica M' }, { staffId: 'ri', startTime: when, minutes: 30 });
  ok(!r.ok && /Ri is busy/.test(r.error), 'can’t book over their client');
  const later = new Date(Date.now() + 3 * day).toISOString();
  r = await bookOneOnOne(db, 't', { staffId: 'boss', name: 'Jessica M' }, { staffId: 'ri', startTime: later, minutes: 30, agenda: [{ text: 'Rebooking 58%', source: 'numbers' }], staffCanAdd: true });
  const id = r.id; ok(r.ok && store[`tenants/t/oneOnOnes/${id}`].status === 'booked', 'booked');
  ok(!!store[`tenants/t/staffBlocks/oneonone_${id}_ri`] && !!store[`tenants/t/staffBlocks/oneonone_${id}_boss`], 'on both schedules — booking is blocked for both');
  ok(Object.values(store).some((v: any) => v?.type === 'one_on_one' && v.userId === 'ri'), 'Ri is told');
  ok((await addTopic(db, 't', { staffId: 'ri', manager: false }, id, 'Can I try builder gel?')).ok && store[`tenants/t/oneOnOnes/${id}`].agenda.length === 2, 'Ri adds a topic (allowed)');
  ok(!(await addTopic(db, 't', { staffId: 'jo', manager: false }, id, 'Hi')).ok, 'someone else can’t');
  ok(!(await closeOneOnOne(db, 't', { staffId: 'ri', manager: false }, id, { notes: 'x' })).ok, 'only the manager closes it');
  ok((await closeOneOnOne(db, 't', { staffId: 'boss', manager: true }, id, { notes: 'Good chat', nextSteps: ['Retail script', ''] })).ok && store[`tenants/t/oneOnOnes/${id}`].nextSteps.length === 1, 'closed with notes and next steps');
  const ag = await startingAgenda(db, 't', 'ri'); ok(ag.some((a: any) => a.source === 'last' && a.text === 'Retail script'), 'next time starts with last time’s next steps');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
