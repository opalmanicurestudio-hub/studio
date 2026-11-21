'use client';
// src/app/order/[tenantId]/page.tsx — ORDER AHEAD, on the guest's own phone (api/counter/ahead, lib/counter-ahead). The
// menu with photos, an item's choices, the order, how and when they'll pick it up, and paying right there on the card
// company's own secure form. Then the order's own page (?o=…&s=…, the address it moves to once paid, so it can be opened
// again): the pickup code, how it's going, and I'm here. The order (not yet sent) is kept on the phone, so a guest who
// leaves the page finds it again. Right after something's added, what the business offers with it is asked once, on the
// same sheet (lib/menu-upgrades): the next size up, and things to go with it, each a tap.
//   A text when it's ready, if they tick it (lib/ready-text), or asked for later on the order's page. Order again (design
//   board "Ready texts and order again"): the guest's recent orders and favorites, kept on their own phone only, at the top
//   of the menu; today's menu decides what can be added, and what can't is said.
//   Orders for another day (lib/ahead-days; design board "Orders for another day"): Today or Another day, its date and
//   time (only days and times the business is open, from its notice on), how many people; paid now, and on the order's
//   page booked for its day, with Cancel and refund until the notice runs out.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Check, Minus, Plus, ShoppingBag, Star, X } from 'lucide-react';
import { MenuAsk } from '@/components/klair/MenuAsk';
import { TELL_TEAM } from '@/lib/klair-menu';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { AllergyChips, NoteField, NO_ALLERGY, allergyBody, hasAllergy, type AllergyValue } from '@/components/menu/OrderAllergy';
import { conflictWords, containsLine, dishConflict, sameNote } from '@/lib/order-allergy';
import type { AllergenKey } from '@/lib/allergens';
import { defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { offersFor, sizedUp, type OfferKind, type SizeUp } from '@/lib/menu-upgrades';
import { CURBSIDE_GEOFENCE_M, distanceMetres, roughEtaMinutes } from '@/lib/retail-orders';
import { dayWords } from '@/lib/ahead-days';
import { milesApart } from '@/lib/ahead-places';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex items-center justify-center gap-2 rounded-2xl px-4 font-semibold disabled:opacity-50 ${RING}`;
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
type Way = 'drive-thru' | 'inside' | 'curbside' | 'delivery';
const WAY_WORDS: Record<Way, string> = { 'drive-thru': 'at the drive-thru', inside: 'inside', curbside: 'at the curb: we bring it to your car', delivery: 'delivered to you' };
const WAY_BUTTON: Record<Way, string> = { 'drive-thru': 'Drive-thru', inside: 'Inside', curbside: 'Curbside', delivery: 'Delivery' };
// Delivered by the business's own drivers (lib/food-delivery): the address, checked for the fee and the drive.
type Addr = { line1: string; line2: string; city: string; state: string; postalCode: string };
const NO_ADDR: Addr = { line1: '', line2: '', city: '', state: '', postalCode: '' };
type DCheck = { feeCents: number; free: boolean; driveMin: number; token: string | null; asapArrive: string | null; from?: { id: string; name: string } | null;
  /** Leave times no driver can make (lib/driver-load), the first one offered (later when deliveries are slowed down), and
   *  whether "as soon as it's ready" has no driver free. */
  leaveFull: string[]; leaveFirst: string | null; asapNoDriver: boolean };
type Tip = { pct: number } | { cents: number } | null;
const TIP_PCTS = [15, 18, 20];
/** The driver's tip in cents for the food's subtotal (the order works it out again when it's placed). */
const tipCents = (t: Tip, food: number) => (!t ? 0 : 'pct' in t ? Math.round((Math.round(food * 100) * t.pct) / 100) : t.cents);
const to5 = (ms: number) => new Date(Math.ceil(ms / 300000) * 300000).toISOString();
/** When it should get there from a pickup time (the time it's ready to leave): plus the drive, to the next 5 minutes. */
const arriveFor = (iso: string, driveMin: number) => to5(Date.parse(iso) + driveMin * 60000);
/** The menu's first line: how guests get it. */
const headWords = (ws: Way[]) => { const pick = ws.filter((w) => w !== 'delivery'); const del = ws.includes('delivery');
  return pick.length ? `Order ahead, pay now, and pick it up ${wayList(pick)}${del ? ', or have it delivered' : ''}.` : 'Order ahead, pay now, and have it delivered.'; };
const wayList = (ws: Way[]) => (ws.length > 1 ? `${ws.slice(0, -1).map((w) => WAY_WORDS[w].split(':')[0]).join(', ')} or ${WAY_WORDS[ws[ws.length - 1]].split(':')[0]}` : WAY_WORDS[ws[0]] || 'inside');
type Item = { id: string; name: string; section: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; choices: any[]; soldOut: boolean; calories?: number | null;
  upgrades?: { size: boolean; items: string[] };
  /** What it contains of the major allergens, when the business has said (null: nobody has). */
  allergens?: AllergenKey[] | null };
type Menu = { on: boolean; business: string; ways: Way[]; times: string[]; full?: string[]; asapFull?: boolean; filling?: boolean;
  // Opening hours (lib/ahead-hours): "as soon as it's ready" offered or not, opening later today, closing, and (nothing to
  // pick now) when it opens next.
  /** "Text me when it's ready" offered (lib/ready-text). */
  texts?: boolean;
  asap?: boolean; opens?: string | null; closes?: string | null; nextOpen?: string | null; closedNow?: boolean; lateToday?: boolean; busy?: { minutes: number } | null;
  /** Orders for another day (lib/ahead-days): the days and their times, how it can be had, the smallest order (cents) and the notice. */
  later?: Later | null;
  /** With more than one location (lib/ahead-places): pick one first (`pick`), the one it's from, and the others. */
  pick?: boolean; place?: { id: string; name: string; address: string | null } | null; places?: PlaceRow[]; klair?: { name: string } | null; sections: { name: string; items: Item[] }[]; timeZone?: string; points?: { unit: string; askJoin: boolean } | null };
type CartLine = { key: string; itemId: string; name: string; picks: Picks; choicesText: string; quantity: number; each: number; imageUrl: string | null; offer?: OfferKind;
  /** A note for the kitchen about this dish (lib/order-allergy). */
  note?: string };
/** Right after something's added: its line and how many were just added, what was offered with it (kept as it was first
 *  shown), and what's been taken ('size', or 'item:' and its id). */
type After = { key: string; itemId: string; qty: number; size: SizeUp | null; items: Item[]; took: string[] };
type Track = { business: string; number: string; name: string | null; state: string; paid: boolean; code: string | null; way: Way; at: string | null; later?: TrackLater | null; place?: { name: string; address: string | null } | null; kitchen: 'later' | 'making' | 'ready' | 'handed' | null; here: boolean; failed: string | null; curb?: { where: string | null; out: boolean; by: string | null; onWay?: boolean; eta?: number | null; found?: boolean } | null; geo?: { lat: number; lng: number } | null; earned?: number; unit?: string; lines: { name: string; quantity: number; choicesText: string | null; price: number; itemId?: string; picks?: Picks; note?: string | null }[]; total: number; allergy?: string | null;
  /** The text when it's ready (lib/ready-text): asked for or sent, and whether it can still be asked. */
  text?: { last4: string; sent: boolean; failed: boolean } | null; texts?: boolean;
  /** Delivered: where to, about when, and how it's going (who's bringing it, once it's out). */
  deliveryFee?: number; tip?: number; delivery?: { to: string; arriveAt: string | null; driveMin: number; step: 'making' | 'ready' | 'out' | 'delivered' | 'failed' | 'pickup' | 'picked_up' | 'refunded' | null; driver: string | null; outAt: string | null; deliveredAt: string | null; outside?: boolean; eta?: string | null; late?: boolean;
    /** Couldn't be delivered: why, and what a refund or a pickup gives back (dollars); the fee the business's rule keeps. */
    failed?: { why: string; keepWhen: string; keepFee: boolean; food: number; tax: number; tip: number; fee: number; stuck: boolean };
    /** Picked up instead, or refunded: what went back to their card (dollars), and whether some is still to go. */
    back?: number; owed?: boolean;
    /** Delivered: left at the door, and its photo when the driver took one. */
    left?: boolean; photo?: string | null } };

type Later = { days: { date: string; times: string[] }[]; ways: Way[]; minCents: number | null; noticeHours: number };
type PlaceRow = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; delivers: boolean; open: boolean; until: string | null; opens: string | null };
/** For another day, on the order's page: its day, for how many, until when it can be canceled, and once canceled, what went back. */
type TrackLater = { day: string; people: number | null; cancelBy: string | null; waiting: boolean; canCancel: boolean; canceled: boolean; canceledBy: 'guest' | 'business' | null; back: number; stuck: boolean };

/** An order on this phone, for Order again: kept here only (never sent anywhere), the last few and any made a favorite. */
type Past = { o: string; at: string; fav?: boolean; lines: { itemId: string; picks: Picks; quantity: number; name: string; choicesText: string | null }[] };
const pastKey = (t: string) => `cf.ahead.past.${t}`;
const FAVS_MAX = 5, RECENT_MAX = 3;
const linesSig = (ls: Past['lines']) => JSON.stringify(ls.map((l) => [l.itemId, l.choicesText || '', l.quantity]).sort());
function readPast(t: string): Past[] {
  try { const v = JSON.parse(read(pastKey(t)) || '[]'); return Array.isArray(v) ? v.filter((x: any) => x && typeof x.o === 'string' && typeof x.at === 'string' && Array.isArray(x.lines) && x.lines.length).slice(0, FAVS_MAX + RECENT_MAX) : []; } catch { return []; }
}
/** Favorites first (the newest few), then the last few others; the same order placed again is one, moved up. */
function keepPast(t: string, list: Past[]): Past[] {
  const byNew = [...list].sort((a, b) => b.at.localeCompare(a.at));
  const out = [...byNew.filter((p) => p.fav).slice(0, FAVS_MAX), ...byNew.filter((p) => !p.fav).slice(0, RECENT_MAX)];
  write(pastKey(t), out.length ? JSON.stringify(out) : null); return out;
}
function rememberPast(t: string, entry: Past, fav?: boolean): Past[] {
  const list = readPast(t); const same = list.find((p) => p.o === entry.o || linesSig(p.lines) === linesSig(entry.lines));
  const next = same ? list.map((p) => (p === same ? { ...p, o: entry.o, at: same.o === entry.o ? p.at : entry.at, lines: entry.lines, fav: fav ?? p.fav } : p)) : [{ ...entry, fav: !!fav }, ...list];
  return keepPast(t, next);
}
const pastWords = (p: { lines: Past['lines'] }) => p.lines.map((l) => `${l.quantity > 1 ? `${l.quantity} ` : ''}${l.name}${l.choicesText ? ` (${l.choicesText})` : ''}`).join(', ');
/** When it was ordered, in words: today, yesterday, a weekday this week, or the date. */
function whenWords(iso: string, tz?: string): string {
  const day = (d: Date) => { try { return d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : {}); } catch { return d.toLocaleDateString('en-CA'); } };
  const then = new Date(iso); const now = new Date(); if (!Number.isFinite(then.getTime())) return '';
  if (day(then) === day(now)) return 'Today';
  if (day(then) === day(new Date(now.getTime() - 86400000))) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = now.getTime() - then.getTime() < 6 * 86400000 ? { weekday: 'long' } : { month: 'short', day: 'numeric' };
  try { return then.toLocaleDateString('en-US', tz ? { ...opts, timeZone: tz } : opts); } catch { return then.toLocaleDateString('en-US', opts); }
}
/** A past order's lines, from an order's own page (what was picked comes with each line). */
const pastLines = (lines: Track['lines']): Past['lines'] => lines.filter((l) => l.itemId).map((l) => ({ itemId: String(l.itemId), picks: l.picks || {}, quantity: l.quantity, name: l.name, choicesText: l.choicesText }));

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

function ItemSheet({ item, onAdd, onClose, max = 20 }: { item: Item; onAdd: (picks: Picks, qty: number, note: string) => void; onClose: () => void; max?: number }) {
  const [picks, setPicks] = React.useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = React.useState(1); const [note, setNote] = React.useState('');
  const has = containsLine(item);
  const priced = priceChoices(item, picks); const each = Math.max(0, item.price + (priced.ok ? priced.extra : 0));
  return (
    <Sheet title={item.name} onClose={onClose} foot={
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="How many">
          <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Minus className="h-4 w-4" /></button>
          <span className="w-7 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
          <button type="button" aria-label="One more" disabled={qty >= max} onClick={() => setQty((n) => Math.min(max, n + 1))} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
        </div>
        <button type="button" disabled={!priced.ok} onClick={() => onAdd(picks, qty, note.trim())} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={{ background: INK, color: '#fff' }}>Add{qty > 1 ? ` ${qty}` : ''}, {usd(each * qty)}</button>
      </div>}>
      {item.imageUrl && <img src={item.imageUrl} alt="" className="mb-4 aspect-[4/3] w-full rounded-2xl object-cover" style={{ background: SOFT }} />}
      {(item.words || item.calories != null) && <p className="mb-4 text-[15px] leading-relaxed" style={{ color: MUTED }}>{item.words}{item.words && item.calories != null ? ' ' : ''}{item.calories != null && <span className="whitespace-nowrap">({item.calories} cal)</span>}</p>}
      <p className="mb-4 text-[14px]" style={{ color: MUTED }}>{has ? `${has}.${item.choices.length ? ' Choices can change this.' : ''}` : 'Allergens aren’t listed for this one.'}</p>
      <ChoicePicker item={item} picks={picks} onChange={setPicks} />
      <div className="mt-4"><NoteField value={note} onChange={setNote} id={`note-${item.id}`} /></div>
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

/** The text when it's ready, on the order's page (lib/ready-text): what was asked for, or asking for it now (while it's
 *  still being made), or taking it back. */
function ReadyTextLine({ t, tenantId, o, s, reload, onWay = false }: { t: Track; tenantId: string; o: string; s: string; reload: () => Promise<void>; onWay?: boolean }) {
  const when = onWay ? 'it’s on its way' : 'it’s ready';
  const [asking, setAsking] = React.useState(false); const [phone, setPhone] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { setPhone(read('cf.ahead.phone') || ''); }, []);
  const digits = phone.replace(/\D/g, '').slice(-10);
  const send = async (p: string | null) => {
    setBusy(true); setErr('');
    const { d } = await call({ action: 'textMe', tenantId, o, s, phone: p });
    setBusy(false);
    if (d.ok) { if (p) write('cf.ahead.phone', p); setAsking(false); await reload(); } else setErr(d.error || 'That didn’t go through. Try again.');
  };
  const quietBtn = { background: '#fff', border: `1px solid ${LINE}`, color: INK };
  if (t.text) {
    if (t.text.sent) return t.text.failed ? null : <p className="text-[15px]" style={{ color: MUTED }}>We texted ···{t.text.last4} that {when}.</p>;
    return (
      <div className="space-y-1">
        <p className="text-[15px]">We’ll text you at ···{t.text.last4} when {when}.</p>
        <button type="button" onClick={() => send(null)} disabled={busy} className={`min-h-[44px] rounded-xl px-2 text-[14.5px] font-medium underline underline-offset-4 disabled:opacity-50 ${RING}`} style={{ color: MUTED }}>Don’t text me</button>
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
      </div>);
  }
  if (!t.texts || (!onWay && (t.kitchen === 'ready' || t.kitchen === 'handed'))) return null;
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className={`${btn} min-h-[48px] w-full text-[15.5px]`} style={quietBtn}>Text me when {when}</button>;
  return (
    <div className="space-y-2 text-left">
      <label className="block"><span className="text-[15px] font-semibold">Your mobile number</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d()\-+ .]/g, '').slice(0, 18))} onKeyDown={(e) => { if (e.key === 'Enter' && digits.length === 10) void send(digits); }} inputMode="tel" autoComplete="tel" className={`mt-2 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="Phone number" /></label>
      <div className="flex gap-2">
        <button type="button" onClick={() => send(digits)} disabled={busy || digits.length !== 10} className={`${btn} min-h-[48px] flex-1 text-[15.5px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'One moment…' : 'Text me'}</button>
        <button type="button" onClick={() => { setAsking(false); setErr(''); }} className={`${btn} min-h-[48px] text-[15.5px]`} style={quietBtn}>Cancel</button>
      </div>
      <p className="text-[13px]" style={{ color: MUTED }}>One text, just for this order.</p>
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
    </div>);
}

function TrackView({ tenantId, o, s, onNew }: { tenantId: string; o: string; s: string; onNew: () => void }) {
  const [t, setT] = React.useState<Track | null>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const { d } = await call({ action: 'track', tenantId, o, s }); if (d.ok) { setT(d); setErr(''); } else if (!t) setErr(d.error || 'This order isn’t here.'); }, [tenantId, o, s]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);
  const here = async () => { setBusy(true); const { d } = await call({ action: 'here', tenantId, o, s }); setBusy(false); if (d.ok) void load(); else setErr(d.error || 'That didn’t go through. Try again.'); };
  // Paid: kept on this phone for Order again (on the phone only, never sent anywhere), and whether it's a favorite.
  const [fav, setFav] = React.useState(false);
  const paidLines = t?.paid && t.state !== 'canceled' ? pastLines(t.lines) : [];
  React.useEffect(() => {
    if (!paidLines.length) return;
    const list = rememberPast(tenantId, { o, at: new Date().toISOString(), lines: paidLines });
    setFav(!!list.find((p) => p.o === o)?.fav);
  }, [paidLines.length, tenantId, o]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFav = () => { const list = rememberPast(tenantId, { o, at: new Date().toISOString(), lines: paidLines }, !fav); setFav(!!list.find((p) => p.o === o)?.fav); };
  // Order this again: the same items, checked against today's menu once it's open (Order again, on the menu).
  const again = () => { write(`cf.ahead.again.${tenantId}`, JSON.stringify(paidLines)); onNew(); };
  if (err && !t) return <div className="rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}><p className="text-[18px] font-semibold">Your order</p><p className="mt-2 text-[15px]" style={{ color: MUTED }}>{err}</p></div>;
  if (!t) return <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading your order" /></div>;
  if (t.later?.canceled) return (
    <div className="space-y-3 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }} role="status">
      <p className="text-[22px] font-semibold tracking-tight">Canceled</p>
      <p className="text-[15px] leading-relaxed" style={{ color: MUTED }}>{t.later.canceledBy === 'guest' ? 'You canceled' : `${t.business || 'The business'} canceled`} order {t.number} for {dayWords(t.later.day)}. {usd(t.later.back)} is on its way back to your card. It can take a few days to show.</p>
      <button type="button" onClick={onNew} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>Start a new order</button>
    </div>);
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
  // For another day, waiting for its day: booked, and canceled for a full refund until the notice runs out.
  if (t.later?.waiting) return (
    <div className="space-y-4">
      <Booked t={t} L={t.later} tenantId={tenantId} o={o} s={s} reload={load} />
      <OrderLines t={t} />
      <button type="button" onClick={onNew} className={`min-h-[44px] w-full rounded-xl text-[15px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Start another order</button>
    </div>);
  if (t.delivery) return (
    <div className="space-y-4">
      <DeliveryStatus t={t} D={t.delivery} tenantId={tenantId} o={o} s={s} reload={load} />
      <OrderLines t={t} />
      {paidLines.length > 0 && <AgainRow again={again} fav={fav} toggleFav={toggleFav} />}
      <button type="button" onClick={onNew} className={`min-h-[44px] w-full rounded-xl text-[15px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Start another order</button>
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
        {t.place && <p className="text-[15px]" style={{ color: MUTED }}>At <b className="font-semibold" style={{ color: INK }}>{t.place.name}</b>{t.place.address ? `, ${t.place.address}` : ''}</p>}
        {!(t.way === 'curbside' && (t.here || t.curb?.onWay || t.kitchen === 'handed')) && <p className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: SOFT }}>{say}</p>}
        {!!t.earned && <p className="text-[15px] font-medium" style={{ color: GREEN }}>You earned {t.earned} {t.unit || 'points'} with this order.</p>}
        {t.kitchen !== 'handed' && <ReadyTextLine t={t} tenantId={tenantId} o={o} s={s} reload={load} />}
        {t.kitchen !== 'handed' && (t.way === 'curbside' ? <CurbsideSteps t={t} tenantId={tenantId} o={o} s={s} reload={load} />
          : !t.here ? <button type="button" onClick={here} disabled={busy} className={`${btn} min-h-[56px] w-full text-[17px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Telling them…' : t.way === 'drive-thru' ? 'I’m in the drive-thru line' : 'I’m here'}</button>
          : <p className="text-[15px] font-medium" style={{ color: GREEN }}>{t.way === 'drive-thru' ? 'They know you’re on your way.' : 'They know you’re here.'}</p>)}
      </section>
      <OrderLines t={t} />
      {paidLines.length > 0 && <AgainRow again={again} fav={fav} toggleFav={toggleFav} />}
      <button type="button" onClick={onNew} className={`min-h-[44px] w-full rounded-xl text-[15px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Start another order</button>
    </div>
  );
}

/** Booked for another day: when, for whom and how many, the pickup code (or where it's delivered), and Cancel and refund
 *  until the notice runs out (asked once more before it goes). */
function Booked({ t, L, tenantId, o, s, reload }: { t: Track; L: TrackLater; tenantId: string; o: string; s: string; reload: () => Promise<void> }) {
  const [asking, setAsking] = React.useState(false); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const cancel = async () => {
    setBusy(true); setErr('');
    const { d } = await call({ action: 'cancel', tenantId, o, s });
    setBusy(false);
    if (d.ok) { setAsking(false); await reload(); } else { setErr(d.error || 'That didn’t go through. Try again.'); await reload(); }
  };
  const can = L.canCancel || L.stuck;
  const how = t.way === 'delivery' ? `delivered to ${t.delivery?.to || 'you'}` : t.way === 'curbside' ? 'brought to your car' : 'picked up inside';
  const arrive = t.way === 'delivery' && t.delivery?.arriveAt ? to5(Date.parse(t.delivery.arriveAt)) : t.at;
  return (
    <section className="space-y-4 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }} aria-live="polite">
      <p className="w-max rounded-full px-3 py-1 text-[14px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Booked</p>
      <p className="text-[24px] font-semibold leading-tight tracking-tight">{dayWords(L.day)}{arrive ? ` at ${clock(arrive)}` : ''}</p>
      <p className="text-[15.5px] leading-relaxed" style={{ color: MUTED }}>Order <b className="font-semibold" style={{ color: INK }}>{t.number}</b>{t.name ? ` for ${t.name}` : ''}, {how}{L.people ? `, for ${L.people} people` : ''}. It’s made on the day, in time for you.</p>
      {t.place && t.way !== 'delivery' && <p className="text-[15px]" style={{ color: MUTED }}>At <b className="font-semibold" style={{ color: INK }}>{t.place.name}</b>{t.place.address ? `, ${t.place.address}` : ''}</p>}
      {t.code && t.way !== 'delivery' && <div><p className="text-[14px]" style={{ color: MUTED }}>Your pickup code</p><p className="text-[44px] font-semibold leading-none tracking-[0.12em] tabular-nums">{t.code}</p></div>}
      {can && !asking && <button type="button" onClick={() => setAsking(true)} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{L.stuck ? 'Finish the refund' : `Cancel and refund ${usd(t.total)}`}</button>}
      {can && asking && (
        <div className="space-y-2 rounded-2xl p-4" style={{ background: SOFT }}>
          <p className="text-[15px]">Cancel your order and get {usd(t.total)} back on your card?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={cancel} disabled={busy} className={`${btn} min-h-[48px] text-[15px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'One moment…' : 'Yes, cancel it'}</button>
            <button type="button" onClick={() => setAsking(false)} disabled={busy} className={`${btn} min-h-[48px] text-[15px]`} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Keep it</button>
          </div>
        </div>)}
      {L.canCancel && L.cancelBy && <p className="text-[14px]" style={{ color: MUTED }}>You can cancel for a full refund until {shortWhen(Date.parse(L.cancelBy))}.</p>}
      {!can && <p className="text-[14px]" style={{ color: MUTED }}>The time to cancel for a refund has passed.</p>}
      {L.stuck && <p role="status" className="text-[14px] font-medium" style={{ color: AMBER }}>Not all of your refund went through. Tap Finish the refund to try again.</p>}
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
    </section>);
}

/** What was ordered and paid (with the delivery fee on its own line, when it's delivered). */
function OrderLines({ t }: { t: Track }) {
  return (
    <section aria-label="Your order" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
      <ul className="space-y-2">{t.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 text-[15px]"><span className="min-w-0"><span className="tabular-nums" style={{ color: GREEN }}>{l.quantity}</span> {l.name}{l.choicesText ? <span style={{ color: MUTED }}>, {l.choicesText}</span> : null}{l.note ? <span className="block text-[13.5px]" style={{ color: MUTED }}>Note: {l.note}</span> : null}</span><span className="shrink-0 tabular-nums">{usd(l.price)}</span></li>)}</ul>
      {t.allergy && <p className="mt-2 text-[14px] font-medium" style={{ color: AMBER }}>Allergy told to the kitchen: {t.allergy}</p>}
      {!!t.deliveryFee && <p className="mt-2 flex justify-between gap-3 text-[15px]" style={{ color: MUTED }}><span>Delivery</span><span className="tabular-nums">{usd(t.deliveryFee)}</span></p>}
      {!!t.tip && <p className="mt-1 flex justify-between gap-3 text-[15px]" style={{ color: MUTED }}><span>Driver tip</span><span className="tabular-nums">{usd(t.tip)}</span></p>}
      <p className="mt-3 flex justify-between border-t pt-3 text-[16px] font-semibold" style={{ borderColor: LINE }}><span>Paid</span><span className="tabular-nums">{usd(t.total)}</span></p>
    </section>);
}

function AgainRow({ again, fav, toggleFav }: { again: () => void; fav: boolean; toggleFav: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={again} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Order this again</button>
      <button type="button" aria-pressed={fav} onClick={toggleFav} className={`${btn} min-h-[52px] text-[16px]`} style={fav ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}><Star className="h-5 w-5" fill={fav ? 'currentColor' : 'none'} aria-hidden />Favorite</button>
    </div>);
}

/** Couldn't be delivered (design board "When hot food can't be delivered"): pick it up instead, or a refund. Picking it
 *  up gives back the tip, and the fee unless the business's rule keeps it; a refund, the food and its tax too. */
function FailedChoice({ f, tenantId, o, s, reload }: { f: NonNullable<NonNullable<Track['delivery']>['failed']>; tenantId: string; o: string; s: string; reload: () => Promise<void> }) {
  const [asking, setAsking] = React.useState(false); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const fee = f.keepFee ? 0 : f.fee;
  const refund = f.food + f.tax + f.tip + fee;
  const pickWords = f.tip > 0 && fee > 0 ? `your ${usd(f.tip)} tip and the ${usd(fee)} delivery fee come back` : f.tip > 0 ? `your ${usd(f.tip)} tip comes back` : fee > 0 ? `the ${usd(fee)} delivery fee comes back` : '';
  const choose = async (choice: 'pickup' | 'refund') => {
    setBusy(true); setErr('');
    const { d } = await call({ action: 'deliveryChoice', tenantId, o, s, choice });
    setBusy(false);
    if (d.ok) { setAsking(false); await reload(); } else setErr(d.error || 'That didn’t go through. Try again.');
  };
  const quietBtn = { background: '#fff', border: `1px solid ${LINE}`, color: INK };
  return (
    <div className="space-y-3">
      <p className="text-[15.5px] leading-relaxed" style={{ color: MUTED }}>{f.why}. What would you like?</p>
      {!asking ? <>
        <button type="button" disabled={busy} onClick={() => choose('pickup')} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>I’ll pick it up</button>
        {pickWords && <p className="text-[14px]" style={{ color: MUTED }}>If you pick it up, {pickWords} to your card.</p>}
        <button type="button" disabled={busy} onClick={() => setAsking(true)} className={`${btn} min-h-[52px] w-full text-[16px]`} style={quietBtn}>Refund me {usd(refund)}</button>
      </> : <>
        <p className="text-[17px] font-semibold">Refund {usd(refund)} to your card?</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => choose('refund')} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={{ background: INK, color: '#fff' }}>Yes, refund it</button>
          <button type="button" disabled={busy} onClick={() => setAsking(false)} className={`${btn} min-h-[52px] text-[16px]`} style={quietBtn}>Back</button>
        </div>
      </>}
      {f.keepFee && f.fee > 0 && f.keepWhen && <p className="text-[14px]" style={{ color: MUTED }}>The {usd(f.fee)} delivery fee isn’t refunded when {f.keepWhen}.</p>}
      {f.stuck && <p className="text-[14px] font-medium" style={{ color: AMBER }}>Your refund started but didn’t finish. Tap Refund me to finish it.</p>}
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
    </div>);
}

/** A delivery's page after paying: about when it gets there, and each step (made, out with a driver, delivered). */
function DeliveryStatus({ t, D, tenantId, o, s, reload }: { t: Track; D: NonNullable<Track['delivery']>; tenantId: string; o: string; s: string; reload: () => Promise<void> }) {
  const st = D.step || 'making'; const gone = st === 'out' || st === 'delivered';
  // (Settled after it couldn't be delivered: picked up instead, or refunded.)
  const settled = st === 'pickup' || st === 'picked_up' || st === 'refunded';
  const chip = st === 'delivered' ? 'Delivered. Enjoy!' : st === 'out' ? 'On its way' : st === 'failed' ? 'Couldn’t be delivered' : st === 'pickup' ? 'Picking it up' : st === 'picked_up' ? 'Picked up' : st === 'refunded' ? 'Refunded'
    : st === 'ready' ? 'Ready, going out soon' : t.kitchen === 'later' ? 'Waiting to start' : 'Being made';
  // (Out with a driver: the time it should get there now, which moves with the driver's route.)
  const when = st === 'out' && D.eta ? D.eta : D.arriveAt;
  const big = st === 'delivered' ? (D.deliveredAt ? `Delivered at ${clock(D.deliveredAt)}` : 'Delivered') : st === 'failed' ? 'We couldn’t get it to you' : st === 'pickup' ? 'Come pick it up'
    : st === 'picked_up' ? 'Picked up. Enjoy!' : st === 'refunded' ? (D.back ? `${usd(D.back)} is on its way back to your card` : 'Refunded') : when ? `There around ${clock(when)}` : 'On its way soon';
  const steps = [
    { on: true, text: t.kitchen === 'later' && !gone ? 'Paid. The kitchen starts it in time.' : 'Paid, being made' },
    { on: gone, text: gone && D.outAt ? `Left${D.driver ? ` with ${D.driver}` : ''} at ${clock(D.outAt)}` : 'Out with a driver' },
    { on: st === 'delivered', text: 'Delivered' },
  ];
  return (
    <section className="space-y-4 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }} aria-live="polite">
      <p className="w-max rounded-full px-4 py-1.5 text-[15px] font-semibold" style={gone || settled ? { background: GREEN_TINT, color: GREEN } : st === 'failed' ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }}>{chip}</p>
      <div>
        <p className="text-[26px] font-semibold leading-tight tracking-tight">{big}</p>
        {st === 'out' && D.late && D.arriveAt && <p className="mt-1.5 text-[15.5px] font-medium" style={{ color: AMBER }}>Running a little late. It was due at {clock(D.arriveAt)}.</p>}
        {st === 'refunded' ? <p className="mt-1.5 text-[15.5px] leading-relaxed" style={{ color: MUTED }}>Order <b className="font-semibold" style={{ color: INK }}>{t.number}</b>. It can take a few days to show.</p>
          : st === 'pickup' || st === 'picked_up' ? <p className="mt-1.5 text-[15.5px] leading-relaxed" style={{ color: MUTED }}>Order <b className="font-semibold" style={{ color: INK }}>{t.number}</b>{t.name ? ` for ${t.name}` : ''}{st === 'pickup' && t.code ? <>. Your pickup code is <b className="font-semibold" style={{ color: INK }}>{t.code}</b>: say it at the counter.</> : '.'}</p>
          : <p className="mt-1.5 text-[15.5px] leading-relaxed" style={{ color: MUTED }}>Order <b className="font-semibold" style={{ color: INK }}>{t.number}</b>{t.name ? ` for ${t.name}` : ''}, to {D.to}</p>}
      </div>
      {st === 'failed' && D.failed && <FailedChoice f={D.failed} tenantId={tenantId} o={o} s={s} reload={reload} />}
      {(st === 'pickup' || st === 'picked_up') && !!D.back && <p className="text-[15px]" style={{ color: MUTED }}>{usd(D.back)} is on its way back to your card. It can take a few days to show.</p>}
      {(st === 'pickup' || st === 'picked_up' || st === 'refunded') && D.owed && <p className="text-[15px]" style={{ color: MUTED }}>The rest is still going back to your card. The team is on it.</p>}
      {st !== 'failed' && !settled && <ol className="space-y-3" aria-label="How it’s going">
        {steps.map((x, i) => (
          <li key={i} className="flex items-center gap-3 text-[15.5px]">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: x.on ? GREEN : '#dcdde0' }} />
            <span style={{ color: x.on ? INK : MUTED }}>{x.text}{x.on ? <span className="sr-only"> (done)</span> : null}</span>
          </li>))}
      </ol>}
      {st === 'out' && D.outside && <p role="status" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: GREEN_TINT, color: GREEN }}>Your driver is outside.</p>}
      {st === 'delivered' && (D.left || D.photo) && <div className="space-y-2">
        {D.left && <p className="text-[15px]" style={{ color: MUTED }}>Left at the door</p>}
        {D.photo && <img src={D.photo} alt={D.left ? 'Where your order was left' : 'Your order, delivered'} className="max-h-[320px] w-full rounded-2xl object-cover" />}
      </div>}
      {!!t.earned && <p className="text-[15px] font-medium" style={{ color: GREEN }}>You earned {t.earned} {t.unit || 'points'} with this order.</p>}
      {(st === 'making' || st === 'ready' || (st === 'out' && !!t.text?.sent)) && <ReadyTextLine t={t} tenantId={tenantId} o={o} s={s} reload={reload} onWay />}
    </section>);
}

/** The soonest pickup time with room ('' when there's none, so the guest is asked). */
const firstOpen = (m: Menu) => m.times.find((t) => !(m.full || []).includes(t)) || '';
// The time to start on: as soon as it's ready, unless that isn't offered (before opening) or is full.
const startAt = (m: Menu) => (m.asapFull || m.asap === false ? firstOpen(m) : '');
/** When it opens next, in words: "at 7:00 AM", "tomorrow at 7:00 AM", "on Friday at 7:00 AM". */
function opensWords(iso: string, tz?: string): string {
  const day = (d: Date) => { try { return d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : {}); } catch { return d.toLocaleDateString('en-CA'); } };
  const t = new Date(iso); const today = day(new Date());
  // (The next calendar day, counted on the date itself: right on the days the clocks change.)
  const [y, mo, d] = today.split('-').map(Number); const tomorrow = Number.isFinite(y) ? new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10) : day(new Date(Date.now() + 86400000));
  const at = `at ${clock(iso, tz)}`;
  if (day(t) === today) return at;
  if (day(t) === tomorrow) return `tomorrow ${at}`;
  let wd = ''; try { wd = t.toLocaleDateString('en-US', { weekday: 'long', ...(tz ? { timeZone: tz } : {}) }); } catch { wd = t.toLocaleDateString('en-US', { weekday: 'long' }); }
  return `on ${wd} ${at}`;
}

/** A tip for the driver (lib/food-delivery): a percent of the food or an amount; nothing picked is no tip. All of it is
 *  the driver's. */
function TipPick({ food, tip, setTip }: { food: number; tip: Tip; setTip: (t: Tip) => void }) {
  const [typed, setTyped] = React.useState(() => (tip && 'cents' in tip ? (tip.cents / 100).toFixed(2) : ''));
  const [other, setOther] = React.useState(!!tip && 'cents' in tip);
  const on = (t: Tip) => setTip(t);
  const opt = (key: string, label: string, sub: string | null, chosen: boolean, pick: () => void) => (
    <button key={key} type="button" aria-pressed={chosen} onClick={pick} className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl text-[14.5px] font-semibold leading-tight ${RING}`}
      style={chosen ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{label}{sub && <span className="text-[12.5px] font-medium" style={{ color: chosen ? '#d9dadc' : MUTED }}>{sub}</span>}</button>);
  const setAmount = (v: string) => { const clean = v.replace(/[^\d.]/g, '').slice(0, 6); setTyped(clean); const c = Math.round(Number(clean) * 100); on(Number.isFinite(c) && c > 0 ? { cents: Math.min(10000, c) } : null); };
  return (
    <fieldset className="mt-3"><legend className="text-[15px] font-semibold">Tip for your driver</legend>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {opt('none', 'None', null, !tip && !other, () => { setOther(false); on(null); })}
        {TIP_PCTS.map((p) => opt(`p${p}`, `${p}%`, usd(tipCents({ pct: p }, food) / 100), !other && !!tip && 'pct' in tip && tip.pct === p, () => { setOther(false); on({ pct: p }); }))}
        {opt('other', 'Other', null, other, () => { setOther(true); setAmount(typed); })}
      </div>
      {other && <label className="mt-2 block"><span className="text-[14px] font-medium">Tip amount</span>
        <input value={typed} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus className={`mt-1.5 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} /></label>}
      <p className="mt-1.5 text-[13px]" style={{ color: MUTED }}>All of it goes to your driver.</p>
    </fieldset>);
}

/** Delivered (lib/food-delivery): where to, a note for the driver, and checking the address (the fee and the drive). */
function DeliveryFields({ addr, setAddr, note, setNote, check, checking, checkErr, onCheck }: { addr: Addr; setAddr: (a: Addr) => void; note: string; setNote: (n: string) => void;
  check: DCheck | null; checking: boolean; checkErr: string; onCheck: () => void }) {
  const field = (k: keyof Addr, label: string, auto: string, max: number, extra: Record<string, any> = {}, fix = (v: string) => v) => (
    <label className="block min-w-0"><span className="text-[14px] font-medium">{label}</span>
      <input value={addr[k]} onChange={(e) => setAddr({ ...addr, [k]: fix(e.target.value).slice(0, max) })} autoComplete={auto} maxLength={max} className={`mt-1.5 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} {...extra} /></label>);
  return (
    <div className="mt-3 space-y-3">
      {field('line1', 'Street address', 'address-line1', 120)}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">{field('line2', 'Apt or suite', 'address-line2', 60, { placeholder: 'Optional' })}{field('city', 'Town or city', 'address-level2', 60)}</div>
      <div className="grid grid-cols-2 gap-2">{field('state', 'State', 'address-level1', 2, {}, (v) => v.toUpperCase().replace(/[^A-Z]/g, ''))}{field('postalCode', 'ZIP code', 'postal-code', 10, { inputMode: 'numeric' }, (v) => v.replace(/[^\d-]/g, ''))}</div>
      <label className="block"><span className="text-[14px] font-medium">Notes for the driver <span className="font-normal" style={{ color: MUTED }}>(optional)</span></span>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} maxLength={200} className={`mt-1.5 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="Side door, gate code" /></label>
      {check
        ? <p role="status" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: GREEN_TINT, color: GREEN }}><b className="font-semibold">We deliver there.</b> {check.from ? `From ${check.from.name}, about a ${check.driveMin}-minute drive. ` : ''}{check.free || !check.feeCents ? 'Delivery is free for this order' : `Delivery ${usd(check.feeCents / 100)}`}{check.from ? '.' : `, about a ${check.driveMin}-minute drive.`}</p>
        : <button type="button" onClick={onCheck} disabled={checking} className={`${btn} min-h-[48px] w-full text-[15.5px]`} style={{ background: '#fff', border: `1px solid ${INK}`, color: INK }}>{checking ? 'Checking…' : 'Check the address'}</button>}
      {checkErr && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{checkErr}</p>}
    </div>);
}

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

/** "Fri 12:00 PM": until when an order for another day can be canceled. */
const shortWhen = (ms: number, tz?: string) => { try { return new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return ''; } };

/** For another day: its date, then its time (for a delivery, when it gets there), and how many people. */
function LaterPick({ later, day, setDay, at, setAt, people, setPeople, tz, driveMin, subtotal }: { later: Later; day: string; setDay: (d: string) => void; at: string; setAt: (t: string) => void;
  people: string; setPeople: (p: string) => void; tz?: string; driveMin: number | null; subtotal: number }) {
  const [moreDays, setMoreDays] = React.useState(false); const [moreTimes, setMoreTimes] = React.useState(false);
  const d = later.days.find((x) => x.date === day);
  if (!later.days.length) return <p className="mt-2 text-[14px]" style={{ color: MUTED }}>There are no days to order for right now.</p>;
  const days = moreDays || later.days.findIndex((x) => x.date === day) >= 8 ? later.days : later.days.slice(0, 8);
  const times = d ? (moreTimes || d.times.indexOf(at) >= 8 ? d.times : d.times.slice(0, 8)) : [];
  const short = later.minCents !== null ? later.minCents - Math.round(subtotal * 100) : 0;
  return (
    <div className="mt-2 space-y-3">
      <div role="group" aria-label="Day" className="grid grid-cols-4 gap-2">
        {days.map((x) => <button key={x.date} type="button" aria-pressed={x.date === day} aria-label={dayWords(x.date)} onClick={() => { setDay(x.date); setAt(''); setMoreTimes(false); }}
          className={`min-h-[48px] rounded-xl px-1 text-[14.5px] font-semibold ${RING}`} style={x.date === day ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{dayWords(x.date, true)}</button>)}
      </div>
      {later.days.length > 8 && <button type="button" onClick={() => setMoreDays((x) => !x)} className={`block min-h-[44px] text-[15px] font-semibold underline underline-offset-4 ${RING}`} style={{ color: INK }}>{moreDays ? 'Fewer days' : 'More days'}</button>}
      {d && <div role="group" aria-label={driveMin !== null ? 'When it gets to you' : 'Pickup time'} className="grid grid-cols-2 gap-2">
        {times.map((t) => <TimeButton key={t} label={clock(driveMin !== null ? arriveFor(t, driveMin) : t, tz)} full={false} fullWord="" on={at === t} onPick={() => setAt(t)} />)}
      </div>}
      {d && d.times.length > 8 && <button type="button" onClick={() => setMoreTimes((x) => !x)} className={`block min-h-[44px] text-[15px] font-semibold underline underline-offset-4 ${RING}`} style={{ color: INK }}>{moreTimes ? 'Fewer times' : 'Later times'}</button>}
      {!d && <p className="text-[14px]" style={{ color: MUTED }}>Pick a day to see its times.</p>}
      <label className="block"><span className="text-[15px] font-semibold">How many people? <span className="font-normal" style={{ color: MUTED }}>(optional)</span></span>
        <input value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className={`mt-2 block h-12 w-28 rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="20" /></label>
      {at && <p className="text-[14px]" style={{ color: MUTED }}>Paid now. Cancel for a full refund until {shortWhen(Date.parse(at) - later.noticeHours * 3600000, tz)}.</p>}
      {short > 0 && <p role="status" className="text-[14px] font-medium" style={{ color: AMBER }}>Orders for another day start at {usd((later.minCents || 0) / 100)} before tax. Add {usd(short / 100)} more.</p>}
    </div>);
}

/** "Open until 9:00 PM", "Opens 7:00 AM" (today) or "Opens Mon 7:00 AM", or closed. */
function openLine(p: PlaceRow, tz?: string) {
  if (p.open) return p.until ? `Open until ${clock(p.until, tz)}` : 'Open';
  if (!p.opens) return 'Closed';
  const day = (iso: string | Date) => { try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', ...(tz ? { timeZone: tz } : {}) }); } catch { return ''; } };
  return `Opens ${day(p.opens) === day(new Date()) ? clock(p.opens, tz) : shortWhen(Date.parse(p.opens), tz)}`;
}

/** With more than one location: where from (lib/ahead-places). The nearest first once the guest shares where they are
 *  (asked only when they tap, and kept on this page only). */
function PlacePicker({ business, places, tz, onPick, current }: { business: string; places: PlaceRow[]; tz?: string; onPick: (id: string) => void; current?: string | null }) {
  const [near, setNear] = React.useState<{ lat: number; lng: number } | null>(null); const [finding, setFinding] = React.useState(false); const [why, setWhy] = React.useState('');
  const find = () => {
    if (!navigator.geolocation) { setWhy('This phone can’t share where it is. Pick from the list.'); return; }
    setFinding(true); setWhy('');
    navigator.geolocation.getCurrentPosition((pos) => { setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setFinding(false); },
      () => { setFinding(false); setWhy('We couldn’t tell where you are. Pick from the list.'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };
  const rows = places.map((p) => ({ ...p, miles: near && p.lat !== null && p.lng !== null ? Math.round(milesApart(near, { lat: p.lat, lng: p.lng }) * 10) / 10 : null }))
    .sort((a, b) => (a.miles === null ? 1 : 0) - (b.miles === null ? 1 : 0) || (a.miles ?? 0) - (b.miles ?? 0) || Number(b.open) - Number(a.open) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <header><h1 className="text-[26px] font-semibold tracking-tight">{business}</h1><p className="mt-1 text-[15px]" style={{ color: MUTED }}>Where are you ordering from?</p></header>
      {!near && <button type="button" onClick={find} disabled={finding} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{finding ? 'Finding you…' : 'Find the nearest'}</button>}
      {why && <p role="status" className="text-[14px]" style={{ color: AMBER }}>{why}</p>}
      <ul className="space-y-2.5" aria-label="Locations">
        {rows.map((p, i) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.id)} aria-current={current === p.id ? 'true' : undefined} className={`flex w-full flex-col gap-1 rounded-2xl bg-[#fff] px-4 py-3.5 text-left ${RING}`} style={current === p.id ? { border: `1px solid ${INK}`, boxShadow: `inset 0 0 0 1px ${INK}` } : { border: `1px solid ${LINE}` }}>
              <span className="flex items-baseline justify-between gap-3"><span className="text-[17px] font-semibold">{p.name}</span>{p.miles !== null && <span className="shrink-0 text-[14px] tabular-nums" style={{ color: MUTED }}>{p.miles} mi</span>}</span>
              {p.address && <span className="text-[14px]" style={{ color: MUTED }}>{p.address}</span>}
              <span className="text-[14px]" style={{ color: p.open ? GREEN : MUTED }}>{openLine(p, tz)}{near && i === 0 && p.miles !== null ? '. Nearest to you' : ''}</span>
            </button>
          </li>))}
      </ul>
    </div>);
}

export default function OrderAhead() {
  const { tenantId } = useParams() as { tenantId: string };
  const [menu, setMenu] = React.useState<Menu | null>(null); const [err, setErr] = React.useState('');
  const [cart, setCart] = React.useState<CartLine[]>([]); const [open, setOpen] = React.useState<Item | null>(null);
  const [step, setStep] = React.useState<'menu' | 'review' | 'pay'>('menu');
  const [name, setName] = React.useState(''); const [way, setWay] = React.useState<Way | null>(null); const [at, setAt] = React.useState<string>('');
  const [phone, setPhone] = React.useState(''); const [join, setJoin] = React.useState(false);
  // One text when it's ready, if they tick it (lib/ready-text); remembered on this phone.
  const [textMe, setTextMe] = React.useState(false);
  // Delivered: the address (remembered on this phone), the driver's note, and the check (the fee and the drive). A changed
  // address is checked again.
  const [addr, setAddrNow] = React.useState<Addr>(NO_ADDR); const [dnote, setDnote] = React.useState('');
  // The guest's allergies (lib/order-allergy): on every ticket in the kitchen.
  const [allergy, setAllergy] = React.useState<AllergyValue>(NO_ALLERGY);
  const [dcheck, setDcheck] = React.useState<DCheck | null>(null); const [checking, setChecking] = React.useState(false); const [checkErr, setCheckErr] = React.useState('');
  const setAddr = (a: Addr) => { setAddrNow(a); setDcheck(null); setCheckErr(''); };
  const [tip, setTip] = React.useState<Tip>(null);
  // Order again: recent orders and favorites on this phone, and what adding one did.
  const [past, setPast] = React.useState<Past[]>([]); const [againSaid, setAgainSaid] = React.useState<{ text: string; warn: boolean } | null>(null);
  const [moreTimes, setMoreTimes] = React.useState(false);
  // With more than one location (lib/ahead-places): the one picked (from its own link, or kept on this phone), and the
  // picker open to change it.
  const placeRef = React.useRef<string | null>(null); const [picking, setPicking] = React.useState(false);
  const menuPlace = () => (placeRef.current ? { place: placeRef.current } : {});
  // Today, or another day (lib/ahead-days): its day, its time, and how many people.
  const [when, setWhen] = React.useState<'today' | 'later'>('today'); const [lday, setLday] = React.useState(''); const [lat, setLat] = React.useState(''); const [people, setPeople] = React.useState('');
  const laterMode = when === 'later' && !!menu?.later;
  const ways: Way[] = menu ? (laterMode ? menu.later!.ways : menu.ways) : [];
  // The most of one thing: 20, or 100 for another day (lib/ahead-days LATER_MAX_QTY).
  const maxQ = laterMode ? 100 : 20;
  const belowMin = laterMode && menu?.later?.minCents != null && Math.round(cart.reduce((n, l) => n + l.each * l.quantity, 0) * 100) < menu.later.minCents;
  // Offered at the end (lib/menu-upgrades): asked once, right after something's added; not again on this visit for an item
  // whose offer was turned down. `offered`: the sheet open is for something taken as an offer (added without asking again).
  const [after, setAfter] = React.useState<After | null>(null); const [passed, setPassed] = React.useState<string[]>([]); const [offered, setOffered] = React.useState(false);
  const byId = React.useMemo(() => new Map((menu?.sections || []).flatMap((s) => s.items.map((i) => [i.id, i] as [string, Item]))), [menu]);
  // The time chosen is full (or, as soon as it's ready, with every time full): paying waits for one with room.
  // Delivered: also a time no driver can make (lib/driver-load), or before the first one while deliveries are slowed down.
  const noDriver = (t: string) => way === 'delivery' && !!dcheck && (dcheck.leaveFull.includes(t) || (!!dcheck.leaveFirst && Date.parse(t) < Date.parse(dcheck.leaveFirst)));
  const timeFull = (t: string) => !!menu && ((menu.full || []).includes(t) || noDriver(t));
  const asapFullNow = !!menu && (!!menu.asapFull || menu.asap === false || (way === 'delivery' && !!dcheck?.asapNoDriver));
  const chosenFull = !!menu && (at === '' ? asapFullNow : timeFull(at));
  const closedNow = !!menu?.closedNow;
  const noneOpen = !!menu && !closedNow && (!!menu.asapFull || menu.asap === false) && !firstOpen(menu);
  const [placing, setPlacing] = React.useState(false); const [payBusy, setPayBusy] = React.useState(false); const [placeErr, setPlaceErr] = React.useState('');
  const [pay, setPay] = React.useState<{ orderId: string; sig: string; number: string; total: number; deliveryFee?: number; tip?: number; clientSecret: string; publishableKey: string; stripeAccount: string } | null>(null);
  const [track, setTrack] = React.useState<{ o: string; s: string } | null>(null);
  const key = React.useRef<string>('');
  const cartKey = `cf.ahead.cart.${tenantId}`;
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search); const o = q.get('o'), s = q.get('s');
    if (o && s) { setTrack({ o, s }); return; }
    try { const c = JSON.parse(read(cartKey) || '[]'); if (Array.isArray(c)) setCart(c.slice(0, 30)); } catch { /* */ }
    try { const a = JSON.parse(read('cf.ahead.address') || 'null'); if (a && typeof a === 'object') setAddrNow({ line1: String(a.line1 || ''), line2: String(a.line2 || ''), city: String(a.city || ''), state: String(a.state || ''), postalCode: String(a.postalCode || '') }); } catch { /* */ }
    setName(read('cf.ahead.name') || ''); setPhone(read('cf.ahead.phone') || ''); setTextMe(read('cf.ahead.textMe') === '1'); setPast(readPast(tenantId));
    // (Opened from the guest pass at a table: inside is picked, when it's one of the ways.)
    const wantWay = q.get('way');
    placeRef.current = q.get('place') || read(`cf.ahead.place.${tenantId}`) || null;
    void call({ action: 'menu', tenantId, ...menuPlace() }).then(({ d }) => { if (d.ok) { setMenu(d); if (d.pick) { placeRef.current = null; write(`cf.ahead.place.${tenantId}`, null); } if (d.ways?.length === 1) setWay(d.ways[0]); else if (wantWay && (d.ways || []).includes(wantWay)) setWay(wantWay as Way); setAt(startAt(d));
      // (Closed today, with days ahead to order for: Another day to start with.)
      if (d.closedNow && d.later?.days?.length) setWhen('later'); } else setErr(d.error || 'This page isn’t here.'); });
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!track) write(cartKey, cart.length ? JSON.stringify(cart) : null); key.current = ''; }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closed, or not open yet: the times are read again every minute (and when the page comes back into view), so a page
  // left open shows them once it opens. The time picked stays if it's still offered.
  const waiting = !!menu && !track && (!!menu.closedNow || !!menu.opens);
  React.useEffect(() => {
    if (!waiting) return;
    const again = () => void call({ action: 'menu', tenantId, ...menuPlace() }).then(({ d }) => { if (!d?.ok) return; setMenu(d); setAt((a) => (a && (d.times || []).includes(a) ? a : startAt(d))); });
    const i = setInterval(again, 60000); const vis = () => { if (document.visibilityState === 'visible') again(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [waiting, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Changed after going back (another way, time or name): a new order when they continue, never the old one.
  React.useEffect(() => { key.current = ''; }, [way, at, name, phone, join, textMe, addr, dnote, tip, allergy, when, lday, lat, people]);
  // Another day: never at the drive-thru; and the address is checked again (today's drivers don't come into it).
  React.useEffect(() => { if (!menu) return; setDcheck(null); setCheckErr(''); if (way && !ways.includes(way)) setWay(ways.length === 1 ? ways[0] : null); else if (!way && ways.length === 1) setWay(ways[0]);
    // (Back to today: up to 20 of each, said.)
    if (when === 'today' && cart.some((l) => l.quantity > 20)) { setCart((c) => c.map((l) => (l.quantity > 20 ? { ...l, quantity: 20 } : l))); setPlaceErr('For today, up to 20 of each. Check your order.'); } }, [when]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = cart.reduce((n, l) => n + l.quantity, 0); const subtotal = cart.reduce((n, l) => n + l.each * l.quantity, 0);
  /** Into the order (the same item with the same choices is one line); gives back its line's key. */
  const add = (item: Item, picks: Picks, qty: number, offer?: OfferKind, note = '') => {
    const p = priceChoices(item, picks); const each = Math.max(0, item.price + (p.ok ? p.extra : 0)); const text = pickWords(item, picks);
    // (A note of its own makes a line of its own.)
    const key = cart.find((l) => l.itemId === item.id && l.choicesText === text && sameNote(l.note, note))?.key || rid();
    setCart((c) => { const same = c.find((l) => l.itemId === item.id && l.choicesText === text && sameNote(l.note, note)); if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(maxQ, l.quantity + qty), ...(offer && !l.offer ? { offer } : {}) } : l)); return [...c, { key, itemId: item.id, name: item.name, picks, choicesText: text, quantity: qty, each, imageUrl: item.imageUrl, ...(offer ? { offer } : {}), ...(note ? { note } : {}) }]; });
    return key;
  };
  /** Order again: each item as it was, if today's menu still has it the same way; what can't be is said. */
  const addAgain = (lines: Past['lines']) => {
    const missed: string[] = []; let n = 0;
    for (const l of lines) {
      const item = byId.get(l.itemId);
      if (!item) { missed.push(`${l.name} isn’t on the menu now`); continue; }
      if (item.soldOut) { missed.push(`${item.name} is sold out right now`); continue; }
      if (!priceChoices(item, l.picks).ok) { missed.push(`${item.name} has new choices, so add it from the menu`); continue; }
      add(item, l.picks, Math.max(1, Math.min(20, Math.floor(Number(l.quantity)) || 1))); n++;
    }
    const why = missed.map((m) => `${m}.`).join(' ');
    setAgainSaid({ text: n ? `Added to your order.${why ? ` ${why}` : ''}` : `Nothing could be added. ${why}`, warn: missed.length > 0 });
  };
  // Order this again from an order's page: added once the menu's here.
  React.useEffect(() => {
    if (!menu?.on) return; const k = `cf.ahead.again.${tenantId}`; const raw = read(k); if (!raw) return; write(k, null);
    try { const ls = JSON.parse(raw); if (Array.isArray(ls) && ls.length) addAgain(ls.slice(0, 30)); } catch { /* */ }
  }, [menu?.on]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFavorite = (p: Past, fav: boolean) => setPast(rememberPast(tenantId, p, fav));
  // Added from its sheet: then what's offered with it, if there's anything they could have.
  const added = (item: Item, picks: Picks, qty: number, note = '') => {
    const key = add(item, picks, qty, offered ? 'item' : undefined, note); setOpen(null);
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
  const qty = (k: string, d: number) => setCart((c) => c.map((l) => (l.key === k ? { ...l, quantity: Math.max(0, Math.min(maxQ, l.quantity + d)) } : l)).filter((l) => l.quantity > 0));
  // (For another day, typed: 1 to 100.)
  const setQtyTo = (k: string, v: string) => { const n = Math.floor(Number(v.replace(/\D/g, ''))); if (!Number.isFinite(n) || n < 1) return; setCart((c) => c.map((l) => (l.key === k ? { ...l, quantity: Math.min(maxQ, n) } : l))); };
  const checkAddress = async () => {
    if (!addr.line1.trim() || !addr.city.trim() || !addr.state.trim() || !/^\d{5}(-?\d{4})?$/.test(addr.postalCode.trim())) { setCheckErr('Add the street address, town, state and ZIP code.'); return; }
    setChecking(true); setCheckErr('');
    const { d } = await call({ action: 'deliveryCheck', tenantId, address: addr, lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity })), ...(laterMode ? { later: true } : {}), ...menuPlace() });
    setChecking(false);
    if (d.ok) { setDcheck({ from: d.from || null, feeCents: Number(d.feeCents) || 0, free: !!d.free, driveMin: Number(d.driveMin) || 15, token: d.token || null, asapArrive: d.asapArrive || null, leaveFull: Array.isArray(d.leaveFull) ? d.leaveFull : [], leaveFirst: d.leaveFirst || null, asapNoDriver: !!d.asapNoDriver }); write('cf.ahead.address', JSON.stringify(addr)); }
    // (Paused at the counter: when to try again.)
    else setCheckErr(d.code === 'paused' && d.until ? `We’re not taking deliveries for a little while. Pick it up instead, or try again after ${clock(d.until, menu?.timeZone)}.` : d.error || 'That didn’t go through. Try again.');
  };
  const place = async () => {
    if (!way) { setPlaceErr(menu?.ways.includes('delivery') ? 'How will you get it?' : 'How will you pick it up?'); return; }
    if (!name.trim()) { setPlaceErr('What name should we put on the order?'); return; }
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (phone.trim() && digits.length !== 10) { setPlaceErr('A 10-digit phone number, or leave it empty.'); return; }
    const wantText = !!menu?.texts && textMe; const deliver = way === 'delivery';
    if (deliver && !dcheck) { setPlaceErr('Check the address first.'); return; }
    if (deliver && digits.length !== 10) { setPlaceErr('Add your phone number so the driver can reach you.'); return; }
    if (wantText && digits.length !== 10) { setPlaceErr(`Add your mobile number for the text, or untick Text me when ${deliver ? 'it’s on its way' : 'it’s ready'}.`); return; }
    // For another day: its day and time, a number to reach them about it, and the smallest order.
    if (laterMode && (!lday || !lat)) { setPlaceErr('Pick a day and a time.'); return; }
    if (laterMode && digits.length !== 10) { setPlaceErr('Add your phone number, so we can reach you about your order.'); return; }
    if (belowMin) { setPlaceErr(`Orders for another day start at ${usd((menu?.later?.minCents || 0) / 100)} before tax.`); return; }
    setPlacing(true); setPlaceErr(''); write('cf.ahead.name', name.trim()); if (digits) write('cf.ahead.phone', digits); if (menu?.texts) write('cf.ahead.textMe', textMe ? '1' : null);
    if (!key.current) key.current = rid();
    const { d } = await call({ action: 'place', tenantId, key: key.current, ...menuPlace(), name: name.trim(), way, at: laterMode ? lat : at || null, ...(laterMode ? { day: lday, people: people ? Number(people) : null } : {}), ...(deliver ? { address: addr, note: dnote.trim(), deliveryToken: dcheck?.token || null, ...(dcheck?.from ? { deliveryFrom: dcheck.from.id } : {}), tip } : {}), ...(digits.length === 10 && (menu?.points || wantText || deliver || laterMode) ? { phone: digits, ...(menu?.points ? { join } : {}) } : {}), ...(wantText ? { textMe: true } : {}), lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, choices: l.picks, ...(l.offer ? { offer: l.offer } : {}), ...(l.note ? { note: l.note } : {}) })), ...(hasAllergy(allergy) ? { allergy: allergyBody(allergy) } : {}) });
    setPlacing(false);
    // A time that's gone or just filled up: the times are read again, and the soonest open one is chosen.
    if (!d.ok && d.code === 'place') { setPicking(true); return; }
    if (!d.ok) { setPlaceErr(d.error || 'That didn’t go through. Try again.'); if (d.code === 'address' || d.code === 'too_far' || d.code === 'no_driver' || d.code === 'paused' || String(d.code || '').startsWith('delivery_')) setDcheck(null); if (d.code === 'tip') setTip(null); if (d.code === 'at' || d.code === 'slot_full' || d.code === 'asap_closed' || d.code === 'closed_now') void call({ action: 'menu', tenantId, ...menuPlace() }).then(({ d: m }) => { if (m.ok) { setMenu(m); setAt(startAt(m)); if (laterMode && !(m.later?.days || []).some((x: any) => x.date === lday && x.times.includes(lat))) setLat(''); } }); return; }
    if (d.paid) { finish(d.orderId, d.sig); return; }
    setPay(d); setStep('pay');
  };
  const finish = (o: string, s: string) => {
    write(cartKey, null); setCart([]);
    try { window.history.replaceState(null, '', `${window.location.pathname}?o=${encodeURIComponent(o)}&s=${encodeURIComponent(s)}`); } catch { /* */ }
    setTrack({ o, s });
  };
  // A location picked (or picked again): its menu, hours and times, kept on this phone for next time.
  const pickPlace = (id: string) => {
    placeRef.current = id; write(`cf.ahead.place.${tenantId}`, id); setPicking(false); setDcheck(null); setLat(''); setLday('');
    void call({ action: 'menu', tenantId, ...menuPlace() }).then(({ d }) => { if (d.ok) { setMenu(d); setAt(startAt(d)); if (d.ways?.length === 1) setWay(d.ways[0]); } else setErr(d.error || 'This page isn’t here.'); });
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
  if ((menu.pick || picking) && (menu.places || []).length > 1) return shell(<PlacePicker business={menu.business} places={menu.places || []} tz={menu.timeZone} onPick={pickPlace} current={menu.place?.id || null} />);
  if (!menu.on) return shell(<div className="rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}><p className="text-[20px] font-semibold">{menu.business}</p><p className="mt-2 text-[15px]" style={{ color: MUTED }}>Ordering ahead isn’t on right now. Order when you get here.</p></div>);

  if (step === 'pay' && pay) return shell(
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep('review')} disabled={payBusy} className={`min-h-[44px] min-w-[44px] rounded-xl px-1 text-[15px] font-medium disabled:opacity-40 ${RING}`} style={{ color: MUTED }}>Back</button>
        <p className="text-[15px] font-medium tabular-nums" style={{ color: MUTED }}>Order {pay.number}</p>
      </header>
      <section className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <p className="flex items-baseline justify-between"><span className="text-[16px] font-semibold">Total with tax</span><span className="text-[28px] font-semibold tabular-nums">{usd(pay.total)}</span></p>
        {!!pay.deliveryFee && <p className="mt-1 text-[14px]" style={{ color: MUTED }}>With {usd(pay.deliveryFee)} for delivery{pay.tip ? ` and a ${usd(pay.tip)} tip for your driver` : ''}.</p>}
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
              <div className="min-w-0 flex-1"><p className="truncate text-[16px] font-medium">{l.name}</p>{l.choicesText && <p className="truncate text-[13.5px]" style={{ color: MUTED }}>{l.choicesText}</p>}
                {l.note && <p className="text-[13.5px]" style={{ color: MUTED }}>Note: {l.note}</p>}
                {hasAllergy(allergy) && (() => { const w = conflictWords(dishConflict(byId.get(l.itemId), allergy), allergy, 'guest'); return w ? <p className="text-[13.5px] font-semibold" style={{ color: AMBER }}>{w}</p> : null; })()}
                <p className="text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(l.each * l.quantity)}</p></div>
              <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label={`How many ${l.name}`}>
                <button type="button" aria-label={l.quantity === 1 ? `Take off ${l.name}` : 'One fewer'} onClick={() => qty(l.key, -1)} className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${RING}`}><Minus className="h-4 w-4" /></button>
                {laterMode ? <input value={l.quantity} onChange={(e) => setQtyTo(l.key, e.target.value)} inputMode="numeric" aria-label={`How many ${l.name}`} className={`h-9 w-10 rounded-lg text-center text-[16px] font-semibold tabular-nums ${RING}`} style={{ border: `1px solid ${LINE}` }} />
                  : <span className="w-6 text-center text-[16px] font-semibold tabular-nums">{l.quantity}</span>}
                <button type="button" aria-label="One more" disabled={l.quantity >= maxQ} onClick={() => qty(l.key, 1)} className={`inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex justify-between border-t pt-3 text-[15px]" style={{ borderColor: LINE }}><span>Subtotal</span><span className="font-semibold tabular-nums">{usd(subtotal)}</span></p>
        {way === 'delivery' && dcheck && <p className="mt-1 flex justify-between text-[15px]"><span>Delivery</span><span className="font-semibold tabular-nums">{dcheck.free || !dcheck.feeCents ? 'Free' : usd(dcheck.feeCents / 100)}</span></p>}
        {way === 'delivery' && dcheck && tipCents(tip, subtotal) > 0 && <p className="mt-1 flex justify-between text-[15px]"><span>Driver tip</span><span className="font-semibold tabular-nums">{usd(tipCents(tip, subtotal) / 100)}</span></p>}
        <p className="text-[13px]" style={{ color: MUTED }}>Any tax is added on the next step.</p>
      </section>
      <section className="space-y-4 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
        <label className="block"><span className="text-[15px] font-semibold">Name for the order</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="given-name" className={`mt-2 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="First name" /></label>
        <AllergyChips value={allergy} onChange={setAllergy} idBase="ahead-allergy" hint="On every ticket in the kitchen. Leave it empty if there are none." />
        {hasAllergy(allergy) && cart.some((l) => { const c = dishConflict(byId.get(l.itemId), allergy); return c === 'unknown' || c.length > 0; }) && <p role="status" className="text-[14px] font-medium" style={{ color: AMBER }}>Check the dishes marked above before paying. The kitchen sees your allergy either way.</p>}
        {(menu.points || menu.texts || way === 'delivery' || laterMode) && (
          <div>
            <label className="block"><span className="text-[15px] font-semibold">Phone <span className="font-normal" style={{ color: MUTED }}>{way === 'delivery' ? '(so the driver can reach you)' : laterMode ? '(so we can reach you about it)' : '(optional)'}</span></span>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d()\-+ .]/g, '').slice(0, 18))} inputMode="tel" autoComplete="tel" aria-describedby={menu.points ? 'phone-help' : undefined} className={`mt-2 h-12 w-full rounded-xl px-4 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }} placeholder="Phone number" /></label>
            {menu.points && <p id="phone-help" className="mt-1 text-[13.5px]" style={{ color: MUTED }}>It earns your {menu.points.unit}.</p>}
            {menu.texts && <label className="mt-2 flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={textMe} onChange={(e) => setTextMe(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Text me when {way === 'delivery' ? 'it’s on its way' : 'it’s ready'}</label>}
            {menu.points?.askJoin && phone.replace(/\D/g, '').length >= 10 && (
              <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Join the rewards program, if I haven’t already</label>)}
          </div>)}
        {menu.later && (
          <fieldset><legend className="text-[15px] font-semibold">When do you want it?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['today', 'later'] as const).map((w) => <button key={w} type="button" aria-pressed={when === w} onClick={() => setWhen(w)} className={`${btn} min-h-[52px] text-[15px]`} style={when === w ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{w === 'today' ? 'Today' : 'Another day'}</button>)}
            </div>
            {laterMode && <p className="mt-2 text-[14px]" style={{ color: MUTED }}>For catering and big orders. {menu.later.noticeHours >= 24 ? `${menu.later.noticeHours / 24 === 1 ? 'A day’s' : `${menu.later.noticeHours / 24} days’`}` : `${menu.later.noticeHours} hours’`} notice{menu.later.ways.includes('delivery') ? ', picked up or delivered' : ''}.</p>}
          </fieldset>)}
        {ways.length > 1 && (
          <fieldset><legend className="text-[15px] font-semibold">{ways.includes('delivery') ? 'How you’ll get it' : 'How you’ll pick it up'}</legend>
            <div className={`mt-2 grid gap-2 ${ways.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {ways.map((w) => <button key={w} type="button" aria-pressed={way === w} onClick={() => setWay(w)} className={`${btn} min-h-[52px] whitespace-nowrap !px-2 text-[15px]`} style={way === w ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{WAY_BUTTON[w] || 'Inside'}</button>)}
            </div>
            {way === 'curbside' && <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Park and tap I’m here when you arrive. We’ll bring it to your car.</p>}</fieldset>)}
        {ways.length === 1 && (ways[0] === 'delivery' ? <p className="text-[15px] font-semibold">Delivered to you</p> : <p className="text-[15px]"><span className="font-semibold">Pick up:</span> {WAY_WORDS[ways[0]] || 'inside'}</p>)}
        {way === 'delivery' && <DeliveryFields addr={addr} setAddr={setAddr} note={dnote} setNote={setDnote} check={dcheck} checking={checking} checkErr={checkErr} onCheck={checkAddress} />}
        {way === 'delivery' && dcheck && <TipPick food={subtotal} tip={tip} setTip={setTip} />}
        {laterMode ? (way === 'delivery' && !dcheck ? <fieldset><legend className="text-[15px] font-semibold">When it gets to you</legend><p className="mt-1 text-[14px]" style={{ color: MUTED }}>Check the address to see the days and times.</p></fieldset>
          : <fieldset><legend className="text-[15px] font-semibold">{way === 'delivery' ? 'The day, and when it gets to you' : 'The day and time'}</legend>
            <LaterPick later={menu.later!} day={lday} setDay={setLday} at={lat} setAt={setLat} people={people} setPeople={setPeople} tz={menu.timeZone} driveMin={way === 'delivery' && dcheck ? dcheck.driveMin : null} subtotal={subtotal} />
          </fieldset>)
        : closedNow ? (
          <div className="rounded-2xl px-4 py-3" style={{ background: SOFT }} role="status">
            <p className="text-[15px] font-semibold">{menu.lateToday ? 'Too late for pickup today' : 'Closed right now'}</p>
            <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>{menu.nextOpen ? `We open again ${opensWords(menu.nextOpen, menu.timeZone)}. Order ahead then${menu.later?.days.length ? ', or order for another day' : ''}.` : menu.later?.days.length ? 'You can order for another day.' : 'We’re not taking orders for pickup today.'}</p>
          </div>
        ) : way === 'delivery' && !dcheck ? <fieldset><legend className="text-[15px] font-semibold">When it gets to you</legend><p className="mt-1 text-[14px]" style={{ color: MUTED }}>Check the address to see when it can get to you.</p></fieldset>
        : <fieldset><legend className="text-[15px] font-semibold">{way === 'delivery' ? 'When it gets to you' : 'When'}</legend>
          {menu.opens && <p className="mt-1 text-[14px]" style={{ color: MUTED }}>We open {opensWords(menu.opens, menu.timeZone)}. Pick a time from then.</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {menu.asap !== false && <TimeButton label={way === 'delivery' && dcheck?.asapArrive ? `As soon as it’s ready, about ${clock(to5(Date.parse(dcheck.asapArrive)), menu.timeZone)}` : 'As soon as it’s ready'} full={asapFullNow} fullWord={way === 'delivery' && dcheck?.asapNoDriver && !menu.asapFull ? 'No driver free' : 'Full right now'} on={at === ''} onPick={() => setAt('')} wide />}
            {menu.times.slice(0, moreTimes || menu.times.indexOf(at) >= 7 ? undefined : 7).map((t) => <TimeButton key={t} label={clock(way === 'delivery' && dcheck ? arriveFor(t, dcheck.driveMin) : t, menu.timeZone)} full={timeFull(t)} fullWord="Full" on={at === t} onPick={() => setAt(t)} />)}
          </div>
          {way === 'delivery' && dcheck && (dcheck.asapNoDriver || dcheck.leaveFull.length > 0) && <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Times marked full: our drivers are out then.</p>}
          {menu.times.length > 7 && <button type="button" onClick={() => setMoreTimes((x) => !x)} className={`${btn} mt-1 min-h-[44px] px-0 text-[15px] underline underline-offset-4`} style={{ color: INK }}>{moreTimes ? 'Fewer times' : 'Later times'}</button>}
          {menu.closes && menu.times.length > 0 && Date.parse(menu.times[menu.times.length - 1]) > Date.parse(menu.closes) - 15 * 60000 && (moreTimes || menu.times.length <= 7) && <p className="mt-1 text-[14px]" style={{ color: MUTED }}>{way === 'delivery' && dcheck ? `Last delivery about ${clock(arriveFor(menu.times[menu.times.length - 1], dcheck.driveMin), menu.timeZone)}.` : `Last pickup ${clock(menu.times[menu.times.length - 1], menu.timeZone)}.`}</p>}
        </fieldset>}
        {menu.busy && !laterMode && <p className="text-[14px]" style={{ color: MUTED }}>The kitchen is busy right now, so orders are taking about {menu.busy.minutes} {menu.busy.minutes === 1 ? 'minute' : 'minutes'} longer than usual{menu.filling ? ', and pickup times fill faster' : ''}.</p>}
        {placeErr && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{placeErr}</p>}
        {noneOpen && !laterMode && <p className="text-[14px]" style={{ color: AMBER }}>The kitchen’s full right now. Please try again in a few minutes.</p>}
        {laterMode ? <button type="button" onClick={place} disabled={placing || !cart.length || !lat || belowMin || (way === 'delivery' && !dcheck)} className={`${btn} min-h-[56px] w-full text-[17px]`} style={{ background: INK, color: '#fff' }}>{placing ? 'One moment…' : way === 'delivery' && !dcheck ? 'Check the address first' : !lat ? 'Pick a day and time' : belowMin ? 'Add a little more' : 'Continue to pay'}</button>
        : <button type="button" onClick={place} disabled={placing || !cart.length || chosenFull || closedNow || (way === 'delivery' && !dcheck)} className={`${btn} min-h-[56px] w-full text-[17px]`} style={{ background: INK, color: '#fff' }}>{placing ? 'One moment…' : closedNow ? (menu.lateToday ? 'Too late for today' : 'Closed right now') : noneOpen ? 'Full right now' : way === 'delivery' && !dcheck ? 'Check the address first' : chosenFull ? (way === 'delivery' ? 'Pick a delivery time' : 'Pick a pickup time') : 'Continue to pay'}</button>}
        <p className="text-center text-[13px]" style={{ color: MUTED }}>{laterMode ? 'You pay now, and it’s made on its day.' : way === 'delivery' ? 'You pay now, and we bring it to you.' : 'You pay now, so it’s ready when you get here.'}</p>
      </section>
    </div>);

  return shell(
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">{menu.business}</h1>
        <p className="mt-1 text-[15px]" style={{ color: MUTED }}>{headWords(menu.ways)}</p>
        {menu.place && (menu.places || []).length > 1 && <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px]"><span>From <b className="font-semibold">{menu.place.name}</b></span>
          <button type="button" onClick={() => setPicking(true)} className={`min-h-[44px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>Change</button></p>}
        {menu.closedNow && <p className="mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: SOFT }} role="status"><b className="font-semibold">{menu.lateToday ? 'Too late for pickup today.' : 'Closed right now.'}</b> {menu.nextOpen ? `We open again ${opensWords(menu.nextOpen, menu.timeZone)}. ` : ''}{menu.later?.days.length ? 'You can order for another day now.' : 'You can look through the menu now.'}</p>}
      </header>
      {past.length > 0 && (
        <section aria-labelledby="again-title" className="rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}` }}>
          <h2 id="again-title" className="text-[18px] font-semibold tracking-tight">Order again</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {past.map((p) => { const words = pastWords(p); return (
              <li key={p.o} className="flex flex-col gap-2 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[15px] font-semibold leading-snug">{words}</p>
                  <button type="button" aria-pressed={!!p.fav} aria-label={`Favorite: ${words}`} onClick={() => setFavorite(p, !p.fav)} className={`-my-1.5 -mr-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${RING}`}><Star className="h-5 w-5" fill={p.fav ? 'currentColor' : 'none'} style={{ color: p.fav ? INK : MUTED }} aria-hidden /></button>
                </div>
                <p className="text-[13.5px]" style={{ color: MUTED }}>{p.fav ? 'Your favorite' : whenWords(p.at, menu.timeZone)}</p>
                <button type="button" onClick={() => addAgain(p.lines)} aria-label={`Add to order: ${words}`} className={`${btn} mt-auto min-h-[44px] text-[15px]`} style={p.fav ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Add to order</button>
              </li>); })}
          </ul>
          <p aria-live="polite" className={againSaid ? 'mt-3 rounded-2xl px-4 py-3 text-[14.5px]' : 'sr-only'} style={againSaid ? (againSaid.warn ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }) : undefined}>{againSaid?.text || ''}</p>
        </section>)}
      {past.length === 0 && againSaid && <p aria-live="polite" className="rounded-2xl px-4 py-3 text-[14.5px]" style={againSaid.warn ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }}>{againSaid.text}</p>}
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
      {open && <ItemSheet item={open} max={maxQ} onAdd={(p, q, n) => added(open, p, q, n)} onClose={() => { setOpen(null); setOffered(false); }} />}
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
