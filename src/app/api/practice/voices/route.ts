// The voices available for practice clients (from the business's voice account).
import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, voicesConfigured, listVoices } from '@/lib/practice/voice-server';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const who = await requirePlayer(req); if (who instanceof NextResponse) return who;
  if (!voicesConfigured()) return NextResponse.json({ ok: false, error: 'Real voices aren’t connected yet.' }, { status: 503 });
  try { return NextResponse.json({ ok: true, voices: await listVoices() }); }
  catch { return NextResponse.json({ ok: false, error: 'Couldn’t load the voices. Try again in a moment.' }, { status: 502 }); }
}
