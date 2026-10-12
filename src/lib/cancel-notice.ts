// src/lib/cancel-notice.ts — THE ONE CANCELLATION MESSAGE a client gets,
// whoever cancelled (the front desk, or the client from their visit link):
// what happened, in the business's policy wording, plus "Book again".
import { cancellationOutcomeLines, type CancelOutcome } from '@/lib/policy-copy';

export async function sendCancellationNotice(db: any, tenantId: string, appointmentId: string, o: CancelOutcome, base: string, ap?: any): Promise<{ email: boolean; sms: boolean; lines: string[] }> {
  const T = `tenants/${tenantId}`;
  const a: any = ap || ((await db.doc(`${T}/appointments/${appointmentId}`).get()).data() as any) || {};
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const cl: any = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
  const email = String(cl.email || a.clientEmail || '').trim(), phone = String(cl.phone || a.clientPhone || '').trim();
  const studio = tenant.name || tenant.businessName || 'the studio';
  const first = String(a.clientName || cl.name || '').split(' ')[0] || 'there';
  const when = a.startTime ? new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined }) : 'your appointment';
  const book = `${base}/book/${tenantId}${a.serviceId ? `?service=${encodeURIComponent(String(a.serviceId))}` : ''}`;
  const head = o.who === 'no_show' ? `We were sorry not to see you for your appointment on ${when}.` : o.who === 'studio' ? `Unfortunately, we have had to cancel your appointment on ${when}.` : `Your appointment on ${when} has been cancelled.`;
  const lines = cancellationOutcomeLines(o);
  const body = [`Hi ${first},`, head, ...lines, o.who === 'no_show' ? 'We hope everything is all right, and we would be glad to see you again soon.' : 'We would be glad to see you again soon.', 'If you have any questions, please reply to this email.', 'Kind regards,', studio];
  const told = { email: false, sms: false };
  // The words can be the business's own (Settings → Messages → Appointment cancelled) — these fill them in.
  const tokens = { client_first: first, when, service: String(a.serviceName || ''), outcome: lines.join(' '), link: book, studio };
  try {
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const subject = o.who === 'no_show' ? `We missed you at ${studio}` : `Your appointment at ${studio} has been cancelled`;
    if (email.includes('@')) told.email = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject, kind: 'appointment_cancelled', tokens,
      html: brandedEmailHtml({ studioName: studio, title: o.who === 'no_show' ? 'We missed you' : 'Appointment cancelled', bodyLines: body, cta: { label: 'Book again', url: book } }),
      appointmentId, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok;
    if (phone) told.sms = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'appointment_cancelled', tokens,
      text: `Hi ${first}, this is ${studio}. ${head} ${lines.join(' ')} To book a new time, please visit ${book}`, appointmentId, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok;
  } catch (e) { console.error('[cancel-notice] send failed', e); }
  return { ...told, lines };
}
