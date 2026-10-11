// src/app/api/refund-payouts/public/route.ts — the client's refund page (/refund/{tenant}/{id}?k=). The signed link is
// the proof. GET → what the page shows. POST actions: choose · book · change · on_way · trip · stop_trip.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { publicView, clientAct } from '@/lib/refund-payouts';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const r: any = await publicView(getAdminDb(), String(q.get('tenantId') || ''), String(q.get('id') || ''), String(q.get('k') || ''));
  return NextResponse.json(r, { status: r.ok ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const r: any = await clientAct(getAdminDb(), String(b.tenantId || ''), String(b.id || ''), String(b.k || ''), b);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
