// /api/import/hello — the "we've moved" welcome page's data (lib/welcome). Public, by the client's own signed link.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { helloKey, helloView } from '@/lib/welcome';

export const dynamic = 'force-dynamic';
const okId = (x: any) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const t = q.get('tenantId'), c = q.get('clientId');
  const bad = NextResponse.json({ ok: false, error: 'This link isn’t valid.' }, { status: 404 });
  if (!okId(t) || !okId(c) || q.get('k') !== helloKey(t!, c!)) return bad;
  const v = await helloView(getAdminDb(), t!, c!); if (!v) return bad;
  return NextResponse.json({ ok: true, ...v }, { headers: { 'Cache-Control': 'no-store' } });
}
