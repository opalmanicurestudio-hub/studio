// src/lib/renter-taxes-server.ts — RENTERS' ESTIMATED TAX REMINDERS (server; lib/renter-taxes). The week before each of
// the year's four dates, an email to each renter who asked for one on their Taxes to set aside page (Email too), once per
// date, unless they've already recorded a payment to the IRS toward it. The portal's Today shows the same reminder to
// everyone who hasn't switched it off (api/portal/renter 'today'). Run by the nightly job, business by business. The
// business's message log keeps only that a reminder went out, never what it said (lib/notify privateToRecipient).
import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';
import { renterPortalUrl } from '@/lib/renter-comms';
import { todayFor } from '@/lib/trip-log-server';
import { dueSoon, paidToward, remindChannelOf } from '@/lib/renter-taxes';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const mdy = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/** Emails sent for one business tonight. */
export async function remindRenterTaxes(db: any, tenantId: string, tenant: any, today: string = todayFor(tenant)): Promise<number> {
  const soon = dueSoon(today, 7); if (!soon || soon.inDays < 1) return 0;
  const renters = await db.collection(`tenants/${tenantId}/renters`).get();
  let link: string | null | undefined; let sent = 0;
  for (const d of renters.docs) {
    const rid = String(d.id); if (!ID.test(rid)) continue;
    const r: any = d.data() || {}; const email = String(r.email || '').trim();
    if (!email.includes('@') || ['prospective', 'past', 'archived'].includes(String(r.status || ''))) continue;
    const remRef = db.doc(`tenants/${tenantId}/private/renter_${rid}/taxes/reminders`);
    const rem: any = (await remRef.get()).data() || {};
    if (remindChannelOf(rem.channel) !== 'email' || rem.sent?.[soon.due]) continue;
    const yr: any = (await db.doc(`tenants/${tenantId}/private/renter_${rid}/taxes/${soon.forYear}`).get()).data() || {};
    if (paidToward(yr.payments, soon.due)) continue;
    // (Once per date, even if the job runs twice.)
    const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(remRef)).data() || {}; if (cur.sent?.[soon.due]) return false; tx.set(remRef, { sent: { [soon.due]: new Date().toISOString() } }, { merge: true }); return true; });
    if (!mine) continue;
    if (link === undefined) link = await renterPortalUrl(db, tenantId);
    const when = mdy(soon.due);
    const unmark = () => remRef.set({ sent: { [soon.due]: null } }, { merge: true }).catch(() => {});
    try {
      const res: any = await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Estimated taxes are due ${when}`,
        html: brandedEmailHtml({ studioName: 'Your portal', title: `Estimated taxes are due ${when}`, bodyLines: [
          `Your next estimated tax payment toward ${soon.forYear} is due ${when}.`,
          'Open Taxes to set aside in your portal to see what to send the IRS and your state, then mark it paid there.',
          link ? `Open your portal: ${link}` : '',
          'An estimate to set money aside by: your accountant works out what you owe. To stop these emails, choose In my portal or Off under Reminders on that page.',
        ].filter(Boolean) }),
        kind: 'renter_tax_reminder', recipientType: 'renter', recipientId: rid, privateToRecipient: true } as any);
      // (Not sent, whether it failed or mail isn't set up: the mark comes off, so tomorrow's run tries again. Switched
      // off on purpose stays marked.)
      if (res && res.ok === false && res.status !== 'skipped_by_policy') { await unmark(); continue; }
      sent++;
    } catch (e) {
      console.error('[renter-taxes] reminder', tenantId, rid, (e as any)?.message);
      await unmark();
    }
  }
  return sent;
}
