'use client';

// ─── src/app/shop/[tenantId]/checkout/page.tsx ──────────────────────────────
// Checkout as a PAGE, not an overlay. The sheet-based cart produced a class
// of failures no fix fully closed: a dimming backdrop with no panel, on
// mobile AND desktop, eating every tap. A page cannot fail that way — there
// is no portal, no backdrop, no enter/exit animation, no state that can
// strand a customer under a dim. Back from Stripe lands on an ordinary page.
// Cart contents live in localStorage (shop-cart) and are shared with the
// storefront, so nothing about adding to cart changed.

import { IF_UNAVAILABLE, type IfUnavailable } from '@/lib/retail-swap';
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, CalendarClock, Loader, Minus, Package, Plus, Store, Truck, X,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  cartExpiresAt, clearCart, parseCartKey, readCart, readWholesaleCode,
  touchCartExpiry, writeCart, writeWholesaleCode,
} from '@/lib/shop-cart';
import { shopLine } from '@/lib/variants';
import { formatPromiseDay, preorderNotice } from '@/lib/preorder-terms';
import {
  arrivalLabel, busyLineFor, dayLabel, leadSentence, normalizeSchedule, orderPromise, processingSentence, type PromiseLine,
} from '@/lib/ship-promise';
import { addDays, dayKey } from '@/lib/tenant-time';
import { cn } from '@/lib/utils';
import { AddressReviewPanel, useAddressReview, type ReviewAddress } from '@/components/shop/AddressReview';

type Method = 'counter' | 'curbside' | 'ship';

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });


export default function CheckoutPage() {
  const params = useParams<{ tenantId: string }>();
  const search = useSearchParams();
  const tenantId = String(params?.tenantId || '');
  const { toast } = useToast();

  const [shop, setShop] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [wholesaleCode, setWholesaleCode] = useState('');
  const wholesale = shop?.wholesaleUnlocked === true;

  // Cart — same persisted store the shop writes; hydrate then mirror back.
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartHydrated, setCartHydrated] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setCart(readCart(tenantId));
    setCartHydrated(true);
  }, [tenantId]);

  useEffect(() => {
    if (tenantId && cartHydrated) writeCart(tenantId, cart);
  }, [tenantId, cart, cartHydrated]);

  // Cart hold: keep the timer honest here too, since this page may be the
  // only one open while a customer fills the form.
  const [holdLeft, setHoldLeft] = useState<number | null>(null);
  const holdMinutes = shop?.cartHoldMinutes || 0;

  useEffect(() => {
    if (!tenantId || !cartHydrated || holdMinutes <= 0) return;
    if (Object.values(cart).some((q) => q > 0)) touchCartExpiry(tenantId, holdMinutes);
  }, [tenantId, cart, cartHydrated, holdMinutes]);

  useEffect(() => {
    if (!tenantId || holdMinutes <= 0) { setHoldLeft(null); return; }
    const tick = () => {
      const exp = cartExpiresAt(tenantId);
      if (exp === null) { setHoldLeft(null); return; }
      const left = exp - Date.now();
      if (left <= 0) {
        clearCart(tenantId);
        setCart({});
        setHoldLeft(null);
        toast({ title: 'Cart expired', description: 'Items were released — stock moves fast. Re-add anything you still want.' });
        return;
      }
      setHoldLeft(left);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, holdMinutes, cartHydrated]);

  const holdLabel = holdLeft != null
    ? `${Math.floor(holdLeft / 60000)}:${String(Math.floor((holdLeft % 60000) / 1000)).padStart(2, '0')}`
    : null;

  // Checkout form
  const [method, setMethod] = useState<Method>('counter');
  // Starts on a way the shop offers: pickup when it's on, otherwise curbside or shipping.
  useEffect(() => {
    if (!shop) return;
    const on = (m: Method) => (m === 'counter' ? shop.pickupOffered !== false : m === 'curbside' ? !!shop.curbsideOffered : !!shop.shippingOffered);
    if (!on(method)) { const first = (['counter', 'curbside', 'ship'] as Method[]).find(on); if (first) setMethod(first); }
  }, [shop, method]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [addr, setAddr] = useState({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '' });
  const [placing, setPlacing] = useState(false);
  const [tipPct, setTipPct] = useState<number>(0);
  const [applyCredit, setApplyCredit] = useState(false);
  const [giftCode, setGiftCode] = useState(''); const [giftOpen, setGiftOpen] = useState(false);   // a gift card from this business
  // A promo code (lib/promo-codes): checked when applied, and again by the server when paying.
  const [promoInput, setPromoInput] = useState(''); const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState<{ code: string; label: string; cents: number; freeShipping: boolean } | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null); const [promoBusy, setPromoBusy] = useState(false);
  const [creditMode, setCreditMode] = useState<'all' | 'limit'>('all');
  const [creditLimit, setCreditLimit] = useState('');
  const [acctEmail, setAcctEmail] = useState('');
  const [acctCreditCents, setAcctCreditCents] = useState<number | null>(null);
  const [acctSess, setAcctSess] = useState<{ e: string; x: number; s: string } | null>(null);

  /* THE BOX EARNS ITS PLACE. Store credit only shows for people who have
   * PROVEN credit: the signed account session (magic link) unlocks a
   * balance check, and the box renders only when that balance is above
   * zero — with the real number on it. No session, or nothing on file, and
   * the checkout stays clean; a guest with credit gets one quiet sign-in
   * hint instead of a speculative checkbox. The server-side cap math is
   * unchanged and still authoritative. */
  useEffect(() => {
    if (!tenantId || typeof window === 'undefined') return;
    let sess: any = null;
    try {
      const raw = localStorage.getItem(`cfshop-acct-${tenantId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.e && parsed?.x && parsed?.s && Date.now() < parsed.x) sess = parsed;
      }
    } catch { sess = null; }
    if (!sess) { setAcctCreditCents(null); return; }
    setAcctEmail(String(sess.e)); setAcctSess({ e: String(sess.e), x: Number(sess.x), s: String(sess.s) });
    setEmail((cur) => cur || String(sess.e));
    fetch(`/api/retail/account/credit?tenantId=${encodeURIComponent(tenantId)}&e=${encodeURIComponent(sess.e)}&x=${sess.x}&s=${encodeURIComponent(sess.s)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAcctCreditCents(d && Number.isFinite(Number(d.creditCents)) ? Number(d.creditCents) : null))
      .catch(() => setAcctCreditCents(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);
  const [pickupChoice, setPickupChoice] = useState('ASAP');
  const [preorderAgreed, setPreorderAgreed] = useState(false);
  const [ifUnavailable, setIfUnavailable] = useState<IfUnavailable>('refund');
  const [isGift, setIsGift] = useState(false); const [giftTo, setGiftTo] = useState(''); const [giftMsg, setGiftMsg] = useState('');

  // Live carrier rates. The server signs every option (amount + service +
  // expiry); the browser only ever sends the chosen option's token back, so
  // a customer picks the SERVICE but can never set the PRICE. Quotes are
  // keyed to the address they were fetched for — edit the address and the
  // stale options disappear instead of quietly mispricing the parcel.
  type ShipQuote = {
    id: string; carrier: string; service: string; amountCents: number; days: number | null; exp: number; token: string;
    facts?: string; shipBy?: string; arriveFrom?: string | null; arriveTo?: string | null;
  };
  const [quotes, setQuotes] = useState<ShipQuote[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState('');
  const [quotedFor, setQuotedFor] = useState('');

  const addrKey = `${addr.line1}|${addr.city}|${addr.state}|${addr.postalCode}`.toLowerCase();
  const addrComplete = Boolean(addr.line1 && addr.city && addr.state && addr.postalCode);
  const quotesFresh = quotes.length > 0 && quotedFor === addrKey;
  const selectedQuote = quotesFresh ? quotes.find((q) => q.id === selectedQuoteId) || null : null;

  // Returning from Stripe restores this page from the back-forward cache
  // with state frozen mid-checkout. On a plain page the only frozen thing
  // is the Pay spinner — reset it so the button is immediately usable.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPlacing(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    if (search?.get('canceled') === '1') {
      toast({ title: 'Checkout canceled', description: 'Your cart is still here when you are ready.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catalog — same endpoint the shop uses; the saved wholesale code keeps
  // B2B pricing consistent between the two pages.
  useEffect(() => {
    if (!tenantId) return;
    const savedCode = readWholesaleCode(tenantId);
    const load = async (code: string) => {
      setLoading(true);
      setLoadError('');
      try {
        const qs = new URLSearchParams({ tenantId });
        if (code) qs.set('wholesaleCode', code);
        const res = await fetch(`/api/retail/catalog?${qs.toString()}`);
        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); }
        catch { throw new Error(`The shop backend answered with an unexpected response (HTTP ${res.status}).`); }
        if (!res.ok) throw new Error(data.error || 'Could not load the shop');
        setShop(data.shop);
        // The shop's clock, not the device's: a phone set a few minutes (or a time zone) off would otherwise show a
        // ship-by date the order isn't stored with.
        { const t = Date.parse(String(data.shop?.serverNow || '')); setClockOffset(Number.isFinite(t) ? t - Date.now() : 0); }
        setProducts(data.products);
        if (code) setWholesaleCode(code);
        return true;
      } catch (e: any) {
        if (code) return false;
        setLoadError(e?.message || 'Could not load the shop');
        return false;
      } finally {
        setLoading(false);
      }
    };
    if (savedCode) {
      load(savedCode).then((ok) => {
        if (!ok) { writeWholesaleCode(tenantId, ''); load(''); }
      });
    } else {
      load('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const byId = useMemo(() => new Map(products.map((p: any) => [p.id, p])), [products]);


  const cartEntries = Object.entries(cart).filter(([key, q]) => q > 0 && byId.has(parseCartKey(key).productId));
  const cartCount = cartEntries.reduce((a, [, q]) => a + q, 0);
  // Something in the cart the shop doesn't list any more (a variant added on its own before it was sold inside its
  // listing, a product taken off the shop) is taken out, and they're told, so the cart badge and this page agree.
  const [dropped, setDropped] = useState(0);
  useEffect(() => {
    if (!cartHydrated || loading || loadError || !products.length) return;
    const gone = Object.keys(cart).filter((k) => !byId.has(parseCartKey(k).productId));
    if (!gone.length) return;
    setCart((c) => { const n = { ...c }; gone.forEach((k) => delete n[k]); return n; });
    setDropped((d) => d + gone.length);
  }, [cartHydrated, loading, loadError, products]);   // eslint-disable-line react-hooks/exhaustive-deps
  // What each cart line sells for, the same sums the server makes when the order is placed (lib/variants): a variant's
  // own price when it has one, otherwise the listing's, plus what the other choices add; and how the chosen variant
  // sells (a pre-order, a download, made to order: its own, else the listing's).
  const lineOf = (key: string) => { const { productId, selections } = parseCartKey(key); const p: any = byId.get(productId); return p ? shopLine(p, selections, wholesale) : null; };
  // A cart of nothing-but-digital has no parcel and no pickup: asking for a
  // delivery method (or an address) reads as a broken shop, and that's where
  // abandoned carts come from. The server already accepts this shape.
  const digitalOnlyCart = cartEntries.length > 0 && cartEntries.every(([key]) => lineOf(key)?.digital === true);

  // ── PRE-ORDERS IN THE CART ────────────────────────────────────────────────
  // A pre-order is the one thing in a cart that is not what it looks like:
  // the customer is paying today for something that is not on the shelf. The
  // FTC rule treats the ship-by date as a disclosure that must be made BEFORE
  // payment, not a detail to discover in a confirmation email — so it is
  // stated here, in the cart, and the order cannot be placed until it is
  // ticked. Derived AFTER cartEntries so the read is never above its source.
  const preorderItems = cartEntries
    .map(([key, qty]) => {
      const prod: any = byId.get(parseCartKey(key).productId); const l = lineOf(key);
      return l?.preorder?.open === true
        ? { name: [String(prod?.name || 'Item'), l.variantChoice?.label].filter(Boolean).join(' \u00b7 '), etaAt: l.preorder.etaAt || null, qty }
        : null;
    })
    .filter(Boolean) as { name: string; etaAt: string | null; qty: number }[];

  const hasPreorder = preorderItems.length > 0;
  const preorderKey = preorderItems.map((i) => `${i.name}|${i.etaAt}|${i.qty}`).join('~');

  // ── SHIP-BY DATES (lib/ship-promise) ──────────────────────────────────────
  // Sent by the shop only once it shows dates. Worked out here from the cart as it stands and the rate chosen, by the
  // same calculation the order is placed with, so the dates on this page are the dates in their email. The clock
  // ticks so a date moves by itself at the cutoff while they're filling the form in.
  const shipSched = useMemo(() => (shop?.shipSchedule ? normalizeSchedule(shop.shipSchedule) : null), [shop]);
  const shopZone = String(shop?.timeZone || 'UTC');
  const [clockOffset, setClockOffset] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    if (!shipSched) return;
    setClock(new Date(Date.now() + clockOffset));
    const t = setInterval(() => setClock(new Date(Date.now() + clockOffset)), 30_000);
    return () => clearInterval(t);
  }, [shipSched, clockOffset]);
  // After the server says the date moved, the date it named (they were just told it) is the one sent next time, until
  // anything that decides the date changes.
  const [serverShipBy, setServerShipBy] = useState('');
  const promiseLines: PromiseLine[] = cartEntries.map(([key]) => {
    const l = lineOf(key);
    return { digital: l?.digital === true, preorder: l?.preorder?.open === true, preorderEtaAt: l?.preorder?.etaAt || null, leadDays: l?.leadDays || null };
  });
  const datesFor = (carrier: string | null, service: string, days: number | null) =>
    shipSched ? orderPromise({ at: clock, timeZone: shopZone, schedule: shipSched, lines: promiseLines, carrier, service, transitDays: days }) : null;
  // 'Thu' within the coming week, 'Fri, Oct 30' further out, so a weekday alone is never a week off.
  const shipDay = (day: string) => (day <= addDays(dayKey(clock, shopZone), 6) ? dayLabel(day, shopZone).split(',')[0] : dayLabel(day, shopZone));
  const leadNote = [...new Set(cartEntries.map(([key]) => leadSentence(lineOf(key)?.leadDays || null)).filter(Boolean))][0] || '';



  // Agreeing to a March 3 promise is not agreeing to an April 3 one. If the
  // pre-ordered items change AFTER the tick, the tick is withdrawn — an
  // acknowledgement that survives the thing it acknowledged is worthless as
  // a record and unfair as a term.
  useEffect(() => {
    setPreorderAgreed(false);
  }, [preorderKey]);

  const subtotalCents = cartEntries.reduce((a, [key, q]) => a + (lineOf(key)?.unitCents || 0) * q, 0);
  const tipCents = shop?.tipsEnabled && tipPct > 0 ? Math.round((subtotalCents * tipPct) / 100) : 0;
  // With the choices, so the server knows which variant each line is (a code made for one variant still applies).
  const promoLines = () => cartEntries.map(([key, q]) => { const k = parseCartKey(key); return { productId: k.productId, selections: k.selections, qty: q, unitPriceCents: lineOf(key)?.unitCents || 0 }; });
  const applyPromo = async (code: string) => {
    const c = code.trim(); if (!c) return;
    setPromoBusy(true); setPromoErr(null);
    try {
      const r = await fetch('/api/retail/promo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, code: c, items: promoLines(), email: email.trim() }) });
      const j: any = await r.json().catch(() => ({}));
      if (j?.ok) { setPromo({ code: j.code, label: j.label, cents: Number(j.cents) || 0, freeShipping: !!j.freeShipping }); setPromoInput(j.code); }
      else { setPromo(null); setPromoErr(j?.error || 'That code can’t be used.'); }
    } catch { setPromoErr('We couldn’t check that code. Please try again.'); }
    setPromoBusy(false);
  };
  // The cart changed: check the code again so the total shown is the total charged.
  const promoCartKey = cartEntries.map(([k, q]) => `${k}:${q}`).join('|');
  useEffect(() => { if (promo) void applyPromo(promo.code); }, [promoCartKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const promoCents = promo?.cents || 0;

  /** Live rates for the address. `keep` re-selects the same carrier and service when it's still offered (a refresh of
   *  rates about to expire must not quietly switch the service they chose); otherwise the cheapest is picked. */
  const fetchQuotes = async (keep?: { carrier: string; service: string } | null) => {
    if (!addrComplete || quoting) return;
    setQuoting(true);
    try {
      const res = await fetch('/api/retail/shipping-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          items: cartEntries.map(([key, qty]) => ({ ...parseCartKey(key), qty })),
          address: { line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postalCode: addr.postalCode },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not fetch shipping options');
      const opts: ShipQuote[] = Array.isArray(data.options) ? data.options : [];
      if (opts.length === 0) throw new Error('No shipping options came back — the flat rate applies.');
      setQuotes(opts);
      setQuotedFor(addrKey);
      const cheapest = [...opts].sort((a, b) => a.amountCents - b.amountCents)[0];
      const same = keep ? opts.find((o) => o.carrier === keep.carrier && o.service === keep.service) : null;
      setSelectedQuoteId((same || cheapest).id);
    } catch (e: any) {
      setQuotes([]);
      setQuotedFor('');
      toast({ title: 'Shipping options', description: e?.message || 'Live rates unavailable — the flat rate applies.' });
    } finally {
      setQuoting(false);
    }
  };

  const freeOverCents = Math.round((shop?.freeShippingOverDollars || 0) * 100);
  const freeQualified = freeOverCents > 0 && subtotalCents >= freeOverCents;

  // The dates the order will be placed with: the chosen rate's carrier and estimate, or the shop's own shipping when
  // the order qualifies for free shipping or no rate is chosen (the same rule checkout applies). Worked out on every
  // render, so they move the moment the clock passes a cutoff.
  const ownShipping = freeQualified || !selectedQuote;
  const chosenDates = shipSched && method === 'ship' && !digitalOnlyCart
    ? datesFor(ownShipping ? null : selectedQuote!.carrier, ownShipping ? 'Standard shipping' : selectedQuote!.service, ownShipping ? null : selectedQuote!.days)
    : null;
  const noticeDeadline = chosenDates?.deadlineAt || '';
  const dateInputsKey = `${cartEntries.map(([k, q]) => `${k}:${q}`).join('|')}~${method}~${selectedQuote?.id || ''}~${freeQualified}`;
  useEffect(() => { setServerShipBy(''); }, [dateInputsKey]);
  const notice = useMemo(
    () => {
      if (!hasPreorder) return null;
      // With dates on, the pre-order notice names the order's own ship-by date (the latest pre-order date, or later
      // when the rest of the order takes longer), the same one the order is stored with.
      return preorderNotice({ items: preorderItems, ...(noticeDeadline ? { promiseAt: noticeDeadline, timeZone: shopZone } : {}) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPreorder, preorderKey, noticeDeadline, shopZone]
  );
  // The date they agreed to moved (the cutoff passed, or another rate was picked): the tick goes, like a changed cart.
  const noticeDate = notice?.promiseAt || '';
  const agreedDate = React.useRef(noticeDate);
  useEffect(() => {
    if (agreedDate.current && noticeDate && agreedDate.current !== noticeDate) setPreorderAgreed(false);
    agreedDate.current = noticeDate;
  }, [noticeDate]);

  const shippingCents = useMemo(() => {
    if (digitalOnlyCart || method !== 'ship' || !shop) return 0;
    if (freeQualified) return 0;
    if (selectedQuote) return selectedQuote.amountCents;
    return Math.round((shop.flatShippingDollars || 0) * 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, shop, subtotalCents, selectedQuote, freeQualified]);

  const setQty = (p: any, qty: number, cartKey?: string) => {
    const clamped = Math.max(0, Math.min(qty, cartKey ? lineOf(cartKey)?.qtyAvailable ?? p.qtyAvailable : p.qtyAvailable));
    const key = cartKey || p.id;
    setCart((c) => {
      const next = { ...c, [key]: clamped };
      if (clamped === 0) delete next[key];
      return next;
    });
  };

  // Per product, as the server counts them: a listing's variants count together toward its minimum.
  const minIssues = wholesale
    ? ([...cartEntries.reduce((m, [id, q]) => { const pid = parseCartKey(id).productId; m.set(pid, (m.get(pid) || 0) + q); return m; }, new Map<string, number>())]
        .map(([pid, q]) => {
          const p = byId.get(pid)!;
          return p.wholesaleMinQty && q < p.wholesaleMinQty
            ? `${p.name}: minimum ${p.wholesaleMinQty}`
            : null;
        })
        .filter(Boolean) as string[])
    : [];

  const canPlace =
    cartCount > 0 && name.trim() && email.trim() && minIssues.length === 0 &&
    (!hasPreorder || preorderAgreed) &&
    (digitalOnlyCart || method !== 'ship' || (addr.name && addr.line1 && addr.city && addr.state && addr.postalCode));

  // ── The address, checked with the carrier before they pay (components/shop/AddressReview) ──
  // Only when something is worth asking: the carrier's version differs in a way that matters, an apartment number looks
  // missing, or the carrier can't find it. Otherwise they go straight on to payment. The signed check travels with the
  // order, so checkout doesn't ask the carrier again. Picking the carrier's version or adding a unit keeps the
  // shipping option already chosen.
  const shipsToAddress = method === 'ship' && !digitalOnlyCart;
  const setAddrKeepingRate = (a: ReviewAddress) => {
    const next = { ...addr, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode };
    if (quotesFresh) setQuotedFor(`${next.line1}|${next.city}|${next.state}|${next.postalCode}`.toLowerCase());
    setAddr(next);
  };
  const ar = useAddressReview(tenantId, (o) => { void placeOrder({ token: o.token, unitAnswer: o.unitAnswer, address: { ...addr, ...o.address, name: addr.name } }); }, setAddrKeepingRate);
  useEffect(() => { ar.setReview(null); }, [addrKey, addr.line2]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = async () => {
    if (!canPlace || placing || ar.checking) return;
    // A rate is good for 30 minutes. One about to run out is fetched again first, so the price and the dates they pay
    // for are the ones on the screen, never a quiet switch to the flat rate.
    if (method === 'ship' && selectedQuote && Date.now() + clockOffset > selectedQuote.exp - 60_000) {
      await fetchQuotes({ carrier: selectedQuote.carrier, service: selectedQuote.service });
      toast({ title: 'Shipping options refreshed', description: 'They’d been open a while. Please check them and pay again.' });
      return;
    }
    if (!shipsToAddress) { void placeOrder(); return; }
    await ar.start({ name: addr.name, line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postalCode: addr.postalCode });
  };
  const editAddress = () => { ar.setReview(null); setTimeout(() => document.getElementById('ship-line1')?.focus(), 0); };

  // One id for this checkout, kept for every retry from this page, so an order paid in full with store credit or a gift
  // card is paid once even when an answer is lost and they tap Pay again (api/retail/checkout).
  const checkoutKey = React.useRef('');
  const placeOrder = async (extra?: { token?: string; unitAnswer?: 'added' | 'none'; address?: typeof addr }) => {
    if (!canPlace || placing) return;
    setPlacing(true);
    if (!checkoutKey.current) {
      try { const b = new Uint8Array(18); crypto.getRandomValues(b); checkoutKey.current = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
      catch { checkoutKey.current = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 40); }
    }
    try {
      const res = await fetch('/api/retail/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          items: cartEntries.map(([key, qty]) => ({ ...parseCartKey(key), qty })),
          tipCents,
          pickupAt: !digitalOnlyCart && method !== 'ship' && shop?.scheduledPickup ? pickupChoice : '',
          method: digitalOnlyCart ? 'counter' : method,
          applyStoreCredit: applyCredit,
          creditSession: applyCredit ? acctSess : undefined,
          giftCode: giftCode.trim() || undefined,
          promoCode: promo?.code || undefined,
          storeCreditCapCents: applyCredit && creditMode === 'limit' && Number(creditLimit) > 0
            ? Math.round(Number(creditLimit) * 100)
            : undefined,
          preorderAck: hasPreorder ? true : undefined,
          // The ship-by date the pre-order notice showed, so the order is never stored with a different one.
          preorderShownAt: hasPreorder ? notice?.promiseAt || undefined : undefined,
          shownShipBy: chosenDates ? (serverShipBy && serverShipBy !== chosenDates.shipBy ? serverShipBy : chosenDates.shipBy) : undefined,
          ifUnavailable: digitalOnlyCart ? undefined : ifUnavailable,
          gift: !digitalOnlyCart && isGift ? { isGift: true, to: giftTo.trim(), message: giftMsg.trim() } : undefined,
          customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
          shippingAddress: method === 'ship' && !digitalOnlyCart ? { ...(extra?.address || addr), country: 'US' } : undefined,
          addressCheckToken: method === 'ship' && !digitalOnlyCart && extra?.token ? extra.token : undefined,
          unitAnswer: method === 'ship' && !digitalOnlyCart ? extra?.unitAnswer : undefined,
          shippingQuote: method === 'ship' && selectedQuote
            ? { amountCents: selectedQuote.amountCents, service: selectedQuote.service, carrier: selectedQuote.carrier, exp: selectedQuote.exp, token: selectedQuote.token, days: selectedQuote.days, facts: selectedQuote.facts }
            : undefined,
          priceTier: wholesale ? 'wholesale' : 'retail',
          wholesaleCode: wholesale ? wholesaleCode : undefined,
          business: wholesale ? { name: businessName.trim(), poNumber: poNumber.trim() } : undefined,
          checkoutKey: checkoutKey.current,
        }),
      });
      const raw = await res.text();
      let data: any = {};
      try { data = JSON.parse(raw); } catch { /* non-JSON reply handled below */ }
      if (!res.ok) {
        if (data.promoError) { setPromo(null); setPromoErr(data.error || null); }
        if (data.needsPreorderAck) setPreorderAgreed(false);
        // The ship-by date moved while they were paying: the screen catches up, and the date named is the one sent.
        if (data.datesChanged) { setClock(new Date(Date.now() + clockOffset)); setServerShipBy(String(data.shipBy || '')); }
        throw new Error(data.error || `Checkout failed (HTTP ${res.status})`);
      }
      window.location.href = data.url;
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Checkout problem', description: e?.message || 'Please try again.' });
      setPlacing(false);
    }
  };

  if (loading && !shop) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Loading checkout</span>
      </div>
    );
  }

  if (loadError || !shop) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-bold">{loadError || 'Could not load the shop'}</p>
        <Button asChild variant="outline" className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
          <Link href={`/shop/${tenantId}`}>Back to shop</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
      <div className="mb-4 flex h-14 items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to shop" className="h-10 w-10 shrink-0 rounded-xl">
          <Link href={`/shop/${tenantId}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <h1 className="text-xl font-black uppercase tracking-tighter">Checkout</h1>
        {holdLabel && cartEntries.length > 0 && (
          <div className="ml-auto rounded-xl border-2 border-primary/30 bg-primary/5 px-3 py-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-primary">Held </span>
            <span className="font-black font-mono text-xs text-primary tabular-nums">{holdLabel}</span>
          </div>
        )}
      </div>

      {cartEntries.length === 0 ? (
        <div className="space-y-4 py-24 text-center">
          <Package className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Your cart is empty
          </p>
          {dropped > 0 && <p role="status" className="mx-auto max-w-sm text-[12px] font-bold text-muted-foreground">What was in it isn’t in the shop any more, so it was taken out. A product that comes in variants is chosen on its own page.</p>}
          <Button asChild className="rounded-2xl font-black uppercase text-[10px] tracking-widest">
            <Link href={`/shop/${tenantId}`}>Browse the shop</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {dropped > 0 && (
            <p role="status" className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-bold text-amber-900">
              {dropped === 1 ? 'Something in your cart isn’t in the shop any more, so it was taken out.' : `${dropped} things in your cart aren’t in the shop any more, so they were taken out.`} A product that comes in variants is chosen on its own page.
            </p>
          )}
          <div className="space-y-3">
            {cartEntries.map(([id, qty]) => {
              const parsedKey = parseCartKey(id);
              const optInfo = lineOf(id) || { label: '', unitCents: 0, stale: false };
              const p = byId.get(parsedKey.productId)!;
              return (
                <div key={id} className="flex items-center gap-3 rounded-2xl border-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-black uppercase tracking-tight text-xs truncate">{p.name}</p>
                    {optInfo.label && (
                      <p className="text-[8px] font-black uppercase tracking-widest text-primary truncate">{optInfo.label}</p>
                    )}
                    {optInfo.stale && (
                      <p className="text-[10px] font-bold text-amber-700">That choice isn’t offered any more. Remove it and choose again on its page.</p>
                    )}
                    {lineOf(id)?.preorder?.open === true && (
                      <p className="text-[8px] font-black uppercase tracking-widest text-amber-700">
                        {`Pre-order${lineOf(id)?.preorder?.etaAt ? ` \u00b7 ships by ${formatPromiseDay(lineOf(id)!.preorder.etaAt)}` : ''}`}
                      </p>
                    )}
                    <p className="text-[10px] font-bold text-primary">{fmt(optInfo.unitCents)} each</p>
                    {wholesale && p.wholesaleMinQty ? (
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        Min {p.wholesaleMinQty} wholesale
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon" aria-label={`Decrease quantity of ${p.name}`} className="h-8 w-8 rounded-lg border-2" onClick={() => setQty(p, qty - 1, id)}>
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <span className="w-8 text-center font-black font-mono text-sm">{qty}</span>
                    <Button variant="outline" size="icon" aria-label={`Increase quantity of ${p.name}`} className="h-8 w-8 rounded-lg border-2" onClick={() => setQty(p, qty + 1, id)}>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${p.name} from cart`} className="h-8 w-8" onClick={() => setQty(p, 0, id)}>
                    <X className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>

          {minIssues.length > 0 && (
            <div className="rounded-2xl border-2 border-destructive/20 bg-destructive/5 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-destructive mb-1">Wholesale minimums</p>
              {minIssues.map((m) => (
                <p key={m} className="text-xs font-bold text-destructive/80">{m}</p>
              ))}
            </div>
          )}

          {digitalOnlyCart && (
            <div className="rounded-2xl border-2 border-primary/30 bg-primary/[0.04] p-3">
              <p className="text-[10px] font-black uppercase tracking-widest">Instant access</p>
              <p className="text-[11px] font-bold text-muted-foreground">
                Nothing ships. The moment you pay, everything opens in your library and lands in your email.
              </p>
            </div>
          )}

          <div className={cn('space-y-2', digitalOnlyCart && 'hidden')}>
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">How would you like it?</Label>
            <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
              {([
                { id: 'counter' as Method, label: 'Pickup', icon: Store, show: shop.pickupOffered !== false },
                { id: 'curbside' as Method, label: shop.curbsideMode === 'drive_thru' ? 'Drive-Thru' : 'Curbside', icon: Package, show: shop.curbsideOffered },
                { id: 'ship' as Method, label: 'Ship', icon: Truck, show: shop.shippingOffered },
              ]).filter((m) => m.show).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={method === m.id}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    'rounded-2xl border-2 p-3 flex flex-col items-center gap-1.5 transition-all',
                    method === m.id ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'hover:border-primary/30'
                  )}
                >
                  <m.icon className={cn('h-4 w-4', method === m.id ? 'text-primary' : 'opacity-40')} aria-hidden="true" />
                  <span className="text-[9px] font-black uppercase tracking-widest">{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your details</Label>
            <Input placeholder="Full name" aria-label="Full name" autoComplete="name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            <Input placeholder="Email" aria-label="Email" autoComplete="email" type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            <Input placeholder="Phone (optional)" aria-label="Phone, optional" autoComplete="tel" type="tel" value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
          </div>

          {wholesale && (
            <div className="space-y-3">
              <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Business</Label>
              <Input placeholder="Business name" aria-label="Business name" autoComplete="organization" value={businessName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusinessName(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <Input placeholder="PO number (optional)" aria-label="PO number, optional" autoComplete="off" value={poNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPoNumber(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            </div>
          )}

          {method === 'ship' && !digitalOnlyCart && (
            <div className="space-y-3">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ship to</Label>
              <Input placeholder="Recipient name" aria-label="Recipient name" autoComplete="name" value={addr.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, name: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <Input id="ship-line1" placeholder="Street address" aria-label="Street address" autoComplete="address-line1" value={addr.line1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, line1: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <Input placeholder="Apt / suite (optional)" aria-label="Apartment or suite, optional" autoComplete="address-line2" value={addr.line2} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, line2: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
                <Input placeholder="City" aria-label="City" autoComplete="address-level2" value={addr.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, city: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm col-span-1" />
                <Input placeholder="State" aria-label="State" autoComplete="address-level1" value={addr.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, state: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                <Input placeholder="ZIP" aria-label="ZIP code" autoComplete="postal-code" inputMode="numeric" value={addr.postalCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, postalCode: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              </div>

              {shipSched && (!quotesFresh || freeQualified) && (() => {
                const p = datesFor(null, 'Standard shipping', null);
                return p ? (
                  <p className="text-[12px] font-bold">
                    Ships by {dayLabel(p.shipBy, shopZone)}{p.arriveFrom ? ` · arrives ${arrivalLabel(p, shopZone)}` : ''}
                    {!freeQualified && <span className="text-muted-foreground"> with standard shipping</span>}
                  </p>) : null;
              })()}
              {shipSched && (() => {
                // For the option they've picked (its own dates), else the shop's standard shipping.
                const p = selectedQuote && !freeQualified ? datesFor(selectedQuote.carrier, selectedQuote.service, selectedQuote.days) : datesFor(null, 'Standard shipping', null);
                const line = busyLineFor(p, shipSched, 'product', shopZone);
                return line ? <p className="text-[12px] font-bold text-muted-foreground">{line}</p> : null;
              })()}
              {freeQualified ? (
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                  Free shipping — this order qualifies
                </p>
              ) : !quotesFresh ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!addrComplete || quoting}
                  onClick={() => void fetchQuotes()}
                  className="h-11 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                >
                  {quoting ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Get shipping options'}
                </Button>
              ) : (
                <div className="space-y-2" role="radiogroup" aria-label="Shipping options">
                  {quotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedQuoteId === q.id}
                      onClick={() => setSelectedQuoteId(q.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all',
                        selectedQuoteId === q.id ? 'border-primary bg-primary/5' : 'hover:border-primary/30'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[10px] font-black uppercase tracking-widest">{q.carrier} · {q.service}</span>
                        {shipSched ? (() => {
                          const p = datesFor(q.carrier, q.service, q.days);
                          return p ? (
                            <span className="block text-[11px] font-bold text-muted-foreground">
                              Ships by {shipDay(p.shipBy)}{p.arriveFrom ? ` · arrives ${arrivalLabel(p, shopZone)}` : ''}
                            </span>) : null;
                        })() : q.days != null && (
                          <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            ~{q.days} day{q.days === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-black font-mono text-sm">{q.amountCents === 0 ? 'Free' : fmt(q.amountCents)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setQuotes([]); setQuotedFor(''); setSelectedQuoteId(''); }}
                    className="text-[9px] font-black uppercase tracking-widest text-muted-foreground underline underline-offset-2"
                  >
                    Refresh options
                  </button>
                </div>
              )}
              {shipSched && (
                <p className="text-[11px] font-bold text-muted-foreground">
                  {processingSentence(shipSched, clock, shopZone)}{leadNote ? ` ${leadNote}` : ''}
                </p>)}
            </div>
          )}

          {notice && (
            <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">{notice.headline}</p>
              </div>
              <ul className="space-y-1">
                {notice.itemLines.map((l) => (
                  <li key={l} className="text-[11px] font-black uppercase tracking-tight text-amber-900">{l}</li>
                ))}
              </ul>
              <ul className="space-y-1.5">
                {notice.bullets.map((b) => (
                  <li key={b} className="text-[11px] font-bold leading-relaxed text-amber-900/80">{b}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2.5 rounded-xl border-2 border-amber-300 bg-white/70 p-3">
                <input
                  type="checkbox"
                  checked={preorderAgreed}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPreorderAgreed(e.target.checked)}
                  aria-label={notice.agreeLabel}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-current"
                />
                <span className="text-[11px] font-bold leading-relaxed text-amber-900">{notice.agreeLabel}</span>
              </label>
            </div>
          )}

          <div className="space-y-3 rounded-2xl border-2 p-5">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <span>Subtotal</span><span className="font-mono">{fmt(subtotalCents)}</span>
            </div>
            {promo && promoCents > 0 && (
              <div className="flex justify-between text-xs font-bold tracking-widest" style={{ color: '#1f7a4d' }}>
                <span>{promo.label}</span><span className="font-mono">−{fmt(promoCents)}</span>
              </div>
            )}
            {method === 'ship' && !digitalOnlyCart && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <span>Shipping</span>
                <span className="font-mono">{shippingCents === 0 || promo?.freeShipping ? (promo?.freeShipping && shippingCents > 0 ? `Free with ${promo.code}` : 'Free') : fmt(shippingCents)}</span>
              </div>
            )}
            {method !== 'ship' && (shop.prepMinutes || 0) > 0 && (
              <p className="text-[9px] font-black uppercase tracking-widest text-primary">
                Usually ready in ~{shop.prepMinutes} min
              </p>
            )}
            {method !== 'ship' && shop.scheduledPickup && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pickup time</span>
                <select aria-label="Pickup time" value={pickupChoice}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPickupChoice(e.target.value)}
                  className="h-9 rounded-xl border-2 bg-white px-2 text-[10px] font-black uppercase tracking-widest">
                  {['ASAP', 'In ~15 min', 'In ~30 min', 'In ~45 min', 'In ~1 hour'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            {!digitalOnlyCart && (
              <div className="space-y-1.5" role="radiogroup" aria-label="If something is out of stock">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">If something is out of stock</span>
                {IF_UNAVAILABLE.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={ifUnavailable === o.id} onClick={() => setIfUnavailable(o.id)}
                    className={cn('flex w-full items-start gap-2.5 rounded-2xl border-2 p-3 text-left transition-all', ifUnavailable === o.id ? 'border-foreground/60 bg-muted/20' : 'bg-white')}>
                    <span className={cn('mt-0.5 h-4 w-4 shrink-0 rounded-full border-2', ifUnavailable === o.id ? 'border-[5px] border-foreground' : 'border-muted-foreground/40')} />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-black uppercase tracking-widest">{o.label}</span>
                      <span className="block text-[11px] font-bold text-muted-foreground">{o.id === 'ask' ? (phone.trim() ? 'We text you a suggestion. No answer in 2 hours means a refund.' : 'We email you a suggestion. Add a phone number above to get a text instead.') : o.note}</span>
                    </span>
                  </button>))}
              </div>
            )}
            {!digitalOnlyCart && (
              <div className="space-y-2 rounded-2xl border-2 bg-white p-3">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input type="checkbox" checked={isGift} onChange={(e) => setIsGift(e.target.checked)} className="h-4 w-4" />
                  <span className="text-[11px] font-black uppercase tracking-widest">This is a gift</span>
                </label>
                {isGift && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-muted-foreground">No prices go in the box. They get a gift slip with your message, and can exchange it for shop credit without you being told.</p>
                    <input aria-label="Who it’s for" value={giftTo} maxLength={60} onChange={(e) => setGiftTo(e.target.value)} placeholder="Who it’s for (first name is fine)" className="h-10 w-full rounded-xl border-2 bg-white px-3 text-sm" />
                    <textarea aria-label="Gift message" value={giftMsg} maxLength={300} onChange={(e) => setGiftMsg(e.target.value)} placeholder="Your message (optional)" rows={3} className="w-full rounded-xl border-2 bg-white px-3 py-2 text-sm" />
                    <p className="text-right text-[10px] font-bold text-muted-foreground">{giftMsg.length}/300</p>
                  </div>)}
              </div>
            )}
            {acctCreditCents === null && (
              <p className="text-[10px] font-bold text-muted-foreground">
                Have store credit?{' '}
                <a href={`/shop/${tenantId}/account`} className="font-black uppercase tracking-widest text-foreground underline underline-offset-4">
                  Sign in
                </a>{' '}
                to see and use your balance.
              </p>
            )}
            {acctCreditCents !== null && acctCreditCents > 0 && (
            <div className={cn('rounded-2xl border-2 p-3 transition-all', applyCredit && 'border-foreground/60 bg-muted/20')}>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  aria-label={`Apply my store credit — $${(acctCreditCents / 100).toFixed(2)} available`}
                  checked={applyCredit}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApplyCredit(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-current"
                />
                <span className="text-[11px] font-bold leading-relaxed text-muted-foreground">
                  <span className="font-black uppercase tracking-widest text-foreground">
                    Apply my store credit — ${(acctCreditCents / 100).toFixed(2)} available
                  </span>
                  <br />Tied to {acctEmail} — the discount appears on the payment page.
                </span>
              </label>
              {applyCredit && (
                <div className="mt-3 space-y-2 pl-6">
                  <div className="flex gap-1.5" role="radiogroup" aria-label="How much store credit to use">
                    <button
                      type="button" role="radio" aria-checked={creditMode === 'all'}
                      onClick={() => setCreditMode('all')}
                      className={cn('h-9 flex-1 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all',
                        creditMode === 'all' ? 'bg-foreground text-background border-foreground' : 'bg-white')}
                    >
                      Use all of it
                    </button>
                    <button
                      type="button" role="radio" aria-checked={creditMode === 'limit'}
                      onClick={() => setCreditMode('limit')}
                      className={cn('h-9 flex-1 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all',
                        creditMode === 'limit' ? 'bg-foreground text-background border-foreground' : 'bg-white')}
                    >
                      Set a limit
                    </button>
                  </div>
                  {creditMode === 'limit' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black">$</span>
                      <input
                        inputMode="decimal"
                        aria-label="Most store credit to use on this order, in dollars"
                        placeholder={acctCreditCents !== null ? (acctCreditCents / 100).toFixed(2) : "10.00"}
                        value={creditLimit}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreditLimit(e.target.value.replace(/[^0-9.]/g, ''))}
                        className="h-10 w-28 rounded-xl border-2 bg-white px-3 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60"
                      />
                      <span className="text-[10px] font-bold leading-tight text-muted-foreground">
                        at most — the rest of your credit stays on your account
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] font-bold text-muted-foreground">
                    We only ever apply what you actually have — never more than ${(acctCreditCents / 100).toFixed(2)}{creditMode === 'limit' ? ', your limit,' : ''} or the order total.
                  </p>
                </div>
              )}
            </div>
            )}
            {!wholesale && (
            <div className={cn('rounded-2xl border-2 p-3 transition-all', promo && 'border-foreground/60 bg-muted/20')}>
              {!promoOpen && !promo ? <button type="button" onClick={() => setPromoOpen(true)} className="text-[11px] font-black uppercase tracking-widest underline underline-offset-4">Have a promo code?</button> : promo ? (
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] text-white" style={{ background: '#1f7a4d' }}>✓</span>
                  <span className="min-w-0 flex-1 text-[13px]"><b className="font-semibold">{promo.code}</b> · {promo.freeShipping ? 'free shipping' : `${fmt(promoCents)} off`}</span>
                  <button type="button" onClick={() => { setPromo(null); setPromoInput(''); setPromoErr(null); }} className="text-[12px] underline underline-offset-4">Remove</button>
                </div>
              ) : <>
                <label htmlFor="promo-code" className="block text-[11px] font-black uppercase tracking-widest">Promo code</label>
                <div className="mt-1.5 flex gap-2">
                  <input id="promo-code" value={promoInput} onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyPromo(promoInput); } }}
                    placeholder="Enter code" autoCapitalize="characters" autoComplete="off" aria-invalid={!!promoErr} aria-describedby={promoErr ? 'promo-err' : undefined}
                    className="h-10 min-w-0 flex-1 rounded-xl border-2 bg-white px-3 font-mono text-sm font-bold tracking-widest outline-none focus:border-foreground/60" />
                  <button type="button" disabled={!promoInput.trim() || promoBusy} onClick={() => void applyPromo(promoInput)} className="h-10 shrink-0 rounded-xl bg-foreground px-4 text-[12px] font-bold text-background disabled:opacity-50">{promoBusy ? 'Checking…' : 'Apply'}</button>
                </div>
                {promoErr && <p id="promo-err" role="alert" className="mt-1.5 text-[12px] font-bold" style={{ color: '#b45309' }}>{promoErr}</p>}
              </>}
            </div>
            )}
            <div className={cn('rounded-2xl border-2 p-3 transition-all', giftCode.trim() && 'border-foreground/60 bg-muted/20')}>
              {!giftOpen ? <button type="button" onClick={() => setGiftOpen(true)} className="text-[11px] font-black uppercase tracking-widest underline underline-offset-4">Have a gift card?</button> : <>
                <label className="block text-[11px] font-black uppercase tracking-widest">Gift card code</label>
                <input value={giftCode} onChange={(e) => setGiftCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" aria-label="Gift card code" autoCapitalize="characters"
                  className="mt-1.5 h-10 w-full rounded-xl border-2 bg-white px-3 font-mono text-sm font-bold tracking-widest outline-none focus:border-foreground/60" />
                <p className="mt-1.5 text-[10px] font-bold text-muted-foreground">Its balance comes off before you pay. If it covers everything, there’s nothing to pay by card.</p></>}
            </div>
            {shop.tipsEnabled && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tip</span>
                <div className="flex gap-1">
                  {[0, 10, 15, 20].map((pct) => (
                    <button key={pct} type="button" aria-pressed={tipPct === pct}
                      aria-label={pct === 0 ? 'No tip' : `Tip ${pct} percent`}
                      onClick={() => setTipPct(pct)}
                      className={cn('h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                        tipPct === pct ? 'bg-foreground text-background border-foreground' : 'bg-white')}>
                      {pct === 0 ? 'None' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tipCents > 0 && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <span>Tip</span>
                <span className="font-mono">{fmt(tipCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              <span>Tax</span><span>Calculated at checkout</span>
            </div>
            <Separator />
            {ar.review ? (
              <AddressReviewPanel ar={ar} busy={placing} continueLabel="Continue to payment" onEdit={editAddress} />
            ) : (
            <Button
              disabled={!canPlace || placing || ar.checking}
              onClick={() => void pay()}
              className="w-full h-14 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-primary/20"
            >
              {placing || ar.checking ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : `Pay ${fmt(Math.max(0, subtotalCents - promoCents) + (promo?.freeShipping ? 0 : shippingCents) + tipCents)} + tax`}
            </Button>)}
            <p className="text-[9px] font-bold uppercase tracking-widest text-center text-muted-foreground/60">
              {method === 'ship' && !digitalOnlyCart ? 'Secure payment · Tracking on your order page' : digitalOnlyCart ? 'Secure payment · Opens the moment you pay' : <>Secure payment &middot; You&apos;ll get a pickup QR code</>}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
