// src/lib/table-recovery.ts — FIXING A BAD EXPERIENCE BEFORE THEY LEAVE (design canvas "Fixing a bad experience";
// lib/table-recovery-server, api/table-pay 'report', api/host/floor 'make_right', api/tab comp and remake).
// - Late food: a fired course still cooking past its slowest dish's usual time. The server's phone already says so
//   (lib/nudges); the host stand hears too once it's later than the business says, with one tap to make it right.
// - The table's page says sorry on its own: for a course running late, and for a dish being made again.
// - A private "Something not right?" on the table's page: what went wrong (the business's own Making it right reasons),
//   which dish, a few words. It goes to the server's phone first of all, to the host stand, and to the managers and the
//   desk as a Making it right case on the visit.
// - Every report, every late table someone acts on, and every comp or remake for something that went wrong is logged on
//   that visit's case, so nothing is lost after they leave.
// Pure.
import { prepMinutes, type Course } from '@/lib/table-service';

export type RecoverySettings = { sorry: boolean; report: boolean; hostLateMin: number };
export const DEFAULT_RECOVERY: RecoverySettings = { sorry: true, report: true, hostLateMin: 10 };
/** Minutes late before the host stand hears (0: it doesn't). */
export const HOST_LATE_CHOICES = [0, 5, 10, 15, 20, 30];
export function recoverySettingsOf(tenant: any): RecoverySettings {
  const raw = tenant?.kitchenSettings?.recovery || {};
  const n = Math.round(Number(raw.hostLateMin));
  return { sorry: raw.sorry !== false, report: raw.report !== false, hostLateMin: raw.hostLateMin !== undefined && Number.isFinite(n) && n >= 0 && n <= 60 ? n : DEFAULT_RECOVERY.hostLateMin };
}
export function cleanRecovery(raw: any): RecoverySettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const out = { ...DEFAULT_RECOVERY };
  for (const k of ['sorry', 'report'] as const) { if (raw[k] === undefined) continue; if (typeof raw[k] !== 'boolean') return null; out[k] = raw[k]; }
  if (raw.hostLateMin !== undefined) { const n = Number(raw.hostLateMin); if (!Number.isInteger(n) || n < 0 || n > 60) return null; out.hostLateMin = n; }
  return out;
}

type Line = { lineId?: string; name?: string; course?: number | null; courseName?: string | null; firedAt?: string | null; kdsId?: string | null; makeSeconds?: number | null; itemType?: string };
type Ticket = { status?: string; remakeOf?: string | null };
const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const cooking = (k: Ticket | null | undefined) => !!k && (k.status === 'pending' || k.status === 'in_progress');

export type LateCourse = { n: number; name: string; overMin: number };
/** Courses running late: fired, still cooking, and longer than the slowest dish still cooking usually takes, by more
 *  than `graceMin` (the same rule as the server's "running late", lib/nudges). Whole minutes over. */
export function lateCourses(tab: Line[], tickets: Record<string, Ticket | undefined>, courses: Course[], now: number, graceMin = 0): LateCourse[] {
  const by = new Map<number, { name: string; firedAt: number; lines: Line[] }>();
  for (const l of Array.isArray(tab) ? tab : []) {
    if (!l || !l.kdsId || !cooking(tickets[String(l.kdsId)])) continue;
    const n = Number(l.course) || 0; const c = courses.find((x) => x.n === n);
    const g = by.get(n) || { name: c?.name || String(l.courseName || '') || (n ? `Course ${n}` : ''), firedAt: NaN, lines: [] };
    const f = ms(l.firedAt); if (Number.isFinite(f) && !(f >= g.firedAt)) g.firedAt = f;
    g.lines.push(l); by.set(n, g);
  }
  const out: LateCourse[] = [];
  for (const [n, g] of by) {
    if (!Number.isFinite(g.firedAt)) continue;
    const over = (now - g.firedAt) / 60000 - prepMinutes(g.lines);
    if (over >= Math.max(0, graceMin) && over > 0) out.push({ n, name: g.name, overMin: Math.floor(over) });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Dishes being made again right now (a remake still cooking), by name. */
export function remadeNow(tab: Line[], tickets: Record<string, Ticket | undefined>): string[] {
  const out: string[] = [];
  for (const l of Array.isArray(tab) ? tab : []) { const k = l?.kdsId ? tickets[String(l.kdsId)] : null; if (k && k.remakeOf && cooking(k)) out.push(String(l.name || 'your dish').slice(0, 60)); }
  return Array.from(new Set(out));
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const forWhat = (c: LateCourse) => (c.n && c.name ? `your ${c.name.toLowerCase()}` : 'your order');
/** What the table's page says, on its own: sorry for the wait on a late course, and for a dish being made again. */
export function sorryLines(late: LateCourse[], remade: string[]): string[] {
  const out: string[] = [];
  if (remade.length) out.push(`We’re making your ${list(remade.slice(0, 3))} again. Sorry about that.`);
  for (const c of late.slice(0, 2)) out.push(`Sorry for the wait on ${forWhat(c)}. The kitchen is on it now.`);
  return out;
}
/** The host stand's line for a table whose food is late. */
export const hostLateText = (table: string, c: LateCourse) => `${table || 'A table'} has waited ${c.overMin} min longer than usual for ${c.n && c.name ? `its ${c.name.toLowerCase()}` : 'its order'}.`;

/** What a guest can say went wrong: the business's own Making it right reasons that are on (lib/making-it-right), and
 *  "Something else", which asks for a few words. */
export type ReportReason = { id: string; label: string; safety: boolean };
export const OTHER_REPORT: ReportReason = { id: 'other', label: 'Something else', safety: false };
export function reportReasons(mirReasons: { id: string; label: string; safety?: boolean; on?: boolean }[]): ReportReason[] {
  const on = (Array.isArray(mirReasons) ? mirReasons : []).filter((r) => r && r.on !== false && r.id && r.label && r.id !== 'other')
    .map((r) => ({ id: String(r.id).slice(0, 40), label: String(r.label).slice(0, 80), safety: !!r.safety }));
  return [...on.slice(0, 8), OTHER_REPORT];
}
export const MAX_REPORT_WORDS = 500;
/** A table can tell us again once someone has had their last report this long; a safety reason (an allergic reaction)
 *  is always taken. */
export const REPORT_AGAIN_MIN = 15;
export function canReportAgain(last: { at?: string; safety?: boolean } | null, seenAt: string | null | undefined, now: number): boolean {
  if (!last) return true;
  const seen = Date.parse(String(seenAt || '')); return Number.isFinite(seen) && now - seen >= REPORT_AGAIN_MIN * 60000;
}
/** What the server's phone and the host stand say ("Food wasn’t right, Steak frites"). */
export const reportItem = (label: string, dish: string | null) => `${label}${dish ? `, ${dish}` : ''}`.slice(0, 120);
/** On a safety reason (an allergic reaction), the table's page says to call for help. */
export const SAFETY_WORDS = 'If anyone is having trouble breathing, call 911 now.';

/** A comp, a remake or a void whose reason means something went wrong (not a regular or a celebration): logged on the
 *  visit's Making it right case, and starts one when there isn't one yet. */
// Whole words only ("late" isn't in "chocolate"), and "our mistake" rather than any mistake ("Rung in by mistake" is the
// team's own slip, not the guest's evening).
const WENT_WRONG = /\b(too long|not right|our mistake|wrong|sent back|late|cold|complain(?:ed|t)?|unhappy|burnt|burned|undercooked|overcooked)\b/i;
export const wentWrong = (reason: unknown) => WENT_WRONG.test(String(reason || ''));
/** The case's reason for one started from a comp or a remake (the hospitality reasons, lib/making-it-right). */
export function caseReasonFor(reason: unknown): string {
  const r = String(reason || '');
  if (/too long|late|wait/i.test(r)) return 'wait';
  if (/wrong order|wrong/i.test(r)) return 'order';
  if (/not right|cold|sent back|burn|cooked/i.test(r)) return 'food';
  return 'service';
}
export type TableFix = { kind: 'comp' | 'remake' | 'void'; item: string; amount: number; reason: string; by: string; at: string };
/** The case's line for one ("Comped Steak frites, $30.00: Not right"). */
export function fixLine(f: Pick<TableFix, 'kind' | 'item' | 'amount' | 'reason'>): string {
  const what = f.kind === 'comp' ? `Comped ${f.item}, $${(Number(f.amount) || 0).toFixed(2)}` : f.kind === 'remake' ? `Made again: ${f.item}` : `Taken off: ${f.item}`;
  return `${what}${f.reason ? `: ${f.reason}` : ''}`;
}
