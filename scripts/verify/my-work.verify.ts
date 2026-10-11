// Checks lib/my-work: what shows in a person's My work and on their profile's Training & tasks.
// Run: npx tsx scripts/verify/my-work.verify.ts
import { myWork, docIsFor, rotationTurn } from '../../src/lib/my-work';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const me = { id: 's1', role: 'staff' }; const today = '2026-10-14';
const tasks = [
  { id: 't1', title: 'Restock station 3', assignedStaffIds: ['s1'], status: 'open', dueDate: '2026-10-14', requirePhoto: true, createdAt: '2026-10-12T10:00:00Z' },
  { id: 't2', title: 'Old task', assignedStaffIds: ['s1'], status: 'open', dueDate: '2026-10-10', createdAt: '2026-10-01T10:00:00Z' },
  { id: 't3', title: 'Done task', assignedStaffIds: ['s1', 's2'], status: 'done', completedAt: '2026-10-13T15:00:00Z', completedBy: 's1', createdAt: '2026-10-11T10:00:00Z' },
  { id: 't4', title: 'Not mine', assignedStaffIds: ['s2'], status: 'open' },
  { id: 't5', title: 'Ancient done', assignedStaffIds: ['s1'], status: 'done', completedAt: '2026-08-01T15:00:00Z', createdAt: '2026-07-30T10:00:00Z' },
];
const docs = [
  { id: 'd1', title: 'Sterilisation steps', status: 'published', assignedRoles: ['all'], version: 3, signBy: '2026-10-16' },
  { id: 'd2', title: 'Privacy', status: 'published', assignedRoles: ['staff'], version: 1 },
  { id: 'd3', title: 'Admins only', status: 'published', assignedRoles: ['admin'], version: 1 },
  { id: 'd4', title: 'Draft', status: 'draft', assignedRoles: ['all'], version: 1 },
  { id: 'd5', title: 'For me by name', status: 'published', assignedRoles: [], assignedStaffIds: ['s1'], version: 2, signBy: '2026-10-12' },
];
const acks = { d1: { version: 2, acknowledgedAt: '2026-10-01T10:00:00Z' }, d2: { version: 1, acknowledgedAt: '2026-10-12T10:00:00Z' }, d5: null };
const rotations = [
  { id: 'r1', title: 'Closing checklist', memberIds: ['s2', 's1'], currentIndex: 1, cadence: 'daily', lastDoneDate: '2026-10-13', history: [{ date: '2026-10-11', action: 'done', staffId: 's1' }] },
  { id: 'r2', title: 'Weekly deep clean', memberIds: ['s1', 's2'], currentIndex: 0, cadence: 'weekly', lastDoneDate: '2026-10-12' },
];
ok(docIsFor(docs[0], me) && docIsFor(docs[1], me) && !docIsFor(docs[2], me) && !docIsFor(docs[3], me) && docIsFor(docs[4], me), 'who a document is for (everyone, role, by name; not drafts or other roles)');
const w = myWork({ staff: me, today, tasks, docs, acks, rotations, runs: [{ staffId: 's1', date: '2026-10-05', completedAt: 'x' }, { staffId: 's1', date: '2026-09-30', completedAt: 'x' }] });
const keys = w.todo.map((x) => x.key);
ok(keys[0] === 't:t2' || keys[0] === 'd:d5', 'overdue first');
ok(w.todo.find((x) => x.key === 't:t1')?.status === 'due' && /photo needed/.test(w.todo.find((x) => x.key === 't:t1')!.sub), 'task due today, photo needed');
ok(w.todo.find((x) => x.key === 'd:d1')?.title.includes('(updated)') === true, 'signed an older version → read again (updated)');
ok(w.todo.find((x) => x.key === 'd:d5')?.status === 'overdue', 'past sign-by → overdue');
ok(w.todo.some((x) => x.key === 'r:r1' && x.status === 'due'), 'my turn on the daily checklist');
ok(!w.todo.some((x) => x.key === 'r:r2'), 'weekly turn already done this week (Mon Oct 12)');
ok(w.done.some((x) => x.key === 't:t3') && !w.done.some((x) => x.key === 't:t5'), 'done lately = last 30 days');
ok(w.done.some((x) => x.key === 'd:d2'), 'signed SOP in done');
ok(!keys.includes('t:t4') && !keys.includes('d:d3'), 'nothing that isn’t theirs');
ok(w.sopsSigned === 1 && w.sopsTotal === 3, `SOPs signed 1 of 3 (got ${w.sopsSigned}/${w.sopsTotal})`);
ok(w.overdue === 2, `2 overdue (got ${w.overdue})`);
ok(w.tasksThisMonth === 3, `tasks this month 3 (got ${w.tasksThisMonth})`);
ok(w.checklistsRun === 1, 'checklists run this month');
ok(rotationTurn({ memberIds: ['a', 'b'], currentIndex: 2, cadence: 'daily' }, 'a', today).mine, 'turn wraps around');
console.log(bad ? `${bad} failed` : 'All checks passed'); process.exit(bad ? 1 : 0);
