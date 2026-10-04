// src/app/api/account/autopay-invite/route.ts — TEXT / EMAIL SOMEONE THEIR AUTOPAY SETUP LINK (any staff, at the desk).
// { tenantId, kind: 'rent' | 'tuition', id: renterId | planId }. They save their own card and agree to autopay
// themselves (a recurring charge needs their consent). Never sent if it's already on.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { sendAutopayInvite } from '@/lib/account-receipts';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const kind = b.kind === 'tuition' ? 'tuition' : 'rent'; const id = String(b.id || '').slice(0, 120);
  if (!id) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  return NextResponse.json(await sendAutopayInvite(db, tenantId, tenant, kind, id));
}
