// scripts/verify/staff-steps.verify.tsx — STAFF STEPS THAT FIT THE BUSINESS. With no front desk, finishing a visit goes
// straight on to payment; a one-person business is never asked for a second person to count refund cash; the health
// form reminder only runs for services that ask for a health form and can be turned off; one person who also gets the
// owner's morning brief gets one text, not two; and staff hand-offs name the owner instead of a desk that isn't there.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/staff-steps.verify.tsx
import fs from 'fs';
import Module from 'module';
import { makeDb, FV } from './fake-db';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

let db: any = makeDb();
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  return load.call(this, request, ...rest);
};

(async () => {
  const { twoPersonCount } = await import('../../src/lib/making-it-right');
  const { shapeOf } = await import('../../src/lib/business-shape');
  const jess = { id: 'u1', name: 'Jessica Marshall', role: 'owner' }; const mia = { id: 'u2', name: 'Mia Lopez', role: 'staff' };

  // ── a second person counting refund cash
  ok(!twoPersonCount({}, shapeOf({}, [jess])), 'nobody else on the team: no second person, ever');
  ok(!twoPersonCount({ makingItRight: { cashRefund: { twoPerson: true } } }, shapeOf({}, [jess])), '…even if it was switched on before (it could never be done)');
  ok(twoPersonCount({}, shapeOf({}, [jess, mia])), 'a team: on, as before');
  ok(!twoPersonCount({ makingItRight: { cashRefund: { twoPerson: false } } }, shapeOf({}, [jess, mia])), 'a team that turned it off: off');
  ok(!twoPersonCount({ shape: { solo: true } }, shapeOf({ shape: { solo: true } }, [jess, mia])), '“just me” chosen with someone else listed: off unless switched on');

  // The refund hand-over itself: a one-person business goes straight to the pickup code; a team still needs the count.
  const { staffAct } = await import('../../src/lib/refund-payouts');
  const payout = { method: 'pickup', status: 'scheduled', amountCents: 2500, clientFirst: 'Ava', prep: { tillAt: '2026-11-07T10:00:00Z', preparedBy: 'Jessica' } };
  const seed = async (t: string, staff: any[]) => {
    await db.doc(`tenants/${t}`).set({ name: 'Opal', teamSize: staff.length > 1 ? 'team' : 'solo' });
    for (const s of staff) await db.doc(`tenants/${t}/staff/${s.id}`).set(s);
    await db.doc(`tenants/${t}/refundPayouts/p1`).set(payout);
  };
  await seed('solo1', [jess]); await seed('team1', [jess, mia]);
  const actor = { uid: 'u1', name: 'Jessica Marshall', isOwner: true, isManager: true, role: 'owner' };
  const soloTry: any = await staffAct(db, 'solo1', actor, { action: 'handover', id: 'p1', code: '000000' });
  const teamTry: any = await staffAct(db, 'team1', actor, { action: 'handover', id: 'p1', code: '000000' });
  ok(!soloTry.ok && !/second person/i.test(String(soloTry.error)), 'one person: handing over is never held for a second count (it goes on to the pickup code)', soloTry);
  ok(!teamTry.ok && /second person/i.test(String(teamTry.error)), 'a team: still counted by a second person first', teamTry);
  const sa = src('src/lib/refund-payouts.ts'); const body = sa.slice(sa.indexOf('export async function staffAct'));
  ok(!/C\.twoPerson/.test(body.slice(0, body.indexOf('\n}\n'))) && /const twoNow = async \(\) => twoPersonCount\(tenant, /.test(body) && (body.match(/const two = await twoNow\(\);/g) || []).length === 2, 'every refund step uses the same rule (the team read only for counting and handing over)');
  ok(/twoPerson: twoPersonCount\(tenant, shapeOf\(tenant, staff\?\.length \? staff : null\)\)/.test(src('src/components/refunds/RefundsDesk.tsx')), 'the refunds screen shows the count step only where it applies');
  const mir = src('src/app/(app)/settings/making-it-right/page.tsx');
  ok(/disabled=\{!canEdit \|\| shape\.alone\}/.test(mir) && /nobody else is on your team to count it/.test(mir) && /if \(!twoTouched && typeof .*twoPerson !== 'boolean'\) delete out\.cashRefund\.twoPerson/.test(mir), 'Settings: off for one person; left worked out unless the owner changes it');

  // ── the health form reminder
  const ca = src('src/app/api/cron/check-automations/route.ts');
  ok(!/healthDisclosedAt/.test(ca) && /healthMissing = need\.some\(\(id\) => isHealthForm\(fc\.get\(id\)\)\)/.test(ca), 'only a health form the service asks for and still needs (never “every visit”, as before)');
  ok(/const missing = healthMissing && t\?\.enabled !== false;/.test(ca) && /readinessFlags\.healthGateActive = missing;/.test(ca), 'and only while it’s switched on');
  const au = src('src/app/(app)/settings/automations/page.tsx');
  ok(!/Always on/.test(au) && !/isLocked/.test(au) && /canDisable: true,\s+\/\/ only for services that ask for a health form/.test(au) && /Only for services that ask for a health form/.test(au) && !/cannot be disabled/.test(au), 'Settings: it can be turned off, and says when it runs');

  // ── one morning text for one person
  const rm = src('src/app/api/cron/reminders/route.ts');
  ok(/if \(briefGoes && oneOfUs && digits\(s\.phone\)\.length === 10 && digits\(s\.phone\) === digits\(cfg\.ownerPhone\)\) continue;/.test(rm) && /resolveMessage\(tDoc\.data\(\), 'owner_brief'\)\.send/.test(rm), 'the agenda is left out only when the brief really goes to the same phone');

  // ── finishing a visit with no front desk
  const tr = src('src/components/planner/TechnicianReviewDialog.tsx');
  ok(/const payNext = !shape\.desk && !!onTakePayment;/.test(tr) && /if \(payNext\) onTakePayment!\(appointment\.id\);/.test(tr) && /payNext \? 'Complete Service & Take Payment'/.test(tr), 'no front desk: finishing goes straight on to payment');
  ok(/shapeOf\(tenantOverride \|\| selectedTenant, /.test(tr) && /tenantOverride=\{portalTenant\}/.test(src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx')), 'the staff app tells the finish screen how the business works (it has no app tenant)');
  ok(/onTakePayment=\{\(id: string\) => router\.push\(`\/pos\?checkout_id=\$\{id\}`\)\}/.test(src('src/app/(app)/planner/page.tsx')) && /onTakePayment=\{\(id: string\) => setPayFor\(id\)\}/.test(src('src/app/(app)/pos/page.tsx')) && /some\(\(a: any\) => a\.id === payFor\)\) \{ const id = payFor; setPayFor\(null\); visitActions\(\)\.checkout\?\.\(id\);/.test(src('src/app/(app)/pos/page.tsx')), 'from the planner it opens checkout; on the desk it opens the payment once the visit shows as ready to pay');
  ok(/'Finished — to the desk' : 'Finished — take payment'/.test(src('src/components/planner/VisitPanel.tsx')), 'the side panel says so too');
  const sp = src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx');
  ok(/const askWho = shape\.desk \? 'the front desk' : 'the owner or a manager';/.test(sp) && /Ask \$\{askWho\} to sort it out/.test(sp) && /Please tell \{askWho\}/.test(sp) && /shape\.desk \? 'Sent to the front desk' : 'Finished and ready to pay'/.test(sp) && !/Handoff FAILED/.test(sp), 'the staff app names the owner or a manager when there’s no desk');
  ok(/desk \? 'Send to the desk' : 'Send for follow-up'/.test(src('src/components/staff-portal/NotHappy.tsx')) && /desk=\{shape\.desk\}/.test(sp), 'and so does “they weren’t happy”');
  ok(!/send it to the front desk/i.test(src('src/lib/prep-actions.ts')), 'a change that doesn’t fit doesn’t send a one-person business to a desk');

  const files = ['src/components/planner/TechnicianReviewDialog.tsx', 'src/components/staff-portal/NotHappy.tsx', 'src/app/(app)/settings/automations/page.tsx', 'src/lib/making-it-right.ts'];
  const name = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map(([a, b]) => a + b).join('|'), 'i');
  ok(files.every((f) => !name.test(src(f)) && !/call us|contact us/i.test(src(f))), 'house rules');

  if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
  console.log('\nall good');
})().catch((e) => { console.error(e); process.exit(1); });
