// GET /api/calls/recording?tenantId=…&callId=… — a call recording, for signed-in staff only (lib/call-recordings).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { readRecording } from '@/lib/call-recordings';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || ''), callId = String(req.nextUrl.searchParams.get('callId') || '');
  if (!/^[\w-]{1,80}$/.test(tenantId) || !/^[\w-]{1,120}$/.test(callId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const r = await readRecording(getAdminDb(), tenantId, callId);
  if (!r) return NextResponse.json({ ok: false, error: 'No recording for this call.' }, { status: 404 });
  if (r.url) return NextResponse.json({ ok: true, url: r.url });
  return new NextResponse(new Uint8Array(r.buf!), { headers: { 'Content-Type': r.type || 'audio/wav', 'Cache-Control': 'private, no-store' } });
}
