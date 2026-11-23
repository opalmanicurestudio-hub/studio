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
import { PinPad, pinTitle } from '@/components/kitchen/PinPad';
import { AppSoldOut, type AppSoldOutRow } from '@/components/drive-thru/AppSoldOut';
import { ComingUp, type ComingUpRow } from '@/components/drive-thru/ComingUp';
import { PointsSheet, RewardsRow, memberFrom, type RewardMember } from '@/components/drive-thru/Rewards';
import { Deliveries, type DeliveryRow, type FoodDriver, type DriverNow, type Slow } from '@/components/drive-thru/Deliveries';
import { defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { outWords } from '@/lib/menu-stock';
import { courierLate } from '@/lib/app-orders';
import { allergyWords, conflictWords, dishConflict } from '@/lib/order-allergy';
import type { AllergenKey } from '@/lib/allergens';
import { AllergySheet, LineNote, NoteField, allergyBody, allergyFrom, type AllergyValue } from '@/components/menu/OrderAllergy';
import type { MenuItem } from '@/lib/menu-server';
import { ReceiptAsk, type ReceiptSetup } from '@/components/pos/ReceiptAsk';
import { TipAsk, DiscountPick, GiftAsk, SplitAsk, type CustomDiscount, type PartHow } from '@/components/pos/CounterMoney';
import { tipBaseOf, giftCentsOf, type Discount } from '@/lib/counter-money';
import { RefundFind } from '@/components/pos/CounterRefund';
import { CodeOnSheet } from '@/components/pos/CounterScan';
import { OneOffSheet } from '@/components/pos/CounterOneOff';
import { GiftSheet, GiftsMade, GiftsOpen, giftsPaidWords, giftsFailed, type GiftBody, type GiftMade } from '@/components/pos/CounterGift';
import { giftWords } from '@/lib/counter-gift';
import { TakeOffSheet } from '@/components/pos/CounterTakeOff';
import { CompSheet } from '@/components/pos/CounterComp';
import { PriceSheet, PriceMenu } from '@/components/pos/CounterPrice';
import { WeightSheet, pickedOf } from '@/components/pos/CounterWeight';
import { scanAddedWords } from '@/lib/scale-label';
import { priceWords } from '@/lib/counter-price';
import { DrawerSheet } from '@/components/pos/DrawerMove';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { compWords } from '@/lib/counter-comp';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { RegisterTiles } from '@/components/pos/RegisterTiles';
import { BagLabelsSheet, BagScanSheet, printLabelsHere, scanReplyOf, type BagWait } from '@/components/drive-thru/BagSheets';
import { priceOf, type TileSetup } from '@/lib/register-tiles';

/** A delivery app's order, sent (lib/app-orders): which app, the code it shows, and when its courier gets here. */
function AppSend({ apps, busy, empty, onSend }: { apps: { code: string; label: string }[]; busy: boolean; empty: boolean; onSend: (v: { app: string; code: string; courierIn: number }) => void }) {
  const [app, setApp] = useState(apps.length === 1 ? apps[0].code : ''); const [code, setCode] = useState(''); const [inMin, setInMin] = useState<number | null>(null);
  const clean = code.replace(/\s+/g, '').replace(/^#/, '').toUpperCase(); const okCode = /^[A-Z0-9-]{2,12}$/.test(clean);
  const seg = (on: boolean) => (on ? dark : quiet);
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-labelledby="app-which"><p id="app-which" className="text-[13.5px] font-semibold">Which app</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{apps.map((a) => <button key={a.code} type="button" role="radio" aria-checked={app === a.code} onClick={() => setApp(a.code)} className={`${btn} flex-1 whitespace-nowrap px-3`} style={seg(app === a.code)}>{a.label}</button>)}</div></div>
      <label className="block text-[13.5px] font-semibold">Order code on the app
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 14))} placeholder="Like 4F2A" autoComplete="off" autoCapitalize="characters" className={`mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal ${RING}`} style={{ borderColor: LINE }} /></label>
      <div role="radiogroup" aria-labelledby="app-courier"><p id="app-courier" className="text-[13.5px] font-semibold">Courier gets here</p>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">{[0, 10, 20, 30].map((m) => <button key={m} type="button" role="radio" aria-checked={inMin === m} onClick={() => setInMin(m)} className={`${btn} whitespace-nowrap px-1 text-[14px]`} style={seg(inMin === m)}>{m ? `${m} min` : 'Now'}</button>)}</div></div>
      <button type="button" disabled={busy || empty || !app || !okCode || inMin === null} onClick={() => onSend({ app, code: clean, courierIn: inMin as number })} className={`${btn} min-h-[52px] w-full text-[15.5px]`} style={dark}>Send to the kitchen, paid on the app</button>
      <p className="text-[13px]" style={{ color: MUTED }}>{empty ? 'Add what they ordered from the menu first.' : !app ? 'Pick the app it came from.' : !okCode ? 'Type the order code the app shows.' : inMin === null ? 'Pick when the courier gets here.' : 'It goes in the books when the courier picks it up.'}</p>
    </div>);
}
/** The code (or app) typed wrong on a sent app order, fixed: the right app and its code (lib/app-orders-server appCode). */
function AppFix({ id, apps, start, busy, onSave, onKeep }: { id: string; apps: { code: string; label: string }[]; start: { app: string; code: string }; busy: boolean; onSave: (v: { app: string; code: string }) => void; onKeep: () => void }) {
  const [app, setApp] = useState(start.app); const [code, setCode] = useState(start.code);
  const clean = code.replace(/\s+/g, '').replace(/^#/, '').toUpperCase(); const okCode = /^[A-Z0-9-]{2,12}$/.test(clean);
  const same = clean === start.code && app === start.app;
  return (
    <div className="space-y-2 rounded-xl p-2.5" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div role="radiogroup" aria-labelledby={`app-fix-${id}`}><p id={`app-fix-${id}`} className="text-[13.5px] font-semibold">Which app</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{apps.map((a) => <button key={a.code} type="button" role="radio" aria-checked={app === a.code} onClick={() => setApp(a.code)} className={`${btn} flex-1 whitespace-nowrap px-3 text-[14px]`} style={app === a.code ? dark : quiet}>{a.label}</button>)}</div></div>
      <label className="block text-[13.5px] font-semibold">Order code on the app
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 14))} autoComplete="off" autoCapitalize="characters" className={`mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal ${RING}`} style={{ borderColor: LINE }} /></label>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !app || !okCode || same} onClick={() => onSave({ app, code: clean })} className={`${btn} flex-1 px-3 text-[14px]`} style={dark}>Save the code</button>
        <button type="button" onClick={onKeep} className={`${btn} px-3 text-[14px]`} style={quiet}>Keep it</button>
      </div>
    </div>);
}
const clockOf = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

/** The location picked in the app (lib/here-server), with more than one. */
const hereAsked = () => { try { const v = localStorage.getItem('selectedLocationId'); return v ? { locationId: v } : {}; } catch { return {}; } };
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
type Line = { lineId: string; itemId: string; name: string; quantity: number; unitPrice: number; choicesText: string | null; happy?: boolean; offer?: 'size' | 'item'; note?: string | null };
type Order = { id: string; number: string; status: string; guestName?: string | null; lines: Line[]; subtotal: number; tax: number; total: number; paidAt: string | null;
  kitchen: 'not sent' | 'making' | 'ready'; waitingOn: { name: string; quantity: number }[]; ticketCount: number; card?: { state: string; failed: string | null; cents?: number | null } | null;
  toGo?: boolean; staffMeal?: { for: string } | null;
  /** Its tip (in its total) and discount (lib/counter-money). */
  tipCents?: number; keptChange?: boolean; markdown?: { id: string; label: string; words: string; cents: number; okBy: string | null; reason?: string | null } | null;
  /** Gift cards and store credit set aside on it, and what's left for cash or card (lib/counter-money). */
  tenders?: { kind: 'gift' | 'credit' | 'cash' | 'card'; giftCardId?: string; code?: string; cents: number; partId?: string; machine?: boolean; part?: boolean }[]; due?: number;
  /** A split bill (lib/counter-split-server): how many ways, and how many have paid their share. */
  split?: { ways: number; shares: number } | null;
  /** Rewards on it (lib/counter-points): the phone's last 4 or their code (`verified`: it can spend), what it earned once
   *  paid; a reward used, and the items' own total beside it. */
  points?: { phone: string | null; earned: number; verified?: boolean } | null; reward?: { name: string; cents: number } | null; itemsTotal?: number | null;
  /** The text the guest asked for when it's ready (lib/ready-text): the last four digits, and whether it went. */
  text?: { last4: string; sent: boolean; failed: boolean; sentAt: string | null } | null;
  /** A delivery app's order (lib/app-orders): which app, its code, its spot on the pickup shelf, when the courier is due. */
  app?: { state: string; app?: string | null; label: string | null; code: string | null; shelf: string | null; courierAt: string | null;
    /** What it comes to with the app (lib/app-orders): its price, and the sales tax the business pays when the app doesn't. */
    money?: { markupPct: number; appCents: number; taxCents: number; appPaysTax: boolean } } | null;
  /** The guest's allergies (lib/order-allergy): on every kitchen ticket. */
  allergy?: { keys: AllergenKey[]; other: string | null; severe: boolean } | null;
  /** Its bag labels once printed (lib/food-bags): how many, which are still to scan; and how many bags to start with. */
  bags?: { of: number; left: number[] } | null; bagsStart?: number };
type Guest = { id: string; number: string; stage: 'speaker' | 'pay' | 'pickup' | 'forward'; arrivedAt: string; orderId: string | null; calledAt?: string | null; calls?: number };
type Lane = { cars: Guest[]; orders: Record<string, Order>; menu: Item[]; now: string; daypart: { name: string; until: string } | null; happyHour: { until: string } | null; askToGo?: boolean;
  /** Something not on the menu (lib/counter-oneoff): up to how much, 0 when it isn't offered. */
  oneOffMax?: number;
  /** Gift cards sold with an order (lib/counter-gift): the business's own amounts. */
  gift?: { amounts: number[]; open?: { orderId: string; number: string }[] };
  /** The location this counter is at, with more than one (lib/here-server). */
  location?: { id: string; name: string | null } | null;
  settings?: { texts?: boolean; labelPrinter?: string | null }; pointsOn?: boolean; rewardsCodes?: boolean;
  /** Receipts after a sale (components/pos/ReceiptAsk): the business's setting and its receipt printers. */
  receipt?: ReceiptSetup;
  /** Tips (when this screen asks for them) and the business's discounts (lib/counter-money). */
  money?: { tips: { pcts: number[] } | null; discounts: Discount[] };
  /** Today's hot food deliveries by the business's own drivers (lib/food-delivery-server), when delivery is on. */
  deliveries?: DeliveryRow[]; drivers?: FoodDriver[]; driverNow?: DriverNow | null; slow?: Slow | null;
  /** Sold out here, to mark on each delivery app, or back on there (lib/app-orders appSoldOutTodo). */
  appSoldOut?: AppSoldOutRow[]; appSoldOutTaps?: number;
  /** Orders for another day still waiting for their day (lib/ahead-days-server). */
  comingUp?: ComingUpRow[];
  /** The delivery apps it takes orders from (lib/app-orders), for App order. */
  apps?: { code: string; label: string }[];
  /** What sells at this hour, most sold first (lib/register-tiles-server): the tiles' first tab. */
  most?: string[] | null;
  /** How the business arranges the tiles (lib/register-tiles TileSetup). */
  tiles?: TileSetup | null };
type Reader = { id: string; label: string; online: boolean; test: boolean };

/** What an item costs right now ("from" its cheapest choices), happy hour included. */
const minsAgo = (iso: string | null | undefined, now: number) => { const m = Math.max(0, Math.floor((now - (Date.parse(String(iso || '')) || now)) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };
/** Said out loud: "Dev, order C 12 is ready." (the letter apart from the number, so it's read as one). */
function sayOut(number: string, name: string | null | undefined) {
  try {
    const synth = window.speechSynthesis; if (!synth) return;
    const spoken = String(number).replace(/^([A-Z])(\d+)$/, '$1 $2');
    synth.cancel(); synth.speak(new SpeechSynthesisUtterance(`${name ? `${name}, ` : ''}order ${spoken} is ready.`));
  } catch { /* no voice on this device */ }
}

// Its choices, and a note for the kitchen (pressed and held on the tiles, it opens for any item).
function ChoiceSheet({ item, onAdd, onClose }: { item: Item; onAdd: (picks: Picks, qty: number, note: string) => void; onClose: () => void }) {
  const [picks, setPicks] = useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = useState(1); const [note, setNote] = useState('');
  const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  // (A tap on the backdrop right as it opens is the press that opened it, not a close.)
  const openedAt = useRef(Date.now());
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input:not([disabled]), button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const priced = priceChoices(item, picks);
  const each = Math.max(0, (item.happy && typeof item.priceNow === 'number' ? item.priceNow : item.price) + (priced.ok ? priced.extra : 0));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget && Date.now() - openedAt.current > 400) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="counter-choice" style={{ background: '#fff', color: INK }} className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0"><h2 id="counter-choice" className="text-[21px] font-semibold" style={{ color: INK }}>{item.choices.length ? `${item.name}: choose` : item.name}</h2>
            {item.combo && <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Each part goes to its own station.</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE, color: INK }}>×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">{item.choices.length > 0 && <ChoicePicker item={item} picks={picks} onChange={setPicks} />}<NoteField id="counter-choice-note" value={note} onChange={setNote} /></div>
        {!priced.ok && <p role="status" className="px-6 pb-2 text-[14px]" style={{ color: AMBER }}>{priced.error}</p>}
        <div className="flex items-center gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          {!item.byWeight && <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="How many">
            <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`h-12 w-12 rounded-full text-[20px] disabled:opacity-30 ${RING}`}>−</button>
            <span className="w-7 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))} className={`h-12 w-12 rounded-full text-[20px] disabled:opacity-30 ${RING}`}>+</button>
          </div>}
          <button type="button" disabled={!priced.ok} onClick={() => onAdd(picks, item.byWeight ? 1 : qty, note)} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={dark}>{item.byWeight ? `Next, weigh it (${usd(each)}/${item.byWeight})` : `Add${qty > 1 ? ` ${qty}` : ''}, ${usd(each * qty)}`}</button>
        </div>
      </div>
    </div>
  );
}

export default function CounterPage() {
  const { selectedTenant, role } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  // A manager can arrange the tiles right here (components/pos/RegisterTiles, design board "Arrange tiles", B); what they
  // set shows at once, until the next read of the lane carries it.
  const canArrange = role === 'owner' || role === 'admin' || role === 'manager';
  const [tilesNow, setTilesNow] = useState<{ v: TileSetup; at: number } | null>(null);
  const [lane, setLane] = useState<Lane | null>(null); const [err, setErr] = useState('');
  const [notice, setNotice] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  // Rewards: the sheet that finds them, and the member on the order shown (with what they can use).
  const [pointsOpen, setPointsOpen] = useState(false); const [member, setMember] = useState<RewardMember | null>(null);
  // Their rewards didn't load: said, with Try again (`memberTry` reads them again).
  const [memberErr, setMemberErr] = useState(false); const [memberTry, setMemberTry] = useState(0);
  const [picked, setPicked] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  // The menu's tab (null: the first, Most sold now), back to the first for each new order.
  const [section, setSection] = useState<string | null>(null); const [choiceFor, setChoiceFor] = useState<Item | null>(null);
  // What was just added, for what to offer with it (components/menu/OfferAsk); `choiceOffer`: the choices sheet is open for something offered.
  const [just, setJust] = useState<JustAdded | null>(null); const [choiceOffer, setChoiceOffer] = useState(false);
  const [name, setName] = useState(''); const [cash, setCash] = useState<string | null>(null);
  // A number to text when it's ready, while it's being typed (lib/ready-text).
  const [textTo, setTextTo] = useState('');
  const [readers, setReaders] = useState<Reader[]>([]); const [readerId, setReaderId] = useState('');
  // The receipt for the sale just paid (or one asked for again from Waiting: `later`), until it's done.
  // A tip or a discount being picked for the order being paid; another amount off waiting on a manager's PIN.
  const [moneyOpen, setMoneyOpen] = useState<'tip' | 'discount' | 'gift' | null>(null); const [discountPin, setDiscountPin] = useState<CustomDiscount | null>(null);
  // A split bill's part being paid in cash, or by gift card (cents); a part being given back, waiting on a manager's PIN.
  // Refunding a paid order (components/pos/CounterRefund): today's paid orders, then the one picked.
  const [refundOpen, setRefundOpen] = useState(false);
  // A barcode scanned that's on nothing yet (components/pos/CounterScan): which item it is.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  // Whether the PIN asked for is the owner's (their rules say only they will do, lib/money-rules) or a manager's.
  const [pinOwner, setPinOwner] = useState(false); const [codeScale, setCodeScale] = useState<string | null>(null);
  // Something not on the menu (components/pos/CounterOneOff).
  const [oneOffOpen, setOneOffOpen] = useState(false);
  // A gift card sold with the order (components/pos/CounterGift), and the ones made once it's paid.
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftsMade, setGiftsMade] = useState<{ orderId: string; number: string; gifts: GiftMade[] } | null>(null);
  // Something taken off an order the kitchen has, before it's paid (components/pos/CounterTakeOff).
  const [takeOffFor, setTakeOffFor] = useState<string | null>(null);
  // One item on the house (components/pos/CounterComp).
  const [compFor, setCompFor] = useState<string | null>(null);
  // A line at a different price (components/pos/CounterPrice).
  const [priceFor, setPriceFor] = useState<string | null>(null);
  // An item sold by weight being weighed, with its choices picked (components/pos/CounterWeight).
  const [weighFor, setWeighFor] = useState<{ m: Item; picks: Picks; note?: string } | null>(null);
  // Cash in and out of the drawer (components/pos/DrawerMove).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [partC, setPartC] = useState<number | null>(null); const [giftUpTo, setGiftUpTo] = useState<number | null>(null); const [partPin, setPartPin] = useState<{ partId: string; cents: number; kind: string } | null>(null);
  const [slip, setSlip] = useState<{ orderId: string; title: string; cash: boolean; change: number | null; later?: boolean; auto?: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toGo, setToGo] = useState(false); const [staffFor, setStaffFor] = useState<string | null>(null); const [staffPin, setStaffPin] = useState(false);
  const [deliveryPin, setDeliveryPin] = useState<{ body: any; line: string; done: (d: any) => void } | null>(null);
  // Bag labels (lib/food-bags; components/drive-thru/BagSheets): a handover waiting on its bags to be scanned, and the
  // labels being printed for an order.
  const [bagHold, setBagHold] = useState<{ carId: string; label: string; waiting: BagWait[] } | null>(null);
  const [labelsFor, setLabelsFor] = useState<{ carId: string; orderId: string; number: string; start: number } | null>(null);
  const [appOff, setAppOff] = useState<string | null>(null); const [appPin, setAppPin] = useState<Order | null>(null); const [appFix, setAppFix] = useState<string | null>(null); const [allergyOpen, setAllergyOpen] = useState(false); const [allergyHold, setAllergyHold] = useState<{ carId: string; label: string } | null>(null);
  const acted = useRef(0); const nameFor = useRef<string | null>(null);
  useKeepPage();

  // With more than one location, the one picked in the app's location switcher (lib/here-server): this counter's
  // orders, cars and deliveries. (Read on every call, so switching shows the other location on the next refresh.)
  const post = useCallback(async (body: any) => {
    const r = await send('/api/counter', { tenantId, channel: 'counter', ...hereAsked(), ...body }, { label: 'Counter', auth: 'user', keep: false, tenantId: String(tenantId || '') });
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
  // What's on the order, item by item: the count on each tile.
  const onOrder = useMemo(() => { const n: Record<string, number> = {}; for (const l of order?.lines || []) n[l.itemId] = (n[l.itemId] || 0) + l.quantity; return n; }, [order?.lines]);
  const reader = readers.find((x) => x.id === readerId) || (readers.length === 1 ? readers[0] : null);
  const cardOn = !!order?.card && ON_READER.includes(order.card.state);
  // (With the kitchen and not paid yet, nothing set aside on it, more than one line: one can come off.)
  // (Being taken, or with the kitchen and not paid, nothing set aside on it: an item can go on the house.)
  const canComp = !!order && (order.status === 'building' || order.status === 'sent') && !order.paidAt && !order.staffMeal && !order.app && !(order.tenders || []).length && !order.split && !cardOn;
  const canTakeOff = !!order && order.status === 'sent' && !order.paidAt && !order.staffMeal && !order.app && !(order.tenders || []).length && !order.split && !cardOn && (order.lines.length > 1 || (order.lines[0]?.quantity || 0) > 1);
  // The guest on screen was paid for or dropped: the next one still ordering takes its place.
  useEffect(() => { if (lane && !guest) setPicked(ordering[ordering.length - 1]?.id || null); }, [lane]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSection(null); setCash(null); setStaffFor(null); setToGo(false); setTextTo(''); setMoneyOpen(null); setPartC(null); setGiftUpTo(null); setJust(null); if (order && nameFor.current !== order.id) { nameFor.current = order.id; setName(order.guestName || ''); } }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label: string, body: any, after?: (d: any) => void, onFail?: (d: any) => boolean) => {
    acted.current++; setBusy(label);
    try {
      const d = await post(body);
      if (d.ok) { if (d.order && lane) setLane((l) => (l ? { ...l, orders: { ...l.orders, [d.order.id]: { ...(l.orders[d.order.id] || {}), ...d.order } } } : l)); after?.(d); }
      else if (!onFail?.(d) && d.error) setNotice({ text: d.error, tone: 'warn' });
    } catch { setNotice({ text: 'No connection. Try again.', tone: 'warn' }); }
    finally { acted.current++; setBusy(null); void load(); }
  };
  // A delivery app's order (lib/app-orders): rung in from the menu like any, then sent with the app's code.
  const appStart = () => act('appStart', { action: 'appStart', carKey: rid() }, (d) => { setPicked(d.carId); setName(''); nameFor.current = d.orderId; setNotice(null); });
  // Cancelled on the app: asked once more first; once the kitchen started on it, a manager's PIN (unless one is signed in).
  const appCancelDone = (d: any) => { setAppOff(null); setAppPin(null); setNotice({ text: `${d.name} was taken off${d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}.${d.returned ? ' What the kitchen hadn’t started went back.' : ''}`, tone: 'good' }); };
  const appCancel = (o: Order) => act(`appCancel-${o.id}`, { action: 'appCancel', orderId: o.id }, appCancelDone, (d) => { if (!d.needsManager) return false; setPinOwner(!!d.owner); setAppPin(o); return true; });
  // The guest's allergies, and a note on a dish (lib/order-allergy): while the order is being taken.
  const saveAllergy = (v: AllergyValue) => order && act('allergy', { action: 'allergy', orderId: order.id, allergy: allergyBody(v) }, (d) => { setAllergyOpen(false); setNotice({ text: d.already ? `${order.number}: that allergy is on the order already.` : d.tickets ? `${order.number}: allergy added to what’s still being made. Tell the kitchen too.` : d.allergy ? `${order.number}: allergy noted for the kitchen.` : `${order.number}: no allergies.`, tone: 'good' }); });
  // Handed over with an allergy the kitchen hasn't noted: refused; a manager can hand it over with their PIN.
  // …and one with bags whose labels aren't scanned yet: scanned first, or a manager lets it go without (lib/food-bags).
  const holdFor = (carId: string, label: string) => (d: any) => {
    if (d.code === 'bags' && Array.isArray(d.bags)) { setBagHold({ carId, label, waiting: d.bags }); return true; }
    if (d.code !== 'allergy') return false; setAllergyHold({ carId, label }); setNotice({ text: d.error, tone: 'warn' }); return true;
  };
  const bagScan = async (code: string) => {
    if (!bagHold) return { ok: false as const, error: 'Pick the order again.' };
    return scanReplyOf(await post({ action: 'bagScan', carId: bagHold.carId, code }).catch(() => ({ ok: false, error: 'No connection. Try again.' })));
  };
  // One item's sticker printed again (a remake, a torn one): lib/item-stickers-server.
  const stickerAgain = async (orderId: string, k: string) => { if (!bagHold) return { ok: false, error: 'Pick the order again.' }; const d = await post({ action: 'sticker', carId: bagHold.carId, orderId, k }).catch(() => ({ ok: false, error: 'No connection. Try again.' })); return d.ok ? { ok: true } : { ok: false, error: d.error || 'That didn’t print.' }; };
  const bagsDone = () => { if (!bagHold) return; const h = bagHold; setBagHold(null); void act(`gone-${h.carId}`, { action: 'move', carId: h.carId, to: 'gone' }, () => setNotice({ text: `${h.label} was handed over.`, tone: 'good' }), holdFor(h.carId, h.label)); };
  const bagSkip = async (pin: string, reason: string) => {
    if (!bagHold) return { ok: false, error: 'Pick the order again.' };
    const d = await post({ action: 'move', carId: bagHold.carId, to: 'gone', bagOverride: true, pin, bagReason: reason }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false, error: d.error || 'That didn’t go through. Try again.' };
    setNotice({ text: `${bagHold.label} was handed over, okayed by a manager.`, tone: 'good' }); setBagHold(null); acted.current++; void load(); return { ok: true };
  };
  const printBags = async (count: number, where: 'here' | 'printer') => {
    if (!labelsFor) return 'Pick the order again.';
    const d = await post({ action: 'bags', carId: labelsFor.carId, orderId: labelsFor.orderId, count, here: where === 'here' }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return d.error || 'That didn’t print. Try again.';
    if (where === 'here' && !(await printLabelsHere(d.labels || []))) return 'This device couldn’t open its print dialog.';
    setNotice({ text: where === 'here' ? `${labelsFor.number}: ${d.count === 1 ? 'its label' : `${d.count} bag labels`} sent to this device’s printer.` : `${labelsFor.number}: ${d.count === 1 ? 'its label' : `${d.count} bag labels`} printing on ${d.printer}.`, tone: 'good' });
    acted.current++; void load(); return null;
  };
  const allergyPinCheck = async (pin: string) => {
    if (!allergyHold) return { ok: false as const, error: 'Pick the order again.' };
    const d = await post({ action: 'move', carId: allergyHold.carId, to: 'gone', allergyOverride: true, pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    setNotice({ text: `${allergyHold.label} was handed over by a manager.`, tone: 'good' }); setAllergyHold(null); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: '', pass: '' } };
  };
  const saveNote = (l: Line, note: string) => order && act(`note-${l.lineId}`, { action: 'note', orderId: order.id, lineId: l.lineId, note, tapKey: rid() });
  const appCodeFix = (o: Order, v: { app: string; code: string }) => act(`appCode-${o.id}`, { action: 'appCode', orderId: o.id, app: v.app, code: v.code }, (d) => { setAppFix(null); setNotice({ text: d.already ? `${d.name}: no change.` : `Fixed: ${d.was} is now ${d.name}.`, tone: 'good' }); });
  // A delivery refunded at the counter (lib/food-delivery-settle-server) by someone who isn't a manager: a manager's PIN.
  const deliveryPinCheck = async (pin: string) => {
    if (!deliveryPin) return { ok: false as const, error: 'Pick the delivery again.' };
    const d = await post({ ...deliveryPin.body, pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    deliveryPin.done(d); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: String(d.approvedBy || ''), pass: '' } };
  };
  const appPinCheck = async (pin: string) => {
    if (!appPin) return { ok: false as const, error: 'Pick the order again.' };
    const d = await post({ action: 'appCancel', orderId: appPin.id, pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    appCancelDone(d); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: String(d.approvedBy || ''), pass: '' } };
  };
  const nextGuest = () => act('car', { action: 'car', carKey: rid() }, (d) => { setPicked(d.carId); setName(''); nameFor.current = d.orderId; setNotice(null); });
  // Something added from the menu is what's offered with next; something taken from an offer keeps the offer open.
  // (Sold by weight: what the scale reads first, components/pos/CounterWeight.)
  // (With a note for the kitchen, from the choices sheet: a line of its own.)
  const add = (m: Item, picks: Picks = {}, quantity = 1, offer?: 'item', weight?: number, note = '') => order && (m.byWeight && weight === undefined ? void setWeighFor({ m, picks, note }) : act(`add-${m.id}`, { action: 'add', orderId: order.id, itemId: m.id, choices: picks, quantity, tapKey: rid(), ...(offer ? { offer } : {}), ...(weight !== undefined ? { weight } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
    (d) => setJust((j) => (offer ? (j ? { ...j, took: true } : j) : d.line?.lineId ? { orderId: order.id, itemId: m.id, name: m.name, picks, quantity, lineId: d.line.lineId, took: false, sized: false } : null))));
  // A barcode from any scanner that types (lib/use-wedge-scanner; lib/counter-scan-server): the menu item it's on, added
  // like a tap; one with choices opens them; one on nothing yet asks which item it is; a scale's sticker is the item at
  // its weight or price (lib/scale-label).
  const scan = (code: string) => {
    if (!order || order.status !== 'building') { setNotice({ text: order ? `${order.number} has gone to the kitchen. Tap Next guest, then scan.` : 'Tap Next guest first, then scan.', tone: 'warn' }); return; }
    void act('scan', { action: 'scan', orderId: order.id, code, tapKey: rid() }, (d) => setNotice({ text: scanAddedWords(d), tone: 'good' }), (d) => {
      if (d.code === 'choices') { const m = menu.find((x) => x.id === d.itemId); if (m) { setChoiceOffer(false); setChoiceFor(m); return true; } }
      if (d.code === 'weigh') { const m = menu.find((x) => x.id === d.itemId); if (m) { if (m.choices.length) { setChoiceOffer(false); setChoiceFor(m); } else setWeighFor({ m, picks: {} }); return true; } }
      if (d.code === 'unknown') { setCodeFor(String(d.scanned || code)); setCodeScale(d.scaleNo || null); return true; }
      return false;
    });
  };
  // The guest screen facing the guest (app/drive-thru/[tenantId]/guest): the order this counter is on, as it changes.
  // (Said again every minute while an order is open, so one left open drops off the guest's screen.)
  useEffect(() => {
    if (!tenantId) return; const id = order?.id || null;
    void post({ action: 'show', orderId: id }).catch(() => null);
    if (!id) return; const i = setInterval(() => void post({ action: 'show', orderId: id }).catch(() => null), 60000);
    return () => clearInterval(i);
  }, [order?.id, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  useWedgeScanner(scan, !!tenantId && !refundOpen && !codeFor && !oneOffOpen && !giftOpen && !priceFor && !weighFor && !drawerOpen && !choiceFor && !discountPin && !partPin && !bagHold && !labelsFor, { layer: 'background' });
  const addOneOff = async (b: { name: string; price: number; taxed: boolean; tapKey: string }) => {
    if (!order || order.status !== 'building') return 'Tap Next guest first, then add it.';
    acted.current++;
    const d = await post({ action: 'oneOff', orderId: order.id, ...b }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    acted.current++;
    if (!d.ok) return d.error || 'That didn’t go through. Try again.';
    if (d.order) setLane((l) => (l ? { ...l, orders: { ...l.orders, [d.order.id]: { ...(l.orders[d.order.id] || {}), ...d.order } } } : l));
    setOneOffOpen(false); setNotice({ text: `${b.name} added.`, tone: 'good' }); void load(); return null;
  };
  const addGift = async (b: GiftBody) => {
    if (!order || order.status !== 'building') return 'Tap Next guest first, then add it.';
    acted.current++;
    const d = await post({ action: 'giftCard', orderId: order.id, ...b }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    acted.current++;
    if (!d.ok) return d.error || 'That didn’t go through. Try again.';
    if (d.order) setLane((l) => (l ? { ...l, orders: { ...l.orders, [d.order.id]: { ...(l.orders[d.order.id] || {}), ...d.order } } } : l));
    setGiftOpen(false); setNotice({ text: `A ${usd(b.cents / 100)} gift card${b.to ? ` for ${b.to}` : ''} added.`, tone: 'good' }); void load(); return null;
  };
  // Once it's paid: its gift cards' codes (made with the payment, or asked for here when it was paid another way).
  const hasGifts = (o: Order | null | undefined) => !!o?.lines.some((l) => (l as any).giftCard);
  const afterGifts = (o: Order, d: any) => {
    if (!hasGifts(o)) return;
    if (Array.isArray(d?.gifts) && d.gifts.length) { setGiftsMade({ orderId: o.id, number: o.number, gifts: d.gifts }); return; }
    void post({ action: 'giftIssue', orderId: o.id }).then((g) => { if (g?.ok && Array.isArray(g.gifts) && g.gifts.length) setGiftsMade({ orderId: o.id, number: o.number, gifts: g.gifts }); }).catch(() => null);
  };
  const giftRetry = async () => { if (!giftsMade) return null; const g = await post({ action: 'giftIssue', orderId: giftsMade.orderId }); return g?.ok && Array.isArray(g.gifts) ? g.gifts as GiftMade[] : null; };
  // (Saved for the business: every counter and lane screen; the Menu page's Register tiles card shows the same.)
  const arrangeTiles = async (change: Partial<TileSetup>): Promise<TileSetup | string> => {
    const r = await send('/api/menu', { tenantId, action: 'laneSettings', tiles: change }, { label: 'Arrange tiles', auth: 'user', keep: false, tenantId: String(tenantId || '') });
    const d: any = r.d && typeof r.d === 'object' ? r.d : null;
    if (!d?.ok || !d.lane?.tiles) return d?.error || 'That didn’t save. Try again.';
    setTilesNow({ v: d.lane.tiles, at: Date.now() }); return d.lane.tiles as TileSetup;
  };
  const tap = (m: Item) => { if (!order) { setNotice({ text: 'Tap Next guest first.', tone: 'warn' }); return; } setChoiceOffer(false); if (m.choices.length) setChoiceFor(m); else add(m); };
  // Pressed and held: its choices and a note, for any item (components/pos/RegisterTiles).
  const hold = (m: Item) => { if (!order) { setNotice({ text: 'Tap Next guest first.', tone: 'warn' }); return; } setChoiceOffer(false); setChoiceFor(m); };
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
  const staffMeal = () => order && staffFor && staffFor.trim() && act('staff', { action: 'staffMeal', orderId: order.id, for: staffFor.trim() }, staffDone, (d) => { if (!d.needsManager) return false; setPinOwner(!!d.owner); setStaffPin(true); return true; });
  const staffPinCheck = async (pin: string) => {
    if (!order || !staffFor?.trim()) return { ok: false as const, error: 'Type who it’s for first.' };
    const d = await post({ action: 'staffMeal', orderId: order.id, for: staffFor.trim(), pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    staffDone(d); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: String(d.approvedBy || ''), pass: '' } };
  };
  const paidWords = (d: any, how: string) => (how === 'cash' ? (d.keptChange ? `Paid in cash. They kept ${usd((Number(d.tipCents) || 0) / 100)} as a tip.` : d.change > 0 ? `Paid in cash. Give ${usd(d.change)} change.` : 'Paid in cash, no change.') : 'Paid by card.');
  const titleOf = (o: Order) => `${o.number}${o.guestName ? `, ${o.guestName}` : ''}`;
  // A tip and a discount (components/pos/CounterMoney; lib/counter-money): on the sent order, before it's paid.
  const tipIt = (cents: number) => order && act('tip', { action: 'tip', orderId: order.id, cents }, (d) => { setMoneyOpen(null);
    setNotice({ text: d.tipCents ? `${order.number}: a ${usd(d.tipCents / 100)} tip. The total is ${usd(d.total)}.` : `${order.number}: no tip.`, tone: 'good' }); });
  const offDone = (d: any) => { setMoneyOpen(null); setDiscountPin(null); setNotice({ text: d.off ? `${order?.number}: the discount was taken off.` : `${order?.number}: ${usd((Number(d.cents) || 0) / 100)} off${d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}. The total is ${usd(d.total)}.`, tone: 'good' }); };
  // A gift card or their store credit, set aside for what's left (lib/counter-money-server addTender); or taken off.
  const tenderDone = (d: any, words: string) => { setMoneyOpen(null); setNotice({ text: `${order?.number}: ${words}${d.due > 0 ? ` ${usd(d.due)} left to pay.` : ' Nothing left to pay: finish with it.'}`, tone: 'good' }); };
  const giftIt = (code: string) => order && act('tender', { action: 'tender', orderId: order.id, do: 'gift', code, ...(giftUpTo !== null ? { upTo: giftUpTo } : {}) }, (d) => { setGiftUpTo(null); tenderDone(d, `gift card ${d.code || ''} covers ${usd((Number(d.cents) || 0) / 100)}.`); });
  const creditIt = () => order && act('tender', { action: 'tender', orderId: order.id, do: 'credit' }, (d) => tenderDone(d, `store credit covers ${usd((Number(d.cents) || 0) / 100)}.`));
  const untender = (t: { kind: string; giftCardId?: string }) => order && act('tender', { action: 'tender', orderId: order.id, do: 'remove', ...(t.kind === 'credit' ? { credit: true } : { giftCardId: t.giftCardId }) }, (d) => setNotice({ text: `${order.number}: taken off. ${usd(d.due)} to pay.`, tone: 'good' }));
  const discountIt = (id: string | null) => order && act('discount', { action: 'discount', orderId: order.id, discountId: id }, offDone);
  const customOff = (c: CustomDiscount) => order && act('discount', { action: 'discount', orderId: order.id, custom: c }, offDone, (d) => { if (!d.needsManager) return false; setPinOwner(!!d.owner); setDiscountPin(c); return true; });
  const discountPinCheck = async (pin: string) => {
    if (!order || !discountPin) return { ok: false as const, error: 'Pick the order again.' };
    const d = await post({ action: 'discount', orderId: order.id, custom: discountPin, pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    offDone(d); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: String(d.approvedBy || ''), pass: '' } };
  };
  const pay = (method: 'cash' | 'card', tendered?: number, keepChange?: boolean) => order && act('paid', { action: 'paid', orderId: order.id, method, ...(tendered !== undefined ? { tendered } : {}), ...(keepChange ? { keepChange: true } : {}) }, (d) => {
    setNotice({ text: `${order.number}: ${paidWords(d, d.payMethod || method)}${giftsPaidWords(d.gifts)}`, tone: giftsFailed(d.gifts) ? 'warn' : 'good' }); afterGifts(order, d);
    if (!d.paidOtherwise) setSlip({ orderId: order.id, title: titleOf(order), cash: (d.payMethod || method) === 'cash', change: Number(d.change) > 0 ? Number(d.change) : null, auto: !d.already });
  });
  const toReader = (cents?: number) => order && reader && act('card', { action: 'card', orderId: order.id, readerId: reader.id, ...(cents !== undefined ? { cents } : {}) });
  // A split bill (components/pos/CounterMoney SplitAsk; lib/counter-split-server): how many ways, and one part at a time.
  // The last part pays the order.
  const splitWays = (ways: number | null) => order && act('split', { action: 'split', orderId: order.id, ways });
  const partDone = (d: any, how: string) => {
    setCash(null); setPartC(null);
    if (d.paid) { setNotice({ text: `${order?.number}: ${paidWords(d, d.payMethod || how)}${giftsPaidWords(d.gifts)}`, tone: giftsFailed(d.gifts) ? 'warn' : 'good' }); if (order) { afterGifts(order, d); setSlip({ orderId: order.id, title: titleOf(order), cash: how === 'cash', change: Number(d.change) > 0 ? Number(d.change) : null, auto: !d.already }); } return; }
    setNotice({ text: `${order?.number}: ${usd((Number(d.cents) || 0) / 100)} paid ${how === 'cash' ? `in cash${Number(d.change) > 0 ? `. Give ${usd(d.change)} change` : ''}` : 'on the card machine'}. ${usd(d.due)} left.`, tone: 'good' });
  };
  const cashPart = (tenderedNow: number) => order && partC !== null && act('part', { action: 'part', orderId: order.id, method: 'cash', cents: partC, tendered: tenderedNow }, (d) => partDone(d, 'cash'));
  const payPart = (how: PartHow, cents: number) => {
    if (!order) return;
    if (how === 'cash') { setPartC(cents); setCash(''); return; }
    if (how === 'gift') { setGiftUpTo(cents); setMoneyOpen('gift'); return; }
    if (how === 'reader') { void toReader(cents); return; }
    void act('part', { action: 'part', orderId: order.id, method: 'card', cents }, (d) => partDone(d, 'card'));
  };
  const partBackDone = (d: any) => { setPartPin(null); setNotice({ text: `${order?.number}: ${d.kind === 'cash' ? `${usd((Number(d.cents) || 0) / 100)} back to them in cash${d.fromDrawer ? ', out of the drawer' : ''}` : d.machine ? `give ${usd((Number(d.cents) || 0) / 100)} back on that card machine` : `${usd((Number(d.cents) || 0) / 100)} back to their card`}. ${usd(d.due)} to pay.`, tone: 'good' }); };
  const partBack = (t: { partId?: string; cents: number; kind: string }) => order && t.partId && act('partUndo', { action: 'partUndo', orderId: order.id, partId: t.partId }, partBackDone, (d) => { if (!d.needsManager) return false; setPinOwner(!!d.owner); setPartPin({ partId: t.partId!, cents: t.cents, kind: t.kind }); return true; });
  const partPinCheck = async (pin: string) => {
    if (!order || !partPin) return { ok: false as const, error: 'Pick the order again.' };
    const d = await post({ action: 'partUndo', orderId: order.id, partId: partPin.partId, pin }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    partBackDone(d); acted.current++; void load(); return { ok: true as const, staff: { id: '', name: '', pass: '' } };
  };
  const stopReader = () => order && act('cardStop', { action: 'cardStop', orderId: order.id }, (d) => { setNotice(d.state === 'paid' ? { text: 'The card went through, so it’s paid.', tone: 'good' } : { text: 'Stopped. Take it another way.', tone: 'good' });
    if (d.state === 'paid') setSlip({ orderId: order.id, title: titleOf(order), cash: false, change: null }); if (d.state === 'paid') afterGifts(order, d); });
  const cancel = () => { if (!order) return; setJust(null); void act('cancel', { action: 'cancel', orderId: order.id }, () => setNotice({ text: `${order.number} was dropped.`, tone: 'good' })); };
  const call = (g: Guest, o?: Order) => { sayOut(g.number, o?.guestName); void act(`call-${g.id}`, { action: 'call', carId: g.id }); };
  const handOver = (g: Guest) => act(`gone-${g.id}`, { action: 'move', carId: g.id, to: 'gone' }, () => setNotice({ text: `${g.number} was handed over.`, tone: 'good' }), holdFor(g.id, g.number));
  useEffect(() => {
    const id = order?.id; if (!cardOn || !id) return;
    let live = true;
    const i = setInterval(async () => { const d = await post({ action: 'cardCheck', orderId: id }).catch(() => null); if (!live || !d?.ok) return; if (d.state === 'paid') { setNotice({ text: `${order?.number}: paid by card.`, tone: 'good' }); if (order) setSlip({ orderId: id, title: titleOf(order), cash: false, change: null }); if (order) afterGifts(order, d); } if (d.state === 'part') setNotice({ text: `${order?.number}: ${usd((Number(d.partCents) || 0) / 100)} paid by card. ${usd(Number(d.due) || 0)} left.`, tone: 'good' }); if (d.state !== 'on_reader') void load(); }, 2000);
    return () => { live = false; clearInterval(i); };
  }, [cardOn, order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tenantId) return null;
  // (What's left to pay by cash or card: all of it, or what a gift card or store credit doesn't cover.)
  const due = order ? (typeof order.due === 'number' ? order.due : order.total) : 0; const covered = !!order?.tenders?.length && due <= 0;
  // (Cash for one part of a split bill, or for what's left.)
  const cashFor = partC !== null ? partC / 100 : due;
  const tendered = Number(cash); const quick = order ? Array.from(new Set([cashFor, Math.ceil(cashFor / 5) * 5, Math.ceil(cashFor / 10) * 10, 20, 50].filter((x) => x >= cashFor))).slice(0, 4) : [];
  return (<>
    <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-5 sm:px-6" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-1 text-[24px] font-semibold tracking-tight">Counter</h1>
          {lane?.location?.name && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: SOFT, color: INK }}>{lane.location.name}</span>}
          {lane?.daypart && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>{lane.daypart.name} until {lane.daypart.until}</span>}
          {lane?.happyHour && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Happy hour until {lane.happyHour.until}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(lane?.apps || []).length > 0 && <button type="button" disabled={busy === 'appStart'} onClick={appStart} className={`${btn} px-5`} style={quiet}>App order</button>}
          <button type="button" disabled={busy === 'car'} onClick={nextGuest} className={`${btn} px-5`} style={dark}>Next guest</button>
        </div>
      </div>
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <p role="status" aria-live="polite" className={notice ? 'rounded-2xl px-4 py-3 text-[14.5px]' : 'sr-only'} style={notice ? (notice.tone === 'good' ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }) : undefined}>{notice?.text || ''}</p>
      {ordering.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Guests ordering">{ordering.map((c) => { const o = c.orderId ? lane?.orders[c.orderId] : undefined; const on = c.id === guest?.id;
        return <button key={c.id} type="button" aria-pressed={on} onClick={() => setPicked(c.id)} className={`${btn} text-[14px]`} style={on ? dark : quiet}>{c.number}{o?.guestName ? `, ${o.guestName}` : ''}{c.stage === 'pay' ? ' (paying)' : ''}</button>; })}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section aria-label="Menu" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          {guest?.stage === 'pay' && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>{guest.number} is with the kitchen. Take payment, or tap Next guest to start another order.</p>}
          {!lane ? <p className="py-10 text-center text-[14px]" style={{ color: MUTED }}>Reading the menu…</p>
            : menu.length === 0 ? <p className="rounded-2xl px-4 py-10 text-center text-[14.5px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>Nothing is on the menu yet. A manager can add items on the Menu page.</p>
            : <RegisterTiles items={menu} most={lane.most || null} setup={tilesNow && Date.now() - tilesNow.at < 60000 ? tilesNow.v : lane.tiles || null} onArrange={canArrange ? arrangeTiles : undefined} counts={onOrder} section={section} onSection={setSection} busyId={busy?.startsWith('add-') ? busy.slice(4) : null} locked={guest?.stage === 'pay'} onTap={tap} onHold={hold} place="counter" />}
          {lane && order?.status === 'building' && guest?.stage !== 'pay' && ((lane.oneOffMax ?? 0) > 0 || lane.gift) && <div className="flex flex-wrap gap-2">
            {(lane.oneOffMax ?? 0) > 0 && <button type="button" onClick={() => setOneOffOpen(true)} className={`${btn} min-w-[12rem] flex-1 text-[14.5px]`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Another item, not on the menu</button>}
            {lane.gift && <button type="button" onClick={() => setGiftOpen(true)} className={`${btn} min-w-[12rem] flex-1 text-[14.5px]`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>A gift card</button>}
          </div>}
        </section>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <GiftsOpen rows={(lane?.gift?.open || []).filter((g) => g.orderId !== giftsMade?.orderId)} make={async (orderId, number) => { const g = await post({ action: 'giftIssue', orderId }).catch(() => null); if (g?.ok && Array.isArray(g.gifts)) setGiftsMade({ orderId, number, gifts: g.gifts }); else setNotice({ text: g?.error || 'That didn’t go through. Try again.', tone: 'warn' }); void load(); }} />
        {giftsMade && <GiftsMade number={giftsMade.number} gifts={giftsMade.gifts} retry={giftRetry} onClose={() => setGiftsMade(null)} />}
        {slip && <ReceiptAsk key={`${slip.orderId}${slip.later ? '-later' : ''}`} tenantId={tenantId} receiptId={`co_${slip.orderId}`} title={slip.title} cash={slip.cash} change={slip.change} setup={lane?.receipt || null} later={slip.later} auto={slip.auto !== false} onClose={() => setSlip(null)} />}
        <section aria-label="The order" className="flex flex-col gap-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          {!order ? <div className="space-y-3 py-6 text-center"><p className="text-[15px] font-semibold">No guest ordering</p><p className="text-[14px]" style={{ color: MUTED }}>Tap Next guest to start an order. It gets a counter number, like C14, for calling it out.</p></div> : <>
            <div className="flex items-center justify-between gap-2"><h2 className="text-[19px] font-semibold">{order.number}{order.guestName ? `, ${order.guestName}` : ''}{order.app ? <span className="ml-2 rounded-full px-2.5 py-1 align-middle text-[12.5px] font-semibold" style={{ background: SOFT }}>App order</span> : order.status !== 'building' && order.toGo ? <span className="ml-2 text-[14px] font-medium" style={{ color: MUTED }}>To go</span> : null}</h2>
              {order.status === 'building' && <button type="button" onClick={cancel} disabled={!!busy} className={`${btn} px-3 text-[13.5px]`} style={{ color: MUTED }}>Drop it</button>}</div>
            <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>{order.app ? 'Name on the app order' : 'First name, for calling it out'}
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Optional" autoComplete="off" className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[15px] font-normal outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
            {lane?.settings?.texts && !order.app && (order.text
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
                  <span className="min-w-0"><span className="block font-semibold">{l.name}{l.happy ? ' (happy hour)' : ''}{l.offer === 'size' && order.status === 'building' ? <span className="ml-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Sized up</span> : null}</span>{l.choicesText && <span className={`block ${(l as any).weight ? '' : 'truncate '}text-[13px]`} style={{ color: MUTED }}>{l.choicesText}</span>}
                    {order.allergy && (() => { const w = conflictWords(dishConflict(menu.find((m) => m.id === l.itemId), order.allergy), order.allergy); return w ? <span className="block text-[13px] font-semibold" style={{ color: AMBER }}>{w}</span> : null; })()}
                    <span className="flex flex-wrap items-center gap-x-4">{(l as any).giftCard ? <span className="block text-[13px]" style={{ color: MUTED }}>{giftWords((l as any).giftCard)}</span>
                      : (l as any).oneOff ? <span className="block text-[13px]" style={{ color: MUTED }}>Not on the menu{(l as any).untaxed ? ', not taxed' : ''}</span>
                      : <LineNote note={l.note} name={l.name} busy={!!busy} editable={order.status === 'building'} onSave={(n) => void saveNote(l, n)} />}
                    {(l as any).comp ? <span className="flex flex-wrap items-center gap-x-3"><span className="text-[13px] font-medium" style={{ color: GREEN }}>{compWords(l as any)}</span>
                      {canComp && <button type="button" onClick={() => void act(`uncomp-${l.lineId}`, { action: 'uncomp', orderId: order.id, lineId: l.lineId }, () => setNotice({ text: `${l.name} is charged for again.`, tone: 'good' }))} disabled={!!busy} className={`min-h-[44px] text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Charge for it</button>}</span>
                      : canComp && !(l as any).giftCard && !(l as any).priceChange && <PriceMenu name={l.name} free={l.unitPrice > 0} busy={!!busy} onFree={() => setCompFor(l.lineId)} onPrice={() => setPriceFor(l.lineId)} />}</span>
                    {(l as any).priceChange && !(l as any).comp && <span className="flex flex-wrap items-center gap-x-3"><span className="text-[13px] font-medium" style={{ color: GREEN }}>{priceWords(l as any)}</span>
                      {canComp && <button type="button" onClick={() => void act(`priceBack-${l.lineId}`, { action: 'priceBack', orderId: order.id, lineId: l.lineId }, () => setNotice({ text: `${l.name} is back at its menu price.`, tone: 'good' }))} disabled={!!busy} className={`min-h-[44px] text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Menu price</button>}</span>}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {order.status === 'building' && <button type="button" aria-label={`One fewer ${l.name}`} onClick={() => setQty(l, l.quantity - 1)} disabled={!!busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>−</button>}
                    {canTakeOff && (order.lines.length > 1 || l.quantity > 1) && <button type="button" onClick={() => setTakeOffFor(l.lineId)} disabled={!!busy} aria-label={`Take ${l.name} off`} className={`min-h-[44px] rounded-lg px-2 text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Take off</button>}
                    <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                    {order.status === 'building' && <button type="button" aria-label={`One more ${l.name}`} onClick={() => setQty(l, l.quantity + 1)} disabled={!!busy || l.quantity >= 20 || !!(l as any).comp || !!(l as any).giftCard || !!(l as any).weight} className={`h-11 w-11 rounded-full text-[18px] disabled:opacity-30 ${RING}`} style={quiet}>+</button>}
                    <span className="w-16 text-right tabular-nums">{usd(l.unitPrice * l.quantity)}</span>
                  </span>
                </li>))}</ul>}
            {(order.status === 'building' || order.status === 'sent' || order.allergy) && <button type="button" onClick={() => (order.status === 'building' || order.status === 'sent') && setAllergyOpen(true)} disabled={!!busy || (order.status !== 'building' && order.status !== 'sent')} aria-label={order.allergy ? `Allergy: ${allergyWords(order.allergy)}. Change it` : 'Allergies for this order'}
              className={`${btn} w-full justify-start text-left text-[14px] disabled:opacity-100`} style={order.allergy ? { background: AMBER_TINT, color: AMBER, border: `1px solid ${AMBER_TINT}` } : quiet}>{order.allergy ? `Allergy: ${allergyWords(order.allergy)}` : 'Allergies for this order'}</button>}
            {order.status === 'building' && <OfferAsk just={just} orderId={order.id} item={menu.find((m) => m.id === just?.itemId)} find={(id) => menu.find((m) => m.id === id && !m.off && !outWords(m))}
              have={(id) => order.lines.some((l) => l.itemId === id)} price={priceOf} busy={!!busy} onSizeUp={sizeUp} onAdd={takeOffer} onClose={() => setJust(null)} />}
            {lane?.pointsOn && !order.staffMeal && !order.app && <div className="border-t pt-2" style={{ borderColor: LINE }}>
              <RewardsRow order={order} member={member} codes={!!lane.rewardsCodes} busy={!!busy} onAdd={() => setPointsOpen(true)} onUse={(id) => void applyReward(id)}
                usualOk={(u) => { const m = menu.find((x) => x.id === u.itemId); return !!m && !m.off && !outWords(m) && !m.byWeight && m.onMenu; }}
                onUsual={(u) => { const m = menu.find((x) => x.id === u.itemId); if (m) void add(m, u.picks); }} />
              {memberErr && order.points?.verified && member?.orderId !== order.id && <p className="flex flex-wrap items-center gap-2 text-[13.5px]" style={{ color: 'var(--warn-ink)' }} role="status">Their rewards didn’t load.
                <button type="button" onClick={() => setMemberTry((n) => n + 1)} className={`min-h-[44px] rounded-lg px-1 font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>Try again</button></p>}</div>}
            <div className="space-y-1 border-t pt-3 text-[14px]" style={{ borderColor: LINE }}>
              {(order.reward || order.markdown) && <>
                <div className="flex justify-between" style={{ color: MUTED }}><span>Subtotal</span><span className="tabular-nums">{usd(order.itemsTotal || 0)}</span></div>
                {order.reward && <div className="flex justify-between gap-3" style={{ color: GREEN }}><span className="min-w-0 truncate">Reward: {order.reward.name}</span><span className="shrink-0 tabular-nums">-{usd(order.reward.cents / 100)}</span></div>}
                {order.markdown && <div className="flex justify-between gap-3" style={{ color: GREEN }}><span className="min-w-0 truncate">{order.markdown.reason || order.markdown.label}{order.markdown.okBy ? `, okayed by ${order.markdown.okBy}` : ''}</span><span className="shrink-0 tabular-nums">-{usd(order.markdown.cents / 100)}</span></div>}</>}
              <div className="flex justify-between" style={{ color: MUTED }}><span>Tax</span><span className="tabular-nums">{order.app ? (order.app.money && order.app.money.appPaysTax === false ? `Yours to pay, ${usd(order.app.money.taxCents / 100)}` : 'The app collects it') : usd(order.tax)}</span></div>
              {giftCentsOf(order.lines) > 0 && <div className="flex justify-between" style={{ color: MUTED }}><span>Gift card{order.lines.filter((l) => (l as any).giftCard).length > 1 ? 's' : ''}, not taxed</span><span className="tabular-nums">{usd(giftCentsOf(order.lines) / 100)}</span></div>}
              {!order.app && (order.tipCents || 0) > 0 && <div className="flex justify-between" style={{ color: MUTED }}><span>Tip{order.keptChange ? ', kept the change' : ''}</span><span className="tabular-nums">{usd((order.tipCents || 0) / 100)}</span></div>}
              <div className="flex justify-between text-[16px] font-semibold"><span>Total</span><span className="tabular-nums">{usd(order.app ? order.subtotal : order.total)}</span></div>
              {(order.tenders || []).map((t) => { const paidPart = t.kind === 'cash' || t.kind === 'card'; const words = t.kind === 'gift' ? `Gift card ${t.code || ''}` : t.kind === 'credit' ? 'Store credit' : t.kind === 'cash' ? 'Paid in cash' : t.machine ? 'Paid on a card machine' : 'Paid by card';
                return <div key={t.partId || (t.kind === 'gift' ? t.giftCardId : 'credit')} className="flex items-center justify-between gap-2" style={{ color: GREEN }}>
                <span className="min-w-0 truncate">{words}</span>
                <span className="flex shrink-0 items-center gap-1"><span className="tabular-nums">-{usd(t.cents / 100)}</span>
                  {!order.paidAt && (paidPart ? <button type="button" onClick={() => void partBack(t)} disabled={!!busy || cardOn} aria-label={`Give back ${usd(t.cents / 100)} ${t.kind === 'cash' ? 'in cash' : 'to the card'}`} className={`min-h-[44px] rounded-lg px-2 text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Give back</button>
                    : <button type="button" onClick={() => void untender(t)} disabled={!!busy} aria-label={`Take ${t.kind === 'gift' ? `gift card ${t.code || ''}` : 'store credit'} off`} className={`min-h-[44px] rounded-lg px-2 text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Take off</button>)}</span></div>; })}
              {(order.tenders || []).length > 0 && <div className="flex justify-between text-[16px] font-semibold"><span>Left to pay</span><span className="tabular-nums">{usd(due)}</span></div>}
              {order.app?.money && order.app.money.markupPct > 0 && <div className="flex justify-between" style={{ color: MUTED }}><span>On {order.app.label} (+{order.app.money.markupPct}%)</span><span className="tabular-nums">{usd(order.app.money.appCents / 100)}</span></div>}
            </div>
            {order.status === 'building' && order.app ? <AppSend apps={lane?.apps || []} busy={!!busy} empty={!order.lines.length} onSend={(v) => { saveName(); void act('appSend', { action: 'appSend', orderId: order.id, ...v },
                (d) => setNotice({ text: `${d.name} is with the kitchen${d.shelf ? `, for shelf ${d.shelf}` : ''}. It waits for the courier.`, tone: 'good' })); }} />
            : order.status === 'building' ? <>
              {lane?.askToGo && <div role="radiogroup" aria-label="For here or to go" className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: SOFT }}>
                {[{ v: false, label: 'For here' }, { v: true, label: 'To go' }].map((x) => <button key={x.label} type="button" role="radio" aria-checked={toGo === x.v} onClick={() => setToGo(x.v)} className={`min-h-[44px] rounded-lg text-[14.5px] font-semibold ${RING}`} style={toGo === x.v ? { background: '#fff', color: INK, boxShadow: '0 1px 2px rgba(22,23,26,0.08)' } : { color: MUTED }}>{x.label}</button>)}
              </div>}
              <button type="button" disabled={!order.lines.length || !!busy} onClick={() => { saveName(); void sendIt(); }} className={`${btn} min-h-[52px] text-[16px]`} style={dark}>Send and take payment</button></>
              : cardOn ? <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}><p className="text-[14.5px] font-semibold">On the card reader: {usd(order.card?.cents ? order.card.cents / 100 : due)}</p><p className="text-[13px]" style={{ color: MUTED }}>The guest taps, inserts or swipes there.</p><button type="button" onClick={stopReader} disabled={!!busy} className={`${btn} w-full`} style={quiet}>Stop</button></div>
              : staffFor !== null ? <div className="space-y-2">
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Who it’s for
                  <input autoFocus value={staffFor} onChange={(e) => setStaffFor(e.target.value.slice(0, 24))} onKeyDown={(e) => { if (e.key === 'Enter') void staffMeal(); }} placeholder="First name" autoComplete="off" className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
                <p className="text-[13px]" style={{ color: MUTED }}>No money is taken, and it can’t be undone. It comes off stock as usual and shows on Food cost as a staff meal, at what it cost to make. A manager rings it in.</p>
                <div className="flex gap-2"><button type="button" onClick={() => setStaffFor(null)} className={`${btn} flex-1`} style={quiet}>Back</button>
                  <button type="button" disabled={!!busy || !staffFor.trim()} onClick={() => void staffMeal()} className={`${btn} flex-[2]`} style={dark}>Ring in as a staff meal</button></div>
              </div>
              : cash !== null ? <div className="space-y-2">
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>{partC !== null ? `Cash handed over for this part, ${usd(cashFor)}` : 'Cash handed over'}
                  <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} placeholder={cashFor.toFixed(2)} className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal tabular-nums outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
                <div className="flex flex-wrap gap-2">{quick.map((q) => <button key={q} type="button" onClick={() => setCash(q.toFixed(2))} className={`${btn} px-3 text-[14px]`} style={{ background: SOFT, color: INK }}>{q === cashFor ? 'Exact' : usd(q)}</button>)}</div>
                {cash !== '' && Number.isFinite(tendered) && tendered >= cashFor && <p className="text-[15px] font-semibold" style={{ color: GREEN }}>Change: {usd(tendered - cashFor)}</p>}
                {lane?.money?.tips && partC === null && cash !== '' && Number.isFinite(tendered) && tendered > due && tendered - due <= Math.min(order.total, 500) && <button type="button" disabled={!!busy} onClick={() => pay('cash', tendered, true)} className={`${btn} w-full`} style={quiet}>Keep the change as a tip</button>}
                <div className="flex gap-2"><button type="button" onClick={() => { setCash(null); setPartC(null); }} className={`${btn} flex-1`} style={quiet}>Back</button>
                  <button type="button" disabled={!!busy || (cash !== '' && !(tendered >= cashFor))} onClick={() => (partC !== null ? cashPart(cash === '' ? cashFor : tendered) : pay('cash', cash === '' ? due : tendered))} className={`${btn} flex-[2]`} style={dark}>Take cash</button></div>
              </div>
              : moneyOpen === 'tip' && lane?.money?.tips ? <TipAsk baseCents={tipBaseOf(order)} tipCents={order.tipCents || 0} pcts={lane.money.tips.pcts} busy={!!busy} onPick={(c) => void tipIt(c)} onClose={() => setMoneyOpen(null)} />
              : moneyOpen === 'gift' ? <GiftAsk dueCents={giftUpTo ?? Math.round(due * 100)} member={!!order.points?.verified} needsCode={!!order.points && !order.points.verified} busy={!!busy} onGift={(c) => void giftIt(c)} onCredit={() => void creditIt()} onClose={() => { setMoneyOpen(null); setGiftUpTo(null); }} />
              : covered ? <div className="space-y-2">
                <button type="button" disabled={!!busy} onClick={() => void act('paid', { action: 'paid', orderId: order.id, method: 'tender' }, (d) => { setNotice({ text: `${order.number}: paid with ${order.tenders!.every((t) => t.kind === 'gift') ? 'the gift card' : order.tenders!.every((t) => t.kind === 'credit') ? 'store credit' : 'the gift card and store credit'}.`, tone: 'good' }); setSlip({ orderId: order.id, title: titleOf(order), cash: false, change: null, auto: !d.already }); })} className={`${btn} min-h-[52px] w-full text-[16px]`} style={dark}>Finish: it’s all covered</button>
                <button type="button" onClick={() => setMoneyOpen('gift')} disabled={!!busy} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Gift card or store credit</button>
              </div>
              : moneyOpen === 'discount' ? <DiscountPick list={lane?.money?.discounts || []} current={order.markdown?.id || null} busy={!!busy} onPick={(id) => void discountIt(id)} onCustom={(c) => void customOff(c)} onClose={() => setMoneyOpen(null)} />
              : order.split && !order.app ? <div className="space-y-2">
                {order.card?.failed && <p className="text-[13.5px]" style={{ color: AMBER }}>{order.card.failed}</p>}
                <SplitAsk dueCents={Math.round(due * 100)} ways={order.split.ways} shares={order.split.shares} reader={reader ? reader.label : null} busy={!!busy}
                  onWays={(n) => void splitWays(n)} onPay={payPart} onStop={() => void splitWays(null)} /></div>
              : <div className="space-y-2">
                {order.card?.failed && <p className="text-[13.5px]" style={{ color: AMBER }}>{order.card.failed}</p>}
                {!order.app && <div className={`grid gap-2 ${lane?.money?.tips ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {lane?.money?.tips && <button type="button" onClick={() => setMoneyOpen('tip')} disabled={!!busy} className={`${btn} px-2 text-[14px]`} style={quiet}>{order.tipCents ? `Tip ${usd(order.tipCents / 100)}` : 'Tip'}</button>}
                  <button type="button" onClick={() => setMoneyOpen('discount')} disabled={!!busy} className={`${btn} px-2 text-[14px]`} style={quiet}>{order.markdown ? `Discount ${usd(order.markdown.cents / 100)}` : 'Discount'}</button>
                  <button type="button" onClick={() => setMoneyOpen('gift')} disabled={!!busy} className={`${btn} px-2 text-[14px]`} style={quiet}>Gift card</button>
                  <button type="button" onClick={() => void splitWays(2)} disabled={!!busy} className={`${btn} px-2 text-[14px]`} style={quiet}>Split</button>
                </div>}
                <button type="button" onClick={() => setCash('')} disabled={!!busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={dark}>Cash</button>
                {readers.length > 1 && <select aria-label="Card reader" value={reader?.id || ''} onChange={(e) => { setReaderId(e.target.value); try { localStorage.setItem(READER_KEY, e.target.value); } catch { /* private window */ } }} className={`min-h-[44px] w-full rounded-xl border px-3 text-[14.5px] ${RING}`} style={{ background: '#fff', borderColor: LINE, color: INK }}><option value="">Pick a card reader</option>{readers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>}
                {readers.length > 0 && <button type="button" onClick={() => void toReader()} disabled={!reader || !!busy} className={`${btn} w-full`} style={quiet}>Card reader{reader && readers.length > 1 ? `: ${reader.label}` : ''}</button>}
                <button type="button" onClick={() => pay('card')} disabled={!!busy} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Paid on another card machine</button>
                <button type="button" onClick={() => setStaffFor('')} disabled={!!busy} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Staff meal</button>
              </div>}
          </>}
        </section>
        </div>
      </div>

      <AppSoldOut rows={lane?.appSoldOut || []} taps={lane?.appSoldOutTaps} busy={busy} act={act} notify={(text) => setNotice({ text, tone: 'good' })} />
      <ComingUp rows={lane?.comingUp || []} now={now} busy={busy} act={act} notify={(text) => setNotice({ text, tone: 'good' })} askPin={(body, line, done, owner) => { setPinOwner(!!owner); setDeliveryPin({ body, line, done }); }} />
      <Deliveries rows={lane?.deliveries || []} drivers={lane?.drivers || []} now={now} busy={busy} act={act} driverNow={lane?.driverNow || null} slow={lane?.slow || null}
        notify={(text) => setNotice({ text, tone: 'good' })} askPin={(body, line, done, owner) => { setPinOwner(!!owner); setDeliveryPin({ body, line, done }); }} />

      <section aria-labelledby="counter-waiting" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="counter-waiting" className="text-[17px] font-semibold">Waiting</h2>
          {tenantId && <span className="flex flex-wrap gap-x-4">
            <a href={`/drive-thru/${tenantId}/ready`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4" style={{ color: INK }}>Open the ready board</a>
            <a href={`/drive-thru/${tenantId}/kiosk`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4" style={{ color: INK }}>Open a kiosk</a>
            <a href={`/drive-thru/${tenantId}/guest`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4" style={{ color: INK }}>Open the guest screen</a>
            <button type="button" onClick={() => setRefundOpen(true)} className={`inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>Refund an order</button>
            <button type="button" onClick={() => setDrawerOpen(true)} className={`inline-flex min-h-[44px] items-center rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: INK }}>Cash in or out</button>
          </span>}
        </div>
        {waiting.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Paid orders wait here until they’re handed over, kiosk orders too.</p>
          : <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">{waiting.map((g) => {
            const o = g.orderId ? lane?.orders[g.orderId] : undefined; const ready = !!o && (o.kitchen === 'ready' || (o.ticketCount === 0 && o.status !== 'building'));
            return (
              <li key={g.id} className="flex flex-col gap-2 rounded-2xl p-3" style={{ background: ready && !g.calledAt ? GREEN_TINT : SOFT }}>
                {o?.app?.code ? <div>
                  <p className="text-[19px] font-semibold">{o.app.label} {o.app.code}</p>
                  <p className="text-[13px]" style={{ color: ready ? GREEN : MUTED }}>{ready ? `Ready${o.app.shelf ? ` on shelf ${o.app.shelf}` : ', at the counter'}.` : `Making: ${(o.waitingOn || []).map((w) => (w.quantity > 1 ? `${w.quantity} ${w.name}` : w.name)).join(', ') || 'with the kitchen'}.${o.app.shelf ? ` Shelf ${o.app.shelf}.` : ''}`}{o.guestName ? ` ${o.guestName}` : ''}</p>
                  {o.app.courierAt && (courierLate(o.app.courierAt, now)
                    ? <p className="text-[13px] font-medium" style={{ color: AMBER }}>The courier was due {clockOf(o.app.courierAt)}. Check the app: picked up, or cancelled?</p>
                    : <p className="text-[13px]" style={{ color: MUTED }}>Courier about {clockOf(o.app.courierAt)}</p>)}
                </div> : <div><p className="text-[19px] font-semibold">{g.number}{o?.guestName ? ` ${o.guestName}` : ''}{o?.staffMeal || o?.toGo ? <span className="ml-2 text-[13.5px] font-medium" style={{ color: MUTED }}>{o.staffMeal ? 'Staff meal' : 'To go'}</span> : null}</p>
                  <p className="text-[13px]" style={{ color: ready && !g.calledAt ? GREEN : MUTED }}>{g.calledAt ? `Called ${minsAgo(g.calledAt, now)}` : ready ? 'Ready' : `Making: ${(o?.waitingOn || []).map((w) => (w.quantity > 1 ? `${w.quantity} ${w.name}` : w.name)).join(', ') || 'with the kitchen'}`}</p>
                  {o?.text && <p className="text-[13px]" style={{ color: o.text.failed ? AMBER : MUTED }}>{!o.text.sent ? `Gets a text when it’s ready (···${o.text.last4})` : o.text.failed ? 'The text may not have gone' : `Texted${o.text.sentAt ? ` ${minsAgo(o.text.sentAt, now)}` : ''}`}</p>}</div>}
                {o?.app?.code ? <>
                  {ready && <button type="button" onClick={() => void act(`gone-${g.id}`, { action: 'move', carId: g.id, to: 'gone' }, () => setNotice({ text: `${o.app!.label} ${o.app!.code} was picked up.`, tone: 'good' }), holdFor(g.id, `${o.app!.label} ${o.app!.code}`))} disabled={busy === `gone-${g.id}`} className={`${btn} w-full`} style={dark}>Picked up by the courier</button>}
                  {appFix === o.id ? <AppFix id={o.id} apps={lane?.apps || []} start={{ app: String(o.app.app || ''), code: String(o.app.code || '') }} busy={!!busy} onSave={(v) => void appCodeFix(o, v)} onKeep={() => setAppFix(null)} />
                  : appOff === o.id ? <div className="space-y-2 rounded-xl p-2.5" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                    <p className="text-[13.5px]">Cancelled on {o.app.label}? It comes off the shelf, and anything already made is thrown out.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void appCancel(o)} disabled={!!busy} className={`${btn} flex-1 px-3 text-[14px]`} style={{ background: '#fff', color: 'var(--bad-ink)', border: '1px solid var(--bad-ink)' }}>Yes, it’s cancelled</button>
                      <button type="button" onClick={() => setAppOff(null)} className={`${btn} px-3 text-[14px]`} style={quiet}>Keep it</button>
                    </div>
                  </div>
                    : <div className="flex flex-wrap gap-x-1.5">
                      <button type="button" onClick={() => { setAppOff(null); setAppFix(o.id); }} disabled={!!busy} className={`${btn} flex-1 whitespace-nowrap px-2 text-[14px]`} style={{ color: MUTED }}>Fix the code</button>
                      <button type="button" onClick={() => { setAppFix(null); setAppOff(o.id); }} disabled={!!busy} className={`${btn} flex-1 whitespace-nowrap px-2 text-[14px]`} style={{ color: MUTED }}>Cancelled on the app</button>
                    </div>}
                </> : ready && (g.calledAt
                  ? <div className="flex gap-2"><button type="button" onClick={() => handOver(g)} disabled={busy === `gone-${g.id}`} className={`${btn} flex-1 px-3`} style={dark}>Handed over</button><button type="button" onClick={() => call(g, o)} className={`${btn} px-3`} style={quiet}>Call again</button></div>
                  : <button type="button" onClick={() => call(g, o)} disabled={busy === `call-${g.id}`} className={`${btn} w-full`} style={dark}>Call {o?.guestName || g.number}</button>)}
                {o && !o.app?.code && o.paidAt && !o.staffMeal && <button type="button" onClick={() => setSlip({ orderId: o.id, title: titleOf(o), cash: false, change: null, later: true })} className={`${btn} w-full text-[14px]`} style={quiet}>Receipt</button>}
                {o && o.status === 'sent' && <button type="button" onClick={() => setLabelsFor({ carId: g.id, orderId: o.id, number: o.app?.code ? `${o.app.label} ${o.app.code}` : g.number, start: o.bags?.of || o.bagsStart || 1 })} className={`${btn} w-full text-[14px]`} style={quiet}>
                  {o.bags ? (o.bags.left.length ? `Bag labels, ${o.bags.of - o.bags.left.length} of ${o.bags.of} scanned` : o.bags.of === 1 ? 'Bag label' : `Bag labels, ${o.bags.of}`) : 'Print bag labels'}</button>}
              </li>
            ); })}</ul>}
      </section>
    </main>
    {allergyOpen && order && <AllergySheet start={allergyFrom(order.allergy)} sent={order.status === 'sent'} name={order.guestName || order.number} busy={busy === 'allergy'} onSave={(v) => void saveAllergy(v)} onClose={() => setAllergyOpen(false)} />}
    {bagHold && <BagScanSheet key={bagHold.waiting.map((w) => `${w.orderId}:${w.of}:${w.left.join('.')}`).join('|')} title={`Hand over ${bagHold.label}`} waiting={bagHold.waiting} scan={bagScan} onDone={bagsDone} skip={bagSkip} printItem={stickerAgain} onClose={() => setBagHold(null)}
      print={(orderId) => { const g = lane?.cars.find((c) => c.id === bagHold.carId); const o = lane?.orders[orderId]; setBagHold(null); setLabelsFor({ carId: bagHold.carId, orderId, number: o?.number || g?.number || bagHold.label, start: o?.bags?.of || o?.bagsStart || 1 }); }} />}
    {labelsFor && <BagLabelsSheet number={labelsFor.number} start={labelsFor.start} printer={lane?.settings?.labelPrinter || null} onPrint={printBags} onClose={() => setLabelsFor(null)} />}
    {allergyHold && <PinPad check={allergyPinCheck} onDone={() => setAllergyHold(null)} onClose={() => setAllergyHold(null)} title="A manager’s PIN" line={`${allergyHold.label} has an allergy the kitchen hasn’t noted. Ask the kitchen to tap Allergy noted, or a manager hands it over. It’s kept on record.`} />}
    {appPin?.app && <PinPad check={appPinCheck} onDone={() => setAppPin(null)} onClose={() => setAppPin(null)} title={pinTitle(pinOwner)} line={`The kitchen started on ${appPin.app.label} ${appPin.app.code}, so ${pinOwner ? 'the owner' : 'a manager'} okays taking it off. It doesn’t change who’s signed in here.`} />}
    {deliveryPin && <PinPad check={deliveryPinCheck} onDone={() => setDeliveryPin(null)} onClose={() => setDeliveryPin(null)} title={pinTitle(pinOwner)} line={deliveryPin.line} />}
    {discountPin && <PinPad check={discountPinCheck} onDone={() => setDiscountPin(null)} onClose={() => setDiscountPin(null)} title={pinTitle(pinOwner)} line={`Another amount off takes ${pinOwner ? 'the owner' : 'a manager'}: ${discountPin.kind === 'pct' ? `${discountPin.value}%` : usd(discountPin.value / 100)} for “${discountPin.reason}”. It doesn’t change who’s signed in here.`} />}
    {codeFor && order && <CodeOnSheet code={codeFor} scaleNo={codeScale} orderId={order.id} menu={menu} call={post} onClose={() => setCodeFor(null)} onDone={(text) => { setCodeFor(null); setNotice({ text, tone: 'good' }); acted.current++; void load(); }} />}
    {drawerOpen && <DrawerSheet call={post} onClose={() => setDrawerOpen(false)} onDone={(text) => { setDrawerOpen(false); setNotice({ text, tone: 'good' }); }}
      photo={(set) => <ImageUpload onImageUploaded={set} label="Add a photo" enableMarkup={false} storageFolder="uploads" maxWidthOrHeight={1400} />} />}
    {priceFor && order && (() => { const l = order.lines.find((x) => x.lineId === priceFor); return l ? <PriceSheet orderId={order.id} number={order.number} line={l as any} whole={order.status !== 'building'} call={post}
      onClose={() => setPriceFor(null)} onDone={(text, d) => { setPriceFor(null); if (d.order && lane) setLane((x) => (x ? { ...x, orders: { ...x.orders, [d.order.id]: { ...(x.orders[d.order.id] || {}), ...d.order } } } : x)); setNotice({ text, tone: 'good' }); acted.current++; void load(); }} /> : null; })()}
    {compFor && order && (() => { const l = order.lines.find((x) => x.lineId === compFor); return l ? <CompSheet orderId={order.id} number={order.number} line={l} whole={order.status !== 'building'} call={post}
      onClose={() => setCompFor(null)} onDone={(text, d) => { setCompFor(null); if (d.order && lane) setLane((x) => (x ? { ...x, orders: { ...x.orders, [d.order.id]: { ...(x.orders[d.order.id] || {}), ...d.order } } } : x)); setNotice({ text, tone: 'good' }); acted.current++; void load(); }} /> : null; })()}
    {takeOffFor && order && (() => { const l = order.lines.find((x) => x.lineId === takeOffFor); return l ? <TakeOffSheet orderId={order.id} number={order.number} line={l} max={order.lines.length > 1 ? l.quantity : l.quantity - 1} call={post}
      onClose={() => setTakeOffFor(null)} onDone={(text, d) => { setTakeOffFor(null); if (d.order && lane) setLane((x) => (x ? { ...x, orders: { ...x.orders, [d.order.id]: { ...(x.orders[d.order.id] || {}), ...d.order } } } : x)); setNotice({ text, tone: 'good' }); acted.current++; void load(); }} /> : null; })()}
    {weighFor && order && (() => { const p = pickedOf(weighFor.m.choices, weighFor.picks); return <WeightSheet name={weighFor.m.name} unit={weighFor.m.byWeight!} price={weighFor.m.priceNow ?? weighFor.m.price} extra={p.extra} choicesText={p.text} onClose={() => setWeighFor(null)}
      add={async (weight) => { const d = await post({ action: 'add', orderId: order.id, itemId: weighFor.m.id, choices: weighFor.picks, quantity: 1, tapKey: rid(), weight, ...(weighFor.note?.trim() ? { note: weighFor.note.trim() } : {}) }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d.ok) return d.error || 'That didn’t go through. Try again.'; setWeighFor(null); setNotice({ text: `${weighFor.m.name} added.`, tone: 'good' }); acted.current++; void load(); return null; }} />; })()}
    {giftOpen && order && <GiftSheet amounts={lane?.gift?.amounts || []} onClose={() => setGiftOpen(false)} add={addGift} />}
    {oneOffOpen && order && <OneOffSheet max={lane?.oneOffMax || 0} onClose={() => setOneOffOpen(false)} add={addOneOff} />}
    {refundOpen && <RefundFind call={post} onClose={() => setRefundOpen(false)} onDone={(text) => { setRefundOpen(false); setNotice({ text, tone: 'good' }); acted.current++; void load(); }} />}
    {partPin && <PinPad check={partPinCheck} onDone={() => setPartPin(null)} onClose={() => setPartPin(null)} title={pinTitle(pinOwner)} line={`Giving back ${usd(partPin.cents / 100)} ${partPin.kind === 'cash' ? 'in cash, out of the drawer' : 'to their card'} takes ${pinOwner ? 'the owner' : 'a manager'}. It doesn’t change who’s signed in here.`} />}
    {staffPin && staffFor !== null && <PinPad check={staffPinCheck} onDone={() => setStaffPin(false)} onClose={() => setStaffPin(false)} title={pinTitle(pinOwner)} line={`It rings in the staff meal for ${staffFor.trim() || 'them'}. It doesn’t change who’s signed in here.`} />}
    {pointsOpen && order && <PointsSheet name={order.guestName || ''} busy={busy === 'points' || busy === 'rewardsCode'} codes={!!lane?.rewardsCodes} onClose={() => setPointsOpen(false)}
      onCode={(code) => new Promise<string | null>((res) => { void act('rewardsCode', { action: 'rewardsCode', orderId: order.id, code }, (d) => {
        setPointsOpen(false); setMember(memberFrom(order.id, d.member)); setNotice({ text: d.earned ? `Rewards added for ${d.member?.name || 'them'}: earned ${d.earned}.` : `Rewards added for ${d.member?.name || 'them'}.`, tone: 'good' }); res(null);
      }, (d) => { res(d.error || 'That didn’t go through.'); return true; }); })}
      onLink={(phone, join, name) => new Promise<string | null>((res) => { void act('points', { action: 'points', orderId: order.id, phone, join, name }, (d) => {
        setPointsOpen(false); setNotice({ text: d.already ? 'Rewards were already on this order.' : d.earned ? `Rewards added: earned ${d.earned} ${d.unit}.` : 'Rewards added. It earns when it’s paid.', tone: 'good' }); res(null);
      }, (d) => { res(d.code === 'not_found' || d.code === 'not_member' ? d.code : d.error || 'That didn’t go through.'); return true; }); })} />}
    {choiceFor && <ChoiceSheet item={choiceFor} onClose={() => setChoiceFor(null)} onAdd={(p, q, note) => { add(choiceFor, p, q, choiceOffer ? 'item' : undefined, undefined, note); setChoiceFor(null); }} />}
  </>);
}
