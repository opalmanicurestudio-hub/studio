'use client';
// src/lib/pin-client.ts — ask the server whose PIN this is. Screens never compare PINs themselves.
export type PinStaff = { id: string; name: string; role: string; avatarUrl: string | null; isRenter: boolean };
export async function verifyPin(tenantId: string, pin: string, roles?: string[]): Promise<{ ok: true; staff: PinStaff } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/pin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, pin, ...(roles ? { roles } : {}) }) });
    const d = await r.json().catch(() => ({}));
    return d.ok ? { ok: true, staff: d.staff } : { ok: false, error: d.error || 'That PIN isn’t right.' };
  } catch { return { ok: false, error: 'No connection — try again.' }; }
}
export async function setPin(tenantId: string, staffId: string, pin: string, checkOnly = false): Promise<{ ok: boolean; error?: string }> {
  try {
    const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken();
    const r = await fetch('/api/pin/set', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, staffId, pin, checkOnly }) });
    return await r.json().catch(() => ({ ok: false, error: 'That didn’t save.' }));
  } catch { return { ok: false, error: 'No connection — try again.' }; }
}
