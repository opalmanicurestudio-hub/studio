// src/lib/renter-aftercare.ts — PART 6: a renter's clients get the RENTER's aftercare (lib/renter-docs), under the renter's
// business name and by the renter's own choices (renterSettings/{staffId}.aftercare) — never the studio's. Same timing as
// the studio's (lib/aftercare-send): at checkout (about 10 minutes after) or the next morning, then a check-in.
import { linkOrigin } from '@/lib/app-origin';
import { tenantTimeZone, dayKey } from '@/lib/tenant-time';
import { checkInDaysFor } from '@/lib/aftercare';
import { aftercarePath } from '@/lib/visit-feedback';
import { renterAftercareFor, renterCareSettingsOf } from '@/lib/renter-docs';
import { finishedAt } from '@/lib/aftercare-send';

const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const FINISHED = ['completed', 'checked_out', 'paid'];
const hourIn = (tz: string, d: Date) => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(d));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** The renter behind a visit's provider, and their business name. */
export async function renterBrand(db: any, tenantId: string, staff: any) {
  let r: any = null; if (staff?.renterId) { try { r = (await db.doc(`tenants/${tenantId}/renters/${staff.renterId}`).get()).data() || null; } catch { /* none */ } }
  return { name: String(r?.businessName || staff?.businessName || staff?.name || 'Your provider'), logo: r?.photoUrl || staff?.avatarUrl || null };
}

export async function renterAftercareSweep(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const base = linkOrigin(tenant, ''); if (!base) return { sent: 0, checkIns: 0 };
  const T = `tenants/${tenantId}`; const tz = tenantTimeZone(tenant);
  const all = (await db.collection(`${T}/renterDocs`).where('category', '==', 'aftercare').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((d: any) => d.status === 'published');
  if (!all.length) return { sent: 0, checkIns: 0 };
  const byStaff = new Map<string, any[]>(); for (const d of all) byStaff.set(String(d.staffId), [...(byStaff.get(String(d.staffId)) || []), d]);
  const { smsConfigured, sendTenantSms } = await import('@/lib/sms'); const { sendNotification } = await import('@/lib/notify');
  const snap = await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 9 * 864e5).toISOString()).get();
  const cache = new Map<string, any>(); let sent = 0, checkIns = 0; const today = dayKey(new Date(now), tz); const hour = hourIn(tz, new Date(now));
  for (const d of snap.docs) {
    const a: any = d.data() || {}; const sid = String(a.staffId || '');
    try {
      const docs = byStaff.get(sid); if (!docs || !FINISHED.includes(String(a.status || ''))) continue;
      if (!cache.has(sid)) { const st: any = (await db.doc(`${T}/staff/${sid}`).get()).data() || {}; const set: any = (await db.doc(`${T}/renterSettings/${sid}`).get()).data() || {};
        cache.set(sid, { S: renterCareSettingsOf(set.aftercare), brand: await renterBrand(db, tenantId, st) }); }
      const { S, brand } = cache.get(sid); if (!S.on) continue;
      const care = renterAftercareFor(docs, a.serviceId); if (!care) continue;
      let phone = a.clientPhone || a.phone || null, email = a.clientEmail || a.email || null;
      if ((!phone || !email) && a.clientId) { try { const c: any = (await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}; phone = phone || c.phone || null; email = email || c.email || null; } catch { /* none */ } }
      const send = async (text: string, subject: string, kind: string) => { let ok = false;
        if (phone && smsConfigured()) ok = (await sendTenantSms(db, tenantId, phone, text, { email, subject })).ok;
        if (!ok && email) ok = (await sendNotification(db, { tenantId, channel: 'email', to: email, subject, text, kind, appointmentId: d.id, clientId: a.clientId || null, clientName: a.clientName || null, recipientType: 'client' } as any)).ok;
        return ok; };
      const url = `${base}${aftercarePath(tenantId, d.id)}`; const svc = String(a.serviceName || a.renterServiceName || 'visit').toLowerCase();
      if (!a.aftercareSentAt && !a.followUpSentAt) {
        const done = finishedAt(a); if (!done) continue;
        const ready = S.when === 'checkout' ? now - done >= 10 * 60000 && now - done <= 24 * 3600000 : dayKey(new Date(done), tz) < today && hour >= 9 && hour < 19 && now - done <= 48 * 3600000;
        if (!ready) continue;
        const text = `Hi ${first(a.clientName) || 'there'}, thank you for visiting ${brand.name}! Here is how to care for your ${svc}: ${url}`;
        if (await send(text, `How to care for your ${svc}`, 'aftercare')) { await d.ref.set({ aftercareSentAt: new Date(now).toISOString(), aftercareDocId: care.id, aftercareVersion: Number(care.version || 1), aftercareVia: 'renter' }, { merge: true }); sent++; }
        continue;
      }
      const days = checkInDaysFor(S, docs.find((x: any) => x.id === a.aftercareDocId) || care);
      if (!days || !a.aftercareSentAt || a.checkInSentAt || hour < 10 || hour >= 19) continue;
      const gap = daysBetween(dayKey(new Date(ms(a.startTime)), tz), today); if (gap < days || gap > days + 1) continue;
      const text = `Hi ${first(a.clientName) || 'there'}, how is your ${svc} holding up? Please let ${brand.name} know with one tap: ${url}&c=1`;
      if (await send(text, `How is your ${svc} holding up?`, 'aftercare_checkin')) { await d.ref.set({ checkInSentAt: new Date(now).toISOString() }, { merge: true }); checkIns++; }
    } catch { /* next visit */ }
  }
  return { sent, checkIns };
}
