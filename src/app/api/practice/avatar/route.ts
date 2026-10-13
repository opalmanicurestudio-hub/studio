// Face-to-face mode: a short-lived session for the live face of the client at the desk.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, limitPlayer, facesConfigured, faceFor, faceSession } from '@/lib/practice/voice-server';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const who = await requirePlayer(req); if (who instanceof NextResponse) return who;
  if (!facesConfigured()) return NextResponse.json({ ok: false, error: 'Live video isn’t connected yet.' }, { status: 503 });
  const limited = await limitPlayer(who.uid, 'face', 40, 160); if (limited) return limited;
  const body: any = await req.json().catch(() => ({}));
  const character = String(body?.character || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  const avatarId = faceFor(character); if (!avatarId) return NextResponse.json({ ok: false, error: 'No face is set up yet. Add ANAM_AVATAR_ID in Vercel.' }, { status: 503 });
  try { return NextResponse.json(await faceSession(avatarId)); }
  catch { return NextResponse.json({ ok: false, error: 'Couldn’t reach the live video service. Try again.' }, { status: 502 }); }
}
