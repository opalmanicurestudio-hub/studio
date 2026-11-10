'use client';
// src/lib/kitchen-client.ts — A SIGNED-IN TEAM MEMBER MOVING A TICKET: the front desk, the dashboard and the host stand
// take the very same server step as the kitchen screen (api/kitchen 'act'), under their own name. So a lounge order is
// handed over once, its stock taken once, its perk and visit counted once, however many screens it shows on.
import { getAuth } from 'firebase/auth';
import type { KitchenCol, KitchenStep } from '@/lib/kitchen';

export async function kitchenStep(tenantId: string, col: KitchenCol, id: string, step: KitchenStep): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  try {
    const tk = await getAuth().currentUser?.getIdToken();
    const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
      body: JSON.stringify({ action: 'act', tenantId, col, id, step }) });
    const d = await r.json().catch(() => ({}));
    return d.ok ? { ok: true, already: !!d.already } : { ok: false, error: d.error || 'That didn’t go through. Try again.' };
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}
