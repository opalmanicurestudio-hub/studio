// src/lib/codes-api.ts — A PRODUCT'S CODES, ASKED OF THE SERVER (/api/inventory/codes, lib/code-index), which keeps
// each code on one product and says which product has one already. For screens; lib/codes-client saves whole products.
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { CodePatch } from '@/lib/code-form';

export type CodesReply = { ok: true; message?: string; [k: string]: any } | { ok: false; error: string; clashes?: any[] };

export async function codesApi(body: Record<string, any>): Promise<CodesReply> {
  try {
    const r = await fetch('/api/inventory/codes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j.ok !== false) return { ...j, ok: true };
    return { ok: false, error: String(j.error || j.message || 'That didn’t save. Try again.'), clashes: j.clashes };
  } catch {
    return { ok: false, error: 'That didn’t save. Check the connection and try again.' };
  }
}

export const saveCodes = (tenantId: string, productId: string, codes: CodePatch) => codesApi({ action: 'set', tenantId, productId, codes });
export const learnProductCode = (tenantId: string, productId: string, code: string) => codesApi({ action: 'learn', tenantId, productId, code });
export const pairProductTag = (tenantId: string, productId: string, tag: string, remove = false) => codesApi({ action: 'tag', tenantId, productId, tag, remove });
export const keepCode = (tenantId: string, code: string, productId: string) => codesApi({ action: 'keep', tenantId, code, productId });
export const checkCodes = (tenantId: string) => codesApi({ action: 'check', tenantId });
export const reindexCodes = (tenantId: string, productIds: string[]) => codesApi({ action: 'reindex', tenantId, productIds });
