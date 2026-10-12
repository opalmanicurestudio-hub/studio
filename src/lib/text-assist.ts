// src/lib/text-assist.ts — ANSWERING CLIENT TEXTS IN SECONDS, WITH THE RIGHT LINK.
//
// A known client texts the business number about their appointment ("I need to cancel tomorrow", "running late",
// "C"). We reply straight away, in the business's voice, with their visit link opened to that action. Nothing is
// cancelled or moved from a text alone: any fee is shown on the page and accepted there. "C" / "confirm" confirms.
// Anything unclear, upset or unsafe gets no automatic reply; it waits in the Inbox for a person.
// An unknown number is asked, once a day, for their name, so the desk can link it.
// The personal first line comes from the language model when it's connected; otherwise a warm fixed line is used.
// Booking policies → "Answer client texts automatically" (on unless switched off).
const MIN = 60000, H = 3600e3;
const iso = (n: number) => new Date(n).toISOString();
const rows = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const first = (n: any) => String(n || '').split(' ')[0] || 'there';
const LIVE = ['confirmed', 'pending_payment', 'deposit_pending', 'requested', 'waiting'];

export type Intent = 'cancel' | 'reschedule' | 'late' | 'confirm' | 'question' | 'other';
/** A first read from the words alone. `sure` = a one-word keyword, no interpretation needed. */
export function intentByWords(body: string): { intent: Intent; sure: boolean } {
  const s = String(body || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(c|confirm|confirmed|yes|y|yes please|confirming)$/.test(s)) return { intent: 'confirm', sure: true };
  if (/^(x|cancel)$/.test(s)) return { intent: 'cancel', sure: true };
  if (/\bcancel/.test(s)) return { intent: 'cancel', sure: false };
  if (/\b(reschedul|re-schedul|move (my|the|it)|change (my|the) (time|appointment|appt|day)|different (time|day)|another (time|day)|push (it|my)|can i come (in )?(at|on)|switch (my|the) (time|day))/.test(s)) return { intent: 'reschedule', sure: false };
  if (/\b(running late|run(ning)? behind|i'?ll be late|be a (few|little) (min|minutes) late|stuck in traffic|be there in \d+|late\b)/.test(s)) return { intent: 'late', sure: false };
  if (/\?/.test(s)) return { intent: 'question', sure: false };
  return { intent: 'other', sure: false };
}

type Read = { intent: Intent; empathy: string | null; upset: boolean };
/** The model's read: what they want, whether they're upset, and one warm, professional opening line. */
async function readWithModel(t: string, body: string, studio: string, ask?: (o: any) => Promise<any>): Promise<Read | null> {
  try {
    const askFn = ask || (async (o: any) => { const { askAI, aiConfigured } = await import('@/lib/ai'); return aiConfigured() ? askAI(o) : { ok: false }; });
    const r: any = await askFn({ tier: 'fast', maxTokens: 200, purpose: 'text_assist', tenantId: t,
      system: `You help a beauty business answer a client's text message. Reply with JSON only: {"intent":"cancel|reschedule|late|confirm|question|other","upset":true|false,"empathy":"..."}. "empathy" is ONE short, warm, professional sentence responding to what they said (for example "We're sorry to hear that, and we hope she feels better soon." or "Thank you for letting us know."). Use contractions. No promises, no fees, no times, no names, no emoji. If they are angry, complaining or the message is about safety, set upset true.`,
      prompt: `Business: ${studio}\nClient's text: """${String(body).slice(0, 600)}"""` });
    if (!r?.ok) return null;
    const { parseJson } = await import('@/lib/ai'); const j: any = parseJson(String(r.text || ''));
    if (!j || !['cancel', 'reschedule', 'late', 'confirm', 'question', 'other'].includes(j.intent)) return null;
    const empathy = typeof j.empathy === 'string' && j.empathy.length <= 160 && !/[\u{1F300}-\u{1FAFF}]/u.test(j.empathy) ? j.empathy.trim() : null;
    return { intent: j.intent, empathy, upset: j.upset === true };
  } catch { return null; }
}

export type AssistDeps = { ask?: (o: any) => Promise<any>; send?: (msg: any) => Promise<any> };

/** Answer a known client's text, when we safely can. */
export async function textAssist(db: any, t: string, m: { clientId: string; clientName?: string | null; from: string; body: string; inboxId: string; complaint?: boolean }, now = Date.now(), d: AssistDeps = {}) {
  const T = `tenants/${t}`; const tenant: any = (await db.doc(T).get()).data() || {};
  if (tenant.bookingPolicies?.textAssist === false) return { replied: false, why: 'off' };
  if (m.complaint) return { replied: false, why: 'possible complaint: a person answers' };
  const c: any = (await db.doc(`${T}/clients/${m.clientId}`).get()).data() || {};
  if (c.status === 'banned' || c.status === 'blocked') return { replied: false, why: 'not to be booked: a manager answers' };
  if (Date.parse(c.textAssistAt || '') > now - 30 * MIN) return { replied: false, why: 'answered recently' };
  const words = intentByWords(m.body);
  const studio = tenant.name || 'our studio';
  const read: Read = words.sure ? { intent: words.intent, empathy: null, upset: false } : (await readWithModel(t, m.body, studio, d.ask)) || { intent: words.intent, empathy: null, upset: false };
  if (read.upset) return { replied: false, why: 'sounds upset: a person answers' };
  if (!['cancel', 'reschedule', 'late', 'confirm'].includes(read.intent)) return { replied: false, why: 'a question or something else: a person answers' };

  // Their next appointment.
  const appts = rows(await db.collection(`${T}/appointments`).where('clientId', '==', m.clientId).limit(100).get())
    .filter((a: any) => LIVE.includes(String(a.status || '')) && Date.parse(a.startTime) > now - 2 * H).sort((a: any, b: any) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const a = appts[0]; if (!a) return { replied: false, why: 'no upcoming appointment: a person answers' };
  const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const when = new Date(a.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const svc = a.serviceName || 'appointment';
  const { internalOrigin } = await import('@/lib/message-policy'); const base = internalOrigin(tenant, null) || process.env.NEXT_PUBLIC_APP_URL || '';
  const link = (doIt: string) => (a.checkInToken && base ? `${base}/check-in/${a.checkInToken}?do=${doIt}` : null);
  const open = read.empathy || (read.intent === 'confirm' ? 'Thank you' : 'Thank you for letting us know.');
  let text = ''; let did: string = read.intent;

  if (read.intent === 'confirm') {
    if (!a.clientConfirmedAt) await db.doc(`${T}/appointments/${a.id}`).set({ clientConfirmedAt: iso(now), clientConfirmedVia: 'text' }, { merge: true });
    text = `Hi ${first(c.name || m.clientName)}, thank you. You’re confirmed for your ${svc} on ${when}. We look forward to seeing you.`;
  } else if (read.intent === 'late') {
    const sameDay = new Date(a.startTime).toLocaleDateString('en-US', { timeZone: tz }) === new Date(now).toLocaleDateString('en-US', { timeZone: tz });
    if (!sameDay || !link('late')) return { replied: false, why: 'late, but not for today: a person answers' };
    text = `Hi ${first(c.name || m.clientName)}, ${lower(open)} Please tell us roughly how late you’ll be here, and we’ll let you know your options: ${link('late')}`;
  } else {
    const l = link(read.intent); if (!l) return { replied: false, why: 'no visit link: a person answers' };
    const { resolvePolicy } = await import('@/lib/booking-policies');
    const windowH = Math.max(0, Number(resolvePolicy(tenant).cancel.windowHours.value) || 24);
    const inside = Date.parse(a.startTime) - now < windowH * H;
    let feeLine = '';
    if (read.intent === 'cancel') {
      if (!inside) feeLine = `As it’s more than ${windowH} hours away, there’s no fee.`;
      else {
        let courtesy = false;
        try { const { graceRule, graceRemaining } = await import('@/lib/grace'); const r = graceRule(tenant, 'late_cancellation');
          if (r.enabled && r.selfServe) { const uses = rows(await db.collection(`${T}/graceUses`).where('clientId', '==', m.clientId).get()); courtesy = graceRemaining(tenant, 'late_cancellation', uses as any, { clientId: m.clientId, serviceId: a.serviceId || null, staffId: a.staffId || null }).remaining > 0; } } catch { /* no courtesy */ }
        feeLine = courtesy ? 'You have a courtesy cancellation available, so there won’t be a fee.' : `As it’s within ${windowH} hours, our cancellation fee applies, and the link shows the amount before you confirm.`;
      }
      text = `Hi ${first(c.name || m.clientName)}, ${lower(open)} You can cancel your ${svc} on ${when} here: ${l} ${feeLine} If you’d rather move it, the same link lets you choose a new time.`;
    } else {
      text = `Hi ${first(c.name || m.clientName)}, ${lower(open)} You can choose a new time for your ${svc} on ${when} here: ${l} The link shows your options, including any fee, before you confirm.`;
    }
  }
  const send = d.send || (async (msg: any) => { const { sendNotification } = await import('@/lib/notify'); return sendNotification(db, msg); });
  const r: any = await send({ tenantId: t, channel: 'sms', to: m.from, text: text.replace(/\s+/g, ' ').trim(), kind: 'text_assist', clientId: m.clientId, clientName: c.name || m.clientName || null,
    recipientType: 'client', recipientId: m.clientId, recipientName: c.name || null, appointmentId: a.id, sentBy: { id: 'auto', name: 'Automatic reply' } });
  if (!r?.ok && r?.status !== 'sent') return { replied: false, why: `the reply didn’t send (${r?.error || r?.status || 'unknown'})` };
  await db.doc(`${T}/clients/${m.clientId}`).set({ textAssistAt: iso(now) }, { merge: true });
  await db.doc(`${T}/smsInbox/${m.inboxId}`).set({ autoReply: { intent: did, at: iso(now), appointmentId: a.id, text }, readAt: iso(now), readBy: { id: 'auto', name: 'Automatic reply' } }, { merge: true });
  return { replied: true, intent: did, text };
}
function lower(s: string) { const x = String(s || '').trim(); return x ? x.charAt(0).toLowerCase() + x.slice(1) : x; }

/** An unknown number: ask, once a day, who they are, so the desk can link them. */
export async function askWhoItIs(db: any, t: string, from: string, now = Date.now(), d: AssistDeps = {}) {
  const T = `tenants/${t}`; const tenant: any = (await db.doc(T).get()).data() || {};
  if (tenant.bookingPolicies?.textAssist === false) return { replied: false };
  const key = String(from || '').replace(/\D/g, '').slice(-10); if (key.length !== 10) return { replied: false };
  const ref = db.doc(`${T}/textAssistAsked/${key}`); const prev: any = (await ref.get()).data();
  if (prev && Date.parse(prev.at) > now - 24 * H) return { replied: false };
  await ref.set({ at: iso(now) });
  const send = d.send || (async (msg: any) => { const { sendNotification } = await import('@/lib/notify'); return sendNotification(db, msg); });
  await send({ tenantId: t, channel: 'sms', to: from, kind: 'text_assist', text: 'Hi, thank you for your message. So that we can help, could you please reply with your full name? A member of our team will be in touch shortly.', recipientType: 'other', sentBy: { id: 'auto', name: 'Automatic reply' } });
  return { replied: true };
}
