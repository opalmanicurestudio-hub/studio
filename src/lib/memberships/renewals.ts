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
// ONE CHARGE PER MEMBER PER BILLING PERIOD, however many runs see it: each period has its own record
// (membershipRenewals/{client}_{period}), claimed in one step before the card is charged, so two runs at once (the daily
// run and a manual one) charge once. The card is charged under a key named after the member, the plan, the period, the
// amount, the card and the try: a new try after a decline (the next day of the grace period) really tries the card
// again; a try Stripe didn't answer keeps its key, and the next run asks for that same charge (looking it up first when
// it's old enough that Stripe may have forgotten the key) instead of charging again. The period moves on only once.
// A declined renewal is NOT put on their balance as a debt: they stay past due and it's tried again the next day (the
// renewal is collected one way only, so paying on Thursday after Monday–Wednesday declines is one charge, and nothing
// is left owing). The money is recorded once, by the card charge itself (api/stripe/charge-card, Membership Sales).
import { hasRealCard } from '@/lib/card-on-file';
import { internalHeaders } from '@/lib/message-policy';

const GRACE_PERIOD_DAYS_DEFAULT = 5;
/** How long one run's claim on a renewal keeps another from charging it. */
const RENEW_CLAIM_MS = 2 * 60000;
/** An unanswered try older than this is looked up at Stripe before it's asked for again (Stripe keeps keys a day). */
const LOOK_UP_AFTER_MS = 20 * 3600000;
const safeId = (s: any, n = 60) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, n);

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
    // This period's renewal record (see the top of this file).
    const renRef = db.doc(`tenants/${tenantId}/membershipRenewals/${safeId(clientDoc.id)}_${safeId(sub.nextBillingDate, 40)}`);
    const ren: any = (await renRef.get()).data() || null;
    // A charge for this period that Stripe never answered may have gone through: it's settled before anything lapses.
    const unanswered = ren?.status === 'charging';

    if (sub.status === 'past_due' && !unanswered) {
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

    const nowIso = now.toISOString();
    let outcome: 'charged' | 'declined' | 'unconfirmed' | 'busy' = price === 0 ? 'charged' : 'declined'; let stripePaymentIntentId: string | null = null;
    if (price > 0 && (hasUsableCard || unanswered)) {
      // The claim: this period, this run. A try already charged is only recorded; a try still going (another run) is
      // left to it; a try Stripe never answered is asked for again under its own key (the same charge); otherwise a
      // new try, with a key of its own.
      const pm = safeId(client.cardOnFile?.paymentMethodId || 'card', 40);
      const claim: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(renRef)).data() || null; const c: any = (await tx.get(clientDoc.ref)).data() || {};
        if (cur?.status === 'charged') return { charged: true, pi: cur.pi || null };
        if (c.subscription?.nextBillingDate !== sub.nextBillingDate || !['active', 'past_due'].includes(String(c.subscription?.status || ''))) return { gone: true };
        const held = Date.parse(String(cur?.at || ''));
        if (cur?.status === 'charging' && Number.isFinite(held) && now.getTime() - held < RENEW_CLAIM_MS) return { busy: true };
        if (cur?.status === 'charging') {
          tx.set(renRef, { at: nowIso }, { merge: true });
          return { key: cur.key, cents: cur.cents, description: cur.description, lookUp: now.getTime() - (Date.parse(String(cur.firstAt || cur.at)) || 0) > LOOK_UP_AFTER_MS };
        }
        const tries = (Number(cur?.tries) || 0) + 1; const cents = Math.round(price * 100); const description = `Membership renewal — ${membership.name}`;
        const key = `renew_${safeId(clientDoc.id, 40)}_${safeId(sub.membershipId, 40)}_${safeId(sub.nextBillingDate, 30)}_${cents}_${pm}_${tries}`;
        tx.set(renRef, { id: renRef.id, tenantId, clientId: clientDoc.id, membershipId: sub.membershipId, period: sub.nextBillingDate, cents, description, key, tries, status: 'charging', at: nowIso, firstAt: nowIso }, { merge: true });
        return { key, cents, description, lookUp: false };
      });
      if (claim.gone) continue;
      if (claim.busy) { outcome = 'busy'; }
      else if (claim.charged) { outcome = 'charged'; stripePaymentIntentId = claim.pi; }
      else {
        let res: { status: number; data: any } | null = null;
        try {
          const url = `${appUrl}/api/stripe/charge-card`;
          const chargeRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(String(url)) },
            body: JSON.stringify({ tenantId, clientId: clientDoc.id, amountCents: claim.cents, description: claim.description, category: 'Membership Sales', reason: 'Scheduled membership renewal', mode: 'auto',
              // Not a debt when it's declined: they stay past due and it's tried again tomorrow (see the top of this file).
              kind: 'renewal', idempotencyKey: claim.key, ...(claim.lookUp ? { replay: true } : {}) }) });
          res = { status: chargeRes.status, data: await chargeRes.json().catch(() => null) };
        } catch { res = null; }
        const d: any = res?.data;
        if (res && res.status < 500 && d?.ok && d.paymentIntentId) { outcome = 'charged'; stripePaymentIntentId = String(d.paymentIntentId); }
        else if (res && res.status < 500 && d && d.ok === false && !d.unknown) outcome = 'declined';
        else outcome = 'unconfirmed';
        if (outcome === 'declined') await renRef.set({ status: 'declined', endedAt: nowIso, lastError: String(d?.declineCode || d?.code || d?.reason || 'declined').slice(0, 120) }, { merge: true });
      }
    }

    if (outcome === 'busy' || outcome === 'unconfirmed') {
      // Another run is charging it, or Stripe didn't answer: nothing changes now; the next run finishes it (the same charge).
      results.push({ clientId: clientDoc.id, clientName: client.name, outcome: outcome === 'busy' ? 'in_progress' : 'unconfirmed' }); continue;
    }
    if (outcome === 'charged') {
      // Moved on once: the period's record says it's charged, and the plan moves to its next date in the same step.
      const newNextBilling = new Date(nextBilling); newNextBilling.setMonth(newNextBilling.getMonth() + (membership.interval === 'yearly' ? 12 : 1));
      const freeLine = price === 0 ? db.doc(`tenants/${tenantId}/transactions/renewal_${safeId(clientDoc.id)}_${safeId(sub.nextBillingDate, 40)}`) : null;
      const moved = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(renRef)).data() || {}; const c: any = (await tx.get(clientDoc.ref)).data() || {};
        if (cur.recordedAt || c.subscription?.nextBillingDate !== sub.nextBillingDate) return false;
        tx.set(renRef, { id: renRef.id, tenantId, clientId: clientDoc.id, membershipId: sub.membershipId, period: sub.nextBillingDate, status: 'charged', pi: stripePaymentIntentId, recordedAt: nowIso }, { merge: true });
        tx.set(clientDoc.ref, { subscription: { ...c.subscription, status: 'active', nextBillingDate: newNextBilling.toISOString(), perkUsage: {}, perkLastUsed: null, pastDueSince: null, waitingForCardSince: null },
          lifetimeValue: (Number(c.lifetimeValue) || 0) + price }, { merge: true });
        // A free plan has no card charge to record it: its renewal is noted here, once.
        if (freeLine) tx.set(freeLine, { id: freeLine.id, tenantId, date: nowIso, description: `Membership renewal: ${membership.name}`, clientOrVendor: client.name || 'Client', clientId: clientDoc.id,
          type: 'income', context: 'Business', category: 'Membership Sales', amount: 0, paymentMethod: 'None (free plan)', hasReceipt: false });
        return true;
      });
      if (moved) charged += 1;
      results.push({ clientId: clientDoc.id, clientName: client.name, outcome: 'charged' });
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
