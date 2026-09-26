// src/lib/translate.ts
//
// TRANSLATION for students who speak another language.
//   translateTexts(tenantId, texts, lang) — one AI call for all the texts
//   that aren't cached yet; every result is saved in
//   tenants/{t}/translations/{sha(lang|text)} so the same lesson,
//   announcement or message is only ever translated once.
//
// Rules given to the model: keep names, numbers, prices, dates, product and
// brand names; keep professional terms accurate (add the English term in
// brackets the first time if unsure); plain, friendly language; never add
// or leave out meaning. Legal documents are shown translated only as a
// reading aid — what a student signs is always the original text.

import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { askClaude, aiConfigured, parseJson } from '@/lib/ai';

export const LANGUAGES: Record<string, { name: string; native: string }> = {
  en: { name: 'English', native: 'English' },
  es: { name: 'Spanish', native: 'Español' },
  vi: { name: 'Vietnamese', native: 'Tiếng Việt' },
  ko: { name: 'Korean', native: '한국어' },
  zh: { name: 'Chinese (Simplified)', native: '中文' },
  pt: { name: 'Portuguese', native: 'Português' },
  fr: { name: 'French', native: 'Français' },
  ht: { name: 'Haitian Creole', native: 'Kreyòl ayisyen' },
  ar: { name: 'Arabic', native: 'العربية' },
  ru: { name: 'Russian', native: 'Русский' },
};
const key = (lang: string, text: string) => createHash('sha256').update(`${lang}|${text}`).digest('hex').slice(0, 40);

export async function translateTexts(tenantId: string, texts: string[], lang: string): Promise<string[]> {
  if (!LANGUAGES[lang] || !texts.length) return texts;   // callers skip English → English
  const db = getAdminDb();
  const col = db.collection(`tenants/${tenantId}/translations`);
  const out: (string | null)[] = await Promise.all(texts.map(async (t) => {
    if (!String(t || '').trim()) return t;
    const d = await col.doc(key(lang, t)).get(); return d.exists ? String((d.data() as any).text) : null;
  }));
  const missing = texts.map((t, i) => ({ t, i })).filter((x) => out[x.i] == null);
  if (missing.length && aiConfigured()) {
    // Batch in chunks that fit comfortably in one reply.
    for (let start = 0; start < missing.length; ) {
      const chunk: typeof missing = []; let size = 0;
      while (start < missing.length && (chunk.length === 0 || size + missing[start].t.length < 6000) && chunk.length < 40) { chunk.push(missing[start]); size += missing[start].t.length; start++; }
      const r = await askClaude({ tier: 'fast', maxTokens: 4000, purpose: `translate-${lang}`, tenantId,
        system: `You translate a school's messages and lessons for a student into ${LANGUAGES[lang].name}. Translate faithfully — never add or leave out meaning. Keep names, numbers, prices, dates, product and brand names as they are. Keep professional beauty/wellness terms accurate; if a term has no common equivalent, keep the English term in brackets after it the first time. Keep line breaks and any "# " heading markers. Friendly, plain language. Reply with JSON only: {"t":["…", …]} in the same order.`,
        prompt: JSON.stringify({ texts: chunk.map((x) => x.t) }) });
      const j: any = r.ok ? parseJson(r.text) : null;
      const arr: string[] = Array.isArray(j?.t) ? j.t : [];
      for (let k = 0; k < chunk.length; k++) {
        const tr = typeof arr[k] === 'string' && arr[k].trim() ? arr[k] : null;
        if (tr) { out[chunk[k].i] = tr; await col.doc(key(lang, chunk[k].t)).set({ lang, text: tr, source: chunk[k].t.slice(0, 2000), at: new Date().toISOString() }); }
      }
    }
  }
  return out.map((x, i) => (x == null ? texts[i] : x));
}

/** Long text (a transcript): split on paragraphs, translate, rejoin. */
export async function translateLong(tenantId: string, text: string, lang: string, max = 20000): Promise<string> {
  const src = String(text || '').slice(0, max);
  const parts: string[] = []; let cur = '';
  for (const p of src.split(/\n{2,}/)) { if ((cur + '\n\n' + p).length > 1500 && cur) { parts.push(cur); cur = p; } else cur = cur ? `${cur}\n\n${p}` : p; }
  if (cur) parts.push(cur);
  return (await translateTexts(tenantId, parts, lang)).join('\n\n');
}
