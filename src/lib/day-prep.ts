// src/lib/day-prep.ts — READY FOR THE DAY (O10/O11). Looks at one day's bookings (plus an allowance for walk-ins, if the
// business takes them) and says whether there will be enough kits and linens, and exactly what to do beforehand:
//   kits   — the most that are needed AT THE SAME TIME (each one is held for the visit plus its cleaning time) against
//            how many are usable, and how many must be clean when the doors open;
//   linens — the day's total against what's clean now, what's dirty or in the wash (could be clean by then), and what's owned.
// Walk-in allowance (tenant.ops.walkIns = { perDay, serviceId }): that many extra visits of the usual walk-in service are
// added to the linen totals, and one more kit (two from six a day) is added to each kit peak that service uses.
import { kitsNeeded, kitKey, typeOf, type Kit, type KitType } from '@/lib/kits';
import { linensForVisit, sameLinen, type Linen } from '@/lib/linens';

export interface KitPrep { key: string; name: string; uses: number; peak: number; usable: number; readyNow: number; firstWave: number; shortPeak: number; toCleanBefore: number; walkIn: number }
export interface LinenPrep { id: string; name: string; needed: number; clean: number; couldBeClean: number; owned: number; toWashBefore: number; midDayWash: boolean; shortOwned: number; walkIn: number }
export interface DayPrep { visits: number; walkIns: number; kits: KitPrep[]; linens: LinenPrep[]; ready: boolean; todo: string[] }
const ms = (v: any): number => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : v instanceof Date ? v.getTime() : 0);
const n0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));

export function dayPrep(input: { visits: any[]; services: any[]; kits: Kit[]; kitTypes: KitType[]; linens: Linen[]; walkIns?: { perDay?: number; serviceId?: string | null } | null }): DayPrep {
  const svc = (id: any) => (input.services || []).find((s: any) => s.id === id);
  const visits = (input.visits || []).filter((v) => !['cancelled', 'no_show', 'declined'].includes(String(v?.status)) && ms(v?.startTime));
  const wi = n0(input.walkIns?.perDay); const wiService = wi ? svc(input.walkIns?.serviceId) || null : null; const wiKitBoost = wi >= 6 ? 2 : wi > 0 ? 1 : 0;
  const todo: string[] = [];
  // Kits
  const kits: KitPrep[] = []; const live = (input.kits || []).filter((k) => k.status !== 'retired'); const names = new Map<string, string>();
  for (const k of live) names.set(kitKey(k.name), String(k.name).trim());
  for (const [key, name] of names) {
    const clean = n0(typeOf(input.kitTypes || [], name)?.cleanMinutes); const events: [number, number][] = []; let uses = 0; const starts: number[] = [];
    for (const v of visits) { const q = [v.serviceId, ...(Array.isArray(v.addOnIds) ? v.addOnIds : [])].reduce((a: number, id: any) => a + (kitsNeeded(svc(id)).find((x) => kitKey(x.name) === key)?.qty || 0), 0); if (!q) continue;
      const s = ms(v.startTime); const e = (ms(v.endTime) || s + n0(svc(v.serviceId)?.duration || 60) * 60000) + clean * 60000;
      for (let i = 0; i < q; i++) { events.push([s, 1], [e, -1]); starts.push(s); } uses += q; }
    const wq = wiService ? kitsNeeded(wiService).find((x) => kitKey(x.name) === key)?.qty || 0 : 0; const walkIn = wq ? wiKitBoost * wq : 0;
    if (!uses && !walkIn) continue;
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let cur = 0, peak = 0; for (const [, d] of events) { cur += d; peak = Math.max(peak, cur); }
    peak += walkIn;
    // How many are needed before the first one used could be back (the opening wave).
    starts.sort((a, b) => a - b); const first = starts[0] || 0; const firstBack = first ? (ms(visits.find((v) => ms(v.startTime) === first)?.endTime) || first + 60 * 60000) + clean * 60000 : 0;
    const firstWave = Math.min(peak, starts.filter((s) => s < firstBack).length + walkIn);
    const mine = live.filter((k) => kitKey(k.name) === key); const usable = mine.filter((k) => k.status !== 'out').length; const readyNow = mine.filter((k) => k.status === 'ready').length;
    const row: KitPrep = { key, name, uses: uses + (wq ? wi * wq : 0), peak, usable, readyNow, firstWave, shortPeak: Math.max(0, peak - usable), toCleanBefore: Math.max(0, Math.min(firstWave, usable) - readyNow), walkIn };
    kits.push(row);
    if (row.shortPeak) todo.push(`${name}: ${peak} needed at the busiest moment but only ${usable} usable — add ${row.shortPeak}, or space those bookings out.`);
    if (row.toCleanBefore) todo.push(`Clean ${row.toCleanBefore} more ${name.toLowerCase()}${row.toCleanBefore === 1 ? '' : 's'} before opening (${readyNow} clean, ${row.firstWave} needed for the first wave).`);
  }
  // Linens
  const linens: LinenPrep[] = [];
  for (const l of input.linens || []) { let needed = 0; for (const v of visits) needed += linensForVisit(v, input.services || []).find((x) => sameLinen(x.name, l.name))?.qty || 0;
    const wq = wiService ? linensForVisit({ serviceId: wiService.id }, input.services || []).find((x) => sameLinen(x.name, l.name))?.qty || 0 : 0; const walkIn = wi * wq; needed += walkIn; if (!needed) continue;
    const clean = n0(l.clean), couldBe = clean + n0(l.dirty) + n0(l.washing), owned = couldBe + n0(l.inUse);
    const row: LinenPrep = { id: l.id, name: l.name, needed, clean, couldBeClean: couldBe, owned, toWashBefore: Math.max(0, Math.min(needed, couldBe) - clean), midDayWash: needed > owned ? true : needed > couldBe, shortOwned: Math.max(0, needed - owned), walkIn };
    linens.push(row);
    if (row.toWashBefore) todo.push(`Wash ${row.toWashBefore} ${String(l.name).toLowerCase()}${row.toWashBefore === 1 ? '' : 's'} before opening (${clean} clean, ${needed} needed).`);
    if (row.shortOwned) todo.push(`${l.name}: the day needs ${needed} but you own ${owned} — plan a wash load during the day (each one is used more than once).`);
  }
  return { visits: visits.length, walkIns: wi, kits, linens, ready: todo.length === 0, todo };
}
