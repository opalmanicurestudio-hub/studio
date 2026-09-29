// src/lib/refund-notice.ts — TELL THE CLIENT WHEN MONEY COMES BACK (server).
// Card refunds are confirmed when Stripe reports them (so refunds made in Stripe itself are covered too);
// credit given instead of a refund is confirmed where it's given. Each is sent once — keyed by the refund
// or the credit — so a repeated payment notice never sends a second message.
export async function sendRefundNotice(db: any, tenantId: string, o: {
  key: string; kind: 'refund' | 'credit'; amountCents: number; clientId?: string | null; appointmentId?: string | null;
  email?: string | null; last4?: string | null; reason?: string | null;
}) {
  if (!(o.amountCents > 0) || !o.key) return false;
  const T = `tenants/${tenantId}`;
  const mark = db.doc(`${T}/refundNotices/${o.key.replace(/[^\w-]/g, '_').slice(0, 120)}`);
  if ((await mark.get()).exists) return false;                       // already told
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const ap: any = o.appointmentId ? (((await db.doc(`${T}/appointments/${o.appointmentId}`).get()).data() as any) || {}) : {};
  const clientId = o.clientId || ap.clientId || null;
  const c: any = clientId ? (((await db.doc(`${T}/clients/${clientId}`).get()).data() as any) || {}) : {};
  const email = String(c.email || o.email || ap.clientEmail || '').trim(), phone = String(c.phone || ap.clientPhone || '').trim();
  if (!email.includes('@') && !phone) return false;
  const studio = tenant.name || tenant.businessName || 'Your studio';
  const money = `$${(o.amountCents / 100).toFixed(2)}`;
  const first = String(c.name || ap.clientName || '').split(' ')[0];
  const forWhat = ap.startTime ? ` for your ${ap.serviceName || 'appointment'} on ${new Date(ap.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tenant.timezone || undefined })}` : '';
  const lines = o.kind === 'refund'
    ? [`${first ? `Hi ${first} — y` : 'Y'}our refund of ${money}${forWhat} is on its way.`, `It goes back to ${o.last4 ? `your card ending ${o.last4}` : 'the card you paid with'} and usually shows within 5–10 business days, depending on your bank.`]
    : [`${first ? `Hi ${first} — ` : ''}${money}${forWhat} has been added to your account as credit.`, 'It comes off your next visit automatically — nothing to do.'];
  if (o.reason) lines.push(`Reason: ${o.reason}.`);
  lines.push('Questions? Just reply or give us a call.');
  const { sendNotification } = await import('@/lib/notify');
  let ok = false;
  const replyTo = String(tenant.email || tenant.contactEmail || tenant.ownerEmail || '').trim();
  if (email.includes('@')) {
    const { brandedEmailHtml } = await import('@/lib/email-template');
    ok = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: o.kind === 'refund' ? `Your ${money} refund — ${studio}` : `${money} credit added — ${studio}`,
      kind: o.kind === 'refund' ? 'refund_notice' : 'credit_notice', html: brandedEmailHtml({ studioName: studio, title: o.kind === 'refund' ? 'Your refund is on its way' : 'Credit added to your account', bodyLines: lines } as any),
      ...(replyTo.includes('@') ? { replyTo } : {}), appointmentId: o.appointmentId || null, clientId, clientName: c.name || ap.clientName || null } as any))?.ok;
  }
  if (!ok && phone) ok = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: o.kind === 'refund' ? 'refund_notice' : 'credit_notice', text: `${studio}: ${lines.slice(0, 2).join(' ')}`, appointmentId: o.appointmentId || null, clientId, clientName: c.name || null } as any))?.ok;
  if (ok) await mark.set({ key: o.key, kind: o.kind, amountCents: o.amountCents, clientId, appointmentId: o.appointmentId || null, sentAt: new Date().toISOString() });
  return ok;
}
