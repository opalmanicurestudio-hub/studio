// src/app/api/billing/route.ts
//
// A BUSINESS'S CLARITYFLOW SUBSCRIPTION — owners only.
//   status    { tenantId, tools? } → is billing on, the monthly quote for these
//             tools at this size, and the current subscription
//   checkout  { tenantId, tools }  → saves the tools, returns a Stripe Checkout link
//   portal    { tenantId }         → Stripe's billing portal (card, invoices, cancel)
//   sync      { tenantId }         → bring the subscription in line with tools/size
//   addon     { tenantId, addon, on } → switch a paid add-on (lib/addons) on or off; the subscription follows

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { billingSettings, quoteFor, checkoutFor, portalFor, syncSubscription, textsUsed, monthRange, missingPrices } from '@/lib/billing';
import { toTenantModules, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only the owner can manage billing.' }, { status: 403 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Billing isn’t configured.' }, { status: 500 });
  const db = getAdminDb();
  const tools = Array.isArray(b.tools) ? (b.tools.map(String).filter((x: string) => TOOL_BY_ID[x as ToolId]) as ToolId[]) : undefined;
  const origin = linkOrigin(auth.tenant, req.nextUrl.origin);
  try {
    if (b.action === 'status') {
      const [settings, q] = await Promise.all([billingSettings(), quoteFor(tenantId, tools)]);
      const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const now = new Date(); const { from, to } = monthRange(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
      const textsThisMonth = await textsUsed(tenantId, from, to).catch(() => 0);
      return NextResponse.json({ ok: true, enabled: settings.enabled, textsThisMonth, freeUntil: settings.freeUntil, foundingPct: t.foundingMember === false ? 0 : settings.foundingPct, quote: q,
        subscription: t.billing?.subscriptionId ? { status: t.billing.status || null, currentPeriodEnd: t.billing.currentPeriodEnd || null, cancelAtPeriodEnd: !!t.billing.cancelAtPeriodEnd } : null });
    }
    if (b.action === 'checkout') {
      if (!tools) return NextResponse.json({ ok: false, error: 'Choose your tools first.' }, { status: 400 });
      await db.doc(`tenants/${tenantId}`).set({ modules: toTenantModules(tools) }, { merge: true });
      let email: string | null = null; try { email = (await getAdminAuth().getUser(auth.actor.uid)).email || null; } catch { /* none */ }
      const url = await checkoutFor({ tenantId, email, origin, tools });
      return NextResponse.json({ ok: true, url });
    }
    if (b.action === 'portal') return NextResponse.json({ ok: true, url: await portalFor(tenantId, origin) });
    if (b.action === 'sync') return NextResponse.json({ ok: true, ...(await syncSubscription(tenantId)) });
    if (b.action === 'addon') {
      const { isAddonId, addonActive, ADDONS } = await import('@/lib/addons');
      const { ADDON_PRICES } = await import('@/lib/billing-plans');
      const id = String(b.addon || '');
      if (!isAddonId(id) || typeof b.on !== 'boolean') return NextResponse.json({ ok: false, error: 'Missing add-on.' }, { status: 400 });
      const name = ADDONS[id].name;
      const ref = db.doc(`tenants/${tenantId}`);
      const t0: any = (await ref.get()).data() || {};
      const settings = await billingSettings();
      const subscribed = !!t0.billing?.subscriptionId && !['canceled', 'incomplete_expired'].includes(String(t0.billing?.status || ''));
      // Once plans are live, an add-on is bought on top of a subscription, never on its own; and only when its price is
      // set up, so the flag and the invoice never disagree.
      if (b.on && settings.enabled && !subscribed) return NextResponse.json({ ok: false, error: `Start your subscription in Your ClarityFlow first, then add ${name}.` }, { status: 409 });
      if (b.on && subscribed && (await missingPrices([ADDON_PRICES[id].key])).length) {
        console.error('[billing] add-on price missing in Stripe', ADDON_PRICES[id].key);
        return NextResponse.json({ ok: false, error: `${name} can’t be added just yet. Nothing was charged. Try again later.` }, { status: 409 });
      }
      const at = new Date().toISOString();
      const entry = b.on ? { active: true, since: at } : { active: false, endedAt: at };
      // The whole entry is replaced (no stale dates). Who changed it is kept privately, not on the public business record.
      const { prev, changed } = await db.runTransaction(async (tx: any) => {
        const t: any = (await tx.get(ref)).data() || {};
        const before = t.addons?.[id] ?? null;
        const move = addonActive(t, id) !== b.on;
        if (move) tx.update(ref, { [`addons.${id}`]: entry });
        return { prev: before, changed: move };
      });
      // The subscription follows every time (prorated), so asking again repairs one that didn't follow. If billing
      // fails, this change is undone (only if nothing has changed the entry since), and the owner is told.
      let billed = false;
      if (subscribed) {
        let r: any = null;
        try { r = await syncSubscription(tenantId); }
        catch (e: any) {
          console.error('[billing] add-on sync', String(e?.message || e).slice(0, 200));
          let undone = !changed;
          if (changed) {
            try {
              undone = await db.runTransaction(async (tx: any) => {
                const cur = ((await tx.get(ref)).data() as any)?.addons?.[id];
                if (JSON.stringify(cur ?? null) !== JSON.stringify(entry)) return false;   // someone changed it since: leave theirs
                tx.update(ref, { [`addons.${id}`]: prev ?? { active: false, endedAt: at } });
                return true;
              });
            } catch (err: any) { console.error('[billing] add-on undo FAILED', tenantId, id, String(err?.message || err).slice(0, 200)); }
            // One more try to bring the subscription in line with the flag as it now stands (best effort).
            if (undone) { try { await syncSubscription(tenantId); } catch { /* the next change or sync heals it */ } }
          }
          return NextResponse.json({ ok: false, error: undone ? 'Billing didn’t go through, so nothing changed. Try again.' : 'Billing didn’t answer, and the change may not have been undone. Check Your ClarityFlow, then try again.' }, { status: 502 });
        }
        // Billed means the subscription now carries it (or no longer does): the sync went through and the plan's quote
        // agrees, which it doesn't while the add-on's tool is off.
        const { billedAddons } = await import('@/lib/addons');
        const tNow: any = (await ref.get()).data() || {};
        const onPlan = billedAddons(tNow).includes(id);
        billed = (r?.changed === true || r?.reason === 'already matches') && onPlan === b.on;
        if (!billed) console.error('[billing] add-on and subscription disagree', tenantId, id, r?.reason, onPlan);
      }
      // Kept once the change stands, and only when something changed.
      if (changed) {
        try {
          const pref = db.doc(`tenants/${tenantId}/private/addons`);
          const log = (((await pref.get()).data() as any)?.log || []).slice(-49);
          await pref.set({ log: [...log, { id, on: b.on, at, by: String(auth.actor.name || 'The owner').slice(0, 60), byUid: auth.actor.uid }] }, { merge: true });
        } catch { /* the record of who is best effort */ }
      }
      return NextResponse.json({ ok: true, on: b.on, billed,
        message: b.on ? `${name} is on.${billed ? ' It’s on your next invoice, prorated.' : subscribed ? '' : ' It joins your plan when billing starts.'}`
          : `${name} is off.${billed && changed ? ' It comes off your plan, prorated.' : ''} Downloads keep working with Standard protection.` });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
