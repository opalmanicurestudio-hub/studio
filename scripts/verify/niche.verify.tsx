// scripts/verify/niche.verify.tsx — WHAT KIND OF BUSINESS. Worked out from what the business has told the app (or chosen
// in Settings), and used so examples, quick picks and tools fit it: the nail guide only where nails are done, care
// notes that suit the work (and never hiding what's saved), a visit note to start from, and no nail wording in
// messages and examples every business sees.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/niche.verify.tsx
import fs from 'fs';
import { nicheOf, nicheChosen, chosenNiche, markupToolsHidden, careSetsFor, prepNoteFor } from '../../src/lib/niche';
import { suggestMenu } from '../../src/lib/starter-menus';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

// ── worked out, or chosen
const cases: [any, string][] = [
  [{ businessType: 'salon', name: 'Opal Manicure Studio' }, 'nails'], [{ name: 'Fade Kings Barber' }, 'barber'], [{ businessType: 'salon', name: 'Curl Studio' }, 'hair'],
  [{ businessType: 'other', name: 'Glow Med Spa' }, 'medspa'], [{ businessType: 'fitness', name: 'Iron Works' }, 'fitness'], [{ businessType: 'hospitality', name: 'Bean Café' }, 'hospitality'],
  [{ businessType: 'salon', name: 'Studio Nine' }, 'beauty'], [{ businessType: 'other', name: 'Acme' }, 'general'], [{ businessType: 'salon', name: 'Brow Bar' }, 'lash'],
  [{ businessType: 'tattoo', name: 'Ink House' }, 'tattoo'], [{ businessType: 'shop', name: 'Corner' }, 'shop'],
  [{ businessType: 'salon', name: 'Beauty Bar' }, 'beauty'], [{ businessType: 'salon', name: 'Polish Bar' }, 'beauty'], [{ businessType: 'salon', name: 'Lux Lash & Nail Bar' }, 'nails'],
  [{ businessType: 'salon', name: 'Opal Nails', movingIn: { starterMenu: 'hair' } }, 'nails'], [{ businessType: 'other', name: 'Bean & Bar Café' }, 'hospitality'],
  [{ businessType: 'other', name: 'Café Luna' }, 'hospitality'], [{ businessType: 'salon', name: 'Blow Dry Bar' }, 'hair'],
];
const wrong = cases.filter(([t, n]) => nicheOf(t) !== n).map(([t, n]) => ({ t, want: n, got: nicheOf(t) }));
ok(!wrong.length, 'worked out from the kind of business and its name (nails, barber, hair, med spa, gym, café, a mixed salon, …)', wrong);
ok(nicheOf({ businessType: 'salon', name: 'Studio Nine', movingIn: { starterMenu: 'lash' } }) === 'lash', 'the starter menu it added counts when its name says nothing (a “bar” is never taken for a café)');
ok(nicheOf({ businessType: 'salon', name: 'Studio Nine', makingItRight: { preset: 'nails' } }) === 'beauty' && nicheOf({ businessType: 'other', makingItRight: { preset: 'tattoo' } }) === 'tattoo', 'a Making it right set says something only when it isn’t the salon default');
ok(nicheOf({ businessType: 'salon', name: 'Opal Manicure Studio', niche: 'hair' }) === 'hair' && nicheChosen({ niche: 'hair' }) && !nicheChosen({ niche: 'rockets' }), 'what the owner chose wins (and nonsense is ignored)');

// ── tools: nothing taken away where nails might be done, or where the app can't place the business
ok(['nails', 'beauty', 'general', null].every((n) => markupToolsHidden(n as any).length === 0), 'nails, a mixed salon, or not known: every markup tool');
ok(chosenNiche({ businessType: 'salon', name: 'Luxe Hair Studio' }) === null && chosenNiche({ niche: 'hair' }) === 'hair', 'only what the owner chose can take a tool away: a guess (“Luxe Hair Studio” with a nail tech) never does');
ok(['hair', 'barber', 'lash', 'spa', 'medspa', 'tattoo', 'fitness', 'hospitality', 'shop', 'events'].every((n) => markupToolsHidden(n as any).join() === 'nail'), 'anywhere else: no nail guide');
const me = src('src/components/markup/MarkupEditor.tsx');
ok(/const hiddenTools = markupToolsHidden\(niche\);/.test(me) && /tools\.map\(\(\{ k, label: l, Icon \}\)/.test(me) && /toolGrid\.map\(/.test(me) && /const k = k0 && !hiddenTools\.includes\(k0\) \? k0 : undefined;/.test(me) && /hiddenTools\.includes\(startTool\) \? 'pen' : startTool/.test(me) && !/TOOLS\.map\(\(\{ k/.test(me), 'the markup tool leaves it out of both tool lists and its shortcut key (marks already made still draw)');
ok(/niche=\{chosenNiche\(c\.tenant\)\}/.test(src('src/components/booking/StudioFlow.tsx')) && /<MarkupEditor niche=\{niche\}/.test(src('src/components/booking/PhotoMarkup.tsx')) && /<PhotoMarkup niche=\{niche\}/.test(src('src/components/visit/PhotosAskCard.tsx')) && /<PhotosAskCard ask=\{photosAsk\} niche=\{chosenNiche\(tenant\)\}/.test(src('src/app/check-in/[token]/page.tsx')), 'clients marking up photos (booking, and when asked on the visit page) get the tools for the business');
ok(/<MarkupEditor inline niche=\{nicheNow\}/.test(src('src/components/markup/TeamPhotoMarkup.tsx')) && /const nicheNow = chosenNiche\(/.test(src('src/components/markup/TeamPhotoMarkup.tsx')) && /<MarkupEditor inline src=\{imageUrl\} layer="team" niche=\{chosenNiche\(tenantNow\)\}/.test(src('src/components/shared/ImageMarkupDialog.tsx')), 'so does the team');

// ── care notes
const keys = (s: any[]) => s.map((x) => x.key).join();
ok(keys(careSetsFor('hospitality')) === 'allergies,sensory' && careSetsFor('hospitality')[0].picks.includes('Gluten'), 'a café: allergies (food ones) and access, no medical section');
ok(keys(careSetsFor('nails')) === 'medical,allergies,sensory' && careSetsFor('nails')[1].picks.includes('Acrylates') && careSetsFor('nails')[0].picks.includes('Diabetes'), 'nails: health notes that matter to the work, acrylate allergy first');
ok(keys(careSetsFor('shop', { health: true })) === 'medical,allergies,sensory' && keys(careSetsFor('shop', { hasMedical: true })) === 'medical,allergies,sensory', 'shown anyway where the business keeps health details, or the client already has some');
const ed = src('src/components/clients/EditClientDialog.tsx'); const ad = src('src/components/clients/AddClientDialog.tsx');
ok(/<EditClientFormInternal key=\{client\.id\} client=\{client\} \/>/.test(ed) && /hasMedical: seenCare\.current\.medical\.size > 0/.test(ed) && /predefinedItems=\{\[\.\.\.new Set\(\[\.\.\.c\.picks, \.\.\.seenCare\.current\[c\.key\]\]\)\]\}/.test(ed), 'editing a client: anything ticked stays listed, even outside the quick picks and after unticking it');
ok(/careSetsFor\(nicheOf\(careTenant\), \{ health: privacyOf\(careTenant\)\.healthMode \}\)/.test(ad) && !/predefinedItems=\{\['Pregnant', 'Pacemaker'/.test(ad + ed), 'adding a client: the quick picks for the kind of business');

// ── words
ok(prepNoteFor('nails').includes('polish') && prepNoteFor('hair').includes('hair') && !/polish|hair/.test(prepNoteFor('fitness')), 'a visit note to start from that fits (no “no polish” for a gym)');
ok(/useState\(\(\) => prepNoteFor\(nicheOf\(selectedTenant\)\)\)/.test(src('src/components/planner/AppointmentDetailsSheet.tsx')), 'the visit sheet starts from it');
ok(suggestMenu({ businessType: 'shop', name: 'Corner' }) === '' && suggestMenu({ businessType: 'salon', name: 'Opal Manicure Studio' }) === 'nails' && /!menu && g\.data\.suggest/.test(src('src/app/(app)/settings/setup/page.tsx')), 'no starter menu is picked for a business none of them fits');
const op = src('src/lib/opportunities.ts');
ok(!/your nails are doing well/.test(op) && !/return 'nails'/.test(op), 'reconnect texts don’t assume nails');
const misc = ['src/app/(app)/settings/automations/page.tsx', 'src/lib/categories.ts', 'src/components/documents/DocEditor.tsx', 'src/app/api/expenses/page.tsx', 'src/app/(app)/rent/page.tsx', 'src/app/(app)/events/page.tsx', 'src/app/(app)/settings/booking-page/page.tsx', 'src/app/quote/[tenantId]/[id]/page.tsx', 'src/components/prep/CheckEditor.tsx'].map(src).join('\n');
ok(!/nail art reference|Manicures, pedicures|Polish, tips, acetone|Cuticles a bit dry|Lifting before day 7|Gel polish restock|Spring Nail Night|How long does gel last|gel mani|How many nails are lifting/.test(misc), 'examples and hints every business sees are neutral');
const card = src('src/components/settings/BusinessShapeCard.tsx');
ok(/label="What you do"/.test(card) && /save\('niche', v,/.test(card) && /reset\('niche', 'What you do'\)/.test(card), 'Settings: what you do can be chosen, or worked out again');

const files = ['src/lib/niche.ts'];
const name = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map(([a, b]) => a + b).join('|'), 'i');
ok(files.every((f) => !name.test(src(f)) && !/call us|contact us|colour/i.test(src(f))), 'house rules');

if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
console.log('\nall good');
