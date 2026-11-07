'use client';
// src/components/visit/VisitPay.tsx — PAY AND TIP from the client's visit link (ClientVisit board, "Pay and tip"): the desk
// (or a solo provider on their phone) taps "Send to their phone" at checkout, and the visit link turns into this: "Thanks
// for coming in, Dana", the bill line by line with the deposit already paid taken off, a tip shown in dollars (18% · $9),
// then Stripe's secure form with Apple Pay and Google Pay where the phone has them. It is the client screen's own payment
// (api/client-screen, a screen that belongs to this one visit): the tip is added on the server, the client's "save my
// card" is their own tick box, and a payment only counts once Stripe confirms it (pay_done) — then the sale records
// itself at the desk, exactly as a payment on the iPad does. This page follows that screen live.
import * as React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useFirebase } from '@/firebase';
import { VisitShell, VisitButton, VisitMuted, VisitCheckRow, VisitSaid, VisitCheck, type VisitBrand } from '@/components/booking/VisitShell';
import { inPerson, type PublicShape } from '@/lib/business-shape';

const call = (body: any) => fetch('/api/client-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t connect. Please try again.' }));
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => `$${num(n).toFixed(2)}`;
const short = (n: number) => { const v = Math.round(num(n) * 100) / 100; return `$${v % 1 ? v.toFixed(2) : v}`; };
const stripes = new Map<string, Promise<any>>();

/** The bill, as the desk rang it up: each line, then what's off (store credit, gift card, the deposit already paid),
 *  any card fee, and what's left. */
function Bill({ tk, q }: { tk: any; q: any }) {
  const lines: any[] = Array.isArray(tk?.lines) ? tk.lines : [];
  const row = (a: React.ReactNode, b: React.ReactNode, o: { muted?: boolean; strong?: boolean } = {}) => (
    <div className="flex items-baseline justify-between gap-3 text-[15px]" style={{ color: o.muted ? 'var(--muted)' : 'var(--ink)', fontWeight: o.strong ? 600 : 400 }}><span className="min-w-0">{a}</span><span className="shrink-0 tabular-nums">{b}</span></div>
  );
  const due = num(q.amountBase ?? q.amount);
  return (
    <section className="pub-card space-y-2.5 p-5" aria-label="Your bill">
      {q.shareLabel ? row(`Your share: ${q.shareLabel}`, money(due), { strong: true }) : <>
        {lines.map((l, i) => <React.Fragment key={i}>{row(<>{l.label}{l.note ? <span style={{ color: 'var(--muted)' }}> · {l.note}</span> : null}</>, money(l.amount))}</React.Fragment>)}
        {num(tk?.discount) > 0 && row('Discounts', `−${money(tk.discount)}`, { muted: true })}
        {num(tk?.tax) > 0 && row(tk.taxLabel || 'Tax', money(tk.tax), { muted: true })}
        {num(tk?.tip) > 0 && row('Tip already added', money(tk.tip), { muted: true })}
        {num(tk?.credit) > 0 && row('Store credit', `−${money(tk.credit)}`, { muted: true })}
        {num(tk?.giftCard) > 0 && row('Gift card', `−${money(tk.giftCard)}`, { muted: true })}
        {num(tk?.paid) > 0 && row('Deposit paid', `−${money(tk.paid)}`, { muted: true })}
        {num(tk?.fee) > 0 && row('Card fee', money(tk.fee), { muted: true })}
        <div style={{ borderTop: '1px solid var(--line)' }} className="pt-2.5">{row('Left to pay', money(due), { strong: true })}</div>
      </>}
    </section>
  );
}

/** Ask the server to confirm the payment with Stripe until it has a final answer: quickly at first, then every few seconds,
 *  then every 15 seconds for as long as the page is open (some cards and wallets take a while at the bank). Only the
 *  server's own answers end it — paid, not paid, the wrong amount, or no longer open; anything else (still going through,
 *  a dropped connection) is asked again. `onSlow`: still no answer after the first few tries. */
type Confirmed = { ok: true } | { ok: false; final?: 'not_paid' | 'mismatch' | 'closed'; error?: string };
async function confirmPaid(screenId: string, requestId: string, still: () => boolean, onSlow?: () => void): Promise<Confirmed> {
  for (let i = 0; i < 500 && still(); i++) {
    const d: any = await call({ action: 'pay_done', screenId, requestId });
    if (d?.ok) return { ok: true };
    if (['not_paid', 'mismatch', 'closed'].includes(d?.code)) return { ok: false, final: d.code, error: d.error };
    if (i === 5) onSlow?.();
    await new Promise((r) => setTimeout(r, i < 5 ? 1500 : i < 30 ? 5000 : 15000));
  }
  return { ok: false };
}
const SLOW = 'Your payment is still going through at your bank. Please don’t pay again: this page updates by itself once it’s through, and the team can see it.';
const NOT_PAID = 'That payment didn’t go through, and nothing was charged. Please try again, or choose another way to pay.';
/** What a confirm's answer means on the page. Paid; not paid (Pay comes back on, and it says nothing was charged); no
 *  longer open (the page follows the screen); otherwise still unclear, so Pay stays off and it says not to pay again. */
function outcome(c: Confirmed): { paid?: boolean; slow: boolean; note: string | null } {
  if (c.ok) return { paid: true, slow: false, note: null };
  if (c.final === 'not_paid') return { slow: false, note: NOT_PAID };
  if (c.final === 'closed') return { slow: false, note: null };
  if (c.final === 'mismatch') return { slow: true, note: `${c.error || 'The payment amount does not match.'} Please don’t pay again; the team can see it.` };
  return { slow: true, note: SLOW };
}

function PayForm({ screenId, q, provider, onPaid, slow, setSlow, onBusy }: { screenId: string; q: any; provider?: string | null; onPaid: () => void; slow: boolean; setSlow: (v: boolean) => void; onBusy: (v: boolean) => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [tipKey, setTipKey] = React.useState<string | null>(q.tipChosen ? 'set' : null);
  const [other, setOther] = React.useState(''); const [otherOpen, setOtherOpen] = React.useState(false);
  const [tipBusy, setTipBusy] = React.useState(false); const [save, setSave] = React.useState(false);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  // Paid at the bank but not through yet (`slow`, kept by the page): Pay stays off, so they never pay twice.
  const live = React.useRef(true); React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  React.useEffect(() => { onBusy(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const people: { id: string; name: string }[] = Array.isArray(q.providers) ? q.providers : [];
  const base = num(q.tipBase); const presets: number[] = Array.isArray(q.presets) && q.presets.length ? q.presets : [18, 20, 25];
  const needTip = !!q.askTip && !q.tipChosen;
  const chooseTip = async (key: string, tip: number) => {
    if (tipBusy || busy) return; setTipBusy(true); setErr(null);
    const r: any = await call({ action: 'pay_tip', screenId, requestId: q.id, tip });
    if (!r?.ok) { setErr(r?.error || 'That tip couldn’t be added. Please try again.'); setTipBusy(false); return; }
    setTipKey(key); setOtherOpen(false);
    try { await elements?.fetchUpdates(); } catch { /* the amount is on the payment either way */ }
    setTipBusy(false);
  };
  const pay = async () => {
    if (!stripe || !elements || busy || tipBusy) return; setBusy(true); setErr(null);
    if (q.allowSave) { const r: any = await call({ action: 'pay_save', screenId, requestId: q.id, save }); if (!r?.ok && !r?.already) { setBusy(false); setErr(r?.error || 'Please try again.'); return; }
      try { await elements.fetchUpdates(); } catch { /* saving the card is on the payment either way */ } }
    const res = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: typeof window !== 'undefined' ? window.location.href.split('?')[0] + '?paid=1' : '' } });
    if (res.error) { setBusy(false); setErr(res.error.message || 'The payment didn’t go through. Nothing was charged.'); return; }
    const c = await confirmPaid(screenId, q.id, () => live.current, () => { setSlow(true); setErr(SLOW); });
    if (!live.current) return;
    const o = outcome(c); if (o.paid) { onPaid(); return; }
    setSlow(o.slow); setErr(o.note); setBusy(false);   // still unclear: Pay stays off (slow); not paid: they can try again
  };
  const tile = (key: string, top: string, sub: string, onClick: () => void) => {
    const on = tipKey === key;
    return <button key={key} type="button" role="radio" aria-checked={on} disabled={tipBusy || busy} onClick={onClick}
      className="pub-press flex min-h-[62px] flex-1 flex-col items-center justify-center rounded-2xl px-1 disabled:opacity-70"
      style={on ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--card)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      <span className="text-[17px] font-semibold">{top}</span>{sub && <span className="text-[12.5px]" style={{ opacity: 0.85 }}>{sub}</span>}</button>;
  };
  return (
    <div className="space-y-5">
      {q.askTip && !slow && <section className="space-y-2.5" aria-label="Add a tip">
        <p className="px-1 text-[17px] font-semibold">{people.length <= 1 && provider ? `Add a tip for ${provider}` : 'Add a tip'}</p>
        <div className="flex gap-2" role="radiogroup" aria-label="Tip">
          {presets.map((p) => { const amt = Math.round(base * p) / 100; return tile(`p${p}`, `${p}%`, short(amt), () => chooseTip(`p${p}`, amt)); })}
          {q.allowCustom !== false && tile('other', 'Other', tipKey === 'other' ? short(num(q.tip)) : '', () => { setOtherOpen(true); })}
        </div>
        {otherOpen && <div className="flex items-center gap-2">
          <input value={other} onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" aria-label="Tip amount in dollars" placeholder="Amount in dollars" className="v-field h-12 min-w-0 flex-1" />
          <div className="w-28 shrink-0"><VisitButton disabled={tipBusy || !(Number(other) > 0)} onClick={() => chooseTip('other', Math.round(Number(other) * 100) / 100)}>Add</VisitButton></div>
        </div>}
        {q.showNoTip !== false && <button type="button" role="radio" aria-checked={tipKey === 'none'} disabled={tipBusy || busy} onClick={() => chooseTip('none', 0)}
          className="inline-flex min-h-11 items-center px-1 text-[14.5px] underline underline-offset-4" style={{ color: tipKey === 'none' ? 'var(--ink)' : 'var(--muted)', fontWeight: tipKey === 'none' ? 600 : 400 }}>{tipKey === 'none' ? 'No tip this time' : 'No tip'}</button>}
        <p className="px-1 text-[13px]" style={{ color: 'var(--muted)' }}>
          {tipBusy ? 'Updating your total…' : people.length > 1 ? `Shared between ${people.map((x) => String(x.name).split(' ')[0]).join(' and ')}.` : provider && q.tipsDirect ? `Tips go to ${provider} in full.` : provider ? `Your tip is for ${provider} and the team.` : ''}
        </p>
      </section>}
      <section className="pub-card space-y-4 p-4" aria-label="Pay">
        <PaymentElement options={{ layout: 'tabs' }} />
        {q.allowSave && <VisitCheckRow checked={save} onChange={setSave}>Save my card for next time <span style={{ color: 'var(--muted)' }}>(used only with my say-so)</span></VisitCheckRow>}
      </section>
      <VisitSaid text={err} />
      <VisitButton disabled={busy || slow || tipBusy || needTip || !stripe} onClick={pay}>
        {slow ? 'Payment going through…' : busy ? 'Paying…' : needTip ? 'Choose a tip to continue' : `Pay ${money(num(q.amount))}`}
      </VisitButton>
      <p className="text-center text-[13px]" style={{ color: 'var(--muted)' }}>Secured by Stripe. Your card details never touch our servers.</p>
    </div>
  );
}

export function VisitPay({ brand, screenId, first, provider, onClose, shape }: { brand: VisitBrand; screenId: string; first?: string | null; provider?: string | null; onClose: () => void; shape?: PublicShape | null }) {
  const { firestore } = useFirebase() as any;
  const [s, setS] = React.useState<any>(undefined);
  const [view, setView] = React.useState<any>(null); const [viewErr, setViewErr] = React.useState<string | null>(null);
  const [paidHere, setPaidHere] = React.useState(false);
  // Back from a bank or a pay-later app: what it said, when it didn't go through or is still going through.
  const [backNote, setBackNote] = React.useState<string | null>(null);
  // Paid and still going through at the bank (Pay stays off), and paying right now: they stay here until it's through.
  const [slow, setSlow] = React.useState(false); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!firestore || !screenId) return; return onSnapshot(doc(firestore, 'clientScreens', screenId), (snap) => setS(snap.exists() ? snap.data() : null), () => setS(null)); }, [firestore, screenId]);
  const q = s?.request; const r = s?.response; const tk = s?.ticket;
  const open = q?.kind === 'pay' && !q.answeredAt;
  // Stripe's form for this payment (its secret, the business's account), once per payment.
  // A new payment starts clean: nothing said or held over from the one before.
  React.useEffect(() => { if (!open) return; let live = true; setView(null); setViewErr(null); setSlow(false); setBusy(false); setBackNote(null);
    void call({ action: 'pay_view', screenId, requestId: q.id }).then((d: any) => { if (!live) return; if (d?.ok) setView(d); else setViewErr(d?.error || 'This payment isn’t available right now.'); });
    return () => { live = false; }; }, [open, q?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back from a payment that opened another page (a bank or a pay-later app): confirm it with Stripe here.
  // Each time it opens (back from a bank, a reload, or back from their visit), whether they've already paid is asked: one
  // paid shows as paid, one still going through keeps Pay off until it's through, and one not paid asks nothing more.
  React.useEffect(() => { if (!open || typeof window === 'undefined') return; const u = new URL(window.location.href);
    const status = u.searchParams.get('payment_intent') ? u.searchParams.get('redirect_status') : null;
    if (u.searchParams.get('payment_intent')) { ['payment_intent', 'payment_intent_client_secret', 'redirect_status', 'paid'].forEach((k) => u.searchParams.delete(k)); window.history.replaceState(window.history.state, '', u.pathname + (u.search || '')); }
    if (status === 'failed') { setBackNote(NOT_PAID); return; }
    let live = true;
    // Back from a bank, it's followed to its answer. Otherwise it's asked once: only one already paid, or going through
    // at the bank (then followed), changes anything; not paid yet, or no answer, says nothing.
    const follow = () => void confirmPaid(screenId, q.id, () => live, () => { setSlow(true); setBackNote(SLOW); }).then((c) => { if (!live) return;
      const o = outcome(c); if (o.paid) { setPaidHere(true); return; } setSlow(o.slow); setBackNote(o.note); });
    if (status) { setSlow(true); follow(); }
    else void call({ action: 'pay_done', screenId, requestId: q.id }).then((d: any) => { if (!live) return;
      if (d?.ok) { setPaidHere(true); return; }
      if (d?.code === 'processing') { setSlow(true); setBackNote(SLOW); follow(); } });
    return () => { live = false; };
  }, [open, q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const paid = (q?.kind === 'pay' && !!q.answeredAt) || (!q && r?.kind === 'pay' && r.paid) || paidHere;
  const amount = num(r?.amount ?? q?.amount); const tip = num(r?.tip ?? q?.tip);

  if (s === undefined) return <VisitShell brand={brand} chip="Pay" title={<>Your <b>total</b></>}><VisitMuted>Getting your total…</VisitMuted></VisitShell>;
  if (paid) return (
    <VisitShell brand={brand} chip="Paid" kicker={<span className="mb-2 inline-block"><VisitCheck /></span>} title={first ? <>Thank you, <b>{first}</b></> : <>Thank <b>you</b></>}
      subtitle={amount > 0 ? `Paid ${money(amount)}${tip > 0 ? `, including a ${money(tip)} tip` : ''}.` : 'You’re all paid.'}>
      {r?.saved && <p className="v-note">Your card is saved for next time.</p>}
      <VisitButton onClick={onClose}>Done</VisitButton>
    </VisitShell>
  );
  if (!open) return (
    <VisitShell brand={brand} title={<>Nothing to <b>pay</b> right now</>} subtitle="The payment was taken another way, or we’ll send it again.">
      <VisitButton quiet onClick={onClose}>Back to your visit</VisitButton>
    </VisitShell>
  );
  const key = view ? `${view.publishableKey}|${view.stripeAccount}` : '';
  if (view && view.publishableKey && !stripes.has(key)) stripes.set(key, loadStripe(view.publishableKey, { stripeAccount: view.stripeAccount }));
  const night = brand.mood === 'night';
  return (
    <VisitShell brand={brand} chip="Pay" title={first ? <>Thanks for coming in, <b>{first}</b></> : <>Thanks for <b>coming in</b></>}>
      <Bill tk={tk} q={q} />
      <VisitSaid text={backNote} />
      {viewErr ? <VisitSaid text={viewErr} />
        : !view ? <VisitMuted>Getting the payment ready…</VisitMuted>
        : !view.publishableKey ? <VisitSaid text={shape?.desk === false ? `Card payments aren’t set up here yet. Please pay ${inPerson(shape, provider)} directly.` : 'Card payments aren’t set up here yet. Please pay at the front desk.'} />
        : <Elements key={q.id} stripe={stripes.get(key)!} options={{ clientSecret: view.clientSecret, appearance: { theme: night ? 'night' : 'stripe', variables: { colorPrimary: brand.accent || '#16171a', borderRadius: '14px', fontSizeBase: '16px', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' } } }}>
            <PayForm screenId={screenId} q={q} provider={provider} onPaid={() => setPaidHere(true)} slow={slow} setSlow={setSlow} onBusy={setBusy} />
          </Elements>}
      {!busy && !slow && <VisitButton quiet onClick={onClose}>Back to your visit</VisitButton>}
    </VisitShell>
  );
}
