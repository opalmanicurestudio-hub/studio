// src/lib/memberships/renewals.ts — RECURRING MEMBERSHIP BILLING for one business (moved out of
// /api/memberships/charge-renewals so the daily run, /api/cron/membership-renewals, can call it for every business —
// before, nothing ever called that route, so a membership charged once at enrollment and never again).
//
// Due = subscription active or past_due, nextBillingDate passed.
//   Charged → next date moves one interval on, the cycle's perks reset, the money is recorded (Membership Sales).
//   No chargeable card, and the member was sent an add-your-card link (they came over from another app — card details
//   can't be moved between apps) and has never had one here → the charge WAITS: nothing fails, the membership carries on,
//   managers are told once, and it's charged on the first daily run after they add their card.
//   Otherwise declined / no card → past_due; managers are told; the member gets their add-your-card link (through the
//   normal message rules — consent and quiet hours); after the grace period (default 5 days) it lapses.
//   A charge more than 35 days overdue is held, not taken — managers are asked to check it first.
import { nanoid } from 'nanoid';
import { hasRealCard } from '@/lib/card-on-file';
import { internalHeaders } from '@/lib/message-policy';

const GRACE_PERIOD_DAYS_DEFAULT = 5;

async function tellManagers(db: any, tenantId: string, type: string, message: string, link: string) {
  const admins = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get(); const now = new Date().toISOString(); const b = db.batch();
  admins.docs.forEach((d: any) => { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId: d.id, type, message, link, createdAt: now, read: false }); });
  await b.commit();
}

export async function runRenewals(db: any, tenantId: string, o: { dryRun?: boolean; appUrl?: string } = {}) {
  const dryRun = o.dryRun === true;
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const gracePeriodDays = Number(tenant.membershipGracePeriodDays) || GRACE_PERIOD_DAYS_DEFAULT;
  const appUrl = o.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
  const now = new Date();
  const snap = await db.collection(`tenants/${tenantId}/clients`).where('subscription.status', 'in', ['active', 'past_due']).get();
  let charged = 0, lapsed = 0, waiting = 0; const results: any[] = [];

  for (const clientDoc of snap.docs) {
    const client = clientDoc.data() as any; const sub = client.subscription;
    if (!sub?.membershipId || !sub?.nextBillingDate) continue;
    const nextBilling = new Date(sub.nextBillingDate);
    if (Number.isNaN(nextBilling.getTime()) || nextBilling.getTime() > now.getTime()) continue;

    if (sub.status === 'past_due') {
      const pastDueSince = sub.pastDueSince ? new Date(sub.pastDueSince) : nextBilling;
      const daysPastDue = (now.getTime() - pastDueSince.getTime()) / (24 * 3600 * 1000);
      if (daysPastDue > gracePeriodDays) {
        if (!dryRun) await clientDoc.ref.set({ activeMembershipId: null, subscription: { ...sub, status: 'canceled', canceledAt: now.toISOString() } }, { merge: true });
        lapsed += 1; results.push({ clientId: clientDoc.id, clientName: client.name, outcome: dryRun ? 'would_lapse' : 'lapsed', daysPastDue: Math.round(daysPastDue) }); continue;
      }
    }

    const membership: any = (await db.doc(`tenants/${tenantId}/memberships/${sub.membershipId}`).get()).data() || null;
    if (!membership) continue;
    const price = Number(membership.price) || 0;
    const cardExpDate = client.cardOnFile?.expMonth && client.cardOnFile?.expYear ? new Date(Number(client.cardOnFile.expYear), Number(client.cardOnFile.expMonth), 0) : null;
    const cardIsExpired = !!cardExpDate && cardExpDate < now;
    const hasUsableCard = !!((client.cardOnFile?.paymentMethodId || hasRealCard(client)) && (client.cardOnFile?.customerId || client.cardOnFile?.stripeCustomerId || client.stripeCustomerId) && !cardIsExpired);
    // Came over from another app and was asked to add a card here: the charge waits for it (see the top of this file).
    const waitsForCard = price > 0 && !hasUsableCard && !!client.cardLink?.sentAt && !client.cardOnFile?.paymentMethodId && sub.status !== 'past_due';

    // A charge long overdue (35+ days — e.g. data from before renewals ran on their own) is never taken by surprise:
    // it's held and managers are asked to check it. Clearing subscription.renewalHeld (or a new date) lets it run.
    const stale = price > 0 && now.getTime() - nextBilling.getTime() > 35 * 864e5 && sub.status !== 'past_due';
    if (stale) {
      if (!dryRun && !sub.renewalHeld) { await clientDoc.ref.set({ subscription: { ...sub, renewalHeld: now.toISOString() } }, { merge: true });
        await tellManagers(db, tenantId, 'membership_renewal_held', `${client.name || 'A member'}’s ${membership.name} renewal was due ${nextBilling.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — over a month ago — so it wasn’t charged. Check it and set their next charge date.`, `/clients/${clientDoc.id}`).catch(() => {}); }
      results.push({ clientId: clientDoc.id, clientName: client.name, outcome: dryRun ? 'would_hold_overdue' : 'held_overdue' }); continue;
    }
    if (dryRun) {
      results.push({ clientId: clientDoc.id, clientName: client.name, membershipName: membership.name, amount: price, hasUsableCard,
        outcome: price === 0 ? 'would_renew_free' : hasUsableCard ? 'would_charge' : waitsForCard ? 'would_wait_for_card' : 'would_mark_past_due', reason: price > 0 && !hasUsableCard ? 'no_usable_card_on_file' : undefined });
      continue;
    }
    if (waitsForCard) {
      if (!sub.waitingForCardSince) {
        await clientDoc.ref.set({ subscription: { ...sub, waitingForCardSince: now.toISOString() } }, { merge: true });
        await tellManagers(db, tenantId, 'membership_waiting_card', `${client.name || 'A member'}’s ${membership.name} charge ($${price.toFixed(2)}) is waiting for them to add a card — nothing failed. It’s charged once they do.`, '/import/cards').catch(() => {});
      }
      waiting += 1; results.push({ clientId: clientDoc.id, clientName: client.name, outcome: 'waiting_for_card' }); continue;
    }

    let chargeSucceeded = price === 0; let stripePaymentIntentId: string | undefined;
    if (price > 0 && hasUsableCard) {
      try {
        const url = `${appUrl}/api/stripe/charge-card`;
        const chargeRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(String(url)) },
          body: JSON.stringify({ tenantId, clientId: clientDoc.id, amountCents: Math.round(price * 100), description: `Membership renewal — ${membership.name}`, category: 'Membership Sales', reason: 'Scheduled membership renewal', mode: 'auto',
            // A failed RENEWAL is a billing arrears situation (they already have the membership), unlike enrollment's 'deposit'.
            kind: 'arrears_fee' }) });
        const chargeData = await chargeRes.json().catch(() => ({ ok: false }));
        if (chargeData.ok) { chargeSucceeded = true; stripePaymentIntentId = chargeData.paymentIntentId; }
      } catch { /* chargeSucceeded stays false */ }
    }

    if (chargeSucceeded) {
      const newNextBilling = new Date(nextBilling); newNextBilling.setMonth(newNextBilling.getMonth() + (membership.interval === 'yearly' ? 12 : 1));
      const batch = db.batch();
      batch.set(clientDoc.ref, { subscription: { ...sub, status: 'active', nextBillingDate: newNextBilling.toISOString(), perkUsage: {}, perkLastUsed: null, pastDueSince: null, waitingForCardSince: null },
        lifetimeValue: (Number(client.lifetimeValue) || 0) + price }, { merge: true });
      const txnRef = db.doc(`tenants/${tenantId}/transactions/${nanoid()}`);
      batch.set(txnRef, { id: txnRef.id, tenantId, date: now.toISOString(), description: `Membership renewal: ${membership.name}`, clientOrVendor: client.name || 'Client', clientId: clientDoc.id,
        type: 'income', context: 'Business', category: 'Membership Sales', amount: price, paymentMethod: 'Card on File (Stripe)', stripePaymentIntentId: stripePaymentIntentId || null, hasReceipt: true });
      await batch.commit();
      charged += 1; results.push({ clientId: clientDoc.id, clientName: client.name, outcome: 'charged' });
    } else {
      await clientDoc.ref.set({ subscription: { ...sub, status: 'past_due', pastDueSince: sub.status === 'past_due' ? sub.pastDueSince : now.toISOString() } }, { merge: true });
      if (sub.status !== 'past_due') {   // tell people once per missed charge, not every day of the grace period
        await tellManagers(db, tenantId, 'membership_payment_failed', `${client.name || 'A client'}'s membership renewal failed — $${price.toFixed(2)} for ${membership.name}`, `/clients/${clientDoc.id}`).catch(() => {});
        // The member gets their private add-your-card link, through the normal message rules (consent, quiet hours).
        try { const { sendCardLink } = await import('@/lib/card-save'); await sendCardLink(db, tenantId, clientDoc.id, appUrl, 'renewal'); } catch { /* managers were told; they can follow up */ }
      }
      results.push({ clientId: clientDoc.id, clientName: client.name, outcome: 'past_due' });
    }
  }
  return { dryRun, charged, lapsed, waiting, considered: snap.docs.length, results };
}
