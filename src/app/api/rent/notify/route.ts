// src/app/api/rent/notify/route.ts — TELL A RENTER ABOUT A CHANGE MADE TO THEIR ACCOUNT BY HAND (lib/renter-account-notice).
// Called by the Rent page after it adds a charge, waives a fee, a bill or a charge, or approves banked days as credit.
// The notice is written from the record on the server, once per change.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { noticeAccountChange, ACCOUNT_CHANGES, type AccountChange } from '@/lib/renter-account-notice';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 120);
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const kind = String(b.kind || '') as AccountChange;
  if (!ACCOUNT_CHANGES.includes(kind)) return NextResponse.json({ ok: false, error: 'Unknown change.' }, { status: 400 });
  const db = getAdminDb();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const r = await noticeAccountChange(db, tenantId, tenant, kind, String(b.id || ''));
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
