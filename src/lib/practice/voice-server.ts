// Practice a shift, talking out loud — server side. Only signed-in team members and students (not anonymous
// sign-ins) can use the AI client and the voices, with hourly and daily limits so costs stay predictable.
// Nothing said is stored: audio and text pass through and are discarded.
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAdminAuth } from '@/lib/firebase-admin';
import { bump } from '@/lib/rate-limit';

export const voicesConfigured = () => !!process.env.ELEVENLABS_API_KEY;
const XI = 'https://api.elevenlabs.io/v1';
const key = () => String(process.env.ELEVENLABS_API_KEY || '');

export async function requirePlayer(req: NextRequest): Promise<{ uid: string } | NextResponse> {
  const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ ok: false, error: 'Sign in to ClarityFlow to talk with clients.' }, { status: 401 });
  try {
    const t: any = await getAdminAuth().verifyIdToken(token);
    if (t?.firebase?.sign_in_provider === 'anonymous') return NextResponse.json({ ok: false, error: 'Sign in to ClarityFlow to talk with clients.' }, { status: 403 });
    return { uid: String(t.uid) };
  } catch { return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 }); }
}
/** Per person: so many per hour and per day. */
export async function limitPlayer(uid: string, scope: string, perHour: number, perDay: number): Promise<NextResponse | null> {
  try {
    const now = Date.now(); const h = createHash('sha256').update(uid).digest('hex').slice(0, 24);
    if (!(await bump(`practice_${scope}_${h}_h${Math.floor(now / 3600000)}`, perHour, 2 * 3600000))) return NextResponse.json({ ok: false, error: 'That’s a lot of practice this hour. Take a short break and try again.' }, { status: 429 });
    if (!(await bump(`practice_${scope}_${h}_d${Math.floor(now / 86400000)}`, perDay, 2 * 86400000))) return NextResponse.json({ ok: false, error: 'You’ve reached today’s talking practice limit. It resets tomorrow.' }, { status: 429 });
    return null;
  } catch { return null; }
}

export type Voice = { id: string; name: string; gender: string; age: string; accent: string; description: string };
let cache: { at: number; voices: Voice[] } | null = null;
export async function listVoices(): Promise<Voice[]> {
  if (cache && Date.now() - cache.at < 3600000) return cache.voices;
  const r = await fetch(`${XI}/voices`, { headers: { 'xi-api-key': key() } });
  if (!r.ok) throw new Error(`Voices error ${r.status}`);
  const d: any = await r.json();
  const voices: Voice[] = (d.voices || []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name || ''), gender: String(v.labels?.gender || ''), age: String(v.labels?.age || '').replace(/\s+/g, '_'), accent: String(v.labels?.accent || ''), description: String(v.labels?.description || v.description || '').slice(0, 80) }));
  cache = { at: Date.now(), voices }; return voices;
}
/** How a tone sounds: steadier when calm, more expressive when happy or upset. */
const SETTINGS: Record<string, { stability: number; style: number }> = {
  happy: { stability: 0.35, style: 0.45 }, warm: { stability: 0.5, style: 0.3 }, neutral: { stability: 0.6, style: 0.15 },
  unsure: { stability: 0.45, style: 0.25 }, annoyed: { stability: 0.4, style: 0.4 }, upset: { stability: 0.3, style: 0.55 },
};
export async function speak(text: string, voiceId: string, tone: string) {
  const s = SETTINGS[tone] || SETTINGS.neutral;
  // The streaming endpoint sends the first audio as soon as it's made, so the client starts talking sooner.
  return fetch(`${XI}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_64`, {
    method: 'POST', headers: { 'xi-api-key': key(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5', voice_settings: { stability: s.stability, similarity_boost: 0.8, style: s.style, use_speaker_boost: true } }),
  });
}
/** Newest listening model first; if the account doesn't have it, the previous one. */
const STT_MODELS = () => [...new Set([process.env.ELEVENLABS_STT_MODEL || 'scribe_v2', 'scribe_v1'])];
export async function transcribe(audio: Blob, filename: string) {
  let last = 'Listening error';
  for (const model of STT_MODELS()) {
    const f = new FormData(); f.append('file', audio, filename); f.append('model_id', model); f.append('language_code', 'en'); f.append('tag_audio_events', 'false');
    const r = await fetch(`${XI}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key() }, body: f });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok) return String(d.text || '').trim();
    last = String(d?.detail?.message || d?.detail || `Listening error ${r.status}`);
    if (r.status !== 400 && r.status !== 404 && r.status !== 422) break; // only an unknown model is worth a second try
  }
  throw new Error(last);
}
