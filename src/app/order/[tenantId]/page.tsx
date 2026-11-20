'use client';
// src/app/order/[tenantId]/page.tsx — ORDER AHEAD, on the guest's own phone (api/counter/ahead, lib/counter-ahead). The
// menu with photos, an item's choices, the order, how and when they'll pick it up, and paying right there on the card
// company's own secure form. Then the order's own page (?o=…&s=…, the address it moves to once paid, so it can be opened
// again): the pickup code, how it's going, and I'm here. The order (not yet sent) is kept on the phone, so a guest who
// leaves the page finds it again. Right after something's added, what the business offers with it is asked once, on the
// same sheet (lib/menu-upgrades): the next size up, and things to go with it, each a tap.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Check, Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { MenuAsk } from '@/components/klair/MenuAsk';
import { TELL_TEAM } from '@/lib/klair-menu';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { offersFor, sizedUp, type OfferKind, type SizeUp } from '@/lib/menu-upgrades';
import { CURBSIDE_GEOFENCE_M, distanceMetres, roughEtaMinutes } from '@/lib/retail-orders';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex items-center justify-center gap-2 rounded-2xl px-4 font-semibold disabled:opacity-50 ${RING}`;
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
type Way = 'drive-thru' | 'inside' | 'curbside';
const WAY_WORDS: Record<Way, string> = { 'drive-thru': 'at the drive-thru', inside: 'inside', curbside: 'at the curb: we bring it to your car' };
const wayList = (ws: Way[]) => (ws.length > 1 ? `${ws.slice(0, -1).map((w) => WAY_WORDS[w].split(':')[0]).join(', ')} or ${WAY_WORDS[ws[ws.length - 1]].split(':')[0]}` : WAY_WORDS[ws[0]] || 'inside');
type Item = { id: string; name: string; section: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; choices: any[]; soldOut: boolean; calories?: number | null;
  upgrades?: { size: boolean; items: string[] } };
type Menu = { on: boolean; business: string; ways: Way[]; times: string[]; full?: string[]; asapFull?: boolean; filling?: boolean; busy?: { minutes: number } | null; klair?: { name: string } | null; sections: { name: string; items: Item[] }[]; timeZone?: string; points?: { unit: string; askJoin: boolean } | null };
type CartLine = { key: string; itemId: string; name: string; picks: Picks; choicesText: string; quantity: number; each: number; imageUrl: string | null; offer?: OfferKind };
/** Right after something's added: its line and how many were just added, what was offered with it (kept as it was first
 *  shown), and what's been taken ('size', or 'item:' and its id). */
type After = { key: string; itemId: string; qty: number; size: SizeUp | null; items: Item[]; took: string[] };
type Track = { business: string; number: string; name: string | null; state: string; paid: boolean; code: string | null; way: Way; at: string | null; kitchen: 'later' | 'making' | 'ready' | 'handed' | null; here: boolean; failed: string | null; curb?: { where: string | null; out: boolean; by: string | null; onWay?: boolean; eta?: number | null; found?: boolean } | null; geo?: { lat: number; lng: number } | null; earned?: number; unit?: string; lines: { name: string; quantity: number; choicesText: string | null; price: number }[]; total: number };

async function call(body: any) {
  try { const r = await fetch('/api/counter/ahead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; }
  catch { return { status: 0, d: { ok: false, error: 'No connection. Try again.' } }; }
}
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((x) => x.toString(16).padStart(2, '0')).join('');
const clock = (iso: string, tz?: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return new Date(iso).toLocaleTimeString(); } };
const stripes = new Map<string, Promise<any>>();
const stripeFor = (pk: string, acct?: string) => { const k = `${pk}|${acct || ''}`; if (!stripes.has(k)) stripes.set(k, loadStripe(pk, { stripeAccount: acct })); return stripes.get(k)!; };
const pickWords = (item: Item, picks: Picks) => { const p = priceChoices(item, picks); return p.ok ? p.text : ''; };

function Sheet({ title, onClose, children, foot }: { title: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null); const close = React.useRef(onClose); close.current = onClose;
  React.useEffect(() => {
    // (A sheet can say where the focus starts: the first thing marked data-start, else its first button.)
    const opener = document.activeElement as HTMLElement | null; (box.current?.querySelector<HTMLElement>('[data-start]:not([disabled])') || box.current?.querySelector<HTMLElement>('button, input'))?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; opener?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-[#fff] sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="min-w-0 truncate text-[20px] font-semibold tracking-tight" style={{ color: INK }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {foot && <div className="border-t px-5 py-4" style={{ borderColor: LINE }}>{foot}</div>}
      </div>
    </div>
  );
}

function ItemSheet({ item, onAdd, onClose }: { item: Item; onAdd: (picks: Picks, qty: number) => void; onClose: () => void }) {
  const [picks, setPicks] = React.useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = React.useState(1);
  const priced = priceChoices(item, picks); const each = Math.max(0, item.price + (priced.ok ? priced.extra : 0));
  return (
    <Sheet title={item.name} onClose={onClose} foot={
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="How many">
          <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Minus className="h-4 w-4" /></button>
          <span className="w-7 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
          <button type="button" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
        </div>
        <button type="button" disabled={!priced.ok} onClick={() => onAdd(picks, qty)} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={{ background: INK, color: '#fff' }}>Add{qty > 1 ? ` ${qty}` : ''}, {usd(each * qty)}</button>
      </div>}>
      {item.imageUrl && <img src={item.imageUrl} alt="" className="mb-4 aspect-[4/3] w-full rounded-2xl object-cover" style={{ background: SOFT }} />}
      {(item.words || item.calories != null) && <p className="mb-4 text-[15px] leading-relaxed" style={{ color: MUTED }}>{item.words}{item.words && item.calories != null ? ' ' : ''}{item.calories != null && <span className="whitespace-nowrap">({item.calories} cal)</span>}</p>}
      <ChoicePicker item={item} picks={picks} onChange={setPicks} />
      {!priced.ok && <p role="status" className="mt-3 text-[14px]" style={{ color: AMBER }}>{priced.error}</p>}
    </Sheet>
  );
}

/** Right after something's added (design canvas "Food numbers": Offered at the end): what the business offers with it,
 *  asked once. The size up changes the line just added; something to go with it is a line of its own (one with choices
 *  of its own opens its sheet, to pick them). Nothing taken: No thanks. */
function AfterSheet({ after, item, line, onSize, onItem, onClose }: { after: After; item: Item; line: CartLine | undefined; onSize: () => void; onItem: (x: Item) => void; onClose: () => void }) {
  const done = React.useRef<HTMLButtonElement>(null); const [said, setSaid] = React.useState('');
  const took = (k: string) => after.took.includes(k);
  // Only what was just added: one more latte added to two already in the order is the one asked about.
  // Taken: said out loud, and the focus goes to Done (the button tapped is gone).
  const tap = (f: () => void, words: string) => { f(); setSaid(words); requestAnimationFrame(() => done.current?.focus()); };
  const q = Math.max(1, Math.min(after.qty, line?.quantity || 1));
  const bigger = after.size && line && !took('size') ? priceChoices(item, sizedUp(line.picks, after.size)) : null;
  const added = (word: string) => <span className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[15px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}><Check className="h-4 w-4" aria-hidden />{word}</span>;
  return (
    <Sheet title="Added to your order" onClose={onClose} foot={
      <button ref={done} type="button" onClick={onClose} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{after.took.length ? 'Done' : 'No thanks'}</button>}>
      {line && <p className="flex items-start gap-2.5 text-[15px]">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: GREEN_TINT, color: GREEN }}><Check className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0" style={{ color: MUTED }}>{q > 1 ? `${q} ` : ''}{line.name}{line.choicesText ? `, ${line.choicesText}` : ''}. <span className="tabular-nums">{usd(line.each * q)}</span></span></p>}
      <p className="mt-5 text-[16px] font-semibold">Anything with it?</p>
      <ul className="mt-3 space-y-2">
        {after.size && (
          <li className="flex items-center gap-3 rounded-2xl p-3.5" style={{ border: `1px solid ${LINE}` }}>
            <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">Size up to {after.size.to}</span>
              {bigger?.ok && <span className="block text-[14px]" style={{ color: MUTED }}>{line!.name}, {bigger.text}. <span className="tabular-nums">{usd(Math.max(0, item.price + bigger.extra) * q)}</span>{q > 1 ? ' for all' : ''}</span>}</span>
            {took('size') ? added('Changed') : <button type="button" disabled={!bigger?.ok} onClick={() => tap(onSize, `Changed to ${after.size!.to}.`)} data-start aria-label={`Size up to ${after.size.to}, +${usd(after.size.adds * q)}`} className={`${btn} min-h-[44px] shrink-0 text-[15px] tabular-nums`} style={{ background: INK, color: '#fff' }}>+{usd(after.size.adds * q)}</button>}
          </li>)}
        {after.items.map((x) => (
          <li key={x.id} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ border: `1px solid ${LINE}` }}>
            {x.imageUrl && <img src={x.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" style={{ background: SOFT }} />}
            <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">{x.name}</span><span className="block text-[14px] tabular-nums" style={{ color: MUTED }}>{x.from ? `From ${usd(x.startPrice)}` : usd(x.price)}</span></span>
            {took(`item:${x.id}`) ? added('Added') : <button type="button" onClick={() => (x.choices.length ? onItem(x) : tap(() => onItem(x), `${x.name} added.`))} data-start className={`${btn} min-h-[44px] shrink-0 text-[15px]`} aria-label={`Add ${x.name}`} style={{ background: INK, color: '#fff' }}>Add</button>}
          </li>))}
      </ul>
      <p className="sr-only" aria-live="polite">{said}</p>
    </Sheet>
  );
}

function PayForm({ total, link, onPaid, onBusy }: { total: number; link: { tenantId: string; o: string; s: string }; onPaid: () => void; onBusy: (b: boolean) => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [held, setHeld] = React.useState('');
  // (While it's paying, the page can't go back and change the order.)
  React.useEffect(() => { onBusy(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = async () => {
    if (!stripe || !elements) return; setBusy(true); setErr('');
    const res = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (res.error) { setBusy(false); setErr(res.error.message || 'The payment didn’t go through.'); return; }
    for (let i = 0; i < 6; i++) {
      const { status, d } = await call({ action: 'done', ...link });
      if (d.ok && d.paid) { onPaid(); return; }
      if (status !== 202) { setErr(d.error || 'We couldn’t confirm the payment. Try again in a moment.'); if (d.notKept) setHeld('Refund on its way'); setBusy(false); return; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setErr('Your payment is still going through. This page updates once it’s done.'); setHeld('Going through…'); setBusy(false);
    onPaid();
  };
  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <button type="button" onClick={pay} disabled={busy || !!held || !stripe} className={`${btn} min-h-[56px] w-full text-[17px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Paying…' : held || `Pay ${usd(total)}`}</button>
    </div>
  );
}

/** Curbside on the guest's page (design canvas: Curbside): I'm on my way (what they're driving, and about how far, from
 *  their phone's location once if they allow it), I'm here (where they are, anything to know), and, while this page is
 *  open and they're on their way, checked in by their phone's location once they pull in (lib/retail-orders
 *  CURBSIDE_GEOFENCE_M; a web page can't follow a phone in a pocket, so I'm here always stays). Then: they know you're
 *  outside, and who's bringing it out. */
function CurbsideSteps({ t, tenantId, o, s, reload }: { t: Track; tenantId: string; o: string; s: string; reload: () => Promise<void> }) {
  const c = t.curb || { where: null, out: false, by: null };
  const [form, setForm] = React.useState<'here' | 'way' | null>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [where, setWhere] = React.useState(''); const [note, setNote] = React.useState(''); const [whereErr, setWhereErr] = React.useState('');
  const [watching, setWatching] = React.useState(false); const [found, setFound] = React.useState(false);
  const whereBox = React.useRef<HTMLInputElement | null>(null); const status = React.useRef<HTMLParagraphElement | null>(null);
  const missing = (msg: string) => { setWhereErr(msg); requestAnimationFrame(() => whereBox.current?.focus()); };
  // Found by location, but the car isn't said yet: asked for, so the runner knows what to look for.
  const needWhere = t.here && !c.where && !c.out;
  const open = form ?? (needWhere ? 'here' : null);
  // How far away, once (a prompt nobody answers doesn't hold the button: after 10 seconds it goes without).
  const howFar = (): Promise<number | null> => new Promise((res) => {
    if (!t.geo || typeof navigator === 'undefined' || !navigator.geolocation) { res(null); return; }
    const giveUp = setTimeout(() => res(null), 10000); const done = (v: number | null) => { clearTimeout(giveUp); res(v); };
    navigator.geolocation.getCurrentPosition((p) => done(roughEtaMinutes(distanceMetres({ lat: p.coords.latitude, lng: p.coords.longitude }, t.geo!))), () => done(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  });
  const send = async (action: 'here' | 'onway') => {
    if (action === 'here' && !where.trim()) { missing('Say where you are: your car, its color, or the spot.'); return; }
    setBusy(true); setErr(''); setWhereErr('');
    const eta = action === 'onway' ? await howFar() : null;
    const { d } = await call({ action, tenantId, o, s, where: where.trim(), ...(action === 'here' ? { note: note.trim() } : { eta }) });
    setBusy(false);
    if (d.ok) { setForm(null); await reload(); requestAnimationFrame(() => status.current?.focus()); } else if (d.code === 'where') missing(d.error); else setErr(d.error || 'That didn’t go through. Try again.');
  };
  // On their way with this page open: checked in once their phone is in the lot (stops the moment it does). Rough
  // location until they're within a kilometre (easier on the battery), then precise. A check-in that didn't go through
  // is tried again on the next reading, twice more at most; I'm here is always there too.
  const lat = t.geo?.lat, lng = t.geo?.lng; const watch = !!c.onWay && !t.here && lat != null && lng != null && t.kitchen !== 'handed';
  const [close, setClose] = React.useState(false); const tries = React.useRef(0);
  React.useEffect(() => {
    if (!watch || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let fired = false; setWatching(true);
    const id = navigator.geolocation.watchPosition(async (p) => {
      const m = distanceMetres({ lat: p.coords.latitude, lng: p.coords.longitude }, { lat: lat!, lng: lng! });
      if (!close && m <= 1000) { setClose(true); return; }   // starts again, precise
      if (fired || m > CURBSIDE_GEOFENCE_M || tries.current >= 3) return;
      fired = true; tries.current += 1;
      const { d } = await call({ action: 'here', tenantId, o, s, source: 'geo', distanceM: Math.round(m) });
      if (d.ok) { navigator.geolocation.clearWatch(id); setWatching(false); setFound(true); await reload(); } else fired = false;
    }, () => setWatching(false), { enableHighAccuracy: close, timeout: 15000, maximumAge: 10000 });
    return () => { navigator.geolocation.clearWatch(id); setWatching(false); };
  }, [watch, close, lat, lng, tenantId, o, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const btnDark = `${btn} min-h-[56px] w-full text-[17px]`;
  if (c.out) return (
    <div role="status"><p className="mx-auto w-max rounded-full px-4 py-1.5 text-[15px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>On its way out to you</p>
      <p className="mt-2 text-[15px]" style={{ color: MUTED }}>{c.by ? `${c.by} is` : 'Someone’s'} bringing it to your car.</p></div>);
  if (open) return (
    <div className="space-y-3 text-left">
      {needWhere && !form && <p role="status" className="text-center text-[15px] font-medium" style={{ color: GREEN }}>{found || c.found ? 'We can see you’re here.' : 'They know you’re here.'} Where did you park?</p>}
      <label className="block"><span className="text-[15px] font-semibold">{open === 'way' ? 'What are you driving?' : needWhere ? 'Your car, or the spot' : 'Where are you?'}</span>
        <input ref={whereBox} value={where} onChange={(e) => setWhere(e.target.value.slice(0, 80))} autoFocus aria-describedby="where-help" aria-invalid={!!whereErr} className={`mt-1.5 h-12 w-full rounded-xl bg-[#fff] px-3 text-[16px] ${RING}`} style={{ border: `1px solid ${whereErr ? AMBER : LINE}` }} />
        <span id="where-help" role={whereErr ? 'alert' : undefined} className="mt-1 block text-[13.5px]" style={{ color: whereErr ? AMBER : MUTED }}>{whereErr || (open === 'way' ? `Optional: its color and make.${t.geo ? ' We’ll ask your phone where you are to say how far away you are. While this page is open, it also checks you in when you pull in.' : ''}` : 'Your car, its color, or the spot number')}</span></label>
      {open === 'here' && <label className="block"><span className="text-[15px] font-semibold">Anything we should know?</span>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 160))} placeholder="Optional, like “please knock”" className={`mt-1.5 h-12 w-full rounded-xl bg-[#fff] px-3 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} /></label>}
      <button type="button" onClick={() => send(open === 'way' ? 'onway' : 'here')} disabled={busy} className={btnDark} style={{ background: INK, color: '#fff' }}>{busy ? 'Telling them…' : open === 'way' ? 'Tell them I’m on my way' : 'Tell them I’m here'}</button>
      {form && <button type="button" onClick={() => { setForm(null); setWhereErr(''); }} className={`min-h-[44px] w-full text-[15px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Not now</button>}
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
    </div>);
  if (t.here) return (
    <div><p ref={status} tabIndex={-1} className="text-[15px] font-medium outline-none" style={{ color: GREEN }}>{c.found ? 'Checked in by your location. ' : ''}They know you’re outside{c.where ? `: ${c.where}` : ''}. We’ll bring it out.</p>
      <button type="button" onClick={() => { setWhere(c.where || ''); setForm('here'); }} className={`mt-1 min-h-[44px] text-[15px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Moved? Say where you are now</button></div>);
  return (
    <div className="space-y-2">
      {c.onWay && <p ref={status} tabIndex={-1} className="text-[15px] font-medium outline-none" style={{ color: GREEN }}>They know you’re on your way{c.eta ? `, about ${c.eta} minutes out` : ''}.{watching ? ' Keep this page open, and we’ll check you in when you pull in.' : ''}</p>}
      <button type="button" onClick={() => { setWhere(c.where || ''); setForm('here'); }} className={btnDark} style={{ background: INK, color: '#fff' }}>I’m here</button>
      {!c.onWay && <button type="button" onClick={() => { setWhere(''); setForm('way'); }} className={`${btn} min-h-[52px] w-full bg-[#fff] text-[16px]`} style={{ border: `1px solid ${LINE}`, color: INK }}>I’m on my way</button>}
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
    </div>);
}

function TrackView({ tenantId, o, s, onNew }: { tenantId: string; o: string; s: string; onNew: () => void }) {
  const [t, setT] = React.useState<Track | null>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const { d } = await call({ action: 'track', tenantId, o, s }); if (d.ok) { setT(d); setErr(''); } else if (!t) setErr(d.error || 'This order isn’t here.'); }, [tenantId, o, s]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);
  const here = async () => { setBusy(true); const { d } = await call({ action: 'here', tenantId, o, s }); setBusy(false); if (d.ok) void load(); else setErr(d.error || 'That didn’t go through. Try again.'); };
  if (err && !t) return <div className="rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}><p className="text-[18px] font-semibold">Your order</p><p className="mt-2 text-[15px]" style={{ color: MUTED }}>{err}</p></div>;
  if (!t) return <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading your order" /></div>;
  if (t.state === 'canceled') return (
    <div className="space-y-3 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }} role="status">
      <p className="text-[22px] font-semibold tracking-tight">This order couldn’t be made</p>
      <p className="text-[15px] leading-relaxed" style={{ color: MUTED }}>{t.failed || 'Something in it ran out.'} Your payment is going back to your card. It can take a few days to show.</p>
      <button type="button" onClick={onNew} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>Start a new order</button>
    </div>);
  if (!t.paid) return (
    <div className="space-y-3 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }} role="status">
      <p className="text-[20px] font-semibold">Waiting for your payment</p>
      <p className="text-[15px]" style={{ color: MUTED }}>This page updates once it’s gone through.</p>
    </div>);
  const step = t.kitchen === 'handed' ? 'Picked up. Enjoy!' : t.kitchen === 'ready' ? 'Ready' : t.kitchen === 'later' ? (t.at ? `We’ll start it in time for ${clock(t.at)}` : 'Waiting to start') : 'Being made';
  const say = t.way === 'drive-thru' ? `At the speaker, say: “I ordered ahead, code ${t.code}.”` : t.way === 'curbside' ? 'Tap I’m on my way when you set off, and I’m here when you park. We’ll bring it to your car.' : `Say your code at the counter: ${t.code}.`;
  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-3xl bg-[#fff] p-6 text-center" style={{ border: `1px solid ${LINE}` }} aria-live="polite">
        <p className="mx-auto w-max rounded-full px-4 py-1.5 text-[15px] font-semibold" style={t.kitchen === 'ready' ? { background: GREEN_TINT, color: GREEN } : { background: SOFT, color: INK }}>{step}</p>
        <div>
          <p className="text-[15px]" style={{ color: MUTED }}>Your pickup code</p>
          <p className="text-[64px] font-semibold leading-none tracking-[0.12em] tabular-nums">{t.code}</p>
        </div>
        <p className="text-[16px] leading-relaxed" style={{ color: MUTED }}>Order <b className="font-semibold" style={{ color: INK }}>{t.number}</b>{t.name ? ` for ${t.name}` : ''} · {t.way === 'drive-thru' ? 'drive-thru' : t.way === 'curbside' ? 'curbside' : 'pick up inside'}{t.at ? ` at ${clock(t.at)}` : ''}</p>
        {!(t.way === 'curbside' && (t.here || t.curb?.onWay || t.kitchen === 'handed')) && <p className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: SOFT }}>{say}</p>}
        {!!t.earned && <p className="text-[15px] font-medium" style={{ color: GREEN }}>You earned {t.earned} {t.unit || 'points'} with this order.</p>}
        {t.kitchen !== 'handed' && (t.way === 'curbside' ? <CurbsideSteps t={t} tenantId={tenantId} o={o} s={s} reload={load} />
          : !t.here ? <button type="button" onClick={here} disabled={busy} className={`${btn} min-h-[56px] w-full text-[17px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Telling them…' : t.way === 'drive-thru' ? 'I’m in the drive-thru line' : 'I’m here'}</button>
          : <p className="text-[15px] font-medium" style={{ color: GREEN }}>{t.way === 'drive-thru' ? 'They know you’re on your way.' : 'They know you’re here.'}</p>)}
      </section>
      <section aria-label="Your order" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <ul className="space-y-2">{t.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 text-[15px]"><span className="min-w-0"><span className="tabular-nums" style={{ color: GREEN }}>{l.quantity}</span> {l.name}{l.choicesText ? <span style={{ color: MUTED }}> · {l.choicesText}</span> : null}</span><span className="shrink-0 tabular-nums">{usd(l.price)}</span></li>)}</ul>
        <p className="mt-3 flex justify-between border-t pt-3 text-[16px] font-semibold" style={{ borderColor: LINE }}><span>Paid</span><span className="tabular-nums">{usd(t.total)}</span></p>
      </section>
      <button type="button" onClick={onNew} className={`min-h-[44px] w-full rounded-xl text-[15px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Start another order</button>
    </div>
  );
}

/** The soonest pickup time with room ('' when there's none, so the guest is asked). */
const firstOpen = (m: Menu) => m.times.find((t) => !(m.full || []).includes(t)) || '';

/** A pickup time to choose; a full one says so and can't be chosen. */
function TimeButton({ label, full, fullWord, on, onPick, wide }: { label: string; full: boolean; fullWord: string; on: boolean; onPick: () => void; wide?: boolean }) {
  return (
    <button type="button" aria-pressed={on} disabled={full} onClick={onPick}
      className={`flex min-h-[48px] items-center justify-between gap-2 rounded-xl px-3.5 text-left text-[15px] ${wide ? 'col-span-2' : ''} ${RING}`}
      style={full ? { background: SOFT, color: '#8b8e93', border: `1px solid ${LINE}` } : on ? { background: '#fff', color: INK, border: `1px solid ${INK}`, boxShadow: `inset 0 0 0 1px ${INK}`, fontWeight: 600 } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>
      <span>{label}</span>{full ? <span className="text-[13px] font-semibold">{fullWord}</span> : on ? <span className="text-[13px] font-semibold" style={{ color: GREEN }}>Chosen</span> : null}
    </button>
  );
}

export default function OrderAhead() {
  const { tenantId } = useParams() as { tenantId: string };
  const [menu, setMenu] = React.useState<Menu | null>(null); const [err, setErr] = React.useState('');
  const [cart, setCart] = React.useState<CartLine[]>([]); const [open, setOpen] = React.useState<Item | null>(null);
  const [step, setStep] = React.useState<'menu' | 'review' | 'pay'>('menu');
  const [name, setName] = React.useState(''); const [way, setWay] = React.useState<Way | null>(null); const [at, setAt] = React.useState<string>('');
  const [phone, setPhone] = React.useState(''); const [join, setJoin] = React.useState(false);
  const [moreTimes, setMoreTimes] = React.useState(false);
  // Offered at the end (lib/menu-upgrades): asked once, right after something's added; not again on this visit for an item
  // whose offer was turned down. `offered`: the sheet open is for something taken as an offer (added without asking again).
  const [after, setAfter] = React.useState<After | null>(null); const [passed, setPassed] = React.useState<string[]>([]); const [offered, setOffered] = React.useState(false);
  const byId = React.useMemo(() => new Map((menu?.sections || []).flatMap((s) => s.items.map((i) => [i.id, i] as [string, Item]))), [menu]);
  // The time chosen is full (or, as soon as it's ready, with every time full): paying waits for one with room.
  const chosenFull = !!menu && (at === '' ? !!menu.asapFull : (menu.full || []).includes(at));
  const noneOpen = !!menu && !!menu.asapFull && !firstOpen(menu);
  const [placing, setPlacing] = React.useState(false); const [payBusy, setPayBusy] = React.useState(false); const [placeErr, setPlaceErr] = React.useState('');
  const [pay, setPay] = React.useState<{ orderId: string; sig: string; number: string; total: number; clientSecret: string; publishableKey: string; stripeAccount: string } | null>(null);
  const [track, setTrack] = React.useState<{ o: string; s: string } | null>(null);
  const key = React.useRef<string>('');
  const cartKey = `cf.ahead.cart.${tenantId}`;
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search); const o = q.get('o'), s = q.get('s');
    if (o && s) { setTrack({ o, s }); return; }
    try { const c = JSON.parse(read(cartKey) || '[]'); if (Array.isArray(c)) setCart(c.slice(0, 30)); } catch { /* */ }
    setName(read('cf.ahead.name') || ''); setPhone(read('cf.ahead.phone') || '');
    void call({ action: 'menu', tenantId }).then(({ d }) => { if (d.ok) { setMenu(d); if (d.ways?.length === 1) setWay(d.ways[0]); if (d.asapFull) setAt(firstOpen(d)); } else setErr(d.error || 'This page isn’t here.'); });
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!track) write(cartKey, cart.length ? JSON.stringify(cart) : null); key.current = ''; }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps
  // Changed after going back (another way, time or name): a new order when they continue, never the old one.
  React.useEffect(() => { key.current = ''; }, [way, at, name, phone, join]);
  const count = cart.reduce((n, l) => n + l.quantity, 0); const subtotal = cart.reduce((n, l) => n + l.each * l.quantity, 0);
  /** Into the order (the same item with the same choices is one line); gives back its line's key. */
  const add = (item: Item, picks: Picks, qty: number, offer?: OfferKind) => {
    const p = priceChoices(item, picks); const each = Math.max(0, item.price + (p.ok ? p.extra : 0)); const text = pickWords(item, picks);
    const key = cart.find((l) => l.itemId === item.id && l.choicesText === text)?.key || rid();
    setCart((c) => { const same = c.find((l) => l.itemId === item.id && l.choicesText === text); if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + qty), ...(offer && !l.offer ? { offer } : {}) } : l)); return [...c, { key, itemId: item.id, name: item.name, picks, choicesText: text, quantity: qty, each, imageUrl: item.imageUrl, ...(offer ? { offer } : {}) }]; });
    return key;
  };
  // Added from its sheet: then what's offered with it, if there's anything they could have.
  const added = (item: Item, picks: Picks, qty: number) => {
    const key = add(item, picks, qty, offered ? 'item' : undefined); setOpen(null);
    if (offered) { setOffered(false); return; }
    if (passed.includes(item.id)) return;
    const o = offersFor(item, picks, (id) => byId.get(id), (id) => cart.some((l) => l.itemId === id));
    if (o.size || o.items.length) setAfter({ key, itemId: item.id, qty, size: o.size, items: o.items, took: [] });
  };
  // The size up: the ones just added, a size bigger (into the same line when there's one already; the rest of a line
  // they were added to stays as it was).
  const takeSize = () => {
    const a = after; if (!a?.size || a.took.includes('size')) return;
    const line = cart.find((l) => l.key === a.key); const item = byId.get(a.itemId); if (!line || !item) return;
    const picks = sizedUp(line.picks, a.size); const p = priceChoices(item, picks); if (!p.ok) return;
    const n = Math.max(1, Math.min(a.qty, line.quantity)); const rest = line.quantity - n;
    const twin = cart.find((l) => l.key !== line.key && l.itemId === item.id && l.choicesText === p.text);
    const upKey = twin ? twin.key : rest > 0 ? rid() : line.key;
    const up = { picks, choicesText: p.text, each: Math.max(0, item.price + p.extra), offer: 'size' as const };
    setCart((c) => {
      let next = c.map((l) => (l.key !== line.key ? l : rest > 0 || twin ? { ...l, quantity: rest } : { ...l, ...up }));
      if (twin) next = next.map((l) => (l.key === twin.key ? { ...l, quantity: Math.min(20, l.quantity + n), offer: l.offer || 'size' } : l));
      else if (rest > 0) next = [...next, { ...line, ...up, key: upKey, quantity: n }];
      return next.filter((l) => l.quantity > 0);
    });
    setAfter({ ...a, key: upKey, took: [...a.took, 'size'] });
  };
  // Something to go with it: added as it comes, or, with choices of its own, its sheet opened to pick them.
  const takeItem = (x: Item) => {
    if (!after) return;
    if (x.choices.length) { setAfter(null); setOffered(true); setOpen(x); return; }
    add(x, defaultPicks(x), 1, 'item'); setAfter({ ...after, took: [...after.took, `item:${x.id}`] });
  };
  const closeAfter = () => { if (after && !after.took.length) setPassed((p) => [...p, after.itemId]); setAfter(null); };
  const qty = (k: string, d: number) => setCart((c) => c.map((l) => (l.key === k ? { ...l, quantity: Math.max(0, Math.min(20, l.quantity + d)) } : l)).filter((l) => l.quantity > 0));
  const place = async () => {
    if (!way) { setPlaceErr('How will you pick it up?'); return; }
    if (!name.trim()) { setPlaceErr('What name should we put on the order?'); return; }
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (phone.trim() && digits.length !== 10) { setPlaceErr('A 10-digit phone number for points, or leave it empty.'); return; }
    setPlacing(true); setPlaceErr(''); write('cf.ahead.name', name.trim()); if (digits) write('cf.ahead.phone', digits);
    if (!key.current) key.current = rid();
    const { d } = await call({ action: 'place', tenantId, key: key.current, name: name.trim(), way, at: at || null, ...(phone.replace(/\D/g, '').length >= 10 && menu?.points ? { phone: phone.replace(/\D/g, '').slice(-10), join } : {}), lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, choices: l.picks, ...(l.offer ? { offer: l.offer } : {}) })) });
    setPlacing(false);
    // A time that's gone or just filled up: the times are read again, and the soonest open one is chosen.
    if (!d.ok) { setPlaceErr(d.error || 'That didn’t go through. Try again.'); if (d.code === 'at' || d.code === 'slot_full') void call({ action: 'menu', tenantId }).then(({ d: m }) => { if (m.ok) { setMenu(m); setAt(m.asapFull ? firstOpen(m) : ''); } }); return; }
    if (d.paid) { finish(d.orderId, d.sig); return; }
    setPay(d); setStep('pay');
  };
  const finish = (o: string, s: string) => {
    write(cartKey, null); setCart([]);
    try { window.history.replaceState(null, '', `${window.location.pathname}?o=${encodeURIComponent(o)}&s=${encodeURIComponent(s)}`); } catch { /* */ }
    setTrack({ o, s });
  };
  const fresh = () => { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* */ } window.location.reload(); };

  const shell = (children: React.ReactNode, bar?: React.ReactNode) => (
    <main className="min-h-dvh pb-28" style={{ background: SOFT, color: INK }}>
      <div className="mx-auto w-full max-w-2xl px-4 pt-5">{children}</div>
      {bar}
    </main>
  );
  if (track) return shell(<TrackView tenantId={tenantId} o={track.o} s={track.s} onNew={fresh} />);
  if (err) return shell(<div className="rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}><p className="text-[20px] font-semibold">Order ahead</p><p className="mt-2 text-[15px]" style={{ color: MUTED }}>{err}</p></div>);
  if (!menu) return shell(<div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading the menu" /></div>);
  if (!menu.on) return shell(<div className="rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}><p className="text-[20px] font-semibold">{menu.business}</p><p className="mt-2 text-[15px]" style={{ color: MUTED }}>Ordering ahead isn’t on right now. Order when you get here.</p></div>);

  if (step === 'pay' && pay) return shell(
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep('review')} disabled={payBusy} className={`min-h-[44px] min-w-[44px] rounded-xl px-1 text-[15px] font-medium disabled:opacity-40 ${RING}`} style={{ color: MUTED }}>Back</button>
        <p className="text-[15px] font-medium tabular-nums" style={{ color: MUTED }}>Order {pay.number}</p>
      </header>
      <section className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <p className="flex items-baseline justify-between"><span className="text-[16px] font-semibold">Total with tax</span><span className="text-[28px] font-semibold tabular-nums">{usd(pay.total)}</span></p>
      </section>
      <section aria-label="Pay" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <Elements stripe={stripeFor(pay.publishableKey, pay.stripeAccount)} options={{ clientSecret: pay.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: INK, borderRadius: '14px', fontSizeBase: '16px', fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif' } } }}>
          <PayForm total={pay.total} link={{ tenantId, o: pay.orderId, s: pay.sig }} onPaid={() => finish(pay.orderId, pay.sig)} onBusy={setPayBusy} />
        </Elements>
      </section>
      <p className="px-1 text-center text-[13px]" style={{ color: MUTED }}>Your card goes straight to the card company’s secure form. The business never sees it.</p>
    </div>);

  if (step === 'review') return shell(
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep('menu')} className={`min-h-[44px] rounded-xl px-1 text-[15px] font-medium ${RING}`} style={{ color: MUTED }}>Back to the menu</button>
        <p className="truncate text-[15px] font-medium" style={{ color: MUTED }}>{menu.business}</p>
      </header>
      <section aria-label="Your order" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <h1 className="mb-3 text-[22px] font-semibold tracking-tight">Your order</h1>
        {!cart.length && <p className="text-[15px]" style={{ color: MUTED }}>Nothing yet.</p>}
        <ul className="space-y-3">
          {cart.map((l) => (
            <li key={l.key} className="flex items-center gap-3">
              {l.imageUrl && <img src={l.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" style={{ background: SOFT }} />}
              <div className="min-w-0 flex-1"><p className="truncate text-[16px] font-medium">{l.name}</p>{l.choicesText && <p className="truncate text-[13.5px]" style={{ color: MUTED }}>{l.choicesText}</p>}<p className="text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(l.each * l.quantity)}</p></div>
              <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label={`How many ${l.name}`}>
                <button type="button" aria-label={l.quantity === 1 ? `Take off ${l.name}` : 'One fewer'} onClick={() => qty(l.key, -1)} className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${RING}`}><Minus className="h-4 w-4" /></button>
                <span className="w-6 text-center text-[16px] font-semibold tabular-nums">{l.quantity}</span>
                <button type="button" aria-label="One more" disabled={l.quantity >= 20} onClick={() => qty(l.key, 1)} className={`inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex justify-between border-t pt-3 text-[15px]" style={{ borderColor: LINE }}><span>Subtotal</span><span className="font-semibold tabular-nums">{usd(subtotal)}</span></p>
        <p className="text-[13px]" style={{ color: MUTED }}>Any tax is added on the next step.</p>
      </section>
      <section className="space-y-4 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <label className="block"><span className="text-[15px] font-semibold">Name for the order</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="given-name" className={`mt-2 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="First name" /></label>
        {menu.points && (
          <div>
            <label className="block"><span className="text-[15px] font-semibold">Phone for {menu.points.unit} <span className="font-normal" style={{ color: MUTED }}>(optional)</span></span>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d()\-+ .]/g, '').slice(0, 18))} inputMode="tel" autoComplete="tel" className={`mt-2 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="Phone number" /></label>
            {menu.points.askJoin && phone.replace(/\D/g, '').length >= 10 && (
              <label className="mt-2 flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Join the rewards program, if I haven’t already</label>)}
          </div>)}
        {menu.ways.length > 1 && (
          <fieldset><legend className="text-[15px] font-semibold">How you’ll pick it up</legend>
            <div className={`mt-2 grid gap-2 ${menu.ways.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {menu.ways.map((w) => <button key={w} type="button" aria-pressed={way === w} onClick={() => setWay(w)} className={`${btn} min-h-[52px] text-[15px]`} style={way === w ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{w === 'drive-thru' ? 'Drive-thru' : w === 'curbside' ? 'Curbside' : 'Inside'}</button>)}
            </div>
            {way === 'curbside' && <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Park and tap I’m here when you arrive. We’ll bring it to your car.</p>}</fieldset>)}
        {menu.ways.length === 1 && <p className="text-[15px]"><span className="font-semibold">Pick up:</span> {WAY_WORDS[menu.ways[0]] || 'inside'}</p>}
        <fieldset><legend className="text-[15px] font-semibold">When</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TimeButton label="As soon as it’s ready" full={!!menu.asapFull} fullWord="Full right now" on={at === ''} onPick={() => setAt('')} wide />
            {menu.times.slice(0, moreTimes || menu.times.indexOf(at) >= 7 ? undefined : 7).map((t) => <TimeButton key={t} label={clock(t, menu.timeZone)} full={(menu.full || []).includes(t)} fullWord="Full" on={at === t} onPick={() => setAt(t)} />)}
          </div>
          {menu.times.length > 7 && <button type="button" onClick={() => setMoreTimes((x) => !x)} className={`${btn} mt-1 min-h-[44px] px-0 text-[15px] underline underline-offset-4`} style={{ color: INK }}>{moreTimes ? 'Fewer times' : 'Later times'}</button>}
        </fieldset>
        {menu.busy && <p className="text-[14px]" style={{ color: MUTED }}>The kitchen is busy right now, so orders are taking about {menu.busy.minutes} {menu.busy.minutes === 1 ? 'minute' : 'minutes'} longer than usual{menu.filling ? ', and pickup times fill faster' : ''}.</p>}
        {placeErr && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{placeErr}</p>}
        {noneOpen && <p className="text-[14px]" style={{ color: AMBER }}>The kitchen’s full right now. Please try again in a few minutes.</p>}
        <button type="button" onClick={place} disabled={placing || !cart.length || chosenFull} className={`${btn} min-h-[56px] w-full text-[17px]`} style={{ background: INK, color: '#fff' }}>{placing ? 'One moment…' : noneOpen ? 'Full right now' : chosenFull ? 'Pick a pickup time' : 'Continue to pay'}</button>
        <p className="text-center text-[13px]" style={{ color: MUTED }}>You pay now, so it’s ready when you get here.</p>
      </section>
    </div>);

  return shell(
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">{menu.business}</h1>
        <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Order ahead, pay now, and pick it up {wayList(menu.ways)}.</p>
      </header>
      {menu.sections.length > 1 && (
        <nav aria-label="Menu sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {menu.sections.map((s) => <a key={s.name} href={`#sec-${encodeURIComponent(s.name)}`} className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-[#fff] px-4 text-[15px] font-medium ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>{s.name}</a>)}
        </nav>)}
      {menu.klair && <section className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <MenuAsk name={menu.klair.name} tell={TELL_TEAM} colors={{ accent: INK, soft: SOFT, ink: INK, muted: MUTED, line: LINE, card: '#fff' }} ask={async (question) => {
          const r = await call({ tenantId, action: 'menu_ask', question });
          return r.d?.ok && r.d.answer ? { text: String(r.d.answer.text || ''), tell: !!r.d.answer.tell } : { error: r.d?.error || 'That didn’t send. Ask the team.' };
        }} /></section>}
      {menu.sections.map((s) => (
        <section key={s.name} id={`sec-${encodeURIComponent(s.name)}`} aria-label={s.name} className="scroll-mt-4">
          <h2 className="mb-3 text-[19px] font-semibold tracking-tight">{s.name}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {s.items.map((i) => (
              <button key={i.id} type="button" disabled={i.soldOut} onClick={() => setOpen(i)} className={`flex flex-col overflow-hidden rounded-2xl bg-[#fff] text-left disabled:opacity-60 ${RING}`} style={{ border: `1px solid ${LINE}` }}>
                <span className="relative block aspect-square w-full" style={{ background: SOFT }}>
                  {i.imageUrl && <img src={i.imageUrl} alt="" className="h-full w-full object-cover" />}
                  {i.soldOut && <span className="absolute left-2 top-2 rounded-full bg-[#fff] px-2.5 py-1 text-[12.5px] font-semibold" style={{ color: AMBER }}>Sold out</span>}
                </span>
                <span className="block px-3 py-2.5"><span className="block text-[15px] font-semibold leading-snug">{i.name}</span><span className="mt-0.5 flex flex-wrap gap-x-2 text-[14px] tabular-nums" style={{ color: MUTED }}><span>{i.from ? `From ${usd(i.startPrice)}` : usd(i.price)}</span>{i.calories != null && <span>{i.calories} cal</span>}</span></span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {open && <ItemSheet item={open} onAdd={(p, q) => added(open, p, q)} onClose={() => { setOpen(null); setOffered(false); }} />}
      {after && byId.get(after.itemId) && <AfterSheet after={after} item={byId.get(after.itemId)!} line={cart.find((l) => l.key === after.key)} onSize={takeSize} onItem={takeItem} onClose={closeAfter} />}
    </div>,
    count > 0 ? (
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pt-2" style={{ background: 'linear-gradient(rgba(245,245,247,0), #f5f5f7 40%)' }}>
        <button type="button" onClick={() => setStep('review')} className={`${btn} mx-auto min-h-[60px] w-full max-w-2xl justify-between text-[17px] shadow-lg`} style={{ background: INK, color: '#fff' }}>
          <span className="inline-flex items-center gap-2"><ShoppingBag className="h-5 w-5" aria-hidden />View order · {count} item{count === 1 ? '' : 's'}</span><span className="tabular-nums">{usd(subtotal)}</span>
        </button>
      </div>) : null,
  );
}
