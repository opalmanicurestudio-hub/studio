// scripts/verify/pickup-slots.verify.ts — Phase C scheduling (lib/pickup-slots): checkout never offers a pickup time
// the shop can't meet. Hours, closures, prep time, the same-day cutoff, a pause, window capacity (a set number, or by
// who's on shift), and the server counting the window in the same step it writes the order.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pickup-slots.verify.ts
import fs from 'fs';
import { cleanPlan, pickupWindows, readyBy, readyAt, noPickupReason, isPaused, hasHours, windowLabel, windowLabelOn, dayWord } from '../../src/lib/pickup-slots';
import { holdsPlace, peopleThrough, chosenWindow } from '../../src/lib/pickup-slots-server';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } else console.log('  ✓', m); };
const read = (p: string) => fs.readFileSync(p, 'utf8');
const tz = 'America/New_York';
const wk = [{ open: '10:00', close: '18:00' }];
const base = { hours: { 1: wk, 2: wk, 3: wk, 4: wk, 5: wk, 6: [{ open: '10:00', close: '14:00' }] }, windowMinutes: 120, perWindow: 4, prepMinutes: 60, sameDayCutoff: '15:00', daysAhead: 3, closures: [{ from: '2026-10-31', to: '2026-10-31', note: 'Halloween' }] };
const p = cleanPlan(base);
const thu1120 = Date.parse('2026-10-29T15:20:00Z');   // Thu 11:20 am in New York
const ws = pickupWindows(p, thu1120, tz, { '2026-10-29T14:00': 4 });
const keys = ws.map((w) => w.key);

// ── what's offered
ok(!keys.includes('2026-10-29T10:00') && !keys.includes('2026-10-29T12:00'), 'nothing that starts before the order can be ready (an hour’s prep from 11:20)');
ok(keys[0] === '2026-10-29T14:00' && ws[0].full && ws[0].left === 0, 'a full window is listed, marked full');
ok(ws[1].key === '2026-10-29T16:00' && ws[1].left === 4 && ws[1].label === 'Today 4–6 pm', 'open windows say how many places are left, and read naturally');
ok(!keys.some((k) => k.startsWith('2026-10-31')), 'nothing on a closed day');
ok(keys.every((k) => k < '2026-11-01'), 'only the days ahead the shop chose');
ok(ws.every((w) => w.end > w.start), 'every window ends after it starts');
const fri = keys.filter((k) => k.startsWith('2026-10-30'));
ok(fri.join() === ['2026-10-30T10:00', '2026-10-30T12:00', '2026-10-30T14:00', '2026-10-30T16:00'].join(), 'windows run inside opening hours, none spilling past closing');
const late = Date.parse('2026-10-29T19:05:00Z');      // 3:05 pm, past the 3 pm cutoff
ok(!pickupWindows(p, late, tz).some((w) => w.day === '2026-10-29'), 'after the same-day cutoff, today is gone');
ok(readyBy(p, late, tz)?.label === 'Ready tomorrow by 11 am', 'and the earliest is tomorrow, prep counted from opening');
ok(!pickupWindows(p, late, tz).some((w) => Date.parse(w.start) < Date.parse('2026-10-30T15:00:00Z')), 'and no window starts before that ready time (the same answer both ways)');
const thu530 = Date.parse('2026-10-29T21:30:00Z');   // 5:30 pm, half an hour before closing, no cutoff
const nc = cleanPlan({ ...base, sameDayCutoff: null });
ok(readyAt(nc, thu530, tz) === Date.parse('2026-10-30T14:30:00Z'), 'prep left at closing carries on at the next opening (30 min today, 30 tomorrow)');
ok(pickupWindows(nc, thu530, tz)[0].key === '2026-10-30T12:00', 'so the first window is the first that starts after it');
const busyFirst = pickupWindows(p, thu1120, tz, { '2026-10-29T14:00': 4, '2026-10-29T16:00': 4 });
ok(readyBy(p, thu1120, tz, busyFirst)?.label === 'Ready tomorrow by 10 am', 'ready by never names a time whose windows are all full');
ok(readyBy(p, thu1120, tz)?.label === 'Ready today by 12:20 pm', 'ready by: now plus prep, inside the hours');
const sun = Date.parse('2026-11-01T15:00:00Z');
ok(!pickupWindows(p, sun, tz).some((w) => w.day === '2026-11-01'), 'a day with no hours offers nothing');

// ── a pause
const paused = { ...p, pausedUntil: '2026-10-30T14:00:00.000Z', pauseNote: 'Back tomorrow.' };
ok(isPaused(paused, thu1120) && pickupWindows(paused, thu1120, tz).length === 0 && readyBy(paused, thu1120, tz) === null, 'paused: no times at all');
ok(noPickupReason(paused, thu1120, tz) === 'Online pickup is paused until tomorrow 10 am. Back tomorrow.', 'and the customer is told until when, in the shop’s words');
ok(!isPaused(paused, Date.parse('2026-10-30T15:00:00Z')), 'it ends by itself at the time chosen');
ok(isPaused({ ...p, pausedUntil: 'manual' }, thu1120), 'or stays until the shop resumes it');

// ── capacity by who's on shift
const pp = cleanPlan({ ...base, perWindow: 10, perPerson: 3 });
const shift = (s: number, e: number) => (s >= Date.parse('2026-10-29T20:00:00Z') ? 2 : 0);
const sw = pickupWindows(pp, thu1120, tz, {}, shift);
ok(sw.find((w) => w.key === '2026-10-29T14:00')?.full === true, 'nobody on shift: the window is full');
ok(sw.find((w) => w.key === '2026-10-29T16:00')?.left === 6, 'two people on shift, three orders each: six places (under the ten set)');
ok(pickupWindows(cleanPlan({ ...base, perWindow: null }), thu1120, tz)[0].left === null, 'no limit set: never full');

// ── what's saved is cleaned
const messy = cleanPlan({ hours: { 1: [{ open: '18:00', close: '10:00' }, { open: '9:00', close: '12' }] }, windowMinutes: 7, closures: [{ from: 'x' }], sameDayCutoff: '25:00', pausedUntil: 'soon' });
ok(!hasHours(messy) && messy.windowMinutes === 60 && messy.closures.length === 0 && messy.sameDayCutoff === null && messy.pausedUntil === null, 'bad hours, sizes, dates and cutoffs are dropped, never trusted');
ok(pickupWindows(cleanPlan({}), thu1120, tz).length === 0 && readyBy(cleanPlan({}), thu1120, tz) === null, 'a shop with no hours offers no times (checkout stays as before)');
ok(windowLabel(Date.parse('2026-10-30T15:00:00Z'), Date.parse('2026-10-30T17:00:00Z'), tz, '2026-10-29') === 'Tomorrow 11 am–1 pm', 'a window across noon names both halves of the day');
ok(windowLabelOn(Date.parse('2026-10-30T15:00:00Z'), Date.parse('2026-10-30T17:00:00Z'), tz) === 'Fri Oct 30, 11 am–1 pm', 'what the order keeps is named by its date, not “Tomorrow”');
ok(dayWord('2026-11-01', '2026-10-29') === 'Sun Nov 1', 'later days read “Sun Nov 1”');
const mid = pickupWindows(cleanPlan({ ...base, hours: { 4: [{ open: '22:00', close: '24:00' }] }, windowMinutes: 60, sameDayCutoff: null, prepMinutes: 0 }), thu1120, tz);
ok(mid.map((w) => w.label).join() === 'Today 10–11 pm,Today 11 pm–12 am', 'hours can run to midnight');
const dst = pickupWindows(cleanPlan({ hours: { 0: [{ open: '00:00', close: '06:00' }] }, windowMinutes: 60, prepMinutes: 0, daysAhead: 1 }), Date.parse('2026-03-08T04:00:00Z'), tz);
ok(new Set(dst.map((w) => w.key)).size === dst.length && dst.every((w) => w.end > w.start), 'the spring clock change never makes two windows with one key');

// ── who holds a place
ok(holdsPlace({ stage: 'paid' }, thu1120) && !holdsPlace({ stage: 'cancelled' }, thu1120), 'paid orders hold their place; cancelled ones don’t');
ok(holdsPlace({ stage: 'placed', placedAt: new Date(thu1120 - 40 * 60e3).toISOString() }, thu1120) && !holdsPlace({ stage: 'placed', placedAt: new Date(thu1120 - 70 * 60e3).toISOString() }, thu1120), 'a checkout being paid for holds it for an hour (a late payment notice included)');
ok(!holdsPlace({ stage: 'placed', checkoutKeyHash: 'k1', placedAt: new Date(thu1120).toISOString() }, thu1120, 'k1'), 'the same customer trying again doesn’t compete with their own earlier try');
ok(peopleThrough([{ staffId: 'a', start: 540, end: 780 }, { staffId: 'b', start: 780, end: 1020 }], 720, 840) === 1, 'staggered cover (one until 1, one from 1) counts as one person through 12–2');
ok(peopleThrough([], 720, 840) === null, 'a day with no shifts published isn’t sized by people');
ok(peopleThrough([{ staffId: 'a', start: 540, end: 780 }], 720, 840) === 0, 'nobody for part of the window: no one through it');
const cw = chosenWindow({ scheduled: true, windows: ws, readyBy: null, reason: null }, { '2026-10-29T14:00': 4 }, '2026-10-29T16:00') as any;
ok(cw.ok && cw.cap === 4 && !(chosenWindow({ scheduled: true, windows: ws, readyBy: null, reason: null }, {}, '2026-10-29T14:00') as any).ok, 'the chosen window is checked against the same answer, with its whole size');

// ── wired in
const co = read('src/app/api/retail/checkout/route.ts');
ok(/shopPickup\(db, tenantId, tenant, Date\.now\(\), ckeyHash\)/.test(co) && /view\.scheduled/.test(co) && /chosenWindow\(view, booked, key\)/.test(co) && /pickupWindowKey: pickupWin\.key/.test(co) && /windowLabelOn\(/.test(co), 'placing an order checks the chosen window on the server, once, and keeps it by its date');
ok(/tx\.get\(db\.collection\(`tenants\/\$\{tenantId\}\/retailOrders`\)\.where\('pickupWindowKey', '==', win\.key\)\)/.test(co) && /tx\.set\(orderRef/.test(co) && /holdsPlace\(d\.data\(\), Date\.now\(\), ckeyHash\)/.test(co), 'and counts it in the same step it writes the order');
ok(/pickupWindow\?\.start/.test(read('src/lib/retail-orders.ts')) && /pickupWindow\.label/.test(read('src/components/orders/workspace/ShipPane.tsx')), 'the team’s board is due by the window, and shows the time chosen');
ok(/!hasTimeZone\(tenant\)/.test(read('src/lib/pickup-slots-server.ts')), 'a shop with no time zone set gets no times rather than wrong ones');
const api = read('src/app/api/retail/pickup-times/route.ts');
ok(/full: w\.full/.test(api) && !/left: w\.left/.test(api) && /n > 30/.test(api) && /recent\.get\(memo\)/.test(api) && /fresh/.test(api) && /shopPickup\(db, tenantId, t\.data\(\), Date\.now\(\), same\)/.test(api), 'customers see whether a window is full, never how many are left; asks are limited and briefly remembered');
const page = read('src/app/shop/[tenantId]/checkout/page.tsx');
ok(/type="radio" name="pickup-window"/.test(page) && /' · full'/.test(page) && !/windows\.slice\(0, 12\)/.test(page) && /pickupWindowKey: timedPickup/.test(page) && /pickupState === 'ready'\) && \(!timedPickup \|\| !!pickupKey\)/.test(page), 'checkout: every window, by day, as real radio buttons; full ones shown; paying waits for the times and a choice');
ok(/&ck=\$\{encodeURIComponent\(ensureCheckoutKey\(\)\)\}/.test(page) && /'&fresh=1'/.test(page) && /if \(data\.pickupFull\) void loadPickupTimes\(/.test(page) && /Try again/.test(page) && /aria-live="polite"/.test(page), 'a window that filled while paying refreshes the choices and says why; a failed load can be tried again');

console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
