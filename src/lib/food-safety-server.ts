// src/lib/food-safety-server.ts — THE BINDER'S RECORDS (lib/food-safety; api/kitchen 'safety', api/binder; the Binder
// page and the kitchen screen's Food safety sheet).
//   tenants/{t}/safetyLogs/{id}       { kind, day, at, by, byId, item, tempF, ok, limit, note, supplier?, deliveryKind?,
//                                       cooling?: { startedAt, checks: [{ at, tempF, by }], state, done?, doneBy?, doneAt?, toldLate? } }
//                                     cooling.state as kept: 'cooling'; 'done'; 'missed' (its mark passed, nothing written
//                                     about what was done yet); 'handled' (missed, and what was done written down);
//                                     'lapsed' (missed, nothing written within a day). Shown, the state is worked out again
//                                     from the readings and the clock (coolState).
//   tenants/{t}/permits/{id}          { kind, label, staffId, person, expires, note, reminded: { '60'?, '14'?, out? }, by, at }
//   tenants/{t}/safetyIncidents/{id}  { kind, day, at, by, what, person, staffId, name, done, ate, clearedAt?, clearedBy? }
// Equipment and service are preventive maintenance plans (tenants/{t}/maintenancePlans, binder: true), done when their
// ticket is resolved. A reading outside its limit, a cooling that missed its mark (or nobody checked in time), and a
// certificate or permit about to run out tell the managers (lib/tell-managers).
import { tonight } from '@/lib/night-close-server';
import { closeSettingsOf } from '@/lib/night-close';
import { tenantTimeZone } from '@/lib/tenant-time';
import { tellManagers } from '@/lib/tell-managers';
import { addDaysISO } from '@/lib/maintenance';
import { cleanIncident, cleanLog, cleanPermit, cleanTemp, coolState, daysLeft, limitWords, permitState, REMIND_DAYS, SERVICE_PRESETS, tempOk, type CoolCheck, type LogKind } from '@/lib/food-safety';
import { ALLERGENS, allergensKnown, itemAllergens } from '@/lib/allergens';
import { isMenuItem } from '@/lib/menu-server';
import { monthDays, toCsv } from '@/lib/records';

export class SafetyStop extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export type By = { name: string; staffId: string | null };

const coolOf = (x: any, now: number, tz: string) => {
  const c = x.cooling || {}; const checks: CoolCheck[] = Array.isArray(c.checks) ? c.checks : [];
  const st = coolState(String(c.startedAt || x.at), checks, now, tz);
  return { ...st, startedAt: String(c.startedAt || x.at), checks, done: c.done || null, doneBy: c.doneBy || null, doneAt: c.doneAt || null, last: checks.length ? checks[checks.length - 1] : null };
};
export function logView(id: string, x: any, now: number, tz: string) {
  return { id, kind: x.kind as LogKind, day: x.day, at: x.at, by: x.by, item: x.item, tempF: x.tempF, ok: x.ok !== false, limit: x.limit || '', note: x.note || null, supplier: x.supplier || null, deliveryKind: x.deliveryKind || null,
    ...(x.kind === 'cooling' ? { cooling: coolOf(x, now, tz) } : {}) };
}
export type LogView = ReturnType<typeof logView>;

/** A food safety reading, logged now by who took it. */
export async function recordLog(db: any, tenantId: string, tenant: any, raw: any, by: By): Promise<LogView> {
  const T = `tenants/${tenantId}`; const now = Date.now(); const tz = tenantTimeZone(tenant);
  const c = cleanLog(raw, now); if ('error' in c) throw new SafetyStop(c.error, 422);
  const ok = c.kind === 'delivery' ? tempOk(c.deliveryKind!, c.tempF) : c.kind === 'cooling' ? true : tempOk(c.kind, c.tempF);
  const ref = db.collection(`${T}/safetyLogs`).doc(); const at = new Date(now).toISOString();
  const doc: any = { id: ref.id, kind: c.kind, day: tonight(tenant, new Date(now)), at, by: words(by.name, 60) || 'Someone', byId: by.staffId || null, item: c.item, tempF: c.tempF, ok, note: c.note || null,
    limit: c.kind === 'delivery' ? limitWords(c.deliveryKind!) : c.kind === 'cooling' ? '70°F within 2 hours, then 41°F within 4 more' : limitWords(c.kind),
    ...(c.kind === 'delivery' ? { supplier: c.supplier || null, deliveryKind: c.deliveryKind } : {}),
    ...(c.kind === 'cooling' ? { cooling: { startedAt: c.startedAt, checks: [], state: 'cooling' } } : {}) };
  await ref.set(doc);
  if (!ok) await tellManagers(db, tenantId, tenant, { type: 'food_safety', link: '/binder', message: c.kind === 'delivery'
    ? `${c.item}${c.supplier ? ` from ${c.supplier}` : ''} came in at ${c.tempF}°F, over ${limitWords(c.deliveryKind!)} (${doc.by}). ${c.note}`
    : `${c.kind === 'hot' ? 'Hot holding' : 'Cold holding'}: ${c.item} at ${c.tempF}°F, outside ${doc.limit} (${doc.by}). What was done: ${c.note}` }).catch(() => -1);
  return logView(ref.id, doc, now, tz);
}

/** A cooling batch checked: the reading added; a mark missed needs what was done (reheated, or thrown out). A batch
 *  that missed its mark with nobody checking takes what was done afterwards (the reading is then optional). */
export async function coolCheck(db: any, tenantId: string, tenant: any, logId: string, rawTemp: unknown, rawDone: unknown, by: By): Promise<LogView> {
  const T = `tenants/${tenantId}`; const now = Date.now(); const tz = tenantTimeZone(tenant);
  if (!ID.test(logId)) throw new SafetyStop('Which batch?');
  const typed = String(rawTemp ?? '').trim() !== ''; const tempF = typed ? cleanTemp(rawTemp) : null;
  if (typed && tempF === null) throw new SafetyStop('The temperature, in °F, like 68.');
  const done = words(rawDone, 200) || null; const ref = db.doc(`${T}/safetyLogs/${logId}`);
  const out = await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data(); if (!x || x.kind !== 'cooling') throw new SafetyStop('That batch isn’t being cooled any more.', 404);
    const before = coolOf(x, now, tz);
    if (before.state === 'done') throw new SafetyStop('That batch is already cooled.', 409);
    const reading = tempF !== null ? [{ at: new Date(now).toISOString(), tempF, by: words(by.name, 60) || 'Someone' }] : [];
    if (before.state === 'missed') {
      // Past its mark already: what was done is all that's left to write down, once.
      if (x.cooling?.done) throw new SafetyStop('That batch missed its mark; it’s been dealt with.', 409);
      if (!done) throw new SafetyStop(`${before.missedWords} Say which.`, 422);
      const cooling = { ...x.cooling, checks: [...before.checks, ...reading], state: 'handled', done, doneBy: words(by.name, 60) || 'Someone', doneAt: new Date(now).toISOString() };
      tx.set(ref, { cooling, ok: false }, { merge: true });
      return { x: { ...x, cooling, ok: false }, missed: true };
    }
    if (tempF === null) throw new SafetyStop('The temperature, in °F, like 68.');
    const checks: CoolCheck[] = [...before.checks, ...reading];
    const after = coolState(before.startedAt, checks, now, tz);
    if (after.state === 'missed' && !done) throw new SafetyStop(`${after.missedWords} Say which.`, 422);
    const cooling = { ...x.cooling, checks, ...(after.state === 'missed' ? { state: 'handled', done, doneBy: words(by.name, 60) || 'Someone', doneAt: new Date(now).toISOString() } : { state: after.state }) };
    tx.set(ref, { cooling, ok: after.state !== 'missed' }, { merge: true });
    return { x: { ...x, cooling, ok: after.state !== 'missed' }, missed: after.state === 'missed' };
  });
  if (out.missed) await tellManagers(db, tenantId, tenant, { type: 'food_safety', link: '/binder', message: `Cooling: ${out.x.item} missed its mark${tempF !== null ? ` (${tempF}°F)` : ''}. What was done: ${done} (${words(by.name, 60)}).` }).catch(() => -1);
  return logView(logId, out.x, now, tz);
}

/** Batches past their mark with nobody checking: marked missed, and the managers told, once (the kitchen screen runs this
 *  every minute while it's open; the hourly run catches the rest). Returns the batches still cooling, next mark first. */
export async function coolingSweep(db: any, tenantId: string, tenant: any): Promise<LogView[]> {
  const T = `tenants/${tenantId}`; const now = Date.now(); const tz = tenantTimeZone(tenant);
  const open = await db.collection(`${T}/safetyLogs`).where('cooling.state', '==', 'cooling').limit(50).get().catch(() => ({ docs: [] as any[] }));
  const cooling: LogView[] = [];
  for (const d of open.docs) {
    const v = logView(d.id, d.data() || {}, now, tz); if (!v.cooling) continue;
    if (v.cooling.state === 'cooling') { cooling.push(v); continue; }
    if (v.cooling.state !== 'missed') continue;
    // Read again inside a transaction, so a reading taken this moment isn't written over.
    const late = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(d.ref)).data(); if (!x?.cooling || x.cooling.state !== 'cooling' || x.cooling.toldLate) return null;
      const st = coolOf(x, now, tz); if (st.state !== 'missed') return null;
      tx.set(d.ref, { cooling: { ...x.cooling, state: 'missed', toldLate: true }, ok: false }, { merge: true });
      return { item: String(x.item || 'A batch'), st };
    }).catch(() => null);
    if (!late) continue;
    const told = await tellManagers(db, tenantId, tenant, { type: 'food_safety', link: '/binder', message: `Cooling: nobody checked ${late.item} by its mark (${late.st.dueWords}). ${late.st.missedWords}` }).catch(() => -1);
    // Not told (the database didn't take the notices): back to cooling, so the next run marks it and tells them again.
    if (told < 0) await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(d.ref)).data(); if (!x?.cooling || x.cooling.state !== 'missed' || x.cooling.done) return;
      tx.set(d.ref, { cooling: { ...x.cooling, state: 'cooling', toldLate: false } }, { merge: true });
    }).catch(() => undefined);
  }
  return cooling.sort((a, b) => String(a.cooling!.dueAt).localeCompare(String(b.cooling!.dueAt)));
}

/** Today's logs on the kitchen screen; the batches still cooling (from the last day), each with its next mark; and those
 *  that missed it in the last day with nothing written down yet about what was done. */
export async function todaySafety(db: any, tenantId: string, tenant: any): Promise<{ day: string; logs: LogView[]; cooling: LogView[]; undone: LogView[] }> {
  const T = `tenants/${tenantId}`; const tz = tenantTimeZone(tenant); const day = tonight(tenant);
  const cooling = await coolingSweep(db, tenantId, tenant); const now = Date.now();
  const [todays, missed] = await Promise.all([
    db.collection(`${T}/safetyLogs`).where('day', '==', day).limit(300).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/safetyLogs`).where('cooling.state', '==', 'missed').limit(100).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const logs = todays.docs.map((d: any) => logView(d.id, d.data() || {}, now, tz)).sort((a: LogView, b: LogView) => b.at.localeCompare(a.at));
  const undone: LogView[] = [];
  for (const d of missed.docs) {
    const v = logView(d.id, d.data() || {}, now, tz); if (!v.cooling || v.cooling.done) continue;
    if (now - Date.parse(v.cooling.startedAt) < 24 * 3600000) { undone.push(v); continue; }
    // A day on with nothing written: it stays on the Binder as missed, and leaves the kitchen screen's list (and this
    // query, so it never crowds out today's).
    await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(d.ref)).data(); if (!x?.cooling || x.cooling.state !== 'missed' || x.cooling.done) return;
      tx.set(d.ref, { cooling: { ...x.cooling, state: 'lapsed' } }, { merge: true });
    }).catch(() => undefined);
  }
  undone.sort((a, b) => String(a.cooling!.dueAt).localeCompare(String(b.cooling!.dueAt)));
  return { day, logs, cooling, undone };
}

/** Every reading as a spreadsheet, in the order they were taken: when (the business's own clock), the log, what, the
 *  temperature, its limit, whether it was within it, who took it, and what was done (a cooling batch's checks in words). */
export function safetyCsv(logs: LogView[], tz: string): string {
  const when = (iso: string) => { try { return new Date(iso).toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
  const kindOf = (l: LogView) => (l.kind === 'delivery' ? `Delivery, ${l.deliveryKind || 'cold'}` : l.kind === 'cooling' ? 'Cooling' : l.kind === 'hot' ? 'Hot holding' : 'Cold holding');
  const cool = (l: LogView) => { const c = l.cooling; if (!c) return ''; const checks = c.checks.map((k) => `${k.tempF}°F at ${when(k.at)} (${k.by})`).join('; ');
    return `${checks}${checks ? '. ' : ''}${c.state === 'done' ? 'Cooled in time.' : c.state === 'missed' ? `Missed its mark${c.done ? `: ${c.done}${c.doneBy ? ` (${c.doneBy})` : ''}` : ', nothing written about what was done'}.` : `Still cooling, next ${c.dueWords}.`}`; };
  return toCsv(['When', 'Log', 'What', 'From', 'Temperature (°F)', 'Limit', 'Within the limit', 'Taken by', 'What was done'],
    logs.map((l) => [when(l.at), kindOf(l), l.item, l.supplier || '', l.tempF, l.limit, l.kind === 'cooling' ? (l.cooling?.state === 'missed' ? 'No' : l.cooling?.state === 'done' ? 'Yes' : 'Still cooling') : l.ok ? 'Yes' : 'No', l.by, l.kind === 'cooling' ? cool(l) : l.note || '']));
}

/** The month for the binder: every log, and the closing temperatures and dish machine readings, with what was out. */
export async function monthSafety(db: any, tenantId: string, tenant: any, month: string) {
  const T = `tenants/${tenantId}`; const now = Date.now(); const tz = tenantTimeZone(tenant); const days = monthDays(month, tonight(tenant));
  type Out = { day: string; label: string; tempF: number; note: string | null };
  if (!days.length) return { logs: [] as LogView[], closing: { nights: 0, readings: 0, out: [] as Out[] }, machine: { readings: 0, out: 0 } };
  const [ls, closes, mc] = await Promise.all([
    db.collection(`${T}/safetyLogs`).where('day', '>=', days[0]).where('day', '<=', days[days.length - 1]).limit(5000).get().catch(() => ({ docs: [] as any[] })),
    db.getAll(...days.map((d) => db.doc(`${T}/nightCloses/${d}`))),
    db.collection(`${T}/machineChecks`).where('day', '>=', days[0]).where('day', '<=', days[days.length - 1]).limit(3000).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const logs = ls.docs.map((d: any) => logView(d.id, d.data() || {}, now, tz)).sort((a: LogView, b: LogView) => a.at.localeCompare(b.at));
  let nights = 0, readings = 0; const out: Out[] = []; const labelOf = new Map(closeSettingsOf(tenant).items.map((i) => [i.id, i.label]));
  closes.forEach((s: any, i: number) => {
    const c: any = s?.exists ? s.data() || {} : null; if (!c?.checks) return; let any = false;
    for (const [id, m] of Object.entries<any>(c.checks)) { if (typeof m?.value !== 'number') continue; any = true; readings++; if (m.out) out.push({ day: days[i], label: labelOf.get(id) || 'A fridge or freezer', tempF: m.value, note: words(m.note, 80) || null }); }
    if (any) nights++;
  });
  const machine = mc.docs.map((d: any) => d.data() || {});
  return { logs, closing: { nights, readings, out }, machine: { readings: machine.length, out: machine.filter((m: any) => m.ok === false).length } };
}

// CERTIFICATES AND PERMITS
export async function savePermit(db: any, tenantId: string, raw: any, by: string): Promise<{ id: string }> {
  const T = `tenants/${tenantId}`; const p = cleanPermit(raw); if ('error' in p) throw new SafetyStop(p.error);
  let person: string | null = null;
  if (p.staffId) { const st: any = (await db.doc(`${T}/staff/${p.staffId}`).get()).data(); if (!st) throw new SafetyStop('That person isn’t on the team.', 404); person = words(st.name || [st.firstName, st.lastName].filter(Boolean).join(' '), 60) || 'Team member'; }
  const id = ID.test(String(raw?.id || '')) ? String(raw.id) : db.collection(`${T}/permits`).doc().id;
  const ref = db.doc(`${T}/permits/${id}`); const cur: any = (await ref.get()).data() || null;
  // A new date starts its reminders again.
  await ref.set({ id, ...p, person, by: words(by, 60), at: new Date().toISOString(), reminded: cur && cur.expires === p.expires ? cur.reminded || {} : {} });
  return { id };
}
/** Reminders, from the nightly run: 60 days before, 14 days before, and once run out. */
export async function permitSweep(db: any, tenantId: string, tenant: any): Promise<number> {
  const T = `tenants/${tenantId}`; const today = tonight(tenant); let told = 0;
  const snap = await db.collection(`${T}/permits`).limit(500).get().catch(() => ({ docs: [] as any[] }));
  const staff = new Map<string, string>();
  for (const d of snap.docs) {
    const p: any = d.data() || {}; if (!p.expires) continue; const left = daysLeft(p.expires, today);
    const stage = left < 0 ? 'out' : left <= 14 ? '14' : left <= REMIND_DAYS ? '60' : null; if (!stage || p.reminded?.[stage]) continue;
    if (p.staffId && !staff.has(p.staffId)) { const s: any = (await db.doc(`${T}/staff/${p.staffId}`).get()).data() || {}; staff.set(p.staffId, words(s.name, 60) || words(p.person, 60) || 'Someone'); }
    const whose = p.staffId ? `${staff.get(p.staffId)}’s ` : '';
    const when = new Date(`${p.expires}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    await tellManagers(db, tenantId, tenant, { type: 'permit_due', link: '/binder', message: stage === 'out' ? `${whose}${p.label} ran out on ${when}. Renew it, then put in the new date on the Binder.` : `${whose}${p.label} runs out on ${when}, in ${left} ${left === 1 ? 'day' : 'days'}. Renew it, then put in the new date on the Binder.` }).catch(() => -1);
    await d.ref.set({ reminded: { ...(p.reminded || {}), [stage]: new Date().toISOString() } }, { merge: true });
    told++;
  }
  return told;
}

// EQUIPMENT AND SERVICE (preventive maintenance plans, lib/maintenance)
export async function addService(db: any, tenantId: string, tenant: any, presetId: unknown, lastDone: unknown): Promise<{ id: string }> {
  const T = `tenants/${tenantId}`; const p = SERVICE_PRESETS.find((x) => x.id === presetId); if (!p) throw new SafetyStop('Which service?');
  const today = tonight(tenant); const last = /^\d{4}-\d{2}-\d{2}$/.test(String(lastDone || '')) && String(lastDone) <= today ? String(lastDone) : null;
  const dup = await db.collection(`${T}/maintenancePlans`).where('binderKind', '==', p.id).limit(1).get().catch(() => ({ empty: true, docs: [] as any[] }));
  if (!dup.empty) throw new SafetyStop(`${p.title} is already on the list.`, 409);
  const ref = db.collection(`${T}/maintenancePlans`).doc();
  // The first ticket opens when it's next due: from when it was last done, else today.
  await ref.set({ id: ref.id, title: p.title, description: p.description, category: 'safety', priority: 'normal', everyDays: p.everyDays, nextRunAt: last ? addDaysISO(last, p.everyDays) : today, lastDoneAt: last, active: true, binder: true, binderKind: p.id, createdAt: new Date().toISOString() });
  return { id: ref.id };
}
export async function serviceList(db: any, tenantId: string, tenant: any) {
  const T = `tenants/${tenantId}`; const today = tonight(tenant);
  const plans = (await db.collection(`${T}/maintenancePlans`).limit(300).get().catch(() => ({ docs: [] as any[] }))).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((p: any) => p.binder === true || p.category === 'safety');
  const ids = plans.map((p: any) => p.id); const last = new Map<string, { at: string; note: string | null }>();
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection(`${T}/tickets`).where('planId', 'in', ids.slice(i, i + 30)).limit(1000).get().catch(() => ({ docs: [] as any[] }));
    for (const d of snap.docs) { const t: any = d.data() || {}; if (t.status !== 'resolved' || !t.resolvedAt) continue; const cur = last.get(t.planId); if (!cur || String(t.resolvedAt) > cur.at) last.set(t.planId, { at: String(t.resolvedAt), note: Array.isArray(t.updates) && t.updates.length ? words(t.updates[t.updates.length - 1]?.note, 120) || null : null }); }
  }
  return plans.map((p: any) => {
    const done = last.get(p.id); const lastAt = done?.at?.slice(0, 10) || p.lastDoneAt || null; const next = String(p.nextRunAt || '').slice(0, 10) || null;
    return { id: p.id, binderKind: p.binderKind || null, title: words(p.title, 80), everyDays: Number(p.everyDays) || 30, lastDone: lastAt, note: done?.note || null, next, active: p.active !== false, late: !!next && next < today && (!lastAt || lastAt < next) };
  }).sort((a: any, b: any) => String(a.next || '9').localeCompare(String(b.next || '9')));
}

// INCIDENTS
export async function addIncident(db: any, tenantId: string, tenant: any, raw: any, by: string): Promise<{ id: string }> {
  const T = `tenants/${tenantId}`; const c = cleanIncident(raw); if ('error' in c) throw new SafetyStop(c.error);
  let name: string | null = null;
  if (c.staffId) { const s: any = (await db.doc(`${T}/staff/${c.staffId}`).get()).data(); if (!s) throw new SafetyStop('That person isn’t on the team.', 404); name = words(s.name, 60) || 'Team member'; }
  const ref = db.collection(`${T}/safetyIncidents`).doc(); const at = new Date().toISOString();
  await ref.set({ id: ref.id, ...c, name, day: tonight(tenant), at, by: words(by, 60), clearedAt: null, clearedBy: null });
  return { id: ref.id };
}
export async function clearIncident(db: any, tenantId: string, id: string, by: string): Promise<void> {
  if (!ID.test(id)) throw new SafetyStop('Which one?');
  const ref = db.doc(`tenants/${tenantId}/safetyIncidents/${id}`); const x: any = (await ref.get()).data();
  if (!x || x.kind !== 'sent_home') throw new SafetyStop('That isn’t someone sent home.', 404);
  if (x.clearedAt) return;
  await ref.set({ clearedAt: new Date().toISOString(), clearedBy: words(by, 60) }, { merge: true });
}

/** Every menu item with what it contains, for the allergen chart (one with nothing set yet is said apart). */
export function allergenChart(items: [string, any][]) {
  const menu = items.filter(([, x]) => isMenuItem(x) && x.showInConcierge !== false);
  const rows = menu.filter(([, x]) => allergensKnown(x)).map(([id, x]) => ({ id, name: words(x.name, 80) || 'Item', section: words(x.category, 40), keys: itemAllergens(x) as string[] }))
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  return { columns: ALLERGENS.map((a) => ({ key: a.key as string, label: a.label })), rows, unset: menu.filter(([, x]) => !allergensKnown(x)).map(([, x]) => words(x.name, 80) || 'Item').sort() };
}

/** Everything on the Binder page for a month. */
export async function binderView(db: any, tenantId: string, tenant: any, month: string) {
  const T = `tenants/${tenantId}`; const today = tonight(tenant);
  const [safety, permitsSnap, staffSnap, service, incSnap, inv] = await Promise.all([
    monthSafety(db, tenantId, tenant, month),
    db.collection(`${T}/permits`).limit(500).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/staff`).limit(500).get().catch(() => ({ docs: [] as any[] })),
    serviceList(db, tenantId, tenant),
    db.collection(`${T}/safetyIncidents`).where('day', '>=', `${month}-01`).where('day', '<=', `${month}-31`).limit(500).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(3000).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.isActive !== false && s.status !== 'archived' && s.archived !== true && s.role !== 'renter' && !s.isRenter)
    .map((s: any) => ({ id: s.id, name: words(s.name || [s.firstName, s.lastName].filter(Boolean).join(' '), 60) || 'Team member' }));
  const nameOf = new Map<string, string>(staff.map((s: any) => [s.id, s.name]));
  const permits = permitsSnap.docs.map((d: any) => { const p: any = d.data() || {}; return { id: d.id, kind: p.kind, label: words(p.label, 80), staffId: p.staffId || null, person: p.staffId ? nameOf.get(p.staffId) || (p.person ? `${words(p.person, 60)}, no longer on the team` : 'Someone no longer on the team') : null, expires: p.expires || null, note: p.note || null, state: permitState(p, today) }; })
    .sort((a: any, b: any) => String(a.expires || '9').localeCompare(String(b.expires || '9')));
  const handlerIds = new Set(permits.filter((p: any) => p.kind === 'handler' && p.state !== 'out').map((p: any) => p.staffId));
  const incidents = incSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
  return {
    month, today, timeZone: tenantTimeZone(tenant), safety, permits, service, incidents, staff,
    handlers: { onFile: staff.filter((s: any) => handlerIds.has(s.id)).length, team: staff.length, missing: staff.filter((s: any) => !handlerIds.has(s.id)).map((s: any) => s.name) },
    allergens: allergenChart(inv.docs.map((d: any) => [d.id, d.data() || {}])),
  };
}
