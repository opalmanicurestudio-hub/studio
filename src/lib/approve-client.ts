'use client';
// src/lib/approve-client.ts — ask the SERVER to check a manager's PIN (the check can't be skipped on this device).
// Returns a single-use approval token tied to what it's for; the server refuses the action without it.
import { getAuth } from 'firebase/auth';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
export interface Approval { ok: boolean; error?: string; token?: string; approver?: { id: string; name: string; role: string } }
/** A manager's PIN, checked on the server. */
export const approveWithPin = (tenantId: string, pin: string, o: { kind: string; amount?: number | null; ref?: string | null; reason?: string | null; requireReason?: boolean }): Promise<Approval> =>
  post({ tenantId, action: 'verify', pin, ...o });
/** Ask the managers on their phones; watch approvals/{id} for the answer. */
export const askManagerPhone = (tenantId: string, o: { kind: string; amount?: number | null; ref?: string | null; reason?: string | null; summary?: string }) =>
  post({ tenantId, action: 'request', ...o });
