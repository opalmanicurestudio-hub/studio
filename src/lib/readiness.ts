// src/lib/readiness.ts — STATION READINESS (O2), worked out live from the visits themselves.
// A room or piece of equipment is: blocked (out of service), in use (a visit needing it is in service), turning over
// (a visit just finished and it's inside the service's turnover time — "ready by 2:45"), needs inspection (flagged by
// staff), or ready. Computed from visits rather than stored, so it's right whichever screen moved the visit along
// (desk, POS, checkout, visit ticket) with nothing to keep in sync. Staff can mark a station ready early or flag it.
import { stageOf } from '@/lib/visit';
import { stepsForVisit, unconditionalSteps } from '@/lib/protocols';

export type Readiness = 'ready' | 'in_use' | 'turnover' | 'inspect' | 'blocked';
export const READINESS_LABEL: Record<Readiness, string> = { ready: 'Ready', in_use: 'In use', turnover: 'Turning over', inspect: 'Needs inspection', blocked: 'Blocked' };
export interface StationRow { id: string; name: string; type: string; status: Readiness; readyBy?: string | null; clientName?: string | null; visitId?: string | null; since?: string | null; note?: string | null; next?: { at: string; clientName: string | null } | null;
  // Turnover as a TASK (O3): the steps from the service's blueprint, who owns it, and whether it's late.
  checklist?: string[]; ownerId?: string | null; ownerName?: string | null; claimed?: boolean; overdueMin?: number; needsConfirm?: boolean;
  protocolId?: string | null; protocolName?: string | null; protocolVersion?: number | null; zone?: string | null;
  // Quarantine (O7): blocked until its protocol is completed.
  quarantine?: { reason: string | null; steps: string[]; protocolId: string | null; protocolName: string | null; protocolVersion: number | null } | null }
/** Default steps when a service asks for confirmation but names none. */
export const DEFAULT_TURNOVER_STEPS = ['Clear and wipe down', 'Clean and sanitise tools', 'Reset for the next client'];

const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; if (v instanceof Date) return v.getTime(); return Number(v) || 0; };
/** When the hands-on part of a visit ended (whichever screen recorded it). */
export function serviceEndedAt(a: any): number {
  const t = ms(a?.actualEndTime); if (t) return t;
  const tl = Array.isArray(a?.timeline) ? a.timeline : [];
  for (let i = tl.length - 1; i >= 0; i--) if (tl[i]?.kind === 'stage' && (tl[i].stage === 'ready_to_pay' || tl[i].stage === 'complete')) return ms(tl[i].at);
  return ms(a?.completedAt) || ms(a?.readyForCheckoutAt) || 0;
}
const needs = (a: any, id: string) => Array.isArray(a?.requiredResourceIds) && a.requiredResourceIds.includes(id);

export function stationReadiness(resources: any[], appts: any[], services: any[], now = Date.now(), staff: any[] = [], protocols: any[] = []): StationRow[] {
  const protoById = new Map((protocols || []).map((p: any) => [p.id, p]));
  const svc = new Map((services || []).map((s: any) => [s.id, s]));
  const staffName = (id: any) => { const m: any = (staff || []).find((x: any) => x.id === id); return m ? String(m.name || m.firstName || '').split(' ')[0] || null : null; };
  // A service whose blueprint names turnover steps needs someone to confirm them — its station stays "turning over"
  // (then "overdue") until they do. Without steps, the station is ready again when the turnover time is up (as before).
  // The turnover checklist for one visit: the cleaning protocol's steps for what this visit actually involved (the
  // service's protocol, else the station's default) + any named turnover steps in the blueprint — no duplicates.
  const stepsOf = (a: any, r: any): { steps: string[]; proto: any } => {
    const s: any = svc.get(a?.serviceId); const proto: any = protoById.get(s?.protocolId) || protoById.get(r?.protocolId) || null;
    const fromProto = stepsForVisit(proto, a, s);
    const ph = (s?.blueprint?.phases || []).filter((p: any) => p?.kind === 'turnover');
    const named = ph.map((p: any) => String(p.label || '').trim()).filter((l: string) => l && l.toLowerCase() !== 'turnover');
    const all = Array.from(new Set([...fromProto, ...named])).slice(0, 30);
    return { steps: all.length ? all : (ph.length ? DEFAULT_TURNOVER_STEPS : []), proto };
  };
  const turnoverOf = (a: any) => { const s: any = svc.get(a?.serviceId); return Math.max(0, Number(a?.padAfter ?? s?.padAfter ?? 0) || 0); };
  return (resources || []).filter((r: any) => r && r.id).map((r: any): StationRow => {
    const base = { id: r.id, name: r.name || 'Station', type: r.type || 'room' };
    const mine = (appts || []).filter((a: any) => needs(a, r.id) && !['cancelled', 'no_show', 'declined'].includes(String(a.status)));
    const upcoming = mine.filter((a: any) => ['booked', 'arrived', 'waiting'].includes(stageOf(a)) && ms(a.startTime) >= now - 15 * 60000).sort((x: any, y: any) => ms(x.startTime) - ms(y.startTime))[0];
    const next = upcoming ? { at: new Date(ms(upcoming.startTime)).toISOString(), clientName: upcoming.clientName || null } : null;
    if (r.isOutOfService) { const q = r.quarantine; const qp: any = q ? protoById.get(q.protocolId) || protoById.get(r.protocolId) || null : null;
      return { ...base, status: 'blocked', note: r.maintenanceNotes || r.readiness?.note || null, next, zone: r.zone || null,
        quarantine: q ? { reason: q.reason || null, steps: unconditionalSteps(qp).length ? unconditionalSteps(qp) : DEFAULT_TURNOVER_STEPS, protocolId: qp?.id || null, protocolName: qp?.name || null, protocolVersion: qp?.version || null } : null }; }
    const using = mine.find((a: any) => stageOf(a) === 'in_service');
    if (using) return { ...base, status: 'in_use', clientName: using.clientName || null, visitId: using.id, since: using.actualStartTime || null, next };
    const override = r.readiness || {}; const overrideAt = ms(override.at);
    const done = mine.map((a: any) => ({ a, end: serviceEndedAt(a) })).filter((x) => x.end && x.end <= now).sort((x, y) => y.end - x.end)[0];
    if (done) { const readyAt = done.end + turnoverOf(done.a) * 60000; const { steps, proto } = stepsOf(done.a, r); const confirmed = override.status === 'ready' && overrideAt >= done.end;
      if (!confirmed && (readyAt > now || steps.length)) {
        const claim = override.claimedFor === done.a.id ? override : null;
        return { ...base, status: 'turnover', readyBy: new Date(readyAt).toISOString(), clientName: done.a.clientName || null, visitId: done.a.id, next,
          checklist: steps, needsConfirm: steps.length > 0, protocolId: proto?.id || null, protocolName: proto?.name || null, protocolVersion: proto?.version || null, zone: r.zone || null, overdueMin: readyAt < now ? Math.ceil((now - readyAt) / 60000) : 0,
          ownerId: claim?.claimedById || done.a.staffId || null, ownerName: claim?.claimedByName || staffName(done.a.staffId) || done.a.staffName || null, claimed: !!claim }; } }
    if (override.status === 'inspect' && (!done || overrideAt >= done.end)) return { ...base, status: 'inspect', note: override.note || null, since: override.at || null, next };
    return { ...base, status: 'ready', next };
  });
}
/** Stations that need someone's attention (shown as a count on the desk). */
export const needsAttention = (rows: StationRow[]) => rows.filter((r) => r.status === 'turnover' || r.status === 'inspect' || r.status === 'blocked').length;
