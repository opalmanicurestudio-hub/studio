// src/lib/campaign-engine.ts
//
// ONE ENGINE FOR EVERY CAMPAIGN SEND.
//
// The Send button (/api/campaigns/send) and the hourly scheduler
// (/api/cron/campaigns) both call these functions, so a scheduled campaign
// and a sent-now campaign go out identically: same audience rules, same
// consent and monthly-cap checks, same offer, A/B split, image, Book button,
// and the same resume-safe recipient record.

import { resolveAudience, personalise, unsubSig, inTextWindow, TEXT_WINDOW, type Audience } from '@/lib/campaigns';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';

export const BATCH = 60;

export function audienceParams(c: any) {
  return {
    specificIds: Array.isArray(c.targetClientIds) ? c.targetClientIds : [],
    serviceIds: Array.isArray(c.targetServiceIds) ? c.targetServiceIds : [],
    staffIds: Array.isArray(c.targetStaffIds) ? c.targetStaffIds : [],
    minSpend: Number(c.targetMinSpend) || 0,
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

export async function tenantBasics(db: any, tenantId: string, fallbackOrigin?: string) {
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  return {
    studio: String(t.name || 'the business'),
    timeZone: String(t.timezone || 'America/New_York'),
    origin: String(t.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : fallbackOrigin || '')).replace(/\/+$/, ''),
  };
}

export async function previewCampaign(db: any, tenantId: string, c: any) {
  const channel: 'email' | 'sms' = c.type === 'sms' ? 'sms' : 'email';
  const aud = await resolveAudience(db, tenantId, c.targetAudience as Audience, channel, audienceParams(c));
  const offer = await loadOffer(db, tenantId, c);
  const smsChars = channel === 'sms' ? (`${c.body || ''}${offer ? ` ${offer.line}` : ''}`.length + 40) : 0;
  return {
    channel, aud, offer,
    summary: { matched: aud.matched, willReceive: aud.members.length, skippedNoConsent: aud.skippedNoConsent, skippedNoContact: aud.skippedNoContact, skippedUnsubscribed: aud.skippedUnsubscribed, skippedMonthlyCap: aud.skippedMonthlyCap },
    segments: channel === 'sms' ? Math.max(1, Math.ceil(smsChars / 153)) : 0,
  };
}

/**
 * Send the next batch. Resume-safe: recipients already recorded are skipped.
 * Texts outside quiet hours are refused here, whoever calls — the scheduler
 * simply tries again next hour.
 */
export async function sendCampaignBatch(db: any, tenantId: string, campaignId: string, opts: { actorName?: string; fallbackOrigin?: string; batchSize?: number } = {}) {
  const cRef = db.doc(`tenants/${tenantId}/campaigns/${campaignId}`);
  const c = ((await cRef.get()).data() as any) || null;
  if (!c) return { ok: false as const, error: 'Campaign not found — save it first.' };
  const { studio, origin, timeZone } = await tenantBasics(db, tenantId, opts.fallbackOrigin);
  const { channel, aud, offer, summary } = await previewCampaign(db, tenantId, c);
  if (channel === 'sms' && !inTextWindow(timeZone)) {
    return { ok: false as const, error: `Texts only go out between ${TEXT_WINDOW.start}am and ${TEXT_WINDOW.end - 12}pm your time. Schedule it instead and it will go out when the window opens.`, quietHours: true };
  }

  const doneSnap = await cRef.collection('recipients').get();
  const already = new Set(doneSnap.docs.map((d: any) => d.id));
  const todo = aud.members.filter((m) => !already.has(m.id));
  const batch = todo.slice(0, opts.batchSize || BATCH);
  const nowIso = new Date().toISOString();
  if (!c.sendStartedAt) await cRef.set({ status: 'sending', sendStartedAt: nowIso, sentBy: opts.actorName || 'Scheduler' }, { merge: true });

  let sent = 0, failed = 0;
  for (const m of batch) {
    const text = personalise(c.body, m) + (offer && channel === 'sms' ? ` ${offer.line}.` : '');
    const variant = variantOf(c, m.id);
    let ok = false; let err: string | null = null;
    try {
      if (channel === 'sms') {
        const r = await sendNotification(db, { tenantId, channel: 'sms', to: m.phone!, text: `${studio}: ${text}\nReply STOP to opt out.`, kind: 'campaign', clientId: m.id, clientName: m.name, recipientType: 'client' } as any);
        ok = !!r.ok; if (!ok) err = String((r as any).error || (r as any).status || 'not sent');
      } else {
        const unsub = `${origin}/api/campaigns/unsubscribe?t=${encodeURIComponent(tenantId)}&c=${encodeURIComponent(m.id)}&s=${await unsubSig(tenantId, m.id)}`;
        const subject = personalise((variant === 'B' ? c.subjectB : c.subject) || c.name || `News from ${studio}`, m);
        const bookUrl = `${origin}/book/${encodeURIComponent(tenantId)}?c=${encodeURIComponent(campaignId)}${offer ? `&code=${encodeURIComponent(offer.code)}` : ''}`;
        const esc = (x: string) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch]);
        const imgHtml = c.imageUrl && /^https:\/\//.test(String(c.imageUrl)) ? `<img src="${esc(c.imageUrl)}" alt="" style="display:block;width:100%;max-width:560px;border-radius:12px;margin:0 0 16px" />` : '';
        const r = await sendNotification(db, { tenantId, channel: 'email', to: m.email!, subject,
          html: brandedEmailHtml({ studioName: studio, title: subject, bodyLines: [...text.split(/\n+/).filter(Boolean), ...(offer ? [offer.line] : [])],
            ...(imgHtml ? { bodyHtml: imgHtml } : {}), ...(offer ? { bigCode: offer.code } : {}),
            cta: { label: 'Book now', url: bookUrl },
            footerNote: `You're receiving this as a client of ${studio}. Unsubscribe: ${unsub}` } as any),
          kind: 'campaign', clientId: m.id, clientName: m.name, recipientType: 'client' } as any);
        ok = !!r.ok; if (!ok) err = String((r as any).error || (r as any).status || 'not sent');
      }
    } catch (e: any) { err = String(e?.message || e).slice(0, 160); }
    await cRef.collection('recipients').doc(m.id).set({ clientId: m.id, name: m.name, channel, variant: channel === 'email' ? variant : null, status: ok ? 'sent' : 'failed', error: err, at: new Date().toISOString(), converted: false });
    if (ok) await db.doc(`tenants/${tenantId}/campaignSends/${campaignId}_${m.id}`).set({ campaignId, clientId: m.id, channel, variant: channel === 'email' ? variant : null, at: new Date().toISOString(), converted: false });
    if (ok) sent++; else failed++;
  }

  const remaining = Math.max(0, todo.length - batch.length);
  const allSnap = await cRef.collection('recipients').get();
  const totals = allSnap.docs.reduce((acc: any, d: any) => { const x = d.data() as any; acc[x.status === 'sent' ? 'sent' : 'failed']++; return acc; }, { sent: 0, failed: 0 });
  await cRef.set({ recipientCount: totals.sent, failedCount: totals.failed, ...(remaining === 0 ? { status: 'sent', sentAt: nowIso } : {}) }, { merge: true });
  return { ok: true as const, summary, batch: { sent, failed }, totals, remaining, done: remaining === 0 };
}
