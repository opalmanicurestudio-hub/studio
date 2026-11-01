'use client';
// src/lib/wholesale-client.ts — WHOLESALE, ASKED OF THE SERVER (api/retail/wholesale). Every change to a buyer or an
// application goes through there; this only carries the request and the answer, in the same words the server gives.
import { staffAuthHeader } from './staff-fetch';

type Ans = { ok: boolean; message: string; [k: string]: any };
const OFFLINE = 'That didn’t reach the shop’s server. Check the connection and try again.';

export async function wholesale(tenantId: string, action: string, args: Record<string, any> = {}): Promise<Ans> {
  try {
    const r = await fetch('/api/retail/wholesale', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action, ...args }) });
    const j: any = await r.json().catch(() => null);
    if (j && typeof j === 'object') return { ...j, ok: r.ok && j.ok !== false, message: String(j.message || j.error || (r.ok ? '' : OFFLINE)) };
    return { ok: false, message: OFFLINE };
  } catch { return { ok: false, message: OFFLINE }; }
}

/** A file picked in the browser as a data URL, for a certificate's copy (a photo or a PDF, under 3 MB). */
export function fileAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    if (f.size > 3 * 1024 * 1024) { rej(new Error('Keep the copy under 3 MB.')); return; }
    const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('That file couldn’t be read.')); r.readAsDataURL(f);
  });
}
