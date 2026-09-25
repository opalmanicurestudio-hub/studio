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
  const tools = (Array.isArray(b.tools) ? b.tools : []).map(String).filter((x: string) => TOOL_BY_ID[x as ToolId]) as ToolId[];
  const at = new Date().toISOString();
  await ref.set({
    modules: toTenantModules(tools),
    ...(t.subscriptionStatus !== 'active' ? { subscriptionStatus: 'active', subscriptionTier: 'early_access', activatedAt: at } : {}),
  }, { merge: true });
  return NextResponse.json({ ok: true });
}
