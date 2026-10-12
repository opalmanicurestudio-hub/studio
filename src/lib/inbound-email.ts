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
/** The tenant from reply+{tenantId}@… */
export function tenantFromRecipients(to: any): string | null {
  for (const a of Array.isArray(to) ? to : [to]) { const m = /reply\+([\w-]{1,80})@/i.exec(String(a || '')); if (m) return m[1]; }
  return null;
}
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

export async function receiveEmail(db: any, evt: any, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; skipped?: string; inboxId?: string }> {
  const d = evt?.data || {}; const tenantId = tenantFromRecipients(d.to) || tenantFromRecipients(d.received_for);
  if (!tenantId || !(await db.doc(`tenants/${tenantId}`).get()).exists) return { ok: true, skipped: 'unknown_tenant' };
  const emailId = String(d.email_id || d.id || '');
  if (emailId && (await db.doc(`tenants/${tenantId}/smsInbox/em_${emailId.replace(/[^\w-]/g, '')}`).get()).exists) return { ok: true, skipped: 'duplicate' };
  // The webhook carries only the envelope; the message itself is fetched.
  let full: any = {};
  const key = process.env.RESEND_API_KEY;
  if (emailId && (key || fetchImpl !== fetch)) { try { const r = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key || ''}` } }); if (r.ok) full = await r.json(); } catch { /* keep the envelope */ } }
  const from = parseAddress(full.from || d.from); const subject = String(full.subject || d.subject || '').slice(0, 200);
  const text = String(full.text || '') || strip(full.html || ''); const body = newPart(text).slice(0, 6000);
  const { clientByEmail } = await import('@/lib/conversation'); const who = await clientByEmail(db, tenantId, from.email).catch(() => null);
  const id = emailId ? `em_${emailId.replace(/[^\w-]/g, '')}` : db.collection(`tenants/${tenantId}/smsInbox`).doc().id;
  const nowIso = new Date().toISOString();
  await db.doc(`tenants/${tenantId}/smsInbox/${id}`).set({ id, tenantId, at: d.created_at || nowIso, channel: 'email', from: from.email, fromEmail: from.email, fromName: who?.name || from.name || from.email,
    senderType: who ? 'client' : 'unknown', clientId: who?.id || null, clientName: who?.name || null, subject, body: body || null, bodyFull: text.slice(0, 20000) || null,
    attachments: Array.isArray(d.attachments) ? d.attachments.map((a: any) => ({ id: a.id || null, filename: a.filename || null, type: a.content_type || null })).slice(0, 10) : [], mediaCount: Array.isArray(d.attachments) ? d.attachments.length : 0, providerId: emailId || null });
  try { const { soundsLikeComplaint } = await import('@/lib/complaint-detect'); const h: any = soundsLikeComplaint(`${subject} ${body}`); if (h?.match) await db.doc(`tenants/${tenantId}/smsInbox/${id}`).set({ complaint: { match: true, safety: !!h.safety } }, { merge: true }); } catch { /* optional */ }
  const n = db.collection(`tenants/${tenantId}/notifications`).doc();
  await n.set({ id: n.id, type: 'email_in', read: false, createdAt: nowIso, link: '/inbox', ...(who ? { clientId: who.id } : {}), message: `Email from ${who?.name || from.name || from.email}${subject ? `: “${subject.slice(0, 80)}”` : ''}` });
  return { ok: true, inboxId: id };
}
