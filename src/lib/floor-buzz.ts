// src/lib/floor-buzz.ts — BUZZING THE TABLE'S SERVER (server; design canvas "The floor's phones"). A server hears, on
// their own phone, the moment one of their tables needs them:
//   table_ask    a guest asks from their table's link (their server; nobody has the section: the managers)
//   food_ready   a course is all ready at the pass (once a course, not once a plate)
//   table_seated a party is seated at one of their tables
// "Their" tables are tonight's section on the host stand (each table's people, in the open service). A table nobody
// has is still on everyone's My tables; only a guest's ask goes to the managers then. Each is a notice in the app for
// each of them, and a buzz (lib/push-tier), so each person's own settings decide (kinds off, quiet hours, away).
// Never throws: a buzz must never undo what it's about.
import { PUSH_TIER } from '@/lib/push-tier';
import { tableLabel } from '@/lib/table-service';
import { askText, type GuestAsk } from '@/lib/guest-pass';
import { tellManagers } from '@/lib/tell-managers';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const off = (s: any) => !s || s.isActive === false || s.status === 'archived' || s.archived === true;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A seated party's table(s) and the people looking after them, from tonight's open service. */
export async function sectionOf(db: any, T: string, partyId: string): Promise<{ table: string; staffIds: string[]; party: any } | null> {
  if (!ID.test(partyId)) return null;
  const party: any = (await db.doc(`${T}/parties/${partyId}`).get()).data();
  if (!party) return null;
  const unitIds: string[] = (Array.isArray(party.unitIds) ? party.unitIds : []).map(String);
  const session: any = party.sessionId && ID.test(String(party.sessionId)) ? (await db.doc(`${T}/serviceSessions/${party.sessionId}`).get()).data() : null;
  const units = (Array.isArray(session?.units) ? session.units : []).filter((u: any) => unitIds.includes(String(u?.id)));
  const table = units.length ? units.map((u: any) => tableLabel(u.name)).join(' + ') : tableLabel(party.tableName || '');
  const ids = Array.from(new Set<string>(units.flatMap((u: any) => (Array.isArray(u.staffIds) ? u.staffIds : []).map(String)))).filter((x) => ID.test(x)).slice(0, 12);
  return { table, staffIds: ids, party };
}

/** A notice for each of them who's still on the team, buzzing at once for the kinds that need it. How many it reached. */
export async function tellServers(db: any, tenantId: string, staffIds: string[], n: { type: string; message: string; link?: string }): Promise<number> {
  try {
    const T = `tenants/${tenantId}`;
    const docs = staffIds.length ? await db.getAll(...staffIds.map((id) => db.doc(`${T}/staff/${id}`))) : [];
    const ids = docs.filter((d: any) => d.exists && !off(d.data())).map((d: any) => d.id);
    if (!ids.length) return 0;
    const now = new Date().toISOString(); const b = db.batch();
    for (const userId of ids) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId, type: n.type, message: clip(n.message, 300), link: n.link || '/tables', priority: 'high', read: false, createdAt: now }); }
    await b.commit();
    if (PUSH_TIER[n.type] === 'now') { const { pushNow } = await import('@/lib/push'); await pushNow(db, tenantId).catch(() => undefined); }
    return ids.length;
  } catch { return 0; }
}

/** A guest asked from their table: their server, or with nobody on the section, the managers. */
export async function tellTableAsk(db: any, tenantId: string, tenant: any, visit: any, ask: Pick<GuestAsk, 'what' | 'item'>): Promise<number> {
  try {
    const T = `tenants/${tenantId}`;
    const sec = visit?.partyId ? await sectionOf(db, T, String(visit.partyId)) : null;
    const message = askText(ask, sec?.table || tableLabel(visit?.tableName || ''));
    if (sec?.staffIds.length) { const n = await tellServers(db, tenantId, sec.staffIds, { type: 'table_ask', message }); if (n > 0) return n; }
    return Math.max(0, await tellManagers(db, tenantId, tenant, { type: 'table_ask', message, link: '/tables', priority: 'high' }));
  } catch { return 0; }
}

/** A party was just seated: their table's server, once for that seating. */
export async function tellSeated(db: any, tenantId: string, partyId: string): Promise<number> {
  try {
    const T = `tenants/${tenantId}`; const pRef = db.doc(`${T}/parties/${partyId}`);
    const claimed = await db.runTransaction(async (tx: any) => {
      const p: any = (await tx.get(pRef)).data();
      // (A seating from long ago, rung again, isn't news.)
      if (!p || p.status !== 'seated' || !p.seatedAt || p.seatedToldFor === p.seatedAt || Date.now() - Date.parse(String(p.seatedAt)) > 10 * 60000) return null;
      tx.set(pRef, { seatedToldFor: p.seatedAt }, { merge: true });
      return p;
    });
    if (!claimed) return 0;
    const sec = await sectionOf(db, T, partyId); if (!sec?.staffIds.length) return 0;
    const size = Math.max(1, Math.round(Number(claimed.size) || 1));
    const needs = Array.isArray(claimed.needs) && claimed.needs.length ? ` Asked for: ${claimed.needs.map((x: any) => clip(x, 30)).filter(Boolean).slice(0, 3).join(', ')}.` : '';
    return await tellServers(db, tenantId, sec.staffIds, { type: 'table_seated', message: `New table: ${sec.table}, party of ${size}${claimed.name ? ` (${clip(claimed.name, 40)})` : ''}.${needs}` });
  } catch { return 0; }
}

const DONE = ['ready', 'delivered'];
const GONE = ['cancelled', 'voided', 'void'];
/** A table's dish was marked ready: once everything in its course is ready (or already out), the table's server hears,
 *  with what's waiting at the pass. Each plate is told about once. */
export async function tellPassReady(db: any, tenantId: string, ticketId: string): Promise<number> {
  try {
    const T = `tenants/${tenantId}`;
    if (!ID.test(ticketId)) return 0;
    const k: any = (await db.doc(`${T}/kdsTickets/${ticketId}`).get()).data();
    if (!k || k.source !== 'tab' || !k.visitId || !ID.test(String(k.visitId)) || k.status !== 'ready') return 0;
    const course = k.course === null || k.course === undefined ? 'now' : String(k.course);
    const group = (await db.collection(`${T}/kdsTickets`).where('visitId', '==', String(k.visitId)).get()).docs
      .map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((t: any) => (t.course === null || t.course === undefined ? 'now' : String(t.course)) === course && !GONE.includes(String(t.status)) && String(t.status) !== 'unfired');
    if (!group.length || !group.every((t: any) => DONE.includes(String(t.status)))) return 0;
    const ready = group.filter((t: any) => t.status === 'ready');
    const vRef = db.doc(`${T}/appointments/${k.visitId}`);
    const fresh = await db.runTransaction(async (tx: any) => {
      const v: any = (await tx.get(vRef)).data() || {};
      const told: string[] = Array.isArray(v.passTold) ? v.passTold : [];
      const news = ready.filter((t: any) => !told.includes(t.id));
      if (!news.length) return null;
      tx.set(vRef, { passTold: [...told, ...news.map((t: any) => t.id)].slice(-200) }, { merge: true });
      return { v, news };
    });
    if (!fresh) return 0;
    const sec = fresh.v.partyId ? await sectionOf(db, T, String(fresh.v.partyId)) : null;
    if (!sec?.staffIds.length) return 0;
    const names = Array.from(new Set(fresh.news.map((t: any) => clip(t.menuItemName || t.itemName || 'A dish', 40)))) as string[];
    const what = names.length > 4 ? `${names.slice(0, 4).join(', ')} and more` : names.join(', ');
    return await tellServers(db, tenantId, sec.staffIds, { type: 'food_ready', message: `Food at the pass, ${sec.table}: ${what}.` });
  } catch { return 0; }
}

/** Many plates marked ready at once (a bump): one look per table's course, not per plate (the next plate if one has gone
 *  out meanwhile). */
export async function tellPassReadyMany(db: any, tenantId: string, ticketIds: string[]): Promise<number> {
  try {
    const ids = Array.from(new Set(ticketIds.filter((x) => ID.test(x)))); if (!ids.length) return 0;
    const groups = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 200) {
      const docs = await db.getAll(...ids.slice(i, i + 200).map((id) => db.doc(`tenants/${tenantId}/kdsTickets/${id}`)));
      for (const d of docs) { const k: any = d.exists ? d.data() || {} : null; if (!k || k.source !== 'tab' || !k.visitId || k.status !== 'ready') continue;
        const g = `${k.visitId}|${k.course === null || k.course === undefined ? 'now' : String(k.course)}`; groups.set(g, [...(groups.get(g) || []), d.id]); }
    }
    let n = 0;
    for (const list of groups.values()) for (const id of list.slice(0, 6)) {
      const told = await tellPassReady(db, tenantId, id); if (told > 0) { n += told; break; }
      // Only a plate that went out meanwhile is worth trying past: otherwise every plate of the course says the same.
      if ((await db.doc(`tenants/${tenantId}/kdsTickets/${id}`).get()).data()?.status === 'ready') break;
    }
    return n;
  } catch { return 0; }
}
