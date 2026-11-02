// src/lib/visit-pay-notice.ts — "Your total is ready": the message a client gets when checkout sends their total to
// their own phone (api/client-screen, a visit's own screen). A text with their visit link opening on the payment, or an
// email when there's no number, they've turned texts off, or the text didn't go. Says which went, so the desk can tell
// whoever's checking out. It goes at any hour (they're at the desk paying, so quiet hours don't hold it), and it's the
// "Your total is ready" message in Settings → Messages, where the business can write its own words.
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';

export async function sendTotalReady(db: any, o: { tenantId: string; business: string; url: string; amount?: number; appointmentId?: string | null; clientId?: string | null; name?: string | null; phone?: string | null; email?: string | null; textOff?: boolean }): Promise<'text' | 'email' | null> {
  const first = String(o.name || '').split(' ')[0] || 'there';
  const amount = Number(o.amount) > 0 ? `$${Number(o.amount).toFixed(2)}` : '';
  const tokens = { client_first: first, amount, studio: o.business, link: o.url };
  const base = { tenantId: o.tenantId, kind: 'visit_pay', essential: true, tokens, clientId: o.clientId || null, clientName: o.name || null, appointmentId: o.appointmentId || null, recipientType: 'client' };
  const phone = String(o.phone || '').trim(); const email = String(o.email || '').trim();
  if (phone && !o.textOff) {
    const r: any = await sendNotification(db, { ...base, channel: 'sms', to: phone, text: `Hi ${first}, your total from ${o.business} is ready. You can add a tip and pay here: ${o.url}` } as any).catch(() => null);
    if (r?.ok) return 'text';
  }
  if (email.includes('@')) {
    const html = brandedEmailHtml({ studioName: o.business, title: 'Your total is ready', bodyLines: [`Hi ${first},`, `Thank you for coming in. Your total${amount ? ` of ${amount}` : ''} is ready, and you can add a tip and pay from your visit link.`, 'Kind regards,', o.business], cta: { label: 'Pay from your visit link', url: o.url } } as any);
    const r: any = await sendNotification(db, { ...base, channel: 'email', to: email, subject: `Your total from ${o.business}`, html } as any).catch(() => null);
    if (r?.ok) return 'email';
  }
  return null;
}
