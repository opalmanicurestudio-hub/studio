// scripts/verify/visit-link.verify.ts — the client's visit link in the booking page's look (Booking page step 5b,
// ClientVisit board): the business's header, color and mood on every screen; "See you at 3:30" with the one next thing
// to do; getting here from the business's own notes; until when a change is free; checked in, finished and all set;
// every time on the business's clock; and the smaller pieces (rebook, wallet, verify, messages) in the mood's colors.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/visit-link.verify.tsx
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { wallDate } from '../../src/lib/tenant-time';
import { freeUntilWords } from '../../src/lib/policy-copy';
import { brandOf, VisitFooter } from '../../src/components/booking/VisitShell';
import { DayOfView } from '../../src/components/booking/DayOfView';
import { TooEarlyView, CheckedInView, CompletedView, AllSetView, VisitNotFound, dayWords } from '../../src/components/visit/VisitStages';

// The app's components rely on the automatic JSX runtime; here they're rendered with React on hand.
(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const text = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const tenant: any = { name: 'Opal Manicure Studio', timezone: 'America/Chicago', cancellationWindowHours: 24, logoUrl: '', phone: '(512) 555-0142',
  bookingPageSettings: { design: 'studio', studio: { color: '#8b5e57', mood: 'night', visit: { parking: 'Lot behind the building.', entrance: 'Blue door.', video: 'javascript:alert(1)' } } } };
const brand = brandOf(tenant, 't1', 's1');
const inMin = (m: number) => new Date(Date.now() + m * 60000).toISOString();
const chicago = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...o }).format(new Date(iso));
const noop = async () => ({ ok: true });
const day = (p: any = {}) => text(html(<DayOfView brand={brand} first="Dana" serviceName="Gel manicure" startTime={inMin(120)} minutesAway={120} provider={{ name: 'Maya Brooks' }} address="1420 Elm St, Austin"
  graceMinutes={10} onArrived={noop} onMyWay={noop} onLate={noop} onReschedule={() => {}} onCancel={() => {}} onMessage={() => {}} trip={{ tenantId: 't1', token: 'k', appointmentId: 'a' }}
  visit={tenant.bookingPageSettings.studio.visit} freeUntil={freeUntilWords(tenant, null, inMin(120))} {...p} />));

(async () => {
  // ── The business's look and clock ───────────────────────────────────────
  ok(brand.mood === 'night' && brand.accent === '#8b5e57' && brand.zone === 'America/Chicago' && brand.bookHref === '/book/t1?service=s1', 'every screen gets the business’s color, mood, booking link and time zone');
  ok(brandOf({ name: 'X' }).zone === null, 'a business without a time zone keeps the phone’s own clock');
  const at = new Date('2026-11-05T21:30:00Z');
  const w = wallDate(at, 'America/Chicago');
  ok(w.getHours() === 15 && w.getMinutes() === 30 && w.getDate() === 5, 'a time is shown on the business’s clock (3:30 PM in Chicago), wherever the phone is');
  ok(wallDate(at, null).getTime() === at.getTime() && wallDate(at, 'Not/AZone').getTime() === at.getTime(), 'no zone, or a broken one, leaves the time as it is');
  const now = new Date(2026, 10, 2, 9, 0);
  ok(dayWords(new Date(2026, 10, 2, 15, 30), now) === 'today' && dayWords(new Date(2026, 10, 3, 8), now) === 'tomorrow' && dayWords(new Date(2026, 10, 6, 8), now) === 'Friday' && dayWords(new Date(2026, 10, 19, 8), now) === 'Thu, Nov 19', 'the day is said simply: today, tomorrow, Friday, then the date');

  // ── On the day ──────────────────────────────────────────────────────────
  const d0 = day();
  ok(d0.includes('Hi Dana') && d0.includes(`See you at ${chicago(inMin(120), { hour: 'numeric', minute: '2-digit' }).replace(/ (AM|PM)$/, '')}`) && d0.includes('Gel manicure · with Maya · in 2 hours'), 'the day: “Hi Dana”, “See you at …” on the business’s clock, and what, with whom and how soon');
  ok(d0.includes('Opal Manicure Studio') && d0.includes('Today'), 'the booking page’s header: the business’s name and where the visit is up to');
  ok(d0.includes('I’m on my way') && d0.includes('Running a few minutes late') && d0.includes('Already here? Check in') && !/>\s*I’m here\s*</.test(html(<DayOfView brand={brand} first="D" graceMinutes={0} minutesAway={120} onArrived={noop} onMyWay={noop} onLate={noop} trip={null} />)), 'hours away: “I’m on my way” leads, with running late and “Already here? Check in”');
  const near = html(<DayOfView brand={brand} first="D" graceMinutes={0} minutesAway={15} onArrived={noop} onMyWay={noop} onLate={noop} trip={null} />);
  ok(/v-btn-good[^>]*>I’m here</.test(near) && !text(near).includes('I’m on my way'), 'close to the time: “I’m here”, in green');
  ok(/v-btn-good[^>]*>I’m here</.test(html(<DayOfView brand={brand} first="D" graceMinutes={0} minutesAway={90} status="on_my_way" onArrived={noop} onMyWay={noop} onLate={noop} trip={null} />)), 'once they’ve said they’re on the way, “I’m here” leads');
  const desk = day({ selfCheckIn: false });
  ok(desk.includes('front desk') && desk.includes('I’m on my way') && !desk.includes('Already here? Check in'), 'check-in at the desk only: on my way, then the front desk');
  ok(day({ place: { kind: 'online', meetingLink: 'https://meet.example.com/x' } }).includes('Join your appointment') && !day({ place: { kind: 'online', meetingLink: 'https://m' } }).includes('Getting here'), 'online: join the appointment, no getting here or pass');
  ok(day({ place: { kind: 'phone', phoneWho: 'they_call' }, callNumber: '(512) 555-0142' }).includes('Call (512) 555-0142'), 'a phone appointment they call in to: the number to call');
  ok(day({ status: 'running_late', lateMinutes: 10 }).includes('On your way') && day({ status: 'running_late', lateMinutes: 10 }).includes('about 10 minutes late'), 'running late: remembered, and the team knows');
  ok(day({ reply: { kind: 'move', message: 'Could we move you?' } }).includes('Needs you') && day({ reply: { kind: 'move', message: 'x' } }).includes('Choose a new time') && !day({ reply: { kind: 'move', message: 'x' } }).includes('I’m on my way'), 'asked to move: “Needs you”, and choosing a new time comes first');
  const gh = html(<DayOfView brand={brand} first="D" graceMinutes={0} minutesAway={120} onArrived={noop} onMyWay={noop} onLate={noop} trip={null} address="1420 Elm St" visit={tenant.bookingPageSettings.studio.visit} />);
  ok(text(gh).includes('Getting here') && text(gh).includes('Lot behind the building.') && text(gh).includes('Blue door.') && gh.includes('google.com/maps/dir'), 'getting here: the address with directions, parking and the way in, in the business’s words');
  ok(!gh.includes('javascript:') && !text(gh).includes('Watch the way in'), 'a way-in video that isn’t a web address is never linked');
  ok(d0.includes('Change or cancel') && d0.includes('Change the time') && /free until (Mon|Tue|Wed|Thu|Fri|Sat|Sun|today|tomorrow)/.test(d0) === false && d0.includes('counts as late'), 'inside the window: change or cancel says it now counts as late');
  const far = day({ freeUntil: freeUntilWords(tenant, null, inMin(3 * 1440)) });
  ok(/Change or cancel · free until \w+/.test(far), 'further out: “free until …” beside Change or cancel');
  ok(!text(html(<DayOfView brand={brand} first="D" graceMinutes={0} onArrived={noop} onMyWay={noop} onLate={noop} trip={null} />)).includes('Change or cancel'), 'nothing to change: no Change or cancel group');
  ok(d0.includes('Message us') && d0.includes('Share my trip'), 'message us and trip sharing stay');

  // ── Before the day ──────────────────────────────────────────────────────
  const early = text(html(<TooEarlyView brand={brand} first="Dana" startTime={inMin(3 * 1440)} serviceName="Gel manicure" providerName="Maya" onReschedule={() => {}} onCancel={() => {}} onMessage={() => {}} calendarUrl="/c" address="1420 Elm St" visit={tenant.bookingPageSettings.studio.visit} freeUntil={freeUntilWords(tenant, null, inMin(3 * 1440))} sooner={{ tenantId: 't1', token: 'k', on: false }} />));
  ok(early.includes('Booked') && /See you \w+ at/.test(early) && early.includes('in 3 days') && early.includes('Add to my calendar') && early.includes('Come in sooner?') && early.includes('Getting here') && /free until/.test(early), 'before the day: “See you Thursday at …”, calendar, come in sooner, getting here, and until when it’s free');
  const dis = text(html(<TooEarlyView brand={brand} startTime={inMin(3 * 1440)} disruption={{ kind: 'callout', status: 'pending' }} onDisruptionCancel={noop as any} />));
  ok(dis.includes('About your appointment') && !dis.includes('You’re all set'), 'a disruption waiting on them replaces “you’re all set”');

  // ── Checked in, all set, finished ───────────────────────────────────────
  const inn = text(html(<CheckedInView brand={brand} inService={false} who="Maya Brooks" startTime={inMin(12)} serviceName="Gel manicure" businessName="Opal Manicure Studio" phone="(512) 555-0142" wifi={{ network: 'Opal Guest', password: 'shiny' }} onMessage={() => {}} />));
  ok(inn.includes('Checked in') && inn.includes('You’re checked in') && /Maya knows you’re here and will be with you in about 1[12] minutes/.test(inn), 'checked in: who knows they’re here, and about when');
  ok(inn.includes('Wi-Fi') && inn.includes('Opal Guest') && inn.includes('shiny') && inn.includes('Copy') && inn.includes('Call Opal Manicure Studio') && !/call us/i.test(inn), 'the Wi-Fi with a copy button, and calling the business by name');
  ok(text(html(<CheckedInView brand={brand} inService who="Maya" />)).includes('You’re all set') && text(html(<CheckedInView brand={brand} inService who="Maya" />)).includes('In progress'), 'in service: all set, in progress');
  ok(text(html(<AllSetView brand={brand} startTime={inMin(3 * 1440)} businessName="Opal" />)).includes('You’re all set'), 'finished the booking’s steps on another day: all set, see you then');
  const doneHtml = html(<CompletedView brand={brand} tenant={{ id: 't1' }} client={{ name: 'Dana Reyes' }} service={{ name: 'Gel manicure' }} appointment={{ id: 'a1', startTime: inMin(-120), staffName: 'Maya Brooks' }} />);
  ok(text(doneHtml).includes('How was your visit?') && (doneHtml.match(/role="radio"/g) || []).length === 5 && text(doneHtml).includes('Send') && text(doneHtml).includes('Done'), 'finished: “How was your visit?”, five stars, a note and Send');
  ok(text(html(<CompletedView brand={brand} tenant={{}} client={{ name: 'Dana' }} service={null} appointment={{ id: 'a', reviewSubmittedAt: 'x' }} />)).includes('Thanks, Dana'), 'once reviewed: “Thanks, Dana”');
  ok(text(html(<VisitNotFound />)).includes('This link isn’t working') && !text(html(<VisitNotFound />)).match(/manifest|digital key|Record Expired/i), 'a link that opens nothing says so plainly');
  ok(text(html(<VisitFooter.Provider value={<p>FOOTNOTE</p>}><AllSetView brand={brand} /></VisitFooter.Provider>)).includes('FOOTNOTE'), 'the foot of each screen (“Not you?”) sits inside the screen, in its look');

  // ── The page and the smaller pieces ─────────────────────────────────────
  const page = src('src/app/check-in/[token]/page.tsx');
  ok(page.includes('VisitFooter.Provider') && !page.includes("background: '#ffffff'") && !page.includes('Initializing Studio Pulse') && !page.includes('Record Expired') && !page.includes("You're All Set"), 'the page: no white footer band, no old loading, not-found or all-set screens');
  ok(page.includes('<CheckedInView') && page.includes('<TooEarlyView') && page.includes('<CompletedView') && page.includes('<AllSetView') && page.includes('freeUntil={freeUntil}') && page.includes('brand={brandOf(tenant, tenantId'), 'the page shows each stage in the business’s look');
  ok(!/const (TooEarlyView|CompletedView|ComeInSooner) =/.test(page), 'the stages live in one place (VisitStages)');
  const parts = ['src/components/visit/VisitRebook.tsx', 'src/components/visit/VisitTimeline.tsx', 'src/components/visit/ReferralCard.tsx', 'src/components/visit/VerifyCard.tsx', 'src/components/booking/DisruptionCard.tsx', 'src/components/booking/ClientNotifyCard.tsx', 'src/components/booking/VisitMessages.tsx', 'src/components/booking/DayOfView.tsx', 'src/components/visit/VisitStages.tsx', 'src/components/referrals/CircleMember.tsx', 'src/components/referrals/CreatorCampaigns.tsx'];
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2728}\u{2B50}]/u;
  ok(parts.every((p) => !emoji.test(src(p))), 'no emojis on the visit link');
  ok(parts.every((p) => !/bg-white|#f1ece6|#e7e2dc|#ebe5de|#6b645c|text-stone-/.test(src(p).replace(/rounded-full bg-white transition-all|rounded-full bg-white shadow-sm transition-all/g, ''))), 'no fixed light colors in the visit pieces: Night reads as Night');
  ok(parts.every((p) => !/color: '#b42318' }}>\{(err|loadErr|msg)/.test(src(p))) && src('src/components/visit/VerifyCard.tsx').includes("const ErrorLine = ({ text }: { text: string }) => text ? <p className=\"text-[14px]\" role=\"alert\" style={{ color: WARN }}"), 'errors are amber; red is only for destructive actions');
  ok(!src('src/components/booking/VisitMessages.tsx').includes("background: 'var(--ink"), 'their own messages are in the business’s color, readable on Night');
  const rb = src('src/components/visit/VisitRebook.tsx');
  ok(rb.includes("wrap('Book again'") && rb.includes('Other times') && rb.includes('onClick={() => pick(sl)}') && rb.includes('const oneTap = deposit === 0 && !rb.standing'), 'book again leads with the best time; a time picked from a list is confirmed before it books');
  const tool = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok([...parts, 'src/components/booking/VisitShell.tsx', 'src/app/check-in/[token]/page.tsx', 'src/lib/tenant-time.ts'].every((p) => !tool.test(src(p))), 'no tool names anywhere in the visit link');

  // ── Review fixes ────────────────────────────────────────────────────────
  ok(freeUntilWords({ name: 'X' }, null, inMin(3 * 1440)).startsWith('free until') && freeUntilWords({ name: 'X' }, null, inMin(20 * 60)) === 'late', 'free until uses the window the server enforces (24 hours unless set)');
  const noZone = freeUntilWords({ name: 'X' }, null, '2026-11-20T15:30:00-05:00', new Date('2026-11-02T12:00:00-05:00'));
  ok(noZone.endsWith(new Date('2026-11-19T15:30:00-05:00').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })), 'a business without a zone: free until is on the phone’s clock, like the rest of the screen');
  ok(freeUntilWords({ name: 'X', cancellationPolicy: 'Our words' }, null, inMin(3 * 1440)) === '', 'a business with its own written policy: its words, not ours');
  ok(page.includes('deadlineStart(tenant, appointmentData, service)'), 'free until counts from the original time when the business says a moved booking does');
  ok(page.includes('!isSameDay(wallDate(safeDate(appointmentData.startTime), dayZone), wallDate(new Date(), dayZone))'), 'whether it’s the day is decided on the business’s clock');
  const us = page.slice(page.indexOf('const updateStatus'), page.indexOf('// ── "Is this you?"'));
  ok(!us.includes('toast(') && us.includes("return failed(") && src('src/components/booking/DayOfView.tsx').includes("{actErr && !lateOpen && <p") && src('src/components/booking/DayOfView.tsx').includes("}}>Let them know</VisitButton>\n                {actErr && <p"), 'check-in, on my way and running late: a failure is said on the screen, in amber, never a red pop-up');
  ok(!day({ minutesAway: -60, startTime: inMin(-60) }).includes('starting now') && day({ minutesAway: -2, startTime: inMin(-2) }).includes('starting now'), 'an hour past the start doesn’t say “starting now”');
  ok(src('src/components/referrals/CircleMember.tsx').includes("qrSvg(link, 200, '#16171a')"), 'the share QR is drawn in solid ink, scannable in every mood');
  ok(src('src/components/public/kit.tsx').includes('[style*="background: var(--accent,"]') && src('src/components/booking/VisitShell.tsx').includes('.v-pill[aria-pressed=true],.v-mark'), 'on Night, buttons and chosen pills in the business color keep a ring, even in a dark color');
  ok(page.includes('chip="Canceled"') && !/<b>cancelled<\/b>|is cancelled|Cancelling…/.test(page + src('src/components/booking/DayOfView.tsx') + src('src/components/booking/DisruptionCard.tsx')), 'US spelling: canceled, canceling');
  ok(!/uppercase/.test(src('src/components/referrals/CircleMember.tsx') + src('src/components/referrals/CreatorCampaigns.tsx') + src('src/components/booking/VisitHero.tsx').split('export function PassCode')[0]), 'no all-caps labels in the wallet’s circle and campaigns or the visit hero');

  const dv = src('src/components/booking/DayOfView.tsx');
  ok(dv.indexOf('const d: any = await onArrived()') < dv.indexOf('if (sharing) await stopTrip(true); };'), 'trip sharing stops only once check-in has gone through');
  ok(src('src/components/visit/ReferralCard.tsx').includes('style={{ backgroundColor: f.step >= 4 ? GREEN : ACCENT }}'), 'the friends’ progress bars aren’t given a button’s ring on Night');
  if (bad) { console.error(`\n${bad} failed`); process.exit(1); }
  console.log('\nvisit link: all good');
})();
