// src/lib/count-client.ts — A STOCK COUNT FROM A SCREEN. Sends the number counted to /api/inventory/count, which sets
// the shelf to it and records the difference on the stock history as the person signed in (lib/stock-count).
import { staffAuthHeader } from '@/lib/staff-fetch';

export type CountReply = { ok: true; delta: number; totalStock: number; changed: boolean } | { ok: false; error: string };

export async function countStock(tenantId: string, productId: string, counted: number, open?: number): Promise<CountReply> {
  try {
    const r = await fetch('/api/inventory/count', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, productId, counted, ...(open !== undefined ? { open } : {}) }) });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return { ok: true, delta: Number(j.delta) || 0, totalStock: Number(j.totalStock) || 0, changed: j.changed !== false && (j.changed === true || Number(j.delta) !== 0) };
    return { ok: false, error: String(j.error || 'That didn’t save. Try again.') };
  } catch {
    return { ok: false, error: 'That didn’t save. Check the connection and try again.' };
  }
}

/** Log a use by hand (lib/log-use): the same stock step as checkout. */
export async function logUseOf(tenantId: string, productId: string, quantity: number, reason: string): Promise<{ ok: true; moved: number; shortfall: number; unit: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/inventory/use', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, productId, quantity, reason }) });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return { ok: true, moved: Number(j.moved) || 0, shortfall: Number(j.shortfall) || 0, unit: String(j.unit || '') };
    return { ok: false, error: String(j.error || 'That didn’t save. Try again.') };
  } catch {
    return { ok: false, error: 'That didn’t save. Check the connection and try again.' };
  }
}
