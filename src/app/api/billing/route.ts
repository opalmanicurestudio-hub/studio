// src/app/api/billing/route.ts
//
// A BUSINESS'S CLARITYFLOW SUBSCRIPTION — owners only.
//   status    { tenantId, tools? } → is billing on, the monthly quote for these
//             tools at this size, and the current subscription
//   checkout  { tenantId, tools }  → saves the tools, returns a Stripe Checkout link
//   portal    { tenantId }         → Stripe's billing portal (card, invoices, cancel)
//   sync      { tenantId }         → bring the subscription in line with tools/size

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { billingSettings, quoteFor, checkoutFor, portalFor, syncSubscription } from '@/lib/billing';
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
      return NextResponse.json({ ok: true, enabled: settings.enabled, freeUntil: settings.freeUntil, foundingPct: t.foundingMember === false ? 0 : settings.foundingPct, quote: q,
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
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
