'use client';
// src/lib/tenant-private-client.ts — the team's side of the business's private details (lib/tenant-private): read and
// saved through /api/tenant-private, never written onto the public business record.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';

export type PrivateValues = { ownerPhone: string; curbsideAlertPhone: string; shipFrom: Record<string, string>; wifiNetwork: string; wifiPassword: string };

async function call(tenantId: string, body: any): Promise<{ ok: boolean; values?: PrivateValues; error?: string }> {
  try {
    const r = await fetch('/api/tenant-private', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
    return (await r.json().catch(() => null)) || { ok: false, error: 'That didn’t save. Please try again.' };
  } catch { return { ok: false, error: 'Check your connection and try again.' }; }
}

/** The private details for one business: `values` is null until loaded; `save` sends only what changed. */
export function usePrivateSettings(tenantId: string | null | undefined) {
  const [values, setValues] = React.useState<PrivateValues | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let live = true; setValues(null); setError('');
    if (!tenantId) return;
    call(tenantId, { action: 'get' }).then((d) => { if (!live) return; if (d.ok && d.values) setValues(d.values); else setError(d.error || 'These details didn’t load.'); });
    return () => { live = false; };
  }, [tenantId]);
  const save = React.useCallback(async (patch: Partial<PrivateValues>) => {
    if (!tenantId) return false;
    const d = await call(tenantId, { action: 'set', values: patch });
    if (d.ok && d.values) { setValues(d.values); setError(''); return true; }
    setError(d.error || 'That didn’t save. Please try again.'); return false;
  }, [tenantId]);
  return { values, error, save };
}
