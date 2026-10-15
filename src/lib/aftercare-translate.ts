// src/lib/aftercare-translate.ts — A CLIENT'S AFTERCARE IN THEIR LANGUAGE. Server only. The aftercare page offers a few
// languages; the first time one is asked for, the document (or plain text) is translated once and kept per document
// version, so every later client reads the same wording.
//   tenants/{t}/aftercareTranslations/{docId|text}_{version}_{lang} = { title, sections | text, at }
import { createHash } from 'crypto';
import { okLanguage, CHAT_LANGUAGE_EN } from '@/lib/chat-languages';

export async function translatedAftercare(db: any, tenantId: string, care: { doc: any; text: string | null }, lang: string): Promise<{ doc: any; text: string | null } | null> {
  const to = okLanguage(lang); if (!to || to === 'en' || (!care.doc && !care.text)) return null;
  const base = care.doc ? `${String(care.doc.id || 'doc')}_${Number(care.doc.version || 1)}` : `text_${createHash('sha256').update(String(care.text)).digest('hex').slice(0, 16)}`;
  const ref = db.doc(`tenants/${tenantId}/aftercareTranslations/${base}_${to}`); const have: any = (await ref.get()).data();
  if (have) return care.doc ? { doc: { ...care.doc, title: have.title || care.doc.title, sections: have.sections || care.doc.sections }, text: null } : { doc: null, text: have.text || care.text };
  const { askAI, parseJson } = await import('@/lib/ai');
  const lng = CHAT_LANGUAGE_EN[to];
  if (care.text) {
    const r = await askAI({ tier: 'fast', purpose: 'aftercare-translate', tenantId, maxTokens: 1500, system: `Translate this aftercare note from a beauty or wellness business into ${lng}. Keep product names, numbers and times exactly. Plain, warm and clear. Reply with the translation only.`, prompt: String(care.text).slice(0, 4000) });
    if (!r.ok || !r.text) return null; await ref.set({ text: r.text.trim(), at: new Date().toISOString() }); return { doc: null, text: r.text.trim() };
  }
  const payload = JSON.stringify({ title: care.doc.title || '', sections: care.doc.sections || [] }).slice(0, 24000);
  const r = await askAI({ tier: 'fast', purpose: 'aftercare-translate', tenantId, maxTokens: 6000,
    system: `You translate a client aftercare document (JSON) into ${lng}. Return the SAME JSON with the same keys, ids, types, order, URLs and numbers; translate only human-readable text values (titles, headings, steps, items, notes, warnings, tips). Keep product names exactly. Reply with the JSON only.`, prompt: payload });
  const j: any = r.ok ? parseJson(r.text) : null; if (!j || !Array.isArray(j.sections)) return null;
  await ref.set({ title: String(j.title || ''), sections: j.sections, at: new Date().toISOString() });
  return { doc: { ...care.doc, title: j.title || care.doc.title, sections: j.sections }, text: null };
}
