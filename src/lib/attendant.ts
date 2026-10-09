// src/lib/attendant.ts — THE HOUSEKEEPING QUEUE (O3): one list, most urgent first, of everything that needs doing behind
// the scenes right now — stations to reset, kits to clean or finish, wash loads to start or put away. It's worked out
// from the same live records as the Stations and Kits & linens screens, so there is nothing extra to keep in step.
// Who does it is the business's choice (tenant.ops.housekeeping): each provider resets their own station (the default),
// or named team members ("attendants") do — then reminders go to them and the queue shows on their own screen.
import type { StationRow } from '@/lib/readiness';
import { typeOf, secondsLeft, kitSupply, type Kit, type KitType } from '@/lib/kits';
import { cleanseState } from '@/lib/cleanse';
import type { Linen, LinenOutlook } from '@/lib/linens';

export type TaskKind = 'station' | 'inspect' | 'kit_clean' | 'kit_finish' | 'kit_decide' | 'wash_start' | 'wash_done' | 'request' | 'prep';
export interface OpsTask { id: string; kind: TaskKind; title: string; detail: string; score: number; dueAt: string | null; ownerName?: string | null; claimed?: boolean; refId: string; goTo: 'stations' | 'kits' | 'linens' | 'assist'; managerOnly?: boolean;
  /** A station request (O4): who asked, and whether someone is already on it. */ request?: { source: 'assist' | 'lounge' | 'restock'; status: string; acceptedBy?: string | null; requester?: string | null };
  /** Who has said they're doing it, and any note left by the last person who had it. */ claimedBy?: string | null; claimedById?: string | null; handover?: { from: string; note: string; at: string } | null }
export const housekeepingMode = (tenant: any): 'providers' | 'attendants' => (tenant?.ops?.housekeeping === 'attendants' && Array.isArray(tenant?.ops?.attendantIds) && tenant.ops.attendantIds.length ? 'attendants' : 'providers');
export const attendantIds = (tenant: any): string[] => (housekeepingMode(tenant) === 'attendants' ? tenant.ops.attendantIds.map(String) : []);
const many = (name: any) => { const n = String(name || '').trim().toLowerCase(); return /s$/.test(n) ? n : `${n}s`; };
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Higher score = do it sooner. Roughly: something a client is about to need > overdue > running low > routine. */
export function attendantQueue(input: { stations: StationRow[]; kits: Kit[]; kitTypes: KitType[]; linens: Linen[]; outlook: LinenOutlook[]; requests?: any[]; claims?: any[]; prep?: OpsTask[]; now?: number }): OpsTask[] {
  const now = input.now ?? Date.now(); const out: OpsTask[] = [];
  for (const r of input.stations || []) {
    const nextIn = r.next ? (Date.parse(r.next.at) - now) / 60000 : Infinity; const nextBit = r.next && nextIn < 90 ? ` · next client ${clock(r.next.at)}` : '';
    if (r.status === 'turnover') { const over = r.overdueMin || 0;
      out.push({ id: `st:${r.id}`, kind: 'station', refId: r.id, goTo: 'stations', title: `Reset ${r.name}`, ownerName: r.ownerName || null, claimed: !!r.claimed, dueAt: r.readyBy || null,
        detail: `${over ? `Overdue ${over} min` : r.readyBy ? `Ready by ${clock(r.readyBy)}` : 'After the last client'}${nextBit}${r.checklist?.length ? ` · ${r.checklist.length} step${r.checklist.length === 1 ? '' : 's'}` : ''}`,
        score: 50 + Math.min(40, over * 2) + (nextIn <= 10 ? 60 : nextIn <= 30 ? 25 : 0) }); }
    else if (r.status === 'inspect') out.push({ id: `in:${r.id}`, kind: 'inspect', refId: r.id, goTo: 'stations', title: `Check ${r.name}`, dueAt: null, detail: `${r.note || 'Flagged for inspection'}${nextBit}`, score: 45 + (nextIn <= 30 ? 40 : 0) });
  }
  const supply = kitSupply(input.kits || []);
  for (const k of input.kits || []) { const s = supply.find((x) => x.name.toLowerCase() === String(k.name).trim().toLowerCase()); const none = !!s && s.ready === 0;
    if (k.status === 'dirty') out.push({ id: `kc:${k.id}`, kind: 'kit_clean', refId: k.id, goTo: 'kits', title: `Cleanse ${k.name} ${k.code}`, dueAt: null, detail: none ? 'None of these are clean right now' : `${s?.ready ?? 0} clean of ${s?.total ?? 0}`, score: none ? 80 : 30 });
    else if (k.status === 'cleaning') { const cs = cleanseState(k, now); const m = Number(typeOf(input.kitTypes || [], k.name)?.cleanMinutes) || 0; const left = (k as any).cleanse ? (cs.done ? -1 : cs.secondsLeft) : m > 0 ? secondsLeft(k.at, m, now) : -1; if (left > 0) continue;
      out.push({ id: `kf:${k.id}`, kind: 'kit_finish', refId: k.id, goTo: 'kits', title: `Sterilise or check ${k.name} ${k.code}`, dueAt: null, detail: (k as any).cleanse ? 'Cleanse complete — into the steriliser, or check its contents and mark it ready' : `${m > 0 ? 'Cleaning time is up' : 'Being cleaned'} — check its contents and mark it ready`, score: none ? 85 : 40 }); }
    else if (k.status === 'out') out.push({ id: `kd:${k.id}`, kind: 'kit_decide', refId: k.id, goTo: 'kits', managerOnly: true, title: `Decide on ${k.name} ${k.code}`, dueAt: null, detail: k.note ? `Pulled out — ${k.note}` : 'Pulled out', score: none ? 70 : 20 });
  }
  for (const l of input.linens || []) { const o = (input.outlook || []).find((x) => x.id === l.id); const short = (o?.short || 0) > 0;
    if (Number(l.washing) > 0 && l.washStartedAt && (Number(l.washMinutes) > 0 ? secondsLeft(l.washStartedAt, Number(l.washMinutes), now) <= 0 : true))
      out.push({ id: `wd:${l.id}`, kind: 'wash_done', refId: l.id, goTo: 'linens', title: `Put away ${many(l.name)} (${l.washing})`, dueAt: null, detail: `The wash load should be done${short ? ` · short by ${o!.short} for today` : ''}`, score: short ? 75 : 35 });
    if (Number(l.dirty) > 0 && (short || o?.belowPar || Number(l.dirty) >= 6))
      out.push({ id: `ws:${l.id}`, kind: 'wash_start', refId: l.id, goTo: 'linens', title: `Wash ${many(l.name)} (${l.dirty} dirty)`, dueAt: o?.runsOutAt || null, detail: short ? `Short by ${o!.short} for today${o?.runsOutAt ? ` — needed by the ${clock(o.runsOutAt)} visit` : ''}` : o?.belowPar ? `Below your usual ${l.par} clean` : `${l.clean} clean left`, score: short ? 78 : o?.belowPar ? 38 : 22 });
  }
  // What providers have asked for from their stations (and lounge orders, restock requests) — same list, so nothing is missed.
  for (const r of input.requests || []) { if (r.status !== 'open' && r.status !== 'accepted') continue;
    const byIn = r.neededBy ? (Date.parse(r.neededBy) - now) / 60000 : Infinity;
    out.push({ id: `rq:${r.source}:${r.id}`, kind: 'request', refId: r.id, goTo: 'assist', title: `${r.title}${r.where ? ` — ${r.where}` : ''}`, dueAt: r.neededBy || null,
      detail: `${r.requester ? `${String(r.requester).split(' ')[0]} asked` : 'Asked'}${r.forClient ? ` for ${r.forClient}` : ''} · ${r.ageMin < 1 ? 'just now' : `${r.ageMin} min ago`}${r.status === 'accepted' && r.acceptedBy ? ` · ${String(r.acceptedBy).split(' ')[0]} is on it` : ''}${r.detail ? ` · ${r.detail}` : ''}`,
      request: { source: r.source, status: r.status, acceptedBy: r.acceptedBy || null, requester: r.requester || null }, claimed: r.status === 'accepted', claimedBy: r.acceptedBy || null,
      score: r.status === 'accepted' ? 42 : r.escalated ? 100 : r.urgency === 'now' ? 95 : r.urgency === 'by' ? (byIn <= 10 ? 90 : byIn <= 30 ? 60 : 35) : 65 }); }
  for (const p of input.prep || []) out.push(p);
  // Who's on what (kits, linens and prep jobs; stations and requests carry their own).
  const fresh = (input.claims || []).filter((c) => c && now - (Date.parse(String(c.at || '')) || 0) < 12 * 3600000);
  for (const t of out) { const c = fresh.find((x) => x.taskId === t.id); if (!c) continue;
    if (c.byId) { t.claimed = true; t.claimedBy = c.byName || null; t.claimedById = c.byId; }
    if (c.handover?.note || c.handover?.from) t.handover = c.handover; }
  for (const t of out) if (t.kind === 'station' && t.claimed && !t.claimedBy) t.claimedBy = t.ownerName || null;
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
/** How many jobs one person may hold at once (the business can change it; 3 unless set). */
export const taskLimit = (tenant: any) => Math.max(1, Math.min(10, Math.round(Number(tenant?.ops?.maxTasksEach) || 3)));
/** Jobs this person has said they're doing. */
export const tasksHeldBy = (tasks: OpsTask[], uid: string | null | undefined, name?: string | null) => tasks.filter((t) => t.claimed && ((uid && t.claimedById === uid) || (!t.claimedById && name && t.claimedBy && String(t.claimedBy).split(' ')[0] === String(name).split(' ')[0])));
/** The people doing housekeeping right now: named, active, and not on a break. */
export function attendantsOnNow(tenant: any, staff: any[]): { on: any[]; onBreak: any[] } {
  const ids = attendantIds(tenant); const mine = (staff || []).filter((s) => s && ids.includes(String(s.id)) && s.active !== false);
  return { on: mine.filter((s) => !s.onBreak), onBreak: mine.filter((s) => s.onBreak) };
}
