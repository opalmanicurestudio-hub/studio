// src/lib/staff-kpis-server.ts — loads what staff numbers are worked out from (lib/staff-kpis), and ONE-ON-ONES:
// a manager books one with a team member — it goes on both schedules and blocks booking for both (staffBlocks), with
// an agenda started from the person's numbers and what was agreed last time; the person can add topics if allowed.
// Closing one keeps the notes and the agreed next steps, which come back as "Last time" on the next.
import { numbersFor, weekly, suggestedTopics, goalsOf, type Inputs } from '@/lib/staff-kpis';

const T = (t: string) => `tenants/${t}`;
const DAY = 864e5;
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const rid = () => Math.random().toString(36).slice(2, 10);

export async function loadInputs(db: any, tenantId: string, now = Date.now()): Promise<Inputs> {
  const since = new Date(now - 100 * DAY).toISOString();
  const [ap, tx, sh, cs] = await Promise.all([
    db.collection(`${T(tenantId)}/appointments`).where('startTime', '>=', since).get(),
    db.collection(`${T(tenantId)}/transactions`).where('category', '==', 'Retail').get(),
    db.collection(`${T(tenantId)}/shifts`).where('date', '>=', since.slice(0, 10)).get(),
    db.collection(`${T(tenantId)}/cases`).get().catch(() => ({ docs: [] })),
  ]);
  return { appointments: rows(ap), retail: rows(tx).filter((r: any) => String(r.date || '') >= since), shifts: rows(sh), cases: rows(cs) };
}

/** The team (not renters, not archived) — who numbers are shown for. */
export async function teamOf(db: any, tenantId: string) {
  return rows(await db.collection(`${T(tenantId)}/staff`).get()).filter((m: any) => !m.archived && m.isActive !== false && m.role !== 'renter' && !m.isRenter);
}

export async function myNumbers(db: any, tenantId: string, staffId: string, now = Date.now()) {
  const tenant = (await db.doc(T(tenantId)).get()).data() || {}; const x = await loadInputs(db, tenantId, now);
  const cur = numbersFor(x, staffId, now - 30 * DAY, now), prev = numbersFor(x, staffId, now - 60 * DAY, now - 30 * DAY);
  const next = await nextOneOnOne(db, tenantId, staffId, now);
  return { ok: true as const, goals: goalsOf(tenant), cur, prev, next };
}

export async function teamNumbers(db: any, tenantId: string, now = Date.now()) {
  const tenant = (await db.doc(T(tenantId)).get()).data() || {}; const g = goalsOf(tenant);
  const [x, team] = await Promise.all([loadInputs(db, tenantId, now), teamOf(db, tenantId)]);
  const ids = new Set(team.map((m: any) => m.id)); const tx: Inputs = { ...x, appointments: x.appointments.filter((a) => ids.has(String(a.staffId || ''))), retail: x.retail.filter((r) => ids.has(String(r.staffId || ''))), shifts: x.shifts.filter((sh) => ids.has(String(sh.staffId || ''))) };
  const cur = numbersFor(tx, null, now - 30 * DAY, now), prev = numbersFor(tx, null, now - 60 * DAY, now - 30 * DAY);
  const people = team.map((m: any) => { const c = numbersFor(tx, m.id, now - 30 * DAY, now); const w = weekly(tx, m.id, now);
    return { staffId: m.id, name: String(m.name || 'Team member'), cur: c, weeks: w, topics: suggestedTopics(c, cur, g, w) }; })
    .filter((p: any) => p.cur.visits > 0 || p.weeks.some((v: number) => v > 0)).sort((a: any, b: any) => b.cur.revenue - a.cur.revenue);
  return { ok: true as const, goals: g, cur, prev, people };
}

export async function saveGoals(db: any, tenantId: string, raw: any) {
  const g = goalsOf({ teamGoals: raw }); await db.doc(T(tenantId)).set({ teamGoals: g }, { merge: true }); return { ok: true, goals: g };
}

// ── One-on-ones ────────────────────────────────────────────────────────────────────────────────────────────────────
export async function nextOneOnOne(db: any, tenantId: string, staffId: string, now = Date.now()) {
  const list = rows(await db.collection(`${T(tenantId)}/oneOnOnes`).where('staffId', '==', staffId).get()).filter((o: any) => o.status === 'booked' && Date.parse(o.startTime) >= now - 3600e3)
    .sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)));
  return list[0] || null;
}

export async function oneOnOnesFor(db: any, tenantId: string, staffId: string) {
  return rows(await db.collection(`${T(tenantId)}/oneOnOnes`).where('staffId', '==', staffId).get()).sort((a: any, b: any) => String(b.startTime).localeCompare(String(a.startTime))).slice(0, 12);
}

/** What the agenda starts with: their numbers' topics, and last time's next steps that aren't done. */
export async function startingAgenda(db: any, tenantId: string, staffId: string, now = Date.now()) {
  const t = await teamNumbers(db, tenantId, now); const me = t.people.find((p: any) => p.staffId === staffId);
  const past = (await oneOnOnesFor(db, tenantId, staffId)).find((o: any) => o.status === 'done');
  const carried = (past?.nextSteps || []).filter((x: any) => !x.done).map((x: any) => ({ id: rid(), text: s(x.text, 200), source: 'last' }));
  return [...(me?.topics || []).map((text: string) => ({ id: rid(), text, source: 'numbers' })), ...carried];
}

async function blocksFree(db: any, tenantId: string, staffId: string, start: number, end: number) {
  const [ap, bl] = await Promise.all([db.collection(`${T(tenantId)}/appointments`).where('staffId', '==', staffId).get(), db.collection(`${T(tenantId)}/staffBlocks`).where('staffId', '==', staffId).get()]);
  const DEAD = ['cancelled', 'canceled', 'no_show', 'declined', 'expired'];
  const clash = (s0: number, e0: number) => s0 < end && e0 > start;
  return !ap.docs.some((d: any) => { const o = d.data() || {}; return !DEAD.includes(String(o.status || '')) && clash(Date.parse(o.startTime), Date.parse(o.endTime || o.startTime) || Date.parse(o.startTime) + (Number(o.duration) || 60) * 60000); })
    && !bl.docs.some((d: any) => { const o = d.data() || {}; const s0 = Date.parse(o.startTime); return clash(s0, s0 + (Number(o.duration) || 0) * 60000); });
}

export async function bookOneOnOne(db: any, tenantId: string, by: { staffId: string; name: string }, x: { staffId: string; startTime: string; minutes?: number; agenda?: any[]; staffCanAdd?: boolean }) {
  const start = Date.parse(String(x.startTime || '')); if (!Number.isFinite(start) || start < Date.now() - 600000) return { ok: false, error: 'Pick a time that hasn’t passed.' };
  const minutes = Math.max(10, Math.min(120, Math.round(Number(x.minutes) || 30))); const end = start + minutes * 60000;
  const who: any = (await db.doc(`${T(tenantId)}/staff/${s(x.staffId, 120)}`).get()).data(); if (!who) return { ok: false, error: 'That team member isn’t here.' };
  for (const id of [x.staffId, by.staffId]) if (id && !(await blocksFree(db, tenantId, id, start, end))) return { ok: false, error: id === by.staffId ? 'You’re busy then — pick another time.' : `${String(who.name || 'They').split(' ')[0]} is busy then — pick another time.` };
  const ref = db.collection(`${T(tenantId)}/oneOnOnes`).doc(); const now = new Date().toISOString();
  const agenda = (Array.isArray(x.agenda) ? x.agenda : []).slice(0, 12).map((a: any) => ({ id: s(a.id, 20) || rid(), text: s(a.text, 200), source: ['numbers', 'last', 'staff'].includes(a.source) ? a.source : 'manager', done: false })).filter((a: any) => a.text);
  await ref.set({ id: ref.id, staffId: x.staffId, staffName: who.name || 'Team member', managerId: by.staffId, managerName: by.name, startTime: new Date(start).toISOString(), minutes, agenda, staffCanAdd: x.staffCanAdd !== false, status: 'booked', createdAt: now });
  // On both schedules, and nobody can book either of them then.
  for (const id of [x.staffId, by.staffId].filter(Boolean)) await db.doc(`${T(tenantId)}/staffBlocks/oneonone_${ref.id}_${id}`).set({ staffId: id, startTime: new Date(start).toISOString(), duration: minutes, reason: 'one_on_one', oneOnOneId: ref.id, title: id === x.staffId ? `One-on-one with ${String(by.name).split(' ')[0]}` : `One-on-one with ${String(who.name || '').split(' ')[0]}`, createdAt: now });
  const n = db.collection(`${T(tenantId)}/notifications`).doc();
  await n.set({ id: n.id, userId: x.staffId, type: 'one_on_one', message: `${String(by.name).split(' ')[0]} booked a one-on-one with you: ${new Date(start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: (await db.doc(T(tenantId)).get()).data()?.timezone || 'America/New_York' })}.${agenda.length ? ` Agenda: ${agenda.map((a: any) => a.text).join('; ').slice(0, 160)}` : ''}`, link: '', createdAt: now, read: false });
  return { ok: true, id: ref.id };
}

export async function addTopic(db: any, tenantId: string, who: { staffId: string; manager: boolean }, id: string, text: string) {
  const ref = db.doc(`${T(tenantId)}/oneOnOnes/${s(id, 60)}`); const o: any = (await ref.get()).data(); if (!o) return { ok: false, error: 'Not found.' };
  const mine = o.staffId === who.staffId; if (!(who.manager || o.managerId === who.staffId || (mine && o.staffCanAdd))) return { ok: false, error: 'You can’t add topics to this one.' };
  const t = s(text, 200); if (!t) return { ok: false, error: 'Write the topic.' };
  await ref.set({ agenda: [...(o.agenda || []), { id: rid(), text: t, source: mine ? 'staff' : 'manager', done: false }] }, { merge: true }); return { ok: true };
}

export async function closeOneOnOne(db: any, tenantId: string, who: { staffId: string; manager: boolean }, id: string, x: { notes?: string; nextSteps?: string[]; cancel?: boolean }) {
  const ref = db.doc(`${T(tenantId)}/oneOnOnes/${s(id, 60)}`); const o: any = (await ref.get()).data(); if (!o) return { ok: false, error: 'Not found.' };
  if (!(who.manager || o.managerId === who.staffId)) return { ok: false, error: 'The manager closes it.' };
  const now = new Date().toISOString();
  await ref.set(x.cancel ? { status: 'cancelled', cancelledAt: now } : { status: 'done', doneAt: now, notes: s(x.notes, 4000), nextSteps: (x.nextSteps || []).map((t) => s(t, 200)).filter(Boolean).slice(0, 8).map((text) => ({ id: rid(), text, done: false })) }, { merge: true });
  if (x.cancel) for (const sid of [o.staffId, o.managerId].filter(Boolean)) { try { await db.doc(`${T(tenantId)}/staffBlocks/oneonone_${id}_${sid}`).delete(); } catch { /* gone */ } }
  return { ok: true };
}
