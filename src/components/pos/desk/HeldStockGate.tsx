'use client';
// src/components/pos/desk/HeldStockGate.tsx — BEFORE THE PAYMENT: units held for paid online orders (lib/held-stock).
// When the sale would sell some of them, the desk sees which, and a manager's PIN lets it go ahead (an approval the
// server checks again when the sale is saved). A manager signed in goes ahead and is named on the sale.
import * as React from 'react';
import { approveWithPin } from '@/lib/approve-client';
import { heldLine, type HeldShort } from '@/lib/held-stock';

export function HeldStockGate({ tenantId, held, approval, onApproved, manager }: {
  tenantId: string; held: HeldShort[]; approval: { token: string; by: string } | null; manager: boolean;
  onApproved: (a: { token: string; by: string }) => void;
}) {
  const [pin, setPin] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  if (!held.length) return null;
  const approve = async () => {
    if (pin.length < 4) { setErr('Enter a manager’s four-digit PIN.'); return; }
    setBusy(true); setErr('');
    const r = await approveWithPin(tenantId, pin, { kind: 'held_stock', reason: held.map((h) => `${h.name} ×${h.want}`).join(', ').slice(0, 180), requireReason: false });
    setBusy(false); setPin('');
    if (!r.ok || !r.token || !r.approver) { setErr(r.error || 'That PIN wasn’t a manager’s.'); return; }
    onApproved({ token: r.token, by: r.approver.name });
  };
  return (
    <div role="status" className="space-y-2.5 rounded-2xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--warn) 10%, var(--card))' }}>
      <p className="text-[15px] font-semibold">Held for online orders</p>
      <ul className="space-y-1 text-[14px]">{held.map((h) => <li key={h.id}>{heldLine(h)}.</li>)}</ul>
      {approval
        ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Approved by {approval.by}. An online order may be short when it’s packed.</p>
        : manager
          ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Selling them leaves a paid online order short. You’re a manager, so it goes ahead in your name.</p>
          : <>
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Selling them leaves a paid online order short, so a manager approves it first.</p>
              <div className="flex gap-2">
                <input aria-label="Manager PIN, four digits" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Manager PIN" className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-[16px] tracking-[0.3em]" style={{ borderColor: 'var(--line)', background: 'var(--paper)', color: 'var(--ink)' }} />
                <button type="button" disabled={busy} onClick={() => void approve()} className="h-11 shrink-0 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>{busy ? 'Checking…' : 'Approve'}</button>
              </div>
              {err && <p role="alert" className="text-[13px]" style={{ color: 'var(--warn)' }}>{err}</p>}
            </>}
    </div>);
}
