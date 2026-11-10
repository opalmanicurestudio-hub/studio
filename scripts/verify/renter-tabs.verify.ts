// Checks the renter page's deeper tabs (components/renters/RenterProfileDrawer, shown inside components/renters/RenterPage)
// are in the new look and only live on that page:
// - No overlay of their own any more (the page draws the header and tabs); white cards, sentence-case titles, no all-caps
//   labels or heavy borders, the palette's colors only, red only on End lease and putting the deposit toward what they owe.
// - Switches and buttons are 44px; dates read as dates (Dec 31, 2026); a card that has to be saved again says so.
// - What each tab does is unchanged: the deposit is recorded on the server, autopay and automatic rent still need the
//   renter's written OK, and charges stay within the business's limits.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-tabs.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const s = readFileSync('src/components/renters/RenterProfileDrawer.tsx', 'utf8');
const jsx = s.slice(s.indexOf('  const body = ('));
check('only on the renter’s page: no overlay or drawer header of its own', !/fixed inset-0/.test(s) && !/PTABS/.test(s) && /\n  return body;\n\}/.test(s));
check('the new look: no all-caps labels, heavy borders or off-palette colors', !/uppercase|font-black|tracking-widest|border-2|emerald|indigo|sky-|violet|slate-|amber-\d|red-\d|bg-foreground|muted-foreground/.test(jsx), (jsx.match(/uppercase|font-black|tracking-widest|border-2|emerald|indigo|sky-|violet|slate-|amber-\d|red-\d|bg-foreground|muted-foreground/g) || []).slice(0, 5));
const colors = new Set((jsx.match(/#[0-9a-f]{6}/gi) || []).map((c) => c.toLowerCase()));
const palette = new Set(['#16171a', '#6d7075', '#ececee', '#f5f5f7', '#1f7a4d', '#b45309', '#fff7ed', '#ecf6f0', '#b42318', '#c9cbd0']);
check('only the palette’s colors', [...colors].every((c) => palette.has(c)), [...colors].filter((c) => !palette.has(c)));
check('red only where it can’t be undone (End lease, putting the deposit toward what they owe)', (jsx.match(/#b42318/g) || []).length === 3 && /onClick=\{onEndLease\} className=\{cn\(RENTALS_BTN, 'text-\[#b42318\]'\)\}/.test(jsx));
check('switches are 44px and say what they are', (jsx.match(/role="switch"/g) || []).length === 2 && (jsx.match(/className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center"/g) || []).length === 2);
check('contact can be reached from the card (call, text, email); switches stand out when off and say what they do; each Open says what it opens', /href=\{`tel:\$\{renter\.phone\}`\}/.test(jsx) && /href=\{`sms:\$\{renter\.phone\}`\}/.test(jsx) && /href=\{`mailto:\$\{renter\.email\}`\}/.test(jsx)
  && !/#d9dadd/.test(jsx) && /aria-describedby="rpd-autopay"/.test(jsx) && /aria-describedby="rpd-collect"/.test(jsx) && (jsx.match(/ariaLabel=\{`/g) || []).length >= 3);
check('End lease from the Details tab says what’s left to settle too', /onLoaded=\{setLeft\}/.test(readFileSync('src/app/(app)/renters/[renterId]/page.tsx', 'utf8')) && /onEndLease=\{\(\) => setEnding\(left \|\| \{\}\)\}/.test(readFileSync('src/app/(app)/renters/[renterId]/page.tsx', 'utf8')));
check('dates read as dates', /const longDay = /.test(s) && /ends \$\{longDay\(lease\.endDate\)\}/.test(jsx) && /valid to \$\{longDay\(d\)\}/.test(jsx));
check('a card that has to be saved again says so (autopay and automatic rent)', /their card has to be saved again in their portal before autopay can use it/.test(jsx) && /save their card again in their portal first/.test(jsx));
check('what the tabs do is unchanged: deposits on the server, the written OK before charging, the charge limits', /fetch\('\/api\/rent\/deposit'/.test(jsx) && (jsx.match(/AUTOPAY_PAPER_OK\(r\.firstName\)/g) || []).length === 2 && /chargeOverCap/.test(jsx) && /disabled=\{!\(chargeCents >= 50\) \|\| !chargeCat \|\| chargeOverCap/.test(jsx));
const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
check('no tool names; no trade words in what people see', !AI.test(s) && !/['"`>][^'"`<\n]*\b(salon|stylist|studio|booth|chair)\b/i.test(jsx.replace(/boothName|booth\?\.name|booth\.name|booth=|\/api\/booths\/|writeBoothAudit|stationBoothId|'booth\.autocollect_'/g, '')));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
