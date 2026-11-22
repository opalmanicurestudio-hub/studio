'use client';
// src/components/pos/CounterMoney.tsx — A TIP AND A DISCOUNT ON THE ORDER BEING PAID (design board "Money at the counter";
// lib/counter-money). TipAsk is turned to the guest: the business's three percents of what the order comes to, another
// amount, or no tip. DiscountPick: the business's own list, which anyone can use, or another amount, which a manager okays
// (the screen asks for their PIN when the person working isn't one). GiftAsk: a gift card or store credit. SplitAsk: the
// bill split evenly or by amount, one part at a time. White surfaces are set inline, so the app's black look
// (lib/app-theme) takes them over.
import { useState } from 'react';
import { discountWords, nextShare, tipChoices, SPLIT_WAYS_MAX, type Discount } from '@/lib/counter-money';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const dark = { background: INK, color: '#fff' } as const;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const usd = (cents: number) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
const field = `mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal tabular-nums outline-none focus:border-[#16171a]`;

/** "Add a tip?" for the guest: `baseCents` is what the order comes to before any tip. */
export function TipAsk({ baseCents, tipCents, pcts, busy, onPick, onClose }: { baseCents: number; tipCents: number; pcts: number[]; busy: boolean; onPick: (cents: number) => void; onClose: () => void }) {
  const choices = tipChoices(baseCents, pcts);
  const [other, setOther] = useState<string | null>(null);
  const typed = other !== null && other !== '' ? Math.round(Number(other) * 100) : null;
  const okTyped = typed !== null && Number.isFinite(typed) && typed >= 0;
  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: SOFT }} role="group" aria-label="Add a tip">
      <div className="flex items-baseline justify-between gap-2"><p className="text-[19px] font-semibold">Add a tip?</p><span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(baseCents)}</span></div>
      {other === null ? <>
        <div className="grid grid-cols-3 gap-2">{choices.map((c) => { const on = tipCents === c.cents && c.cents > 0; return (
          <button key={c.pct} type="button" aria-pressed={on} disabled={busy} onClick={() => onPick(c.cents)} className={`flex min-h-[64px] flex-col items-center justify-center rounded-xl text-[17px] font-semibold disabled:opacity-40 ${RING}`} style={on ? dark : quiet}>
            {c.pct}%<span className="text-[12.5px] font-medium" style={{ color: on ? '#c9cacd' : MUTED }}>{usd(c.cents)}</span></button>); })}</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => setOther(tipCents ? (tipCents / 100).toFixed(2) : '')} className={btn} style={quiet}>Other amount</button>
          <button type="button" disabled={busy} onClick={() => onPick(0)} aria-pressed={tipCents === 0} className={btn} style={quiet}>No tip</button>
        </div>
      </> : <div className="space-y-2">
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Tip
          <input autoFocus inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} onKeyDown={(e) => { if (e.key === 'Enter' && okTyped) onPick(typed!); }} placeholder="0.00" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        <div className="flex gap-2"><button type="button" onClick={() => setOther(null)} className={`${btn} flex-1`} style={quiet}>Back</button>
          <button type="button" disabled={busy || !okTyped} onClick={() => onPick(typed!)} className={`${btn} flex-[2]`} style={dark}>Add {okTyped ? usd(typed!) : 'the tip'}</button></div>
      </div>}
      <button type="button" onClick={onClose} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Done</button>
    </div>
  );
}

export type CustomDiscount = { kind: 'pct' | 'off'; value: number; reason: string };

/** The business's discounts, or another amount (a manager's). `current`: the one on the order now. */
export function DiscountPick({ list, current, busy, onPick, onCustom, onClose }: { list: Discount[]; current: string | null; busy: boolean; onPick: (id: string | null) => void; onCustom: (d: CustomDiscount) => void; onClose: () => void }) {
  const [other, setOther] = useState(false);
  const [kind, setKind] = useState<'pct' | 'off'>('pct'); const [value, setValue] = useState(''); const [reason, setReason] = useState('');
  const v = kind === 'pct' ? Math.round(Number(value)) : Math.round(Number(value) * 100);
  const okV = value !== '' && Number.isFinite(v) && (kind === 'pct' ? v >= 1 && v <= 100 : v >= 1 && v <= 50000);
  const seg = (on: boolean) => (on ? dark : quiet);
  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: SOFT }} role="group" aria-label="Discount">
      <p className="text-[17px] font-semibold">Discount</p>
      {!other ? <>
        {list.length > 0 ? <div className="grid grid-cols-2 gap-2">{list.map((d) => { const on = current === d.id; return (
          <button key={d.id} type="button" aria-pressed={on} disabled={busy} onClick={() => onPick(on ? null : d.id)} className={`${btn} px-3 text-[14px]`} style={seg(on)}>{d.label}, {discountWords(d)}</button>); })}</div>
          : <p className="text-[13.5px]" style={{ color: MUTED }}>No discounts are set up yet. A manager adds them under Menu.</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => setOther(true)} className={btn} style={quiet}>Other amount</button>
          {current && <button type="button" disabled={busy} onClick={() => onPick(null)} className={btn} style={quiet}>Take it off</button>}
        </div>
      </> : <div className="space-y-2">
        <div role="radiogroup" aria-label="Percent or amount" className="grid grid-cols-2 gap-2">
          {([['pct', 'Percent'], ['off', 'Amount']] as const).map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setValue(''); }} className={btn} style={seg(kind === k)}>{label}</button>)}
        </div>
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>{kind === 'pct' ? 'Percent off' : 'Amount off'}
          <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(kind === 'pct' ? /[^\d]/g : /[^\d.]/g, '').slice(0, 6))} placeholder={kind === 'pct' ? '10' : '2.00'} className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Why
          <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 80))} placeholder="For the record" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        <p className="text-[12.5px]" style={{ color: MUTED }}>Another amount takes a manager. It’s kept on record with who okayed it.</p>
        <div className="flex gap-2"><button type="button" onClick={() => setOther(false)} className={`${btn} flex-1`} style={quiet}>Back</button>
          <button type="button" disabled={busy || !okV || !reason.trim()} onClick={() => onCustom({ kind, value: v, reason: reason.trim() })} className={`${btn} flex-[2]`} style={dark}>Take it off</button></div>
      </div>}
      <button type="button" onClick={onClose} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Done</button>
    </div>
  );
}

/** A gift card by its code (scanned or typed), or the guest's store credit (an order with a rewards member on it by
 *  their rewards code; `needsCode`: one added by their number only), set aside for what's left to pay. */
export function GiftAsk({ dueCents, member, needsCode, busy, onGift, onCredit, onClose }: { dueCents: number; member: boolean; needsCode?: boolean; busy: boolean; onGift: (code: string) => void; onCredit: () => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  const ok = code.replace(/[^A-Za-z0-9]/g, '').length >= 4;
  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: SOFT }} role="group" aria-label="Gift card or store credit">
      <div className="flex items-baseline justify-between gap-2"><p className="text-[17px] font-semibold">Gift card</p><span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(dueCents)} left</span></div>
      <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Its code
        <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24))} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onGift(code); }} placeholder="Scan or type it" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
      <button type="button" disabled={busy || !ok} onClick={() => onGift(code)} className={`${btn} w-full`} style={dark}>Use the gift card</button>
      <p className="text-[12.5px]" style={{ color: MUTED }}>It covers what’s left, or what it has. Anything more is paid by cash or card.</p>
      {member ? <button type="button" disabled={busy} onClick={onCredit} className={`${btn} w-full`} style={quiet}>Use their store credit</button>
        : needsCode ? <p className="text-[12.5px]" style={{ color: MUTED }}>Their store credit is used with the rewards code on their rewards page. Add it to the order first.</p> : null}
      <button type="button" onClick={onClose} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Done</button>
    </div>
  );
}

export type PartHow = 'cash' | 'reader' | 'machine' | 'gift';

/** The bill split evenly some number of ways (`ways`, kept on the order; `shares`: how many have paid theirs), or by an
 *  amount typed, one part at a time: cash, the card reader, another card machine, or a gift card. The last part pays
 *  the order. `reader`: the card reader's name, when this screen has one. */
export function SplitAsk({ dueCents, ways, shares, reader, busy, onWays, onPay, onStop }: { dueCents: number; ways: number; shares: number; reader: string | null; busy: boolean;
  onWays: (n: number) => void; onPay: (how: PartHow, cents: number) => void; onStop: () => void }) {
  const [mode, setMode] = useState<'even' | 'amount'>('even'); const [typed, setTyped] = useState('');
  const even = nextShare(dueCents, ways, shares);
  const t = Math.round(Number(typed) * 100); const okTyped = typed !== '' && Number.isFinite(t) && t >= 1 && t <= dueCents;
  const part = mode === 'even' ? even : okTyped ? t : 0;
  const last = part >= dueCents;
  const minWays = Math.min(SPLIT_WAYS_MAX, Math.max(2, shares + 1));
  const seg = (on: boolean) => (on ? dark : quiet);
  const step = `flex h-[44px] w-[44px] items-center justify-center rounded-xl text-[20px] font-semibold disabled:opacity-40 ${RING}`;
  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: SOFT }} role="group" aria-label="Split the bill">
      <div className="flex items-baseline justify-between gap-2"><p className="text-[17px] font-semibold">Split the bill</p><span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(dueCents)} left</span></div>
      <div role="radiogroup" aria-label="How to split it" className="grid grid-cols-2 gap-2">
        {([['even', 'Evenly'], ['amount', 'By amount']] as const).map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={btn} style={seg(mode === k)}>{label}</button>)}
      </div>
      {mode === 'even' ? <div className="flex items-center justify-between gap-2 rounded-xl px-2" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <button type="button" aria-label="One way fewer" disabled={busy || ways <= minWays} onClick={() => onWays(ways - 1)} className={step} style={{ color: INK }}>−</button>
        <span className="text-[15px] font-semibold tabular-nums" aria-live="polite">{ways} ways</span>
        <button type="button" aria-label="One way more" disabled={busy || ways >= SPLIT_WAYS_MAX} onClick={() => onWays(ways + 1)} className={step} style={{ color: INK }}>+</button>
      </div>
      : <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Amount for this part
        <input autoFocus inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder={(even / 100).toFixed(2)} className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px]" style={{ color: MUTED }}>{mode === 'even' ? `Share ${Math.min(ways, shares + 1)} of ${ways}` : last ? 'The rest' : 'This part'}</span>
        <span className="text-[22px] font-semibold tabular-nums">{part ? usd(part) : '$0.00'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !part} onClick={() => onPay('cash', part)} className={btn} style={dark}>Cash</button>
        {reader ? <button type="button" disabled={busy || !part || part < 50} onClick={() => onPay('reader', part)} className={btn} style={dark}>Card reader</button> : null}
        <button type="button" disabled={busy || !part} onClick={() => onPay('machine', part)} className={btn} style={quiet}>Card machine</button>
        <button type="button" disabled={busy || !part} onClick={() => onPay('gift', part)} className={btn} style={quiet}>Gift card</button>
      </div>
      <p className="text-[12.5px]" style={{ color: MUTED }}>It goes to the kitchen as one order and counts as paid when the parts add up.</p>
      <button type="button" disabled={busy} onClick={onStop} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>{shares ? 'Take the rest in one' : 'Don’t split it'}</button>
    </div>
  );
}
