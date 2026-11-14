// src/lib/nudges.ts — A SERVER'S NUDGES: what each of their tables needs next, worked out from the table's tab and the
// kitchen's tickets, so nobody has to remember to look. Pure: the server works them out (api/tab 'nudges') and the
// server's phone shows them (app/(app)/tables).
// - Ready at the pass: a course all made and not taken out, a few minutes on.
// - Running late: a fired course taking longer than its slowest dish usually does.
// - Fire the next course: the last course went out a while ago and the next one is still held.
// - Check back: a course just landed.
// - Nothing ordered yet: seated a while with an empty tab.
// - An allergy at a table that hasn't ordered: so the server has it in mind before the first order.
// Each can be marked done (or put off a few minutes); a nudge marked done comes back if the same thing happens again
// later (a remake waiting at the pass). Every timing is the business's own (0 turns one off). Done and put off are kept
// on the party (it's there before the table has a tab).

import { prepMinutes, PREORDER_NOTE, type Course } from '@/lib/table-service';
import { allergyLine, type TableAllergy } from '@/lib/allergens';

export type NudgeSettings = { fireAfterMin: number; checkBackMin: number; passWaitMin: number; noOrderMin: number; lateMin: number };
export const DEFAULT_NUDGES: NudgeSettings = { fireAfterMin: 12, checkBackMin: 2, passWaitMin: 3, noOrderMin: 8, lateMin: 5 };
export const NUDGE_KEYS = Object.keys(DEFAULT_NUDGES) as (keyof NudgeSettings)[];
/** The business's nudge timings (minutes; 0 is off), each between 0 and 60. */
export function nudgeSettingsOf(tenant: any): NudgeSettings {
  const raw = tenant?.kitchenSettings?.nudges || {};
  const out = { ...DEFAULT_NUDGES };
  for (const k of NUDGE_KEYS) { const n = Math.round(Number(raw[k])); if (raw[k] !== undefined && raw[k] !== null && Number.isFinite(n) && n >= 0 && n <= 60) out[k] = n; }
  return out;
}

export type NudgeKind = 'at_pass' | 'late' | 'fire' | 'check_back' | 'no_order' | 'allergy';
export type Nudge = { key: string; kind: NudgeKind; visitId: string; partyId: string; table: string; text: string; since: number; urgent: boolean; course: { n: number; name: string } | null };
export type NudgeLine = { lineId: string; name: string; course?: number | null; courseName?: string | null; firedAt?: string | null; kdsId?: string | null; makeSeconds?: number | null; at?: string | null; note?: string | null };
export type NudgeTicket = { status: string; readyAt?: string | null; deliveredAt?: string | null };
export type NudgeTable = { visitId: string; partyId: string; table: string; seatedAt: string | null; tab: NudgeLine[]; tickets: Record<string, NudgeTicket>; allergies: TableAllergy[];
  done: Record<string, { at?: string; until?: string | null }>; courses: Course[] };

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const mins = (n: number) => Math.max(0, Math.floor(n / 60000));
const ORDER: Record<NudgeKind, number> = { at_pass: 0, late: 1, fire: 2, check_back: 3, no_order: 4, allergy: 5 };

/** Is this nudge put away: put off and not back yet, or marked done since this happened (`since`)? */
export function nudgeHidden(done: NudgeTable['done'], key: string, now: number, since: number): boolean {
  const d = done?.[key]; if (!d) return false;
  const until = ms(d.until); if (Number.isFinite(until)) return until > now;
  // (Two minutes' slack: `since` can come from a tablet whose clock runs a little ahead of the server's.)
  const at = ms(d.at); return !Number.isFinite(at) || !Number.isFinite(since) || at + 120000 >= since;
}

/** What one table needs next, most pressing first. */
export function nudgesFor(t: NudgeTable, s: NudgeSettings, now: number): Nudge[] {
  const out: Nudge[] = [];
  const add = (n: Omit<Nudge, 'visitId' | 'partyId' | 'table'>) => { if (!nudgeHidden(t.done, n.key, now, n.since)) out.push({ ...n, visitId: t.visitId, partyId: t.partyId, table: t.table }); };
  const lines = (Array.isArray(t.tab) ? t.tab : []).filter((l) => !!l);
  const seated = ms(t.seatedAt);
  // Drinks they ordered from their wait link aren't the table ordering: it still needs taking.
  const ordered = lines.some((l) => l.note !== PREORDER_NOTE);
  if (!ordered) {
    if (s.noOrderMin > 0 && Number.isFinite(seated) && now - seated >= s.noOrderMin * 60000) add({ key: 'order', kind: 'no_order', text: `Seated ${mins(now - seated)} min ago. Nothing ordered yet${lines.length ? ' (just drinks from the wait list)' : ''}.`, since: seated, urgent: false, course: null });
    if (t.allergies.length) add({ key: 'allergy', kind: 'allergy', text: `${t.allergies.slice(0, 3).map(allergyLine).join('. ')}. It goes on every ticket, and the kitchen notes it.`, since: Number.isFinite(seated) ? seated : now, urgent: false, course: null });
    if (!lines.length) return out;
  }
  // Each course as it stands: its lines, their tickets, when it was fired, made and taken out.
  type G = { n: number; name: string; hold: boolean; lines: NudgeLine[]; live: NudgeTicket[]; unfired: boolean; held: NudgeLine[]; firedAt: number; readyAt: number; servedAt: number };
  const byCourse = new Map<number, G>();
  for (const l of lines) {
    const n = Number(l.course) || 0;
    const c = t.courses.find((x) => x.n === n);
    const g = byCourse.get(n) || { n, name: c?.name || l.courseName || (n ? `Course ${n}` : 'Order'), hold: !!c?.hold, lines: [], live: [], unfired: false, held: [], firedAt: NaN, readyAt: NaN, servedAt: NaN };
    g.lines.push(l);
    const k = l.kdsId ? t.tickets[l.kdsId] : null;
    if (!l.firedAt && l.kdsId && (!k || k.status === 'unfired')) { g.unfired = true; g.held.push(l); }
    if (k && k.status !== 'cancelled' && k.status !== 'unfired') g.live.push(k);
    // When what's still cooking was fired (a dish added later to a course already out is timed from its own firing).
    const f = ms(l.firedAt); if (k && (k.status === 'pending' || k.status === 'in_progress') && Number.isFinite(f) && !(f >= g.firedAt)) g.firedAt = f;
    byCourse.set(n, g);
  }
  for (const g of byCourse.values()) {
    if (!g.live.length) continue;
    if (g.live.every((k) => k.status === 'delivered')) g.servedAt = Math.max(...g.live.map((k) => ms(k.deliveredAt)).filter(Number.isFinite));
    else if (g.live.every((k) => k.status === 'ready' || k.status === 'delivered')) g.readyAt = Math.max(...g.live.map((k) => ms(k.readyAt)).filter(Number.isFinite));
  }
  const list = Array.from(byCourse.values()).sort((a, b) => a.n - b.n);
  for (const g of list) {
    const course = { n: g.n, name: g.name };
    // Made and waiting at the pass.
    if (s.passWaitMin > 0 && Number.isFinite(g.readyAt) && now - g.readyAt >= s.passWaitMin * 60000)
      add({ key: `pass:${g.n}`, kind: 'at_pass', text: `${g.n ? g.name : 'Their order'} is ready at the pass, ${mins(now - g.readyAt)} min now.`, since: g.readyAt, urgent: true, course });
    // Fired, still cooking, and longer than its slowest dish usually takes.
    const cooking = g.live.some((k) => k.status === 'pending' || k.status === 'in_progress');
    const usual = prepMinutes(g.lines.filter((l) => { const k = l.kdsId ? t.tickets[l.kdsId] : null; return !!k && (k.status === 'pending' || k.status === 'in_progress'); }));
    if (s.lateMin > 0 && cooking && Number.isFinite(g.firedAt) && now - g.firedAt >= (usual + s.lateMin) * 60000)
      add({ key: `late:${g.n}`, kind: 'late', text: `${g.n ? g.name : 'Their order'} has taken ${mins(now - g.firedAt)} min, longer than usual. Let the table know.`, since: g.firedAt + usual * 60000, urgent: true, course });
    // Just landed: check back on how it's going.
    if (s.checkBackMin > 0 && Number.isFinite(g.servedAt) && now - g.servedAt >= s.checkBackMin * 60000 && now - g.servedAt < (s.checkBackMin + 15) * 60000)
      add({ key: `check:${g.n}`, kind: 'check_back', text: `${g.n ? g.name : 'Their order'} landed ${mins(now - g.servedAt)} min ago. Check back on how it’s going.`, since: g.servedAt, urgent: false, course });
  }
  // The next held course: once the last one served has been out a while; at once (a minute on) when nothing comes
  // before it; and something added to a course that's already out, a minute after it's rung in.
  if (s.fireAfterMin > 0) {
    const next = list.find((g) => g.unfired);
    if (next) {
      const prep = prepMinutes(next.held);
      const rungIn = Math.max(...next.held.map((l) => ms(l.at)).filter(Number.isFinite));
      const course = { n: next.n, name: next.name };
      const earlier = list.filter((g) => g.n < next.n && g.live.length > 0);
      const stillOut = earlier.some((g) => !Number.isFinite(g.servedAt));
      const before = earlier.filter((g) => Number.isFinite(g.servedAt)).pop();
      if (next.live.length > 0) {
        if (Number.isFinite(rungIn) && now - rungIn >= 60000)
          add({ key: `fire:${next.n}`, kind: 'fire', text: `${next.held.length === 1 ? `${next.held[0].name} for ${next.name.toLowerCase()} is` : `${next.held.length} more for ${next.name.toLowerCase()} are`} held. Fire when they’re ready for it.`, since: rungIn, urgent: false, course });
      } else if (!earlier.length) {
        if (Number.isFinite(rungIn) && now - rungIn >= 60000)
          add({ key: `fire:${next.n}`, kind: 'fire', text: `${next.name} is held, with nothing before it. It takes about ${prep} min.`, since: rungIn, urgent: false, course });
      } else if (before && !stillOut && now - before.servedAt >= s.fireAfterMin * 60000)
        add({ key: `fire:${next.n}`, kind: 'fire', text: `${before.n ? before.name : 'Their order'} went out ${mins(now - before.servedAt)} min ago. ${next.name} takes about ${prep} min.`, since: before.servedAt, urgent: false, course });
    }
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.since - b.since);
}

/** Every table's nudges together, most pressing first: what's waiting at the pass and running late, then the oldest. */
export function allNudges(tables: NudgeTable[], s: NudgeSettings, now: number): Nudge[] {
  return tables.flatMap((t) => nudgesFor(t, s, now)).sort((a, b) => Number(b.urgent) - Number(a.urgent) || ORDER[a.kind] - ORDER[b.kind] || a.since - b.since);
}
/** A nudge key as the server accepts it. */
export const NUDGE_KEY = /^(order|allergy|(pass|late|check|fire):\d{1,2})$/;
