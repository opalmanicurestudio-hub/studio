// The practice client answers what you said, in character, and the coach scores your line.
// Practice data only (made-up clients); nothing is stored.
import { NextRequest, NextResponse } from 'next/server';
import { askAI, aiConfigured } from '@/lib/ai';
import { requirePlayer, limitPlayer } from '@/lib/practice/voice-server';
import { sanitizeContext, talkPrompt, parseTalk, basicTalk, TALK_SYSTEM } from '@/lib/practice/talk';
export const dynamic = 'force-dynamic';
const OFFER_NAMES = { nailclub: 'Nail Club', hairclub: 'Silk Press Club', barber: 'Barber Club', facial5: 'Facial package', lash3: 'Lash lift package' };

export async function POST(req: NextRequest) {
  const who = await requirePlayer(req); if (who instanceof NextResponse) return who;
  const limited = await limitPlayer(who.uid, 'talk', 150, 800); if (limited) return limited;
  const body: any = await req.json().catch(() => ({}));
  const said = String(body?.said || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!said) return NextResponse.json({ ok: false, error: 'Say something first.' }, { status: 400 });
  const ctx = sanitizeContext(body?.context || {});
  if (!aiConfigured()) return NextResponse.json({ ok: true, ...basicTalk(ctx, said, OFFER_NAMES) });
  const r = await askAI({ system: TALK_SYSTEM, prompt: talkPrompt(ctx, said), tier: 'fast', maxTokens: 450, purpose: 'practice-talk', tenantId: null });
  const parsed = r.ok ? parseTalk(r.text) : null;
  if (!parsed) return NextResponse.json({ ok: true, ...basicTalk(ctx, said, OFFER_NAMES) });
  return NextResponse.json({ ok: true, ...parsed });
}
