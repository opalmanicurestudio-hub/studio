'use client';
// src/components/pay/ClientPayForm.tsx — THE CLIENT PAYS: on the front-desk iPad or on their own phone (Apple Pay /
// Google Pay appear where the device supports them). Stripe's secure form — card details never touch our system.
// "Save my card for next time" is the CLIENT's own tick box, applied before they pay. The server confirms with Stripe.
import * as React from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

async function call(body: any) {
  return fetch('/api/client-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
}
function Inner({ screenId, requestId, amount, allowSave, accent, onPaid, big }: { screenId: string; requestId: string; amount: number; allowSave: boolean; accent: string; onPaid: () => void; big?: boolean }) {
  const stripe = useStripe(); const elements = useElements();
  const [save, setSave] = React.useState(false); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  const pay = async () => {
    if (!stripe || !elements) return; setBusy(true); setErr(null);
    if (allowSave) { const r: any = await call({ action: 'pay_save', screenId, requestId, save }); if (!r?.ok && !r?.already) { setBusy(false); setErr(r?.error || 'Try again.'); return; } }
    const res = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (res.error) { setBusy(false); setErr(res.error.message || 'The payment didn’t go through.'); return; }
    for (let i = 0; i < 5; i++) { const d: any = await call({ action: 'pay_done', screenId, requestId }); if (d?.ok) { onPaid(); return; } if (!/processing/i.test(String(d?.error || ''))) { setErr(d?.error || 'Couldn’t confirm the payment.'); break; } await new Promise((r) => setTimeout(r, 1500)); }
    setBusy(false);
  };
  return <div className="space-y-4">
    <PaymentElement options={{ layout: 'tabs' }} />
    {allowSave && <label className={`flex items-start gap-3 ${big ? 'text-[18px]' : 'text-[15px]'}`}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="mt-1 h-5 w-5" /><span>Save my card for next time <span style={{ color: '#78716c' }}>— used only with my approval</span></span></label>}
    {err && <p role="alert" className="font-semibold" style={{ color: '#a15c07' }}>{err}</p>}
    <button type="button" onClick={pay} disabled={busy || !stripe} className={`w-full rounded-3xl font-semibold disabled:opacity-40 ${big ? 'min-h-[76px] text-[22px]' : 'h-14 text-[17px]'}`} style={{ background: accent, color: '#fff' }}>{busy ? 'Paying…' : `Pay $${amount.toFixed(2)}`}</button>
  </div>;
}
const cache = new Map<string, Promise<any>>();
export function ClientPayForm({ screenId, requestId, onPaid, big }: { screenId: string; requestId: string; onPaid: () => void; big?: boolean }) {
  const [v, setV] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { call({ action: 'pay_view', screenId, requestId }).then((r: any) => (r?.ok ? setV(r) : setErr(r?.error || 'This payment isn’t available.'))); }, [screenId, requestId]);
  if (err) return <p className="text-[18px] font-semibold" style={{ color: '#a15c07' }}>{err}</p>;
  if (!v) return <p className="text-[18px]" style={{ color: '#78716c' }}>Loading…</p>;
  if (v.paid) return <p className="text-[20px] font-semibold">Paid — thank you!</p>;
  if (!v.publishableKey) return <p className="text-[18px]" style={{ color: '#a15c07' }}>Card payments aren’t set up yet.</p>;
  const key = `${v.publishableKey}|${v.stripeAccount}`; if (!cache.has(key)) cache.set(key, loadStripe(v.publishableKey, { stripeAccount: v.stripeAccount }));
  return <Elements stripe={cache.get(key)!} options={{ clientSecret: v.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: v.accent || '#1c1917', borderRadius: '14px', fontSizeBase: big ? '18px' : '16px' } } }}>
    <Inner screenId={screenId} requestId={requestId} amount={Number(v.amount) || 0} allowSave={!!v.allowSave} accent={v.accent || '#1c1917'} onPaid={onPaid} big={big} />
  </Elements>;
}
