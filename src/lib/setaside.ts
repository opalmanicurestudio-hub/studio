// src/lib/setaside.ts — THE PRODUCTION PLAN. For the visits ahead (in order of when they will really start — the delay
// chain's expected start when a visit is pushed back), set aside one specific kit and linen bundle for each thing the
// service's blueprint says it needs, and say whether it is ready, will be ready in time, or will not be.
//   • A kit that is clean now is free now. A used or dirty kit is free once it has been through its turnaround
//     (cleanse + sterilise + check — the kit type's "minutes to clean one", 30 if not set). A kit in its cleanse is free
//     when the cleanse ends plus the rest of the turnaround. A kit in use is free after its visit (live finish) + turnaround.
//   • A kit set aside for a visit is busy until that visit ends + turnaround, then free for the next.
//   • Linen bundles work the same way with the linen's wash time; without a wash time a dirty bundle isn't counted on today.
// Pure — the same plan runs on the front desk, the housekeeping queue, the provider's phone and the server check, and it
// re-plans itself whenever a visit runs over, a kit is scanned, or a booking changes. Nothing is written by it.
import { kitsNeeded, typeOf, sameKitType, type Kit, type KitType } from '@/lib/kits';
import { linensForVisit, resourceNeeds, sameLinen, type Linen, type LinenBundle } from '@/lib/linens';
import { visitSteps, liveTiming } from '@/lib/phase-timeline';

export type SetState = 'ready' | 'in_time' | 'late' | 'none';
export interface SetItem { kind: 'kit' | 'bundle'; type: string; refId: string | null; code: string | null; state: SetState; freeAt: number | null; note: string }
export interface SetVisit { visitId: string; clientName: string; staffId: string | null; startMs: number; items: SetItem[]; ok: boolean }
export interface Shortage { visitId: string; clientName: string; staffId: string | null; startMs: number; type: string; kind: 'kit' | 'bundle'; state: 'late' | 'none'; freeAt: number | null; text: string }

const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; if (v?.toDate) return v.toDate().getTime(); if (v instanceof Date) return v.getTime(); return Number(v) || 0; };
const closed = (a: any) => ['completed', 'cancelled', 'no_show', 'declined', 'checked_out'].includes(String(a?.status));
const started = (a: any) => ['servicing', 'in_service'].includes(String(a?.status)) || (!!a?.actualStartTime && !closed(a));
const clock = (v: number) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const turnaroundOf = (types: KitType[], name: string) => Math.max(5, Number(typeOf(types, name)?.cleanMinutes) || 30);

/** When a visit will really end: live timing if it's under way, its booked length from its (expected) start if not. */
function endOf(a: any, services: any[], startMs: number, now: number): number {
  const svc = services.find((s) => s.id === a?.serviceId);
  if (svc && started(a)) { const lt = liveTiming(visitSteps(svc, Number(a?.clientExtraMinutes) || 0), a, now); if (lt) return lt.clientEndMs; }
  const len = ms(a?.endTime) && ms(a?.startTime) ? ms(a.endTime) - ms(a.startTime) : (Number(svc?.duration) || 60) * 60000;
  return startMs + len;
}

/** Rentals of a room / station (booth reservations of a mirrored space) as bookings that can need linens and kits. */
export function rentalsAsVisits(reservations: any[]): any[] {
  // Rentals keep a date plus "HH:mm" times (hourly); day bookings without times aren't planned here.
  const at = (r: any, t: any) => { const v = String(t || ''); if (/^\d{1,2}:\d{2}/.test(v) && r.startDate) { const d = new Date(`${r.startDate}T${v.length === 4 ? '0' + v : v.slice(0, 5)}:00`); return Number.isFinite(d.getTime()) ? d.toISOString() : null; } return Date.parse(v) ? new Date(v).toISOString() : null; };
  return (reservations || []).filter((r) => r && r.startTime && r.endTime && !['cancelled', 'refunded', 'completed', 'cancel_requested', 'no_show'].includes(String(r.status || '')))
    .map((r) => { const m = /^space_(.+)_\d+$/.exec(String(r.boothId || '')); const st = at(r, r.startTime), en = at(r, r.endTime); return m && st && en ? { id: `res:${r.id}`, clientName: r.guestName || r.renterName || r.name || 'Rental', staffId: null, status: r.status === 'checked_in' ? 'servicing' : 'confirmed', actualStartTime: r.status === 'checked_in' ? (r.actualCheckIn || st) : null, startTime: st, endTime: en, requiredResourceIds: [m[1]], isRental: true } : null; })
    .filter(Boolean);
}
/** Everything a booking needs: its service and add-ons, plus what the rooms / stations it uses need for every booking. */
export function needsFor(visit: any, services: any[], resources?: any[]): { kits: { name: string; qty: number }[]; linens: { name: string; qty: number }[] } {
  const svc = services.find((s) => s.id === visit?.serviceId);
  const kits = [...(svc ? kitsNeeded(svc) : [])]; for (const n of resourceNeeds(visit, resources, 'kit')) { const e = kits.find((k) => sameKitType(k.name, n.name)); if (e) e.qty += n.qty; else kits.push(n); }
  return { kits, linens: linensForVisit(visit, services, resources) };
}

export function planSetAside(input: { visits: any[]; services: any[]; kits: Kit[]; kitTypes: KitType[]; bundles?: LinenBundle[]; linens?: Linen[]; resources?: any[]; reservations?: any[]; now?: number; horizonHours?: number }): { visits: SetVisit[]; shortages: Shortage[]; byKit: Record<string, { visitId: string; clientName: string; staffId: string | null; startMs: number }>; byBundle: Record<string, { visitId: string; clientName: string; staffId: string | null; startMs: number }> } {
  const now = input.now ?? Date.now(); const services = input.services || []; const types = input.kitTypes || [];
  const horizon = now + (input.horizonHours ?? 14) * 3600000;
  const allVisits = [...(input.visits || []), ...rentalsAsVisits(input.reservations || [])];
  const visitEnd = new Map<string, number>();
  for (const a of allVisits) if (started(a)) visitEnd.set(a.id, endOf(a, services, ms(a.actualStartTime) || ms(a.startTime), now));
  // Kits: when each one is next free
  const kitFree = new Map<string, number>();
  for (const k of input.kits || []) {
    if (k.status === 'out' || k.status === 'retired') continue;
    const t = turnaroundOf(types, k.name); const c: any = (k as any).cleanse;
    let at = now;
    if (k.status === 'in_use') at = (k.visitId && visitEnd.get(k.visitId) ? visitEnd.get(k.visitId)! : now) + t * 60000;
    else if (k.status === 'dirty') at = now + t * 60000;
    else if (k.status === 'cleaning') { if (c?.startedAt) { const cEnd = ms(c.startedAt) + (Number(c.minutes) || 0) * 60000; at = Math.max(now, cEnd) + Math.max(5, t - (Number(c.minutes) || 0)) * 60000; } else at = Math.max(now + 5 * 60000, (ms(k.at) || now) + t * 60000); }
    kitFree.set(k.id, at);
  }
  // Bundles: clean now, or after the wash when the linen has a wash time
  const linens = input.linens || []; const bundleFree = new Map<string, number>();
  for (const b of input.bundles || []) {
    const ln = linens.find((l) => l.id === b.linenId); const wash = Number(ln?.washMinutes) || 0; const dry = Number(ln?.dryMinutes) || 0; const FOLD = 15;
    const st = String(b.status);
    if (st === 'clean') bundleFree.set(b.id, now);
    else if (st === 'folding') bundleFree.set(b.id, now + FOLD * 60000);
    else if (st === 'drying' && dry) bundleFree.set(b.id, Math.max(now, (ms(b.at) || now) + dry * 60000) + FOLD * 60000);
    else if (st === 'washing' && wash) bundleFree.set(b.id, Math.max(now, (ms(b.at) || now) + wash * 60000) + (dry + FOLD) * 60000);
    else if (st === 'dirty' && wash) bundleFree.set(b.id, now + (wash + dry + FOLD + 15) * 60000);
  }
  const upcoming = allVisits.filter((a) => !closed(a) && !started(a)).map((a) => ({ a, startMs: ms(a.expectedStartAt) > ms(a.startTime) ? ms(a.expectedStartAt) : ms(a.startTime) }))
    .filter((x) => x.startMs > now - 2 * 3600000 && x.startMs < horizon).sort((x, y) => x.startMs - y.startMs);
  const out: SetVisit[] = []; const shortages: Shortage[] = []; const byKit: Record<string, any> = {}; const byBundle: Record<string, any> = {};
  for (const { a, startMs } of upcoming) {
    const need = needsFor(a, services, input.resources); if (!need.kits.length && !need.linens.length) continue;
    const items: SetItem[] = []; const end = endOf(a, services, startMs, now);
    const pick = (kind: 'kit' | 'bundle', type: string, pool: { id: string; code: string; pinned: boolean }[], free: Map<string, number>, busyUntil: number) => {
      const cands = pool.filter((p) => free.has(p.id)).sort((x, y) => Number(y.pinned) - Number(x.pinned) || free.get(x.id)! - free.get(y.id)!);
      const inTime = cands.find((p) => free.get(p.id)! <= startMs); const best = inTime || cands[0] || null;
      if (!best) { items.push({ kind, type, refId: null, code: null, state: 'none', freeAt: null, note: `No ${type.toLowerCase()} available` }); return; }
      const f = free.get(best.id)!;
      if (f > horizon) { items.push({ kind, type, refId: null, code: null, state: 'none', freeAt: null, note: kind === 'bundle' ? 'None clean — wash a load' : `No ${type.toLowerCase()} free today` }); return; }
      const state: SetState = f <= now ? 'ready' : f <= startMs ? 'in_time' : 'late';
      items.push({ kind, type, refId: best.id, code: best.code, state, freeAt: f, note: state === 'ready' ? 'Ready' : state === 'in_time' ? `Ready ~${clock(f)}` : `Not before ~${clock(f)}` });
      free.set(best.id, Math.max(f, startMs) + (busyUntil - startMs));
      (kind === 'kit' ? byKit : byBundle)[best.id] ||= { visitId: a.id, clientName: String(a.clientName || ''), staffId: a.staffId || null, startMs };
    };
    for (const nk of need.kits) for (let n = 0; n < Math.max(1, nk.qty); n++) {
      const pool = (input.kits || []).filter((k) => sameKitType(k.name, nk.name)).map((k) => ({ id: k.id, code: k.code, pinned: (k as any).setFor === a.id }));
      pick('kit', nk.name, pool, kitFree, end + turnaroundOf(types, nk.name) * 60000);
    }
    for (const nl of need.linens) {
      const ln = linens.find((l) => sameLinen(l.name, nl.name)); if (!ln) continue;
      const pool = (input.bundles || []).filter((b) => b.linenId === ln.id && Number(b.qty) >= nl.qty).map((b) => ({ id: b.id, code: b.code, pinned: (b as any).setFor === a.id }));
      if (!(input.bundles || []).some((b) => b.linenId === ln.id)) continue;   // this linen isn't bundled — counted by the linen outlook instead
      const wash = Number(ln.washMinutes) || 0, dry = Number(ln.dryMinutes) || 0;   // a used bundle comes back after wash, dry and fold when the times are known; otherwise it's gone for the day
      pick('bundle', `${nl.name}${nl.qty > 1 ? ` ×${nl.qty}` : ''}`, pool, bundleFree, wash ? end + (wash + dry + 30) * 60000 : end + 48 * 3600000);
    }
    const ok = items.every((i) => i.state === 'ready' || i.state === 'in_time');
    out.push({ visitId: a.id, clientName: String(a.clientName || 'Client'), staffId: a.staffId || null, startMs, items, ok });
    for (const i of items) if (i.state === 'late' || i.state === 'none') shortages.push({ visitId: a.id, clientName: String(a.clientName || 'Client'), staffId: a.staffId || null, startMs, type: i.type, kind: i.kind, state: i.state, freeAt: i.freeAt,
      text: `${i.type} for ${String(a.clientName || 'the client').split(' ')[0]} at ${clock(startMs)} — ${i.state === 'none' ? 'none available' : `none free until ~${clock(i.freeAt!)}${i.code ? ` (${i.code})` : ''}`}` });
  }
  return { visits: out, shortages, byKit, byBundle };
}
