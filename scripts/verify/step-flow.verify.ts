// scripts/verify/step-flow.verify.ts — steps move into processing by themselves, and a reminder fires when it's done.
import { visitSteps, liveTiming, stepAlert } from '../../src/lib/phase-timeline';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const svc = { blueprint: { phases: [{ kind: 'setup', minutes: 5 }, { kind: 'active', label: 'Apply colour', minutes: 20 }, { kind: 'processing', label: 'Processing', minutes: 25, providerNeeded: false }, { kind: 'active', label: 'Rinse and finish', minutes: 15 }, { kind: 'turnover', minutes: 5 }] } };
const steps = visitSteps(svc); const T0 = Date.parse('2026-10-15T13:00:00Z'); const m = (n: number) => T0 + n * 60000;
const base = { id: 'a', status: 'servicing', startTime: new Date(T0).toISOString(), actualStartTime: new Date(T0).toISOString() };
// Tapped "Apply colour" late, at 3 min in
const tapped = { ...base, stepStarts: { 1: new Date(m(3)).toISOString() } };
let lt = liveTiming(steps, tapped, m(10))!; ok(steps[lt.index].label === 'Apply colour', 'still applying at 10 min');
lt = liveTiming(steps, tapped, m(24))!; ok(steps[lt.index].label === 'Processing' && !lt.steps[1].over, 'moves into processing by itself once applying has run its time', lt.steps[lt.index]);
ok(Math.round((lt.steps[2].fromMs - T0) / 60000) === 23, 'processing starts when applying was due to end');
ok(stepAlert(steps, tapped, m(30)) === null, 'no reminder mid-processing');
ok(stepAlert(steps, tapped, m(47.5))?.kind === 'processing_ending', 'a heads-up in the last minute');
const done = stepAlert(steps, tapped, m(50)); ok(done?.kind === 'processing_done' && done.nextLabel === 'Rinse and finish' && done.nextIndex === 3, 'processing done: come back for the rinse', done);
lt = liveTiming(steps, tapped, m(55))!; ok(steps[lt.index].label === 'Processing' && lt.steps[lt.index].over, 'leaving processing waits for the provider');
ok(stepAlert(steps, { ...tapped, stepStarts: { 1: tapped.stepStarts[1], 3: new Date(m(49)).toISOString() } }, m(50)) === null, 'no reminder once they’ve moved on');
// Not tapped at all: the clock moves it, and the reminder still fires as rinse begins
const clockDone = stepAlert(steps, base, m(46)); ok(clockDone?.kind === 'processing_done' && clockDone.label === 'Processing', 'untapped visits are reminded too', clockDone);
ok(stepAlert(steps, base, m(58)) === null, 'only for a few minutes');
ok(stepAlert(steps, { ...base, status: 'completed' }, m(46)) === null, 'not after the visit');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
