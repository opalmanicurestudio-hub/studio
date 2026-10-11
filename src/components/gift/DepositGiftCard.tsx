'use client';
// src/components/gift/DepositGiftCard.tsx — "PAYING WITH A GIFT CARD?" on the booking page's deposit step
// (/api/gift-cards/shop action 'deposit'). A card that covers the deposit pays it and confirms the booking; one with less
// is kept for the visit (they pay the deposit by card and the desk takes the gift card at checkout).
import * as React from 'react';

export function DepositGiftCard({ tenantId, appointmentId, onPaid, studio = false }: { tenantId: string; appointmentId: string; onPaid: () => void; studio?: boolean }) {
  const [open, setOpen] = React.useState(false); const [code, setCode] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const pay = async () => { setBusy(true); setErr('');
    const r = await fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deposit', tenantId, appointmentId, code }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
    setBusy(false); if (r.ok) onPaid(); else setErr(r.error || 'That didn’t work.'); };
  const box = studio ? 'rounded-2xl border border-stone-200 bg-white p-4' : 'rounded-2xl border-2 bg-white p-4';
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={studio ? 'mb-3 text-[14px] font-medium underline underline-offset-4' : 'mb-3 text-[11px] font-black uppercase tracking-widest underline underline-offset-4'}>Paying with a gift card?</button>;
  return (
    <div className={`${box} mb-3 space-y-2`}>
      <p className={studio ? 'text-[15px] font-semibold' : 'text-[11px] font-black uppercase tracking-widest'}>Pay the deposit with a gift card</p>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) pay(); }} placeholder="Gift card code" aria-label="Gift card code" autoCapitalize="characters"
          className="h-12 min-w-0 flex-1 rounded-xl border px-3 font-mono text-[16px] tracking-widest outline-none focus:ring-2 focus:ring-black/10" style={{ borderColor: '#e7e2dc' }} />
        <button type="button" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 4} onClick={pay} className="h-12 shrink-0 rounded-xl px-4 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: 'var(--accent, #1c1917)' }}>{busy ? '…' : 'Use it'}</button>
      </div>
      {err ? <p className="text-[13.5px] font-semibold" style={{ color: '#b42318' }} role="alert">{err}</p>
        : <p className="text-[12.5px] text-stone-500">The deposit comes off your card now; the rest of the gift card can be used at your visit.</p>}
    </div>);
}
