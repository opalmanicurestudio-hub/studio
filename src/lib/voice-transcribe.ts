// src/lib/voice-transcribe.ts — WRITE OUT A VOICE NOTE ON THE SERVER. The phone's browser writes the words out only where
// it can (most iPhones and many Android browsers can't), so a voice note could arrive as a recording alone. Before the
// note is saved, the server listens to it: the words in the language spoken, which language it was, and — when it isn't
// English — an English version for the team. The recording is always kept, and if this can't run (no speech service
// configured, a format it can't read, a slow reply) the note is saved as it came.
// Uses the Gemini model through Genkit (src/ai/genkit.ts); needs GEMINI_API_KEY (or GOOGLE_API_KEY) on the server.

const LIMIT_BYTES = 3 * 1024 * 1024;
export const speechConfigured = () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY);

/** Only our own storage links are fetched. */
const ours = (url: string) => /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com|[a-z0-9-]+\.firebasestorage\.app)\//i.test(url);

export async function transcribeAudio(url: string, hintLang?: string | null): Promise<{ text: string; language: string | null; english: string | null } | null> {
  if (!speechConfigured() || !ours(url)) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length || buf.length > LIMIT_BYTES) return null;
    let mime = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('audio/')) mime = /\.mp4(\?|$)/.test(url) ? 'audio/mp4' : /\.ogg(\?|$)/.test(url) ? 'audio/ogg' : 'audio/webm';
    if (mime === 'audio/x-m4a') mime = 'audio/mp4';
    const { ai } = await import('@/ai/genkit');
    const res: any = await Promise.race([
      ai.generate({ prompt: [
        { media: { url: `data:${mime};base64,${buf.toString('base64')}`, contentType: mime } },
        { text: `Write out exactly what is said in this voice note, in the language it is spoken${hintLang ? ` (probably ${hintLang})` : ''}. Don't summarize, add or correct anything. Then, if it isn't English, translate it faithfully into English. Reply with JSON only: {"text":"…","language":"two-letter code","english":"… or null if already English"}. If nothing can be heard, reply {"text":"","language":null,"english":null}.` },
      ], config: { temperature: 0 } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 20000)),
    ]);
    const raw = String(res?.text || '').replace(/^```(json)?|```$/g, '').trim();
    const j: any = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const text = String(j?.text || '').trim().slice(0, 4000); if (!text) return null;
    const language = j?.language ? String(j.language).slice(0, 5).toLowerCase() : null;
    const english = language && language !== 'en' && j?.english ? String(j.english).trim().slice(0, 4000) : null;
    return { text, language, english };
  } catch { return null; } finally { clearTimeout(t); }
}

/** Fill in a voice note's words when the phone couldn't. Leaves a note that already has them alone. */
export async function withTranscript<V extends { url: string; transcript?: string | null; language?: string | null; translation?: string | null } | null>(voice: V, hintLang?: string | null): Promise<V> {
  if (!voice || !voice.url || (voice.transcript && String(voice.transcript).trim())) return voice;
  const got = await transcribeAudio(voice.url, hintLang); if (!got) return voice;
  return { ...voice, transcript: got.text, language: got.language || voice.language || null, translation: got.english || voice.translation || null, transcribedBy: 'server' } as V;
}
