// src/lib/client-messages.ts — "MESSAGE US" FROM THE CLIENT'S VISIT LINK (and, later, the app).
//
// A client writes from their visit link: it lands in the Inbox and their conversation record (smsInbox, channel 'app').
// A team member replies from the Inbox: the reply shows on the client's page (messageLog, channel 'app') and, if they
// have notifications on, on their phone. If they haven't seen it within 10 minutes, it's sent by text (or email when
// there's no number), so no reply is ever missed. Everything stays on the record.
const MIN = 60000;
export const FALLBACK_MIN = 10;
const iso = (n: number) => new Date(n).toISOString();
const rows = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const first = (n: any) => String(n || '').split(' ')[0] || 'there';

/** What the client sees on their page: the messages between them and the business (texts, emails and app messages). */
export async function threadForClient(db: any, t: string, clientId: string, now = Date.now()) {
  const T = `tenants/${t}`;
  const out = rows(await db.collection(`${T}/messageLog`).where('clientId', '==', clientId).limit(300).get())
    .filter((m: any) => m.channel === 'app' || m.kind === 'staff_message' || m.kind === 'text_assist')
    .map((m: any) => ({ id: m.id, at: m.sentAt, dir: 'out', who: m.sentBy?.name ? first(m.sentBy.name) : 'Us', text: m.body || m.preview || '', channel: m.channel }));
  const inn = rows(await db.collection(`${T}/smsInbox`).where('clientId', '==', clientId).limit(300).get())
    .map((m: any) => ({ id: m.id, at: m.at, dir: 'in', who: 'You', text: m.body || '', channel: m.channel || 'sms' }));
  // Seen: the client has now read our app replies (so no text is needed).
  const unseen = rows(await db.collection(`${T}/messageLog`).where('clientId', '==', clientId).limit(300).get()).filter((m: any) => m.channel === 'app' && !m.seenAt);
  for (const m of unseen) await db.doc(`${T}/messageLog/${m.id}`).set({ seenAt: iso(now) }, { merge: true });
  return [...out, ...inn].filter((x) => x.at && x.text).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-100);
}

/** The client writes to the business from their visit link. */
export async function clientWrites(db: any, t: string, a: any, text: string, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
  const T = `tenants/${t}`; const body = String(text || '').trim().slice(0, 1600);
  if (!body) return { ok: false, error: 'Please write a message first.' };
  if (!a.clientId) return { ok: false, error: 'We couldn’t find your details. Please reply to one of our messages instead.' };
  const today = rows(await db.collection(`${T}/smsInbox`).where('clientId', '==', String(a.clientId)).limit(300).get()).filter((m: any) => m.channel === 'app' && Date.parse(m.at) > now - 864e5);
  if (today.length >= 20) return { ok: false, error: 'You’ve sent a lot of messages today. We’ll reply as soon as we can.' };
  const ref = db.collection(`${T}/smsInbox`).doc();
  await ref.set({ id: ref.id, tenantId: t, at: iso(now), channel: 'app', via: 'visit_link', from: a.clientPhone || a.clientEmail || null, fromName: a.clientName || 'Client', senderType: 'client',
    clientId: String(a.clientId), clientName: a.clientName || null, appointmentId: a.id || null, body, mediaCount: 0 });
  try { const { soundsLikeComplaint } = await import('@/lib/complaint-detect'); const h: any = soundsLikeComplaint(body); if (h?.match) await ref.set({ complaint: { match: true, safety: !!h.safety } }, { merge: true }); } catch { /* optional */ }
  const n = db.collection(`${T}/notifications`).doc();
  await n.set({ id: n.id, type: 'client_message', read: false, createdAt: iso(now), link: '/inbox', clientId: String(a.clientId), message: `Message from ${a.clientName || 'a client'}: “${body.slice(0, 120)}”` });
  try { const { pushNow } = await import('@/lib/push'); await pushNow(db, t); } catch { /* the 5-minute job sends it */ }
  return { ok: true };
}

/** A team member replies to a message that came from the app: it shows on the client's page (and phone). */
export async function replyInApp(db: any, t: string, m: any, text: string, sentBy: { id: string; name: string | null }, now = Date.now()) {
  const T = `tenants/${t}`;
  let link: string | null = null;
  try {
    const ap: any = m.appointmentId ? (await db.doc(`${T}/appointments/${m.appointmentId}`).get()).data() : null;
    if (ap?.checkInToken) { const { internalOrigin } = await import('@/lib/message-policy'); const tenant: any = (await db.doc(T).get()).data() || {};
      const base = internalOrigin(tenant, null) || process.env.NEXT_PUBLIC_APP_URL || ''; if (base) link = `${base}/check-in/${ap.checkInToken}?do=message`; }
  } catch { /* no link */ }
  const ref = db.collection(`${T}/messageLog`).doc();
  await ref.set({ id: ref.id, channel: 'app', kind: 'staff_message', to: 'app', subject: null, preview: text.slice(0, 140), body: text, sentBy, status: 'sent',
    clientId: m.clientId || null, clientName: m.clientName || null, recipientType: 'client', recipientId: m.clientId || null, recipientName: m.clientName || null,
    appointmentId: m.appointmentId || null, link, sentAt: iso(now), seenAt: null, fallbackDueAt: iso(now + FALLBACK_MIN * MIN), fallbackSentAt: null });
  try { const { pushToClient } = await import('@/lib/client-push'); const r = await pushToClient(db, t, String(m.clientId || ''), { title: 'New message', body: text.slice(0, 160), link: link || undefined });
    if (r.sent) await ref.set({ pushedAt: iso(now) }, { merge: true }); } catch { /* text backup covers it */ }
  return { ok: true, id: ref.id };
}

/** Every few minutes: app replies the client hasn't seen in 10 minutes go by text (or email), once. */
export async function appReplyFallback(db: any, t: string, now = Date.now()) {
  const T = `tenants/${t}`; let sent = 0;
  const due = rows(await db.collection(`${T}/messageLog`).where('channel', '==', 'app').limit(200).get())
    .filter((m: any) => !m.seenAt && !m.fallbackSentAt && Date.parse(m.fallbackDueAt || '') <= now && Date.parse(m.sentAt || '') > now - 3 * 864e5);
  for (const m of due) {
    await db.doc(`${T}/messageLog/${m.id}`).set({ fallbackSentAt: iso(now) }, { merge: true });   // claimed first: never twice
    const c: any = m.clientId ? (await db.doc(`${T}/clients/${m.clientId}`).get()).data() || {} : {};
    const tenant: any = (await db.doc(T).get()).data() || {};
    const line = `Hi ${first(c.name || m.clientName)}, we’ve replied to your message: “${String(m.body || '').slice(0, 220)}”${m.link ? ` You can reply here: ${m.link}` : ''}`;
    const { sendNotification } = await import('@/lib/notify'); let ok = false;
    const base = { tenantId: t, kind: 'app_reply_backup', clientId: m.clientId || null, clientName: m.clientName || null, recipientType: 'client', recipientId: m.clientId || null, recipientName: m.clientName || null, sentBy: m.sentBy || null };
    if (c.phone && c.smsOptOut !== true && c.smsConsent !== false) ok = !!(await sendNotification(db, { ...base, channel: 'sms', to: String(c.phone), text: line } as any).catch(() => null))?.ok;
    if (!ok && String(c.email || '').includes('@')) ok = !!(await sendNotification(db, { ...base, channel: 'email', to: String(c.email), subject: `A reply from ${tenant.name || 'us'}`, text: line } as any).catch(() => null))?.ok;
    if (ok) sent++;
  }
  return { sent };
}
