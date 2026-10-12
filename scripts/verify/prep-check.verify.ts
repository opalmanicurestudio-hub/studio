// Checks lib/prep-check: cleaning a check, the quote, safety, the no-answer suggestion, "Good to know", timing.
// Run: npx tsx scripts/verify/prep-check.verify.ts
import { cleanCheck, quoteFor, noAnswerSuggestion, goodToKnow, prepSettingsOf, sendTimes, STARTERS } from '../../src/lib/prep-check';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const services = [
  { id: 'fill', name: 'Gel fill', price: 55, duration: 60, lateServiceId: 'set', rebookWeeks: 3, returnMaxWeeks: 5 },
  { id: 'set', name: 'New set', price: 85, duration: 90 },
  { id: 'rep', name: 'Repair', type: 'addon', price: 5, duration: 5 },
  { id: 'soak', name: 'Soak-off', type: 'addon', price: 15, duration: 15 },
];
const check = cleanCheck({ on: true, questions: [
  { id: 'lift', label: 'How many nails are lifting or broken?', kind: 'choice', options: [{ id: 'n0', label: 'None', effect: {} }, { id: 'n2', label: '1–2', effect: { addMinutes: 10, addOns: [{ id: 'rep', qty: 2 }] } }, { id: 'n3', label: '3 or more', effect: { addMinutes: 20, addOns: [{ id: 'rep', qty: 4 }] } }] },
  { id: 'else', label: 'Has anyone removed or redone them since?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { switchServiceId: 'set', addOns: [{ id: 'soak', qty: 1 }] } }] },
  { id: 'skin', label: 'Any redness?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { safety: true } }] },
  { id: 'p', label: 'A photo', kind: 'photo' }, { id: 'bad', label: '', kind: 'choice', options: [] }] }, 2);
ok(check.on && check.questions.length === 4 && check.version === 3, 'cleaned: empty question dropped, version bumped');
ok(cleanCheck({ on: true, questions: [] }).on === false, 'no questions means off');
const fill = services[0];
const q0 = quoteFor(check, fill, services, { lift: 'n0', else: 'no', skin: 'no' }, { price: 55, duration: 60 });
ok(!q0.changed && q0.newPrice === 55 && !q0.safety, 'no change');
const q1 = quoteFor(check, fill, services, { lift: 'n2', else: 'no', skin: 'no' }, { price: 55, duration: 60 });
ok(q1.changed && q1.newPrice === 65 && q1.newMinutes === 70 && q1.addOns[0].qty === 2, '2 repairs: +$10, +10 min');
const q2 = quoteFor(check, fill, services, { lift: 'n2', else: 'yes', skin: 'no' }, { price: 55, duration: 60 });
ok(q2.switched && q2.serviceName === 'New set' && q2.newPrice === 55 + 30 + 10 + 15 && q2.newMinutes === 60 + 10 + 30, 'switch to a new set + soak-off + repairs');
ok(quoteFor(check, fill, services, { lift: 'n2', else: 'no', skin: 'yes' }).safety !== null, 'safety answer');
ok(quoteFor(check, fill, services, { lift: 'n2' }, { price: 50 }).newPrice === 60, 'the price they booked is the starting point');
ok(noAnswerSuggestion(fill, services, 7)?.serviceId === 'set' && noAnswerSuggestion(fill, services, 4) === null && noAnswerSuggestion(fill, services, null) === null, 'no answer: late service only past the window');
const S = prepSettingsOf({}); ok(S.quote === 'upto' && S.autoMinutes === 15 && S.onDay === 'fit_rebook' && S.topUp.mode === 'off', 'defaults');
const g = goodToKnow({ cancellationWindowHours: 24 }, fill, services, check, S, 'Maya');
ok(g.some((x) => x.includes('new set ($85)')) && g.some((x) => x.includes('repair × 2 is $10')) && g.some((x) => x.includes('free until you say yes')) && g.some((x) => x.includes('Maya shows you')), 'good to know lists the fees and rules');
ok(!g.some((x) => /redness/i.test(x)), 'safety answers aren’t priced');
const t = sendTimes(Date.parse('2026-10-15T18:00:00Z'), 24); ok(new Date(t.sendAt).toISOString() === '2026-10-13T18:00:00.000Z' && new Date(t.lockAt).toISOString() === '2026-10-15T12:00:00.000Z', 'sent window + a day before; locked 6 h before');
ok(STARTERS.every((s) => cleanCheck({ on: true, questions: s.questions }).questions.length === s.questions.length), 'starter sets are valid');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
