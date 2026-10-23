// src/lib/refund-notice.ts — TELL THE CLIENT WHEN MONEY COMES BACK (server).
// Card refunds are confirmed when Stripe reports them (so refunds made in Stripe itself are covered too);
// credit given instead of a refund is confirmed where it's given. Each is sent once — keyed by the refund
// or the credit — so a repeated payment notice never sends a second message. The key is claimed before anything is
// sent, so two notices at the same moment send one message; a send that fails gives the claim back for the next try.
export async function sendRefundNotice(db: any, tenantId: string, o: {
  key: string; kind: 'refund' | 'credit'; amountCents: number; clientId?: string | null; appointmentId?: string | null;
  email?: string | null; last4?: string | null; reason?: string | null;
}) {
  if (!(o.amountCents > 0) || !o.key) return false;
  const T = `tenants/${tenantId}`;
  const mark = db.doc(`${T}/refundNotices/${o.key.replace(/[^\w-]/g, '_').slice(0, 120)}`);
  const claimedAt = new Date().toISOString();
  const mine = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(mark); const m: any = s.exists ? (s.data() || {}) : null;
    // Told already (a record without a claim is from before claims: it was sent), or another notice is sending it now
    // (a claim from a send that died over ten minutes ago can be taken).
    if (m && (m.sentAt || !m.claimedAt || Date.now() - Date.parse(String(m.claimedAt)) < 10 * 60e3)) return false;
    tx.set(mark, { key: o.key, kind: o.kind, amountCents: o.amountCents, claimedAt }, { merge: true });
    return true;
  });
  if (!mine) return false;
  const giveBack = async () => {
    await db.runTransaction(async (tx: any) => { const s = await tx.get(mark); const m: any = s.exists ? (s.data() || {}) : null; if (m && !m.sentAt && m.claimedAt === claimedAt) tx.delete(mark); }).catch(() => {});
  };
  try {
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const ap: any = o.appointmentId ? (((await db.doc(`${T}/appointments/${o.appointmentId}`).get()).data() as any) || {}) : {};
    const clientId = o.clientId || ap.clientId || null;
    const c: any = clientId ? (((await db.doc(`${T}/clients/${clientId}`).get()).data() as any) || {}) : {};
    const email = String(c.email || o.email || ap.clientEmail || '').trim(), phone = String(c.phone || ap.clientPhone || '').trim();
    if (!email.includes('@') && !phone) { await giveBack(); return false; }
    const studio = tenant.name || tenant.businessName || 'Your studio';
    const money = `$${(o.amountCents / 100).toFixed(2)}`;
    const first = String(c.name || ap.clientName || '').split(' ')[0];
    const forWhat = ap.startTime ? ` for your ${ap.serviceName || 'appointment'} on ${new Date(ap.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tenant.timezone || undefined })}` : '';
    const lines = o.kind === 'refund'
      ? [`${first ? `Hi ${first}, w` : 'W'}e've issued your refund of ${money}${forWhat}.`, `It's on its way back to ${o.last4 ? `your card ending in ${o.last4}` : 'the card you paid with'} and usually appears within 5 to 10 business days, depending on your bank.`]
      : [`${first ? `Hi ${first}, w` : 'W'}e've added ${money} in credit to your account${forWhat}.`, "It will be applied to your next visit automatically, so there's nothing you need to do."];
    if (o.reason) lines.push(`Reason: ${o.reason}.`);
    lines.push("If you have any questions, please reply to this message. We're happy to help.");
    const { sendNotification } = await import('@/lib/notify');
    let ok = false;
    const replyTo = String(tenant.email || tenant.contactEmail || tenant.ownerEmail || '').trim();
    if (email.includes('@')) {
      const { brandedEmailHtml } = await import('@/lib/email-template');
      ok = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: o.kind === 'refund' ? `Your ${money} refund from ${studio}` : `${money} in credit added to your account at ${studio}`,
        kind: o.kind === 'refund' ? 'refund_notice' : 'credit_notice', html: brandedEmailHtml({ studioName: studio, title: o.kind === 'refund' ? 'Your refund has been issued' : 'Credit added to your account', bodyLines: [...lines, 'Kind regards,', studio] } as any),
        ...(replyTo.includes('@') ? { replyTo } : {}), appointmentId: o.appointmentId || null, clientId, clientName: c.name || ap.clientName || null } as any))?.ok;
    }
    if (!ok && phone) ok = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: o.kind === 'refund' ? 'refund_notice' : 'credit_notice', text: lines.slice(0, 2).join(' '), appointmentId: o.appointmentId || null, clientId, clientName: c.name || null } as any))?.ok;
    if (ok) await mark.set({ key: o.key, kind: o.kind, amountCents: o.amountCents, clientId, appointmentId: o.appointmentId || null, sentAt: new Date().toISOString() }, { merge: true });
    else await giveBack();
    return ok;
  } catch (e) { await giveBack(); throw e; }
}
