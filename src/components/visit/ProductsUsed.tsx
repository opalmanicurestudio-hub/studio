'use client';
// src/components/visit/ProductsUsed.tsx — "PRODUCTS USED" on a finished visit (O8).
// Shows what came off stock for this visit; the provider can correct the amounts (only the difference moves), and
// mark a bottle finished ("opened a new one") — which records the container's actual yield.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

async function api(body: any) { const tk = await getAuth().currentUser?.getIdToken();
  const r = await fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'That didn’t work.' })); }

export function ProductsUsed({ tenantId, visitId, className, style }: { tenantId: string; visitId: string; className?: string; style?: React.CSSProperties }) {
  const [u, setU] = React.useState<any>(undefined); const [edit, setEdit] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<string | null>(null);
  const load = React.useCallback(async () => { const r = await api({ action: 'get', tenantId, visitId }); setU(r.ok ? r.usage : null); }, [tenantId, visitId]);
  React.useEffect(() => { load(); }, [load]);
  if (u === undefined) return null;
  if (!u?.lines?.length) return null;   // nothing recorded (no products on the service, or not checked out yet)
  const changed = Object.keys(edit).some((k) => { const l = u.lines.find((x: any) => x.productId === k); return l && edit[k] !== '' && Number(edit[k]) !== Number(l.actual ?? l.expected); });
  const save = async () => { setBusy(true); setMsg(null); const actual: Record<string, number> = {}; for (const [k, v] of Object.entries(edit)) if (v !== '') actual[k] = Number(v);
    const r = await api({ action: 'adjust', tenantId, visitId, actual }); setBusy(false); if (r.ok) { setEdit({}); setMsg('Saved — stock updated.'); load(); } else setMsg(r.error || 'That didn’t save.'); };
  const finished = async (l: any) => { if (!window.confirm(`Finished the ${l.name} and opened a new one?`)) return; setBusy(true); setMsg(null);
    const r = await api({ action: 'container-finished', tenantId, productId: l.productId }); setBusy(false);
    setMsg(r.ok ? (r.lost > 0 ? `Recorded — it ran out ${r.lost} ${r.unit} early (${r.lostPct}%).${r.newOpened ? ' New one opened.' : ' No sealed ones left — reorder.'}` : `Recorded — right on expected yield.${r.newOpened ? ' New one opened.' : ''}`) : r.error || 'That didn’t work.'); };
  return (
    <section aria-label="Products used" className={`space-y-2 ${className || ''}`} style={style}>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>Products used</p>
      {u.lines.map((l: any) => (
        <div key={l.productId} className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5">
          <div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{l.name}</p>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Expected {l.expected} {l.unit}{l.actual !== undefined && l.actual !== l.expected ? ` · actual ${l.actual}` : ''}{l.shortfall ? ` · stock ran short by ${l.shortfall}` : ''}</p></div>
          <input inputMode="decimal" value={edit[l.productId] ?? ''} onChange={(e) => setEdit({ ...edit, [l.productId]: e.target.value.replace(/[^0-9.]/g, '').slice(0, 8) })} placeholder={String(l.actual ?? l.expected)} className="h-9 w-20 rounded-lg border px-2 text-center text-[14px]" aria-label={`Actual ${l.name}`} />
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{l.unit}</span>
          <button type="button" disabled={busy} onClick={() => finished(l)} className="h-9 rounded-full border px-3 text-[12px]">Bottle finished</button>
        </div>))}
      {changed && <button type="button" disabled={busy} onClick={save} className="h-10 rounded-full bg-stone-900 px-4 text-[13px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save actual amounts'}</button>}
      {msg && <p role="status" className="text-[13px]">{msg}</p>}
    </section>
  );
}
