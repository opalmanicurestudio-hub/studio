'use client';
// src/app/bill/[tenantId]/[token]/page.tsx — A GUEST PAYS THEIR SHARE OF THE TABLE'S CHECK ON THEIR OWN PHONE (design
// canvas PayAtTable), in the business's look. They pick what they're paying for (their seat, some items, or an even
// part, as the business allows and the first payment set for the table), a tip (the business's choices, worked out
// before or after tax as it set), and pay on the card company's own form (card, Apple Pay, Google Pay where the phone
// has them). What's paid or being paid by someone else can't be picked; the amounts come from the server
// (lib/table-bill, the same working as the server's). Paid: the server sees it, no need to wait. /api/table-pay.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitSaid, VisitCheck, brandFromLook, useLook } from '@/components/booking/VisitShell';
import { shareFor, tipFor, type Bill, type Choice, type PayState, type SplitWay } from '@/lib/table-bill';

const POLL_MS = 15000;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const WAY_WORDS: Record<SplitWay, string> = { seat: 'By seat', item: 'By item', even: 'Evenly' };
type Line = { lineId: string; name: string; seat: number | null; price: number; comped: boolean; state: 'paid' | 'busy' | 'open' };
type Claim = { claimId: string; amount: number; tip: number; label: string; clientSecret: string; publishableKey: string; stripeAccount: string };
const stripes = new Map<string, Promise<any>>();
const stripeFor = (pk: string, acct?: string) => { const k = `${pk}|${acct || ''}`; if (!stripes.has(k)) stripes.set(k, loadStripe(pk, { stripeAccount: acct })); return stripes.get(k)!; };

function Box({ on, off }: { on: boolean; off?: boolean }) {
  return <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px]" style={{ background: on ? 'var(--accent)' : 'transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--line)', opacity: off ? 0.4 : 1 }}>
    {on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}</span>;
}

function PayForm({ claim, post, onPaid, onBack }: { claim: Claim; post: (a: string, x?: any) => Promise<any>; onPaid: () => void; onBack: () => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [stuck, setStuck] = React.useState(false);
  const [lapsed, setLapsed] = React.useState(false);
  // While the card form is open, what they picked stays theirs (asked every few minutes; it runs out an hour after
  // they picked).
  React.useEffect(() => {
    const i = window.setInterval(() => { if (busy || stuck) return;
      void post('keep', { claimId: claim.claimId }).then((r) => { if (r?.ok && r.kept === false) setLapsed(true); }); }, 4 * 60000);
    return () => window.clearInterval(i);
  }, [claim.claimId, post, busy, stuck]);
  const pay = async () => {
    if (!stripe || !elements) return; setBusy(true); setErr('');
    const res = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (res.error) { setBusy(false); setErr(res.error.message || 'The payment didn’t go through.'); return; }
    // The server asks the card company (a few times, while it's going through).
    for (let i = 0; i < 6; i++) {
      const r = await post('done', { claimId: claim.claimId });
      if (r?.ok && r.paid) { onPaid(); return; }
      if (!r?.pending) { setErr(r?.error || 'We couldn’t confirm the payment. Show this screen to your server.'); setBusy(false); setStuck(true); return; }
      await new Promise((x) => setTimeout(x, 1500));
    }
    setErr('Your payment is still going through. Your server sees it as soon as it’s done.'); setBusy(false); setStuck(true);
  };
  return (
    <div className="space-y-3">
      {lapsed ? <VisitMuted>This was held for you for an hour, so it’s been let go. Pick what you’re paying for again.</VisitMuted> : <>
        <PaymentElement options={{ layout: 'tabs' }} />
        <VisitSaid text={err} />
        <VisitButton disabled={busy || stuck || !stripe} onClick={pay}>{busy ? 'Paying…' : `Pay ${money(claim.amount + claim.tip)}`}</VisitButton></>}
      {!busy && !stuck && <VisitButton quiet onClick={onBack}>{lapsed ? 'Pick again' : 'Change what I’m paying for'}</VisitButton>}
    </div>
  );
}

export default function TableBill() {
  const { tenantId, token } = useParams() as { tenantId: string; token: string };
  const [v, setV] = React.useState<any>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [way, setWay] = React.useState<SplitWay | 'rest' | null>(null);
  const [seats, setSeats] = React.useState<number[]>([]); const [items, setItems] = React.useState<string[]>([]);
  const [ways, setWays] = React.useState(2); const [parts, setParts] = React.useState(1);
  const [tipPct, setTipPct] = React.useState<number | null>(null); const [other, setOther] = React.useState<string | null>(null);
  const [claim, setClaim] = React.useState<Claim | null>(null); const [paid, setPaid] = React.useState(false);
  const post = React.useCallback((action: string, extra: any = {}) => fetch('/api/table-pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action, ...extra }) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection. Try again in a moment.' })), [tenantId, token]);
  const load = React.useCallback(() => post('view').then((r) => setV((prev: any) => (r?.ok || !prev?.ok ? r : prev))), [post]);
  React.useEffect(() => {
    void load(); const i = window.setInterval(() => { if (document.visibilityState === 'visible' && !claim) void load(); }, POLL_MS);
    return () => window.clearInterval(i);
  }, [load, claim]);
  // The table's way of splitting once someone has paid; otherwise the business's first.
  React.useEffect(() => { if (!v?.ok || v.state !== 'open') return;
    if (v.split?.way && way !== 'rest' && way !== v.split.way) setWay(v.split.way);
    else if (!way) setWay(v.settings.ways[0]);
    if (tipPct === null && other === null) setTipPct(v.settings.suggest ?? null);
    if (v.split?.ways) setWays(v.split.ways);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const { look, ready } = useLook(tenantId, v?.look);
  const brand = brandFromLook(look, tenantId); if (!brand.studioName && v?.business) brand.studioName = v.business;
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link isn’t working"><VisitCard><VisitMuted>{v.error || 'Ask your server for the check.'}</VisitMuted></VisitCard></VisitShell>;
  if (paid) return <VisitShell brand={brand} title="Paid. Thank you!" subtitle="Your server sees it’s paid. No need to wait."><div className="flex justify-center py-2"><VisitCheck /></div></VisitShell>;
  if (v.state === 'closed') return <VisitShell brand={brand} title="This check is closed" subtitle="Thank you for coming in." />;
  if (v.state === 'wait') return <VisitShell brand={brand} title={v.table || 'Your check'}><VisitCard><VisitMuted>{v.why}</VisitMuted></VisitCard></VisitShell>;

  // The check as the server works it out, to show what each choice comes to (the server works it out again to charge).
  const lines: Line[] = v.lines || [];
  const bill: Bill = { lines: lines.map((l) => ({ lineId: l.lineId, itemId: '', name: l.name, seat: l.seat, price: l.price, comped: l.comped, type: 'product' })), items: [], subtotal: v.subtotal, discount: v.discount, tax: v.tax, total: v.total, unfired: [], missing: [] };
  const st: PayState = { covered: new Set(v.covered || []), busy: new Set(v.busy || []), paid: v.paid, claimed: v.claimed, way: v.split?.way || null, ways: v.split?.ways || 0, partsTaken: v.split?.partsTaken || 0 };
  const s = { on: true, ways: v.settings.ways, tips: v.settings.tips, tipBase: v.settings.tipBase, suggest: v.settings.suggest };
  const left = Math.max(0, Math.round((v.total - v.paid - v.claimed) * 100) / 100);
  const choice: Choice | null = way === 'seat' ? { way: 'seat', seats } : way === 'item' ? { way: 'item', lineIds: items } : way === 'even' ? { way: 'even', ways, parts } : way === 'rest' ? { way: 'rest' } : null;
  const sh = choice ? shareFor(bill, st, choice, s as any) : null;
  const tipAmt = sh && sh.ok ? tipFor(sh, other !== null ? { amount: Number(other) || 0 } : { pct: tipPct ?? 0 }, s as any) : 0;
  const seatList = Array.from(new Set(lines.map((l) => l.seat ?? 0))).sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const seatLines = (n: number) => lines.filter((l) => (l.seat ?? 0) === n);
  const seatState = (n: number) => { const ls = seatLines(n); return ls.every((l) => l.state === 'paid') ? 'paid' : ls.every((l) => l.state !== 'open') ? 'busy' : 'open'; };
  const seatAmt = (n: number) => { const r = shareFor(bill, st, { way: 'seat', seats: [n] }, s as any); return r.ok ? r.amount : 0; };
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const partsLeft = Math.max(0, (st.ways || ways) - st.partsTaken);

  const start = async () => {
    if (!choice || !sh || !sh.ok) return; setBusy(true); setErr('');
    const r = await post('start', { choice, tip: other !== null ? { amount: Number(other) || 0 } : { pct: tipPct ?? 0 }, replace: claim?.claimId || null });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through.'); void load(); return; }
    setClaim(r);
  };
  const back = async () => { if (claim) await post('cancel', { claimId: claim.claimId }); setClaim(null); void load(); };

  return (
    <VisitShell brand={brand} kicker={v.table} title={claim ? `Pay ${money(claim.amount + claim.tip)}` : 'Pay your share'} subtitle={claim ? `${claim.label}, with tax${claim.tip > 0 ? ' and tip' : ''}` : v.paid > 0 ? `${money(v.paid)} of ${money(v.total)} is paid` : `The check comes to ${money(v.total)}`}>
      {claim ? (
        <VisitCard>
          <Elements stripe={stripeFor(claim.publishableKey, claim.stripeAccount)} options={{ clientSecret: claim.clientSecret, appearance: { theme: 'stripe' } }}>
            <PayForm claim={claim} post={post} onPaid={() => { setPaid(true); setClaim(null); }} onBack={back} />
          </Elements>
        </VisitCard>
      ) : <>
        {(s.ways.length > 1 || v.paid > 0) && (
          <div role="radiogroup" aria-label="How you’re splitting" className="flex flex-wrap gap-2">
            {s.ways.filter((w: SplitWay) => !st.way || st.way === w).map((w: SplitWay) => <button key={w} type="button" role="radio" aria-checked={way === w} onClick={() => setWay(w)} className="v-pill">{WAY_WORDS[w]}</button>)}
            {v.paid > 0 && <button type="button" role="radio" aria-checked={way === 'rest'} onClick={() => setWay('rest')} className="v-pill">The rest, {money(left)}</button>}
          </div>)}

        {way === 'seat' && <div className="v-grp">{seatList.map((n) => { const stt = seatState(n); const on = seats.includes(n);
          return (
            <button key={n} type="button" role="checkbox" aria-checked={on} disabled={stt !== 'open'} onClick={() => setSeats(toggle(seats, n))} className="v-row w-full text-left disabled:opacity-60" style={{ minHeight: 60 }}>
              <Box on={on} off={stt !== 'open'} />
              <span className="min-w-0 flex-1"><span className="block font-semibold">{n ? `Seat ${n}` : 'For the table'}</span>
                <span className="block truncate text-[13px]" style={{ color: 'var(--muted)' }}>{stt === 'paid' ? 'Paid by someone at the table' : stt === 'busy' ? 'Being paid right now' : seatLines(n).filter((l) => l.state === 'open').map((l) => l.name).join(', ')}</span></span>
              {stt === 'open' && <span className="font-semibold tabular-nums">{money(seatAmt(n))}</span>}
            </button>); })}</div>}

        {way === 'item' && <div className="v-grp">{lines.map((l) => { const on = items.includes(l.lineId);
          return (
            <button key={l.lineId} type="button" role="checkbox" aria-checked={on} disabled={l.state !== 'open'} onClick={() => setItems(toggle(items, l.lineId))} className="v-row w-full text-left disabled:opacity-60" style={{ minHeight: 56 }}>
              <Box on={on} off={l.state !== 'open'} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{l.name}</span>
                <span className="block text-[13px]" style={{ color: 'var(--muted)' }}>{l.state === 'paid' ? 'Paid' : l.state === 'busy' ? 'Being paid right now' : l.seat ? `Seat ${l.seat}` : 'For the table'}</span></span>
              <span className="tabular-nums" style={{ color: l.state === 'open' ? 'var(--ink)' : 'var(--muted)' }}>{money(l.price)}</span>
            </button>); })}</div>}

        {way === 'even' && <VisitCard>
          <div className="flex items-center justify-between gap-3"><span className="font-semibold">Split between</span>
            {st.ways ? <span className="font-semibold">{st.ways} people</span> : <span className="flex items-center gap-2">
              <button type="button" aria-label="Fewer people" disabled={ways <= 2} onClick={() => { setWays(ways - 1); setParts(1); }} className="v-pill grid w-11 place-items-center px-0 text-[20px]">−</button>
              <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{ways}</span>
              <button type="button" aria-label="More people" disabled={ways >= 12} onClick={() => setWays(ways + 1)} className="v-pill grid w-11 place-items-center px-0 text-[20px]">+</button></span>}</div>
          {partsLeft > 1 && <div className="flex items-center justify-between gap-3 pt-2"><span>You’re paying for</span><span className="flex items-center gap-2">
            <button type="button" aria-label="Fewer shares" disabled={parts <= 1} onClick={() => setParts(parts - 1)} className="v-pill grid w-11 place-items-center px-0 text-[20px]">−</button>
            <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{parts}</span>
            <button type="button" aria-label="More shares" disabled={parts >= partsLeft} onClick={() => setParts(parts + 1)} className="v-pill grid w-11 place-items-center px-0 text-[20px]">+</button></span></div>}
        </VisitCard>}

        {sh && sh.ok && <section aria-label="Tip" className="space-y-2">
          <p className="px-1 text-[15px] font-semibold">Tip</p>
          <div className="flex flex-wrap gap-2">
            {s.tips.map((p: number) => <button key={p} type="button" aria-pressed={other === null && tipPct === p} onClick={() => { setTipPct(p); setOther(null); }} className="v-pill flex-1">
              <span className="block leading-tight">{p}%<span className="block text-[11.5px] font-medium opacity-80">{money(tipFor(sh, { pct: p }, s as any))}</span></span></button>)}
            <button type="button" aria-pressed={other !== null} onClick={() => setOther(other ?? '')} className="v-pill flex-1">Other</button>
            <button type="button" aria-pressed={other === null && !tipPct} onClick={() => { setTipPct(0); setOther(null); }} className="v-pill flex-1 whitespace-nowrap">No tip</button>
          </div>
          {other !== null && <label className="block"><span className="sr-only">Tip amount</span>
            <input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))} placeholder="Tip in dollars" className="v-field h-12" /></label>}
          <p className="px-1 text-[13px]" style={{ color: 'var(--muted)' }}>{s.tipBase === 'pre' ? 'Worked out before tax' : 'Worked out on the total'}</p>
        </section>}

        <VisitSaid text={err || (sh && !sh.ok && (way === 'rest' || way === 'even') ? sh.error : '')} />
        <div className="space-y-2 pt-1">
          {sh && sh.ok && <p className="flex items-baseline justify-between px-1 text-[15px]"><span>{sh.label}, with tax{tipAmt > 0 ? ' and tip' : ''}</span><b className="text-[17px] font-semibold tabular-nums">{money(sh.amount + tipAmt)}</b></p>}
          <VisitButton disabled={busy || !sh || !sh.ok} onClick={start}>{busy ? 'One moment…' : sh && sh.ok ? `Pay ${money(sh.amount + tipAmt)}` : way === 'seat' ? 'Pick your seat' : way === 'item' ? 'Pick what you had' : 'Pay'}</VisitButton>
          <p className="px-1 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Your server sees it’s paid. No need to wait.</p>
        </div>
      </>}
    </VisitShell>
  );
}
