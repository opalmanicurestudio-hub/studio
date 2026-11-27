// Checks Timesheets in the new look (design board "Timesheets and Gusto", A; components/staff/TimesheetsScreen,
// app/(app)/timesheets/page.tsx):
//   What waits before payday, across the whole pay period: forgotten clock-outs (and ones the person asked to fix, with
//   the time they gave), shifts waiting for approval, overtime coming; then each person's week against the schedule.
//   For the owner and anyone whose role approves time; nobody fixes or approves their own hours but the owner.
//   The download is a safe spreadsheet (lib/csv): a name or a note never runs as a formula.
//   Days are the business's own; approvals carry the approver's name on the team, never a sign-in email.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/timesheets-look.verify.ts
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';

const src = (f: string) => fs.readFileSync(f, 'utf8');

(async () => {
  const S = await import('../../src/components/staff/TimesheetsScreen');
  const CSV = await import('../../src/lib/csv');
  const screen = src('src/components/staff/TimesheetsScreen.tsx'), page = src('src/app/(app)/timesheets/page.tsx');

  console.log('in words');
  check('hours and minutes', S.hm(522) === '8h 42m' && S.hm(600) === '10h' && S.hm(45) === '45m' && S.hm(-5) === '0m');
  check('hours for a week', S.hoursWords(2280) === '38 hours' && S.hoursWords(60) === '1 hour' && S.hoursWords(1770) === '29.5 hours');
  check('the week', S.weekWords('2026-11-16', '2026-11-22', new Date(2026, 10, 19)) === 'November 16 to 22' && S.weekWords('2026-11-30', '2026-12-06', new Date(2026, 10, 19)) === 'November 30 to December 6'
    && S.weekWords('2026-12-28', '2027-01-03', new Date(2026, 10, 19)) === 'December 28 to January 3, 2027');
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const shift: any = { key: 'k', dayKey: '2026-11-16', inAt: new Date(2026, 10, 16, 8, 0), outAt: new Date(2026, 10, 16, 17, 12), breakMinutes: 30, paidBreakMinutes: 0, workedMinutes: 522, status: 'approved', missingOut: false };
  check('a shift', S.shiftWords(shift, t) === 'Monday, 8:00 AM to 5:12 PM, a 30 minute break' && S.shiftWords({ ...shift, outAt: null, missingOut: true, breakMinutes: 0 }, t) === 'Monday, 8:00 AM to no clock-out', S.shiftWords(shift, t));

  console.log('the screen');
  check('before payday: forgotten clock-outs, ones they asked to fix (with the time they gave, approve or send back with why), shifts waiting, overtime coming',
    /Before payday/.test(screen) && /forgot to clock out on/.test(screen) && /says they left at/.test(screen) && /Send it back/.test(screen) && /Why not \(they’ll see this\)/.test(screen)
    && /shifts`\} waiting for approval/.test(screen) && /Approve both/.test(screen) && /is on track for \$\{hoursWords\(o\.projected\)\} of overtime/.test(screen) && /Nothing waits for you: every shift is approved\./.test(screen));
  check('each person: hours against the schedule, what needs them, the days, and each shift with what it needs',
    /of \$\{hoursWords\(x\.scheduledMinutes\)\} scheduled/.test(screen) && /to fix`/.test(screen) && /waiting`/.test(screen) && /All approved/.test(screen)
    && /No clock-out/.test(screen) && /No clock-in/.test(screen) && /planned/.test(screen) && /Clocked in away from the business/.test(screen) && /Add the clock-out/.test(screen) && /Look at it/.test(screen));
  check('a contractor is shown as one, paid what they worked with no overtime', />Contractor</.test(screen) && /Paid what they worked, with no overtime/.test(screen) && /overtimeMinutes: contractor \? 0 :/.test(page));
  check('a shift opened: look it over and approve it (or not, with why), or change its times; a shift with no clock-out asks for it first',
    /Look over the shift, then approve it\./.test(screen) && /A note \(needed if you don’t approve it\)/.test(screen) && /disabled=\{busy \|\| !note\.trim\(\)\}/.test(screen)
    && /Change the times/.test(screen) && /A clock-out before the clock-in is the next morning\./.test(screen) && /!shift\.missingOut && <button type="button" onClick=\{onApprove\}/.test(screen));
  check('the house style: no shouting labels, no dots between words, 44px targets, the palette',
    !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(screen + page) && /min-h-\[44px\]/.test(screen) && /#1f7a4d/.test(screen) && /#b45309/.test(screen));

  console.log('the page');
  check('for the owner and anyone whose role approves time', /if \(!can\('time\.approve'\)\) \{/.test(page) && /Fixing and approving hours is for the owner and people whose role includes it\./.test(page));
  check('what waits looks across the whole pay period the week is in; the week and its days are the business’s own',
    /const period = useMemo\(\(\) => periodOf\(tenant, weekFrom\)/.test(page) && /const inPeriod = all\.filter\(\(x\) => x\.localDate >= period\.from && x\.localDate <= period\.to\)/.test(page)
    && /const today = localDay\(Date\.now\(\), bizTz\);/.test(page) && /const thisWeek = weekOf\(today, wso\);/.test(page) && /zonedEpoch\(spanFrom, '00:00', bizTz\)/.test(page));
  check('nobody fixes or approves their own hours but the owner (as the rules and the clock fix say)', /\(isOwner \|\| !selfId \|\| x\.staffId !== selfId\)/.test(page) && /fixesAll\.filter\(\(f\) => isOwner \|\| !selfId \|\| f\.staffId !== selfId\)/.test(page));
  check('approvals carry the approver’s name on the team, never a sign-in email', /never their sign-in email/.test(page) && !/u\?\.email/.test(page) && /approvedBy: who\.name/.test(page));
  check('the download is a safe spreadsheet', /downloadCsv\(csvName\(String\(tenant\.name \|\| ''\), 'hours', weekFrom\), rows\)/.test(page) && !/rows\.map\(r => r\.join\(','\)\)/.test(page)
    && CSV.toCsv([['=SUM(A1)', '-x', '+1', 'Ana, "Jo"']]).includes(`'=SUM(A1),'-x,'+1,"Ana, ""Jo"""`));
  check('the old card and its shouting are gone', !fs.existsSync('src/components/staff/ClockFixReview.tsx') && !/Access Restricted|Pay Week|Weekly review/.test(page));

  console.log('a clock fix decided by a role that approves time');
  const CF = await import('../../src/lib/clock-fix');
  const db = makeDb(); await db.doc('tenants/t1').set({ timezone: 'America/New_York' });
  await db.doc('tenants/t1/clockFixes/in1').set({ id: 'in1', staffId: 's2', staffName: 'Kim', inAt: '2026-11-17T14:58:00.000Z', outAt: '2026-11-17T23:00:00.000Z', status: 'pending' });
  const lead: any = { staffId: 's9', name: 'Lee', role: 'shift_lead', isManager: false, isOwner: false, portal: false, caps: ['time.approve'] };
  const r: any = await CF.decideFix(db, 't1', lead, 'in1', false, { note: 'Please talk to me' });
  const r2: any = await CF.decideFix(db, 't1', { ...lead, caps: [] }, 'in1', false, {});
  check('a shift lead who approves time can decide it; someone without it can’t', r.ok === true && r2.ok === false, [r, r2]);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
