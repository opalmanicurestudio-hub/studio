// src/app/api/retail/secrets/route.ts — THE SHOP'S SHIPPO KEY AND WHOLESALE CODE (lib/retail-secrets). Managers only.
// GET ?tenantId= → what's set (the key is never sent back, only its last four); POST { tenantId, shippoApiKey?,
// wholesaleAccessCode? } saves them where no browser can read them.
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { getRetailSecrets, publicFlags, setRetailSecrets } from '@/lib/retail-secrets';

export const dynamic = 'force-dynamic';

async function guard(req: NextRequest, tenantId: string) {
  if (!tenantId) return { res: NextResponse.json({ error: 'Missing details.' }, { status: 400 }) };
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return { res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!auth.actor.isManager) return { res: NextResponse.json({ error: 'Only a manager can see or change these.' }, { status: 403 }) };
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const g = await guard(req, tenantId); if (g.res) return g.res;
  const s = await getRetailSecrets(getAdminDb(), tenantId);
  return NextResponse.json({ ok: true, ...publicFlags(s), wholesaleAccessCode: s.wholesaleAccessCode });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim();
  const g = await guard(req, tenantId); if (g.res) return g.res;
  const patch: any = {};
  if (typeof b.shippoApiKey === 'string') { const k = b.shippoApiKey.trim(); if (k && !/^shippo_(live|test)_[A-Za-z0-9]+$/.test(k)) return NextResponse.json({ error: 'That doesn’t look like a Shippo API key. It starts with shippo_live_ or shippo_test_.' }, { status: 400 }); patch.shippoApiKey = k; }
  if (typeof b.wholesaleAccessCode === 'string') patch.wholesaleAccessCode = b.wholesaleAccessCode.trim().slice(0, 40);
  const s = await setRetailSecrets(getAdminDb(), tenantId, patch);
  return NextResponse.json({ ok: true, ...publicFlags(s), wholesaleAccessCode: s.wholesaleAccessCode });
}
