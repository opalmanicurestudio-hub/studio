// scripts/verify/klair.verify.ts — Klair reads a request, never picks a person on her own, and says little out loud.
import { klairSettings, cleanPlan, plainPlan, matchPeople, underline, spokenLine } from '../../src/lib/klair';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
ok(!klairSettings({}).on && klairSettings({ addons: { assistant: true } }).on && klairSettings({ addons: { assistant: true }, klair: { enabled: false } }).on === false, 'on only with the add-on, and can be switched off');
ok(klairSettings({}).name === 'Klair' && klairSettings({ klair: { name: 'Opal' } }).name === 'Opal', 'renamed by the business');
const heard = 'Move Sam to Thursday at 3';
const p = cleanPlan({ intent: 'move', person: 'Sam', date: '2026-10-22', time: '15:00', spans: ['Sam', 'Thursday', 'at 3', 'Monday'] }, heard);
ok(p.intent === 'move' && p.person === 'Sam' && p.time === '15:00' && p.spans.length === 3, 'a plan only keeps what was actually said', p);
ok(cleanPlan({ intent: 'move', person: 'Samantha Reyes' }, heard).person === null, 'the model can’t invent or complete a name');
ok(cleanPlan({ intent: 'delete everything' }, heard).intent === 'unknown', 'unknown requests stay unknown');
ok(plainPlan('Who hasn’t confirmed tomorrow?').intent === 'unconfirmed' && plainPlan("I'm running 10 minutes late").minutes === 10 && plainPlan("what's next").intent === 'next', 'plain words work without the model');
const now = Date.parse('2026-10-16T14:00:00Z'); const iso = (d: number) => new Date(now + d * 864e5).toISOString();
const appts = [
  { id: 'a1', clientId: 'c1', clientName: 'Sam Patel', clientPhone: '5550004471', startTime: iso(1), status: 'confirmed', serviceName: 'Full set', staffId: 'l' },
  { id: 'a2', clientId: 'c2', clientName: 'Samantha Reyes', clientPhone: '5550000912', startTime: iso(2), status: 'confirmed', serviceName: 'Pedicure', staffId: 'm' },
  { id: 'a3', clientId: 'c3', clientName: 'Sam Lee', startTime: iso(-200), status: 'completed' },
  { id: 'a4', clientId: 'c4', clientName: 'Dana Ortiz', startTime: iso(3), status: 'cancelled' },
];
const staff = [{ id: 'l', name: 'Lena Moss' }, { id: 'm', name: 'Maya' }];
const one = matchPeople('Sam Patel', appts, [], now, staff); ok(one.length === 1 && one[0].clientName === 'Sam Patel' && one[0].phoneLast4 === '4471' && one[0].next?.staffName === 'Lena', 'full name: one person', one);
const sam = matchPeople('Sam', appts, [], now, staff); ok(sam.length === 1 && sam[0].clientName === 'Sam Patel', '“Sam” matches the exact first name over a longer one', sam.map((x) => x.clientName));
ok(matchPeople('Sam', [...appts, { id: 'a5', clientId: 'c5', clientName: 'Sam Rivera', startTime: iso(4), status: 'confirmed' }], [], now).length === 2, 'two equally good matches: she asks');
ok(matchPeople('Dana', appts, [], now).length === 0, 'cancelled visits don’t count');
ok(matchPeople('Lee', appts, [], now).length === 0, 'too long ago doesn’t count');
const u = underline(heard, ['Sam', 'Thursday', 'at 3']); ok(u.map((x) => (x.got ? `[${x.text}]` : x.text)).join('') === 'Move [Sam] to [Thursday] [at 3]', 'underlines what she used', u);
ok(spokenLine('preview', { name: 'Sam Patel', change: 'moving to Thu at 3:00 PM' }) === 'Sam Patel, moving to Thu at 3:00 PM. Shall I?' && spokenLine('needs_ok') === 'That needs your OK.', 'short spoken lines, no amounts');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
