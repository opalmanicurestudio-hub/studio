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

export type Voice = { id: string; name: string; gender: string; age: string; accent: string; description: string; useCase: string; preview: string | null };
let cache: { at: number; voices: Voice[] } | null = null;
export async function listVoices(): Promise<Voice[]> {
  if (cache && Date.now() - cache.at < 3600000) return cache.voices;
  const r = await fetch(`${XI}/voices`, { headers: { 'xi-api-key': key() } });
  if (!r.ok) throw explainVoiceError(r.status, await r.json().catch(() => ({})), 'list');
  const d: any = await r.json();
  const voices: Voice[] = (d.voices || []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name || ''), gender: String(v.labels?.gender || ''), age: String(v.labels?.age || '').replace(/\s+/g, '_'), accent: String(v.labels?.accent || ''), description: String(v.labels?.description || v.description || '').slice(0, 80), useCase: String(v.labels?.use_case || v.labels?.['use case'] || ''), preview: /^https:\/\//.test(String(v.preview_url || '')) ? String(v.preview_url) : null }));
  cache = { at: Date.now(), voices }; return voices;
}
/** How a tone sounds: steadier when calm, more expressive when happy or upset. */
const SETTINGS: Record<string, { stability: number; style: number }> = {
  happy: { stability: 0.35, style: 0.45 }, warm: { stability: 0.5, style: 0.3 }, neutral: { stability: 0.6, style: 0.15 },
  unsure: { stability: 0.45, style: 0.25 }, annoyed: { stability: 0.4, style: 0.4 }, upset: { stability: 0.3, style: 0.55 },
};
/** speed: 0.7 (slow, careful) to 1.2 (fast talker). format 'pcm' = raw 16 kHz audio for the live face. */
export async function speak(text: string, voiceId: string, tone: string, speed = 1, format: 'mp3' | 'pcm' = 'mp3') {
  const s = SETTINGS[tone] || SETTINGS.neutral; const sp = Math.max(0.7, Math.min(1.2, Number(speed) || 1));
  // The streaming endpoint sends the first audio as soon as it's made, so the client starts talking sooner.
  return fetch(`${XI}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${format === 'pcm' ? 'pcm_16000' : 'mp3_44100_64'}`, {
    method: 'POST', headers: { 'xi-api-key': key(), 'content-type': 'application/json', accept: format === 'pcm' ? 'audio/pcm' : 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5', voice_settings: { stability: s.stability, similarity_boost: 0.8, style: s.style, use_speaker_boost: true, ...(sp !== 1 ? { speed: sp } : {}) } }),
  });
}
/** Newest listening model first; if the account doesn't have it, the previous one. */
const STT_MODELS = () => [...new Set([process.env.ELEVENLABS_STT_MODEL || 'scribe_v2', 'scribe_v1'])];
export class VoiceError extends Error { constructor(public plain: string, public code: string) { super(plain); } }
/** Turn the voice service's answer into something the owner can act on (never includes the key). */
export function explainVoiceError(status: number, d: any, what: 'listening' | 'voices' | 'list'): VoiceError {
  const det = d?.detail; const code = String(det?.status || det?.code || d?.status || '').toLowerCase();
  const msg = String(typeof det === 'string' ? det : det?.message || d?.message || '').slice(0, 220);
  const feature = what === 'listening' ? 'Speech to Text' : what === 'list' ? 'Voices (Read)' : 'Text to Speech';
  if (status === 401 && /permission/.test(code + msg)) return new VoiceError(`Your voice key doesn’t allow ${feature}. In your voice account: Developers → API Keys → edit this key → set ${feature} to Access (and Voices to Read). No redeploy needed.`, 'missing_permission');
  if (status === 402 || /quota|credit|limit_reached|insufficient/.test(code + msg)) return new VoiceError('The voice account is out of credits, or this key hit its credit limit. Raise the key’s limit or top up the plan.', 'quota');
  if (status === 401) return new VoiceError('The voice key isn’t valid. Copy it again from your voice account into ELEVENLABS_API_KEY in Vercel, then redeploy.', 'invalid_key');
  if (status === 429) return new VoiceError('The voice service is busy right now. Wait a few seconds and try again.', 'busy');
  if (status === 422 || status === 400) return new VoiceError(`The voice service couldn’t use that recording (${msg || status}).`, 'bad_audio');
  return new VoiceError(`The voice service answered ${status}${msg ? `: ${msg}` : ''}.`, 'other');
}
export async function transcribe(audio: Blob, filename: string) {
  let last: VoiceError | null = null;
  for (const model of STT_MODELS()) {
    const f = new FormData(); f.append('file', audio, filename); f.append('model_id', model); f.append('language_code', 'en'); f.append('tag_audio_events', 'false');
    const r = await fetch(`${XI}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key() }, body: f });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok) return String(d.text || '').trim();
    last = explainVoiceError(r.status, d, 'listening');
    console.error('practice listen failed', { model, status: r.status, code: last.code, detail: JSON.stringify(d?.detail || d).slice(0, 300) });
    if (r.status !== 400 && r.status !== 404 && r.status !== 422) break; // only an unknown model is worth a second try
  }
  throw last || new VoiceError('Listening failed.', 'other');
}

// ── The live face (face-to-face mode) ───────────────────────────────────
export const facesConfigured = () => !!process.env.ANAM_API_KEY && !!(process.env.ANAM_AVATAR_ID || process.env.ANAM_AVATARS);
/** Which face each practice client gets: ANAM_AVATARS = {"rosa":"…","kim":"…"}; anyone else gets ANAM_AVATAR_ID. */
export function faceFor(character: string) {
  let map: Record<string, string> = {}; try { map = JSON.parse(process.env.ANAM_AVATARS || '{}'); } catch { /* bad JSON: use the default */ }
  const id = map[character] || map.default || process.env.ANAM_AVATAR_ID || '';
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : '';
}
/** A short-lived token for one face session. Capped at 10 minutes; the key stays on the server. */
export async function faceSession(avatarId: string) {
  const r = await fetch('https://api.anam.ai/v1/auth/session-token', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.ANAM_API_KEY}` },
    body: JSON.stringify({ personaConfig: { name: 'Practice client', avatarId, avatarModel: process.env.ANAM_AVATAR_MODEL || 'cara-4', enableAudioPassthrough: true, maxSessionLengthSeconds: 600, ...(process.env.ANAM_VOICE_ID ? { voiceId: process.env.ANAM_VOICE_ID } : {}) } }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (r.ok && d.sessionToken) return { ok: true as const, sessionToken: String(d.sessionToken) };
  const msg = String(d?.message || d?.error || d?.detail || '').slice(0, 200);
  console.error('practice face failed', { status: r.status, msg });
  const plain = r.status === 401 || r.status === 403 ? 'The live video key isn’t valid. Copy it again into ANAM_API_KEY in Vercel, then redeploy.'
    : r.status === 402 || /quota|credit|minutes|limit/i.test(msg) ? 'The live video account is out of minutes for this month. Upgrade the plan or wait for the reset.'
    : r.status === 429 ? 'Too many live video sessions at once for this plan. Close another one and try again.'
    : /avatar/i.test(msg) ? 'That face ID wasn’t found. Check ANAM_AVATAR_ID (or ANAM_AVATARS) in Vercel.'
    : `The live video service answered ${r.status}${msg ? `: ${msg}` : ''}.`;
  return { ok: false as const, error: plain };
}
