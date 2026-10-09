// src/lib/delay.ts — THE DELAY CHAIN. When a visit runs behind, who and what does it push back?
// One live visit's real timing (phase-timeline.liveTiming) is followed down the line: the same provider's next clients
// (they can start once the provider's hands-on part is done) and the next visit in the same station (it can start
// once the reset after this visit is done). Each knock-on visit's own length carries the delay forward, so a
// 15-minute overrun at 2pm shows up on the 3pm and the 4pm if there is no slack between them.
// Used by the front desk ("Running behind"), the server tick (who to tell) and the visit's own timeline.
import { visitSteps, liveTiming } from '@/lib/phase-timeline';

export interface DelaySettings { marginMin: number; clientMessages: 'desk' | 'auto' | 'off'; autoMaxMin: number; /** From this many minutes late the client is offered keep / reschedule / cancel (no fee). */ choiceFromMin: number }
/** Per-business, with suggested defaults: 5 min margin; the desk confirms client messages first; auto-send only up to
 *  20 min; from 15 min late the client is offered keep / reschedule / cancel with no fee. */
export function delaySettings(tenant: any): DelaySettings {
  const d = tenant?.ops?.delay || {};
  const m = Number(d.marginMin); const a = Number(d.autoMaxMin); const c = Number(d.choiceFromMin);
  return { marginMin: Number.isFinite(m) && m >= 1 ? Math.round(m) : 5, clientMessages: ['desk', 'auto', 'off'].includes(d.clientMessages) ? d.clientMessages : 'desk', autoMaxMin: Number.isFinite(a) && a >= 1 ? Math.round(a) : 20, choiceFromMin: Number.isFinite(c) && c >= 1 ? Math.round(c) : 15 };
}

export interface Knock { id: string; clientName: string; staffId: string | null; startMs: number; expectedMs: number; lateMin: number; why: 'provider' | 'station'; depth: number }
export interface DelayEntry { visitId: string; clientName: string; staffId: string | null; delayMin: number; clientEndMs: number; freeMs: number; stationIds: string[]; next: Knock[] }

const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; if (v?.toDate) return v.toDate().getTime(); if (v instanceof Date) return v.getTime(); return Number(v) || 0; };
const closed = (a: any) => ['completed', 'cancelled', 'no_show', 'declined', 'checked_out'].includes(String(a?.status));
const started = (a: any) => ['servicing', 'in_service'].includes(String(a?.status)) || (!!a?.actualStartTime && !closed(a));
const stations = (a: any): string[] => (Array.isArray(a?.requiredResourceIds) ? a.requiredResourceIds.filter(Boolean) : []);
/** A booked visit's length: client minutes and the reset after it. */
function lengths(a: any, services: any[]): { client: number; turnover: number } {
  const svc = services.find((s) => s.id === a?.serviceId);
  const st = svc ? visitSteps(svc, Number(a?.clientExtraMinutes) || 0) : [];
  const client = st.filter((s) => s.kind !== 'setup' && s.kind !== 'turnover').reduce((n, s) => n + s.minutes, 0);
  const turnover = st.filter((s) => s.kind === 'turnover').reduce((n, s) => n + s.minutes, 0);
  const booked = ms(a?.endTime) && ms(a?.startTime) ? Math.round((ms(a.endTime) - ms(a.startTime)) / 60000) : Number(a?.duration) || Number(svc?.duration) || 60;
  return { client: client || booked, turnover };
}

/** Every live visit at least `marginMin` behind, with the visits it pushes back (at most `maxDepth` along each line). */
export function delayChain(input: { appts: any[]; services: any[]; now: number; settings: DelaySettings; maxDepth?: number }): DelayEntry[] {
  const { appts, services, now, settings } = input; const maxDepth = input.maxDepth ?? 3;
  const upcoming = appts.filter((a) => !closed(a) && !started(a) && ms(a.startTime) > now - 3 * 3600000 && ms(a.startTime) < now + 12 * 3600000)
    .sort((x, y) => ms(x.startTime) - ms(y.startTime));
  const out: DelayEntry[] = [];
  for (const a of appts) {
    if (!started(a)) continue;
    const svc = services.find((s) => s.id === a.serviceId); if (!svc) continue;
    const lt = liveTiming(visitSteps(svc, Number(a.clientExtraMinutes) || 0), a, now); if (!lt || lt.delayMin < settings.marginMin) continue;
    const next: Knock[] = []; const seen = new Set<string>();
    // Follow a line: each knock-on visit starts at the later of its booked time and when its provider / station is free.
    const follow = (why: 'provider' | 'station', freeAt: number, match: (x: any) => boolean) => {
      let free = freeAt; let depth = 1;
      for (const x of upcoming) { if (depth > maxDepth) break; if (!match(x)) continue;
        const start = ms(x.startTime); const expected = Math.max(start, free); const late = Math.round((expected - start) / 60000);
        if (late < 1) break;   // slack absorbed it — nothing further down this line moves
        if (!seen.has(x.id)) { seen.add(x.id); next.push({ id: x.id, clientName: String(x.clientName || 'Client'), staffId: x.staffId || null, startMs: start, expectedMs: expected, lateMin: late, why, depth }); }
        else { const k = next.find((n) => n.id === x.id)!; if (late > k.lateMin) { k.lateMin = late; k.expectedMs = expected; k.why = why; } }
        const L = lengths(x, services); free = expected + (why === 'provider' ? L.client : L.client + L.turnover) * 60000; depth++; }
    };
    if (a.staffId) follow('provider', lt.clientEndMs, (x) => x.staffId === a.staffId);
    const mine = stations(a); if (mine.length) follow('station', lt.freeMs, (x) => stations(x).some((r) => mine.includes(r)));
    next.sort((x, y) => x.startMs - y.startMs);
    out.push({ visitId: a.id, clientName: String(a.clientName || 'Client'), staffId: a.staffId || null, delayMin: lt.delayMin, clientEndMs: lt.clientEndMs, freeMs: lt.freeMs, stationIds: mine, next });
  }
  return out.sort((x, y) => y.delayMin - x.delayMin);
}

/** The text a client gets when their visit will start late (kept short for a text message). */
export function delayClientText(o: { first: string; studio?: string; provider?: string | null; startMs: number; expectedMs: number; timeZone?: string }): string {
  const t = (v: number) => new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: o.timeZone || undefined });
  const late = Math.max(1, Math.round((o.expectedMs - o.startMs) / 60000));
  return `Hi ${o.first}, ${o.provider ? `${o.provider} is` : 'we’re'} running about ${late} min behind today. Your ${t(o.startMs)} visit should start around ${t(o.expectedMs)} — no need to rush. Sorry for the wait!`;
}

/** Notify again only when the knock-on has grown by at least the margin since the last notice. */
export const worthTelling = (minutesNow: number, toldMin: number | null | undefined, margin: number) => minutesNow >= margin && (toldMin == null || minutesNow >= toldMin + margin);
