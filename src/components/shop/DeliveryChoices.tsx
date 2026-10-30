'use client';
// src/components/shop/DeliveryChoices.tsx — ON THE ORDER PAGE, WHEN A DELIVERY COULDN'T BE MADE (mockup 7B): try again
// in an open window (free, or the delivery fee again by the shop's rule), pick it up at the shop, or cancel. The words
// under each come from the server (lib/delivery-retry choiceWords, through api/retail/order-status); the windows from
// api/retail/delivery-choice. Paying for another try is Stripe's own page; the page comes back here.
import * as React from 'react';
import { whenInSentence } from '@/lib/delivery-retry';

const ink = '#16171a'; const muted = '#6d7075'; const line = '#ececee'; const amber = '#b45309'; const red = '#b42318';

export type DeliveryChoicesData = {
  retry: string; pickup: string | null; cancel: string; footer: string | null; retryCents: number;
  payOpen: { url: string; label: string; cents: number } | null;
};
type Win = { key: string; label: string; few: boolean };
type Choice = 'retry' | 'pickup' | 'cancel';

const money = (c: number) => `$${(Math.max(0, Math.round(c)) / 100).toFixed(2)}`;
const CLOSED: Record<string, string> = { applied: 'Another try is booked', refunded: 'Payment refunded', refund_failed: 'Payment received', pending: 'Checking the payment', cancelled: 'Nothing was charged', expired: 'Nothing was charged' };

export function DeliveryChoices({ data, orderNumber, call, onCancel, onDone }: {
  data: DeliveryChoicesData; orderNumber: number;
  /** POST to api/retail/delivery-choice with the order's link and pass; throws with the server's words. */
  call: (payload: Record<string, any>) => Promise<any>;
  /** The order's own cancellation (api/retail/self-serve), which knows a failed delivery. */
  onCancel: () => Promise<string>;
  onDone: (title: string, message: string) => void;
}) {
  const [wins, setWins] = React.useState<Win[] | null>(null);
  const [winNote, setWinNote] = React.useState('');
  const [choice, setChoice] = React.useState<Choice>('retry');
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [sure, setSure] = React.useState(false);
  // On the way to the payment page: the button stays busy until the page goes.
  const leaving = React.useRef(false);
  const radios = React.useRef<Record<string, HTMLButtonElement | null>>({});
  // Back from the payment page with the browser's Back button (the page as it was): ready to choose again.
  React.useEffect(() => {
    const back = (e: PageTransitionEvent) => { if (e.persisted) { leaving.current = false; setBusy(false); } };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  const loadWins = React.useCallback(async () => {
    try {
      const d = await call({ action: 'windows' });
      const ws: Win[] = Array.isArray(d.windows) ? d.windows : [];
      setWins(ws); setWinNote(String(d.message || ''));
      setKey((k) => (ws.some((w) => w.key === k) ? k : ws[0]?.key || ''));
      if (!ws.length) setChoice((c) => (c === 'retry' ? (data.pickup ? 'pickup' : 'cancel') : c));
    } catch { setWins([]); setWinNote('Delivery times couldn’t be loaded just now.'); }
  }, [call, data.pickup]);
  React.useEffect(() => { void loadWins(); }, [loadWins]);

  const pick = (c: Choice) => { setChoice(c); setErr(''); setSure(false); };
  const win = wins?.find((w) => w.key === key) || null;
  const fee = data.retryCents;
  const go = async () => {
    if (busy) return;
    setErr('');
    if (choice === 'cancel' && !sure) { setSure(true); return; }
    setBusy(true);
    try {
      if (choice === 'retry') {
        if (!win) { setErr('Choose a time first.'); return; }
        const d = await call({ action: 'retry', key: win.key });
        if (d.url) { leaving.current = true; window.location.href = d.url; return; }
        onDone('Another try is booked', String(d.message || 'We’ll try again then.'));
      } else if (choice === 'pickup') {
        const d = await call({ action: 'pickup' });
        onDone('Ready for pickup', String(d.message || 'It’s ready for you at the shop.'));
      } else {
        onDone('Order canceled', await onCancel());
      }
    } catch (e: any) {
      setErr(e?.message || 'That didn’t go through. Try again.');
      if (choice === 'retry') void loadWins();
    } finally { if (!leaving.current) setBusy(false); setSure(false); }
  };

  const cta = choice === 'retry'
    ? (win ? `Try again ${whenInSentence(win.label)}${fee > 0 ? ` · Pay ${money(fee)}` : ''}` : 'Choose a time')
    : choice === 'pickup' ? 'Pick it up at the shop'
    : sure ? `Yes, cancel order ${String(orderNumber).padStart(4, '0')}` : 'Cancel the order';

  const noWins = wins !== null && !wins.length;
  // The choices in order, for the arrow keys (one tab stop: the chosen one).
  const order: Choice[] = [...(noWins ? [] : ['retry' as Choice]), ...(data.pickup ? ['pickup' as Choice] : []), 'cancel'];
  const onArrow = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || !(e.target as HTMLElement).matches('[role="radio"]')) return;
    e.preventDefault();
    const i = order.indexOf(choice); const next = order[(i + step + order.length) % order.length];
    pick(next); radios.current[next]?.focus();
  };
  const opt = (c: Choice, title: string, sub: string, disabled = false) => {
    const on = choice === c;
    return (
      <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} ref={(el) => { radios.current[c] = el; }} disabled={disabled || busy} onClick={() => pick(c)}
        className="flex w-full items-start gap-3 rounded-2xl bg-white text-left disabled:opacity-50"
        style={{ border: on ? `2px solid ${ink}` : `1px solid ${line}`, padding: on ? 13 : 14, color: ink }}>
        <span aria-hidden="true" className="mt-px h-5 w-5 shrink-0 rounded-full" style={{ border: on ? `6px solid ${ink}` : '2px solid #c9cbcf', boxSizing: 'border-box' }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug" style={{ color: muted }}>{sub}</span>
        </span>
      </button>);
  };

  if (data.payOpen) {
    return (
      <div id="delivery-choice" className="space-y-3 text-left">
        <p className="m-0 text-[15px]" style={{ color: ink }}>Your payment for another try{data.payOpen.label ? ` ${whenInSentence(data.payOpen.label)}` : ''} isn’t finished.</p>
        <a href={data.payOpen.url} className="flex h-[52px] w-full items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: ink, color: '#fff' }}>Finish paying {money(data.payOpen.cents)}</a>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const d = await call({ action: 'retry_cancel' }); onDone(CLOSED[String(d.result)] || 'Thanks', String(d.message || 'Nothing was charged.')); } catch (e: any) { setErr(e?.message || 'Try again.'); } finally { setBusy(false); } }}
          className="h-11 w-full rounded-full text-[15px] font-semibold" style={{ border: `1px solid ${line}`, background: '#fff', color: ink }}>Choose something else</button>
        {err && <p className="m-0 text-[13px]" role="alert" style={{ color: amber }}>{err}</p>}
      </div>);
  }

  return (
    <div id="delivery-choice" className="space-y-3 text-left">
      <p className="m-0 text-[13px] font-semibold" style={{ color: muted }}>What would you like to do?</p>
      <div role="radiogroup" aria-label="What would you like to do?" className="space-y-2.5" onKeyDown={onArrow}>
        {opt('retry', 'Try again', noWins ? winNote || 'There are no delivery times open in the next few days.' : data.retry, noWins)}
        {choice === 'retry' && !noWins && (
          <div role="group" aria-label="When to try again" className="flex flex-wrap gap-2 pl-0.5">
            {wins === null && <span role="status" className="text-[13px]" style={{ color: muted }}>Finding times…</span>}
            {(wins || []).map((w) => {
              const on = w.key === key;
              return (
                <button key={w.key} type="button" aria-pressed={on} disabled={busy} onClick={() => { setKey(w.key); setErr(''); }}
                  className="h-11 rounded-full px-3.5 text-[13.5px] font-semibold"
                  style={{ border: `1px solid ${on ? ink : line}`, background: on ? ink : '#fff', color: on ? '#fff' : ink }}>
                  {w.label}{w.few ? <span className="sr-only"> (almost full)</span> : null}
                </button>);
            })}
          </div>)}
        {data.pickup && opt('pickup', 'Pick it up at the shop', data.pickup)}
        {opt('cancel', 'Cancel the order', data.cancel)}
      </div>
      <button type="button" disabled={busy || (choice === 'retry' && !win)} onClick={() => void go()}
        className="h-[52px] w-full rounded-full text-[15px] font-semibold disabled:opacity-50"
        style={{ background: choice === 'cancel' ? red : ink, color: '#fff' }}>{busy ? 'One moment…' : cta}</button>
      {sure && choice === 'cancel' && <p className="m-0 text-center text-[13px]" style={{ color: muted }}>This can’t be undone.</p>}
      {err && <p className="m-0 text-[13px]" role="alert" style={{ color: amber }}>{err}</p>}
      {data.footer && !noWins && !(sure && choice === 'cancel') && <p className="m-0 text-center text-[12.5px] leading-snug" style={{ color: muted }}>{data.footer}</p>}
    </div>);
}
