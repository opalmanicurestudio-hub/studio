// src/lib/reconnect.ts
//
// RECONNECT — the little nudges that bring quiet clients back.
//
// Two kinds, each switched on separately, by the STUDIO for its own clients
// (tenant.reconnect) and by EACH RENTER for theirs (renter.reconnect):
//
//   due       — "It's been 3 weeks since your Gel Fill — time for a refresh?"
//               Fires when a client passes the service's own rebook interval
//               (service.rebookWeeks) plus a grace of a few days.
//   miss_you  — "We haven't seen you in a while…" after N weeks with no visit.
//
// Guardrails, all enforced here, not left to good intentions:
//   • never if they already have a visit booked
//   • never if they opted out (client.reconnectOptOut) or have no contact
//   • at most one nudge per client per `minDaysBetween` (default 21), across
//     BOTH kinds — a client never gets "you're due" and "we miss you" together
//   • `miss_you` only once per lapse: not again until they've visited since
//   • a daily cap per sender, so a first switch-on can't blast a whole book
//
// Each send is written to `reconnectNudges`. When the same client books
// within 14 days, the book route marks the nudge converted — that is the
// tally the owner and each renter see.

export interface ReconnectSettings {
  enabled?: boolean;
  dueEnabled?: boolean;
  missEnabled?: boolean;
  dueGraceDays?: number;        // days past the interval before nudging (default 3)
  missWeeks?: number;           // weeks with no visit (default 10)
  minDaysBetween?: number;      // default 21
  dailyCap?: number;            // default 25
  dueMessage?: string;          // optional custom text with {first} {service} {weeks} {link}
  missMessage?: string;         // optional custom text with {first} {weeks} {link}
}

export function cleanReconnect(x: any): Required<Omit<ReconnectSettings, 'dueMessage' | 'missMessage'>> & { dueMessage: string; missMessage: string } {
  const n = (v: any, lo: number, hi: number, d: number) => { const k = Math.round(Number(v)); return Number.isFinite(k) && v !== '' && v !== null && v !== undefined ? Math.max(lo, Math.min(hi, k)) : d; };
  return {
    enabled: x?.enabled === true,
    dueEnabled: x?.dueEnabled !== false,
    missEnabled: x?.missEnabled !== false,
    dueGraceDays: n(x?.dueGraceDays, 0, 30, 3),
    missWeeks: n(x?.missWeeks, 3, 104, 10),
    minDaysBetween: n(x?.minDaysBetween, 7, 180, 21),
    dailyCap: n(x?.dailyCap, 1, 200, 25),
    dueMessage: String(x?.dueMessage || '').slice(0, 320),
    missMessage: String(x?.missMessage || '').slice(0, 320),
  };
}

export interface ClientHistory {
  clientId: string;
  first: string;
  lastVisitIso: string | null;        // last COMPLETED visit
  lastServiceId: string | null;
  lastServiceName: string | null;
  hasUpcoming: boolean;
  optedOut: boolean;
  hasContact: boolean;
  lastNudgeIso: string | null;        // any kind
  lastMissNudgeIso: string | null;
}

export type NudgeDecision = { kind: 'due'; weeks: number; serviceName: string } | { kind: 'miss_you'; weeks: number } | null;

const DAY = 86400000;

/** Pure: should this client get a nudge today, and which one? */
export function decideNudge(settings: ReturnType<typeof cleanReconnect>, c: ClientHistory, rebookWeeksByService: Map<string, number>, now = Date.now()): NudgeDecision {
  if (!settings.enabled) return null;
  if (!c.lastVisitIso || c.hasUpcoming || c.optedOut || !c.hasContact) return null;
  if (c.lastNudgeIso && now - new Date(c.lastNudgeIso).getTime() < settings.minDaysBetween * DAY) return null;
  const since = now - new Date(c.lastVisitIso).getTime();
  const weeks = Math.floor(since / (7 * DAY));

  // "We miss you" beats "you're due" once they're properly quiet — and only
  // once per lapse (a nudge after the last visit counts).
  if (settings.missEnabled && since >= settings.missWeeks * 7 * DAY) {
    const alreadyThisLapse = c.lastMissNudgeIso && new Date(c.lastMissNudgeIso).getTime() > new Date(c.lastVisitIso).getTime();
    return alreadyThisLapse ? null : { kind: 'miss_you', weeks };
  }
  if (settings.dueEnabled && c.lastServiceId) {
    const every = rebookWeeksByService.get(c.lastServiceId) || 0;
    if (every > 0 && since >= every * 7 * DAY + settings.dueGraceDays * DAY) {
      // One "due" per visit: a nudge already sent since the last visit is enough.
      const nudgedSinceVisit = c.lastNudgeIso && new Date(c.lastNudgeIso).getTime() > new Date(c.lastVisitIso).getTime();
      return nudgedSinceVisit ? null : { kind: 'due', weeks, serviceName: c.lastServiceName || 'your last service' };
    }
  }
  return null;
}

export function nudgeText(settings: ReturnType<typeof cleanReconnect>, d: Exclude<NudgeDecision, null>, first: string, link: string | null, signer: string): string {
  const fill = (t: string) => t.replace(/\{first\}/g, first).replace(/\{service\}/g, (d as any).serviceName || '').replace(/\{weeks\}/g, String(d.weeks)).replace(/\{link\}/g, link || '');
  if (d.kind === 'due') {
    if (settings.dueMessage) return fill(settings.dueMessage);
    return `Hi ${first}! It's been ${d.weeks} weeks since your ${d.serviceName} — ready for a refresh?${link ? ` Grab a time here: ${link}` : ''} — ${signer}`;
  }
  if (settings.missMessage) return fill(settings.missMessage);
  return `Hi ${first}, it's been a little while and we'd love to see you again.${link ? ` Whenever you're ready: ${link}` : ''} — ${signer}`;
}

/**
 * One sender's run: the studio (renterId = null) or one renter. Called by the
 * daily reminders cron at the tenant's send hour. Returns what it did.
 */
export async function runReconnect(db: any, opts: {
  tenantId: string; renterId: string | null; staffIds: string[] | null; settings: any;
  bookingUrl: string | null; signer: string; stopUrl: (clientId: string) => string;
  send: (to: { email: string | null; phone: string | null; clientId: string; name: string }, text: string, subject: string, kind: string) => Promise<boolean>;
}): Promise<{ checked: number; sent: number; due: number; miss: number; skippedCap: number }> {
  const s = cleanReconnect(opts.settings);
  const out = { checked: 0, sent: 0, due: 0, miss: 0, skippedCap: 0 };
  if (!s.enabled) return out;
  const now = Date.now();
  const col = (n: string) => db.collection(`tenants/${opts.tenantId}/${n}`);

  // Clients this sender owns.
  const clientSnap = opts.renterId
    ? await col('clients').where('ownerRenterId', '==', opts.renterId).get()
    : await col('clients').get();
  const clients = clientSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c: any) => (opts.renterId ? true : !c.ownerRenterId) && !c.archived && c.status !== 'archived');
  if (!clients.length) return out;
  const clientIds = new Set(clients.map((c: any) => c.id));

  // A year of appointments + everything upcoming, grouped by client.
  const since = new Date(now - 400 * DAY).toISOString();
  const apSnap = await col('appointments').where('startTime', '>=', since).get();
  const byClient = new Map<string, any[]>();
  for (const d of apSnap.docs) {
    const a = d.data() as any;
    if (!a.clientId || !clientIds.has(a.clientId)) continue;
    if (opts.staffIds && !opts.staffIds.includes(String(a.staffId || ''))) continue;
    if (!opts.renterId && a.isRenterBooking) continue;
    (byClient.get(a.clientId) || byClient.set(a.clientId, []).get(a.clientId)!).push(a);
  }

  // Rebook intervals, per service.
  const svcSnap = opts.renterId
    ? await col('renterServices').where('staffId', 'in', (opts.staffIds || ['-']).slice(0, 10)).get()
    : await col('services').get();
  const rebook = new Map<string, number>();
  for (const d of svcSnap.docs) { const x = d.data() as any; const w = Number(x.rebookWeeks) || 0; if (w > 0) rebook.set(d.id, w); }

  // Past nudges, per client.
  const nSnap = await col('reconnectNudges').where('sender', '==', opts.renterId || 'studio').get();
  const lastNudge = new Map<string, string>(); const lastMiss = new Map<string, string>();
  for (const d of nSnap.docs) {
    const x = d.data() as any;
    if (!x.clientId) continue;
    if (!lastNudge.get(x.clientId) || x.sentAt > lastNudge.get(x.clientId)!) lastNudge.set(x.clientId, x.sentAt);
    if (x.kind === 'miss_you' && (!lastMiss.get(x.clientId) || x.sentAt > lastMiss.get(x.clientId)!)) lastMiss.set(x.clientId, x.sentAt);
  }

  const nowIso = new Date(now).toISOString();
  for (const c of clients as any[]) {
    out.checked++;
    const list = byClient.get(c.id) || [];
    const done = list.filter((a: any) => a.status === 'completed' || a.renterOutcome === 'completed').sort((x: any, y: any) => String(y.startTime).localeCompare(String(x.startTime)));
    const upcoming = list.some((a: any) => a.startTime > nowIso && !['cancelled', 'canceled', 'no_show'].includes(String(a.status || '')));
    const last = done[0];
    const hist: ClientHistory = {
      clientId: c.id, first: String(c.name || 'there').trim().split(/\s+/)[0] || 'there',
      lastVisitIso: last?.startTime || null, lastServiceId: last?.serviceId || null, lastServiceName: last?.renterServiceName || last?.serviceName || null,
      hasUpcoming: upcoming, optedOut: c.reconnectOptOut === true, hasContact: !!(c.phone || (c.email && String(c.email).includes('@'))),
      lastNudgeIso: lastNudge.get(c.id) || null, lastMissNudgeIso: lastMiss.get(c.id) || null,
    };
    const d = decideNudge(s, hist, rebook, now);
    if (!d) continue;
    if (out.sent >= s.dailyCap) { out.skippedCap++; continue; }
    const text = nudgeText(s, d, hist.first, opts.bookingUrl, opts.signer);
    const withStop = `${text}${c.email ? `\n\nPrefer not to get these? ${opts.stopUrl(c.id)}` : ''}`;
    const subject = d.kind === 'due' ? `Time for your ${d.serviceName}?` : `We'd love to see you again`;
    const ok = await opts.send({ email: c.email || null, phone: c.phone || null, clientId: c.id, name: c.name || '' }, withStop, subject, d.kind === 'due' ? 'reconnect_due' : 'reconnect_miss');
    if (!ok) continue;
    const ref = col('reconnectNudges').doc();
    await ref.set({ id: ref.id, sender: opts.renterId || 'studio', renterId: opts.renterId || null, clientId: c.id, clientName: c.name || null, kind: d.kind, weeks: d.weeks, serviceName: (d as any).serviceName || null, sentAt: nowIso, converted: false });
    out.sent++; if (d.kind === 'due') out.due++; else out.miss++;
  }
  return out;
}

/** Tally for the settings panels: last 30 days sent, how many rebooked within 14 days. */
export async function reconnectTally(db: any, tenantId: string, sender: string) {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const snap = await db.collection(`tenants/${tenantId}/reconnectNudges`).where('sender', '==', sender).get();
  const rows = snap.docs.map((d: any) => d.data() as any).filter((x: any) => String(x.sentAt || '') >= since);
  const converted = rows.filter((x: any) => x.converted).length;
  return { sent: rows.length, converted, rate: rows.length ? Math.round((converted / rows.length) * 100) : 0,
    due: rows.filter((x: any) => x.kind === 'due').length, miss: rows.filter((x: any) => x.kind === 'miss_you').length };
}

/** Stop-link signature: stateless, per client. */
export async function stopSig(tenantId: string, clientId: string): Promise<string> {
  const { createHmac } = await import('crypto');
  return createHmac('sha256', String(process.env.RECONNECT_SECRET || process.env.CRON_SECRET || 'reconnect')).update(`${tenantId}:${clientId}`).digest('hex').slice(0, 24);
}
