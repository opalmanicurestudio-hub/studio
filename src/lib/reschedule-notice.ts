// src/lib/reschedule-notice.ts — THE MESSAGE A CLIENT GETS WHEN THEIR APPOINTMENT MOVES, when they moved it
// themselves from their visit link. (A move made by the business sends its own notice from
// /api/appointments/reschedule.) Email and text, through the app's one sender, so message settings, quiet hours
// and the message log all apply. Says what changed and anything about a fee, in plain words.

export async function sendRescheduleNotice(db: any, tenantId: string, a: any, o: { newStartIso: string; base: string; feeLine?: string | null }): Promise<{ email: boolean; sms: boolean }> {
  const T = `tenants/${tenantId}`; const told = { email: false, sms: false };
  try {
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const cl: any = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
    const email = String(a.clientEmail || cl.email || '').trim(); const phone = String(a.clientPhone || cl.phone || '').trim();
    if (!email.includes('@') && !phone) return told;
    const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
    const fmt = (iso: string, long: boolean) => { try { return new Date(iso).toLocaleString('en-US', { weekday: long ? 'long' : 'short', month: long ? 'long' : 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return ''; } };
    const whenNew = fmt(o.newStartIso, true); const whenOld = a.startTime ? fmt(a.startTime, false) : '';
    const first = String(a.clientName || cl.name || '').trim().split(/\s+/)[0] || 'there';
    const svc = String(a.serviceName || 'appointment'); const studio = tenant.name || tenant.businessName || 'Your studio';
    const withWho = a.staffName ? ` with ${String(a.staffName).split(' ')[0]}` : '';
    const link = a.checkInToken ? `${o.base}/check-in/${a.checkInToken}` : null; const fee = o.feeLine ? ` ${o.feeLine}` : '';
    const meta = { appointmentId: a.id || null, clientId: a.clientId || null, recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null };
    const { sendNotification } = await import('@/lib/notify');
    if (email.includes('@')) {
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const r = await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'appointment_rescheduled', subject: `Your ${svc} is now ${whenNew}`,
        html: brandedEmailHtml({ studioName: studio, title: 'Your new appointment time', bodyLines: [`Hi ${first},`, `Thank you for letting us know. Your ${svc}${withWho} is now on ${whenNew}.${whenOld ? ` Your previous time was ${whenOld}.` : ''}`, ...(o.feeLine ? [o.feeLine] : []), 'We look forward to seeing you then.'],
          ...(link ? { cta: { label: 'View my appointment', url: link } } : {}) }), ...meta } as any).catch(() => null);
      told.email = !!(r as any)?.ok;
    }
    if (phone) {
      const r = await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'appointment_rescheduled',
        text: `Hi ${first}, your ${svc}${withWho} is now on ${whenNew}.${fee}${link ? ` Your visit link: ${link}` : ''}`, ...meta } as any).catch(() => null);
      told.sms = !!(r as any)?.ok;
    }
  } catch (e) { console.error('[reschedule-notice] send failed (the move stands)', e); }
  return told;
}
