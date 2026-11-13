'use client';
// src/app/drive-thru/[tenantId]/pay/page.tsx — THE GUEST PAYS ON THEIR OWN PHONE (scan to pay at the drive-thru): the code
// on the lane or the window screen opens this page for that one order. It shows the order and its total, and the card
// company's own secure form (card, Apple Pay, Google Pay where the phone has them); nothing about the card touches the
// business. Once it's gone through (the server asks the card company, never the page), it says so and where to go.
// Reads api/counter/pay only.

import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
type Line = { name: string; quantity: number; choicesText: string | null; price: number; imageUrl: string | null };
type View = { ok: true; paid: boolean; business: string; number: string; name: string | null; lines: Line[]; subtotal: number; tax: number; total: number; clientSecret?: string; publishableKey?: string; stripeAccount?: string };

async function call(body: any) {
  try { const r = await fetch('/api/counter/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; }
  catch { return { status: 0, d: { ok: false, error: 'No connection. Try again.' } }; }
}
// One card company connection per business account, made once.
const stripes = new Map<string, Promise<any>>();
const stripeFor = (pk: string, acct?: string) => { const k = `${pk}|${acct || ''}`; if (!stripes.has(k)) stripes.set(k, loadStripe(pk, { stripeAccount: acct })); return stripes.get(k)!; };

function PayForm({ total, link, onPaid }: { total: number; link: { tenantId: string; o: string; s: string }; onPaid: () => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [held, setHeld] = React.useState('');
  const pay = async () => {
    if (!stripe || !elements) return; setBusy(true); setErr('');
    const res = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (res.error) {
      // Paid another way meanwhile (the payment was called off): the order says so.
      if (res.error.code === 'payment_intent_unexpected_state') { const { d } = await call({ action: 'view', ...link }); if (d.ok && d.paid) { onPaid(); return; } }
      setBusy(false); setErr(res.error.message || 'The payment didn’t go through.'); return;
    }
    // The server asks the card company (a few times, while it's processing).
    for (let i = 0; i < 6; i++) {
      const { status, d } = await call({ action: 'done', ...link });
      if (d.ok && d.paid) { onPaid(); return; }
      if (status !== 202) { setErr(d.error || 'We couldn’t confirm the payment. Show this screen at the window.'); if (d.notKept) setHeld('Paid at the window'); setBusy(false); return; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setErr('Your payment is still going through. The window sees it as soon as it’s done.');
    setHeld('Going through…'); setBusy(false);
  };
  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <button type="button" onClick={pay} disabled={busy || !!held || !stripe} className={`min-h-[56px] w-full rounded-2xl text-[17px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Paying…' : held || `Pay ${usd(total)}`}</button>
    </div>
  );
}

export default function DriveThruPay() {
  const { tenantId } = useParams() as { tenantId: string };
  const [link, setLink] = React.useState<{ tenantId: string; o: string; s: string } | null>(null);
  const [v, setV] = React.useState<View | null>(null); const [err, setErr] = React.useState(''); const [paid, setPaid] = React.useState(false);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search); const l = { tenantId, o: q.get('o') || '', s: q.get('s') || '' };
    setLink(l);
    void call({ action: 'view', ...l }).then(({ d }) => { if (d.ok) { setV(d); if (d.paid) setPaid(true); } else setErr(d.error || 'This link doesn’t work. Ask at the window.'); });
  }, [tenantId]);

  const shell = (children: React.ReactNode) => (
    <main className="min-h-dvh px-4 py-6" style={{ background: SOFT, color: INK }}>
      <div className="mx-auto w-full max-w-md space-y-4">{children}</div>
    </main>
  );
  if (err) return shell(
    <div className="rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}>
      <p className="text-[20px] font-semibold tracking-tight">Pay at the window</p>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: MUTED }}>{err}</p>
    </div>);
  if (!v || !link) return shell(<div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading your order" /></div>);
  if (paid) return shell(
    <div className="space-y-3 rounded-3xl bg-[#fff] p-6 text-center" style={{ border: `1px solid ${LINE}` }} role="status">
      <p className="mx-auto w-max rounded-full px-4 py-1.5 text-[15px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Paid</p>
      <p className="text-[26px] font-semibold leading-tight tracking-tight">Thank you{v.name ? `, ${v.name}` : ''}</p>
      <p className="text-[16px] leading-relaxed" style={{ color: MUTED }}>Pull up to the window when it’s your turn. Your order is <b className="font-semibold" style={{ color: INK }}>{v.number}</b>.</p>
      <p className="text-[14px]" style={{ color: MUTED }}>{v.business}</p>
    </div>);
  return shell(
    <>
      <header className="flex items-baseline justify-between gap-3 px-1">
        <p className="min-w-0 truncate text-[18px] font-semibold tracking-tight">{v.business}</p>
        <p className="shrink-0 text-[15px] font-medium tabular-nums" style={{ color: MUTED }}>Order {v.number}{v.name ? ` · ${v.name}` : ''}</p>
      </header>
      <section aria-label="Your order" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <ul className="space-y-3">
          {v.lines.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {l.imageUrl && <img src={l.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" style={{ background: SOFT }} />}
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-medium"><span className="tabular-nums" style={{ color: GREEN }}>{l.quantity}</span> {l.name}</p>
                  {l.choicesText && <p className="truncate text-[13.5px]" style={{ color: MUTED }}>{l.choicesText}</p>}
                </div>
              </div>
              <p className="shrink-0 text-[16px] tabular-nums">{usd(l.price)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 border-t pt-3 text-[14.5px]" style={{ borderColor: LINE, color: MUTED }}>
          <p className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{usd(v.subtotal)}</span></p>
          {v.tax > 0 && <p className="flex justify-between"><span>Tax</span><span className="tabular-nums">{usd(v.tax)}</span></p>}
          <p className="flex items-baseline justify-between pt-1" style={{ color: INK }}><span className="text-[16px] font-semibold">Total</span><span className="text-[26px] font-semibold tabular-nums">{usd(v.total)}</span></p>
        </div>
      </section>
      <section aria-label="Pay" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        {v.clientSecret && v.publishableKey ? (
          <Elements stripe={stripeFor(v.publishableKey, v.stripeAccount)} options={{ clientSecret: v.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: INK, borderRadius: '14px', fontSizeBase: '16px', fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif' } } }}>
            <PayForm total={v.total} link={link} onPaid={() => setPaid(true)} />
          </Elements>
        ) : <p className="text-[15px]" style={{ color: MUTED }}>Card payments aren’t set up here yet. Pay at the window.</p>}
      </section>
      <p className="px-1 text-center text-[13px]" style={{ color: MUTED }}>Your card goes straight to the card company’s secure form. The business never sees it.</p>
    </>
  );
}
