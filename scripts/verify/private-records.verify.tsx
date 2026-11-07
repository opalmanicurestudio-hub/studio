// scripts/verify/private-records.verify.tsx — PRIVATE RECORDS, SERVER ONLY. A form's answers kept beside a visit
// (health answers among them), the team's marks and private notes on a client's photo, and a photo's record are kept
// in collections the database rules keep from every browser; older ones under a visit or a client are moved there as
// they're read, and by the daily job.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/private-records.verify.tsx
import fs from 'fs';
import { makeDb } from './fake-db';
import * as PR from '../../src/lib/private-records';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const db: any = makeDb(); const T = 'tenants/t1';
  ok(PR.answersPath('t1', 'a1', 'h.1') === `${T}/visitFormAnswers/a1__h_1` && PR.marksPath('t1', 'a1', 'pk1') === `${T}/visitPhotoMarks/a1__pk1` && PR.photoRecordPath('t1', 'c1', 'pk1') === `${T}/clientPhotoRecords/c1__pk1`, 'where each kind of private record is kept');

  // Read: from where it's kept now, or moved from where it was.
  await db.doc(`${T}/appointments/a1/formAnswers/h1`).set({ formData: { q1: 'Latex allergy' } });
  const r1 = await PR.readMoved(db, PR.answersPath('t1', 'a1', 'h1'), PR.oldAnswersPath('t1', 'a1', 'h1'));
  ok(r1?.formData?.q1 === 'Latex allergy' && (await db.doc(PR.answersPath('t1', 'a1', 'h1')).get()).exists && !(await db.doc(PR.oldAnswersPath('t1', 'a1', 'h1')).get()).exists, 'an older record is moved as it’s read');
  ok((await PR.readMoved(db, PR.answersPath('t1', 'a1', 'zz'), PR.oldAnswersPath('t1', 'a1', 'zz'))) === null, 'nothing kept: nothing read');

  // The daily job.
  await db.doc(`${T}/appointments/a2/formAnswers/c1`).set({ formData: { s: 'signed' } });
  await db.doc(`${T}/appointments/a2/inspoMarks/pk9`).set({ markup: '{"private":"Lifting"}' });
  await db.doc(`${T}/clients/c7/photoRecords/pk9`).set({ opened: [{ by: 'Mia' }] });
  await db.doc(PR.marksPath('t1', 'a3', 'pk3')).set({ markup: 'newer' }); await db.doc(`${T}/appointments/a3/inspoMarks/pk3`).set({ markup: 'older' });
  await db.doc(`${T}/somethingElse/x/formAnswers/y`).set({ keep: true });
  const run = await PR.moveOldPrivateRecords(db);
  ok(run.moved === 4 && run.skipped === 1 && (await db.doc(PR.answersPath('t1', 'a2', 'c1')).get()).data().formData.s === 'signed' && (await db.doc(PR.marksPath('t1', 'a2', 'pk9')).get()).exists
    && (await db.doc(PR.photoRecordPath('t1', 'c7', 'pk9')).get()).data().clientId === 'c7', 'the daily job moves every older record (a photo’s record keeps whose it is)', run);
  ok((await db.doc(PR.marksPath('t1', 'a3', 'pk3')).get()).data().markup === 'newer' && !(await db.doc(`${T}/appointments/a3/inspoMarks/pk3`).get()).exists, 'one already moved keeps the newer copy, and the older goes');
  ok((await db.doc(`${T}/somethingElse/x/formAnswers/y`).get()).exists, 'a collection of the same name somewhere else is left alone');
  ok((await PR.moveOldPrivateRecords(db)).moved === 0, 'once moved, nothing is left to move');
  // A photo's record already here and an older one under the client: put together, nothing lost.
  await db.doc(PR.photoRecordPath('t1', 'c8', 'pk5')).set({ clientId: 'c8', opened: [{ by: 'Kai', at: '2026-11-07T12:00:00Z' }], pendingDeletes: ['https://x/new.jpg'] });
  await db.doc(`${T}/clients/c8/photoRecords/pk5`).set({ opened: [{ by: 'Mia', at: '2026-11-07T10:00:00Z' }], pendingDeletes: ['https://x/old.jpg'], removedAt: '2026-11-07T10:05:00Z', removedBy: { name: 'Kai' } });
  await PR.movePhotoRecordsOf(db, 't1', 'c8');
  const merged: any = (await db.doc(PR.photoRecordPath('t1', 'c8', 'pk5')).get()).data();
  ok(merged.opened.map((o: any) => o.by).join() === 'Mia,Kai' && merged.pendingDeletes.length === 2 && merged.removedAt && !(await db.doc(`${T}/clients/c8/photoRecords/pk5`).get()).exists, 'an older photo record is put together with the one already here: who opened it, copies left to delete, the removal', merged);
  await db.doc(`${T}/clients/c8/photoRecords/pk5`).set({ opened: [{ by: 'Mia', at: '2026-11-07T10:00:00Z' }] });
  await PR.movePhotoRecordsOf(db, 't1', 'c8');
  ok((await db.doc(PR.photoRecordPath('t1', 'c8', 'pk5')).get()).data().opened.length === 2, 'moving the same record again adds nothing twice');
  // Never overwrites a newer copy.
  await db.doc(PR.answersPath('t1', 'a5', 'h1')).set({ formData: { q1: 'newer' } }); await db.doc(PR.oldAnswersPath('t1', 'a5', 'h1')).set({ formData: { q1: 'older' } });
  await PR.moveOldPrivateRecords(db);
  ok((await db.doc(PR.answersPath('t1', 'a5', 'h1')).get()).data().formData.q1 === 'newer' && !(await db.doc(PR.oldAnswersPath('t1', 'a5', 'h1')).get()).exists, 'a newer copy already here is never written over; the older one goes');
  // Many to move: a page at a time, across runs.
  for (let i = 0; i < 7; i++) await db.doc(`${T}/appointments/b${i}/formAnswers/f1`).set({ n: i });
  const r2 = await PR.moveOldPrivateRecords(db, 5); const r3 = await PR.moveOldPrivateRecords(db, 5);
  ok(r2.moved === 5 && r2.left && r3.moved === 2 && !r3.left, 'many to move: so many a run, and the next run carries on', { r2, r3 });

  // Nothing writes to the old places any more; the rules keep the new ones from every browser.
  const files = ['src/app/api/checkin/actions/route.ts', 'src/app/api/completion/submit/route.ts', 'src/lib/forms-visit.ts', 'src/app/api/forms/visit/route.ts', 'src/app/api/visit-photos/route.ts', 'src/app/api/clients/photos/route.ts'];
  ok(files.every((f) => !/appointments\/\$\{[^}]+\}\/(formAnswers|inspoMarks)\/|clients\/\$\{clientId\}\/photoRecords/.test(src(f))), 'no code keeps them under a visit or a client any more');
  ok(/answersPath\(/.test(src('src/app/api/checkin/actions/route.ts')) && /answersPath\(/.test(src('src/app/api/completion/submit/route.ts')) && /answersPath\(/.test(src('src/lib/forms-visit.ts')) && /readMoved\(db, answersPath/.test(src('src/app/api/forms/visit/route.ts')), 'every place that keeps or reads a form’s answers uses where they’re kept now');
  const rules = src('firestore.rules');
  const wild = rules.slice(rules.indexOf('match /tenants/{tenantId}/{collection}/{rest=**}'), rules.indexOf(']);', rules.indexOf('match /tenants/{tenantId}/{collection}/{rest=**}')));
  ok(['visitFormAnswers', 'visitPhotoMarks', 'clientPhotoRecords'].every((c) => wild.includes(`'${c}'`)) && !/match \/tenants\/\{tenantId\}\/(visitFormAnswers|visitPhotoMarks|clientPhotoRecords)/.test(rules), 'the rules keep all three from every browser (left out of the team’s catch-all, with no rule of their own)');
  ok(/moveOldPrivateRecords/.test(src('src/app/api/cron/cleanup-evidence/route.ts')), 'the daily job runs the move');

  if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
  console.log('\nall good');
})().catch((e) => { console.error(e); process.exit(1); });
