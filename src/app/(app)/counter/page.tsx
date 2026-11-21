'use client';
// src/app/(app)/counter/page.tsx — THE COUNTER (design canvas "The counter and the menus"; api/counter with channel
// 'counter'). The drive-thru's ordering screen, brought to the counter: "Next guest" starts an order numbered as a counter
// order ("C14"); the menu takes it in a few taps (choices and combos too, at the happy-hour price while it's on, and only
// what's on at this time of day); a first name goes on it; it's sent to the kitchen and paid, in cash with the change
// worked out or on the card reader. Paid orders wait under "Waiting" until they're ready: "Call" says the name or number
// out loud on this device and marks it called on every counter screen, and "Handed over" takes it off. "For here or to go"
// is asked when what goes out with it differs (a box to go: lib/plate-extras); a staff meal is rung in with no money, for
// the person it's for, and comes off stock at cost (lib/counter-server staffMeal): a manager's to ring in (signed in as
// one, or their PIN typed here), since it writes the order off and can't be undone.
//   Rewards as at the drive-thru (design board "Rewards at the counter"; components/drive-thru/Rewards): their changing
//   rewards code (it can spend) or a phone number (it only earns), a reward used once it's sent and before it's paid, and
//   the reward on the totals. A text when it's ready, if they ask (lib/ready-text). White surfaces are set inline, so the
//   app's black look (lib/app-theme) takes them over.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import { send } from '@/lib/outbox';
import { useKeepPage } from '@/components/pwa/keep-page';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { OfferAsk, type JustAdded } from '@/components/menu/OfferAsk';
import { PinPad } from '@/components/kitchen/PinPad';
import { PointsSheet, RewardsRow, memberFrom, type RewardMember } from '@/components/drive-thru/Rewards';
import { defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { outWords } from '@/lib/menu-stock';
import type { MenuItem } from '@/lib/menu-server';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const GREEN_TINT = '#ecf6f0', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const dark = { background: INK, color: '#fff' } as const;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const rid = () => { try { return crypto.getRandomValues(new Uint32Array(3)).join('').slice(0, 24); } catch { return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`; } };
const READER_KEY = 'cf.counter.reader';
const ON_READER = ['starting', 'on_reader', 'capturing'];

type Item = MenuItem & { off?: string | null; priceNow?: number; happy?: boolean };
type Line = { lineId: string; itemId: string; name: string; quantity: number; unitPrice: number; choicesText: string | null; happy?: boolean; offer?: 'size' | 'item' };
type Order = { id: string; number: string; status: string; guestName?: string | null; lines: Line[]; subtotal: number; tax: number; total: number; paidAt: string | null;
  kitchen: 'not sent' | 'making' | 'ready'; waitingOn: { name: string; quantity: number }[]; ticketCount: number; card?: { state: string; failed: string | null } | null;
  toGo?: boolean; staffMeal?: { for: string } | null;
  /** Rewards on it (lib/counter-points): the phone's last 4 or their code (`verified`: it can spend), what it earned once
   *  paid; a reward used, and the items' own total beside it. */
  points?: { phone: string | null; earned: number; verified?: boolean } | null; reward?: { name: string; cents: number } | null; itemsTotal?: number | null;
  /** The text the guest asked for when it's ready (lib/ready-text): the last four digits, and whether it went. */
  text?: { last4: string; sent: boolean; failed: boolean; sentAt: string | null } | null };
type Guest = { id: string; number: string; stage: 'speaker' | 'pay' | 'pickup' | 'forward'; arrivedAt: string; orderId: string | null; calledAt?: string | null; calls?: number };
type Lane = { cars: Guest[]; orders: Record<string, Order>; menu: Item[]; now: string; daypart: { name: string; until: string } | null; happyHour: { until: string } | null; askToGo?: boolean;
  settings?: { texts?: boolean }; pointsOn?: boolean; rewardsCodes?: boolean };
type Reader = { id: string; label: string; online: boolean; test: boolean };

/** What an item costs right now ("from" its cheapest choices), happy hour included. */
const priceOf = (m: Item) => { const base = m.happy && typeof m.priceNow === 'number' ? m.priceNow : m.price; return Math.max(0, base + (m.from ? m.startPrice - m.price : 0)); };
const fullOf = (m: Item) => (m.from ? m.startPrice : m.price);
const minsAgo = (iso: string | null | undefined, now: number) => { const m = Math.max(0, Math.floor((now - (Date.parse(String(iso || '')) || now)) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };
/** Said out loud: "Dev, order C 12 is ready." (the letter apart from the number, so it's read as one). */
function sayOut(number: string, name: string | null | undefined) {
  try {
    const synth = window.speechSynthesis; if (!synth) return;
    const spoken = String(number).replace(/^([A-Z])(\d+)$/, '$1 $2');
    synth.cancel(); synth.speak(new SpeechSynthesisUtterance(`${name ? `${name}, ` : ''}order ${spoken} is ready.`));
  } catch { /* no voice on this device */ }
}

function ChoiceSheet({ item, onAdd, onClose }: { item: Item; onAdd: (picks: Picks, qty: number) => void; onClose: () => void }) {
  const [picks, setPicks] = useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = useState(1);
  const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input:not([disabled]), button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const priced = priceChoices(item, picks);
  const each = Math.max(0, (item.happy && typeof item.priceNow === 'number' ? item.priceNow : item.price) + (priced.ok ? priced.extra : 0));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="counter-choice" style={{ background: '#fff', color: INK }} className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0"><h2 id="counter-choice" className="text-[21px] font-semibold" style={{ color: INK }}>{item.name}: choose</h2>
            {item.combo && <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Each part goes to its own station.</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE, color: INK }}>×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><ChoicePicker item={item} picks={picks} onChange={setPicks} /></div>
        {!priced.ok && <p role="status" className="px-6 pb-2 text-[14px]" style={{ color: AMBER }}>{priced.error}</p>}
        <div className="flex items-center gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="How many">
            <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`h-12 w-12 rounded-full text-[20px] disabled:opacity-30 ${RING}`}>−</button>
            <span className="w-7 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))} className={`h-12 w-12 rounded-full text-[20px] disabled:opacity-30 ${RING}`}>+</button>
          </div>
          <button type="button" disabled={!priced.ok} onClick={() => onAdd(picks, qty)} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={dark}>Add{qty > 1 ? ` ${qty}` : ''}, {usd(each * qty)}</button>
        </div>
      </div>
    </div>
  );
}

export default function CounterPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [lane, setLane] = useState<Lane | null>(null); const [err, setErr] = useState('');
  const [notice, setNotice] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  // Rewards: the sheet that finds them, and the member on the order shown (with what they can use).
  const [pointsOpen, setPointsOpen] = useState(false); const [member, setMember] = useState<RewardMember | null>(null);
  // Their rewards didn't load: said, with Try again (`memberTry` reads them again).
  const [memberErr, setMemberErr] = useState(false); const [memberTry, setMemberTry] = useState(0);
  const [picked, setPicked] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [section, setSection] = useState(''); const [choiceFor, setChoiceFor] = useState<Item | null>(null);
  // What was just added, for what to offer with it (components/menu/OfferAsk); `choiceOffer`: the choices sheet is open for something offered.
  const [just, setJust] = useState<JustAdded | null>(null); const [choiceOffer, setChoiceOffer] = useState(false);
  const [name, setName] = useState(''); const [cash, setCash] = useState<string | null>(null);
  // A number to text when it's ready, while it's being typed (lib/ready-text).
  const [textTo, setTextTo] = useState('');
  const [readers, setReaders] = useState<Reader[]>([]); const [readerId, setReaderId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [toGo, setToGo] = useState(false); const [staffFor, setStaffFor] = useState<string | null>(null); const [staffPin, setStaffPin] = useState(false);
  const acted = useRef(0); const nameFor = useRef<string | null>(null);
  useKeepPage();

  const post = useCallback(async (body: any) => {
    const r = await send('/api/counter', { tenantId, channel: 'counter', ...body }, { label: 'Counter', auth: 'user', keep: false, tenantId: String(tenantId || '') });
    return r.d && typeof r.d === 'object' ? r.d : { ok: false, error: 'That didn’t go through. Try again.' };
  }, [tenantId]);
  const load = useCallback(async () => {
    if (!tenantId) return; const at = acted.current;
    const d = await post({ action: 'lane' }).catch(() => null); if (!d || at !== acted.current) return;
    if (!d.ok) { setErr(d.error || 'The counter couldn’t be read.'); return; }
    setErr(''); setLane(d); setNow(Date.now());
  }, [tenantId, post]);
  useEffect(() => {
    void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 3000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    try { setReaderId(localStorage.getItem(READER_KEY) || ''); } catch { /* private window */ }
    if (tenantId) void post({ action: 'readers' }).then((d) => { if (d.ok) setReaders((d.readers || []).filter((x: Reader) => x.online || x.test)); }).catch(() => undefined);
  }, [tenantId, post]);

  const guests = lane?.cars || [];
  const ordering = guests.filter((c) => c.stage === 'speaker' || c.stage === 'pay');
  const waiting = guests.filter((c) => c.stage === 'pickup' || c.stage === 'forward');
  const guest = guests.find((c) => c.id === picked && (c.stage === 'speaker' || c.stage === 'pay')) || null;
  const order = guest?.orderId ? lane?.orders[guest.orderId] : undefined;
  const menu = useMemo(() => lane?.menu || [], [lane]);
  const sections = useMemo(() => Array.from(new Set(menu.map((m) => m.section))), [menu]);
  const shown = sections.includes(section) ? section : sections[0] || '';
  const reader = readers.find((x) => x.id === readerId) || (readers.length === 1 ? readers[0] : null);
  const cardOn = !!order?.card && ON_READER.includes(order.card.state);
  // The guest on screen was paid for or dropped: the next one still ordering takes its place.
  useEffect(() => { if (lane && !guest) setPicked(ordering[ordering.length - 1]?.id || null); }, [lane]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCash(null); setStaffFor(null); setToGo(false); setTextTo(''); setJust(null); if (order && nameFor.current !== order.id) { nameFor.current = order.id; setName(order.guestName || ''); } }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label: string, body: any, after?: (d: any) => void, onFail?: (d: any) => boolean) => {
    acted.current++; setBusy(label);
    try {
      const d = await post(body);
      if (d.ok) { if (d.order && lane) setLane((l) => (l ? { ...l, orders: { ...l.orders, [d.order.id]: { ...(l.orders[d.order.id] || {}), ...d.order } } } : l)); after?.(d); }
      else if (!onFail?.(d) && d.error) setNotice({ text: d.error, tone: 'warn' });
    } catch { setNotice({ text: 'No connection. Try again.', tone: 'warn' }); }
    finally { acted.current++; setBusy(null); void load(); }
  };
  const nextGuest = () => act('car', { action: 'car', carKey: rid() }, (d) => { setPicked(d.carId); setName(''); nameFor.current = d.orderId; setNotice(null); });
  // Something added from the menu is what's offered with next; something taken from an offer keeps the offer open.
  const add = (m: Item, picks: Picks = {}, quantity = 1, offer?: 'item') => order && act(`add-${m.id}`, { action: 'add', orderId: order.id, itemId: m.id, choices: picks, quantity, tapKey: rid(), ...(offer ? { offer } : {}) },
    (d) => setJust((j) => (offer ? (j ? { ...j, took: true } : j) : d.line?.lineId ? { orderId: order.id, itemId: m.id, name: m.name, picks, quantity, lineId: d.line.lineId, took: false, sized: false } : null)));
  const tap = (m: Item) => { if (!order) { setNotice({ text: 'Tap Next guest first.', tone: 'warn' }); return; } setChoiceOffer(false); if (m.choices.length) setChoiceFor(m); else add(m); };
  const takeOffer = (m: Item) => { if (m.choices.length) { setChoiceOffer(true); setChoiceFor(m); } else add(m, {}, 1, 'item'); };
  const sizeUp = () => order && just && act('size', { action: 'sizeUp', orderId: order.id, lineId: just.lineId, quantity: just.quantity, tapKey: rid() },
    (d) => setJust((j) => (j ? { ...j, sized: true, took: true, lineId: d.line?.lineId || j.lineId } : j)));
  // Anything else changed on the order closes what was being offered.
  const setQty = (l: Line, q: number) => { if (!order) return; setJust(null); void act(`line-${l.lineId}`, q < 1 ? { action: 'remove', orderId: order.id, lineId: l.lineId, tapKey: rid() } : { action: 'qty', orderId: order.id, lineId: l.lineId, quantity: q, tapKey: rid() }); };
  // Only when the guest asks: one text when it's all ready. Saved once it's ten digits (or on Enter).
  const textDigits = textTo.replace(/\D/g, '').slice(-10);
  const saveText = () => { if (!order || textDigits.length !== 10) return; void act('text', { action: 'readyText', orderId: order.id, phone: textDigits }, (d) => { setTextTo(''); setNotice({ text: d.sent ? `${order.number} is ready, so the text went to ···${d.last4}.` : `${order.number}: we’ll text ···${d.last4} when it’s ready.`, tone: 'good' }); }); };
  const dropText = () => order && act('text', { action: 'readyText', orderId: order.id, phone: null }, () => setNotice({ text: `${order.number}: no text.`, tone: 'good' }));
  // Their code on the order: who they are and the rewards they can use, read again as it's sent and paid.
  const shownId = order?.id || ''; const shownVerified = !!order?.points?.verified; const shownStatus = order?.status || ''; const shownPaid = !!order?.paidAt;
  useEffect(() => {
    if (!shownId || !shownVerified) return;
    let gone = false; setMemberErr(false);
    void post({ action: 'rewards', orderId: shownId }).then((d) => { if (gone) return; if (d?.ok) setMember(memberFrom(shownId, d.member)); else setMemberErr(true); }).catch(() => { if (!gone) setMemberErr(true); });
    return () => { gone = true; };
  }, [shownId, shownVerified, shownStatus, shownPaid, memberTry, post]);
  const applyReward = (rewardId: string | null) => order && act('reward', { action: 'reward', orderId: order.id, rewardId }, (d) => { setMember(memberFrom(order.id, d.member)); setNotice({ text: rewardId ? `Reward used. New total ${usd(Number(d.total) || 0)}.` : `Reward taken off. Total ${usd(Number(d.total) || 0)}.`, tone: 'good' }); });
  const saveName = () => { if (order && name.trim() !== (order.guestName || '')) void post({ action: 'name', orderId: order.id, name: name.trim() }); };
  const sendIt = () => { if (!order) return; setJust(null); void act('send', { action: 'send', orderId: order.id, ...(lane?.askToGo ? { toGo } : {}) }, () => setNotice({ text: `${order.number} is with the kitchen${lane?.askToGo && toGo ? ', to go' : ''}. Take ${usd(order.total)}.`, tone: 'good' })); };
  // A manager's: one signed in here goes straight through; anyone else is asked for a manager's PIN.
  const staffDone = (d: any) => { setStaffFor(null); setStaffPin(false); setNotice({ text: `${order?.number}: a staff meal for ${d.for}${d.approvedBy ? `, rung in by ${d.approvedBy}` : ''}. Nothing to take.`, tone: 'good' }); };
  const staffMeal = () => order && staffFor && staffFor.trim() && act('staff', { action: 'staffMeal', orderId: order.id, for: staffFor.trim() }, staffDone, (d) => { if (!d.needsManager) return false; setStaffPin(true); return true; });
  const staffPinCheck = async (pin: string) => {
    if (!order || !staffFor?.trim()) return { ok: false as const, error: 'Type who it’s for first.' };
    const d = await post({ action: 'staffMeal', orderId: order.id, for: staffFor.trim(), pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    staffDone(d); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: String(d.approvedBy || ''), pass: '' } };
  };
  const paidWords = (d: any, how: string) => (how === 'cash' ? (d.change > 0 ? `Paid in cash. Give ${usd(d.change)} change.` : 'Paid in cash, no change.') : 'Paid by card.');
  const pay = (method: 'cash' | 'card', tendered?: number) => order && act('paid', { action: 'paid', orderId: order.id, method, ...(tendered !== undefined ? { tendered } : {}) }, (d) => setNotice({ text: `${order.number}: ${paidWords(d, d.payMethod || method)}`, tone: 'good' }));
  const toReader = () => order && reader && act('card', { action: 'card', orderId: order.id, readerId: reader.id });
  const stopReader = () => order && act('cardStop', { action: 'cardStop', orderId: order.id }, (d) => setNotice(d.state === 'paid' ? { text: 'The card went through, so it’s paid.', tone: 'good' } : { text: 'Stopped. Take it another way.', tone: 'good' }));
  const cancel = () => { if (!order) return; setJust(null); void act('cancel', { action: 'cancel', orderId: order.id }, () => setNotice({ text: `${order.number} was dropped.`, tone: 'good' })); };
  const call = (g: Guest, o?: Order) => { sayOut(g.number, o?.guestName); void act(`call-${g.id}`, { action: 'call', carId: g.id }); };
  const handOver = (g: Guest) => act(`gone-${g.id}`, { action: 'move', carId: g.id, to: 'gone' }, () => setNotice({ text: `${g.number} was handed over.`, tone: 'good' }));
  useEffect(() => {
    const id = order?.id; if (!cardOn || !id) return;
    let live = true;
    const i = setInterval(async () => { const d = await post({ action: 'cardCheck', orderId: id }).catch(() => null); if (!live || !d?.ok) return; if (d.state === 'paid') setNotice({ text: `${order?.number}: paid by card.`, tone: 'good' }); if (d.state !== 'on_reader') void load(); }, 2000);
    return () => { live = false; clearInterval(i); };
  }, [cardOn, order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tenantId) return null;
  const tendered = Number(cash); const quick = order ? Array.from(new Set([order.total, Math.ceil(order.total / 5) * 5, Math.ceil(order.total / 10) * 10, 20, 50].filter((x) => x >= order.total))).slice(0, 4) : [];
  return (<>
    <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-5 sm:px-6" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-1 text-[24px] font-semibold tracking-tight">Counter</h1>
          {lane?.daypart && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>{lane.daypart.name} until {lane.daypart.until}</span>}
          {lane?.happyHour && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Happy hour until {lane.happyHour.until}</span>}
        </div>
        <button type="button" disabled={busy === 'car'} onClick={nextGuest} className={`${btn} px-5`} style={dark}>Next guest</button>
      </div>
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <p role="status" aria-live="polite" className={notice ? 'rounded-2xl px-4 py-3 text-[14.5px]' : 'sr-only'} style={notice ? (notice.tone === 'good' ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }) : undefined}>{notice?.text || ''}</p>
      {ordering.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Guests ordering">{ordering.map((c) => { const o = c.orderId ? lane?.orders[c.orderId] : undefined; const on = c.id === guest?.id;
        return <button key={c.id} type="button" aria-pressed={on} onClick={() => setPicked(c.id)} className={`${btn} text-[14px]`} style={on ? dark : quiet}>{c.number}{o?.guestName ? `, ${o.guestName}` : ''}{c.stage === 'pay' ? ' (paying)' : ''}</button>; })}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section aria-label="Menu" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          {guest?.stage === 'pay' && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>{guest.number} is with the kitchen. Take payment, or tap Next guest to start another order.</p>}
          {sections.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Menu sections">{sections.map((s) => <button key={s} type="button" role="tab" aria-selected={s === shown} onClick={() => setSection(s)} className={`${btn} shrink-0 text-[14px]`} style={s === shown ? dark : { background: SOFT, color: INK }}>{s}</button>)}</div>}
          {!lane ? <p className="py-10 text-center text-[14px]" style={{ color: MUTED }}>Reading the menu…</p>
            : menu.length === 0 ? <p className="rounded-2xl px-4 py-10 text-center text-[14.5px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>Nothing is on the menu yet. A manager can add items on the Menu page.</p>
            : <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="tabpanel">{menu.filter((m) => m.section === shown).map((m) => {
              const why = m.off || outWords(m); const n = (order?.lines || []).filter((l) => l.itemId === m.id).reduce((s, l) => s + l.quantity, 0);
              return (
                <button key={m.id} type="button" disabled={!!why || busy === `add-${m.id}` || guest?.stage === 'pay'} onClick={() => tap(m)} aria-label={`${m.name}, ${m.from ? 'from ' : ''}${usd(priceOf(m))}${m.happy ? ', happy hour' : ''}${why ? `, ${why}` : ''}${n ? `, ${n} on the order` : ''}`}
                  className={`relative flex min-h-[78px] flex-col justify-between rounded-2xl p-3 text-left disabled:cursor-not-allowed ${RING}`} style={{ background: why ? '#fff' : SOFT, color: INK, border: `${n ? 2 : 1}px solid ${n ? 'currentColor' : why ? LINE : 'transparent'}` }}>
                  <span className="pr-7 text-[15px] font-semibold leading-snug" style={{ color: why ? MUTED : INK }}>{m.name}</span>
                  <span className="mt-1.5 text-[13px] tabular-nums" style={{ color: why ? AMBER : MUTED }}>
                    {why ? why : <>{m.from ? 'from ' : ''}{m.happy ? <><s>{usd(fullOf(m))}</s> {usd(priceOf(m))} now</> : usd(priceOf(m))}{m.combo ? ', a combo' : m.choices.length ? ', choices' : ''}</>}
                  </span>
                  {n > 0 && <span className="absolute right-2 top-2 flex h-7 min-w-[28px] items-center justify-center rounded-full px-1.5 text-[13.5px] font-semibold tabular-nums" style={dark}>{n}</span>}
                </button>
              ); })}</div>}
        </section>

        <section aria-label="The order" className="flex flex-col gap-3 rounded-3xl p-4 lg:sticky lg:top-4 lg:self-start" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          {!order ? <div className="space-y-3 py-6 text-center"><p className="text-[15px] font-semibold">No guest ordering</p><p className="text-[14px]" style={{ color: MUTED }}>Tap Next guest to start an order. It gets a counter number, like C14, for calling it out.</p></div> : <>
            <div className="flex items-center justify-between gap-2"><h2 className="text-[19px] font-semibold">{order.number}{order.guestName ? `, ${order.guestName}` : ''}{order.status !== 'building' && order.toGo ? <span className="ml-2 text-[14px] font-medium" style={{ color: MUTED }}>To go</span> : null}</h2>
              {order.status === 'building' && <button type="button" onClick={cancel} disabled={!!busy} className={`${btn} px-3 text-[13.5px]`} style={{ color: MUTED }}>Drop it</button>}</div>
            <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>First name, for calling it out
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Optional" autoComplete="off" className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[15px] font-normal outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
            {lane?.settings?.texts && (order.text
              ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[14px]" style={{ background: SOFT }} role="status">
                  <span style={order.text.failed ? { color: AMBER } : undefined}>{!order.text.sent ? `Texts ···${order.text.last4} when it’s ready.` : order.text.failed ? `The text to ···${order.text.last4} may not have gone. Call it out.` : `Texted ···${order.text.last4} that it’s ready.`}</span>
                  {!order.text.sent && <button type="button" onClick={dropText} disabled={!!busy} className={btn} style={{ color: MUTED }}>Don’t text</button>}</div>
              : <div><label htmlFor="counter-text-to" className="block text-[13px] font-semibold" style={{ color: MUTED }}>Text them when it’s ready, if they ask</label>
                  <div className="mt-1 flex gap-2">
                    <input id="counter-text-to" value={textTo} onChange={(e) => setTextTo(e.target.value.replace(/[^\d()\-+ .]/g, '').slice(0, 18))} onKeyDown={(e) => { if (e.key === 'Enter') saveText(); }} inputMode="tel" autoComplete="off" placeholder="Their mobile number" className="block min-h-[44px] min-w-0 flex-1 rounded-xl border px-3 text-[15px] font-normal tabular-nums outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} />
                    <button type="button" onClick={saveText} disabled={textDigits.length !== 10 || !!busy} className={btn} style={dark}>Save</button></div></div>)}
            {order.lines.length === 0 ? <p className="rounded-2xl px-3 py-5 text-center text-[14px]" style={{ background: SOFT, color: MUTED }}>Tap the menu to add to the order.</p>
              : <ul className="space-y-2">{order.lines.map((l) => (
                <li key={l.lineId} className="flex items-center justify-between gap-2 text-[14px]">
                  <span className="min-w-0"><span className="block font-semibold">{l.name}{l.happy ? ' (happy hour)' : ''}{l.offer === 'size' && order.status === 'building' ? <span className="ml-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Sized up</span> : null}</span>{l.choicesText && <span className="block truncate text-[13px]" style={{ color: MUTED }}>{l.choicesText}</span>}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {order.status === 'building' && <button type="button" aria-label={`One fewer ${l.name}`} onClick={() => setQty(l, l.quantity - 1)} disabled={!!busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>−</button>}
                    <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                    {order.status === 'building' && <button type="button" aria-label={`One more ${l.name}`} onClick={() => setQty(l, l.quantity + 1)} disabled={!!busy || l.quantity >= 20} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>+</button>}
                    <span className="w-16 text-right tabular-nums">{usd(l.unitPrice * l.quantity)}</span>
                  </span>
                </li>))}</ul>}
            {order.status === 'building' && <OfferAsk just={just} orderId={order.id} item={menu.find((m) => m.id === just?.itemId)} find={(id) => menu.find((m) => m.id === id && !m.off && !outWords(m))}
              have={(id) => order.lines.some((l) => l.itemId === id)} price={priceOf} busy={!!busy} onSizeUp={sizeUp} onAdd={takeOffer} onClose={() => setJust(null)} />}
            {lane?.pointsOn && !order.staffMeal && <div className="border-t pt-2" style={{ borderColor: LINE }}>
              <RewardsRow order={order} member={member} codes={!!lane.rewardsCodes} busy={!!busy} onAdd={() => setPointsOpen(true)} onUse={(id) => void applyReward(id)} />
              {memberErr && order.points?.verified && member?.orderId !== order.id && <p className="flex flex-wrap items-center gap-2 text-[13.5px]" style={{ color: 'var(--warn-ink)' }} role="status">Their rewards didn’t load.
                <button type="button" onClick={() => setMemberTry((n) => n + 1)} className={`min-h-[44px] rounded-lg px-1 font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>Try again</button></p>}</div>}
            <div className="space-y-1 border-t pt-3 text-[14px]" style={{ borderColor: LINE }}>
              {order.reward && <>
                <div className="flex justify-between" style={{ color: MUTED }}><span>Subtotal</span><span className="tabular-nums">{usd(order.itemsTotal || 0)}</span></div>
                <div className="flex justify-between gap-3" style={{ color: GREEN }}><span className="min-w-0 truncate">Reward: {order.reward.name}</span><span className="shrink-0 tabular-nums">-{usd(order.reward.cents / 100)}</span></div></>}
              <div className="flex justify-between" style={{ color: MUTED }}><span>Tax</span><span className="tabular-nums">{usd(order.tax)}</span></div>
              <div className="flex justify-between text-[16px] font-semibold"><span>Total</span><span className="tabular-nums">{usd(order.total)}</span></div>
            </div>
            {order.status === 'building' ? <>
              {lane?.askToGo && <div role="radiogroup" aria-label="For here or to go" className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: SOFT }}>
                {[{ v: false, label: 'For here' }, { v: true, label: 'To go' }].map((x) => <button key={x.label} type="button" role="radio" aria-checked={toGo === x.v} onClick={() => setToGo(x.v)} className={`min-h-[44px] rounded-lg text-[14.5px] font-semibold ${RING}`} style={toGo === x.v ? { background: '#fff', color: INK, boxShadow: '0 1px 2px rgba(22,23,26,0.08)' } : { color: MUTED }}>{x.label}</button>)}
              </div>}
              <button type="button" disabled={!order.lines.length || !!busy} onClick={() => { saveName(); void sendIt(); }} className={`${btn} min-h-[52px] text-[16px]`} style={dark}>Send and take payment</button></>
              : cardOn ? <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}><p className="text-[14.5px] font-semibold">On the card reader: {usd(order.total)}</p><p className="text-[13px]" style={{ color: MUTED }}>The guest taps, inserts or swipes there.</p><button type="button" onClick={stopReader} disabled={!!busy} className={`${btn} w-full`} style={quiet}>Stop</button></div>
              : staffFor !== null ? <div className="space-y-2">
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Who it’s for
                  <input autoFocus value={staffFor} onChange={(e) => setStaffFor(e.target.value.slice(0, 24))} onKeyDown={(e) => { if (e.key === 'Enter') void staffMeal(); }} placeholder="First name" autoComplete="off" className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
                <p className="text-[13px]" style={{ color: MUTED }}>No money is taken, and it can’t be undone. It comes off stock as usual and shows on Food cost as a staff meal, at what it cost to make. A manager rings it in.</p>
                <div className="flex gap-2"><button type="button" onClick={() => setStaffFor(null)} className={`${btn} flex-1`} style={quiet}>Back</button>
                  <button type="button" disabled={!!busy || !staffFor.trim()} onClick={() => void staffMeal()} className={`${btn} flex-[2]`} style={dark}>Ring in as a staff meal</button></div>
              </div>
              : cash !== null ? <div className="space-y-2">
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Cash handed over
                  <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} placeholder={order.total.toFixed(2)} className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal tabular-nums outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
                <div className="flex flex-wrap gap-2">{quick.map((q) => <button key={q} type="button" onClick={() => setCash(q.toFixed(2))} className={`${btn} px-3 text-[14px]`} style={{ background: SOFT, color: INK }}>{q === order.total ? 'Exact' : usd(q)}</button>)}</div>
                {cash !== '' && Number.isFinite(tendered) && tendered >= order.total && <p className="text-[15px] font-semibold" style={{ color: GREEN }}>Change: {usd(tendered - order.total)}</p>}
                <div className="flex gap-2"><button type="button" onClick={() => setCash(null)} className={`${btn} flex-1`} style={quiet}>Back</button>
                  <button type="button" disabled={!!busy || (cash !== '' && !(tendered >= order.total))} onClick={() => pay('cash', cash === '' ? order.total : tendered)} className={`${btn} flex-[2]`} style={dark}>Take cash</button></div>
              </div>
              : <div className="space-y-2">
                {order.card?.failed && <p className="text-[13.5px]" style={{ color: AMBER }}>{order.card.failed}</p>}
                <button type="button" onClick={() => setCash('')} disabled={!!busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={dark}>Cash</button>
                {readers.length > 1 && <select aria-label="Card reader" value={reader?.id || ''} onChange={(e) => { setReaderId(e.target.value); try { localStorage.setItem(READER_KEY, e.target.value); } catch { /* private window */ } }} className={`min-h-[44px] w-full rounded-xl border px-3 text-[14.5px] ${RING}`} style={{ background: '#fff', borderColor: LINE, color: INK }}><option value="">Pick a card reader</option>{readers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>}
                {readers.length > 0 && <button type="button" onClick={toReader} disabled={!reader || !!busy} className={`${btn} w-full`} style={quiet}>Card reader{reader && readers.length > 1 ? `: ${reader.label}` : ''}</button>}
                <button type="button" onClick={() => pay('card')} disabled={!!busy} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Paid on another card machine</button>
                <button type="button" onClick={() => setStaffFor('')} disabled={!!busy} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Staff meal</button>
              </div>}
          </>}
        </section>
      </div>

      <section aria-labelledby="counter-waiting" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="counter-waiting" className="text-[17px] font-semibold">Waiting</h2>
          {tenantId && <span className="flex flex-wrap gap-x-4">
            <a href={`/drive-thru/${tenantId}/ready`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4" style={{ color: INK }}>Open the ready board</a>
            <a href={`/drive-thru/${tenantId}/kiosk`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4" style={{ color: INK }}>Open a kiosk</a>
          </span>}
        </div>
        {waiting.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Paid orders wait here until they’re handed over, kiosk orders too.</p>
          : <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">{waiting.map((g) => {
            const o = g.orderId ? lane?.orders[g.orderId] : undefined; const ready = !!o && (o.kitchen === 'ready' || (o.ticketCount === 0 && o.status !== 'building'));
            return (
              <li key={g.id} className="flex flex-col gap-2 rounded-2xl p-3" style={{ background: ready && !g.calledAt ? GREEN_TINT : SOFT }}>
                <div><p className="text-[19px] font-semibold">{g.number}{o?.guestName ? ` ${o.guestName}` : ''}{o?.staffMeal || o?.toGo ? <span className="ml-2 text-[13.5px] font-medium" style={{ color: MUTED }}>{o.staffMeal ? 'Staff meal' : 'To go'}</span> : null}</p>
                  <p className="text-[13px]" style={{ color: ready && !g.calledAt ? GREEN : MUTED }}>{g.calledAt ? `Called ${minsAgo(g.calledAt, now)}` : ready ? 'Ready' : `Making: ${(o?.waitingOn || []).map((w) => (w.quantity > 1 ? `${w.quantity} ${w.name}` : w.name)).join(', ') || 'with the kitchen'}`}</p>
                  {o?.text && <p className="text-[13px]" style={{ color: o.text.failed ? AMBER : MUTED }}>{!o.text.sent ? `Gets a text when it’s ready (···${o.text.last4})` : o.text.failed ? 'The text may not have gone' : `Texted${o.text.sentAt ? ` ${minsAgo(o.text.sentAt, now)}` : ''}`}</p>}</div>
                {ready && (g.calledAt
                  ? <div className="flex gap-2"><button type="button" onClick={() => handOver(g)} disabled={busy === `gone-${g.id}`} className={`${btn} flex-1 px-3`} style={dark}>Handed over</button><button type="button" onClick={() => call(g, o)} className={`${btn} px-3`} style={quiet}>Call again</button></div>
                  : <button type="button" onClick={() => call(g, o)} disabled={busy === `call-${g.id}`} className={`${btn} w-full`} style={dark}>Call {o?.guestName || g.number}</button>)}
              </li>
            ); })}</ul>}
      </section>
    </main>
    {staffPin && staffFor !== null && <PinPad check={staffPinCheck} onDone={() => setStaffPin(false)} onClose={() => setStaffPin(false)} title="A manager’s PIN" line={`It rings in the staff meal for ${staffFor.trim() || 'them'}. It doesn’t change who’s signed in here.`} />}
    {pointsOpen && order && <PointsSheet name={order.guestName || ''} busy={busy === 'points' || busy === 'rewardsCode'} codes={!!lane?.rewardsCodes} onClose={() => setPointsOpen(false)}
      onCode={(code) => new Promise<string | null>((res) => { void act('rewardsCode', { action: 'rewardsCode', orderId: order.id, code }, (d) => {
        setPointsOpen(false); setMember(memberFrom(order.id, d.member)); setNotice({ text: d.earned ? `Rewards added for ${d.member?.name || 'them'}: earned ${d.earned}.` : `Rewards added for ${d.member?.name || 'them'}.`, tone: 'good' }); res(null);
      }, (d) => { res(d.error || 'That didn’t go through.'); return true; }); })}
      onLink={(phone, join, name) => new Promise<string | null>((res) => { void act('points', { action: 'points', orderId: order.id, phone, join, name }, (d) => {
        setPointsOpen(false); setNotice({ text: d.already ? 'Rewards were already on this order.' : d.earned ? `Rewards added: earned ${d.earned} ${d.unit}.` : 'Rewards added. It earns when it’s paid.', tone: 'good' }); res(null);
      }, (d) => { res(d.code === 'not_found' || d.code === 'not_member' ? d.code : d.error || 'That didn’t go through.'); return true; }); })} />}
    {choiceFor && <ChoiceSheet item={choiceFor} onClose={() => setChoiceFor(null)} onAdd={(p, q) => { add(choiceFor, p, q, choiceOffer ? 'item' : undefined); setChoiceFor(null); }} />}
  </>);
}
