// src/lib/deposit-notify.ts — TELLING THE CLIENT ABOUT A DEPOSIT TAKEN OR ASKED FOR AT THE DESK: their visit is
// confirmed (with the deposit received), or a link to pay it. By email and text, from the business's own name. Used by
// the desk (api/appointments/desk-deposit) and by a deposit taken on the card reader, wherever it's recorded
// (lib/reader-deposit). Never throws: the deposit is safe either way. Server only.
import { bookingPolicyLines, holdLine } from '@/lib/policy-copy';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';

export async function tellDepositClient(db: any, tenant: any, tenantId: string, ap: any, base: string, kind: 'confirmed' | 'pay_link', cents: number) {
  try {
    const cl = ap.clientId ? (((await db.doc(`tenants/${tenantId}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
    const email = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
    const first = String(ap.clientName || '').split(' ')[0] || 'there'; const studio = tenant.name || tenant.businessName || 'the studio';
    const when = ap.startTime ? new Date(ap.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined }) : 'your next visit';
    const link = ap.checkInToken ? `${base}/check-in/${ap.checkInToken}` : `${base}/book/${tenantId}`;
    const money = `$${(cents / 100).toFixed(2)}`;
    const subject = kind === 'confirmed' ? `Your appointment is confirmed for ${when}` : `Please pay your ${money} deposit to confirm ${when}`;
    const policy = bookingPolicyLines(tenant, null, { depositCents: cents });
    const lines = kind === 'confirmed'
      ? [`Hi ${first},`, `Thank you for booking with us. Your next visit at ${studio} is confirmed for ${when}.${cents > 0 ? ` We have received your ${money} deposit.` : ''}`, ...policy, `Kind regards, ${studio}`]
      : [`Hi ${first},`, `We are holding ${when} for you at ${studio}. To confirm your appointment, please pay your ${money} deposit using the button below.`, holdLine(tenant, ap.paymentDueAt ? new Date(ap.paymentDueAt) : null), ...policy, `Kind regards, ${studio}`];
    if (email) await sendNotification(db, { tenantId, channel: 'email', to: email, subject, html: brandedEmailHtml({ studioName: studio, title: kind === 'confirmed' ? 'Your appointment is confirmed' : 'Confirm your next visit', bodyLines: lines, cta: { label: kind === 'confirmed' ? 'View your visit' : `Pay ${money} deposit`, url: link } }), kind: kind === 'confirmed' ? 'desk_booking_confirmed' : 'deposit_pay_link', appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: `${kind === 'confirmed' ? `Hi ${first}, your appointment is confirmed for ${when}. Your visit link:` : `Hi ${first}, to confirm your appointment on ${when}, please pay your ${money} deposit here:`} ${link}`, kind: kind === 'confirmed' ? 'desk_booking_confirmed' : 'deposit_pay_link', appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
  } catch (e) { console.error('[deposit-notify] notify failed (the deposit is safe)', e); }
}
