// src/lib/event-pass.ts — THE EVENT PASS (server; design board "The event pass", A: one pass that follows the evening).
// A guest's own link to their places (lib/event-places) becomes their pass: before the event, the ticket with its entry
// code, who's in their party with each one's table, seat, meal and allergies, and how to get there; on the day, the code
// first; once they're checked in, that they're in.
//   - The entry code is the party's own: a QR the team scans with any phone signed in to the app (it opens the event's
//     manifest with that party: Scan at the door), or its 4 digits typed at the door. Both are worked out from the party
//     and signed like the guest's link, so nothing new is stored; a code from another event, or for places canceled,
//     finds nothing. Four digits can match more than one party at a big event: the door then shows each to pick from.
//   - Paid tickets get a party too (lib/event-tickets), so a buyer gets the same pass in their confirmation.
//   - The pass shows only the buyer's own party: each place's first name, never anyone else's.
import { createHash } from 'crypto';
import { checkPortalKey, portalKey } from '@/lib/portal-key';
import { linkOrigin } from '@/lib/app-origin';
import { PARTY_RE, firstOf } from '@/lib/event-places';
import { allergyList } from '@/lib/event-guest-link';

const door = (eventId: string, partyId: string) => `event-door:${eventId}:${partyId}`;
/** The signature on a party's entry code (null when links can't be signed here). */
export const doorKey = (tenantId: string, eventId: string, partyId: string) => portalKey(tenantId, door(eventId, partyId));
export const doorKeyOk = (tenantId: string, eventId: string, partyId: unknown, key: unknown) =>
  typeof partyId === 'string' && PARTY_RE.test(partyId) && checkPortalKey(tenantId, door(eventId, partyId), key);
/** The 4 digits typed at the door when a camera can't read the code, from the signature (so only the server knows them). */
export function doorDigits(tenantId: string, eventId: string, partyId: string): string | null {
  const k = doorKey(tenantId, eventId, partyId); if (!k) return null;
  return String(parseInt(createHash('sha256').update(`digits:${k}`).digest('hex').slice(0, 8), 16) % 10000).padStart(4, '0');
}
/** What the QR holds: the event's manifest, opened on that party (?door=party.key). */
export function doorUrl(tenant: any, origin: string | null, tenantId: string, eventId: string, partyId: string): string | null {
  const k = doorKey(tenantId, eventId, partyId); const base = linkOrigin(tenant, origin || '');
  return k && base ? `${base}/events/${encodeURIComponent(eventId)}/manifest?door=${partyId}.${k}` : null;
}

/** What was scanned or typed at the door: a party's signed code (the QR, or its link pasted), or 4 digits. */
export function readDoor(scan: unknown): { partyId: string; key: string } | { digits: string } | null {
  const s = String(scan ?? '').trim().slice(0, 600);
  if (/^\d{4}$/.test(s.replace(/\s+/g, ''))) return { digits: s.replace(/\s+/g, '') };
  let v = s; try { const u = new URL(s); v = u.searchParams.get('door') || ''; } catch { /* the code itself */ }
  const m = /^(p[a-f0-9]{24})\.([A-Za-z0-9_-]{32})$/.exec(v);
  return m ? { partyId: m[1], key: m[2] } : null;
}

/** Days from today to the event, in the business's calendar (the pass's "In 3 days", "Tomorrow"). */
export const daysTo = (date: unknown, today: string) => { const d = String(date || ''); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) : null; };
/** Where the pass is in the evening: before the day, on the day (the code first), once they're in, or over. */
export type PassStage = 'before' | 'today' | 'in' | 'over' | 'cancelled';
export function passStage(ev: any, today: string, party: { checkedIn?: boolean }[]): PassStage {
  if (String(ev?.status || '') === 'cancelled') return 'cancelled';
  const day = String(ev?.date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < today) return 'over';
  if (party.some((g) => g.checkedIn === true)) return 'in';
  return day === today ? 'today' : 'before';
}

export type PassPlace = { id: string; first: string; you: boolean; seat: string | null; table: string | null; seatNo: string | null; meal: string | null; allergies: string[]; severe: boolean; checkedIn: boolean };
/** Each place in the party as the pass shows it: first names only (a guest's guests are "Dana’s guest 1" until named),
 *  table and seat, the meal chosen (dish names, by course) and the allergies told to the kitchen (the lead's own, and
 *  those of guests the lead added; never those of a member with an email of their own). */
export function passPlaces(party: any[], menu: { id: string; name: string; courseNumber?: number }[]): PassPlace[] {
  const dish = new Map(menu.map((m) => [String(m.id), String(m.name || '').slice(0, 80)]));
  const lead = firstOf(party[0]?.name) || 'Guest';
  return party.slice(0, 50).map((g, i) => {
    const named = !/\(guest \d+\)\s*$/i.test(String(g.name || ''));
    const picks = g.courseSelections && typeof g.courseSelections === 'object'
      ? Object.keys(g.courseSelections).sort((a, b) => Number(a) - Number(b)).map((c) => dish.get(String(g.courseSelections[c])) || '').filter(Boolean)
      : g.mealChoiceId ? [dish.get(String(g.mealChoiceId)) || ''].filter(Boolean) : [];
    // (Allergies the lead told, for themselves or a guest they added; a member with their own email keeps theirs.)
    const al = i === 0 || !String(g.email || '').trim() ? allergyList(g.allergies) : [];
    const table = g.tableNumber != null && String(g.tableNumber).trim() ? String(g.tableNumber).slice(0, 20) : null;
    const seatNo = g.seatNumber != null && String(g.seatNumber).trim() ? String(g.seatNumber).slice(0, 20) : null;
    return { id: String(g.id), first: i === 0 ? lead : named ? firstOf(g.name) || `${lead}’s guest ${i}` : `${lead}’s guest ${i}`, you: i === 0,
      seat: table ? (seatNo ? `Table ${table}, seat ${seatNo}` : `Table ${table}`) : null, table, seatNo,
      meal: picks.length ? picks.join(', ') : null, allergies: al.map((a) => a.label), severe: al.some((a) => a.severity === 'critical'), checkedIn: g.checkedIn === true };
  });
}
/** "2 places, table 3" / "4 places, tables 3 and 4" / "1 place". */
export function placesLine(places: PassPlace[]): string {
  const tables = Array.from(new Set(places.map((p) => p.table).filter(Boolean))) as string[];
  const n = `${places.length} ${places.length === 1 ? 'place' : 'places'}`;
  return tables.length ? `${n}, ${tables.length === 1 ? `table ${tables[0]}` : `tables ${tables.slice(0, -1).join(', ')} and ${tables[tables.length - 1]}`}` : n;
}

/** A party as the door sees it (the team, signed in): everyone's full name as on the guest list, seat, allergies, and
 *  whether they're in. */
export type DoorParty = { partyId: string; lead: string; paid: boolean; places: { id: string; name: string; seat: string | null; allergies: string[]; severe: boolean; checkedIn: boolean; checkedInAt: string | null }[] };
const live = (g: any) => !['cancelled', 'removed'].includes(String(g?.status || ''));
const doorPartyOf = (party: any[], partyId: string): DoorParty => {
  const pp = passPlaces(party, []);
  // (The door sees every guest's allergies, whoever told them: the pass's own rule is for what guests see of each other.)
  return { partyId, lead: String(party[0]?.name || 'Guest').slice(0, 80), paid: party.some((g) => g.source === 'ticket' || !!g.ticketOrderId),
    places: party.slice(0, 50).map((g, i) => { const al = allergyList(g.allergies); return { id: String(g.id), name: String(g.name || pp[i]?.first || 'Guest').slice(0, 80), seat: pp[i]?.seat || null,
      allergies: al.map((a) => a.label), severe: al.some((a) => a.severity === 'critical'), checkedIn: g.checkedIn === true, checkedInAt: typeof g.checkedInAt === 'string' ? g.checkedInAt : null }; }) };
};
// Each event's parties with their 4 digits, kept a minute (a busy door types many codes; a scan reads only its party).
const digitsCache = new Map<string, { at: number; parties: { p: string; d: string }[]; capped: boolean }>();
export const DOOR_READ_MAX = 3000;
const byLead = (a: any, b: any) => (a.partyLead ? -1 : b.partyLead ? 1 : String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
const partyGuests = async (db: any, tenantId: string, eventId: string, partyId: string) =>
  (await db.collection(`tenants/${tenantId}/eventGuests`).where('partyId', '==', partyId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((g: any) => g.eventId === eventId && live(g)).sort(byLead);
/** Who's at the door: the party a scanned code is for, or every party whose 4 digits match. */
export async function doorFind(db: any, tenantId: string, eventId: string, scan: unknown, nowMs = Date.now()): Promise<{ ok: true; parties: DoorParty[] } | { ok: false; error: string; status: number }> {
  const r = readDoor(scan);
  if (!r) return { ok: false, error: 'That isn’t an entry code. Scan the code on the guest’s pass, or type its 4 digits.', status: 400 };
  if ('partyId' in r && !doorKeyOk(tenantId, eventId, r.partyId, r.key)) return { ok: false, error: 'This code is for another event, or it isn’t right.', status: 404 };
  let ids: string[]; let capped = false;
  if ('partyId' in r) ids = [r.partyId];
  else {
    const key = `${tenantId}|${eventId}`; let c = digitsCache.get(key);
    if (!c || nowMs - c.at > 60000) {
      const docs = (await db.collection(`tenants/${tenantId}/eventGuests`).where('eventId', '==', eventId).limit(DOOR_READ_MAX).get()).docs;
      const ps = Array.from(new Set(docs.map((d: any) => d.data()?.partyId).filter((p: any) => typeof p === 'string' && PARTY_RE.test(p)))) as string[];
      c = { at: nowMs, parties: ps.map((p) => ({ p, d: doorDigits(tenantId, eventId, p) || '' })), capped: docs.length >= DOOR_READ_MAX };
      digitsCache.set(key, c); if (digitsCache.size > 200) digitsCache.delete(digitsCache.keys().next().value as string);
    }
    ids = c.parties.filter((x) => x.d === r.digits).map((x) => x.p).slice(0, 6); capped = c.capped;
  }
  const parties = (await Promise.all(ids.map(async (p) => ({ p, list: await partyGuests(db, tenantId, eventId, p) })))).filter((x) => x.list.length).map((x) => doorPartyOf(x.list, x.p));
  if (!parties.length) return { ok: false, error: capped ? 'No places match those digits among the guests read. Scan the code on their pass instead.' : 'No places match that code. They may have been canceled or given to someone else.', status: 404 };
  return { ok: true, parties };
}
/** Check them in: the places picked (or the whole party), each once. Gives back the party as it is now. */
export async function doorIn(db: any, tenantId: string, eventId: string, partyId: unknown, guestIds: unknown, by: string): Promise<{ ok: true; party: DoorParty; added: number } | { ok: false; error: string; status: number }> {
  if (typeof partyId !== 'string' || !PARTY_RE.test(partyId)) return { ok: false, error: 'Which party?', status: 400 };
  const want = Array.isArray(guestIds) ? new Set(guestIds.map(String).slice(0, 50)) : null;
  return db.runTransaction(async (tx: any) => {
    const ev: any = (await tx.get(db.doc(`tenants/${tenantId}/studioEvents/${eventId}`))).data();
    if (!ev) return { ok: false, error: 'That event isn’t here any more.', status: 404 };
    if (String(ev.status || '') === 'cancelled') return { ok: false, error: 'This event was canceled, so nobody is checked in.', status: 409 };
    const docs = (await tx.get(db.collection(`tenants/${tenantId}/eventGuests`).where('partyId', '==', partyId))).docs.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) }))
      .filter((g: any) => g.eventId === eventId && live(g)).sort(byLead);
    if (!docs.length) return { ok: false, error: 'These places aren’t on the guest list any more.', status: 404 };
    const now = new Date().toISOString(); let added = 0;
    for (const g of docs) { if (g.checkedIn === true || (want && !want.has(g.id))) continue; tx.set(g.ref, { checkedIn: true, checkedInAt: now, checkedInBy: by.slice(0, 80), checkedInHow: 'door' }, { merge: true }); g.checkedIn = true; g.checkedInAt = now; added++; }
    return { ok: true, party: doorPartyOf(docs, partyId), added };
  });
}
