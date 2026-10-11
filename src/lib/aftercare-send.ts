// src/lib/aftercare-send.ts — SENDING AFTERCARE AND THE CHECK-IN (server; lib/aftercare has the rules). Runs every few
// minutes (the no-shows cron) for each business that sends aftercare:
//   At checkout — about ten minutes after a visit is finished (so the provider can still add a note), the client gets a
//     text (or email) with their aftercare page. Businesses that chose "next day" get it with the thank-you instead
//     (the reminders cron), and nothing is sent twice: the visit is stamped aftercareSentAt.
//   The check-in — the chosen number of days later, between 10 AM and 7 PM business time, a one-tap "How is it holding
//     up?" text that opens the same page with All good / Something's changed — and, when they haven't booked again,
//     their follow-up service with real times (the return plan, lib/rebook).
// Only the business's own visits — a renter's clients get the renter's aftercare (their own portal).
import { aftercareSettingsOf, aftercareDocFor, checkInDaysFor } from '@/lib/aftercare';
import { aftercarePath } from '@/lib/visit-feedback';
import { linkOrigin } from '@/lib/app-origin';
import { tenantTimeZone, dayKey } from '@/lib/tenant-time';
import { returnPlanOf } from '@/lib/rebook';
import { rebookSettingsOf } from '@/lib/client-screen';

const FINISHED = ['completed', 'checked_out', 'paid'];
const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; if (v?.toDate) return v.toDate().getTime(); return Number(new Date(v)) || 0; };
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const hourIn = (tz: string, at = new Date()) => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(at));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** When the visit was finished (the best stamp there is). */
export const finishedAt = (a: any) => ms(a.completedAt) || ms(a.checkedOutAt) || ms(a.paidAt) || ms(a.endTime) || (ms(a.startTime) + (Number(a.duration) || 60) * 60000);

export async function aftercareSweep(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const S = aftercareSettingsOf(tenant); if (!S.on) return { sent: 0, checkIns: 0 };
  const base = linkOrigin(tenant, ''); if (!base) return { sent: 0, checkIns: 0 };
  const T = `tenants/${tenantId}`; const tz = tenantTimeZone(tenant);
  let docs: any[] = [];
  try { docs = (await db.collection(`${T}/documents`).where('category', '==', 'aftercare').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })); } catch { return { sent: 0, checkIns: 0 }; }
  if (!docs.some((d) => d.status === 'published' && !d.renterId)) return { sent: 0, checkIns: 0 };
  const { smsConfigured, sendTenantSms } = await import('@/lib/sms'); const { sendNotification } = await import('@/lib/notify');
  const name = String(tenant.name || tenant.businessName || 'us');
  const contact = async (a: any) => { let phone = a.clientPhone || a.phone || null; let email = a.clientEmail || a.email || null;
    if ((!phone || !email) && a.clientId) { try { const c: any = (await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}; phone = phone || c.phone || null; email = email || c.email || null; } catch { /* none */ } }
    return { phone, email }; };
  const send = async (a: any, id: string, text: string, subject: string, kind: string) => {
    const { phone, email } = await contact(a); let ok = false;
    if (phone && smsConfigured()) ok = (await sendTenantSms(db, tenantId, phone, text, { email, subject })).ok;
    if (!ok && email) ok = (await sendNotification(db, { tenantId, channel: 'email', to: email, subject, text, kind, appointmentId: id, clientId: a.clientId || null, clientName: a.clientName || null, recipientType: 'client' } as any)).ok;
    return ok;
  };
  const snap = await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 9 * 864e5).toISOString()).get();
  const renterIds = new Set((await db.collection(`${T}/staff`).where('role', '==', 'renter').get()).docs.map((d: any) => d.id));
  const rs = rebookSettingsOf(tenant); const rebookOn = rs.on && rs.visitLink; let services: any[] | null = null;
  let sent = 0, checkIns = 0; const today = dayKey(new Date(now), tz); const hour = hourIn(tz, new Date(now));
  for (const d of snap.docs) {
    const a: any = d.data() || {};
    try {
      if (a.isRenterBooking || renterIds.has(String(a.staffId || '')) || !FINISHED.includes(String(a.status || ''))) continue;
      const care = aftercareDocFor(docs, a.serviceId, null); if (!care) continue;
      const url = `${base}${aftercarePath(tenantId, d.id)}`; const svc = String(a.serviceName || 'visit').toLowerCase();
      // At checkout: once, about ten minutes after it was finished, and only for visits finished in the last day.
      if (S.when === 'checkout' && !a.aftercareSentAt && !a.followUpSentAt) {
        const done = finishedAt(a); if (!done || now - done < 10 * 60000 || now - done > 24 * 3600000) continue;
        const text = `Hi ${first(a.clientName) || 'there'}, thank you for coming in! Here’s how to look after your ${svc}${a.staffName ? ` from ${first(a.staffName)}` : ''}: ${url}`;
        if (await send(a, d.id, text, `Looking after your ${svc}`, 'aftercare')) { await d.ref.set({ aftercareSentAt: new Date(now).toISOString(), aftercareDocId: care.id, aftercareVersion: Number(care.version || 1), aftercareVia: 'checkout' }, { merge: true }); sent++; }
        continue;
      }
      // The check-in, the chosen number of days after the visit, in the daytime.
      const days = checkInDaysFor(S, docs.find((x) => x.id === a.aftercareDocId) || care);
      if (!days || !a.aftercareSentAt || a.checkInSentAt || hour < 10 || hour >= 19) continue;
      const visitDay = dayKey(new Date(ms(a.startTime)), tz); const gap = daysBetween(visitDay, today);
      if (gap < days || gap > days + 1) continue;   // a day's grace if the business was asleep; never weeks later
      // Not booked again yet? The check-in also offers their follow-up service (the page shows real times).
      let next = '';
      try { if (a.clientId && rebookOn) { const fut = await db.collection(`${T}/appointments`).where('clientId', '==', a.clientId).get();
        const booked = fut.docs.some((x: any) => { const y: any = x.data() || {}; return x.id !== d.id && ms(y.startTime) > now && !['cancelled', 'canceled', 'no_show', 'declined', 'expired'].includes(String(y.status || '')); });
        if (!booked) { if (!services) services = (await db.collection(`${T}/services`).get()).docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) }));
          const list: any[] = services || []; const svcDoc = list.find((x: any) => x.id === a.serviceId); if (svcDoc) next = returnPlanOf(svcDoc, list).serviceName; } } } catch { /* the check-in still goes */ }
      const text = `Hi ${first(a.clientName) || 'there'}! How is your ${svc} holding up? Tell ${name} in one tap${next ? ` — and pick a time for your ${next.toLowerCase()} while you’re there` : ''}: ${url}&c=1`;
      if (await send(a, d.id, text, `How is your ${svc} holding up?`, 'aftercare_checkin')) { await d.ref.set({ checkInSentAt: new Date(now).toISOString() }, { merge: true }); checkIns++; }
    } catch { /* next visit */ }
  }
  return { sent, checkIns };
}
