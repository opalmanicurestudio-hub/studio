// src/lib/attendant.ts — THE HOUSEKEEPING QUEUE (O3): one list, most urgent first, of everything that needs doing behind
// the scenes right now — stations to reset, kits to clean or finish, wash loads to start or put away. It's worked out
// from the same live records as the Stations and Kits & linens screens, so there is nothing extra to keep in step.
// Who does it is the business's choice (tenant.ops.housekeeping): each provider resets their own station (the default),
// or named team members ("attendants") do — then reminders go to them and the queue shows on their own screen.
import type { StationRow } from '@/lib/readiness';
import { typeOf, secondsLeft, kitSupply, type Kit, type KitType } from '@/lib/kits';
import type { Linen, LinenOutlook } from '@/lib/linens';

export type TaskKind = 'station' | 'inspect' | 'kit_clean' | 'kit_finish' | 'kit_decide' | 'wash_start' | 'wash_done';
export interface OpsTask { id: string; kind: TaskKind; title: string; detail: string; score: number; dueAt: string | null; ownerName?: string | null; claimed?: boolean; refId: string; goTo: 'stations' | 'kits' | 'linens'; managerOnly?: boolean }
export const housekeepingMode = (tenant: any): 'providers' | 'attendants' => (tenant?.ops?.housekeeping === 'attendants' && Array.isArray(tenant?.ops?.attendantIds) && tenant.ops.attendantIds.length ? 'attendants' : 'providers');
export const attendantIds = (tenant: any): string[] => (housekeepingMode(tenant) === 'attendants' ? tenant.ops.attendantIds.map(String) : []);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Higher score = do it sooner. Roughly: something a client is about to need > overdue > running low > routine. */
export function attendantQueue(input: { stations: StationRow[]; kits: Kit[]; kitTypes: KitType[]; linens: Linen[]; outlook: LinenOutlook[]; now?: number }): OpsTask[] {
  const now = input.now ?? Date.now(); const out: OpsTask[] = [];
  for (const r of input.stations || []) {
    const nextIn = r.next ? (Date.parse(r.next.at) - now) / 60000 : Infinity; const nextBit = r.next && nextIn < 90 ? ` · next client ${clock(r.next.at)}` : '';
    if (r.status === 'turnover') { const over = r.overdueMin || 0;
      out.push({ id: `st:${r.id}`, kind: 'station', refId: r.id, goTo: 'stations', title: `Reset ${r.name}`, ownerName: r.ownerName || null, claimed: !!r.claimed, dueAt: r.readyBy || null,
        detail: `${over ? `Overdue ${over} min` : r.readyBy ? `Ready by ${clock(r.readyBy)}` : 'After the last client'}${nextBit}${r.checklist?.length ? ` · ${r.checklist.length} steps` : ''}`,
        score: 50 + Math.min(40, over * 2) + (nextIn <= 10 ? 60 : nextIn <= 30 ? 25 : 0) }); }
    else if (r.status === 'inspect') out.push({ id: `in:${r.id}`, kind: 'inspect', refId: r.id, goTo: 'stations', title: `Check ${r.name}`, dueAt: null, detail: `${r.note || 'Flagged for inspection'}${nextBit}`, score: 45 + (nextIn <= 30 ? 40 : 0) });
  }
  const supply = kitSupply(input.kits || []);
  for (const k of input.kits || []) { const s = supply.find((x) => x.name.toLowerCase() === String(k.name).trim().toLowerCase()); const none = !!s && s.ready === 0;
    if (k.status === 'dirty') out.push({ id: `kc:${k.id}`, kind: 'kit_clean', refId: k.id, goTo: 'kits', title: `Clean ${k.name} ${k.code}`, dueAt: null, detail: none ? 'None of these are clean right now' : `${s?.ready ?? 0} clean of ${s?.total ?? 0}`, score: none ? 80 : 30 });
    else if (k.status === 'cleaning') { const m = Number(typeOf(input.kitTypes || [], k.name)?.cleanMinutes) || 0; const left = m > 0 ? secondsLeft(k.at, m, now) : -1; if (left > 0) continue;
      out.push({ id: `kf:${k.id}`, kind: 'kit_finish', refId: k.id, goTo: 'kits', title: `Finish ${k.name} ${k.code}`, dueAt: null, detail: `${m > 0 ? 'Cleaning time is up' : 'Being cleaned'} — check its contents and mark it ready`, score: none ? 85 : 40 }); }
    else if (k.status === 'out') out.push({ id: `kd:${k.id}`, kind: 'kit_decide', refId: k.id, goTo: 'kits', managerOnly: true, title: `Decide on ${k.name} ${k.code}`, dueAt: null, detail: k.note ? `Pulled out — ${k.note}` : 'Pulled out', score: none ? 70 : 20 });
  }
  for (const l of input.linens || []) { const o = (input.outlook || []).find((x) => x.id === l.id); const short = (o?.short || 0) > 0;
    if (Number(l.washing) > 0 && l.washStartedAt && (Number(l.washMinutes) > 0 ? secondsLeft(l.washStartedAt, Number(l.washMinutes), now) <= 0 : true))
      out.push({ id: `wd:${l.id}`, kind: 'wash_done', refId: l.id, goTo: 'linens', title: `Put away ${String(l.name).toLowerCase()} (${l.washing})`, dueAt: null, detail: `The wash load should be done${short ? ` · short by ${o!.short} for today` : ''}`, score: short ? 75 : 35 });
    if (Number(l.dirty) > 0 && (short || o?.belowPar || Number(l.dirty) >= 6))
      out.push({ id: `ws:${l.id}`, kind: 'wash_start', refId: l.id, goTo: 'linens', title: `Wash ${String(l.name).toLowerCase()} (${l.dirty} dirty)`, dueAt: o?.runsOutAt || null, detail: short ? `Short by ${o!.short} for today${o?.runsOutAt ? ` — needed by the ${clock(o.runsOutAt)} visit` : ''}` : o?.belowPar ? `Below your usual ${l.par} clean` : `${l.clean} clean left`, score: short ? 78 : o?.belowPar ? 38 : 22 });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
