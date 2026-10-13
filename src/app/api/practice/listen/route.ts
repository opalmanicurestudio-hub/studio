// Turns what you said into text. The recording is passed through and not kept.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, limitPlayer, voicesConfigured, transcribe } from '@/lib/practice/voice-server';
export const dynamic = 'force-dynamic';
const MAX = 2_000_000; // about a minute of speech
export async function POST(req: NextRequest) {
  const who = await requirePlayer(req); if (who instanceof NextResponse) return who;
  if (!voicesConfigured()) return NextResponse.json({ ok: false, error: 'Listening isn’t connected yet.' }, { status: 503 });
  const limited = await limitPlayer(who.uid, 'listen', 150, 800); if (limited) return limited;
  const form = await req.formData().catch(() => null); const audio = form?.get('audio');
  if (!audio || typeof audio === 'string') return NextResponse.json({ ok: false, error: 'No recording.' }, { status: 400 });
  if (audio.size > MAX) return NextResponse.json({ ok: false, error: 'That recording is too long. Keep it to a sentence or two.' }, { status: 413 });
  try { const name = String((audio as File).name || '').replace(/[^\w.]/g, '') || (audio.type.includes('wav') ? 'speech.wav' : 'speech.webm'); const text = await transcribe(audio, name); return NextResponse.json({ ok: true, text }); }
  catch { return NextResponse.json({ ok: false, error: 'Couldn’t hear that. Try again, a little closer to the mic.' }, { status: 502 }); }
}
