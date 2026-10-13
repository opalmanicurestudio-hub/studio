// What talking practice can use right now: the AI client, real voices, and listening.
import { NextResponse } from 'next/server';
import { aiConfigured } from '@/lib/ai';
import { voicesConfigured } from '@/lib/practice/voice-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ok: true, ai: aiConfigured(), voices: voicesConfigured(), listen: voicesConfigured() });
}
