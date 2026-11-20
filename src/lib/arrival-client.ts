// src/lib/arrival-client.ts — the screens' way to api/arrival (lib/arrival-nudge): tell, again, reply. Never throws.
import { getAuth } from 'firebase/auth';

export async function arrivalCall(body: { tenantId: string; appointmentId: string; action: 'tell' | 'again' | 'reply'; via?: 'front desk' | 'planner'; reply?: string }): Promise<{ ok: boolean; error?: string; told?: boolean; why?: string; buzz?: string }> {
  try {
    const tk = (await getAuth().currentUser?.getIdToken().catch(() => '')) || '';
    const r = await fetch('/api/arrival', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through. Try again.' }));
  } catch { return { ok: false, error: 'That didn’t go through. Check the connection and try again.' }; }
}
