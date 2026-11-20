'use client';
// src/app/drive-thru/[tenantId]/kiosk/page.tsx — THE KIOSK (design canvas "Self-order kiosk"; lib/kiosk, api/kiosk): a
// tablet by the door with the card reader beside it. Guests tap Start, pick from the menu (photos, choices, prices and
// offers as at the counter), review, pay on the reader, and get a number to watch for. The kitchen gets the order only
// once it's paid; an order left here is let go and what it held goes back on the shelf.
//   Set up once by a manager (api/kitchen 'pair', kind 'kiosk'), who then picks its card reader (signed in, or later with
//   their PIN under Team). Its key only takes this kiosk's orders and payments. Nothing is kept on the tablet but the
//   key: the order lives in the page, and starts over by itself when it's left alone.

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Check, Minus, Plus, X } from 'lucide-react';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';
import { PinPad } from '@/components/kitchen/PinPad';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { offersFor, sizedUp, type OfferKind, type SizeUp } from '@/lib/menu-upgrades';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex items-center justify-center gap-2 rounded-2xl px-5 font-semibold disabled:opacity-40 ${RING}`;
const dark = { background: INK, color: '#fff' }, quiet = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
/** Untouched this long, it asks "Still ordering?", and starts over this long after that. Paying, it waits longer. */
const IDLE_MS = 60000, ASK_MS = 15000, PAY_IDLE_MS = 120000, PAID_MS = 20000, POLL_MS = 2000;
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const keyName = (t: string) => `cf.drivethru.kiosk.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((x) => x.toString(16).padStart(2, '0')).join('');

type Item = { id: string; name: string; section: string; words: string | null; price: number; happy?: boolean; from: boolean; startPrice: number; imageUrl: string | null; choices: any[]; soldOut: boolean; calories?: number | null; upgrades?: { size: boolean; items: string[] } };
type Menu = { business: string; payments: boolean; reader: boolean; askToGo: boolean; taxPct: number; sections: { name: string; items: Item[] }[] };
type Line = { key: string; itemId: string; name: string; picks: Picks; choicesText: string; quantity: number; each: number; offer?: OfferKind };
/** Right after something's added: what's offered with it (kept as first shown), and what's been taken. */
type After = { key: string; itemId: string; name: string; qty: number; size: SizeUp | null; items: Item[]; took: string[] };
type Placed = { orderId: string; number: string; total: number; lines: { name: string; quantity: number; choicesText: string | null; price: number }[] };
type Paying = { state: 'starting' | 'on_reader' | 'declined' | 'trouble'; message?: string | null };
type Reader = { id: string; label: string; online: boolean; test: boolean };

async function call(body: any) {
  try { const r = await fetch('/api/kiosk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; }
  catch { return { status: 0, d: { ok: false, error: 'No connection. Try again.' } }; }
}
const pickWords = (item: Item, picks: Picks) => { const p = priceChoices(item, picks); return p.ok ? p.text : ''; };

function Modal({ label, onClose, children, wide }: { label: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  const box = React.useRef<HTMLDivElement>(null); const close = React.useRef(onClose); close.current = onClose;
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; (box.current?.querySelector<HTMLElement>('[data-start]:not([disabled])') || box.current?.querySelector<HTMLElement>('button'))?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current?.(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22,23,26,0.5)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} className={`flex max-h-[92dvh] w-full flex-col rounded-3xl bg-[#fff] text-left ${wide ? 'max-w-2xl' : 'max-w-md'}`} style={{ color: INK }}>{children}</div>
    </div>
  );
}

function ItemSheet({ item, onAdd, onClose }: { item: Item; onAdd: (picks: Picks, qty: number) => void; onClose: () => void }) {
  const [picks, setPicks] = React.useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = React.useState(1); const [tried, setTried] = React.useState(false);
  const priced = priceChoices(item, picks); const each = Math.max(0, item.price + (priced.ok ? priced.extra : 0));
  return (
    <Modal label={item.name} onClose={onClose} wide>
      <div className="flex items-center justify-between gap-3 px-6 pt-6">
        <h2 className="min-w-0 truncate text-[24px] font-semibold tracking-tight">{item.name}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${RING}`} style={{ border: `1px solid ${LINE}` }}><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          {item.imageUrl && <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover sm:w-56" style={{ background: SOFT }} />}
          {(item.words || item.calories != null) && <p className="text-[16px] leading-relaxed" style={{ color: MUTED }}>{item.words}{item.words && item.calories != null ? ' ' : ''}{item.calories != null && <span className="whitespace-nowrap">({item.calories} cal)</span>}</p>}
        </div>
        <div className="mt-4"><ChoicePicker item={item} picks={picks} onChange={(p) => { setTried(false); setPicks(p); }} /></div>
        {!priced.ok && tried && <p role="alert" className="mt-3 text-[15px] font-semibold" style={{ color: AMBER }}>{priced.error}</p>}
      </div>
      <div className="flex items-center gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
        <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="How many">
          <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`inline-flex h-14 w-14 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Minus className="h-5 w-5" /></button>
          <span className="w-8 text-center text-[19px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
          <button type="button" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))} className={`inline-flex h-14 w-14 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-5 w-5" /></button>
        </div>
        <button type="button" data-start onClick={() => (priced.ok ? onAdd(picks, qty) : setTried(true))} className={`${btn} min-h-[56px] flex-1 text-[17px] tabular-nums`} style={priced.ok ? dark : { background: LINE, color: MUTED }}>Add{qty > 1 ? ` ${qty}` : ''}, {usd(each * qty)}</button>
      </div>
    </Modal>
  );
}

/** The card reader this kiosk takes cards on: a manager picks it (signed in here, or with their PIN). */
function ReaderSheet({ tenantId, kioskKey, onClose, onPicked }: { tenantId: string; kioskKey: string; onClose: () => void; onPicked: () => void }) {
  const [pin, setPin] = React.useState<string | null>(null); const [needPin, setNeedPin] = React.useState(false);
  const [list, setList] = React.useState<{ readers: Reader[]; current: string | null } | null>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState('');
  React.useEffect(() => { void call({ action: 'readers', tenantId, key: kioskKey }).then(({ d }) => { if (d.ok) setList({ readers: d.readers || [], current: d.current || null }); else if (d.needsManager) setNeedPin(true); else setErr(d.error || 'The card readers couldn’t be listed. Try again.'); }); }, [tenantId, kioskKey]);
  const check = async (p: string) => {
    const { d } = await call({ action: 'readers', tenantId, key: kioskKey, pin: p });
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    setPin(p); setList({ readers: d.readers || [], current: d.current || null }); return { ok: true as const, staff: { id: '', name: String(d.by || ''), pass: '' } };
  };
  if (needPin && !list) return <PinPad check={check} onDone={() => setNeedPin(false)} onClose={onClose} title="A manager’s PIN" line="It changes the card reader this kiosk takes cards on." />;
  const pick = async (r: Reader) => {
    setBusy(r.id); setErr('');
    const { d } = await call({ action: 'setReader', tenantId, key: kioskKey, readerId: r.id, ...(pin ? { pin } : {}) });
    setBusy('');
    if (d.ok) { setList((l) => (l ? { ...l, current: r.id } : l)); onPicked(); } else setErr(d.error || 'That didn’t go through. Try again.');
  };
  return (
    <Modal label="This kiosk’s card reader" onClose={onClose}>
      <div className="px-6 pt-6"><h2 className="text-[22px] font-semibold tracking-tight">This kiosk’s card reader</h2>
        <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Guests pay on the reader beside this tablet. Pick it here.</p></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {!list && !err && <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />}
        {list && !list.readers.length && <p className="text-[15px]" style={{ color: MUTED }}>No card readers yet. Add one under Settings, Payments, then pick it here.</p>}
        {list && list.readers.length > 0 && <ul className="space-y-2">{list.readers.map((r) => { const on = list.current === r.id; return (
          <li key={r.id}><button type="button" disabled={!!busy} onClick={() => pick(r)} aria-pressed={on} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl px-4 text-left ${RING}`} style={on ? dark : quiet}>
            <span className="min-w-0"><span className="block truncate text-[16px] font-semibold">{r.label}{r.test ? ' (test)' : ''}</span><span className="block text-[13.5px]" style={{ color: on ? '#d6d7da' : r.online ? GREEN : AMBER }}>{r.online ? 'Online' : 'Offline'}</span></span>
            {on ? <Check className="h-5 w-5 shrink-0" aria-hidden /> : busy === r.id ? <span className="text-[14px]">Saving…</span> : null}
          </button></li>); })}</ul>}
        {err && <p role="alert" className="mt-3 text-[15px]" style={{ color: AMBER }}>{err}</p>}
      </div>
      <div className="border-t px-6 py-4" style={{ borderColor: LINE }}><button type="button" data-start onClick={onClose} className={`${btn} min-h-[52px] w-full text-[16px]`} style={dark}>Done</button></div>
    </Modal>
  );
}

export default function KioskScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = React.useState<string | null>(null); const [ready, setReady] = React.useState(false); const [stopped, setStopped] = React.useState('');
  const [menu, setMenu] = React.useState<Menu | null>(null); const [loadErr, setLoadErr] = React.useState(''); const [closed, setClosed] = React.useState('');
  const [step, setStep] = React.useState<'start' | 'menu' | 'review' | 'pay' | 'paid'>('start');
  const [section, setSection] = React.useState(''); const [cart, setCart] = React.useState<Line[]>([]); const [open, setOpen] = React.useState<Item | null>(null);
  const [after, setAfter] = React.useState<After | null>(null); const [passed, setPassed] = React.useState<string[]>([]); const [offered, setOffered] = React.useState(false);
  const [name, setName] = React.useState(''); const [toGo, setToGo] = React.useState<boolean | null>(null);
  const [placed, setPlaced] = React.useState<Placed | null>(null); const [paying, setPaying] = React.useState<Paying | null>(null); const [paidName, setPaidName] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [ask, setAsk] = React.useState<number | null>(null); const [, setTick] = React.useState(0);
  const [team, setTeam] = React.useState(false); const [leaving, setLeaving] = React.useState(false);
  const touched = React.useRef(Date.now()); const paidAt = React.useRef(0); const orderKey = React.useRef(''); const checking = React.useRef(false);

  React.useEffect(() => { setKey(read(keyName(tenantId))); setReady(true); }, [tenantId]);
  const lost = (d: any) => { write(keyName(tenantId), null); setKey(null); setStopped(d?.error || 'This kiosk was stopped. A manager can set it up again.'); };
  const loadMenu = React.useCallback(async () => {
    if (!key) return;
    const { status, d } = await call({ action: 'menu', tenantId, key });
    if (status === 401) { lost(d); return; }
    if (d.closed || status === 403) { setClosed(d.error || 'Ordering here is closed for now. Please order at the counter.'); return; }
    if (d.ok) { setMenu(d); setClosed(''); setLoadErr(''); setSection((s) => (d.sections.some((x: any) => x.name === s) ? s : d.sections[0]?.name || '')); } else setLoadErr(d.error || 'The menu couldn’t be loaded. Try again.');
  }, [tenantId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void loadMenu(); }, [loadMenu]);
  // Between guests the menu is read again every minute (what's sold out, what's on now).
  React.useEffect(() => { if (step !== 'start' || !key) return; const i = setInterval(() => void loadMenu(), 60000); return () => clearInterval(i); }, [step, key, loadMenu]);
  // Any touch counts as still ordering.
  React.useEffect(() => {
    const t = () => { touched.current = Date.now(); setAsk(null); };
    window.addEventListener('pointerdown', t); window.addEventListener('keydown', t);
    return () => { window.removeEventListener('pointerdown', t); window.removeEventListener('keydown', t); };
  }, []);
  // A new order key whenever the order changes after going back: never the old order paid for.
  React.useEffect(() => { orderKey.current = ''; }, [cart, name, toGo]);

  const byId = React.useMemo(() => new Map((menu?.sections || []).flatMap((s) => s.items.map((i) => [i.id, i] as [string, Item]))), [menu]);
  const count = cart.reduce((n, l) => n + l.quantity, 0); const subtotal = Math.round(cart.reduce((n, l) => n + l.each * l.quantity, 0) * 100) / 100;
  const tax = Math.round(subtotal * (menu?.taxPct || 0)) / 100; const total = Math.round((subtotal + tax) * 100) / 100;

  const startOver = React.useCallback(() => {
    setCart([]); setName(''); setToGo(null); setPlaced(null); setPaying(null); setAfter(null); setOpen(null); setPassed([]); setOffered(false);
    setErr(''); setAsk(null); setLeaving(false); setPaidName(''); orderKey.current = ''; setStep('start'); void loadMenu();
  }, [loadMenu]);
  // Let the order go (the reader stops asking; what it held goes back): a card approved at that moment is kept.
  const letGo = React.useCallback(async (then: 'start' | 'review') => {
    if (!placed) { if (then === 'start') startOver(); else setStep('review'); return; }
    setBusy(true);
    const { d } = await call({ action: 'cancel', tenantId, key, orderId: placed.orderId });
    setBusy(false);
    if (d.ok && d.state === 'paid') { paidAt.current = Date.now(); setPaidName(name.trim().split(' ')[0] || ''); setStep('paid'); return; }
    // Not let go (the card still being processed, or no connection): said, and when it was left alone, tried again
    // shortly, so the next guest never finds this order waiting on the reader.
    if (!d.ok) { setErr(d.error || 'That didn’t go through. Try again.'); if (then === 'start') { setLeaving(false); setAsk(Date.now()); } return; }
    setPlaced(null); setPaying(null); orderKey.current = '';
    if (then === 'start') startOver(); else { setErr(''); setStep('review'); }
  }, [placed, tenantId, key, name, startOver]);

  // Left alone: "Still ordering?", then it starts over (paying: the order is let go first). The paid screen goes back
  // to the start by itself.
  React.useEffect(() => {
    const i = setInterval(() => {
      setTick((n) => n + 1);
      const now = Date.now();
      if (step === 'paid') { if (now - paidAt.current > PAID_MS) startOver(); return; }
      if (step === 'start' || open || team) return;
      const limit = step === 'pay' ? PAY_IDLE_MS : IDLE_MS;
      if (ask === null) { if (now - touched.current > limit) setAsk(now); return; }
      if (now - ask > ASK_MS && !leaving) { setLeaving(true); void letGo('start'); }
    }, 1000);
    return () => clearInterval(i);
  }, [step, ask, open, team, leaving, letGo, startOver]);

  /** Into the order (the same item with the same choices is one line); gives back its line's key. */
  const add = (item: Item, picks: Picks, qty: number, offer?: OfferKind) => {
    const p = priceChoices(item, picks); const each = Math.max(0, item.price + (p.ok ? p.extra : 0)); const text = pickWords(item, picks);
    const k = cart.find((l) => l.itemId === item.id && l.choicesText === text)?.key || rid();
    setCart((c) => { const same = c.find((l) => l.itemId === item.id && l.choicesText === text); if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + qty), ...(offer && !l.offer ? { offer } : {}) } : l)); return [...c, { key: k, itemId: item.id, name: item.name, picks, choicesText: text, quantity: qty, each, ...(offer ? { offer } : {}) }]; });
    return k;
  };
  // Added from its sheet: then what's offered with it, if there's anything they could have (once an item).
  const added = (item: Item, picks: Picks, qty: number) => {
    const k = add(item, picks, qty, offered ? 'item' : undefined); setOpen(null);
    if (offered) { setOffered(false); return; }
    if (after && !after.took.length) setPassed((p) => [...p, after.itemId]);
    setAfter(null);
    if (passed.includes(item.id)) return;
    const o = offersFor(item, picks, (id) => byId.get(id), (id) => cart.some((l) => l.itemId === id));
    if (o.size || o.items.length) setAfter({ key: k, itemId: item.id, name: item.name, qty, size: o.size, items: o.items, took: [] });
  };
  // The size up: the ones just added, a size bigger (the rest of a line they were added to stays as it was).
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
  const qty = (k: string, d: number) => { setAfter(null); setCart((c) => c.map((l) => (l.key === k ? { ...l, quantity: Math.max(0, Math.min(20, l.quantity + d)) } : l)).filter((l) => l.quantity > 0)); };

  const toPaid = (n?: string) => { paidAt.current = Date.now(); setPaidName(name.trim().split(' ')[0] || ''); if (n) setPlaced((p) => (p ? { ...p, number: n } : p)); setStep('paid'); };
  const answer = (d: any) => {
    if (d.ok && d.state === 'paid') { toPaid(d.number); return; }
    if (d.ok && d.state === 'let_go') { setPaying({ state: 'trouble', message: 'This order was let go. Please start again.' }); return; }
    if (d.ok) { setPaying({ state: d.state === 'declined' ? 'declined' : d.state === 'starting' || d.state === 'none' ? 'starting' : 'on_reader', message: d.message || null }); return; }
    setPaying({ state: 'trouble', message: d.error || 'The card reader didn’t answer. Try again.' });
  };
  /** Pay: the order is placed (once), then its total goes to this kiosk's reader. */
  const pay = async () => {
    if (menu?.askToGo && toGo === null) { setErr('For here or to go?'); return; }
    setBusy(true); setErr('');
    let p = placed;
    if (!p) {
      if (!orderKey.current) orderKey.current = rid();
      const { status, d } = await call({ action: 'place', tenantId, key, orderKey: orderKey.current, name: name.trim(), ...(menu?.askToGo ? { toGo: toGo === true } : {}),
        lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, choices: l.picks, ...(l.offer ? { offer: l.offer } : {}) })) });
      if (status === 401) { setBusy(false); lost(d); return; }
      if (!d.ok) { setBusy(false); setErr(d.error || 'That didn’t go through. Try again.'); if (d.code === 'sold_out' || d.code === 'gone' || d.code === 'line') void loadMenu(); if (d.code === 'closed') orderKey.current = ''; return; }
      if (d.paid) { setBusy(false); setPlaced({ orderId: d.orderId, number: d.number, total: 0, lines: [] }); toPaid(d.number); return; }
      p = { orderId: d.orderId, number: d.number, total: d.total, lines: d.lines || [] }; setPlaced(p);
    }
    setStep('pay'); setPaying({ state: 'starting' }); touched.current = Date.now();
    const { d } = await call({ action: 'pay', tenantId, key, orderId: p.orderId });
    setBusy(false); answer(d);
  };
  // While the reader is asking: how it's going, every couple of seconds.
  React.useEffect(() => {
    if (step !== 'pay' || !placed || !paying || paying.state === 'declined' || paying.state === 'trouble') return;
    const i = setInterval(async () => {
      if (checking.current) return; checking.current = true;
      const { d } = await call({ action: 'check', tenantId, key, orderId: placed.orderId }).finally(() => { checking.current = false; });
      if (d.ok || d.error) answer(d);
    }, POLL_MS);
    return () => clearInterval(i);
  }, [step, placed, paying, tenantId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <main className="min-h-dvh" style={{ background: SOFT }} />;
  if (!key) return <ScreenSetup kiosk tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); setTeam(true); }} />;
  const items = menu?.sections.find((s) => s.name === section)?.items || [];
  const open4 = !!menu && menu.payments && menu.reader && !closed;
  const offerBox = after && (after.size || after.items.length) ? (() => {
    const line = cart.find((l) => l.key === after.key); const item = byId.get(after.itemId);
    const q = Math.max(1, Math.min(after.qty, line?.quantity || 1)); const bigger = after.size && line && item && !after.took.includes('size') ? priceChoices(item, sizedUp(line.picks, after.size)) : null;
    const took = (k: string) => after.took.includes(k);
    const addedTag = (w: string) => <span className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[15px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}><Check className="h-4 w-4" aria-hidden />{w}</span>;
    return (
      <div role="group" aria-labelledby="kiosk-offer" className="space-y-2 rounded-2xl p-4" style={{ background: SOFT }}>
        <p id="kiosk-offer" className="text-[16px] font-semibold">Anything with it?</p>
        <ul className="space-y-2">
          {after.size && <li className="flex items-center gap-3 rounded-xl bg-[#fff] p-2 pl-3">
            <span className="min-w-0 flex-1 text-[15px]"><b className="font-semibold">Size up to {after.size.to}</b>{bigger?.ok && <span className="block text-[13.5px]" style={{ color: MUTED }}>{after.name}, {bigger.text}</span>}</span>
            {took('size') ? addedTag('Changed') : <button type="button" disabled={!bigger?.ok} onClick={takeSize} aria-label={`Size up to ${after.size.to}, ${usd(after.size.adds * q)} more`} className={`${btn} min-h-[48px] shrink-0 px-4 text-[15px] tabular-nums`} style={dark}>+{usd(after.size.adds * q)}</button>}
          </li>}
          {after.items.map((x) => <li key={x.id} className="flex items-center gap-3 rounded-xl bg-[#fff] p-2 pl-3">
            {x.imageUrl && <img src={x.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" style={{ background: SOFT }} />}
            <span className="min-w-0 flex-1 text-[15px]"><b className="font-semibold">{x.name}</b> <span className="tabular-nums" style={{ color: MUTED }}>{x.from ? `from ${usd(x.startPrice)}` : usd(x.price)}</span></span>
            {took(`item:${x.id}`) ? addedTag('Added') : <button type="button" onClick={() => takeItem(x)} aria-label={`Add ${x.name}`} className={`${btn} min-h-[48px] shrink-0 px-4 text-[15px]`} style={dark}>Add</button>}
          </li>)}
        </ul>
        <button type="button" onClick={closeAfter} className={`${btn} min-h-[48px] bg-[#fff] text-[15px]`} style={{ color: INK }}>{after.took.length ? 'Done' : 'No thanks'}</button>
      </div>);
  })() : null;
  const lineRows = (big: boolean) => <ul className="space-y-2">{cart.map((l) => (
    <li key={l.key} className="flex items-center gap-3 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }}>
      <span className="min-w-0 flex-1"><span className={`block font-semibold ${big ? 'text-[17px]' : 'text-[15.5px]'}`}>{l.name}</span>{l.choicesText && <span className="block text-[13.5px]" style={{ color: MUTED }}>{l.choicesText}</span>}<span className="block text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(l.each * l.quantity)}</span></span>
      <span className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label={`How many ${l.name}`}>
        <button type="button" aria-label={l.quantity === 1 ? `Take ${l.name} off` : `One fewer ${l.name}`} onClick={() => qty(l.key, -1)} className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${RING}`}><Minus className="h-4 w-4" /></button>
        <span className="w-6 text-center text-[16px] font-semibold tabular-nums">{l.quantity}</span>
        <button type="button" aria-label={`One more ${l.name}`} disabled={l.quantity >= 20} onClick={() => qty(l.key, 1)} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
      </span>
    </li>))}</ul>;
  const stillAsk = ask !== null && !leaving && (
    <Modal label={step === 'pay' ? 'Still there?' : 'Still ordering?'}>
      <div className="space-y-2 px-6 pt-6"><h2 className="text-[24px] font-semibold tracking-tight">{step === 'pay' ? 'Still there?' : 'Still ordering?'}</h2>
        <p className="text-[16px]" style={{ color: MUTED }} aria-live="polite">{step === 'pay' ? 'This order will be canceled' : 'We’ll start over'} in {Math.max(0, Math.ceil((ASK_MS - (Date.now() - ask)) / 1000))} seconds.</p></div>
      <div className="px-6 py-5"><button type="button" data-start onClick={() => { touched.current = Date.now(); setAsk(null); }} className={`${btn} min-h-[56px] w-full text-[17px]`} style={dark}>{step === 'pay' ? 'I’m still here' : 'Keep ordering'}</button></div>
    </Modal>);

  if (step === 'start') return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center p-6 text-center" style={{ background: SOFT, color: INK }}>
      <h1 className="text-[clamp(32px,5vw,56px)] font-semibold tracking-tight">{menu?.business || ' '}</h1>
      {!menu && !loadErr && !closed && <div className="mt-8 h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />}
      {(loadErr || closed) && <p role="alert" className="mt-4 max-w-md text-[17px]" style={{ color: AMBER }}>{closed || loadErr}</p>}
      {menu && !closed && (open4 ? <>
        <p className="mt-3 text-[18px]" style={{ color: MUTED }}>Order here and pay with your card</p>
        <button type="button" onClick={() => { touched.current = Date.now(); setStep('menu'); }} className={`${btn} mt-10 min-h-[76px] px-12 text-[22px]`} style={dark}>Start your order</button>
      </> : <div className="mt-6 max-w-md rounded-3xl bg-[#fff] p-6 text-left" style={{ border: `1px solid ${LINE}` }}>
        <p className="text-[18px] font-semibold">Not taking orders yet</p>
        <p className="mt-1.5 text-[15.5px]" style={{ color: MUTED }}>Please order at the counter.</p>
        <p className="mt-3 text-[14px]" style={{ color: MUTED }}>{!menu.payments ? 'For the team: card payments aren’t set up for this business yet.' : 'For the team: pick the card reader beside this tablet under Team.'}</p>
      </div>)}
      <button type="button" onClick={() => setTeam(true)} className={`absolute bottom-4 right-4 min-h-[44px] rounded-xl px-4 text-[14px] font-medium ${RING}`} style={{ color: MUTED }}>Team</button>
      {team && <ReaderSheet tenantId={tenantId} kioskKey={key} onClose={() => { setTeam(false); void loadMenu(); }} onPicked={() => void loadMenu()} />}
    </main>);

  if (step === 'paid') return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-md rounded-3xl bg-[#fff] p-8" style={{ border: `1px solid ${LINE}` }}>
        <p className="text-[18px] font-semibold" style={{ color: GREEN }} role="status">Paid. Thank you{paidName ? `, ${paidName}` : ''}</p>
        <p className="mt-6 text-[16px]" style={{ color: MUTED }}>Your number</p>
        <p className="text-[96px] font-semibold leading-none tracking-tight tabular-nums">{placed?.number || ''}</p>
        <p className="mt-6 text-[16px] leading-relaxed" style={{ color: MUTED }}>We’ll call your number when it’s ready.</p>
        <button type="button" onClick={startOver} className={`${btn} mt-8 min-h-[56px] w-full text-[17px]`} style={quiet}>Done</button>
      </div>
    </main>);

  if (step === 'pay') return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-lg space-y-5 rounded-3xl bg-[#fff] p-8" style={{ border: `1px solid ${LINE}` }}>
        <div><p className="text-[18px] font-semibold">Your order</p>
          <p className="mt-1 text-[15.5px] leading-relaxed" style={{ color: MUTED }}>{(placed?.lines || []).map((l) => `${l.quantity} ${l.name}${l.choicesText ? `, ${l.choicesText}` : ''}`).join('. ')}</p></div>
        <p className="text-[44px] font-semibold leading-none tabular-nums">{usd(placed?.total || 0)}</p>
        {paying?.state === 'declined' || paying?.state === 'trouble' ? (
          <div className="space-y-3 rounded-2xl p-5" style={{ background: AMBER_TINT }} role="alert">
            <p className="text-[17px] font-semibold" style={{ color: AMBER }}>{paying.state === 'declined' ? 'The card didn’t go through' : 'That didn’t go through'}</p>
            {paying.message && <p className="text-[15.5px]" style={{ color: AMBER }}>{paying.message}</p>}
            <button type="button" disabled={busy} onClick={pay} className={`${btn} min-h-[56px] w-full text-[17px]`} style={dark}>{busy ? 'Starting…' : 'Try again'}</button>
          </div>
        ) : (
          <div className="rounded-2xl p-5 text-[19px] font-semibold" style={dark} role="status">{paying?.state === 'on_reader' ? 'Tap, insert or swipe your card on the reader' : 'Getting the card reader ready…'}</div>
        )}
        {err && <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>}
        <button type="button" disabled={busy} onClick={() => void letGo('review')} className={`${btn} min-h-[56px] w-full text-[17px]`} style={quiet}>Cancel</button>
      </div>
      {stillAsk}
    </main>);

  const head = (back: React.ReactNode) => (
    <header className="flex items-center justify-between gap-4 px-6 pb-3 pt-5">
      <p className="min-w-0 truncate text-[22px] font-semibold tracking-tight">{menu?.business}</p>
      {back}
    </header>);
  const startOverBtn = <button type="button" onClick={startOver} className={`${btn} min-h-[52px] text-[16px]`} style={quiet}>Start over</button>;

  if (step === 'review') return (
    <main className="min-h-dvh pb-8" style={{ background: SOFT, color: INK }}>
      {head(startOverBtn)}
      <div className="mx-auto grid max-w-5xl gap-5 px-6 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="kiosk-review" className="space-y-3 self-start rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
          <h1 id="kiosk-review" className="text-[22px] font-semibold tracking-tight">Your order</h1>
          {cart.length ? lineRows(true) : <p className="text-[16px]" style={{ color: MUTED }}>Nothing in your order yet.</p>}
          <button type="button" onClick={() => setStep('menu')} className={`${btn} min-h-[52px] text-[16px]`} style={quiet}>Add more</button>
        </section>
        <section aria-label="Name and pay" className="space-y-4 self-start rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
          <label className="block"><span className="text-[15px] font-semibold">Your first name</span> <span className="text-[14px]" style={{ color: MUTED }}>(optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} autoComplete="off" className="mt-1.5 min-h-[56px] w-full rounded-2xl px-4 text-[18px] outline-none focus:border-[#16171a]" style={{ border: `1px solid ${LINE}` }} placeholder="So we can call it" /></label>
          {menu?.askToGo && <div role="radiogroup" aria-label="For here or to go" className="grid grid-cols-2 gap-2">
            {([[false, 'For here'], [true, 'To go']] as [boolean, string][]).map(([v, w]) => <button key={w} type="button" role="radio" aria-checked={toGo === v} onClick={() => { setToGo(v); setErr(''); }} className={`${btn} min-h-[56px] text-[17px]`} style={toGo === v ? dark : quiet}>{w}</button>)}
          </div>}
          <dl className="space-y-1 text-[16px]">
            <div className="flex justify-between"><dt style={{ color: MUTED }}>Subtotal</dt><dd className="tabular-nums">{usd(subtotal)}</dd></div>
            <div className="flex justify-between"><dt style={{ color: MUTED }}>Tax</dt><dd className="tabular-nums">{usd(tax)}</dd></div>
            <div className="flex justify-between text-[20px] font-semibold"><dt>Total</dt><dd className="tabular-nums">{usd(total)}</dd></div>
          </dl>
          {err && <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>}
          <button type="button" disabled={!cart.length || busy} onClick={pay} className={`${btn} min-h-[64px] w-full text-[19px] tabular-nums`} style={dark}>{busy ? 'One moment…' : `Pay ${usd(total)}`}</button>
          <p className="text-[14px]" style={{ color: MUTED }}>You’ll pay on the card reader. The kitchen starts once it’s paid.</p>
        </section>
      </div>
      {stillAsk}
    </main>);

  return (
    <main className="min-h-dvh pb-28 lg:pb-6" style={{ background: SOFT, color: INK }}>
      {head(startOverBtn)}
      <div className="grid gap-5 px-6 lg:grid-cols-[1fr_380px]">
        <section aria-label="Menu" className="min-w-0">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3" role="tablist" aria-label="Menu sections">
            {(menu?.sections || []).map((s) => <button key={s.name} type="button" role="tab" aria-selected={s.name === section} onClick={() => setSection(s.name)} className={`${btn} min-h-[52px] shrink-0 rounded-full text-[16px]`} style={s.name === section ? dark : quiet}>{s.name}</button>)}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{items.map((m) => (
            <li key={m.id}><button type="button" disabled={m.soldOut} onClick={() => { setErr(''); setOpen(m); }} aria-label={`${m.name}, ${m.soldOut ? 'sold out' : `${m.from ? 'from ' : ''}${usd(m.from ? m.startPrice : m.price)}`}`}
              className={`flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[#fff] text-left disabled:opacity-50 ${RING}`} style={{ border: `1px solid ${LINE}` }}>
              {m.imageUrl ? <img src={m.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" style={{ background: SOFT }} /> : <span className="block aspect-[4/3] w-full" style={{ background: SOFT }} aria-hidden />}
              <span className="block px-3 pb-3 pt-2"><span className="block text-[16px] font-semibold leading-snug">{m.name}</span>
                <span className="block text-[14.5px] tabular-nums" style={{ color: m.soldOut ? AMBER : m.happy ? GREEN : MUTED }}>{m.soldOut ? 'Sold out' : `${m.from ? 'from ' : ''}${usd(m.from ? m.startPrice : m.price)}${m.happy ? ', happy hour' : ''}`}</span></span>
            </button></li>))}</ul>
        </section>
        <aside aria-labelledby="kiosk-order" className="hidden space-y-3 self-start rounded-3xl bg-[#fff] p-5 lg:sticky lg:top-4 lg:block" style={{ border: `1px solid ${LINE}` }}>
          <h2 id="kiosk-order" className="text-[19px] font-semibold">Your order</h2>
          {offerBox}
          {cart.length ? lineRows(false) : <p className="text-[15.5px]" style={{ color: MUTED }}>Tap something to add it.</p>}
          <button type="button" disabled={!cart.length} onClick={() => { setAfter(null); setStep('review'); }} className={`${btn} min-h-[60px] w-full text-[18px] tabular-nums`} style={dark}>Review and pay{count ? `, ${usd(subtotal)}` : ''}</button>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 space-y-3 border-t bg-[#fff] px-6 py-4 lg:hidden" style={{ borderColor: LINE }}>
        {offerBox}
        <div className="flex items-center justify-between gap-4">
          <p className="text-[17px] tabular-nums" aria-live="polite">{count ? `${count} ${count === 1 ? 'item' : 'items'}, ${usd(subtotal)}` : 'Tap something to add it.'}</p>
          <button type="button" disabled={!cart.length} onClick={() => { setAfter(null); setStep('review'); }} className={`${btn} min-h-[60px] text-[18px]`} style={dark}>Review and pay</button>
        </div>
      </div>
      {open && <ItemSheet item={open} onClose={() => { setOpen(null); setOffered(false); }} onAdd={(p, n) => added(open, p, n)} />}
      {stillAsk}
    </main>
  );
}
