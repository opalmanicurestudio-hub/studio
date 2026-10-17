// src/lib/inbound-email.ts — CLIENT EMAIL REPLIES, INTO THE APP.
// Every email we send sets Reply-To: reply+{tenantId}@{INBOUND_EMAIL_DOMAIN} (lib/notify replyToFor). Resend receives
// the reply on that domain and posts `email.received` to /api/webhooks/resend; we fetch the message, link it to the
// client by their email address, keep it in the inbox (smsInbox, channel 'email'), and tell the team.
// Setup (one time): Resend → Domains → add a receiving domain (an MX record) → set INBOUND_EMAIL_DOMAIN in Vercel →
// make sure the webhook includes the email.received event. Until then, replies go to the business's own email.

/** "Ana Ruiz <ana@x.com>" → { name, email } */
export function parseAddress(v: any): { name: string; email: string } {
  const s = String(Array.isArray(v) ? v[0] : v || '').trim(); const m = /^(.*?)<([^>]+)>\s*$/.exec(s);
  const email = (m ? m[2] : s).trim().toLowerCase(); const name = (m ? m[1] : '').replace(/^"|"$/g, '').trim();
  return { name, email };
}
/** A short signature for a client's reply address (so it can't be guessed or forged). */
export function replyTag(tenantId: string, clientId: string): string {
  const { createHmac } = require('crypto') as typeof import('crypto');
  const secret = process.env.LINK_SECRET || process.env.RESEND_WEBHOOK_SECRET || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || 'reply-tag';
  return createHmac('sha256', secret).update(`reply:${tenantId}:${clientId}`).digest('hex').slice(0, 10);
}
/** reply+{tenantId}[.{clientId}.{tag}]@… → who it's for. `clientId` only when the signature is right. */
export function parseReplyAddress(to: any): { tenantId: string; clientId: string | null } | null {
  for (const a of Array.isArray(to) ? to : [to]) {
    const m = /reply\+([\w-]{1,80})(?:\.([\w-]{1,80})\.([a-f0-9]{10}))?@/i.exec(String(a || '')); if (!m) continue;
    const ok = !!(m[2] && m[3] && m[3].toLowerCase() === replyTag(m[1], m[2]));
    return { tenantId: m[1], clientId: ok ? m[2] : null };
  }
  return null;
}
export function tenantFromRecipients(to: any): string | null { return parseReplyAddress(to)?.tenantId || null; }
/** The new part of a reply: everything above "On … wrote:" or the first quoted line. */
export function newPart(text: string): string {
  const lines = String(text || '').replace(/\r/g, '').split('\n'); const out: string[] = [];
  for (const l of lines) {
    if (/^On .{4,200}wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) || /^>/.test(l.trim()) || /^From:\s/i.test(l.trim()) && out.length > 0) break;
    out.push(l);
  }
  return out.join('\n').trim() || String(text || '').trim();
}
const strip = (html: string) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export async function receiveEmail(db: any, evt: any, fetchImpl: typeof fetch = fetch, o: { verified?: boolean | null } = { verified: true }): Promise<{ ok: boolean; skipped?: string; inboxId?: string }> {
  const d = evt?.data || {}; const addr = parseReplyAddress(d.to) || parseReplyAddress(d.received_for); const tenantId = addr?.tenantId || null;
  if (!tenantId || !(await db.doc(`tenants/${tenantId}`).get()).exists) return { ok: true, skipped: 'unknown_tenant' };
  const emailId = String(d.email_id || d.id || '');
  if (emailId && (await db.doc(`tenants/${tenantId}/smsInbox/em_${emailId.replace(/[^\w-]/g, '')}`).get()).exists) return { ok: true, skipped: 'duplicate' };
  const caseId = o.verified === true && addr?.clientId?.startsWith('case-') ? addr.clientId.slice(5) : null;
  // The webhook carries only the envelope; the message itself is fetched.
  let full: any = {};
  const key = process.env.RESEND_API_KEY;
  if (emailId && (key || fetchImpl !== fetch)) { try { const r = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key || ''}` } }); if (r.ok) full = await r.json(); } catch { /* keep the envelope */ } }
  const from = parseAddress(full.from || d.from); const subject = String(full.subject || d.subject || '').slice(0, 200);
  const text = String(full.text || '') || strip(full.html || ''); const body = newPart(text).slice(0, 6000);
  if (caseId) { const r = await intoCase(db, tenantId, caseId, { emailId, from, subject, body, at: d.created_at }); if (r) return r; }
  // Linked to a client only when it answers our email to them (a signed reply address) and the webhook itself was
  // verified. A message that merely claims to be from a client's address waits for the desk to link it.
  const { clientByEmail } = await import('@/lib/conversation');
  let who: { id: string; name: string } | null = null; let unverifiedSender = false; let suspected: string | null = null;
  if (o.verified === true && addr?.clientId) { const c: any = (await db.doc(`tenants/${tenantId}/clients/${addr.clientId}`).get()).data(); if (c) who = { id: addr.clientId, name: String(c.name || '') }; }
  if (!who) { const byFrom = await clientByEmail(db, tenantId, from.email).catch(() => null); if (byFrom) { unverifiedSender = true; suspected = byFrom.id; } }
  const id = emailId ? `em_${emailId.replace(/[^\w-]/g, '')}` : db.collection(`tenants/${tenantId}/smsInbox`).doc().id;
  const nowIso = new Date().toISOString();
  await db.doc(`tenants/${tenantId}/smsInbox/${id}`).set({ id, tenantId, at: d.created_at || nowIso, channel: 'email', from: from.email, fromEmail: from.email, fromName: who?.name || from.name || from.email,
    senderType: who ? 'client' : 'unknown', clientId: who?.id || null, clientName: who?.name || null, ...(unverifiedSender ? { unverifiedSender: true, suspectedClientId: suspected } : {}), ...(o.verified !== true ? { webhookUnverified: true } : {}), subject, body: body || null, bodyFull: text.slice(0, 20000) || null,
    attachments: Array.isArray(d.attachments) ? d.attachments.map((a: any) => ({ id: a.id || null, filename: a.filename || null, type: a.content_type || null })).slice(0, 10) : [], mediaCount: Array.isArray(d.attachments) ? d.attachments.length : 0, providerId: emailId || null });
  try { const { soundsLikeComplaint } = await import('@/lib/complaint-detect'); const h: any = soundsLikeComplaint(`${subject} ${body}`); if (h?.match) await db.doc(`tenants/${tenantId}/smsInbox/${id}`).set({ complaint: { match: true, safety: !!h.safety } }, { merge: true }); } catch { /* optional */ }
  const n = db.collection(`tenants/${tenantId}/notifications`).doc();
  await n.set({ id: n.id, type: 'email_in', read: false, createdAt: nowIso, link: '/inbox', ...(who ? { clientId: who.id } : {}), message: `Email from ${who?.name || from.name || from.email}${subject ? `: “${subject.slice(0, 80)}”` : ''}` });
  return { ok: true, inboxId: id };
}

/** A reply to one of our emails about a shop support case: it joins that case as the customer's next message and
 *  reopens it, so it is answered where the rest of the conversation is. Returns null when the case is gone, and the
 *  email falls back to the inbox. */
async function intoCase(db: any, tenantId: string, caseId: string, m: { emailId: string; from: { name: string; email: string }; subject: string; body: string; at?: string }): Promise<{ ok: boolean; skipped?: string; inboxId?: string } | null> {
  const ref = db.doc(`tenants/${tenantId}/retailSupport/${caseId}`);
  const snap = await ref.get(); if (!snap.exists) return null;
  const t: any = snap.data() || {};
  const key = m.emailId ? `em_${m.emailId.replace(/[^\w-]/g, '')}` : '';
  if (key && Array.isArray(t.followUps) && t.followUps.some((f: any) => f.emailKey === key)) return { ok: true, skipped: 'duplicate' };
  const { FieldValue } = require('firebase-admin/firestore');
  const at = m.at || new Date().toISOString();
  await ref.set({
    followUps: FieldValue.arrayUnion({ at, message: m.body || m.subject || '(empty email)', photoUrls: [], kind: 'email', emailKey: key || null, fromEmail: m.from.email }),
    customerMessagesSinceStaffReply: FieldValue.increment(1), lastCustomerAt: at, status: 'open',
  }, { merge: true });
  if (t.orderId) {
    const ev = db.collection(`tenants/${tenantId}/retailOrders/${t.orderId}/events`).doc();
    await ev.set({ id: ev.id, type: 'note', at, actorId: 'customer', actorName: t.customerName || m.from.email, meta: { text: `Customer replied by email: ${String(m.body || '').slice(0, 120)}` } });
  }
  const n = db.collection(`tenants/${tenantId}/notifications`).doc();
  await n.set({ id: n.id, type: 'email_in', read: false, createdAt: new Date().toISOString(), link: `/retail-orders/problems${t.orderId ? `?order=${t.orderId}` : ''}`, message: `${t.customerName || m.from.email} replied about order #${String(t.orderNumber ?? '').padStart(4, '0')}` });
  return { ok: true, inboxId: `case:${caseId}` };
}
