// src/lib/my-work.ts — ONE PERSON'S WORK: the tasks they were given, the SOPs and handbook pages they must read and sign,
// and the checklists it's their turn to run (rotations), with what they've finished lately. The staff app shows it as
// Me → My work; the main app as the staff profile's Training & tasks. Pure — the loaders pass the records in.
//
// Sources (written elsewhere): tasks {assignedStaffIds, status open|done, dueDate, requirePhoto, completedAt};
// documents {status published, assignedRoles, assignedStaffIds, version, signBy?}; documents/{id}/acks/{staffId}
// {version, acknowledgedAt} — an ack counts only for the current version; rotations {memberIds, currentIndex, cadence,
// lastDoneDate, history[{date, action, staffId}]}; documents/{id}/runs {staffId, date, completedAt}.

export type WorkItem = {
  key: string; kind: 'task' | 'sop' | 'checklist'; title: string; sub: string;
  due: string | null; status: 'open' | 'due' | 'overdue' | 'done'; at: string | null; ref: { id: string; docId?: string };
  photo?: boolean;
};

/** Is this published document for this person (everyone, their role, or them by name)? */
export function docIsFor(d: any, staff: { id: string; role?: string }) {
  if (!d || d.status !== 'published') return false;
  const roles: string[] = Array.isArray(d.assignedRoles) ? d.assignedRoles : [];
  return roles.includes('all') || (!!staff.role && roles.includes(String(staff.role))) || (Array.isArray(d.assignedStaffIds) && d.assignedStaffIds.includes(staff.id));
}
const dayOf = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '');
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Monday of the week holding this day (rotations' weekly turns). */
const weekStart = (d: string) => { const t = new Date(`${d}T12:00:00Z`); const dow = (t.getUTCDay() + 6) % 7; return addDays(d, -dow); };

export function rotationTurn(r: any, staffId: string, today: string) {
  const ids: string[] = Array.isArray(r?.memberIds) ? r.memberIds : []; if (!ids.length) return { mine: false, doneThisRound: false };
  const cur = ids[(Number(r.currentIndex) || 0) % ids.length];
  const last = String(r.lastDoneDate || '');
  // Per-shift turns are never "done for the day" (the staff app treats them the same way).
  const doneThisRound = r.cadence === 'per-shift' ? false : r.cadence === 'weekly' ? last >= weekStart(today) : last === today;
  return { mine: cur === staffId, doneThisRound };
}

export function myWork(o: { staff: { id: string; role?: string }; today: string; tasks: any[]; docs: any[]; acks: Record<string, any | null>; rotations: any[]; runs?: any[]; doneWindowDays?: number }) {
  const { staff, today } = o; const since = addDays(today, -(o.doneWindowDays ?? 30));
  const todo: WorkItem[] = []; const done: WorkItem[] = [];

  for (const t of o.tasks || []) {
    if (!Array.isArray(t.assignedStaffIds) || !t.assignedStaffIds.includes(staff.id)) continue;
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(t.dueDate || '')) ? String(t.dueDate) : null;
    if (t.status === 'done') {
      if (dayOf(t.completedAt) >= since) done.push({ key: `t:${t.id}`, kind: 'task', title: String(t.title || 'Task'), sub: t.completedByName && t.completedBy !== staff.id ? `Done by ${t.completedByName}` : 'Task', due, status: 'done', at: t.completedAt || null, ref: { id: t.id } });
      continue;
    }
    const status = due && due < today ? 'overdue' : due === today ? 'due' : 'open';
    todo.push({ key: `t:${t.id}`, kind: 'task', title: String(t.title || 'Task'), due, status, at: null, ref: { id: t.id }, photo: !!t.requirePhoto,
      sub: ['Task', due ? (status === 'overdue' ? `was due ${nice(due)}` : status === 'due' ? 'due today' : `due ${nice(due)}`) : '', t.requirePhoto ? 'photo needed' : ''].filter(Boolean).join(' · ') });
  }

  for (const d of o.docs || []) {
    if (!docIsFor(d, staff)) continue;
    const ack = o.acks?.[d.id]; const signed = !!ack && Number(ack.version) === Number(d.version || 1);
    const signBy = /^\d{4}-\d{2}-\d{2}$/.test(String(d.signBy || '')) ? String(d.signBy) : null;
    const word = d.category === 'handbook' ? 'Handbook' : d.category === 'policy' ? 'Policy' : d.category === 'other' ? 'Document' : 'SOP';
    if (signed) { if (dayOf(ack.acknowledgedAt) >= since) done.push({ key: `d:${d.id}`, kind: 'sop', title: `Signed: ${d.title || 'Document'}`, sub: word, due: signBy, status: 'done', at: ack.acknowledgedAt || null, ref: { id: d.id, docId: d.id } }); continue; }
    const status = signBy && signBy < today ? 'overdue' : signBy === today ? 'due' : 'open';
    const updated = !!ack && Number(ack.version) !== Number(d.version || 1);
    todo.push({ key: `d:${d.id}`, kind: 'sop', title: `Read: ${d.title || 'Document'}${updated ? ` (updated)` : ''}`, due: signBy, status, at: null, ref: { id: d.id, docId: d.id },
      sub: [word, signBy ? (status === 'overdue' ? `was due ${nice(signBy)}` : status === 'due' ? 'sign today' : `sign by ${nice(signBy)}`) : 'read and sign'].join(' · ') });
  }

  for (const r of o.rotations || []) {
    if (!Array.isArray(r.memberIds) || !r.memberIds.includes(staff.id)) continue;
    const t = rotationTurn(r, staff.id, today);
    if (t.mine && !t.doneThisRound) todo.push({ key: `r:${r.id}`, kind: 'checklist', title: String(r.title || 'Checklist'), sub: r.cadence === 'weekly' ? 'Your turn this week' : 'Your turn today', due: today, status: 'due', at: null, ref: { id: r.id, docId: r.linkedDocId || undefined } });
    for (const h of (Array.isArray(r.history) ? r.history : []).filter((x: any) => x?.staffId === staff.id && x.action !== 'skip' && x.action !== 'swap' && String(x.date || '') >= since).slice(-3))
      done.push({ key: `r:${r.id}:${h.date}`, kind: 'checklist', title: String(r.title || 'Checklist'), sub: h.coveredForName ? `Covered for ${String(h.coveredForName).split(' ')[0]}` : 'Checklist', due: null, status: 'done', at: String(h.at || h.date || ''), ref: { id: r.id, docId: r.linkedDocId || undefined } });
  }

  const rank = { overdue: 0, due: 1, open: 2, done: 3 } as const;
  todo.sort((a, b) => rank[a.status] - rank[b.status] || String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.title.localeCompare(b.title));
  done.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const total = todo.length + done.length;
  const mineDocs = (o.docs || []).filter((d) => docIsFor(d, staff));
  const sopsSigned = mineDocs.filter((d) => { const a = o.acks?.[d.id]; return !!a && Number(a.version) === Number(d.version || 1); }).length;
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    todo, done, total, doneCount: done.length, pct: total ? Math.round((done.length / total) * 100) : 100,
    dueToday: todo.filter((x) => x.status === 'due').length, overdue: todo.filter((x) => x.status === 'overdue').length,
    sopsSigned, sopsTotal: mineDocs.length,
    tasksThisMonth: (o.tasks || []).filter((t) => Array.isArray(t.assignedStaffIds) && t.assignedStaffIds.includes(staff.id) && (dayOf(t.createdAt) >= monthStart || dayOf(t.completedAt) >= monthStart)).length,
    checklistsRun: (o.runs || []).filter((x) => x.staffId === staff.id && String(x.date || '') >= monthStart && x.completedAt).length,
  };
}
export type MyWork = ReturnType<typeof myWork>;
