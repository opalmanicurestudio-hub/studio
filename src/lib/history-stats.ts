// src/lib/history-stats.ts — ALL-TIME NUMBERS WITHOUT LOADING ALL OF HISTORY ON A DEVICE. The server works them out from
// every appointment and payment (lib/history-stats-server), keeps the answer for a few hours, and screens read the
// answer: a few numbers per client and per service instead of every visit the business has ever had. What happened
// since the answer was worked out comes from the live appointment window and is added on top (mergeClientHistory).

const DAY = 86_400_000;
const ms = (v: any): number => {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v === 'object' && 'seconds' in v) return Number(v.seconds) * 1000;
  const t = Date.parse(String(v)); return Number.isFinite(t) ? t : 0;
};

/** One client's history: completed visits, first visit, the 8 latest (id, when, service, provider), visits in the last year, latest booking of any kind, and (for people who may see money) what they've spent. */
export interface ClientHist { v: number; f: number; r: [string, number, string, string][]; y: number; la: number; sr?: number; rr?: number; tp?: number }
export interface ServiceHist { b: number; rv: number; tx: number; u: number }

export function computeHistory(appointments: any[], transactions: any[], services: any[], now = Date.now(), withMoney = true) {
  const clients: Record<string, ClientHist> = {};
  const svc: Record<string, ServiceHist> = {};
  const price = new Map<string, number>(services.map((s: any) => [String(s.id), Number(s.price) || 0]));
  const completedBy: Record<string, [string, number, string, string][]> = {};
  const svcOfAppt = new Map<string, string>();
  const svcClients: Record<string, Set<string>> = {};
  for (const a of appointments) {
    if (!a) continue;
    const t = ms(a.startTime); const cid = a.clientId ? String(a.clientId) : '';
    if (cid) { const h = (clients[cid] ||= { v: 0, f: 0, r: [], y: 0, la: 0 }); if (t > h.la) h.la = t; }
    if (a.status !== 'completed') continue;
    const sid = String(a.serviceId || '');
    if (cid) (completedBy[cid] ||= []).push([String(a.id), t, sid, String(a.staffId || '')]);
    if (sid) {
      const s = (svc[sid] ||= { b: 0, rv: 0, tx: 0, u: 0 }); s.b++; s.rv += Number(a.revenue) || price.get(sid) || 0;
      if (cid) (svcClients[sid] ||= new Set()).add(cid);
      svcOfAppt.set(String(a.id), sid);
    }
  }
  for (const [cid, list] of Object.entries(completedBy)) {
    list.sort((x, y) => y[1] - x[1]);
    const h = clients[cid]; h.v = list.length; h.f = list[list.length - 1][1]; h.r = list.slice(0, 8); h.y = list.filter((x) => now - x[1] <= 365 * DAY).length;
  }
  for (const [sid, set] of Object.entries(svcClients)) svc[sid].u = set.size;
  for (const t of transactions) {
    if (!t || t.type !== 'income') continue;
    const amt = Number(t.amount ?? (Number(t.amountCents) || 0) / 100) || 0;
    if (t.category === 'Service Revenue' && t.appointmentId) { const sid = svcOfAppt.get(String(t.appointmentId)); if (sid) svc[sid].tx += amt; }
    if (!withMoney || !t.clientId) continue;
    const h = (clients[String(t.clientId)] ||= { v: 0, f: 0, r: [], y: 0, la: 0 });
    if (t.category === 'Service Revenue') h.sr = (h.sr || 0) + amt;
    if (t.category === 'Retail') h.rr = (h.rr || 0) + amt;
    if (Number(t.tipAmount)) h.tp = (h.tp || 0) + Number(t.tipAmount);
  }
  if (!withMoney) for (const s of Object.values(svc)) { s.rv = 0; s.tx = 0; }
  return { clients, services: svc, computedAt: now };
}

/**
 * One client's history brought up to date with the live window: visits completed since the numbers were worked out are
 * added, and the latest visits (for "last visit", "usually", "comes every") come from both.
 */
export function mergeClientHistory(h: ClientHist | undefined, live: any[], now = Date.now()): { visits: number; first: number; year: number; done: { id: string; startTime: Date; serviceId: string; staffId: string; status: 'completed' }[]; latestAny: number } {
  const known = new Set((h?.r || []).map((x) => x[0]));
  const oldest = h && h.r.length >= 8 ? h.r[h.r.length - 1][1] : -Infinity;
  const fresh = live.filter((a) => a?.status === 'completed' && !known.has(String(a.id)) && ms(a.startTime) > oldest);
  const done = [
    ...(h?.r || []).map(([id, t, serviceId, staffId]) => ({ id, startTime: new Date(t), serviceId, staffId, status: 'completed' as const })),
    ...fresh.map((a) => ({ id: String(a.id), startTime: new Date(ms(a.startTime)), serviceId: String(a.serviceId || ''), staffId: String(a.staffId || ''), status: 'completed' as const })),
  ].sort((x, y) => y.startTime.getTime() - x.startTime.getTime());
  const freshFirst = fresh.length ? Math.min(...fresh.map((a) => ms(a.startTime))) : 0;
  const first = h?.f ? (freshFirst ? Math.min(h.f, freshFirst) : h.f) : freshFirst;
  const latestAny = Math.max(h?.la || 0, ...live.map((a) => ms(a?.startTime)));
  return { visits: (h?.v || 0) + fresh.length, first, year: (h?.y || 0) + fresh.filter((a) => now - ms(a.startTime) <= 365 * DAY).length, done, latestAny };
}
