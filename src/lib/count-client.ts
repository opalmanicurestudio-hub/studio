// src/lib/count-client.ts — A STOCK COUNT FROM A SCREEN. Sends the number counted to /api/inventory/count, which sets
// the shelf to it and records the difference on the stock history as the person signed in (lib/stock-count).
import { staffAuthHeader } from '@/lib/staff-fetch';

export type CountReply = { ok: true; delta: number; totalStock: number } | { ok: false; error: string };

export async function countStock(tenantId: string, productId: string, counted: number): Promise<CountReply> {
  try {
    const r = await fetch('/api/inventory/count', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, productId, counted }) });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return { ok: true, delta: Number(j.delta) || 0, totalStock: Number(j.totalStock) || 0 };
    return { ok: false, error: String(j.error || 'That didn’t save. Try again.') };
  } catch {
    return { ok: false, error: 'That didn’t save. Check the connection and try again.' };
  }
}
