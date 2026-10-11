// /api/cron/voice-release — hourly. Runs the phone assistant's "release stale holds" job (/api/voice/release-stale)
// for every business with the phone assistant set up: a booking it held for a deposit that never came is let go once
// the business's hold window passes. That route was written to be called per business but nothing ever called it.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { recordCronRun } from '@/lib/cron-heartbeat';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const voiceSecret = process.env.VOICE_AGENT_SECRET; if (!voiceSecret) return NextResponse.json({ ok: true, skipped: 'phone assistant not configured' });
  void recordCronRun('voice-release');
  const db = getAdminDb(); let released = 0; const ran: string[] = [];
  for (const d of (await db.collection('tenants').get()).docs) {
    const t: any = d.data() || {}; if (!t.voiceAgent) continue;
    try { const r = await fetch(`${req.nextUrl.origin}/api/voice/release-stale`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-voice-secret': voiceSecret }, body: JSON.stringify({ tenantId: d.id }) }).then((x) => x.json()).catch(() => null);
      released += Number(r?.released) || 0; ran.push(d.id); } catch (e) { console.error('[cron voice-release]', d.id, e); }
  }
  return NextResponse.json({ ok: true, tenants: ran.length, released });
}
