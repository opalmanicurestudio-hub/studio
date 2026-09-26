// src/lib/ai.ts
//
// CLAUDE, FOR HQ — one small helper for every AI feature, with its cost.
//
// Server only (ANTHROPIC_API_KEY never reaches a browser). Every call is
// logged to platformAiUsage with tokens and an estimated cost, tagged with
// the business it was for — which is how HQ shows AI cost per business.
//
//   Fast & cheap (sorting tickets):   claude-haiku-4-5-20251001
//   Careful (drafts, insights):       claude-sonnet-5
//   Interactives (animated HTML):     claude-opus-5-5 — Anthropic's most capable
// Change with AI_MODEL_FAST / AI_MODEL_SMART / AI_MODEL_INTERACTIVE. Prices are
// per million tokens and adjustable (AI_PRICE_*), since list prices change.

import { getAdminDb } from '@/lib/firebase-admin';

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;
export const MODELS = {
  fast: process.env.AI_MODEL_FAST || 'claude-haiku-4-5-20251001',
  smart: process.env.AI_MODEL_SMART || 'claude-sonnet-5',
  interactive: process.env.AI_MODEL_INTERACTIVE || 'claude-opus-5-5',
};
// USD per million tokens [input, output]. Sonnet defaults to the higher
// published rate so estimates never under-count.
function price(model: string): [number, number] {
  const n = (k: string, d: number) => Number(process.env[k]) || d;
  if (/haiku/i.test(model)) return [n('AI_PRICE_FAST_IN', 1), n('AI_PRICE_FAST_OUT', 5)];
  // Opus 5.5 list price (Sept 2026): $4 in / $20 out per million tokens.
  if (/opus/i.test(model)) return [n('AI_PRICE_OPUS_IN', 4), n('AI_PRICE_OPUS_OUT', 20)];
  return [n('AI_PRICE_SMART_IN', 3), n('AI_PRICE_SMART_OUT', 15)];
}

export interface AiResult { ok: boolean; text: string; costUsd: number; error?: string; stopReason?: string | null }

/** `pdfBase64` (optional): a PDF sent alongside the prompt — e.g. a school's curriculum. */
export async function askClaude(opts: { system: string; prompt: string; tier?: 'fast' | 'smart' | 'interactive'; maxTokens?: number; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; purpose: string; tenantId?: string | null; pdfBase64?: string | null }): Promise<AiResult> {
  if (!aiConfigured()) return { ok: false, text: '', costUsd: 0, error: 'AI isn’t connected — add ANTHROPIC_API_KEY in Vercel.' };
  const model = MODELS[opts.tier || 'fast'];
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': String(process.env.ANTHROPIC_API_KEY), 'anthropic-version': '2023-06-01' },
      // Effort guides how deeply Claude thinks (thinking tokens count toward max_tokens).
      body: JSON.stringify({ model, max_tokens: opts.maxTokens || 800, ...(opts.effort ? { output_config: { effort: opts.effort } } : {}), system: opts.system, messages: [{ role: 'user', content: opts.pdfBase64 ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.pdfBase64 } }, { type: 'text', text: opts.prompt }] : opts.prompt }] }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, text: '', costUsd: 0, error: String(d?.error?.message || `AI error ${r.status}`) };
    const text = (d.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    const [pin, pout] = price(model);
    const inT = Number(d.usage?.input_tokens) || 0, outT = Number(d.usage?.output_tokens) || 0;
    const costUsd = (inT * pin + outT * pout) / 1_000_000;
    try { await getAdminDb().collection('platformAiUsage').add({ at: new Date().toISOString(), model, purpose: opts.purpose, tenantId: opts.tenantId || null, inputTokens: inT, outputTokens: outT, costUsd }); } catch { /* never block */ }
    return { ok: true, text, costUsd, stopReason: d.stop_reason || null };
  } catch (e: any) {
    return { ok: false, text: '', costUsd: 0, error: String(e?.message || e) };
  }
}

/** Pull the first {...} JSON object out of a model reply. */
export function parseJson<T = any>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}
