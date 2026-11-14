// src/lib/table-reset.ts — CLEAR AND RESET (design canvas ClearReset): what whoever clears tables needs during service.
// Pure: the server reads the floor (lib/table-reset-server) and this works out the lists.
// - To clear: tables guests have left that nobody has said are ready. The one the host needs next comes first (held
//   for a booking arriving soon, or the right size for someone waiting), then whichever was left longest ago. Each
//   says who's on it, and when the business waits to be told it's ready, how long past its usual time it is.
// - Leaving soon: tables that have paid (someone clearing can say they've left, which starts the clearing) and tables
//   that asked for the check (just so they know what's coming).
// The reset steps are the business's own, a reminder only: nothing is held back until they're ticked.
import { fits, leftUncleared, type SeatTable } from '@/lib/seat-next';

export type ClearItem = {
  unitId: string; table: string; name: string; size: number;
  leftAt: string; minutes: number;
  /** Minutes past the usual time to clear it (only when the business waits to be told it's ready). */
  over: number;
  /** Who said they're on it, if anyone. */
  by: string | null;
  /** Why the host needs it next ("Held for Priya at 7:30 pm", "Lee, 4 is waiting for it"), or null. */
  needed: string | null;
};
/** `closed`: the check is closed (they can be marked gone); paid at the table but not closed waits for their server. */
export type LeavingItem = { partyId: string; visitId: string; table: string; name: string; size: number; kind: 'paid' | 'check'; since: string | null; minutes: number; closed: boolean };

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const minsSince = (v: unknown, now: number) => { const t = ms(v); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0; };
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The tables being cleared, the one the host needs next first. `waiting`: parties in line now, longest wait first is
 *  worked out here; `held`: who each held table is for. `label` names a table in the business's own words. */
export function clearList(o: {
  tables: SeatTable[]; parties: any[]; waiting: { name: string; size: number; joinedAt: string | null; needs?: string[] }[];
  held: Record<string, { name: string; at: string | null }>; now: number; label: (name: string) => string; timeWords: (iso: string) => string;
}): ClearItem[] {
  // Someone waiting who a free table could take now isn't waiting for this one.
  const openNow = o.tables.filter((t) => !t.occupied && !t.clearing && !t.heldFor && t.capacity > 0 && t.freeIn === 0);
  const line = [...o.waiting].filter((w) => w && Number(w.size) > 0 && !openNow.some((t) => fits(t, w)))
    .sort((a, b) => (Number.isFinite(ms(a.joinedAt)) ? ms(a.joinedAt) : o.now) - (Number.isFinite(ms(b.joinedAt)) ? ms(b.joinedAt) : o.now));
  const taken = new Set<string>();
  const out = o.tables.filter((t) => t.clearing).map((t) => {
    const left = o.parties.filter((p) => leftUncleared(p, t.id)).sort((a, b) => ms(b.finishedAt) - ms(a.finishedAt))[0];
    return { t, left };
  }).filter((x) => !!x.left);
  const items: (ClearItem & { rank: number })[] = out.map(({ t, left }) => {
    let needed: string | null = null; let rank = 2;
    const h = t.heldFor ? o.held[t.heldFor] : null;
    if (h) { needed = `Held for ${h.name}${h.at ? ` at ${o.timeWords(h.at)}` : ''}`; rank = 0; }
    return { unitId: t.id, table: o.label(t.name), name: clip(left.name, 60) || 'Guests', size: Math.max(1, Number(left.size) || 1), leftAt: String(left.finishedAt || ''),
      minutes: minsSince(left.finishedAt, o.now), over: Math.max(0, Number(t.clearOver) || 0), by: t.clearBy || null, needed, rank };
  });
  // Someone waiting who fits: the longest wait gets the smallest table that seats them, each party named once.
  for (const w of line) {
    const fit = items.filter((i) => { const t = o.tables.find((x) => x.id === i.unitId); return !i.needed && !taken.has(i.unitId) && !!t && fits(t, w); })
      .sort((a, b) => (o.tables.find((t) => t.id === a.unitId)?.capacity || 0) - (o.tables.find((t) => t.id === b.unitId)?.capacity || 0))[0];
    if (!fit) continue;
    fit.needed = `${clip(w.name, 40) || 'Someone'}, ${w.size} is waiting for it`; fit.rank = 1; taken.add(fit.unitId);
  }
  return items.sort((a, b) => a.rank - b.rank || b.minutes - a.minutes).map(({ rank, ...i }) => i);
}

/** Tables about to leave: paid (they can be marked as left) and asked for the check, the longest first. */
export function leavingList(rows: { visitId: string; table: string; party: any; stage?: { key?: string } | null; checkAt?: string | null; paidAt?: string | null; closed?: boolean }[], now: number): LeavingItem[] {
  return rows.filter((r) => r?.party?.id && (r.stage?.key === 'paid' || r.stage?.key === 'check')).map((r) => {
    const kind = r.stage?.key === 'paid' ? 'paid' as const : 'check' as const;
    const since = kind === 'paid' ? (r.paidAt || null) : (r.checkAt || null);
    return { partyId: String(r.party.id), visitId: r.visitId, table: r.table, name: clip(r.party.name, 60) || 'Guests', size: Math.max(1, Number(r.party.size) || 1), kind, since, minutes: minsSince(since, now), closed: kind === 'paid' && r.closed === true };
  }).sort((a, b) => (a.kind === b.kind ? b.minutes - a.minutes : a.kind === 'paid' ? -1 : 1));
}

/** "Left 4 min ago" (or "Just left"). */
export const leftWords = (m: number) => (m < 1 ? 'Just left' : `Left ${m} min ago`);
/** "Paid 5 min ago" / "Asked for the check 6 min ago". */
export const leavingWords = (i: LeavingItem) => `${i.kind === 'paid' ? (i.closed ? 'Paid' : 'Paid at the table') : 'Asked for the check'}${i.since ? (i.minutes < 1 ? ' just now' : ` ${i.minutes} min ago`) : ''}${i.kind === 'paid' && !i.closed ? '. Their server closes the check first' : ''}`;
