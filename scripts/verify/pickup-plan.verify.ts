// scripts/verify/pickup-plan.verify.ts — the Pickup times screen and its route (Phase C, part 2): who can change it,
// that settings and the pause save on their own paths, that what's saved is what checkout uses, and the screen.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pickup-plan.verify.ts
import fs from 'fs';
import { cleanPlan, pauseEndWords, planFrom, shiftSpans, shiftLookup, noPickupReason } from '../../src/lib/pickup-slots';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };
const read = (p: string) => fs.readFileSync(p, 'utf8');
const tz = 'America/New_York';

// ── words
ok(pauseEndWords('2026-10-30T04:00:00.000Z', tz, '2026-10-29') === 'tomorrow', 'paused for the rest of today reads “until tomorrow”, not “tomorrow 12 am”');
ok(pauseEndWords('2026-10-29T19:30:00.000Z', tz, '2026-10-29') === 'today 3:30 pm', 'a pause for an hour names the time');
ok(noPickupReason(cleanPlan({ hours: { 1: [{ open: '10:00', close: '18:00' }] }, pausedUntil: '2026-10-30T04:00:00.000Z' }), Date.parse('2026-10-29T15:00:00Z'), tz) === 'Online pickup is paused until tomorrow.', 'and customers read the same');

// ── one prep time
ok(planFrom({ prepMinutes: 20, pickupPlan: { prepMinutes: 90 } }).prepMinutes === 20, 'the shared prep time wins over an older plan’s own');
ok(planFrom({ prepMinutes: 0, pickupPlan: { prepMinutes: 90 } }).prepMinutes === 90 && planFrom({}).prepMinutes === 30, 'unset (0) falls back to the older one, else the same 30 minutes the team’s due clock uses');

// ── shifts for the preview (no names leave the server)
const spans = shiftSpans([{ date: '2026-10-29', staffId: 'a', startTime: '10:00', endTime: '18:00' }, { date: '2026-10-29', staffId: 'b', startTime: '14:00', endTime: '20:00', status: 'cancelled' }, { date: '2026-10-29', staffId: 'c', startTime: '09:00', endTime: '12:00', kind: 'leave' }]);
ok(spans.length === 1 && spans[0].staffId === 'a', 'cancelled shifts and leave don’t count as people working');
ok(shiftLookup(spans, tz)(Date.parse('2026-10-29T18:00:00Z'), Date.parse('2026-10-29T19:00:00Z')) === 1, 'one person on through 2–3 pm');

// ── the route
const r = read('src/app/api/retail/pickup-plan/route.ts');
ok(/verifyStaffActor\(req, tenantId\)/.test(r) && /if \(!auth\.actor\?\.isManager\) return NextResponse\.json\(\{ error: 'Only a manager can change pickup times\.' \}, \{ status: 403 \}\)/.test(r), 'the team can look; only managers change it');
ok(/retailSettings\.pickupPlan\.\$\{k\}/.test(r) && /'retailSettings\.pickupPlan\.pausedUntil'/.test(r) && /'retailSettings\.prepMinutes'/.test(r), 'settings, the pause and the shared prep time each on their own path');
ok(/hasOwnProperty\.call\(b\.plan, k\)/.test(r) && /hasOwnProperty\.call\(b\.plan, 'prepMinutes'\)/.test(r) && /FieldValue\.delete\(\)/.test(r), 'only what was sent is written; prep only when changed; an older plan’s own prep removed');
ok(/!plain\(b\.plan\)/.test(r) && /\(f === 'today' \|\| f === 'hour'\) && !hasTimeZone\(tenant\)/.test(r), 'a malformed plan is refused; a pause that ends at a time needs the shop’s time zone');
ok(/patch\['retailSettings\.prepMinutes'\] = planFrom\(tenant\.retailSettings\)\.prepMinutes/.test(r), 'an older plan’s prep time is moved to the shared one, never lost');
ok(/const next = cleanPlan\(b\.plan\)/.test(r), 'what’s saved is checked by the same reader checkout uses');
ok(/f === 'hour' \? new Date\(Date\.now\(\) \+ 60 \* 60e3\)/.test(r) && /startOfDay\(addDays\(todayIn\(tz\), 1\), tz\)/.test(r) && /f === 'keep'/.test(r), 'pause for an hour, the rest of the shop’s day, until turned on, or change only its message; worked out on the server’s clock in the shop’s zone');
ok(/staffId: people\.get\(s\.staffId\)!/.test(r), 'shifts go to the preview as counts, never with names or staff ids');
const srv = read('src/lib/pickup-slots-server.ts');
ok(/planFrom\(tenant\?\.retailSettings/.test(srv) && /const planOf = \(rs: any\) => planFrom\(rs\)/.test(r), 'checkout and the screen read the plan the same way');
ok(/if \(isPaused\(plan, now\)\) return \{ plan, booked: \{\}, view: \{ scheduled: true, windows: \[\]/.test(srv), 'a pause stops online pickup even before hours or a time zone are set');

// ── the screen
const s = read('src/components/orders/PickupTimesScreen.tsx');
ok(/Opening hours for pickup/.test(s) && /Closed days/.test(s) && /Pickup windows/.test(s) && /Online pickup/.test(s) && /What customers see right now/.test(s), 'the five parts of the approved mockup');
ok(/pickupWindows\(plan, now, tz, loaded\.booked, onShift\)/.test(s) && /readyBy\(plan, now, tz, windows\)/.test(s), 'the preview uses the rules checkout uses, with what’s booked and who’s on');
ok(/closing has to be after opening/.test(s) && /disabled=\{!dirty \|\| saving \|\| problems\.length > 0\}/.test(s), 'hours that can’t work are named and stop the save');
ok(/Copy Monday to every weekday/.test(s) && /Add hours/.test(s) && /Close \$\{NAME\[d\]\} for pickup/.test(s), 'hours: copy a day, a second stretch, close a day');
ok(/No shifts on the schedule for/.test(s), 'sizing by who’s working names the days nobody is scheduled');
ok(/reqFor\.current !== tenantId/.test(s) && /loaded\.tenantId !== tenantId/.test(s), 'switching business never saves one shop’s draft into another');
ok(/prepMinutes === saved\.prepMinutes \? rest : draft/.test(s), 'prep time is sent only when changed here');
ok((s.match(/if \(reqFor\.current !== tenantId\) return;/g) || []).length >= 2, 'a save or pause that finishes after a business switch changes nothing on screen');
ok(/\{paused \? \(/.test(s) && /Customers can’t choose pickup until it’s on again/.test(s), 'the preview shows a pause first, whatever else is set');
ok(/windows\.indexOf\(shown\[shown\.length - 1\]\)/.test(s), '“more times” counts only the times after those shown');
ok(/if \(whole\(e\.target\.value\)\)/.test(s) && /beforeunload/.test(s) && /closure\.error/.test(s), 'half-typed times never reach the settings; unsaved changes warn; the closed-day sheet shows its own problem');
ok(/time zone isn’t set/.test(s), 'and warns when the time zone isn’t set');
ok(/\/retail-orders\/policies\/pickup/.test(read('src/app/(app)/retail-orders/settings/page.tsx')), 'Shop settings links to it');
for (const f of ['src/components/orders/PickupTimesScreen.tsx', 'src/app/api/retail/pickup-plan/route.ts']) ok(!/\{\/\*/.test(read(f)), `no JSX comments in ${f}`);

console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
