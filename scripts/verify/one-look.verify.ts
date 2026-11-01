// scripts/verify/one-look.verify.ts — The app has one look for every business (no Classic look, no switch between
// looks), the booth no-show fee has a field of its own and can be opened, and the links that went nowhere now land.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/one-look.verify.ts
import fs from 'fs';
import { boothNoShowPolicyOf, hasOldBoothFee, noShowWords } from '../../src/lib/booth-no-show';
import { bookingPolicyLines } from '../../src/lib/policy-copy';
import { derivePolicyLines } from '../../src/lib/voice/knowledge-compiler';
import { SETTINGS_MAP } from '../../src/lib/settings-map';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

// One look
const theme = src('src/components/shared/StudioTheme.tsx');
const home = src('src/components/settings/SettingsHome.tsx');
ok(theme.includes("root.classList.add('studio');") && !theme.includes('appAppearance'), 'the app look is on for every business');
ok(!/appAppearance|AppLook|app-look|Studio or Classic/.test(home), 'Settings has no switch between looks');
ok(!/updateDoc|useFirebase|import React from/.test(home), 'nothing left over from the switch in Settings home');
const all = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? all(`${dir}/${d.name}`) : /\.(tsx?|js)$/.test(d.name) ? [`${dir}/${d.name}`] : []);
ok(all('src').every((f) => !src(f).includes('appAppearance')), 'no code reads or writes the old look choice');

// The booth no-show fee, on its own field
ok(boothNoShowPolicyOf({ boothNoShowPolicy: { enabled: true, feeCents: 2500 } }).feeCents === 2500, 'the booth fee is read from its own field');
ok(boothNoShowPolicyOf({ boothNoShowPolicy: { enabled: true, feeCents: 2500 }, noShowPolicy: 'Missed visits are charged in full.' }).enabled, 'and the booking policy words beside it change nothing');
ok(boothNoShowPolicyOf({ noShowPolicy: { enabled: true, feeCents: 1500 } }).feeCents === 1500, 'a fee the old save left at the shared field is still read');
ok(!boothNoShowPolicyOf({ noShowPolicy: 'Missed visits are charged in full.' }).enabled && boothNoShowPolicyOf({ noShowPolicy: 'x' }).feeCents === 0, 'booking policy words are never read as a booth fee');
ok(boothNoShowPolicyOf({ boothNoShowPolicy: { enabled: true, feeCents: -40 } }).feeCents === 0 && boothNoShowPolicyOf({ boothNoShowPolicy: { feeCents: '12.6' } }).feeCents === 13, 'odd amounts are cleaned up');
ok(boothNoShowPolicyOf(null).enabled === false && boothNoShowPolicyOf(undefined).feeCents === 0, 'no business means no fee');
ok(hasOldBoothFee({ noShowPolicy: { enabled: false } }) && !hasOldBoothFee({ noShowPolicy: 'words' }) && !hasOldBoothFee({}), 'an old fee object at the shared field is spotted');
ok(noShowWords({ noShowPolicy: 'Missed visits are charged.' }) === 'Missed visits are charged.' && noShowWords({ noShowPolicy: { enabled: true } }) === '' && noShowWords(null) === '', 'the booking policy words, only when they are words');

const objT = { noShowPolicy: { enabled: true, feeCents: 2000 }, cancellationPolicy: 'Give us a day.' };
let lines: string[] = []; let threw = false;
try { lines = bookingPolicyLines(objT); } catch { threw = true; }
ok(!threw && !lines.some((l) => /object Object/.test(l)), 'the policy clients read never shows a fee object as words');
threw = false; let voice: string[] = [];
try { voice = derivePolicyLines(objT); } catch { threw = true; }
ok(!threw && !voice.some((l) => /object Object/.test(l)), 'the phone assistant doesn’t trip over a fee object');
ok(derivePolicyLines({ noShowPolicy: 'Missed visits are charged in full.' }).some((l) => l.includes('Missed visits are charged in full.')), 'and still reads the words when they are words');

const booths = src('src/app/(app)/booths/page.tsx');
ok(booths.includes('boothNoShowPolicy: { enabled: noShowEnabled, feeCents }') && !booths.includes('{ noShowPolicy: { enabled'), 'saving the booth fee writes its own field');
ok(booths.includes("...(hasOldBoothFee(selectedTenant) ? { noShowPolicy: deleteField() } : {})"), 'and moves an old fee object off the shared field');
ok(booths.includes('<BoothNoShowRow tenant={selectedTenant} onChange={() => { setAutoSettingsOpen(false); openNoShow(); }} />'), 'the booth fee window opens from booth settings');
ok(booths.includes("setNoShowFee(p.feeCents ? (p.feeCents / 100).toFixed(p.feeCents % 100 ? 2 : 0) : '');"), 'a fee with cents opens with its cents, so saving never rounds it');
ok((booths.match(/openNoShow\(/g) || []).length >= 1 && booths.includes('const openNoShow = () =>'), 'openNoShow is called from somewhere');
ok(src('src/lib/no-show.ts').includes('const p = boothNoShowPolicyOf(t);'), 'the nightly sweep reads the booth fee from its own field');
const entry = SETTINGS_MAP.find((e: any) => e.label === 'No-show fee (booths)') as any;
ok(entry?.href === '/booths?settings=1', 'the settings summary opens booth settings');
ok(/charged \$25/.test(entry.summarise({ boothNoShowPolicy: { enabled: true, feeCents: 2500 }, noShowPolicy: 'words' })), 'and describes the booth fee from its own field');
ok(src('src/components/booking/BookingPolicies.tsx').includes('text: noShowWords(tenant),'), 'the booking page shows the policy words only');
ok(src('src/app/(app)/settings/policies/page.tsx').includes('value={noShowWords(t)}'), 'the policy editor shows the words only');
const pol = src('src/app/(app)/settings/policies/page.tsx');
ok(pol.includes("const keepBoothFee = field === 'noShowPolicy' && hasOldBoothFee(t) && !t.boothNoShowPolicy ? { boothNoShowPolicy: boothNoShowPolicyOf(t) } : {};") && pol.includes('{ [field]: value, ...keepBoothFee }'), 'typing the no-show words over an old booth fee moves the fee to its own field in the same save');
const keep = (t: any) => (hasOldBoothFee(t) && !t.boothNoShowPolicy ? { boothNoShowPolicy: boothNoShowPolicyOf(t) } : {});
ok(JSON.stringify(keep({ noShowPolicy: { enabled: true, feeCents: 2500 } })) === JSON.stringify({ boothNoShowPolicy: { enabled: true, feeCents: 2500 } }) && JSON.stringify(keep({ noShowPolicy: 'words' })) === '{}' && JSON.stringify(keep({ noShowPolicy: { enabled: true, feeCents: 1 }, boothNoShowPolicy: { enabled: false, feeCents: 0 } })) === '{}', 'and only when the fee has nowhere else yet');
ok(src('src/app/(app)/booths/page.tsx').includes('toFixed(feeCents % 100 ? 2 : 0)} charged to card on file') && src('src/app/(app)/booths/page.tsx').includes('toFixed(feeCents % 100 ? 2 : 0)} when a card is on file.'), 'the saved message and the history entry keep the cents');

// Links that went nowhere
ok(src('src/app/(app)/quotes/page.tsx').includes('router.push(`/quotes/${ref.id}`);') && !src('src/app/(app)/quotes/page.tsx').includes('/edit`'), 'a quote made from a template opens the quote (which opens ready to edit)');
ok(fs.existsSync('src/app/(app)/quotes/[id]/page.tsx'), 'and that page exists');
ok(src('src/components/memberships/MembershipLedger.tsx').includes('href="/settings?tab=payments"') && !src('src/components/memberships/MembershipLedger.tsx').includes('tab=integrations'), 'Memberships sends you to payments settings, a tab that exists');
ok(src('src/app/(app)/settings/page.tsx').includes("value: 'payments'"), 'the payments tab is there');
const thread = src('src/app/(app)/messages/[threadId]/page.tsx');
ok(thread.includes("router.push('/team')") && !thread.includes("router.push('/messages')") && !thread.includes("'/inbox'"), 'Back from a staff conversation (direct, group or team) goes to Team, never to client mail');
ok(src('src/app/(app)/messages/team/[threadId]/page.tsx').includes("router.push('/team')"), 'Back from a team conversation goes to Team');
ok(src('src/app/(app)/retail-orders/settings/page.tsx').includes('<Switch aria-label="Tips at checkout" checked={rs.tipsEnabled === true}'), 'the tips switch is named Tips at checkout for screen readers');
ok(src('src/lib/shop-setup.ts').includes("done: liveCount > 0, href: '/inventory' }"), 'Put products online opens Products');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
