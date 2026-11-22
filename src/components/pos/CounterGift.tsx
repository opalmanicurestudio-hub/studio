'use client';
// src/components/pos/CounterGift.tsx — A GIFT CARD SOLD WITH THE ORDER, AT THE COUNTER OR THE WINDOW (design board "Gift
// cards at the counter"; lib/counter-gift, lib/counter-gift-server). The sheet: an amount (the business's own amounts from
// Gift cards, or another), who it's for, and how it gets to them (its code on the receipt, by text, or by email), added
// as a line of its own. Once the order is paid: each one's code, and a way to make one that wasn't. `add` posts to the
// screen's own api/counter and answers with an error to show, or null when it's on. White surfaces are set inline, so the
// app's black look (lib/app-theme) takes them over.
import { useEffect, useMemo, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', GREEN = '#1f7a4d';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const field = `mt-1 block min-h-[48px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]`;
const usd = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,24}$/;
type Via = 'print' | 'text' | 'email';
const VIAS: { id: Via; label: string }[] = [{ id: 'print', label: 'On the receipt' }, { id: 'text', label: 'By text' }, { id: 'email', label: 'By email' }];
const phoneShown = (d: string) => (d.length <= 3 ? d : d.length <= 6 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`);

export type GiftBody = { cents: number; to: string; via: Via; phone?: string; email?: string; tapKey: string };

/** `amounts`: the business's own, in dollars. */
export function GiftSheet({ amounts, onClose, add }: { amounts: number[]; onClose: () => void; add: (body: GiftBody) => Promise<string | null> }) {
  const list = (amounts.length ? amounts : [25, 50, 100]).slice(0, 3);
  const [pick, setPick] = useState<number | 'other'>(list[1] ?? list[0]); const [other, setOther] = useState('');
  const [to, setTo] = useState(''); const [via, setVia] = useState<Via>('print'); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  // (One tap is one gift card, however often it's sent.)
  const tapKey = useMemo(() => `gift-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const cents = pick === 'other' ? Math.round(Number(other.replace(/[$,\s]/g, '')) * 100) : Math.round(pick * 100);
  const amountOk = cents >= 100 && cents <= 500000;
  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const howOk = via === 'print' || (via === 'text' ? /^[2-9]\d{9}$/.test(digits) : EMAIL.test(email.trim()));
  const ready = amountOk && howOk;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    const e = await add({ cents, to: to.trim(), via, ...(via === 'text' ? { phone: digits } : via === 'email' ? { email: email.trim() } : {}), tapKey }).catch(() => 'No connection. Try again.');
    setBusy(false); if (e) setErr(e);
  };
  const seg = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` });
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label="A gift card" onSubmit={(e) => { e.preventDefault(); void go(); }} className="max-h-[92vh] w-full max-w-[460px] space-y-4 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">A gift card</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <div role="radiogroup" aria-label="How much" className="grid grid-cols-4 gap-2">
          {list.map((a) => <button key={a} type="button" role="radio" aria-checked={pick === a} onClick={() => { setPick(a); setErr(''); }} className={`${btn} min-h-[48px] px-2 tabular-nums`} style={seg(pick === a)}>${a}</button>)}
          <button type="button" role="radio" aria-checked={pick === 'other'} onClick={() => { setPick('other'); setErr(''); }} className={`${btn} min-h-[48px] px-2`} style={seg(pick === 'other')}>Other</button>
        </div>
        {pick === 'other' && <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>How much, $1 to $5,000
          <span className="mt-1 flex min-h-[48px] items-center rounded-xl border px-3 focus-within:border-[#16171a]" style={{ borderColor: other && !amountOk ? AMBER : LINE }}>
            <span aria-hidden className="text-[18px]" style={{ color: MUTED }}>$</span>
            <input autoFocus inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} placeholder="0.00" className="min-w-0 flex-1 bg-transparent px-1 text-[18px] font-normal tabular-nums" style={{ color: INK, outline: 'none' }} />
          </span></label>}
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Who it’s for
          <input value={to} onChange={(e) => setTo(e.target.value.slice(0, 40))} placeholder="Their first name, if you like" autoComplete="off" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        <div className="space-y-2"><p className="text-[13px] font-semibold" style={{ color: MUTED }}>How it gets to them</p>
          <div role="radiogroup" aria-label="How it gets to them" className="grid grid-cols-3 gap-2">
            {VIAS.map((v) => <button key={v.id} type="button" role="radio" aria-checked={via === v.id} onClick={() => { setVia(v.id); setErr(''); }} className={`${btn} min-h-[48px] px-2`} style={seg(via === v.id)}>{v.label}</button>)}
          </div>
          {via === 'text' && <input inputMode="tel" autoComplete="off" aria-label="Their mobile number" value={phoneShown(digits)} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 012-4567" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} />}
          {via === 'email' && <input type="email" inputMode="email" autoComplete="off" aria-label="Their email" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 254))} placeholder="name@example.com" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} />}
        </div>
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <button type="submit" disabled={!ready || busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Adding…' : amountOk ? `Add to the order, ${usd(cents)}` : 'Add to the order'}</button>
        <p className="text-[13px]" style={{ color: MUTED }}>Paid in cash or by card. It’s not taxed, and no discount, reward or points go on it. It’s made once the order is paid, the same as the front desk’s{via === 'print' ? ', and its code is on the receipt' : via === 'text' ? ', and texted to them then' : ', and emailed to them then'}.</p>
      </form>
    </div>
  );
}

export type GiftMade = { lineId: string; name: string; to: string | null; cents: number; via: Via; code: string | null; sent: boolean; failed: boolean; bonusCode: string | null };

/** How the gift cards on a paid order read in the paid notice. */
export function giftsPaidWords(gifts: GiftMade[] | null | undefined): string {
  if (!Array.isArray(gifts) || !gifts.length) return '';
  return ' ' + gifts.map((g) => {
    if (g.failed || !g.code) return `${g.name} wasn’t made yet.`;
    const how = g.via === 'print' ? 'On the receipt.' : g.via === 'text' ? (g.sent ? 'Texted.' : 'Not texted yet.') : g.sent ? 'Emailed.' : 'Not emailed yet.';
    return `${g.name}, ${usd(g.cents)}: ${g.code}. ${how}${g.bonusCode ? ` Their bonus card: ${g.bonusCode}.` : ''}`;
  }).join(' ');
}

/** Whether one of them wasn't made (the paid notice says so in amber). */
export const giftsFailed = (gifts: GiftMade[] | null | undefined) => Array.isArray(gifts) && gifts.some((g) => g.failed || !g.code);

/** After it's paid: each gift card's code (big enough to write on a card), and making one that wasn't. */
export function GiftsMade({ number, gifts, retry, onClose }: { number: string; gifts: GiftMade[]; retry: () => Promise<GiftMade[] | null>; onClose: () => void }) {
  const [list, setList] = useState(gifts); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => setList(gifts), [gifts]);
  const left = list.filter((g) => g.failed || !g.code).length;
  const again = async () => { setBusy(true); setErr(''); const r = await retry().catch(() => null); setBusy(false); if (r) setList(r); else setErr('That didn’t go through. Try again.'); };
  return (
    <section aria-label={`Gift cards on ${number}`} className="space-y-2 rounded-2xl border p-4" style={{ background: '#fff', borderColor: LINE, color: INK }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-semibold">Gift cards on {number}</p>
        <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Done</button></div>
      {list.map((g) => <div key={g.lineId} className="flex items-baseline justify-between gap-3 text-[14.5px]">
        <span className="min-w-0">{g.name}, {usd(g.cents)}<span className="block text-[13px]" style={{ color: MUTED }}>{g.failed || !g.code ? 'Not made yet' : g.via === 'print' ? 'On the receipt' : g.via === 'text' ? (g.sent ? 'Texted' : 'Not texted yet') : g.sent ? 'Emailed' : 'Not emailed yet'}{g.bonusCode ? `; their bonus card ${g.bonusCode}` : ''}</span></span>
        {g.code && <span className="shrink-0 text-[18px] font-semibold tabular-nums tracking-wide" style={{ color: GREEN }}>{g.code}</span>}</div>)}
      {list.some((g) => g.code && g.via !== 'print' && !g.sent) && <p className="text-[13px]" style={{ color: MUTED }}>One that didn’t go out can be sent again from Gift cards.</p>}
      {left > 0 && <button type="button" disabled={busy} onClick={() => void again()} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Making…' : left === 1 ? 'Make it now' : `Make the ${left} now`}</button>}
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
    </section>
  );
}

/** Paid orders whose gift cards weren't made (the screen closed before they were): each one, to make now. */
export function GiftsOpen({ rows, make }: { rows: { orderId: string; number: string }[]; make: (orderId: string, number: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <div className="space-y-2" role="status">
      {rows.map((r) => <div key={r.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2 text-[14px]" style={{ background: '#fff7ed', color: AMBER }}>
        <span>{r.number}: a gift card was paid for and isn’t made yet.</span>
        <button type="button" disabled={busy === r.orderId} onClick={() => { setBusy(r.orderId); void make(r.orderId, r.number).finally(() => setBusy(null)); }} className={btn} style={{ background: INK, color: '#fff' }}>{busy === r.orderId ? 'Making…' : 'Make it now'}</button>
      </div>)}
    </div>
  );
}
