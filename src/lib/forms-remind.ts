// src/lib/forms-remind.ts — ONE REMINDER, THEN THANKS (board FormsAfter). A client with forms or documents still left
// gets one text and email the evening before they're due (6 PM the day before, on the business's clock), only if
// something is still left then, and only if they booked before that evening (anyone booking later was just asked).
// The email lists what's done and what isn't, with one button to the visit link. Once everything's done, a reminded
// client gets a short thank-you. Never more than one reminder per visit. Runs from the hourly reminders job.
// Automations: "Remind clients to finish their forms" (clientNotify.formsReminder). Server side only.
import { automationOn } from './automation-switches';
import { tenantTimeZone, dayKey, addDays, wallToUtc, formatTime } from './tenant-time';
import { toMs } from './forms';

const LIVE = ['confirmed', 'scheduled', 'deposit_pending'];
const first = (n: any) => { const f = String(n || '').trim().split(/\s+/)[0] || ''; return /^(guest|client|customer|walk-?in)$/i.test(f) ? '' : f; };

/** 6 PM, the evening before forms are due, on the business's clock. */
export function remindAt(dueIso: string, zone: string): Date {
  return wallToUtc(addDays(dayKey(new Date(dueIso), zone), -1), 18, 0, zone);
}

/** "Fri at 3:30 PM" (or "Friday at 3:30 PM" when long). */
export function dueWords(iso: string, zone: string, long = false): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: long ? 'long' : 'short' }).format(d);
  return `${day} at ${formatTime(d, zone)}`;
}

/** Every visit whose request is still waiting on forms or documents: reminded once, the evening before they're due. */
export async function formsReminderSweep(db: any, tenantId: string, tenant: any, now = new Date()): Promise<number> {
  if (!automationOn(tenant, 'forms-reminder')) return 0;
  if (tenant?.clientNotify?.enabled === false) return 0;
  const snap = await db.collection(`tenants/${tenantId}/bookingCompletions`).where('status', '==', 'pending').limit(1000).get();
  const zone = tenantTimeZone(tenant);
  let sent = 0;
  // A handful at a time, so a busy business doesn't hold up everyone else's reminders.
  const one = async (d: any) => {
    const rec: any = d.data() || {}; const token = d.id;
    if (rec.formsReminderSentAt || !rec.appointmentId || (Number(rec.formsReminderTries) || 0) >= 2) return;
    // A request for a visit long past isn't read again.
    if (toMs(rec.appointmentStartTime) && toMs(rec.appointmentStartTime) < now.getTime() - 30 * 864e5) return;
    try {
      // The visit's own time (a reschedule moves it; the request keeps the time it was made for).
      const appt: any = ((await db.doc(`tenants/${tenantId}/appointments/${rec.appointmentId}`).get()).data()) || null;
      const start = toMs(appt?.startTime); if (!start || start <= now.getTime()) return;
      if (!appt || !LIVE.includes(String(appt.status || 'confirmed')) || appt.formsReminderSentAt || !appt.checkInToken || appt.linkRevokedAt) return;
      // The team sent one by hand in the last 4 hours: this one waits for a later run, and isn't sent at all if that
      // would be after the forms are due (they were just reminded).
      if (toMs(appt.formsNudgedAt) > now.getTime() - 4 * 3600e3) return;
      const { formsDueAt } = await import('./forms'); const { visitForms } = await import('./forms-visit');
      const due = formsDueAt(appt.startTime, appt.createdAt || rec.createdAt); if (!due) return;
      const at = remindAt(due, zone);
      if (now.getTime() < at.getTime() || now.getTime() >= toMs(due)) return;
      // Booked after that evening: they were just asked when they booked.
      if (toMs(rec.createdAt || appt.createdAt) > at.getTime()) return;
      const state = await visitForms(db, tenantId, { ...appt, id: rec.appointmentId }, { tenant, rec });
      // Nothing left (signed at the desk, or a save whose last step didn't finish): the request is closed now instead.
      if (state.left <= 0) { const { closeIfDone } = await import('./forms-visit'); await closeIfDone(db, tenantId, token, { ...appt, id: rec.appointmentId }, rec, state, tenant); return; }
      // Marked first, so two runs at once can't both send it. If nothing could be sent (no way to reach them, or the
      // message service failed), the mark comes off for one more try the next hour.
      const took = await db.runTransaction(async (tx: any) => { const r = await tx.get(d.ref); if ((r.data() || {}).formsReminderSentAt) return false; tx.set(d.ref, { formsReminderSentAt: now.toISOString() }, { merge: true }); return true; });
      if (!took) return;
      let sentOk = false; try { sentOk = await sendFormsReminder(db, tenantId, { ...appt, id: rec.appointmentId }, tenant, state, due); } catch (e) { console.error('[forms-remind] send', e); }
      if (sentOk) {
        sent++; await db.doc(`tenants/${tenantId}/appointments/${rec.appointmentId}`).set({ formsReminderSentAt: now.toISOString() }, { merge: true });
      } else await d.ref.set({ formsReminderSentAt: null, formsReminderTries: (Number(rec.formsReminderTries) || 0) + 1 }, { merge: true });
    } catch (e) { console.error('[forms-remind]', tenantId, token, e); }
  };
  for (let k = 0; k < snap.docs.length; k += 10) await Promise.all(snap.docs.slice(k, k + 10).map(one));
  if (sent) { try { const { noteAutomation } = await import('./automation-switches'); await noteAutomation(db, tenantId, 'forms-reminder', sent); } catch { /* counts only */ } }
  return sent;
}

/** Sent, or held to go out after quiet hours (it's on its way either way). */
const went = (r: any) => !!r && (r.ok === true || r.held === true);
/** How this client wants reminders (set on their visit link), when the business lets them choose: 'sms', 'email', 'none'
 *  or both (a phone call isn't how forms are asked for, so it means both here). */
const prefOf = (tenant: any, cl: any) => { const p = tenant?.notificationDefaults?.allowClientOverride === false ? 'both' : String(cl?.notificationPreferences?.reminderChannel || 'both'); return ['sms', 'email', 'none'].includes(p) ? p : 'both'; };
const escHtml = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The reminder itself: a text ("One thing to finish before your visit Sat at 3:30 PM, the consent form (2 min): link")
 *  and an email with the list ticked off and one button. */
export async function sendFormsReminder(db: any, tenantId: string, appt: any, tenant: any, state: any, dueIso: string): Promise<boolean> {
  const cl: any = appt.clientId ? ((await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get()).data() || {}) : {};
  const pref = prefOf(tenant, cl);
  if (pref === 'none') return false;
  const email = pref === 'sms' ? '' : String(appt.clientEmail || cl.email || '').trim(); const phone = pref === 'email' ? '' : String(appt.clientPhone || cl.phone || '').trim();
  const zone = tenantTimeZone(tenant);
  const { linkOrigin } = await import('./app-origin'); const base = linkOrigin(tenant, '') || process.env.NEXT_PUBLIC_APP_URL || ''; if (!base) return false;
  const link = `${base}/check-in/${appt.checkInToken}`;
  const studio = String(tenant?.name || tenant?.businessName || 'Your studio');
  const name = first(appt.clientName || cl.name);
  const visitAt = dueWords(appt.startTime, zone);
  const forms = (state.asks || []).filter((a: any) => a.ask === 'sign' || a.ask === 'sign_again');
  const files = (state.files || []).filter((f: any) => !f.done && !f.optional);
  const n = forms.length + files.length;
  const what = [...forms.map((f: any) => `${f.title} (${f.minutes} min)`), ...files.map((f: any) => f.label)];
  const list = what.length > 2 ? `${what.slice(0, 2).join(', ')} and ${what.length - 2} more` : what.join(' and ');
  const lead = n === 1 ? 'One thing to finish' : `${n} things to finish`;
  const tokens = { client_first: name || 'there', service: String(appt.serviceName || 'appointment'), when: visitAt, link, studio, what: list };
  const { sendNotification } = await import('./notify');
  let ok = false;
  if (phone) ok = went(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'forms_reminder', tokens,
    text: `${lead} before your visit ${visitAt}: ${list}. ${link}`,
    recipientType: 'client', recipientId: appt.clientId || null, recipientName: appt.clientName || null, appointmentId: appt.id || null } as any).catch(() => null)) || ok;
  if (email.includes('@')) {
    const { brandedEmailHtml, emailLookOf } = await import('./email-template');
    const tick = '<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#eaf6ef;color:#1f7a4d;text-align:center;line-height:20px;font-size:12px;font-weight:700">&#10003;</span>';
    const ring = '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;border:2px solid #b45309"></span>';
    const row = (done: boolean, label: string, note: string) => `<tr><td width="30" style="padding:8px 0;vertical-align:middle">${done ? tick : ring}</td><td style="padding:8px 0;font-size:14.5px;color:#16171a">${escHtml(label)}</td><td align="right" style="padding:8px 0;font-size:13px;color:#6d7075;white-space:nowrap">${escHtml(note)}</td></tr>`;
    const rows = [
      ...(state.asks || []).map((a: any) => row(a.ask === 'done' || a.ask === 'confirm', a.title, a.ask === 'sign' || a.ask === 'sign_again' ? `${a.minutes} min` : a.ask === 'confirm' ? 'on file' : 'done')),
      ...(state.files || []).map((f: any) => row(f.done, f.label, f.done ? (f.onFile ? 'on file' : 'done') : '')),
    ].join('');
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date(appt.startTime));
    const bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;border-radius:16px;padding:6px 16px 8px">${rows}</table>`;
    ok = went(await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'forms_reminder', tokens,
      subject: `${lead} before ${day}`,
      html: brandedEmailHtml({ studioName: studio, brand: emailLookOf(tenant), eyebrow: 'Before your visit', title: `${lead} before`, titleBold: day, preheader: forms.length === 1 && !files.length ? `The ${forms[0].title.toLowerCase()} takes about ${forms[0].minutes} minute${forms[0].minutes === 1 ? '' : 's'}.` : 'It takes a few minutes.',
        bodyHtml, cta: { label: 'Finish now', url: link }, smallPrint: `Due ${dueWords(dueIso, zone)}. If it isn’t done by then, we’ll go through it with you when you arrive.` }),
      recipientType: 'client', recipientId: appt.clientId || null, recipientName: appt.clientName || null, appointmentId: appt.id || null } as any).catch(() => null)) || ok;
  }
  return ok;
}

/** Once everything's done: "Thanks, Dana. You're all set for Saturday at 3:30 PM." By text when they have a number (and
 *  take texts), otherwise by email, the way they chose to be reminded. Only to clients who were reminded. */
export async function sendFormsThanks(db: any, tenantId: string, appt: any, tenant: any, rec?: any): Promise<boolean> {
  if (!automationOn(tenant, 'forms-reminder') || tenant?.clientNotify?.enabled === false || appt?.linkRevokedAt) return false;
  const cl: any = appt.clientId ? ((await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get()).data() || {}) : {};
  const pref = prefOf(tenant, cl); if (pref === 'none') return false;
  const email = pref === 'sms' ? '' : String(appt.clientEmail || rec?.clientEmail || cl.email || '').trim(); const phone = pref === 'email' ? '' : String(appt.clientPhone || cl.phone || '').trim();
  const zone = tenantTimeZone(tenant); const name = first(appt.clientName || cl.name);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date(appt.startTime));
  const text = `Thanks${name ? `, ${name}` : ''}. You’re all set for ${day} at ${formatTime(new Date(appt.startTime), zone)}.`;
  const tokens = { client_first: name || 'there', when: `${day} at ${formatTime(new Date(appt.startTime), zone)}`, studio: String(tenant?.name || '') };
  const { sendNotification } = await import('./notify');
  const base = { tenantId, kind: 'forms_done', tokens, recipientType: 'client', recipientId: appt.clientId || null, recipientName: appt.clientName || null, appointmentId: appt.id || null };
  if (phone && went(await sendNotification(db, { ...base, channel: 'sms', to: phone, text } as any).catch(() => null))) return true;
  if (email.includes('@')) {
    const { brandedEmailHtml, emailLookOf } = await import('./email-template');
    return went(await sendNotification(db, { ...base, channel: 'email', to: email, subject: `You’re all set for ${day}`,
      html: brandedEmailHtml({ studioName: String(tenant?.name || 'Your studio'), brand: emailLookOf(tenant), eyebrow: 'Thank you', title: 'You’re all set for', titleBold: day, bodyLines: [text] }) } as any).catch(() => null));
  }
  return false;
}
