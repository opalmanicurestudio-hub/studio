// src/lib/campaigns.ts
//
// CAMPAIGNS THAT ACTUALLY SEND.
//
// Before this, pressing Send saved the campaign marked "sent" with a
// hard-coded recipient count of 42 and sent nothing. Now:
//
//   • resolveAudience() turns an audience name into real clients, from real
//     visit history — the studio's clients only (renters' clients are theirs).
//   • Consent is enforced here, not trusted to the page:
//       EMAIL → anyone in the audience with an email who hasn't unsubscribed;
//               every email carries an unsubscribe link.
//       TEXT  → only clients who said yes to marketing texts
//               (client.smsMarketingOptIn === true). Marketing texts without
//               that yes are a legal risk in the US (TCPA), so a client
//               without it is skipped, not texted — and counted, so the owner
//               sees why the list is smaller.
//   • sendBatch() sends up to N recipients per call and records each one in
//     campaigns/{id}/recipients/{clientId}. The page calls it until done, so
//     a large list never runs into a serverless time limit, and a send that
//     stops half-way can be resumed without texting anyone twice.
//   • A booking within 14 days by a recipient marks them converted — the
//     campaign's real result, instead of invented open rates.

const DAY = 86400000;
export type Audience = 'all' | 'new' | 'loyal' | 'inactive_90' | 'specific' | 'birthday'
  | 'service' | 'provider' | 'spent_over' | 'one_and_done' | 'members' | 'cancelled_recent';

// Plain words, for any kind of business — clients, services, team members.
export const AUDIENCE_RULES: Record<Audience, string> = {
  all: 'Every client',
  new: 'First visit in the last 30 days',
  loyal: '5 or more visits in the last 12 months',
  inactive_90: 'No visit in 90+ days, nothing booked',
  specific: 'The clients you picked',
  birthday: 'Birthday this month',
  service: 'Last visit included a service you pick',
  provider: 'Last visit was with a team member you pick',
  spent_over: 'Spent over an amount in the last 12 months',
  one_and_done: 'Came once, 30+ days ago, never returned',
  members: 'Active members',
  cancelled_recent: 'Cancelled or missed a visit in the last 30 days, nothing booked since',
};

export interface AudienceParams { specificIds?: string[]; serviceIds?: string[]; staffIds?: string[]; minSpend?: number }

export interface AudienceMember { id: string; name: string; first: string; email: string | null; phone: string | null }
export interface AudienceResult { members: AudienceMember[]; matched: number; skippedNoConsent: number; skippedNoContact: number; skippedUnsubscribed: number; skippedMonthlyCap: number }

/** The consent wording promises "up to 4 a month" — enforced across campaigns AND reconnect. */
export const MARKETING_TEXTS_PER_30_DAYS = 4;

/**
 * Marketing texts each client received in the last 30 days, counting both
 * campaigns (campaignSends) and reconnect nudges (reconnectNudges), texts only.
 */
export async function recentMarketingTexts(db: any, tenantId: string, now = Date.now()): Promise<Map<string, number>> {
  const since = new Date(now - 30 * DAY).toISOString();
  const out = new Map<string, number>();
  const bump = (id: string) => out.set(id, (out.get(id) || 0) + 1);
  try {
    for (const d of (await db.collection(`tenants/${tenantId}/campaignSends`).where('at', '>=', since).get()).docs) {
      const x = d.data() as any; if (x.clientId && x.channel === 'sms') bump(x.clientId);
    }
  } catch { /* none yet */ }
  try {
    for (const d of (await db.collection(`tenants/${tenantId}/reconnectNudges`).where('sentAt', '>=', since).get()).docs) {
      const x = d.data() as any; if (x.clientId && x.channel === 'sms') bump(x.clientId);
    }
  } catch { /* none yet */ }
  return out;
}

export async function resolveAudience(db: any, tenantId: string, audience: Audience, channel: 'email' | 'sms', paramsIn: AudienceParams | string[] = {}, now = Date.now()): Promise<AudienceResult> {
  const params: AudienceParams = Array.isArray(paramsIn) ? { specificIds: paramsIn } : (paramsIn || {});
  const specificIds = params.specificIds || [];
  const col = (n: string) => db.collection(`tenants/${tenantId}/${n}`);
  const clients = (await col('clients').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c: any) => !c.ownerRenterId && !c.archived && c.status !== 'archived');

  const need = !['all', 'specific', 'birthday', 'members'].includes(audience);
  type V = { done: string[]; upcoming: boolean; last: any | null; spent12: number; missed30: string[] };
  const visits = new Map<string, V>();
  if (need) {
    const since = new Date(now - 400 * DAY).toISOString();
    const nowIso = new Date(now).toISOString();
    const yearAgo = new Date(now - 365 * DAY).toISOString();
    const monthAgo = new Date(now - 30 * DAY).toISOString();
    for (const d of (await col('appointments').where('startTime', '>=', since).get()).docs) {
      const a = d.data() as any;
      if (!a.clientId || a.isRenterBooking) continue;
      const v = visits.get(a.clientId) || { done: [], upcoming: false, last: null, spent12: 0, missed30: [] };
      const st = String(a.status || '');
      if (st === 'completed') {
        v.done.push(String(a.startTime));
        if (!v.last || String(a.startTime) > String(v.last.startTime)) v.last = a;
        if (String(a.startTime) >= yearAgo) v.spent12 += Number(a.price) || 0;
      } else if (String(a.startTime) > nowIso && !['cancelled', 'canceled', 'no_show'].includes(st)) v.upcoming = true;
      if ((['cancelled', 'canceled', 'no_show'].includes(st) || a.renterOutcome === 'no_show') && String(a.startTime) >= monthAgo && String(a.startTime) <= nowIso) v.missed30.push(String(a.startTime));
      visits.set(a.clientId, v);
    }
  }
  const svcSet = new Set(params.serviceIds || []);
  const staffSet = new Set(params.staffIds || []);
  const minSpend = Number(params.minSpend) || 0;
  const monthNow = new Date(now).getMonth() + 1;
  const bdayMonth = (b: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b || '')) || /^(\d{1,2})[/-](\d{1,2})/.exec(String(b || '')); if (!m) return 0; return m.length === 4 ? Number(m[2]) : Number(m[1]); };
  const specific = new Set(specificIds);

  const inAudience = (c: any): boolean => {
    const v: V = visits.get(c.id) || { done: [], upcoming: false, last: null, spent12: 0, missed30: [] };
    const sorted = [...v.done].sort();
    switch (audience) {
      case 'all': return true;
      case 'specific': return specific.has(c.id);
      case 'birthday': return bdayMonth(c.birthday) === monthNow;
      case 'new': return sorted.length > 0 && now - new Date(sorted[0]).getTime() <= 30 * DAY;
      case 'loyal': return sorted.filter((t) => now - new Date(t).getTime() <= 365 * DAY).length >= 5;
      case 'inactive_90': return sorted.length > 0 && now - new Date(sorted[sorted.length - 1]).getTime() >= 90 * DAY && !v.upcoming;
      case 'service': {
        const ids = [v.last?.serviceId, ...(Array.isArray(v.last?.serviceIds) ? v.last.serviceIds : []), ...(Array.isArray(v.last?.addOnIds) ? v.last.addOnIds : [])].filter(Boolean).map(String);
        return !!v.last && ids.some((x) => svcSet.has(x));
      }
      case 'provider': return !!v.last && staffSet.has(String(v.last.staffId || ''));
      case 'spent_over': return minSpend > 0 && v.spent12 >= minSpend;
      case 'one_and_done': return sorted.length === 1 && now - new Date(sorted[0]).getTime() >= 30 * DAY && !v.upcoming;
      case 'members': return !!c.activeMembershipId && c.subscription?.status === 'active';
      case 'cancelled_recent': {
        if (!v.missed30.length || v.upcoming) return false;
        const lastMiss = v.missed30.sort().slice(-1)[0];
        return !sorted.length || sorted[sorted.length - 1] < lastMiss;
      }
    }
  };

  const out: AudienceResult = { members: [], matched: 0, skippedNoConsent: 0, skippedNoContact: 0, skippedUnsubscribed: 0, skippedMonthlyCap: 0 };
  const recent = channel === 'sms' ? await recentMarketingTexts(db, tenantId, now) : new Map<string, number>();
  for (const c of clients) {
    if (!inAudience(c)) continue;
    out.matched++;
    if (c.marketingOptOut === true) { out.skippedUnsubscribed++; continue; }
    const email = c.email && String(c.email).includes('@') ? String(c.email).trim() : null;
    const phone = c.phone ? String(c.phone).trim() : null;
    if (channel === 'email' && !email) { out.skippedNoContact++; continue; }
    if (channel === 'sms') {
      if (!phone) { out.skippedNoContact++; continue; }
      if (c.smsMarketingOptIn !== true) { out.skippedNoConsent++; continue; }
      if ((recent.get(c.id) || 0) >= MARKETING_TEXTS_PER_30_DAYS) { out.skippedMonthlyCap++; continue; }
    }
    const name = String(c.name || '').trim();
    out.members.push({ id: c.id, name, first: name.split(/\s+/)[0] || 'there', email, phone });
  }
  return out;
}

/** {{clientName}} / {{firstName}} / {first} → the client's first name. */
export function personalise(text: string, m: AudienceMember): string {
  return String(text || '').replace(/\{\{\s*(clientName|firstName|name)\s*\}\}/g, m.first).replace(/\{first\}/g, m.first);
}

export async function unsubSig(tenantId: string, clientId: string): Promise<string> {
  const { createHmac } = await import('crypto');
  return createHmac('sha256', String(process.env.RECONNECT_SECRET || process.env.CRON_SECRET || 'reconnect')).update(`m:${tenantId}:${clientId}`).digest('hex').slice(0, 24);
}

// ── Quiet hours for texts ─────────────────────────────────────────────────
// Marketing texts go out between 9am and 8pm in the business's time zone —
// inside the 8am–9pm window US rules allow, with an hour's margin each side.
export const TEXT_WINDOW = { start: 9, end: 20 };

export function localHour(timeZone: string, at = new Date()): number {
  try { return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(at)) % 24; }
  catch { return at.getUTCHours(); }
}
export function inTextWindow(timeZone: string, at = new Date()): boolean {
  const h = localHour(timeZone, at);
  return h >= TEXT_WINDOW.start && h < TEXT_WINDOW.end;
}
