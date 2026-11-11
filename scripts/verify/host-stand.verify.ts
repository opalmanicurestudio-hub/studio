// Checks the host stand's new look (L19): app/(app)/host. The seating logic underneath is unchanged (lib/hosting,
// lib/hosting-sessions, their own checks); this is the screen.
// - At a glance: seated of seats, waiting, booked still to come, and when the next free table is.
// - Every table says what it is now: free, held for whom and when, who's seated and for how long, or over.
// - Seating: tap Seat on someone waiting or booked (walk-ins from the kiosk, event guests and day bookings shown here
//   too, not only parties made on this screen), then a table that fits; tables that don't fit are dimmed.
// - A seated table opens their tab, or frees the table when they've left. Texting someone their table is ready.
// - Adding a party: name, how many with a stepper, a time only if they're coming later, a number for the ready text.
// - Writing rules and tap sizes.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/host-stand.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const page = readFileSync('src/app/(app)/host/page.tsx', 'utf8');
const render = page.slice(page.indexOf('  return (\n    <div className="min-h-dvh'));

check('the numbers that matter at a glance', ["'Seated'", "'Waiting'", "'Booked still to come'", '`Next free ${V.unit} for 2`'].every((x) => render.includes(x)) && /quoteWait\(units, seatedGuests, seatedRows, \{ id: '__next', size: 2/.test(page));
check('every table says what it is now', ["'Free'", '`Held${holder', 'seated ${m} min', 'More than it'].every((x) => render.includes(x)));
check('anyone waiting or booked can be seated, kiosk walk-ins and event guests too (not only parties made here)', /const sel = \[\.\.\.parties, \.\.\.mirrored, \.\.\.mirroredExpected\]\.find/.test(page) && /seatAt\(sel, t\.tableId/.test(render));
check('…seating someone from the kiosk line or an event keeps the choice on them once they’re added here (so “seat anyway” works on a second tap), and an earlier tap’s copy is reused, never doubled',
  /if \(carried\) party = carried;[\s\S]{0,260}addDoc\(collection\(firestore, `tenants\/\$\{tenantId\}\/parties`\), body\)[\s\S]{0,120}setSelected\(party\.id\)/.test(page));
check('…a party that didn’t save says so, and the sheet stays open', /if \(!added\) \{ toast\(\{ variant: 'destructive', title: 'That didn’t save\. Try again\.' \}\); return false; \}/.test(page) && /if \(ok\) setAdding\(false\)/.test(render));
check('…tables that don’t fit are dimmed while choosing, and choosing can be canceled', /opacity: fits \? 1 : 0\.5/.test(render) && />Cancel</.test(render));
check('a seated table opens its tab, or frees it when they’ve left', render.includes('Open their tab') && render.includes('They’ve left, free the') && /finishParty\(openParty\)/.test(render));
check('texting someone their table is ready (never for a kiosk walk-in, whose line texts them itself)', /p\.status === 'waiting' && !p\.id\.startsWith\('walkin:'\) && <button[^>]*onClick=\{\(\) => notifyParty\(p\)\}/.test(render));
check('adding a party: a stepper for how many, a time only for later, a number for the text', render.includes('aria-label="One fewer"') && render.includes('aria-label="One more"') && render.includes('type="time"') && render.includes('type="tel"') && render.includes('Add to the waiting list'));
const strings = (render.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]+</g) || []).join('\n');
const bad = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
check('writing rules: no all-caps, no font-black, no emoji or check marks, no JSX comments, no business-type words, no tool names', !/\buppercase\b|font-black|tracking-widest/.test(render) && !/[\u{1F300}-\u{1FAFF}✓✔✅]/u.test(render)
  && !/\{\/\*/.test(render) && !/\b(studio|salon|stylist|booth|chair)s?\b/i.test(strings) && !new RegExp(bad.join('|'), 'i').test(page), strings.match(/\b(studio|salon|stylist|booth|chair)s?\b/gi));
check('buttons are 44px or more', /const BTN = `min-h-\[44px\]/.test(page) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(render) && /min-h-\[96px\]/.test(render));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
