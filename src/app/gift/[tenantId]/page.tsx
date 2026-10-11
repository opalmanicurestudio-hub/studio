'use client';
// src/app/gift/[tenantId]/page.tsx — BUY A GIFT CARD (lib/gift-shop, /api/gift-cards/shop). The business's own gift card
// page: amount → design → who it's for and a note → how and when it's sent → pay, with the card drawn live as they go.
// Payment opens inside the page; the card is made the moment it's paid, and the buyer gets a receipt with a private link
// to see it and change when it sends.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { COLLECTIONS, COLLECTION_NOTE, designsSync, type GiftDesign } from '@/lib/gift-designs';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', RED = '#b42318';
const STEPS = ['Amount', 'Design', 'Message', 'Delivery', 'Pay'] as const;
const field = 'h-12 w-full rounded-2xl border px-4 text-[15.5px] outline-none focus:ring-2 focus:ring-black/10';
const fs = { borderColor: LINE, background: '#fff' } as const;
const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n.toFixed(0)}`;
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function Pill({ on, children, onClick, label }: { on?: boolean; children: React.ReactNode; onClick: () => void; label?: string }) {
  return <button type="button" aria-pressed={!!on} aria-label={label} onClick={onClick} className="h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold transition-colors"
    style={on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{children}</button>;
}

export default function GiftShopPage() {
  const tenantId = String(useParams<{ tenantId: string }>()?.tenantId || '');
  const [shop, setShop] = React.useState<any>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((x) => (x.ok ? setShop(x) : setErr(x.error || 'This page isn’t available.'))).catch(() => setErr('We couldn’t load this — check your connection.')); }, [tenantId]);
  const designs: GiftDesign[] = React.useMemo(() => (shop ? designsSync().filter((d) => shop.designs.includes(d.id)) : []), [shop]);
  const [step, setStep] = React.useState(0);
  // choices
  const [amount, setAmount] = React.useState<number | null>(null); const [other, setOther] = React.useState('');
  const [designId, setDesignId] = React.useState(''); const [col, setCol] = React.useState('');
  const [line, setLine] = React.useState<string | null>(null);
  const [forSelf, setForSelf] = React.useState(false); const [to, setTo] = React.useState(''); const [from, setFrom] = React.useState(''); const [note, setNote] = React.useState('');
  const [email, setEmail] = React.useState(''); const [via, setVia] = React.useState<'email' | 'text' | 'me'>('email');
  const [toEmail, setToEmail] = React.useState(''); const [toPhone, setToPhone] = React.useState('');
  const [when, setWhen] = React.useState<'now' | 'later'>('now'); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('09:00');
  const [pay, setPay] = React.useState<{ orderId: string; clientSecret: string; stripeAccountId: string; publishableKey: string } | null>(null);
  const [busy, setBusy] = React.useState(false); const [stepErr, setStepErr] = React.useState('');
  const [done, setDone] = React.useState<{ manage?: string } | null>(null);

  React.useEffect(() => { if (!shop) return; setAmount(shop.amounts[Math.min(1, shop.amounts.length - 1)] ?? null);
    const sp = new URLSearchParams(window.location.search); const wd = designs.find((d) => d.id === sp.get('design'));
    const firstOcc = designs.find((d) => d.collection === 'Occasions' && d.season); const pick = wd || firstOcc || designs[0];
    setDesignId(pick?.id || ''); setCol(pick?.collection || '');
    const who = (sp.get('to') || '').trim().slice(0, 80); if (who) { setTo(who); setForSelf(false); }
    const want = Number(sp.get('amount')); if (want > 0) { if (shop.amounts.includes(want)) setAmount(want); else if (shop.custom && want >= shop.min && want <= shop.max) setOther(String(want)); } }, [shop]); // eslint-disable-line react-hooks/exhaustive-deps
  const design = designs.find((d) => d.id === designId) || designs[0];
  const amt = other ? Number(other) : amount || 0;
  const amtOk = !!shop && amt >= shop.min && amt <= shop.max;
  const sendAt = via !== 'me' && when === 'later' && day ? new Date(`${day}T${time || '09:00'}:00`) : null;
  const lineShown = line === null ? design?.line || '' : line;
  const stepOk = [amtOk, !!design, forSelf || !!to.trim(), via === 'me' ? true : via === 'email' ? /\S+@\S+\.\S+/.test(forSelf ? email : toEmail) : toPhone.replace(/\D/g, '').length >= 10, true];
  const whoOk = from.trim() && /\S+@\S+\.\S+/.test(email);
  const go = (n: number) => { setStepErr(''); setStep(n); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const stripePromise = React.useMemo(() => (pay?.publishableKey ? loadStripe(pay.publishableKey, { stripeAccount: pay.stripeAccountId }) : null), [pay]);
  const start = async () => {
    if (!whoOk) { setStepErr('Add your name and email for the receipt.'); return; }
    if (sendAt && sendAt.getTime() < Date.now() + 5 * 60000) { setStepErr('Choose a send time later than now.'); return; }
    setBusy(true); setStepErr('');
    const r = await fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', tenantId, amount: amt, design: design.id, line: lineShown,
      buyerName: from.trim(), buyerEmail: email.trim(), forSelf, recipientName: to.trim(), via, recipientEmail: forSelf ? email.trim() : toEmail.trim(), recipientPhone: toPhone, message: note.trim(), sendAt: sendAt ? sendAt.toISOString() : null }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
    setBusy(false); if (!r.ok) { setStepErr(r.error || 'Something went wrong.'); return; } setPay(r);
  };
  const confirm = React.useCallback(async () => {
    if (!pay) return; setDone({});
    for (let i = 0; i < 8; i++) { const r = await fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', tenantId, orderId: pay.orderId }) }).then((x) => x.json()).catch(() => null);
      if (r?.paid) { setDone({ manage: r.manage }); return; } await new Promise((res) => setTimeout(res, 1500)); }
  }, [pay, tenantId]);

  const A = shop?.brand?.accent || INK;
  const [cardW, setCardW] = React.useState(340);
  React.useEffect(() => { const f = () => setCardW(window.innerWidth >= 768 ? 460 : Math.min(360, window.innerWidth - 40)); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const preview = design && shop ? <GiftCardFace design={design} brand={shop.brand} amount={amtOk ? money(amt) : '$—'} name={forSelf ? from || 'You' : to || 'Their name'} line={lineShown} width={cardW} /> : null;

  return (
    <div className="min-h-dvh" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: `radial-gradient(1200px 600px at 10% -10%, color-mix(in srgb, ${A} 10%, #fff) 0%, transparent 60%), radial-gradient(900px 500px at 110% 10%, #eef0f6 0%, transparent 55%), #f7f7f8` }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
      <style>{`.gcf-pick:focus-visible{outline:2px solid ${INK};outline-offset:4px}`}</style>
      {err ? <p className="px-6 pt-24 text-center text-[16px] font-semibold">{err}</p> : !shop ? <p className="pt-24 text-center" style={{ color: MUTED }}>Loading…</p> : !shop.open ? (
        <div className="mx-auto max-w-md px-6 pt-24 text-center"><p className="text-[13.5px]" style={{ color: MUTED }}>{shop.brand.name}</p><h1 className="mt-2 text-[30px] font-normal tracking-[-0.03em]">Gift cards</h1>
          <p className="mt-3 text-[15px]" style={{ color: MUTED }}>Gift cards aren’t sold online here right now.{shop.brand.phone ? ` Call ${shop.brand.phone} and we’ll set one up for you.` : ' Ask us at your next visit.'}</p></div>
      ) : done ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-6 px-5 pb-16 pt-14 text-center">
          <div className="gcf-float">{preview}</div>
          {done.manage ? <>
            <div><h1 className="text-[30px] font-normal tracking-[-0.03em]">Thank you, {from.split(' ')[0]}</h1>
              <p className="mt-2 text-[15.5px] leading-relaxed" style={{ color: MUTED }}>{via === 'me' ? 'Your gift card is ready — open it to print it or forward the link.' : sendAt ? `It will be ${via === 'text' ? 'texted' : 'emailed'} to ${forSelf ? 'you' : to.split(' ')[0]} on ${sendAt.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : `We’ve ${via === 'text' ? 'texted' : 'emailed'} it to ${forSelf ? 'you' : to.split(' ')[0]}.`} Your receipt is on its way to {email}.</p></div>
            <a href={done.manage} className="flex h-13 w-full items-center justify-center rounded-full py-3.5 text-[15.5px] font-semibold text-white" style={{ background: INK }}>See or change your gift</a>
            <button type="button" onClick={() => window.location.reload()} className="text-[14px] font-semibold underline underline-offset-4">Send another</button>
          </> : <p className="text-[15px]" style={{ color: MUTED }}>Confirming your payment…</p>}
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 pb-28 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-14 md:px-8 md:pt-12">
          {/* The card, drawn as they choose */}
          <div className="min-w-0 md:sticky md:top-10 md:self-start">
            <div className="flex items-center gap-2.5">{shop.brand.logo ? <img src={shop.brand.logo} alt="" className="h-9 w-9 rounded-xl object-cover" /> : null}<span className="text-[15px] font-semibold">{shop.brand.name}</span></div>
            <h1 className="mt-5 hidden text-[40px] font-normal leading-[1.05] tracking-[-0.03em] md:block">Give a gift card</h1>
            <p className="mt-2 hidden max-w-sm text-[15px] md:block" style={{ color: MUTED }}>Choose a design, write a note, and pick the moment it arrives.</p>
            <div className="mt-6 flex justify-center md:mt-10 md:justify-start"><div className="gcf-float">{preview}</div></div>
            {note.trim() && step >= 2 ? <p className="mx-auto mt-5 max-w-[340px] text-center text-[14.5px] italic leading-relaxed md:mx-0 md:text-left" style={{ color: MUTED }}>“{note.trim()}”{from ? ` — ${from.split(' ')[0]}` : ''}</p> : null}
          </div>

          {/* The steps */}
          <div className="min-w-0 rounded-[22px] bg-white p-5 md:p-7" style={{ boxShadow: '0 1px 0 rgba(22,23,26,.04), 0 18px 40px rgba(22,23,26,.06)' }}>
            <ol className="mb-6 flex gap-1.5" aria-label="Steps">{STEPS.map((s, i) => <li key={s} className="flex-1"><button type="button" disabled={i > step || !!pay} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined} className="w-full text-left disabled:cursor-default">
              <span className="block h-1 rounded-full" style={{ background: i <= step ? INK : LINE }} /><span className="mt-1.5 block text-[11.5px] font-semibold" style={{ color: i === step ? INK : MUTED }}>{s}</span></button></li>)}</ol>

            {step === 0 && <section className="space-y-4" aria-label="Amount">
              <h2 className="text-[24px] font-normal tracking-[-0.02em]">How much?</h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{shop.amounts.map((v: number) => <button key={v} type="button" aria-pressed={!other && amount === v} onClick={() => { setAmount(v); setOther(''); }} className="h-16 rounded-2xl text-[22px] font-normal tracking-[-0.02em]" style={!other && amount === v ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}` }}>{money(v)}</button>)}</div>
              {shop.custom && <label className="block"><span className="mb-1.5 block text-[13px] font-semibold" style={{ color: MUTED }}>Or another amount ({money(shop.min)}–{money(shop.max)})</span>
                <input value={other} onChange={(e) => setOther(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))} inputMode="decimal" placeholder="$" className={field} style={fs} /></label>}
              {other && !amtOk && <p className="text-[13.5px] font-semibold" style={{ color: RED }}>Choose an amount from {money(shop.min)} to {money(shop.max)}.</p>}
            </section>}

            {step === 1 && <section className="space-y-4" aria-label="Design">
              <h2 className="text-[24px] font-normal tracking-[-0.02em]">Choose a design</h2>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">{COLLECTIONS.filter((c) => designs.some((d) => d.collection === c)).map((c) => <Pill key={c} on={col === c} onClick={() => setCol(c)}>{c === 'Occasions' ? 'Occasions' : c}</Pill>)}</div>
              <p className="text-[13.5px]" style={{ color: MUTED }}>{COLLECTION_NOTE[col]}</p>
              <div className="grid grid-cols-2 gap-3">{designs.filter((d) => d.collection === col).map((d) => <button key={d.id} type="button" aria-pressed={d.id === designId} onClick={() => { setDesignId(d.id); setLine(null); }} className="gcf-pick flex flex-col gap-1.5 rounded-[14px] text-left">
                <span className="block w-full rounded-[12px] p-[3px]" style={{ outline: d.id === designId ? `2px solid ${INK}` : 'none', outlineOffset: 2 }}><DesignThumb d={d} brand={shop.brand} /></span>
                <span className="px-0.5 text-[13px] font-semibold">{d.name}</span></button>)}</div>
            </section>}

            {step === 2 && <section className="space-y-4" aria-label="Message">
              <h2 className="text-[24px] font-normal tracking-[-0.02em]">Who’s it for?</h2>
              <div className="flex gap-1.5"><Pill on={!forSelf} onClick={() => setForSelf(false)}>Someone else</Pill><Pill on={forSelf} onClick={() => setForSelf(true)}>Me</Pill></div>
              {!forSelf && <input value={to} onChange={(e) => setTo(e.target.value.slice(0, 80))} placeholder="Their name" aria-label="Their name" className={field} style={fs} />}
              <label className="block"><span className="mb-1.5 block text-[13px] font-semibold" style={{ color: MUTED }}>Line on the card</span>
                <input value={lineShown} onChange={(e) => setLine(e.target.value.slice(0, 30))} placeholder="e.g. Happy birthday" className={field} style={fs} /></label>
              {!forSelf && <label className="block"><span className="mb-1.5 flex justify-between text-[13px] font-semibold" style={{ color: MUTED }}><span>A note to them</span><span>{note.length}/400</span></span>
                <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 400))} rows={4} placeholder="Write something they’ll smile at…" className="w-full rounded-2xl border px-4 py-3 text-[15.5px] leading-relaxed outline-none focus:ring-2 focus:ring-black/10" style={fs} /></label>}
            </section>}

            {step === 3 && <section className="space-y-4" aria-label="Delivery">
              <h2 className="text-[24px] font-normal tracking-[-0.02em]">How should it arrive?</h2>
              <div className="flex flex-wrap gap-1.5"><Pill on={via === 'email'} onClick={() => setVia('email')}>Email</Pill><Pill on={via === 'text'} onClick={() => setVia('text')}>Text</Pill><Pill on={via === 'me'} onClick={() => setVia('me')}>{forSelf ? 'Just give me the card' : 'I’ll give it to them'}</Pill></div>
              {via === 'email' && !forSelf && <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} inputMode="email" autoComplete="off" placeholder="Their email" aria-label="Their email" className={field} style={fs} />}
              {via === 'email' && forSelf && <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" placeholder="Your email" aria-label="Your email" className={field} style={fs} />}
              {via === 'text' && <input value={toPhone} onChange={(e) => setToPhone(e.target.value)} inputMode="tel" placeholder={forSelf ? 'Your mobile number' : 'Their mobile number'} aria-label="Mobile number" className={field} style={fs} />}
              {via === 'me' && <p className="text-[14px] leading-relaxed" style={{ color: MUTED }}>You’ll get the card by email — print it, forward it, or show the code.</p>}
              {via !== 'me' && <div className="space-y-3 rounded-2xl p-4" style={{ background: SOFT }}>
                <div className="flex gap-1.5"><Pill on={when === 'now'} onClick={() => setWhen('now')}>Right away</Pill><Pill on={when === 'later'} onClick={() => { setWhen('later'); if (!day) setDay(localDay(new Date(Date.now() + 864e5))); }}>On a day I choose</Pill></div>
                {when === 'later' && <div className="grid grid-cols-[1.4fr_1fr] gap-2">
                  <input type="date" value={day} min={localDay(new Date())} max={localDay(new Date(Date.now() + 365 * 864e5))} onChange={(e) => setDay(e.target.value)} aria-label="Day" className={field} style={fs} />
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className={field} style={fs} /></div>}
                {when === 'later' && sendAt && <p className="text-[13px]" style={{ color: MUTED }}>Arrives {sendAt.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (your time). You can change this later.</p>}
              </div>}
            </section>}

            {step === 4 && <section className="space-y-4" aria-label="Pay">
              <h2 className="text-[24px] font-normal tracking-[-0.02em]">{pay ? 'Pay' : 'Almost done'}</h2>
              <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: SOFT }}>
                <GiftCardFace design={design} brand={shop.brand} amount={money(amt)} name={forSelf ? from || 'You' : to} line={lineShown} width={120} />
                <div className="min-w-0 text-[14px] leading-snug"><b>{money(amt)} gift card</b><br />{forSelf ? 'For you' : `For ${to}`}{from ? `, from ${from.split(' ')[0]}` : ''}<br />
                  <span style={{ color: MUTED }}>{via === 'me' ? 'Emailed to you to give' : `${via === 'text' ? 'Texted' : 'Emailed'} ${sendAt ? sendAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'right away'}`}</span></div></div>
              {!pay ? <>
                <input value={from} onChange={(e) => setFrom(e.target.value.slice(0, 80))} autoComplete="name" placeholder="Your name" aria-label="Your name" className={field} style={fs} />
                {!(via === 'email' && forSelf) && <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" placeholder="Your email (for the receipt)" aria-label="Your email" className={field} style={fs} />}
                <div className="rounded-2xl border p-4 text-[13.5px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}><b style={{ color: INK }}>Gift card rules</b><br />{shop.rules}</div>
              </> : stripePromise ? <div className="overflow-hidden rounded-2xl"><EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: pay.clientSecret, onComplete: confirm }}><EmbeddedCheckout /></EmbeddedCheckoutProvider></div>
                : <p className="text-[14px]" style={{ color: RED }}>Card payments aren’t set up on this page yet.</p>}
            </section>}

            {stepErr && <p className="mt-4 text-[14px] font-semibold" style={{ color: RED }} role="alert">{stepErr}</p>}
            {!pay && <div className="mt-7 flex items-center gap-3">
              {step > 0 && <button type="button" onClick={() => go(step - 1)} className="h-12 rounded-full px-5 text-[15px] font-semibold" style={{ background: SOFT }}>Back</button>}
              {step < 4 ? <button type="button" disabled={!stepOk[step]} onClick={() => go(step + 1)} className="h-12 flex-1 rounded-full text-[15.5px] font-semibold text-white disabled:opacity-35" style={{ background: INK }}>Next — {STEPS[step + 1] === 'Message' ? 'who it’s for' : STEPS[step + 1].toLowerCase()}</button>
                : <button type="button" disabled={busy || !whoOk} onClick={start} className="h-12 flex-1 rounded-full text-[15.5px] font-semibold text-white disabled:opacity-35" style={{ background: INK }}>{busy ? 'Opening payment…' : `Continue to pay ${money(amt)}`}</button>}
            </div>}
          </div>
        </div>
      )}
      <style>{`@media (hover:hover){.gcf-float{transition:transform .5s cubic-bezier(.2,.8,.2,1)}.gcf-float:hover{transform:translateY(-4px) rotate(-1deg)}}`}</style>
    </div>);
}

/** A design tile that fills its column (the card scales to fit). */
function DesignThumb({ d, brand }: { d: GiftDesign; brand: any }) {
  const ref = React.useRef<HTMLDivElement>(null); const [w, setW] = React.useState(150);
  React.useLayoutEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(Math.max(80, Math.floor(el.clientWidth)))); ro.observe(el); return () => ro.disconnect(); }, []);
  return <div ref={ref} className="w-full"><GiftCardFace design={d} brand={brand} amount="$100" name=" " line={d.line || ''} width={w} /></div>;
}
