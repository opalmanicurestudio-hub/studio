// src/lib/visit-watch.ts — EVERY PROVIDER HEARS WHEN THEIR VISIT CHANGES, however it changed: moved in the planner,
// rescheduled or cancelled by the client from their link, cancelled at the desk, handed to someone else, an add-on
// given to a second provider. Every few minutes (cron/no-shows) each upcoming visit is compared with what its
// providers were last told (`staffWatch` on the visit); anything different goes to EVERYONE on it — the lead, anyone
// doing an add-on or a step, and whoever was just taken off. The first look at a visit only records it (no alert).
const OFF = ['cancelled', 'canceled', 'declined'];
const S = (v: any) => String(v ?? '');

export function providersOf(a: any): string[] {
  const ids = [a?.staffId, ...(Array.isArray(a?.assignedStaffIds) ? a.assignedStaffIds : []), ...Object.values(a?.checkoutState?.serviceStaffOverrides || {})];
  return [...new Set(ids.filter((x: any) => typeof x === 'string' && x && !x.startsWith('portal:')))].sort();
}
export type Watch = { off: boolean; at: string; by: string[] };
export const watchOf = (a: any): Watch => ({ off: OFF.includes(S(a?.status)), at: S(a?.startTime), by: providersOf(a) });

export type Alert = { to: string; kind: 'visit_cancelled' | 'visit_moved' | 'visit_added' | 'visit_removed'; text: string };
/** What changed since providers were last told, as one alert per person. Pure, for tests. */
export function alertsFor(prev: Watch, cur: Watch, a: any, fmt: (iso: string) => string): Alert[] {
  const who = String(a?.clientName || 'A client').split(' ')[0]; const svc = a?.serviceName ? ` (${a.serviceName})` : '';
  const out: Alert[] = [];
  if (!prev.off && cur.off) { for (const id of prev.by) out.push({ to: id, kind: 'visit_cancelled', text: `${who}’s ${fmt(prev.at)}${svc} was cancelled — that time is free.` }); return out; }
  if (prev.off && !cur.off) { for (const id of cur.by) out.push({ to: id, kind: 'visit_added', text: `${who}’s ${fmt(cur.at)}${svc} is back on.` }); return out; }
  if (cur.off) return out;
  const moved = prev.at !== cur.at && Number.isFinite(Date.parse(prev.at)) && Number.isFinite(Date.parse(cur.at));
  const added = cur.by.filter((x) => !prev.by.includes(x)), removed = prev.by.filter((x) => !cur.by.includes(x));
  for (const id of removed) out.push({ to: id, kind: 'visit_removed', text: `You’re no longer on ${who}’s ${fmt(prev.at)}${svc}.` });
  for (const id of added) out.push({ to: id, kind: 'visit_added', text: `You’ve been added to ${who}’s ${fmt(cur.at)}${svc}.` });
  if (moved) for (const id of cur.by.filter((x) => !added.includes(x))) out.push({ to: id, kind: 'visit_moved', text: `${who}’s visit moved from ${fmt(prev.at)} to ${fmt(cur.at)}${svc}.` });
  return out;
}

export async function watchVisits(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<number> {
  const T = `tenants/${tenantId}`; const tz = tenant?.timezone || 'America/New_York';
  const fmt = (iso: string) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return 'visit';
    const sameDay = d.toLocaleDateString('en-CA', { timeZone: tz }) === new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
    return d.toLocaleString('en-US', { ...(sameDay ? {} : { weekday: 'short', month: 'short', day: 'numeric' }), hour: 'numeric', minute: '2-digit', timeZone: tz }) + (sameDay ? ' today' : ''); };
  const snap = await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 2 * 3600000).toISOString()).where('startTime', '<=', new Date(now + 21 * 86400000).toISOString()).get();
  let sent = 0; let b = db.batch(); let n = 0; const iso = new Date(now).toISOString();
  const flush = async () => { if (n) { await b.commit(); b = db.batch(); n = 0; } };
  for (const d of snap.docs) {
    const a: any = d.data() || {}; if (a.isTable) continue;
    const cur = watchOf(a); const prev: Watch | null = a.staffWatch || null;
    if (prev && prev.off === cur.off && prev.at === cur.at && JSON.stringify(prev.by) === JSON.stringify(cur.by)) continue;
    if (prev) for (const x of alertsFor(prev, cur, a, fmt)) {
      const r = db.collection(`${T}/notifications`).doc();
      b.set(r, { id: r.id, userId: x.to, type: x.kind, appointmentId: d.id, message: x.text, link: 'today', createdAt: iso, read: false }); n++; sent++;
    }
    b.set(d.ref, { staffWatch: cur }, { merge: true }); n++;
    if (n >= 400) await flush();
  }
  await flush();
  return sent;
}
