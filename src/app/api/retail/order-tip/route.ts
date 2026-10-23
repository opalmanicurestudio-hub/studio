// src/app/api/retail/order-tip/route.ts — SHARE AN ONLINE ORDER'S TIP WITH THE PEOPLE WHO FULFILLED IT (lib/order-tips).
// Called after an order is shipped or handed over; the five-minute job catches anything missed. Each tip is written
// once, however often this is asked. Staff only. POST { tenantId, orderId }
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { shareOrderTip } from '@/lib/order-tips';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!tenantId || !orderId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await shareOrderTip(getAdminDb(), tenantId, orderId);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    console.error('[order-tip]', tenantId, orderId, String(e?.message || e).slice(0, 160));
    return NextResponse.json({ ok: false, error: 'The tip will be shared shortly.' }, { status: 500 });
  }
}
