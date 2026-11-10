// Checks adding many events at once on the planner (a kid's sports season, a class twice a week):
// - A pasted schedule is read line by line: dates in the common forms, times and time ranges with or without am/pm
//   (a guess is marked), what's left as the event's own words; header lines and dates already gone are left out.
// - A calendar file (.ics) is read too, with time zones, all-day events and weekly repeats spread into dates.
// - Repeats: the chosen weekdays, every week or every other week, from the first date through the last.
// - The events saved: one document each, sharing a series; a rename of later ones keeps each one's own words, a new
//   time lands on each one's own day, and only what was changed is changed.
// - The planner saves them in one go (blocks for a team member still go through the block policy, telling the
//   managers once), and opening an event lets you change or delete it and the ones after it.
// Run: TZ=America/New_York npx tsx --tsconfig tsconfig.json scripts/verify/planner-many-events.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return { collection: () => ({}), doc: () => ({ id: 'x' }), writeBatch: () => ({}) };
  if (request === '@/lib/block-submit' || /src\/lib\/block-submit/.test(request)) return { submitCalendarBlock: async (_f: any, _t: any, input: any) => { blockCalls.push(input); return blockAnswer(input); } };
  if (request === '@/lib/staff-notify' || /src\/lib\/staff-notify/.test(request)) return { notifyStaff: async () => {}, managerIds: () => [] };
  return load.call(this, request, ...rest);
};
const src = (p: string) => readFileSync(p, 'utf8');
const blockCalls: any[] = [];
let blockAnswer: (input: any) => any = () => ({ ok: true, outcome: 'created', message: 'Blocked.' });

(async () => {
  process.env.TZ = 'America/New_York';   // the device's clock in these checks
  const S = await import('../../src/lib/event-schedule');
  const E = await import('../../src/lib/event-series');
  const today = '2026-11-09';

  console.log('A pasted schedule');
  const r = S.parseSchedule([
    'Date\tTime\tOpponent\tLocation',
    'Sat, Nov 14\t9:00 AM\tvs. Tigers\tField 3',
    'Tue 11/17 5:30-7:00 PM Practice',
    'Thursday, November 19 5:30 - 7 Practice',
    'November 21, 2026 10:00 AM - 11:30 AM Tournament, Riverside Park',
    '2026-11-28 09:00 Game @ Hawks',
    '12/5 noon Team photos',
    'Dec 12 Holiday party',
    '1/9 6pm Game vs Lions',
    'Oct 1 10am Game played already',
    '14 November 2026 11am - 1pm Bake sale',
    '11/22 11:00-1:00 Picnic',
  ].join('\n'), { today });
  const at = (d: string) => r.rows.filter((x) => x.date === d);
  check('a header line is left out, and a date already played', r.skipped.length === 1 && /Opponent/.test(r.skipped[0]) && r.past === 1, r);
  check('a tab-separated line: date, time and the rest as its words', at('2026-11-14').some((x) => x.start === '09:00' && !x.end && x.label === 'vs. Tigers · Field 3'));
  check('a time range with pm on the end only', at('2026-11-17')[0]?.start === '17:30' && at('2026-11-17')[0]?.end === '19:00' && at('2026-11-17')[0]?.label === 'Practice' && !at('2026-11-17')[0]?.guessed);
  check('no am or pm at all: read as afternoon, and marked to check', at('2026-11-19')[0]?.start === '17:30' && at('2026-11-19')[0]?.end === '19:00' && at('2026-11-19')[0]?.guessed === true);
  check('a written-out date with a year, and a range with am on both', at('2026-11-21')[0]?.start === '10:00' && at('2026-11-21')[0]?.end === '11:30' && at('2026-11-21')[0]?.label === 'Tournament, Riverside Park');
  check('a 24-hour time isn’t a guess', at('2026-11-28')[0]?.start === '09:00' && !at('2026-11-28')[0]?.guessed && at('2026-11-28')[0]?.label === 'Game @ Hawks');
  check('noon', at('2026-12-05')[0]?.start === '12:00' && at('2026-12-05')[0]?.label === 'Team photos');
  check('a date with no time keeps no time (the default is used)', at('2026-12-12')[0]?.start === null && at('2026-12-12')[0]?.label === 'Holiday party');
  check('January, pasted in November, is next year', at('2027-01-09')[0]?.start === '18:00' && at('2027-01-09')[0]?.label === 'Game vs Lions');
  check('day before month, and 11 to 1 runs past noon', at('2026-11-14').some((x) => x.start === '11:00' && x.end === '13:00' && x.label === 'Bake sale') && at('2026-11-22')[0]?.start === '11:00' && at('2026-11-22')[0]?.end === '13:00');
  check('in date and time order', r.rows.map((x) => x.date + (x.start || '')).join() === [...r.rows].map((x) => x.date + (x.start || '')).sort().join());
  check('a date that doesn’t exist isn’t read', S.parseSchedule('2/30 9am Nope', { today }).rows.length === 0);
  const big = S.parseSchedule(Array.from({ length: 230 }, (_, i) => `2027-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')} 9am Game ${i}`).join('\n'), { today });
  check(`no more than ${S.MAX_AT_ONCE} at once, and it says how many were left out`, big.rows.length === S.MAX_AT_ONCE && big.over === 30);

  console.log('A calendar file');
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'SUMMARY:Game vs Tigers', 'DTSTART;TZID=America/Chicago:20261114T090000', 'DTEND;TZID=America/Chicago:20261114T103000', 'LOCATION:Field 3\\, North P', ' ark', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Practice', 'DTSTART:20261117T223000Z', 'DTEND:20261118T000000Z', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6', 'EXDATE:20261126T223000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Tournament', 'DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261206', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Rained out', 'STATUS:CANCELLED', 'DTSTART:20261120T150000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Old', 'DTSTART:20261001T150000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Scrimmage', 'DTSTART:20261212T140000Z', 'DURATION:PT1H30M', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const c = S.parseIcs(ics, { today });
  check('a time in another zone lands on this clock (9 Chicago is 10 New York), with its place (folded line joined)', c.rows[0]?.date === '2026-11-14' && c.rows[0]?.start === '10:00' && c.rows[0]?.end === '11:30' && c.rows[0]?.label === 'Game vs Tigers' && c.rows[0]?.location === 'Field 3, North Park', c.rows[0]);
  const prac = c.rows.filter((x) => x.label === 'Practice').map((x) => x.date);
  check('a weekly repeat is spread into its dates, counting the skipped one', prac.join() === '2026-11-17,2026-11-19,2026-11-24,2026-12-01,2026-12-03' && c.rows.find((x) => x.label === 'Practice')?.start === '17:30', prac);
  check('an all-day event, a canceled one left out, an old one counted as past, a length given as a duration', c.rows.some((x) => x.label === 'Tournament' && x.allDay && x.date === '2026-12-05') && !c.rows.some((x) => x.label === 'Rained out') && c.past === 1
    && c.rows.some((x) => x.label === 'Scrimmage' && x.start === '09:00' && x.end === '10:30'));

  console.log('Repeats');
  check('Tuesdays and Thursdays through a date', S.repeatDates({ from: today, until: '2026-11-26', weekdays: [2, 4] }).join() === '2026-11-10,2026-11-12,2026-11-17,2026-11-19,2026-11-24,2026-11-26');
  check('the first date counts when it’s one of the days', S.repeatDates({ from: '2026-11-10', until: '2026-11-10', weekdays: [2] }).join() === '2026-11-10');
  check('every other week', S.repeatDates({ from: today, until: '2026-12-10', weekdays: [2], everyWeeks: 2 }).join() === '2026-11-10,2026-11-24,2026-12-08');
  check('no days, or a last date before the first: nothing', S.repeatDates({ from: today, until: '2026-12-10', weekdays: [] }).length === 0 && S.repeatDates({ from: today, until: '2026-11-01', weekdays: [1] }).length === 0);

  console.log('The events');
  const occ = S.occurrencesFrom([
    { date: '2026-11-14', start: '09:00', end: null, label: 'vs. Tigers' },
    { date: '2026-11-17', start: '17:30', end: '19:00', label: 'Practice' },
    { date: '2026-11-19', start: null, end: null, label: 'soccer' },
    { date: '2026-12-05', start: null, end: null, label: 'Tournament', allDay: true },
  ], { title: 'Soccer', defaultStart: '17:00', minutes: 90, location: 'Field 3' });
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  check('each date’s own time, or the default length after it', hm(occ[0].startTime) === '09:00' && hm(occ[0].endTime) === '10:30' && hm(occ[1].endTime) === '19:00' && hm(occ[2].startTime) === '17:00');
  check('the name with each date’s own words after it, not twice', occ[0].title === 'Soccer · vs. Tigers' && occ[2].title === 'Soccer' && occ[0].location === 'Field 3');
  check('an all-day date runs the whole day', occ[3].allDay && hm(occ[3].startTime) === '00:00' && hm(occ[3].endTime) === '23:59');

  const input: any = { title: 'Soccer', type: 'personal', staffIds: ['s1'], notes: 'Bring water', location: '', checklist: [{ id: 'c', text: 'Shin guards', completed: true }], allDay: false, occurrences: occ.slice(0, 3), how: 'dates', rowLabels: ['vs. Tigers', 'Practice', 'soccer'] };
  const docs = E.eventDocs(input, { tenantId: 't1', ids: ['a', 'b', 'c'], seriesId: 'ser', nowIso: '2026-11-09T12:00:00Z', by: 'u1' });
  check('one document each, sharing a series, with the name and each one’s own words kept apart', docs.length === 3 && docs.every((d, i) => d.seriesId === 'ser' && d.seriesIndex === i + 1 && d.seriesCount === 3 && d.seriesTitle === 'Soccer' && d.type === 'personal' && d.staffIds[0] === 's1') && docs[0].rowLabel === 'vs. Tigers' && docs[0].title === 'Soccer · vs. Tigers', docs[0]);
  check('each gets its own checklist, not ticked', docs.every((d) => d.checklist.length === 1 && d.checklist[0].completed === false) && new Set(docs.map((d) => d.checklist[0].id)).size === 3);
  check('a single event isn’t a series', !('seriesId' in E.eventDocs({ ...input, occurrences: occ.slice(0, 1), rowLabels: [''] }, { tenantId: 't1', ids: ['a'], seriesId: 'ser', nowIso: 'x' })[0]));

  const series = docs.map((d) => ({ ...d }));
  check('the ones after an event in its series', E.laterInSeries(series, series[0]).map((e) => e.id).join() === 'b,c' && E.laterInSeries(series, series[2]).length === 0 && E.laterInSeries(series, { id: 'z', startTime: series[0].startTime }).length === 0);
  const ups = E.laterUpdates(E.laterInSeries(series, series[0]), { title: 'Fall soccer', startClock: '18:00' });
  const b = ups.find((u) => u.id === 'b')!.patch;
  check('a rename keeps each one’s own words; a new start keeps each one’s length, on its own day', b.title === 'Fall soccer · Practice' && b.seriesTitle === 'Fall soccer' && b.startTime === new Date(2026, 10, 17, 18, 0).toISOString() && b.endTime === new Date(2026, 10, 17, 19, 30).toISOString(), b);
  check('only what was changed', !('type' in b) && !('notes' in b) && !('staffIds' in b) && E.laterUpdates(E.laterInSeries(series, series[0]), {}).length === 0);
  const allDayUp = E.laterUpdates([series[2]], { allDay: true })[0].patch;
  check('made all day: each runs its own whole day', allDayUp.allDay === true && allDayUp.startTime === new Date(2026, 10, 19, 0, 0).toISOString());

  console.log('What the review found');
  const rv = S.parseSchedule([
    'Sat 11/14 Field 3-4 6:00-7:30 pm',
    'Court 1-2 5:30-7 pm 11/17',
    'Sat 11/21 9am (makeup for Oct 31)',
    'Tue 11/24 5.30pm Practice',
    'Sun 11/29 10am vs Sun Devils at',
  ].join('\n'), { today });
  check('a field or court number before the real time range doesn’t hide it', rv.rows[0]?.start === '18:00' && rv.rows[0]?.end === '19:30' && rv.rows[0]?.label === 'Field 3-4' && rv.rows[1]?.start === '17:30' && rv.rows[1]?.end === '19:00', rv.rows.slice(0, 2));
  check('the first date in the line is the one', rv.rows.some((x) => x.date === '2026-11-21' && x.start === '09:00' && /makeup for Oct 31/.test(x.label)));
  check('5.30pm is 5:30 pm', rv.rows.some((x) => x.date === '2026-11-24' && x.start === '17:30' && x.label === 'Practice'));
  check('a weekday beside the date goes; one in the name stays; a dangling “at” goes', rv.rows.some((x) => x.date === '2026-11-29' && x.label === 'vs Sun Devils'), rv.rows.map((x) => x.label));
  check('December’s game pasted in January is last month, not next December', S.parseSchedule('Dec 12 9am Game', { today: '2027-01-20' }).past === 1);
  const rics = S.parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'SUMMARY:Outlook game', 'DTSTART;TZID="(UTC-06:00) Central Time (US & Canada)":20261114T090000', 'DTEND;TZID="(UTC-06:00) Central Time (US & Canada)":20261114T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Windows zone', 'DTSTART;TZID=Pacific Standard Time:20261115T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Mystery zone', 'DTSTART;TZID=Nowhere/Land:20261116T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:With alarm', 'DTSTART:20261117T140000Z', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DURATION:PT5M', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Weekend tournament', 'DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261208', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Monthly meeting', 'DTSTART:20261118T230000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=18', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Chicago weekly', 'DTSTART;TZID=America/Chicago:20261026T170000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Daily since 2024', 'DTSTART:20240101T120000Z', 'RRULE:FREQ=DAILY', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'), { today: '2026-10-20' });
  const one = (l: string) => rics.rows.filter((x) => x.label === l);
  check('an Outlook zone name with a colon in it is read (9 Central is 10 here)', one('Outlook game')[0]?.start === '10:00' && one('Outlook game')[0]?.end === '11:00', one('Outlook game'));
  check('a Windows zone name is known (9 Pacific is noon here)', one('Windows zone')[0]?.start === '12:00');
  check('an unknown zone is read as written and counted, not shifted', one('Mystery zone')[0]?.start === '09:00' && rics.unknownZone === 1);
  check('an alarm’s length isn’t the event’s', one('With alarm')[0]?.start === '09:00' && one('With alarm')[0]?.end === null);
  check('a weekend tournament is a row a day', one('Weekend tournament').map((x) => x.date).join() === '2026-12-05,2026-12-06,2026-12-07' && one('Weekend tournament').every((x) => x.allDay));
  check('a monthly repeat is read once, and said', one('Monthly meeting').length === 1 && rics.onceOnly === 1);
  check('a daily repeat that began long ago still gives the dates ahead (up to the most at once)', one('Daily since 2024').length >= 150 && rics.over > 0);
  const chi = one('Chicago weekly').map((x) => `${x.date} ${x.start}`);
  check('a weekly repeat keeps its own zone’s clock across a clock change (5 pm Chicago is 6 pm here every week)', chi.join() === '2026-10-26 18:00,2026-11-02 18:00,2026-11-09 18:00,2026-11-16 18:00', chi);
  const zones = S.parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'SUMMARY:Paris', 'DTSTART;TZID=Central Europe Standard Time:20261114T150000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Sydney', 'DTSTART;TZID=AUS Eastern Standard Time:20261115T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Phoenix', 'DTSTART;TZID=US Mountain Standard Time:20261116T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Somewhere', 'DTSTART;TZID=Narnia Standard Time:20261117T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Mexico', 'DTSTART;TZID=Central Standard Time (Mexico):20270615T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:US Central', 'DTSTART;TZID="(UTC-06:00) Central Time (US & Canada)":20270615T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:NY daily', 'DTSTART;TZID=America/New_York:20261201T190000', 'RRULE:FREQ=DAILY;UNTIL=20261204T000000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Sydney weekly', 'DTSTART;TZID=Australia/Sydney:20261110T090000', 'RRULE:FREQ=WEEKLY;UNTIL=20261123T220000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'), { today });
  const z = (l: string) => zones.rows.filter((x) => x.label === l);
  check('Outlook zone names land in the right place (Central Europe, Sydney, Arizona), and an unknown one is said', z('Paris')[0]?.start === '09:00' && z('Sydney')[0]?.date === '2026-11-14' && z('Sydney')[0]?.start === '17:00' && z('Phoenix')[0]?.start === '11:00' && z('Somewhere')[0]?.start === '09:00' && zones.unknownZone === 1
    && z('Mexico')[0]?.start === '11:00' && z('US Central')[0]?.start === '10:00', zones.rows);
  check('a repeat’s end (in UTC) ends it at the right one, behind or ahead of UTC', z('NY daily').map((x) => x.date).join() === '2026-12-01,2026-12-02,2026-12-03' && z('Sydney weekly').map((x) => x.date).join() === '2026-11-09,2026-11-16,2026-11-23', { ny: z('NY daily'), syd: z('Sydney weekly') });
  const many = ['BEGIN:VCALENDAR']; for (let k = 0; k < 30; k++) many.push('BEGIN:VEVENT', `SUMMARY:Old weekly ${k}`, 'DTSTART;TZID=America/Chicago:20190107T170000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT'); many.push('END:VCALENDAR');
  const t0 = Date.now(); const slow = S.parseIcs(many.join('\r\n'), { today });
  check('long-running repeats from years ago are quick to read', Date.now() - t0 < 1500 && slow.rows.length === S.MAX_AT_ONCE, Date.now() - t0);
  check('November pasted in January is this coming November', S.parseSchedule('Nov 20 9am Game', { today: '2027-01-20' }).rows[0]?.date === '2027-11-20');
  const wk = S.parseSchedule('Nov 14 (Sat) 9am Game\nNov 15 Sun Devils vs Tigers 10am\nNov 16 Mon: Practice 5pm', { today });
  check('a weekday in brackets or before a colon after the date goes; a team named Sun stays', wk.rows[0]?.label === 'Game' && wk.rows[1]?.label === 'Sun Devils vs Tigers' && wk.rows[2]?.label === 'Practice', wk.rows);

  const bad = S.occurrencesFrom([{ date: '', start: '09:00', end: null, label: 'x' }, { date: '2026-11-30', start: '10:00', end: '09:00', label: 'Backwards' }], { title: 'T', defaultStart: '09:00', minutes: 60 });
  check('a row with no date isn’t an event; one that ends before it starts is marked', bad.length === 1 && bad[0].endFixed === true && bad[0].label === 'Backwards');
  const night = E.laterUpdates([{ id: 'n', startTime: new Date(2026, 10, 20, 21, 0).toISOString(), endTime: new Date(2026, 10, 20, 22, 0).toISOString() }], { startClock: '22:00', endClock: '01:00' })[0].patch;
  check('a later one moved to end after midnight ends the next day', night.endTime === new Date(2026, 10, 21, 1, 0).toISOString());

  const base: any = { title: 'Out', type: 'blocked', staffIds: [], notes: '', location: 'Gym', checklist: [], allDay: false, how: 'dates', rowLabels: ['', ''], occurrences: occ.slice(1, 3) };
  let sr = await E.saveNewEvents({} as any, 't1', base, { by: 'u2', isManager: false, staff: [], events: [] });
  check('a provider can’t block the whole calendar', sr.added === 0 && /Only someone who manages bookings/.test(String(sr.reason)) && blockCalls.length === 0);
  blockCalls.length = 0;
  blockAnswer = (input: any) => (input.events.length >= 1 ? { ok: false, reason: 'That would be over the daily limit.' } : { ok: true, outcome: 'created', message: 'Blocked.' });
  const sameDay = [{ ...occ[1], startTime: new Date(2026, 10, 17, 9), endTime: new Date(2026, 10, 17, 10) }, { ...occ[1], startTime: new Date(2026, 10, 17, 12), endTime: new Date(2026, 10, 17, 13) }];
  sr = await E.saveNewEvents({} as any, 't1', { ...base, staffIds: ['s1'], occurrences: sameDay, checklist: [{ id: 'c', text: 'Keys', completed: false }] }, { by: 'u2', isManager: false, staff: [{ id: 's1', name: 'Jo' }], events: [] });
  check('two blocks on one day count toward the daily limit together, and the refused dates are named', blockCalls.length === 2 && blockCalls[1].events.length === 1 && sr.added === 1 && sr.refused === 1 && /Nov 17/.test(String(sr.reason)), sr);
  check('a block keeps its place and checklist', blockCalls[0].extra.location === 'Field 3' && blockCalls[0].extra.checklist?.[0]?.text === 'Keys' && blockCalls[0].extra.seriesId);

  console.log('On the planner');
  const page = src('src/app/(app)/planner/page.tsx');
  const dlg = src('src/components/planner/EventsDialog.tsx');
  const ser = src('src/lib/event-series.ts');
  check('New event saves everything through one door, and says how many went', /saveNewEvents\(firestore, tenantId, data,/.test(page) && /sent to a manager/.test(page));
  check('blocks for a team member still go through the block policy one date at a time, and the managers hear once', /submitCalendarBlock\(firestore, tenantId, \{/.test(ser) && /quiet: many/.test(ser) && /asked to block time on \$\{requested\} date/.test(ser) && /if \(!input\.quiet\) await notifyStaff/.test(src('src/lib/block-submit.ts')));
  check('opening an event lets you change or delete it, and the ones after it', /<EditEventDialog/.test(page) && /laterUpdates\(later, changed\)/.test(page) && /deleteEvents\(firestore, tenantId, ids\)/.test(page) && /Delete this and the \{delLater\} after/.test(dlg));
  check('only an event saved on the calendar opens (not a lease hold or a maintenance visit drawn on it)', /const raw: any = \(events \|\| \[\]\)\.find\(\(e: any\) => e\.id === selectedEvent\.id\);\n\s+if \(!raw\) return null;/.test(page));
  check('without schedule rights: only your own events, and a block a manager put on you stays', /const mayChange = \(e: any\) => manager \|\| own\(e\);/.test(page) && /e\.type === 'blocked' \? blockManager \|\| \(own\(e\) && e\.requestedBy === uid\)/.test(page) && /readOnly=\{mayChange\(raw\) \? null/.test(page));
  check('a notes-only change leaves the times as they were; a late end runs past midnight', /if \(!timeTouched\) \{ s = safeDate\(event\.startTime\); e = safeDate\(event\.endTime\); \}/.test(dlg) && /if \(e <= s\) e = new Date\(y, mo - 1, d \+ 1, eh, em\);/.test(dlg));
  check('a provider can’t move a block from here', /const locked = !!readOnly \|\| \(event\.type === 'blocked' && !manager\);/.test(dlg));
  check('Once, Repeats and Several dates, with paste and calendar file, and the list shown before saving', /\['once', 'Once'\], \['repeat', 'Repeats'\], \['dates', 'Several dates'\]/.test(dlg) && /Paste a schedule/.test(dlg) && /Import a calendar file/.test(dlg) && /events to add/.test(dlg));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
