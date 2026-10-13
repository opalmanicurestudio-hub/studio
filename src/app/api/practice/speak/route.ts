// The practice client's real voice. Returns spoken audio for one short line.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, limitPlayer, voicesConfigured, speak } from '@/lib/practice/voice-server';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const who = await requirePlayer(req); if (who instanceof NextResponse) return who;
  if (!voicesConfigured()) return NextResponse.json({ ok: false, error: 'Real voices aren’t connected yet.' }, { status: 503 });
  const limited = await limitPlayer(who.uid, 'speak', 150, 800); if (limited) return limited;
  const body: any = await req.json().catch(() => ({}));
  const text = String(body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  const voiceId = String(body?.voiceId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  if (!text || !voiceId) return NextResponse.json({ ok: false, error: 'Nothing to say.' }, { status: 400 });
  const r = await speak(text, voiceId, String(body?.tone || 'neutral'));
  if (!r.ok || !r.body) return NextResponse.json({ ok: false, error: 'The voice didn’t load. Try again.' }, { status: 502 });
  return new Response(r.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
}
