'use client';
// src/components/orders/GoodwillSheet.tsx — STORE CREDIT FOR THE TROUBLE, FROM THE ORDER OR ITS PROBLEM. How much, and a
// note for the team; the server works out whether this person can give it (lib/goodwill-credit: managers any amount,
// anyone else up to the shop's limit on the order) and emails the customer their balance. Used from Problems and from
// the order's More.
import * as React from 'react';
import { giveCredit } from '@/lib/fulfil-client';
import { money } from '@/lib/orders-view';
import { Btn, C, Sheet, feel, muted } from './ui';

export function GoodwillSheet({ tenantId, order, ticketId, isManager, rs, onClose, onDone }: { tenantId: string; order: any; ticketId?: string; isManager: boolean; rs: any; onClose: () => void; onDone: (message: string, cents: number) => void }) {
  const [amount, setAmount] = React.useState(''); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  // One key for this sheet: a second tap, or a retry after an answer that was lost, gives it once.
  const key = React.useRef(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const first = String(order?.customerName || '').split(' ')[0] || 'them';
  const email = String(order?.customerEmail || '').trim();
  const cap = Math.max(0, Math.floor(Number(rs?.staffCreditCapCents ?? 2500) || 0));
  const left = isManager ? Infinity : Math.max(0, cap - Math.max(0, Number(order?.goodwillCents) || 0));
  const cents = Math.round((Number(amount) || 0) * 100);
  const over = cents > left;
  const picks = [500, 1000, 1500, 2500].filter((c) => c <= left);
  const give = async () => {
    if (cents < 1 || over || !email) return;
    setBusy(true); setErr('');
    try {
      const r = await giveCredit(tenantId, order.id, cents, { note: note.trim(), key: key.current, ticketId });
      feel(r.ok);
      if (!r.ok) { setErr(r.message); return; }
      onDone(r.message, Number(r.cents) || cents);
    } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Store credit for ${first}`} sub={email ? `Kept with ${email}, ready to use at checkout. They get an email with their balance.` : 'This order has no email, and store credit is kept by email. Add their email on the order first.'} onClose={onClose}>
      {email && <>
        {picks.length > 0 && <div role="group" aria-label="Amount" className="mt-2 flex flex-wrap gap-1.5">
          {picks.map((c) => <button key={c} type="button" aria-pressed={cents === c} onClick={() => setAmount((c / 100).toFixed(2))} className="cf-press h-11 rounded-full px-4 text-[15px] font-semibold" style={cents === c ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{money(c)}</button>)}
        </div>}
        <label className="mt-3 block text-[13px] font-semibold" style={muted}>Amount
          <span className="mt-1 flex h-12 items-center rounded-2xl border px-4" style={{ borderColor: over ? C.warn : C.line }}>
            <span className="text-[17px]" style={muted}>$</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} placeholder="0.00" className="h-full min-w-0 flex-1 bg-transparent pl-1 text-[17px] font-normal outline-none" style={{ color: C.ink }} />
          </span>
        </label>
        {!isManager && <p className="m-0 mt-1.5 text-[13px]" style={over ? { color: C.warn } : muted}>{cap <= 0 ? 'Only a manager can give store credit here.' : left > 0 ? `You can give up to ${money(left)} on this order. A manager can give more.` : `You’ve given the most you can on this order. A manager can give more.`}</p>}
        <label className="mt-3 block text-[13px] font-semibold" style={muted}>Why, for the team (optional)
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="For example: a week late" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
        </label>
        {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || cents < 1 || over} onClick={() => void give()}>{busy ? 'Giving…' : cents >= 1 ? `Give ${money(cents)} store credit` : 'Give store credit'}</Btn>
      </>}
    </Sheet>);
}
