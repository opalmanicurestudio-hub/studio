// src/lib/guest-memory.ts — GUEST MEMORY (design canvas GuestMemory): what the host stand knows about a guest the
// business already has, from their own past table visits. How many, when they were last in, what they usually order,
// where they usually sit, their profile's allergies and the team's note for next time. Worked out here from records the
// server reads (lib/guest-memory-server), never guessed: a usual is something ordered on at least two of their recent
// visits, and a usual table is one they sat at on at least half of them.
//
// Who a party is: an exact match on their mobile number or email (matchGuest) is only a suggestion, since anyone can type
// a number; the host asks and says yes, or picks them ("Been here before?").
// Settings (hostingSettings.memory): show regulars at the host stand, how many visits make a regular, and whether the
// wait link offers a regular their usual drink.
import { profileAllergy, wordsList, type TableAllergy } from '@/lib/allergens';
import { tableLabel } from '@/lib/table-service';

export type MemorySettings = { on: boolean; regularAfter: number; offerUsual: boolean };
// The wait link's offer is the business's to turn on: it names a guest's usual to whoever holds the link.
export const DEFAULT_MEMORY: MemorySettings = { on: true, regularAfter: 3, offerUsual: false };

export function cleanMemory(x: any): MemorySettings {
  const n = Math.round(Number(x?.regularAfter));
  return { on: x?.on !== false, regularAfter: Number.isFinite(n) ? Math.min(20, Math.max(2, n)) : DEFAULT_MEMORY.regularAfter, offerUsual: x?.offerUsual === true };
}
export const memorySettingsOf = (tenant: any): MemorySettings => cleanMemory(tenant?.hostingSettings?.memory || {});

export type UsualItem = { id: string; name: string; times: number };
export type GuestNote = { text: string; by: string; at: string };
export type GuestMemory = {
  clientId: string; name: string;
  /** Table visits before tonight, and whether there were more than were read. */
  visits: number; more: boolean; lastAt: string | null; regular: boolean;
  /** Items ordered on at least two of their recent visits, most often first; the table they usually sit at (its name). */
  usual: UsualItem[]; table: string | null;
  /** Their profile's allergies, as the table would take them (lib/allergens). */
  allergy: TableAllergy | null;
  note: GuestNote | null;
};

/** Visits read for one guest at most, and how many of the latest the usual is worked out from. */
export const MAX_VISITS = 60;
export const RECENT = 10;
export const NOTE_MAX = 200;
/** Usual items kept (the host's line names the first three; the wait link looks through them all for a drink). */
export const USUAL_MAX = 6;
const DONE = new Set(['completed', 'checked_out', 'paid']);
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const timeOf = (v: any) => { const t = Date.parse(String(v?.completedAt || v?.checkedOutAt || v?.startTime || v?.createdAt || '')); return Number.isFinite(t) ? t : 0; };

export const digitsKey = (phone: unknown): string => String(phone ?? '').replace(/\D/g, '').slice(-10);
export const emailKey = (email: unknown): string => { const e = String(email ?? '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.slice(0, 120) : ''; };
/** What a party is matched on: their mobile number (ten digits) and email. Empty: nothing to match. */
export const matchSig = (p: any): string => { const d = digitsKey(p?.phone); const e = emailKey(p?.email); return d.length === 10 || e ? `${d.length === 10 ? d : ''}|${e}` : ''; };
/** A guest the business can use here: not a renter's own client, not archived or deleted. */
export const usableGuest = (c: any): boolean => !!c && !c.ownerRenterId && !c.archived && !c.deleted && !c.deletedAt && String(c.status || '') !== 'archived';

/** The one guest a party's mobile number or email belongs to, exactly; null when none or more than one. */
export function matchGuest(clients: any[], p: { phone?: unknown; email?: unknown }): { id: string | null; count: number; by: 'phone' | 'email' | null } {
  const d = digitsKey(p.phone); const e = emailKey(p.email);
  const byPhone = d.length === 10 ? clients.filter((c) => usableGuest(c) && digitsKey(c.phone || c.mobile || c.phoneNumber) === d) : [];
  const byEmail = e ? clients.filter((c) => usableGuest(c) && emailKey(c.email) === e) : [];
  const ids = (list: any[]) => Array.from(new Set(list.map((c) => String(c.id))));
  // Their number first: one person, one mobile. Their email when the number found nobody, or more than one.
  const ph = ids(byPhone); if (ph.length === 1) return { id: ph[0], count: 1, by: 'phone' };
  const em = ids(byEmail); if (em.length === 1 && (!ph.length || ph.includes(em[0]))) return { id: em[0], count: 1, by: 'email' };
  return { id: null, count: Math.max(ph.length, em.length), by: null };
}

/** Their memory, from their profile and their table visits (any order; tonight's is left out). */
export function memoryOf(clientId: string, client: any, visits: any[], s: MemorySettings, o: { exclude?: string | null; at?: string } = {}): GuestMemory {
  const past = (Array.isArray(visits) ? visits : []).filter((v) => v && v.isTable === true && DONE.has(String(v.status || '')) && (!o.exclude || v.id !== o.exclude))
    .sort((a, b) => timeOf(b) - timeOf(a));
  const recent = past.slice(0, RECENT);
  const items = new Map<string, { name: string; times: number; last: number }>();
  const tables = new Map<string, number>();
  recent.forEach((v, i) => {
    const seen = new Set<string>();
    for (const l of Array.isArray(v.tab) ? v.tab : []) {
      if (!l || l.itemType === 'service' || !l.itemId) continue;
      const id = String(l.itemId).slice(0, 160); if (seen.has(id)) continue; seen.add(id);
      const cur = items.get(id); const name = clip(l.name, 80) || 'Item';
      if (cur) cur.times += 1; else items.set(id, { name, times: 1, last: i });
    }
    const t = clip(v.tableName, 40); if (t) tables.set(t, (tables.get(t) || 0) + 1);
  });
  const usual = Array.from(items.entries()).filter(([, x]) => x.times >= 2).sort((a, b) => b[1].times - a[1].times || a[1].last - b[1].last).slice(0, USUAL_MAX)
    .map(([id, x]) => ({ id, name: x.name, times: x.times }));
  const topTable = Array.from(tables.entries()).sort((a, b) => b[1] - a[1])[0];
  const table = topTable && topTable[1] >= 2 && topTable[1] * 2 >= recent.length ? topTable[0] : null;
  const n: any = client?.hostNote;
  const note = n && clip(n.text, NOTE_MAX) ? { text: clip(n.text, NOTE_MAX), by: clip(n.by, 60), at: String(n.at || '') } : null;
  const name = clip(client?.name || [client?.firstName, client?.lastName].filter(Boolean).join(' '), 80) || 'Guest';
  const last = past[0] ? timeOf(past[0]) : 0;
  return { clientId, name, visits: past.length, more: visits.length >= MAX_VISITS, lastAt: last ? new Date(last).toISOString() : null, regular: past.length >= s.regularAfter,
    usual, table, allergy: profileAllergy(client, '', o.at || new Date().toISOString()), note };
}

const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
/** "Oct 31", or "Oct 31, 2025" in another year. */
export function dayWords(iso: string | null, zone?: string | null, now = Date.now()): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const d = new Date(iso); const z = zone ? { timeZone: zone } : {};
  const y = (x: Date) => x.toLocaleDateString('en-US', { year: 'numeric', ...z });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y(d) !== y(new Date(now)) ? { year: 'numeric' } : {}), ...z });
}
/** "Regular, 9th visit. Last in Oct 31. Usually Table 4." (or "No table visits yet."). `label` names a
 *  table in the business's own words ("4" → "Table 4"). */
export function visitWords(m: GuestMemory, zone?: string | null, now = Date.now(), label: (name: string) => string = tableLabel): { head: string; rest: string } {
  if (!m.visits) return { head: 'No table visits yet.', rest: '' };
  const head = m.more ? `Regular, here ${m.visits}+ times.` : `${m.regular ? 'Regular, ' : ''}${ord(m.visits + 1)} visit.`;
  const last = dayWords(m.lastAt, zone, now);
  return { head, rest: [last ? `Last in ${last}.` : '', m.table ? `Usually ${label(m.table)}.` : ''].filter(Boolean).join(' ') };
}
const and = (w: string[]) => (w.length <= 1 ? (w[0] || '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);
/** "Usually orders Flat white and Shakshuka." */
export const usualWords = (m: GuestMemory) => (m.usual.length ? `Usually orders ${and(m.usual.slice(0, 3).map((u) => u.name))}.` : '');
/** "Tree nuts, severe" */
export function allergyWords(a: TableAllergy | null): string {
  if (!a) return '';
  const w = [wordsList(a.keys), a.other].filter(Boolean).join(', ');
  return w ? `${w.charAt(0).toUpperCase()}${w.slice(1)}${a.severe ? ', severe' : ''}` : '';
}

/** The regular's usual drinks that the wait link offers now (on its list, not picked yet), at most two. */
export function usualDrinks(m: GuestMemory | null, drinks: { id: string }[], picked: string[] = []): string[] {
  if (!m || !m.usual.length) return [];
  const on = new Set(drinks.map((d) => d.id)); const have = new Set(picked);
  return m.usual.map((u) => u.id).filter((id) => on.has(id) && !have.has(id)).slice(0, 2);
}
