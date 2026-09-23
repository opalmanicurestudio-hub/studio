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
export type Audience = 'all' | 'new' | 'loyal' | 'inactive_90' | 'specific' | 'birthday';

export const AUDIENCE_RULES: Record<Audience, string> = {
  all: 'Every client of the studio',
  new: 'First visit in the last 30 days',
  loyal: '5 or more visits in the last 12 months',
  inactive_90: 'No visit in 90+ days, nothing booked',
  specific: 'The clients you picked',
  birthday: 'Birthday this month',
};

export interface AudienceMember { id: string; name: string; first: string; email: string | null; phone: string | null }
export interface AudienceResult { members: AudienceMember[]; matched: number; skippedNoConsent: number; skippedNoContact: number; skippedUnsubscribed: number }

export async function resolveAudience(db: any, tenantId: string, audience: Audience, channel: 'email' | 'sms', specificIds: string[] = [], now = Date.now()): Promise<AudienceResult> {
  const col = (n: string) => db.collection(`tenants/${tenantId}/${n}`);
  const clients = (await col('clients').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c: any) => !c.ownerRenterId && !c.archived && c.status !== 'archived');

  const need = audience === 'new' || audience === 'loyal' || audience === 'inactive_90';
  const visits = new Map<string, { done: string[]; upcoming: boolean }>();
  if (need) {
    const since = new Date(now - 400 * DAY).toISOString();
    const nowIso = new Date(now).toISOString();
    for (const d of (await col('appointments').where('startTime', '>=', since).get()).docs) {
      const a = d.data() as any;
      if (!a.clientId || a.isRenterBooking) continue;
      const v = visits.get(a.clientId) || { done: [], upcoming: false };
      if (a.status === 'completed') v.done.push(String(a.startTime));
      else if (String(a.startTime) > nowIso && !['cancelled', 'canceled', 'no_show'].includes(String(a.status || ''))) v.upcoming = true;
      visits.set(a.clientId, v);
    }
  }
  const monthNow = new Date(now).getMonth() + 1;
  const bdayMonth = (b: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b || '')) || /^(\d{1,2})[/-](\d{1,2})/.exec(String(b || '')); if (!m) return 0; return m.length === 4 ? Number(m[2]) : Number(m[1]); };
  const specific = new Set(specificIds);

  const inAudience = (c: any): boolean => {
    const v = visits.get(c.id) || { done: [], upcoming: false };
    const sorted = [...v.done].sort();
    switch (audience) {
      case 'all': return true;
      case 'specific': return specific.has(c.id);
      case 'birthday': return bdayMonth(c.birthday) === monthNow;
      case 'new': return sorted.length > 0 && now - new Date(sorted[0]).getTime() <= 30 * DAY;
      case 'loyal': return sorted.filter((t) => now - new Date(t).getTime() <= 365 * DAY).length >= 5;
      case 'inactive_90': return sorted.length > 0 && now - new Date(sorted[sorted.length - 1]).getTime() >= 90 * DAY && !v.upcoming;
    }
  };

  const out: AudienceResult = { members: [], matched: 0, skippedNoConsent: 0, skippedNoContact: 0, skippedUnsubscribed: 0 };
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
