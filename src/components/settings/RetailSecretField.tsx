'use client';
// src/components/settings/RetailSecretField.tsx — ONE OF THE SHOP'S SECRETS (the Shippo key or the wholesale house
// code), saved through the server so it never sits on the public business record (lib/retail-secrets).
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RetailSecretField({ tenantId, which, label, placeholder, className }: { tenantId: string; which: 'shippoApiKey' | 'wholesaleAccessCode'; label: string; placeholder: string; className?: string }) {
  const [state, setState] = React.useState<{ connected: boolean; last4: string; code: string } | null>(null);
  const [v, setV] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/retail/secrets?tenantId=${encodeURIComponent(tenantId)}`, { headers: await staffAuthHeader() });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setState({ connected: !!d.shippoConnected, last4: d.shippoKeyLast4 || '', code: d.wholesaleAccessCode || '' }); if (which === 'wholesaleAccessCode') setV(d.wholesaleAccessCode || ''); }
      else setMsg(d.error || '');
    } catch { /* stays empty */ }
  }, [tenantId, which]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);
  const save = async (value: string) => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/retail/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, [which]: value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || 'That didn’t save.'); return; }
      setState({ connected: !!d.shippoConnected, last4: d.shippoKeyLast4 || '', code: d.wholesaleAccessCode || '' });
      setMsg('Saved'); if (which === 'shippoApiKey') setV('');
    } finally { setBusy(false); }
  };
  const isKey = which === 'shippoApiKey';
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
      {isKey && state?.connected && <p className="text-[11px] font-bold">Connected, key ending {state.last4}. Paste a new key to replace it.</p>}
      <div className="flex gap-2">
        <Input type={isKey ? 'password' : 'text'} autoComplete="off" aria-label={label} placeholder={isKey && state?.connected ? '••••••••' : placeholder} value={v} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)} className={className} />
        <Button type="button" variant="outline" disabled={busy || (isKey ? !v.trim() : v.trim() === (state?.code || ''))} onClick={() => void save(v)} className="h-11 shrink-0 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">{busy ? 'Saving…' : 'Save'}</Button>
        {isKey && state?.connected && <Button type="button" variant="outline" disabled={busy} onClick={() => void save('')} className="h-11 shrink-0 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-destructive">Remove</Button>}
      </div>
      {msg && <p className="text-[11px] font-bold text-muted-foreground">{msg}</p>}
      <p className="text-[10px] font-bold text-muted-foreground">Stored privately on the server. It’s never shown again in full or sent to browsers.</p>
    </div>);
}
