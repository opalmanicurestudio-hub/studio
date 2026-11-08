// scripts/verify/business-shape.verify.tsx — HOW THE BUSINESS WORKS. One person or a team, a front desk or not, health
// information or not: worked out from the team and the kind of business, changeable in Settings, and used by the words
// clients see (refunds, the visit link) and the photo screens, instead of assuming a team with a front desk.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/business-shape.verify.tsx
import fs from 'fs';
import * as BS from '../../src/lib/business-shape';
import { isHealthBusiness, discreetVersion } from '../../src/lib/health-privacy';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

// ── worked out
const jess = { id: 'u1', name: 'Jessica Marshall', role: 'owner' };
const solo = BS.shapeOf({ teamSize: 'team' }, [jess, { id: 'r1', name: 'Rae Kim', role: 'renter', isRenter: true }, { id: 'x', name: 'Old Hire', role: 'staff', isActive: false }]);
ok(solo.solo && !solo.desk && solo.person === 'Jessica' && solo.providers === 1 && solo.guessed.solo, 'one person sees clients (renters and people who left don’t count): just you, no front desk, by first name', solo);
const two = BS.shapeOf({}, [jess, { id: 'u2', name: 'Mia Lopez', role: 'staff' }]);
ok(!two.solo && two.desk && two.person === '' && !two.alone, 'two people: a team, taken to have a front desk (or a counter) unless the owner says not', two);
const none = BS.shapeOf({ teamSize: 'team' }, []);
ok(!none.solo && none.desk && none.providers === null && !none.alone, 'nobody on the team (not loaded, or not readable): what was chosen at signup, never “just you”', none);
const legacy = BS.shapeOf({}, null);
ok(!legacy.solo && legacy.desk, 'an older business that never said: a team with a front desk, as before');
ok(BS.shapeOf({}, [jess, { id: 'x2', name: 'Left', role: 'staff', archived: true }]).alone, 'someone archived from the team doesn’t count');
ok(!BS.shapeOf({}, [jess, { id: 'x3', name: 'Clocked out', role: 'staff', active: false }]).alone, 'someone who is only clocked out is still on the team');
ok(solo.alone && !BS.shapeOf({ shape: { solo: true } }, [jess, { id: 'u2', name: 'Mia Lopez', role: 'staff' }]).alone, '“only you” only when nobody else is on the team, never just because “just me” was chosen');
const chose = BS.shapeOf({ shape: { solo: true } }, [{ id: 'u2', name: 'Mia Lopez', role: 'staff' }, jess]);
ok(chose.solo && !chose.desk && chose.person === 'Jessica', '“just me” chosen with others still listed: clients are told the owner’s name, not whoever is listed first', chose);
const desk = BS.shapeOf({}, [jess, { id: 'u2', name: 'Mia', role: 'staff' }, { id: 'u3', name: 'Kai', role: 'front_desk' }]);
ok(!desk.solo && desk.desk, 'someone has the front desk role: a front desk');
ok(BS.shapeOf({}, [jess, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }]).desk, 'three or more people seeing clients: usually a front desk');
ok(BS.shapeOf({ teamSize: 'solo' }, null).solo && !BS.shapeOf({ teamSize: 'team' }, null).solo, 'without the team at hand: what was chosen at signup');
const chosen = BS.shapeOf({ shape: { solo: false, desk: true } }, [jess]);
ok(!chosen.solo && chosen.desk && !chosen.guessed.solo && !chosen.guessed.desk, 'what the owner chose in Settings wins over what’s worked out');
ok(!BS.shapeOf({ shape: { desk: false } }, [jess, { id: 'u2', name: 'Mia', role: 'staff' }]).desk, 'a team can say it has no front desk');
ok(BS.shapeOf({ privacy: { healthMode: true } }, [jess]).health && !BS.shapeOf({ businessType: 'salon' }, [jess]).health, 'health information: the privacy switch, or worked out from the kind of business');

// ── the words
const noDesk = BS.publicShape(solo);
ok(BS.pickupWhere(noDesk) === 'from Jessica' && BS.pickupLabel(noDesk) === 'With Jessica' && BS.inPerson(noDesk) === 'Jessica', 'with no front desk: “from Jessica”, “With Jessica”');
ok(BS.inPerson(noDesk, 'Mia Lopez') === 'Mia' && BS.pickupWhere({ desk: false, person: '' }) === 'when you come in' && BS.inPerson({ desk: false, person: '' }) === 'us', 'the visit’s own provider when known; otherwise “when you come in”, “us”');
ok(BS.pickupWhere(BS.publicShape(desk)) === 'at the front desk' && BS.pickupWhere(null) === 'at the front desk' && BS.pickupLabel(undefined) === 'Front desk', 'with a front desk (or not known): as before');
ok(Object.keys(BS.publicShape(solo)).sort().join() === 'desk,person,solo', 'a client’s page is given only how to word things, never the team');

// ── health detection
ok(isHealthBusiness({ businessType: 'salon', makingItRight: { preset: 'med_spa' } }), 'a med spa’s Making it right set counts, even with a “salon” type from signup');
ok(isHealthBusiness({ businessType: 'other', name: 'Glow Med Spa' }) && !isHealthBusiness({ businessType: 'salon', name: 'Medina Nails' }) && !isHealthBusiness({ businessType: 'salon', name: 'Opal Manicure Studio' }), 'by name only when it can’t mean anything else (“Medina Nails” isn’t a clinic)');
ok(['dentistry', 'psychotherapy', 'Clinics', 'medical aesthetics', 'medspa', 'injections', 'physical_therapy'].every((k) => isHealthBusiness({ businessType: k })), 'every form of the word counts (“dentistry”, “psychotherapy”, “clinics”, a med spa preset)');
ok(!isHealthBusiness({ businessType: 'spa', category: 'Beauty & Wellness' }) && !isHealthBusiness({ businessType: 'other', name: 'Infusion Tea Bar' }) && !isHealthBusiness({ businessType: 'barber', category: 'independent' }) && !isHealthBusiness({ businessType: 'lashes', niche: 'aesthetics', name: 'The Brow Clinic' }), 'not health: a day spa’s “wellness”, a tea bar called Infusion, “independent”, a lash studio’s “aesthetics”, “The Brow Clinic”');
ok(!/contact us/i.test(discreetVersion({ kind: 'x', channel: 'sms', text: 'no link here' }, 'Opal')!.text), 'a discreet message never says “contact us”');

// ── where it's used
const rp = src('src/lib/refund-payouts.ts');
ok(!/refund (will be ready|is ready)[^`]*at the front desk/.test(rp) && (rp.match(/\(await pickupAt\(db, tenantId, tenant\)\)\.where/g) || []).length === 3 && /pickupAt: await pickupAt/.test(rp), 'refund texts say where in the business’s own words (all three), and so does the refund page’s data');
const rpage = src('src/app/refund/[tenantId]/[id]/page.tsx');
ok(!/"Front desk"|at the front desk\.<|for you at the front desk'/.test(rpage) && (rpage.match(/d\.pickupAt\?\./g) || []).length >= 4, 'the refund page says where from what it’s given');
ok(/pickupLabel\(publicShape\(shape \|\| shapeOf\(tenant\)\)\)/.test(src('src/components/refunds/RefundSheets.tsx')), 'so does the printed slip');
ok(/shape = publicShape\(await shapeFromDb\(db, tenantId, tenant\)\)/.test(src('src/app/api/visit-view/route.ts')), 'the visit link is told how the business works');
const dov = src('src/components/booking/DayOfView.tsx'); const cin = src('src/app/check-in/[token]/page.tsx');
ok(/inPerson\(shape, provider\?\.name\)/.test(dov) && /shape\?\.desk === false \? `Please let \$\{told2\} know you’re here/.test(dov) && /Show it to \$\{told2\}/.test(dov), 'the day of the visit: who to tell, check in, and show the pass to, to match');
ok(!/let the front desk know when you arrive'\)/.test(cin) && /inPerson\(\(appointmentData as any\)\?\.shape/.test(cin) && (cin.match(/shape=\{\(appointmentData as any\)\?\.shape \|\| null\}/g) || []).length === 3, 'the visit page passes it to the pass, the day-of screen and paying');
ok(/aria-label=\{`Show my pass to \$\{toWhom\}`\}/.test(src('src/components/booking/VisitHero.tsx')) && /Please pay \$\{inPerson\(shape, provider\)\} directly/.test(src('src/components/visit/VisitPay.tsx')), 'the pass and paying, too');
const mp = src('src/lib/message-policy.ts');
ok(!/no one on our team is available/.test(mp) && !/Thank you for coming in yesterday/.test(mp), 'default messages that fit any business (no “our team”, no “coming in”)');
ok(/solo \? 'Only you' : 'The team'/.test(src('src/components/clients/ClientPhotoRecord.tsx')) && /solo \? 'Save without sending' : 'Save for the team'/.test(src('src/components/markup/TeamPhotoMarkup.tsx')) && /private: solo \? 'Private notes' : 'Private team notes'/.test(src('src/components/markup/TeamPhotoMarkup.tsx')), 'the photo screens: “only you” and “private notes” for one person');
ok(/solo=\{shapeOf\(selectedTenant, staff \|\| null\)\.alone\}/.test(src('src/components/planner/AppointmentDetailsSheet.tsx')) && /staff\.length \? staff : null\)\.alone;/.test(src('src/components/clients/ClientTabs.tsx')), 'the appointment and the client page pass it along (“only you” only when nobody else is on the team)');
const cpr = src('src/components/clients/ClientPhotoRecord.tsx');
ok(!/'Your'/.test(cpr) && /const mine = !byName && solo/.test(cpr), 'the photo record knows the marks are yours without a stand-in name');
const pp = src('src/app/(app)/refunds/print/[id]/page.tsx');
ok(/useBusinessShape\(tenantId, selectedTenant\)/.test(pp) && /!shape\.ready/.test(pp) && /shape=\{shape\}/.test(pp), 'the printed slip waits for the team, so it says the same place as the texts');
ok(/const away = \['online', 'phone'\]/.test(cin) && /Please check your connection\$\{orTell\}/.test(cin), 'an online or phone visit is never told to “let someone know when you arrive”');
ok((rp.match(/ready to pick up \$\{\(await pickupAt/g) || []).length === 3, 'refund texts read “ready to pick up from Jessica” (all three)');
const card = src('src/components/settings/BusinessShapeCard.tsx'); const settings = src('src/app/(app)/settings/page.tsx');
ok(/'shape\.solo'/.test(card) && /'shape\.desk'/.test(card) && /'privacy\.healthMode'/.test(card) && /deleteField\(\)/.test(card) && /<BusinessShapeCard tenantId=\{tenantId\}/.test(settings), 'Settings: each answer can be chosen, or worked out again');

const files = ['src/lib/business-shape.ts', 'src/hooks/use-business-shape.ts', 'src/components/settings/BusinessShapeCard.tsx'];
const name = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map(([a, b]) => a + b).join('|'), 'i');
ok(files.every((f) => !name.test(src(f)) && !/\{\/\*/.test(src(f)) && !/call us|contact us|colour/i.test(src(f))), 'house rules');

(async () => {
  let reads = 0; const mk = (docs: any[]) => ({ collection: () => ({ get: async () => { reads++; return { docs: docs.map((x) => ({ id: x.id, data: () => x })) }; } }) });
  const a = await BS.shapeFromDb(mk([{ id: 'u1', name: 'Jessica Marshall', role: 'owner', phone: '555' }]), 'cacheT', {});
  const b = await BS.shapeFromDb(mk([{ id: 'u1', name: 'Jessica Marshall', role: 'owner' }, { id: 'u2', name: 'Mia', role: 'staff' }]), 'cacheT', { shape: { desk: false } });
  ok(reads === 1 && a.solo && b.solo && !b.desk, 'the server reads the team at most once a minute (the business’s own choices are read fresh)', { reads, a, b });
  const c = await BS.shapeFromDb({ collection: () => ({ get: async () => { throw new Error('no'); } }) }, 'otherT', { teamSize: 'solo' });
  ok(c.solo && c.providers === null, 'a team that can’t be read: what was chosen at signup');
  if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
console.log('\nall good');
})();
