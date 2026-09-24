// src/lib/campaign-engine.ts
//
// ONE ENGINE FOR EVERY CAMPAIGN SEND.
//
// The Send button (/api/campaigns/send), the renter portal, the hourly
// scheduler and automations (/api/cron/campaigns) all call these functions,
// so every campaign goes out the same way: same audience rules, same consent
// and monthly-cap checks, same offer, A/B split, image, Book button, quiet
// hours, and the same resume-safe recipient record.
//
// A campaign with ownerRenterId is a RENTER's: their clients only, their
// name on it, their booking link — and its texts are counted against the
// renter's allowance or paid by the renter, per the business's setting.

import { resolveAudience, personalise, unsubSig, inTextWindow, TEXT_WINDOW, type Audience, type AudienceMember } from '@/lib/campaigns';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';

export const BATCH = 60;

/** Texts are billed per 153-character segment (70 if the message has an emoji or other special character). */
export function segmentsFor(text: string): number {
  const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\\[~\]|]*$/.test(text);
  const per = gsm ? (text.length <= 160 ? 160 : 153) : (text.length <= 70 ? 70 : 67);
  return Math.max(1, Math.ceil(text.length / per));
}

export function audienceParams(c: any, owner: { renterId: string; staffIds: string[] } | null = null) {
  return {
    specificIds: Array.isArray(c.targetClientIds) ? c.targetClientIds : [],
    serviceIds: Array.isArray(c.targetServiceIds) ? c.targetServiceIds : [],
    staffIds: Array.isArray(c.targetStaffIds) ? c.targetStaffIds : [],
    minSpend: Number(c.targetMinSpend) || 0,
    daysAfter: Number(c.automation?.daysAfter) || 7,
    owner,
  };
}

export async function loadOffer(db: any, tenantId: string, c: any): Promise<{ code: string; line: string } | null> {
  if (!c.discountId) return null;
  try {
    const dz = ((await db.doc(`tenants/${tenantId}/discounts/${String(c.discountId)}`).get()).data() as any) || null;
    if (!dz || dz.isActive === false || !dz.code) return null;
    const amt = dz.type === 'percentage' ? `${Number(dz.value) || 0}% off` : `$${(Number(dz.value) || 0).toFixed(0)} off`;
    const until = dz.validUntil ? ` — until ${new Date(dz.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
    return { code: String(dz.code), line: `${amt} with code ${dz.code}${until}` };
  } catch { return null; }
}

export function variantOf(c: any, clientId: string): 'A' | 'B' {
  if (!c.subjectB) return 'A';
  let h = 0; for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 'A' : 'B';
}

/** Who the campaign speaks as, where it links, and whose clients it reaches. */
export async function senderFor(db: any, tenantId: string, c: any, fallbackOrigin?: string) {
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const origin = String(t.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : fallbackOrigin || '')).replace(/\/+$/, '');
  const timeZone = String(t.timezone || 'America/New_York');
  if (c?.ownerRenterId) {
    const r = ((await db.doc(`tenants/${tenantId}/renters/${c.ownerRenterId}`).get()).data() as any) || {};
    const st = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', c.ownerRenterId).get();
    const staffIds = st.docs.map((d: any) => d.id);
    const name = String(r.businessName || '').trim() || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Your provider';
    return { name, origin, timeZone, tenant: t, renter: r, owner: { renterId: String(c.ownerRenterId), staffIds },
      bookBase: staffIds[0] ? `${origin}/book/${encodeURIComponent(tenantId)}?provider=${encodeURIComponent(staffIds[0])}` : `${origin}/book/${encodeURIComponent(tenantId)}` };
  }
  return { name: String(t.name || 'the business'), origin, timeZone, tenant: t, renter: null, owner: null, bookBase: `${origin}/book/${encodeURIComponent(tenantId)}` };
}

export async function previewCampaign(db: any, tenantId: string, c: any, fallbackOrigin?: string) {
  const channel: 'email' | 'sms' = c.type === 'sms' ? 'sms' : 'email';
  const who = await senderFor(db, tenantId, c, fallbackOrigin);
  const aud = await resolveAudience(db, tenantId, c.targetAudience as Audience, channel, audienceParams(c, who.owner));
  const offer = await loadOffer(db, tenantId, c);
  const sample = channel === 'sms' ? `${who.name}: ${personalise(c.body, { id: 'x', name: 'Alexandra', first: 'Alexandra', email: null, phone: null })}${offer ? ` ${offer.line}.` : ''}\nReply STOP to opt out.` : '';
  const segments = channel === 'sms' ? segmentsFor(sample) : 0;
  return {
    channel, aud, offer, who, segments,
    summary: { matched: aud.matched, willReceive: aud.members.length, skippedNoConsent: aud.skippedNoConsent, skippedNoContact: aud.skippedNoContact, skippedUnsubscribed: aud.skippedUnsubscribed, skippedMonthlyCap: aud.skippedMonthlyCap },
  };
}

/** Send one message to one member and record it. `key` is the recipient-record id (clientId, or clientId__year for automations). */
async function sendOne(db: any, tenantId: string, campaignId: string, c: any, m: AudienceMember, ctx: { channel: 'email' | 'sms'; offer: any; who: any }, key: string) {
  const cRef = db.doc(`tenants/${tenantId}/campaigns/${campaignId}`);
  const { channel, offer, who } = ctx;
  const text = personalise(c.body, m) + (offer && channel === 'sms' ? ` ${offer.line}.` : '');
  const variant = variantOf(c, m.id);
  let ok = false; let err: string | null = null; let segments = 0;
  const kind = c.ownerRenterId ? 'renter_campaign' : c.automation ? 'campaign_automation' : 'campaign';
  try {
    if (channel === 'sms') {
      const body = `${who.name}: ${text}\nReply STOP to opt out.`;
      segments = segmentsFor(body);
      const r = await sendNotification(db, { tenantId, channel: 'sms', to: m.phone!, text: body, kind, clientId: m.id, clientName: m.name, recipientType: 'client' } as any);
      ok = !!r.ok; if (!ok) err = String((r as any).error || (r as any).status || 'not sent');
    } else {
      const unsub = `${who.origin}/api/campaigns/unsubscribe?t=${encodeURIComponent(tenantId)}&c=${encodeURIComponent(m.id)}&s=${await unsubSig(tenantId, m.id)}`;
      const subject = personalise((variant === 'B' ? c.subjectB : c.subject) || c.name || `News from ${who.name}`, m);
      const sep = who.bookBase.includes('?') ? '&' : '?';
      const bookUrl = `${who.bookBase}${sep}c=${encodeURIComponent(campaignId)}${offer ? `&code=${encodeURIComponent(offer.code)}` : ''}`;
      const esc = (x: string) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch]);
      const imgHtml = c.imageUrl && /^https:\/\//.test(String(c.imageUrl)) ? `<img src="${esc(c.imageUrl)}" alt="" style="display:block;width:100%;max-width:560px;border-radius:12px;margin:0 0 16px" />` : '';
      const r = await sendNotification(db, { tenantId, channel: 'email', to: m.email!, subject,
        html: brandedEmailHtml({ studioName: who.name, title: subject, bodyLines: [...text.split(/\n+/).filter(Boolean), ...(offer ? [offer.line] : [])],
          ...(imgHtml ? { bodyHtml: imgHtml } : {}), ...(offer ? { bigCode: offer.code } : {}),
          cta: { label: 'Book now', url: bookUrl },
          footerNote: `You're receiving this as a client of ${who.name}. Unsubscribe: ${unsub}` } as any),
        kind, clientId: m.id, clientName: m.name, recipientType: 'client' } as any);
      ok = !!r.ok; if (!ok) err = String((r as any).error || (r as any).status || 'not sent');
    }
  } catch (e: any) { err = String(e?.message || e).slice(0, 160); }
  const at = new Date().toISOString();
  await cRef.collection('recipients').doc(key).set({ clientId: m.id, name: m.name, channel, variant: channel === 'email' ? variant : null, status: ok ? 'sent' : 'failed', error: err, at, converted: false, segments });
  if (ok) await db.doc(`tenants/${tenantId}/campaignSends/${campaignId}_${key}`).set({ campaignId, clientId: m.id, channel, variant: channel === 'email' ? variant : null, at, converted: false, segments, renterId: c.ownerRenterId || null });
  return { ok, segments };
}

/**
 * Send the next batch. Resume-safe: recipients already recorded are skipped.
 * Texts outside quiet hours are refused here, whoever calls. `maxSegments`
 * caps how many text segments this batch may use (renter allowance/payment).
 */
export async function sendCampaignBatch(db: any, tenantId: string, campaignId: string, opts: { actorName?: string; fallbackOrigin?: string; batchSize?: number; maxSegments?: number } = {}) {
  const cRef = db.doc(`tenants/${tenantId}/campaigns/${campaignId}`);
  const c = ((await cRef.get()).data() as any) || null;
  if (!c) return { ok: false as const, error: 'Campaign not found — save it first.' };
  const pv = await previewCampaign(db, tenantId, c, opts.fallbackOrigin);
  const { channel, aud, offer, who, summary } = pv;
  if (channel === 'sms' && !inTextWindow(who.timeZone)) {
    return { ok: false as const, error: `Texts only go out between ${TEXT_WINDOW.start}am and ${TEXT_WINDOW.end - 12}pm. Schedule it instead and it goes out when the window opens.`, quietHours: true };
  }
  const doneSnap = await cRef.collection('recipients').get();
  const already = new Set(doneSnap.docs.map((d: any) => d.id));
  const todo = aud.members.filter((m) => !already.has(m.id));
  let batch = todo.slice(0, opts.batchSize || BATCH);
  if (channel === 'sms' && Number.isFinite(opts.maxSegments)) batch = batch.slice(0, Math.max(0, Math.floor((opts.maxSegments as number) / Math.max(1, pv.segments))));
  const nowIso = new Date().toISOString();
  if (!c.sendStartedAt) await cRef.set({ status: 'sending', sendStartedAt: nowIso, sentBy: opts.actorName || 'Scheduler' }, { merge: true });

  let sent = 0, failed = 0, segmentsUsed = 0;
  for (const m of batch) {
    const r = await sendOne(db, tenantId, campaignId, c, m, { channel, offer, who }, m.id);
    if (r.ok) { sent++; segmentsUsed += r.segments; } else failed++;
  }
  const remaining = Math.max(0, todo.length - batch.length);
  const allSnap = await cRef.collection('recipients').get();
  const totals = allSnap.docs.reduce((acc: any, d: any) => { const x = d.data() as any; acc[x.status === 'sent' ? 'sent' : 'failed']++; acc.segments += Number(x.segments) || 0; return acc; }, { sent: 0, failed: 0, segments: 0 });
  await cRef.set({ recipientCount: totals.sent, failedCount: totals.failed, segmentsUsed: totals.segments, ...(remaining === 0 ? { status: 'sent', sentAt: nowIso } : {}) }, { merge: true });
  return { ok: true as const, summary, batch: { sent, failed, segments: segmentsUsed }, totals, remaining, done: remaining === 0, stoppedForAllowance: remaining > 0 && batch.length < Math.min(todo.length, opts.batchSize || BATCH) };
}

/**
 * AUTOMATIONS — campaigns that repeat on their own. Run once a day per
 * business (at 10am local, from the hourly cron). Each client gets each
 * automation at most once per `period`:
 *   birthday             → once a year, during their birthday month
 *   first_visit_followup → once ever, N days after their first visit
 * Consent, the monthly text cap and quiet hours apply exactly as for any
 * campaign.
 */
export async function runAutomation(db: any, tenantId: string, campaignId: string) {
  const cRef = db.doc(`tenants/${tenantId}/campaigns/${campaignId}`);
  const c = ((await cRef.get()).data() as any) || null;
  if (!c || c.status !== 'automation' || c.automation?.active !== true) return { ok: false, skipped: 'inactive' };
  const trigger = c.automation?.trigger;
  const withAud = { ...c, targetAudience: trigger === 'birthday' ? 'birthday' : 'first_visit_followup' };
  const pv = await previewCampaign(db, tenantId, withAud);
  if (pv.channel === 'sms' && !inTextWindow(pv.who.timeZone)) return { ok: false, skipped: 'quiet_hours' };
  const period = trigger === 'birthday' ? String(new Date().getFullYear()) : 'once';
  const done = new Set((await cRef.collection('recipients').get()).docs.map((d: any) => d.id));
  let sent = 0;
  for (const m of pv.aud.members) {
    const key = `${m.id}__${period}`;
    if (done.has(key)) continue;
    const r = await sendOne(db, tenantId, campaignId, withAud, m, { channel: pv.channel, offer: pv.offer, who: pv.who }, key);
    if (r.ok) sent++;
  }
  const nowIso = new Date().toISOString();
  await cRef.set({ automation: { ...c.automation, lastRunAt: nowIso }, recipientCount: (Number(c.recipientCount) || 0) + sent }, { merge: true });
  return { ok: true, sent };
}
