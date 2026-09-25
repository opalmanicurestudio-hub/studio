// src/app/api/account/activate/route.ts
//
// "Enter ClarityFlow" — marks a new business active. Account-status fields
// (subscriptionStatus, subscriptionTier, access locks, invite) can ONLY be
// changed by the server now (see firestore.rules), so billing can never be
// switched on from the browser. During early access, activation is free;
// when billing arrives this is where payment is confirmed first.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { toTenantModules, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';
import { billingSettings, syncSubscription } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  let uid = '';
  try { uid = (await getAdminAuth().verifyIdToken(token)).uid; } catch { return NextResponse.json({ ok: false, error: 'Sign in again.' }, { status: 401 }); }
  const b = await req.json().catch(() => ({}));
  const db = getAdminDb();
  const ref = db.doc(`tenants/${String(b.tenantId || '')}`);
  const t = ((await ref.get()).data() as any) || null;
  if (!t || t.userId !== uid) return NextResponse.json({ ok: false, error: 'That isn’t your business.' }, { status: 403 });
  // Once billing is on, only a paid subscription (via checkout) activates an account.
  const billing = await billingSettings();
  if (billing.enabled && t.subscriptionStatus !== 'active') return NextResponse.json({ ok: false, error: 'Start your subscription to enter ClarityFlow.', needsCheckout: true }, { status: 402 });
  const tools = (Array.isArray(b.tools) ? b.tools : []).map(String).filter((x: string) => TOOL_BY_ID[x as ToolId]) as ToolId[];
  const at = new Date().toISOString();
  await ref.set({
    modules: toTenantModules(tools),
    ...(t.subscriptionStatus !== 'active' ? { subscriptionStatus: 'active', subscriptionTier: 'early_access', activatedAt: at } : {}),
  }, { merge: true });
  // A paid account's subscription follows its tools (Stripe prorates the change).
  let synced: any = null;
  if (t.billing?.subscriptionId && process.env.STRIPE_SECRET_KEY) { try { synced = await syncSubscription(t.id || String(b.tenantId)); } catch (e: any) { synced = { error: String(e?.message || e).slice(0, 200) }; } }
  return NextResponse.json({ ok: true, synced });
}
