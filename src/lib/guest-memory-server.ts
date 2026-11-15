// src/lib/guest-memory-server.ts — GUEST MEMORY, read and kept on the server (lib/guest-memory has the rules).
//   recognize   → tonight's parties with a mobile number or email that belongs to exactly one guest the business has get
//                 that guest as a suggestion (once per number and email). Only a suggestion: a number or email typed on
//                 the wait list or a booking proves nothing, so nothing is theirs (the visit, its bill, their deposits,
//                 the wait link's usual) until the host asks and says yes.
//   memoryFor   → one guest's memory, read for a few minutes at a time.
//   linkGuest   → the host says who a party is, or that they aren't who we thought. A seated table changes with them:
//                 the visit is theirs, and their profile's allergies replace any other guest's on the table and on every
//                 ticket not yet out, in the same save.
//   tableTakesGuest → a table seated just as its party was linked, put right on the next floor read.
//   saveGuestNote → the team's note for next time, kept on the guest (clients/{id}.hostNote).
//   findGuests  → "Been here before?": guests by name, number or email, with only a hint of their contact details.
// Everything here is the business's own guests: a renter's own clients are never matched, shown or found.
import { searchTermKey, matchesSearch } from '@/lib/client-search';
import { emailHint, phoneHint } from '@/lib/privacy';
import { visitIdForParty } from '@/lib/table-service';
import { profileAllergy, tableAllergies, ticketAllergyPatch } from '@/lib/allergens';
import { digitsKey, DONE_STATUSES, emailKey, matchGuest, matchSig, MAX_VISITS, memoryOf, memorySettingsOf, NOTE_MAX, RECENT, usableGuest, type GuestMemory } from '@/lib/guest-memory';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export class GuestStop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }
const LIVE = new Set(['waiting', 'notified', 'expected', 'seated']);
const nowIso = () => new Date().toISOString();

const MEM_MS = 5 * 60000;
/** Visits read a page at a time, a few pages at most. */
const PAGE = 60, PAGES = 4;
const doneTable = (v: any) => v?.isTable === true && DONE_STATUSES.includes(String(v.status || ''));
const memCache = new Map<string, { at: number; v: GuestMemory | null }>();
/** Something about this guest changed here: the next read is fresh. */
export function forgetGuest(T: string, clientId: string) { memCache.delete(`${T}|${clientId}`); }

/** One guest's memory (null: not a guest the business can use here). Read at most every few minutes. */
export async function memoryFor(db: any, T: string, tenant: any, clientId: string, o: { fresh?: boolean } = {}): Promise<GuestMemory | null> {
  if (!ID.test(clientId) || clientId === 'guest-walkin') return null;
  const key = `${T}|${clientId}`; const hit = memCache.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < MEM_MS) return hit.v;
  const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data() || null;
  let v: GuestMemory | null = null;
  if (usableGuest(c)) {
    // Their latest visits first (the same read as a client's visit history), a page at a time until their last few
    // table visits are in hand: a business that also takes other appointments may have those in between. Without that
    // index, their table visits in no particular order. And how many table visits they've had in all, counted.
    const col = db.collection(`${T}/appointments`); const mine = col.where('clientId', '==', clientId);
    // Counted first: a guest with no table visits (only other appointments) needs nothing more read.
    let total: number | null = null;
    try { const n = Number((await mine.where('isTable', '==', true).where('status', '==', 'completed').count().get()).data().count); if (Number.isFinite(n)) total = n; } catch { /* counted from what's read */ }
    let rows: any[] = [];
    if (total !== 0) {
      try {
        let q = mine.orderBy('startTime', 'desc').limit(PAGE);
        for (let page = 0; page < PAGES; page++) {
          const snap = await q.get(); rows.push(...snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })));
          if (snap.size < PAGE || rows.filter(doneTable).length >= Math.min(RECENT, total ?? RECENT)) break;
          q = mine.orderBy('startTime', 'desc').startAfter(snap.docs[snap.docs.length - 1]).limit(PAGE);
        }
      } catch {
        rows = (await col.where('clientId', '==', clientId).where('isTable', '==', true).limit(MAX_VISITS).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      }
    }
    v = memoryOf(clientId, c, rows, memorySettingsOf(tenant), { total });
  }
  if (memCache.size > 3000) { const now = Date.now(); for (const [k, x] of memCache) if (now - x.at >= MEM_MS) memCache.delete(k); if (memCache.size > 3000) memCache.clear(); }
  memCache.set(key, { at: Date.now(), v });
  return v;
}

/** Several guests' memories at once (a night's worth, at most 40), by guest. A guest whose read fails is left out. */
export async function memoriesFor(db: any, T: string, tenant: any, ids: string[]): Promise<Record<string, GuestMemory>> {
  const list = Array.from(new Set(ids.filter((x) => ID.test(String(x)) && x !== 'guest-walkin'))).slice(0, 40);
  const out: Record<string, GuestMemory> = {};
  await Promise.all(list.map(async (id) => { try { const m = await memoryFor(db, T, tenant, id); if (m) out[id] = m; } catch (e: any) { console.warn('[guest-memory] read', id, e?.message || e); } }));
  return out;
}

/** The guest a booking's number or email is, read only (one exact match, else null), with the name on file, so the
 *  caller can see it's the same person and not someone sharing the number: the pre-shift briefing's regulars
 *  (lib/briefing-server). Nothing is linked from here. */
export async function guestFor(db: any, T: string, p: { phone?: unknown; email?: unknown }): Promise<{ id: string; name: string } | null> {
  const list = await candidates(db, T, p); const m = matchGuest(list, p);
  if (m.count !== 1 || !m.id) return null;
  const c = list.find((x) => x.id === m.id) || {};
  return { id: m.id, name: String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || '').slice(0, 80) };
}
/** The guests a mobile number or email could belong to (a few at most). */
async function candidates(db: any, T: string, p: any): Promise<any[]> {
  const d = digitsKey(p.phone); const e = emailKey(p.email); const out = new Map<string, any>();
  const add = (snap: any) => { for (const x of snap.docs) out.set(x.id, { id: x.id, ...(x.data() || {}) }); };
  if (d.length === 10) add(await db.collection(`${T}/clients`).where('searchKeys', 'array-contains', d).limit(6).get());
  // Search keys hold an email up to 40 characters long; a longer one is looked up as it's written.
  if (e) add(await (e.length <= 40 ? db.collection(`${T}/clients`).where('searchKeys', 'array-contains', e) : db.collection(`${T}/clients`).where('email', '==', e)).limit(6).get());
  return Array.from(out.values());
}

/** A seated table's visit becomes the guest's (null: nobody's). Their profile's allergies replace the other guest's
 *  on the table and on every ticket the kitchen hasn't sent out; allergies the table told the server stay, and so does
 *  a profile allergy the server changed at the table (it's about whoever is sitting there). Reads come first (tickets),
 *  so call it before any write in the transaction; `client` is the new guest's profile, `prevClient` the old one's. */
async function tableTakes(tx: any, db: any, T: string, vRef: any, v: any, clientId: string | null, client: any, by: string, prevClient: any = null) {
  const tab: any[] = Array.isArray(v.tab) ? v.tab : [];
  const lines = tab.filter((l) => l?.kdsId && ID.test(String(l.kdsId)));
  const snaps = lines.length ? await Promise.all(lines.map((l) => tx.get(db.doc(`${T}/kdsTickets/${l.kdsId}`)))) : [];
  const now = nowIso();
  // The other guest's profile allergy, just as their profile has it, comes off; one changed at the table stays, as told.
  const was = prevClient ? profileAllergy(prevClient, by, now) : null;
  const same = (a: any) => !!was && a.seat === null && String(a.keys) === String(was.keys) && (a.other || null) === (was.other || null) && !!a.severe === !!was.severe;
  const kept = tableAllergies(v).filter((a) => a.from !== 'profile' || !same(a)).map((a) => (a.from === 'profile' ? { ...a, from: 'asked' as const, by: 'At the table' } : a));
  const theirs = clientId && client ? profileAllergy(client, by, now) : null;
  const next = theirs ? [...kept, theirs] : kept;
  tx.set(vRef, { clientId, allergies: next, allergiesSeeded: true, updatedAt: now }, { merge: true });
  snaps.forEach((sn: any, i: number) => { const k: any = sn.exists ? sn.data() || {} : null; if (!k) return;
    const p = ticketAllergyPatch(k, next, lines[i].seat || null, Array.isArray(lines[i].allergens) ? lines[i].allergens : []);
    if (p) tx.set(db.doc(`${T}/kdsTickets/${lines[i].kdsId}`), p, { merge: true }); });
}

const busy = new Set<string>();
/** Tonight's parties that could be a guest the business has, looked up once per number and email (a few each time).
 *  Returns the parties given a suggestion now, by party. */
export async function recognize(db: any, T: string, parties: any[]): Promise<Record<string, string>> {
  if (busy.has(T)) return {};
  const todo = parties.filter((p) => p && LIVE.has(String(p.status)) && !p.clientId && !p.guestSuggest && !String(p.id).includes(':') && ID.test(String(p.id)) && matchSig(p) && p.guestCheck !== matchSig(p)).slice(0, 8);
  if (!todo.length) return {};
  busy.add(T); const linked: Record<string, string> = {};
  try {
    for (const p of todo) {
      const sig = matchSig(p);
      try {
        const m = matchGuest(await candidates(db, T, p), p);
        const pRef = db.doc(`${T}/parties/${p.id}`);
        await db.runTransaction(async (tx: any) => {
          const cur: any = (await tx.get(pRef)).data();
          if (!cur || cur.clientId || cur.guestSuggest || matchSig(cur) !== sig || cur.guestCheck === sig) return;
          if (!m.id) { tx.set(pRef, { guestCheck: sig, guestMatches: m.count }, { merge: true }); return; }
          tx.set(pRef, { guestSuggest: m.id, guestSuggestBy: m.by, guestCheck: sig, guestMatches: 1 }, { merge: true });
          linked[p.id] = m.id;
        });
      } catch (e: any) { console.warn('[guest-memory] match', p.id, e?.message || e); }
    }
  } finally { busy.delete(T); }
  return linked;
}

/** The host says who this party is (clientId), or that they aren't who we thought (null). A seated table whose visit
 *  already belongs to another guest (a booked visit) stays theirs: that's changed on the visit. */
export async function linkGuest(db: any, T: string, partyId: string, clientId: string | null, by: string): Promise<{ clientId: string | null }> {
  if (!ID.test(partyId) || partyId.includes(':')) throw new GuestStop('Which party?', 400);
  if (clientId !== null && (!ID.test(clientId) || clientId === 'guest-walkin')) throw new GuestStop('Which guest?', 400);
  const cRef = clientId ? db.doc(`${T}/clients/${clientId}`) : null;
  const pRef = db.doc(`${T}/parties/${partyId}`);
  const r = await db.runTransaction(async (tx: any) => {
    const p: any = (await tx.get(pRef)).data();
    if (!p) throw new GuestStop('That party wasn’t found.', 404);
    if (!LIVE.has(String(p.status))) throw new GuestStop('They’re not on tonight’s floor now.');
    if ((Array.isArray(p.guestIds) ? p.guestIds : []).some((g: any) => String(g).startsWith('appt:'))) throw new GuestStop('They came from a booking. Change who it’s for on the booking.');
    const c: any = cRef ? (await tx.get(cRef)).data() : null;
    if (clientId && !usableGuest(c)) throw new GuestStop('That guest wasn’t found.', 404);
    const prev = p.clientId ? String(p.clientId) : null;
    const vRef = db.doc(`${T}/appointments/${visitIdForParty({ id: partyId, ...p })}`);
    const v: any = p.status === 'seated' ? (await tx.get(vRef)).data() : null;
    const open = !!v && v.status !== 'completed';
    if (open && Number(v.payPaidSoFar) > 0 && v.clientId !== clientId) throw new GuestStop('Part of their check is paid already, so their tab stays as it is.');
    if (open && v.clientId && v.clientId !== 'guest-walkin' && v.clientId !== prev && v.clientId !== clientId) throw new GuestStop('Their tab is already with another guest’s profile. Change it on the visit.');
    const pc: any = open && v.clientId !== clientId && v.clientId && ID.test(String(v.clientId)) ? (await tx.get(db.doc(`${T}/clients/${v.clientId}`))).data() || null : null;
    if (open && v.clientId !== clientId) await tableTakes(tx, db, T, vRef, v, clientId, c, by, pc);
    // "Not them": their number or email isn't matched to anyone again tonight.
    tx.set(pRef, { clientId, guestSuggest: null, guestSuggestBy: null, guestMatch: clientId ? 'host' : 'not_them', guestBy: by.slice(0, 60), guestAt: nowIso(), guestCheck: matchSig(p) || null }, { merge: true });
    return { clientId };
  });
  if (clientId) forgetGuest(T, clientId);
  return r;
}

/** Tables seated just as their party was linked (the seat read the party a moment before): the visit takes the guest
 *  the host said, once. `parties`: tonight's seated parties the host linked. */
const tablesDone = new Map<string, number>();
export async function tableTakesGuest(db: any, T: string, parties: any[], by: string): Promise<number> {
  const todo = parties.filter((p) => p && p.status === 'seated' && p.guestMatch === 'host' && p.clientId && ID.test(String(p.clientId)) && ID.test(String(p.id)) && !tablesDone.has(`${T}|${p.id}|${p.clientId}`)).slice(0, 10);
  let n = 0;
  for (const p of todo) {
    const key = `${T}|${p.id}|${p.clientId}`;
    try {
      const vRef = db.doc(`${T}/appointments/${visitIdForParty(p)}`); const cRef = db.doc(`${T}/clients/${p.clientId}`);
      // No visit yet: looked at again next time (it's made with the party's guest once the party has one).
      const seen = await db.runTransaction(async (tx: any) => {
        const v: any = (await tx.get(vRef)).data();
        if (!v) return false;
        if (v.status === 'completed' || Number(v.payPaidSoFar) > 0 || (v.clientId && v.clientId !== 'guest-walkin')) return true;
        const c: any = (await tx.get(cRef)).data();
        if (!usableGuest(c)) return true;
        await tableTakes(tx, db, T, vRef, v, String(p.clientId), c, by); n += 1; return true;
      });
      if (tablesDone.size > 5000) tablesDone.clear();
      if (seen) tablesDone.set(key, Date.now());
    } catch (e: any) { console.warn('[guest-memory] table', p.id, e?.message || e); }
  }
  return n;
}

/** The team's note for next time ("Likes the window. Oat milk."), on the guest. Empty: no note. */
export async function saveGuestNote(db: any, T: string, clientId: string, text: unknown, by: string): Promise<{ note: { text: string; by: string; at: string } | null }> {
  if (!ID.test(clientId) || clientId === 'guest-walkin') throw new GuestStop('Which guest?', 400);
  const ref = db.doc(`${T}/clients/${clientId}`);
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  const note = t ? { text: t, by: by.slice(0, 60), at: nowIso() } : null;
  await db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(ref)).data();
    if (!usableGuest(c)) throw new GuestStop('That guest wasn’t found.', 404);
    tx.set(ref, { hostNote: note }, { merge: true });
  });
  forgetGuest(T, clientId);
  return { note };
}

export type FoundGuest = { id: string; name: string; hint: string };
/** "Been here before?": up to six guests by name, number or email. Only a hint of how to reach them, never the number. */
export async function findGuests(db: any, T: string, term: string): Promise<FoundGuest[]> {
  const t = String(term || '').trim().slice(0, 80);
  const k = searchTermKey(t); if (!k || k.length < 2) return [];
  const snap = await db.collection(`${T}/clients`).where('searchKeys', 'array-contains', k).limit(25).get();
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => usableGuest(c) && matchesSearch(c, t)).slice(0, 6).map((c: any) => {
    const ph = phoneHint(c.phone || c.mobile || c.phoneNumber); const em = emailHint(c.email);
    return { id: String(c.id), name: String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Guest').slice(0, 80),
      hint: ph ? `Mobile ending ${ph.slice(-4)}` : em ? `Email ${em}` : 'No number or email' };
  });
}
