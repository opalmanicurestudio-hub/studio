'use client';
// /card/[tenantId]/[clientId]?k=… — ADD YOUR CARD (lib/card-save): a member who came over from another app keeps their
// membership going (card details can't be moved between apps). The card goes into the payment processor's own form —
// it's never seen or stored here — and nothing is charged now.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', RED = '#b42318';
const $ = (n: number) => `$${n % 1 ? n.toFixed(2) : n.toFixed(0)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

export default function AddCardPage() {
  const p = useParams() as { tenantId: string; clientId: string }; const tenantId = String(p?.tenantId || ''), clientId = String(p?.clientId || '');
  const [k] = React.useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('k') || ''));
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState(''); const [pay, setPay] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [done, setDone] = React.useState<any>(null);
  React.useEffect(() => { fetch(`/api/cards?tenantId=${encodeURIComponent(tenantId)}&clientId=${encodeURIComponent(clientId)}&k=${encodeURIComponent(k)}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')); }, [tenantId, clientId, k]);
  const post = (body: any) => fetch('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, k, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
  const start = async () => { setBusy(true); setErr(''); const r = await post({ action: 'start' }); setBusy(false); if (!r.ok) { setErr(r.error || 'That didn’t work.'); return; } setPay(r); };
  const confirm = React.useCallback(async () => { if (!pay) return; for (let i = 0; i < 8; i++) { const r = await post({ action: 'confirm', sessionId: pay.sessionId }); if (r?.saved) { setPay(null); setDone(r); return; } await new Promise((res) => setTimeout(res, 1200)); } setPay(null); setDone({ brand: 'card', last4: '' }); }, [pay]); // eslint-disable-line react-hooks/exhaustive-deps
  const stripePromise = React.useMemo(() => (pay?.publishableKey ? loadStripe(pay.publishableKey, { stripeAccount: pay.stripeAccountId }) : null), [pay]);
  const m = d?.membership;
  return (
    <div className="min-h-dvh px-5 pb-12 pt-8" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: '#f7f7f8' }}>
      <div className="mx-auto w-full max-w-md space-y-5">
        {!d && !err ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : !d ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : <>
          <p className="text-center text-[13.5px]" style={{ color: MUTED }}>{d.business}</p>
          <h1 className="text-[28px] font-normal leading-tight tracking-[-0.03em]">{done ? 'You’re all set' : m ? 'Keep your membership going' : 'Add your card'}</h1>
          {m && <div className="rounded-[18px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}><p className="text-[16px] font-semibold">{m.name}</p>
            <p className="text-[13.5px]" style={{ color: MUTED }}>{$(m.price)} a {m.interval === 'yearly' ? 'year' : 'month'}{m.nextCharge ? ` · next on ${day(m.nextCharge)}` : ''}</p></div>}
          {done ? <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: '#e9f3ed', color: GREEN }}><b>Card saved{done.last4 ? ` — ${String(done.brand).replace(/^./, (x: string) => x.toUpperCase())} ending ${done.last4}` : ''}.</b> {m ? `Your membership carries on${m.nextCharge ? ` — the next charge is ${day(m.nextCharge)}` : ''}.` : 'Thank you!'}</p>
            : d.card && !pay ? <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: '#e9f3ed', color: GREEN }}>You already have a {d.card.brand} ending {d.card.last4} on file. <button type="button" onClick={start} className="font-semibold underline underline-offset-4">Use a different card</button></p>
            : pay ? (stripePromise ? <div className="overflow-hidden rounded-2xl"><EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: pay.clientSecret, onComplete: confirm }}><EmbeddedCheckout /></EmbeddedCheckoutProvider></div> : <p style={{ color: RED }}>Card payments aren’t set up here yet.</p>)
            : <>
              <p className="text-[15.5px] leading-relaxed">{d.firstName ? `Hi ${d.firstName} — w` : 'W'}e’ve moved to a new booking system. Add your card here so {m ? 'your membership carries on' : 'it’s on file for your visits'} — nothing else changes.</p>
              {d.canSave ? <button type="button" disabled={busy} onClick={start} className="h-13 w-full rounded-full py-3.5 text-[16px] font-semibold text-white disabled:opacity-50" style={{ background: INK }}>{busy ? 'Opening…' : 'Add my card'}</button> : <p style={{ color: MUTED }}>Cards can’t be added online yet — we’ll take it at your next visit.</p>}
              <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Secured by our card processor — your card number never touches our system.{m?.nextCharge ? ` You won’t be charged until ${day(m.nextCharge)}.` : ' Nothing is charged now.'}</p></>}
          {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
        </>}
      </div>
    </div>);
}
