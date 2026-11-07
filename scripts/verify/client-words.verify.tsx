// scripts/verify/client-words.verify.tsx — WHAT CLIENTS ARE TOLD, FOR EVERY KIND OF BUSINESS. Walk-in texts, the kiosk,
// check-in, the lounge, the phone pay screen, booking and the rent email no longer send people to a front desk that
// isn't there, or talk about "your chair" and "your technician": with no front desk they name the one person who sees
// clients ("Please see Jessica"), or say "us".
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/client-words.verify.tsx
import fs from 'fs';
import { makeDb } from './fake-db';
import { inPersonFromDb } from '../../src/lib/business-shape';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  // ── who to see, read on the server
  const db: any = makeDb();
  await db.doc('tenants/solo').set({ name: 'Opal', teamSize: 'solo' }); await db.doc('tenants/solo/staff/u1').set({ name: 'Jessica Marshall', role: 'owner' });
  await db.doc('tenants/team').set({ name: 'Glow', teamSize: 'team' }); await db.doc('tenants/team/staff/u1').set({ name: 'Ana Ruiz', role: 'owner' }); await db.doc('tenants/team/staff/u2').set({ name: 'Mia Lopez', role: 'staff' });
  await db.doc('tenants/nodesk').set({ name: 'Two Chairs', shape: { desk: false } }); await db.doc('tenants/nodesk/staff/u1').set({ name: 'Ana Ruiz', role: 'owner' }); await db.doc('tenants/nodesk/staff/u2').set({ name: 'Mia Lopez', role: 'staff' });
  ok(await inPersonFromDb(db, 'solo') === 'Jessica', 'one person: “Jessica”');
  ok(await inPersonFromDb(db, 'team') === 'the front desk', 'a team: “the front desk”, as before');
  ok(await inPersonFromDb(db, 'nodesk') === 'us' && await inPersonFromDb(db, 'nodesk', undefined, 'Mia Lopez') === 'Mia', 'a team with no front desk: “us”, or the visit’s own provider');
  const broken: any = { doc: () => ({ get: async () => { throw new Error('down'); } }), collection: () => ({ get: async () => { throw new Error('down'); } }) };
  ok(await inPersonFromDb(broken, 'x') === 'the front desk', 'nothing readable: “the front desk”, as it always was');

  // ── walk-ins
  const wk = src('src/app/api/walkins/route.ts');
  ok(!/'Please see the front desk/.test(wk) && !/please see the front desk\./.test(wk) && (wk.match(/pleaseSee\(await seeWho\(db, tenantId\)/g) || []).length >= 8, 'every kiosk “please see…” names who to see');
  ok(!/your chair is ready|Your chair is ready/.test(wk.replace(/\/\/.*$|^\s*\*.*$/gm, '')) && /it’s your turn at \$\{studio\}/.test(wk) && /We will message you as soon as it’s your turn/.test(wk), 'walk-in texts say “it’s your turn”, not “your chair is ready” (not every business has chairs)');
  ok((wk.match(/\n\s+see,\n/g) || []).length === 3 && /see: await seeWho\(db, tenantId, tenant\),/.test(wk) && /const see = o\.see \|\| 'the front desk';/.test(wk) && /Please check in with \$\{see\} so that we can match you/.test(wk) && /'Please come in at your earliest convenience\.'/.test(wk), 'every walk-in text is told who to see (and with no desk: “please come in”)');
  ok(/Please check with \$\{await seeWho\(db, tenantId, tenant\)\}/.test(wk), 'a patch test reminder names who to check with');

  // ── check-in, kiosk, lounge, booking, paying, rent
  const ci = src('src/app/api/checkins/route.ts');
  ok(/inPerson\(publicShape\(await shapeFromDb\(db, tenantId, tn\)\), appt\.staffName\)/.test(ci) && /Please let \$\{who\} know you’re here when you arrive\./.test(ci), 'online check-in turned off: “please let Jessica know you’re here”, or the front desk');
  const ks = src('src/app/api/booths/kiosk/route.ts');
  ok(!/see the front desk|talk to the front desk/.test(ks) && (ks.match(/await inPersonFromDb\(db, tenantId, kioskTenant\)/g) || []).length === 3, 'the station kiosk too');
  const gl = src('src/app/api/guest-lounge/route.ts'); const vl = src('src/components/visit/VisitLounge.tsx');
  ok(!/technician know|ask your technician|The front desk will be ready/.test(gl) && !/The front desk will be ready/.test(vl), 'the lounge says “your provider” and “we’ll be ready for you”');
  ok(!/someone from the team|Someone from the team|the team will send/.test(vl + src('src/components/visit/VisitPay.tsx')), 'the lounge and paying say “we”, not “someone from the team” (a one-person business has none)');
  ok(!/see the front desk/.test(src('src/app/api/appointments/book/route.ts')), 'booking a time that’s full: “please ask us about another time”');
  ok(!/front desk screen/.test(src('src/app/pay/[screenId]/page.tsx')), 'paying by phone at the counter: “your receipt is on the checkout screen”');
  ok(!/or at the front desk/.test(src('src/app/api/cron/nightly/route.ts')), 'a renter’s rent email: “or in person”');

  ok(/so we can confirm this service/.test(wk), 'one person with no one to match a walk-in to: “so we can confirm this service”');
  const kp = src('src/app/(booking)/kiosk/[tenantId]/page.tsx'); const wp = src('src/app/walk-in/[tenantId]/page.tsx');
  ok(!/see the front desk/.test(kp + wp) && !/pay at the desk/.test(ks) && !/we have your chair/.test(src('src/app/lobby/[tenantId]/page.tsx')), 'the kiosk, walk-in and lobby screens: “please ask us”, “pay in person”, “we’re ready for you”');
  ok(!/the team/.test(vl.replace(/\/\/.*$/gm, '')) && !/chair or lighting/.test(vl + gl), 'the lounge never says “the team” to a client, nor “chair”');
  const files = ['src/lib/business-shape.ts', 'src/app/api/walkins/route.ts', 'src/app/api/checkins/route.ts'];
  const name = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map(([a, b]) => a + b).join('|'), 'i');
  ok(files.every((f) => !name.test(src(f)) && !/call us|contact us/i.test(src(f))), 'house rules');

  if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
  console.log('\nall good');
})().catch((e) => { console.error(e); process.exit(1); });
