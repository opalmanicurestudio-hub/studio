'use client';
// src/app/concierge/[tenantId]/page.tsx — ORDER FROM YOUR SEAT: the lounge menu on a station tablet, or on a guest's
// own phone from the station's QR code (/concierge/{tenant}?booth={id}&k={signature}, or ?seat=…). Nothing here needs a
// sign-in: the menu, the guest's perks and card, and the order all go through the server (api/concierge/requests and
// api/booths/kiosk), which decides what's included, what's charged and to whom.
//   Menu → how many → where to bring it → how to pay → placed, with its status as it's made.
//   Covered on its own when it can be: a club perk with enough left, the host's complimentary allowance, or a renter's
//   station card. Otherwise: the guest's card on file, adding it to their visit, their day stay's card, or paying when
//   it arrives. Anything that uses someone's account needs the code texted to their phone first.
//   One order keeps one name (orderKey) until it's placed or turned down, so a retry is never a second order or a second
//   charge; a card payment still being checked is only ever tried on the card again.
//   A shared tablet forgets the guest, and what they typed, after a few quiet minutes or when they tap Sign out.

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { defaultPicks, priceChoices, startingPrice, type Picks } from '@/lib/menu-choices';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const QUIET_MS = 8 * 60000;          // a shared tablet forgets the guest after this long untouched
const WATCH_MS = 45 * 60000;         // how long the done screen keeps checking an order's status

type Item = { id: string; name: string; price: number; section: string; words: string | null; imageUrl: string | null; membersOnly: boolean; available: boolean; soldOut?: boolean; choices?: any[] };
type Biz = { name: string; accent: string | null; logoUrl: string | null };
type Guest = { firstName: string; member: boolean; membershipName: string | null; card: { brand: string; last4: string } | null };
type Stay = { payerType: 'renter' | 'reservation'; reservationId?: string; boothName: string; cardOnFile: boolean; amenityPayer: 'renter' | 'client'; compAllowance: number };
type Step = 'menu' | 'details' | 'pay' | 'phone' | 'code' | 'done';
type Settle = 'card_on_file' | 'balance' | 'desk' | 'stay';

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const STATUS: Record<string, { label: string; note: string; step: number }> = {
  pending: { label: 'Sent', note: 'We’ve got your order.', step: 1 },
  in_progress: { label: 'Being made', note: 'It’s being made for you now.', step: 2 },
  ready: { label: 'Ready', note: 'It’s ready, and someone will bring it over.', step: 3 },
  on_its_way: { label: 'On its way', note: 'Someone is bringing it to you now.', step: 3 },
  delivered: { label: 'Delivered', note: 'Enjoy.', step: 4 },
  cancelled: { label: 'Canceled', note: 'This order was canceled. If that’s a surprise, ask anyone on the team.', step: 0 },
};
const showPhone = (p: string) => (!p ? '' : p.length <= 3 ? `(${p}` : p.length <= 6 ? `(${p.slice(0, 3)}) ${p.slice(3)}` : `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`);
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'M';
const lum = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** Text that reads on the business's color: whichever of white or ink stands out more against it. */
const onColor = (hex: string) => (contrast(lum(hex), 1) >= contrast(lum(hex), lum(INK)) ? '#fff' : INK);

const btn = 'min-h-[52px] rounded-2xl px-5 text-[16px] font-semibold disabled:opacity-50 transition-opacity';
const field = 'w-full mt-1.5 min-h-[48px] rounded-2xl px-4 text-[16px] bg-white border border-[#ececee] outline-none focus:border-[#16171a]';
const linkBtn = 'min-h-[44px] px-2 text-[15px] font-semibold underline underline-offset-4';

function StationMenu() {
  const { tenantId } = useParams() as { tenantId: string };
  const sp = useSearchParams();
  const seatParam = (sp.get('seat') || '').slice(0, 20);
  const boothParam = sp.get('booth') || '';
  const stationToken = sp.get('k') || '';
  const startWhere = seatParam ? `Seat ${seatParam}` : '';

  const [biz, setBiz] = useState<Biz | null>(null);
  const [menu, setMenu] = useState<Item[] | null>(null);
  const [menuErr, setMenuErr] = useState('');
  const [section, setSection] = useState('');
  const [step, setStep] = useState<Step>('menu');
  const [pick, setPick] = useState<{ item: Item; qty: number } | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('');
  const [where, setWhere] = useState(startWhere);
  const [stationWhere, setStationWhere] = useState('');
  const [lookFor, setLookFor] = useState('');
  const [note, setNote] = useState('');
  const [settle, setSettle] = useState<Settle>('desk');
  const [notice, setNotice] = useState('');
  const [good, setGood] = useState('');
  const [busy, setBusy] = useState(false);
  // The guest, once the texted code proves it's them: their pass, first name, perks and card.
  const [phone, setPhone] = useState('');
  const [pass, setPass] = useState('');
  const [guest, setGuest] = useState<Guest | null>(null);
  const [perks, setPerks] = useState<Record<string, number>>({});
  const [perksUsed, setPerksUsed] = useState<Record<string, number>>({});
  const [codeAsk, setCodeAsk] = useState<{ codeId: string; sentTo: string; back: Step; thenOrder: boolean } | null>(null);
  const [resumeOrder, setResumeOrder] = useState(false);
  const [resumeWith, setResumeWith] = useState<{ pass: string; perkBefore: boolean } | null>(null);
  const [code, setCode] = useState('');
  // Who pays at this station: its renter, a day guest checked in at it, or (after the code) the guest's own day stay.
  const [stationStay, setStationStay] = useState<Stay | null>(null);
  const [ownStay, setOwnStay] = useState<Stay | null>(null);
  const [stationFailed, setStationFailed] = useState(false);   // this order only: the station or stay card said no
  const [cardLocked, setCardLocked] = useState(false);         // this order only: a card payment is still being checked
  const [linkOld, setLinkOld] = useState(false);
  const [compUsed, setCompUsed] = useState(0);
  const [done, setDone] = useState<{ requestId: string; summary: string; item: string; at: number } | null>(null);
  const [status, setStatus] = useState('pending');
  const orderKey = useRef('');
  const sending = useRef(false);
  const lastTouch = useRef(Date.now());
  const doneRef = useRef<any>(null); const statusRef = useRef('pending');
  const heading = useRef<HTMLHeadingElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  doneRef.current = step === 'done' ? done : null; statusRef.current = status;
  const stay = stationStay || ownStay;
  const accent = biz?.accent || INK;
  const onAccent = onColor(accent);
  const post = (url: string, body: any) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) as any }), () => ({ status: 0, d: {} as any }));
  const api = (body: any) => post('/api/concierge/requests', { tenantId, ...body });

  // The menu, from the server: no sign-in, and nothing about cost or stock counts.
  useEffect(() => {
    fetch(`/api/concierge/requests?tenantId=${encodeURIComponent(tenantId)}&menu=1`).then((r) => r.json()).then((d) => {
      if (!d?.ok) { setMenuErr(d?.error || 'The menu couldn’t load. Please ask anyone on the team.'); return; }
      setBiz(d.business); setMenu(d.menu || []);
    }).catch(() => setMenuErr('The menu couldn’t load. Check the connection and try again.'));
  }, [tenantId]);

  const toStay = (d: any, payerType: Stay['payerType']): Stay => ({ payerType, reservationId: d.reservationId, boothName: String(d.boothName || 'your station'),
    cardOnFile: !!d.cardOnFile, amenityPayer: d.amenityPayer === 'client' ? 'client' : 'renter', compAllowance: Math.max(0, Number(d.amenityCompAllowance) || 0) });

  // A station's own link: who pays for orders here.
  useEffect(() => {
    if (!boothParam) return;
    post('/api/booths/kiosk', { action: 'active-stay', tenantId, boothId: boothParam, stationToken: stationToken || undefined }).then(({ d }) => {
      setLinkOld(!!(d?.ok && d.linkNeedsUpdate));
      if (d?.ok && d.found) setStationStay(toStay(d, d.payerType === 'reservation' ? 'reservation' : 'renter'));
      if (d?.ok && d.boothName && !seatParam) { setStationWhere(String(d.boothName)); setWhere((w) => w || String(d.boothName)); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, boothParam, stationToken, seatParam]);

  /** A new order: its own name, and nothing carried over from the last one's payment. */
  const freshOrder = () => { orderKey.current = ''; setStationFailed(false); setCardLocked(false); };
  const signOut = useCallback(() => {
    setGuest(null); setPass(''); setPhone(''); setPerks({}); setPerksUsed({}); setOwnStay(null); setName(''); setCodeAsk(null); setCode('');
    setResumeOrder(false); setResumeWith(null); setLookFor(''); setNote(''); setSettle('desk'); setGood('');
    setWhere(startWhere || stationWhere); orderKey.current = ''; setStationFailed(false); setCardLocked(false);
  }, [startWhere, stationWhere]);
  // A shared tablet: forget the guest, what they typed and the last order after a few quiet minutes.
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    window.addEventListener('pointerdown', touch, { passive: true }); window.addEventListener('keydown', touch);
    const i = setInterval(() => {
      if (Date.now() - lastTouch.current <= QUIET_MS) return;
      lastTouch.current = Date.now(); signOut(); setPick(null); setSheet(false); setNotice('');
      // An order still on its way keeps its status on screen (a guest on their own phone is waiting for it), with
      // nothing about how it was paid; one that's arrived goes, and the menu is back.
      const open = !!doneRef.current && !['delivered', 'cancelled'].includes(statusRef.current) && Date.now() - Number(doneRef.current.at || 0) < WATCH_MS;
      if (open) setDone((x) => (x ? { ...x, summary: 'We’ll bring it over.' } : x)); else { setDone(null); setStep('menu'); }
    }, 30000);
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); clearInterval(i); };
  }, [signOut]);

  // Each new step starts at the top, with its heading read out.
  useEffect(() => { window.scrollTo({ top: 0 }); if (step !== 'menu') heading.current?.focus({ preventScroll: true }); }, [step]);

  const perkLeft = (id: string) => Math.max(0, (Number(perks[id]) || 0) - (Number(perksUsed[id]) || 0));
  const sections = useMemo(() => Array.from(new Set((menu || []).map((i) => i.section))), [menu]);
  useEffect(() => { if (!section && sections.length) setSection(sections[0]); }, [sections, section]);
  const shown = (menu || []).filter((i) => !section || i.section === section);

  // What covers an order on its own (no choice to make): a perk with enough left, the host's allowance, the renter's card.
  // Its choices (size, milk, extras) add to the price, worked out the same way the server will (lib/menu-choices).
  const priced = pick ? priceChoices(pick.item, picks) : null;
  const each = pick ? Math.max(0, Math.round((pick.item.price + (priced && priced.ok ? priced.extra : 0)) * 100) / 100) : 0;
  const total = pick ? Math.round(each * pick.qty * 100) / 100 : 0;
  // A perk or the host's allowance covers the item as it comes, not choices that add to the price.
  const extras = !!priced && priced.ok && priced.extra > 0;
  const isPerk = !!pick && !extras && perkLeft(pick.item.id) >= pick.qty;
  const hostComp = !extras && !!stationStay && stationStay.payerType === 'renter' && stationStay.compAllowance > 0 && compUsed < stationStay.compAllowance;
  const stationPays = !!stationStay && stationStay.payerType === 'renter' && stationStay.amenityPayer === 'renter' && stationStay.cardOnFile && !stationFailed;
  const covered = !pick || total <= 0 || isPerk || (hostComp && !cardLocked) || (stationPays && !cardLocked);
  const canStay = !!stay && stay.payerType === 'reservation' && stay.cardOnFile && !stationFailed;
  const cardOk = !!guest?.card && total >= 0.5;

  const askForCode = async (ph: string, back: Step, thenOrder: boolean) => {
    setNotice(''); setCode(''); setBusy(true);
    const { d } = await api({ action: 'send-code', phone: ph });
    setBusy(false);
    if (!d?.ok || !d.codeId) { setNotice(d?.error || 'We couldn’t send a code. You can pay when it arrives.'); return; }
    setCodeAsk({ codeId: String(d.codeId), sentTo: String(d.sentTo || 'your phone'), back, thenOrder }); setStep('code');
  };

  const confirmCode = async () => {
    if (!codeAsk || code.length !== 6 || busy) return;
    setBusy(true); setNotice('');
    const { d } = await api({ action: 'check-code', phone, codeId: codeAsk.codeId, code });
    if (!d?.ok || !d.pass) { setBusy(false); setNotice(d?.error || 'That code doesn’t match. Check it and try again.'); return; }
    const p = String(d.pass); setPass(p);
    const [g, s] = await Promise.all([
      api({ action: 'guest', phone, pass: p }),
      boothParam ? Promise.resolve(null) : post('/api/booths/kiosk', { action: 'active-stay', tenantId, phone: `+1${phone}`, guestPass: p }),
    ]);
    if (g.d?.ok) { setPerks(g.d.perkRemaining || {}); setPerksUsed({}); if (g.d.guest) { setGuest(g.d.guest); setName((n) => n || g.d.guest.firstName); } }
    if (s?.d?.ok && s.d.found) { setOwnStay(toStay(s.d, 'reservation')); setStationFailed(false); }
    setBusy(false);
    const ask = codeAsk; setCodeAsk(null); setCode(''); setResumeOrder(false); setStep(ask.back);
    // The order that asked for the code goes on once what the code unlocked is on screen (the effect below).
    if (ask.thenOrder) setResumeWith({ pass: p, perkBefore: isPerk });
  };

  const choose = (item: Item, el: HTMLElement) => { if (!item.available) return; opener.current = el; setPick({ item, qty: 1 }); setPicks(defaultPicks(item)); setSheet(true); setNotice(''); setGood(''); };
  const closeSheet = () => { setSheet(false); setTimeout(() => opener.current?.focus(), 0); };
  const toDetails = () => { setSheet(false); freshOrder(); setStep('details'); };

  const toPay = () => {
    if (!name.trim() && !guest) { setNotice('Add your name so we know who it’s for.'); return; }
    if (!where.trim()) { setNotice('Tell us where you are, so we can bring it over.'); return; }
    setNotice(''); setGood('');
    if (covered) { void placeOrder(); return; }
    setSettle(cardOk ? 'card_on_file' : canStay ? 'stay' : guest ? 'balance' : 'desk');
    setStep('pay');
  };

  /** Needs the texted code before it can go on: ask for their number (or send the code to the one we have). */
  const needCode = async (msg: string) => {
    if (phone.length === 10) { await askForCode(phone, 'pay', true); return; }
    setResumeOrder(true); setNotice(msg); setStep('phone');
  };

  // The order, written by the server. A station or stay charge is made first and the order names it; anything that uses
  // the guest's account asks for the texted code, then this same order goes on (the same order name, so never twice).
  const placeOrder = async (freshPass?: string) => {
    if (!pick || sending.current) return;
    const p = freshPass || pass;
    const { item, qty } = pick;
    const viaStation = total > 0 && !isPerk && !hostComp && stationPays && !cardLocked;
    const viaStay = total > 0 && !isPerk && !hostComp && !viaStation && settle === 'stay' && canStay;
    if (viaStay && !p) { await needCode('Enter your mobile number, and we’ll text you a code to use the card on your booking.'); return; }
    sending.current = true; setBusy(true); setNotice(''); setGood('');
    if (!orderKey.current) orderKey.current = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      let stationOrderId: string | undefined;
      let s: string;
      if (isPerk) s = 'perk';
      else if (total > 0 && hostComp && !cardLocked) s = 'renter_comp';
      else if (viaStation || viaStay) {
        const { status: st, d } = await post('/api/booths/kiosk', {
          action: 'charge', tenantId, payer: viaStation ? 'station' : 'stay', boothId: boothParam || undefined, stationToken: stationToken || undefined,
          ...(viaStay ? { reservationId: stay?.reservationId, phone: `+1${phone}`, guestPass: p || undefined } : {}),
          itemId: item.id, quantity: qty, choices: picks, amountCents: Math.round(total * 100), orderKey: orderKey.current });
        if (!d?.ok) {
          if (d?.needsCode) { sending.current = false; setBusy(false); await needCode(d.error || 'Enter the code we text to your phone.'); return; }
          // Still going through, or no answer: the same order, tried again, is the same charge.
          if (!st || st >= 500 || d?.busy) { setNotice(d?.error || 'We couldn’t confirm the charge. Nothing was ordered yet; try again in a moment.'); if (step !== 'pay' && !viaStation) setStep('pay'); return; }
          // Said no (declined, no card, too many charges for now, the price just changed): that card is off the table for
          // this order; choose another way.
          orderKey.current = ''; setStationFailed(true); setSettle(cardOk ? 'card_on_file' : guest ? 'balance' : 'desk');
          setNotice(d?.error || 'That card didn’t go through. Choose another way to pay.'); setStep('pay'); return;
        }
        stationOrderId = d.orderId; s = 'station';
      } else s = total > 0 ? settle : 'desk';
      const { status: st, d } = await api({ itemId: item.id, quantity: qty, choices: picks, clientName: (name || guest?.firstName || 'Guest').slice(0, 60),
        phone: guest && phone ? `+1${phone}` : undefined, boothId: boothParam || undefined,
        reservationId: stay?.payerType === 'reservation' ? stay.reservationId : undefined,
        stationName: (where || stay?.boothName || 'Lounge').slice(0, 60), guestDescription: lookFor, notes: note,
        settle: s, orderKey: orderKey.current, stationOrderId, stationToken: stationToken || undefined, guestPass: p || undefined });
      if (!d?.ok) {
        if (d?.needsCode) { sending.current = false; setBusy(false); await needCode(d.error || 'Enter the code we text to your phone.'); return; }
        if (d?.restart) { freshOrder(); setNotice(d.error); if (!covered) setStep('pay'); return; }
        if (d?.sameWay) { setCardLocked(true); setSettle('card_on_file'); setNotice(d.error); setStep('pay'); return; }
        if (d?.declined) { orderKey.current = ''; setSettle(guest ? 'balance' : 'desk'); setStep('pay'); setNotice(d.error); return; }
        if (d?.compUsedUp) {
          orderKey.current = ''; setCompUsed(stationStay?.compAllowance || 99);
          // The renter pays for orders here: it goes on the station instead, and they're told.
          if (stationPays) { setGood('Today’s complimentary orders are used, so this one goes on the station.'); setResumeWith({ pass: p, perkBefore: isPerk }); return; }
          setNotice(`${d.error} Choose how you’d like to pay.`); setStep('pay'); return;
        }
        setNotice(d?.error || (!st || st >= 500 ? 'We couldn’t confirm it. Nothing was ordered yet; try again in a moment.' : 'That didn’t go through. Please ask anyone on the team.'));
        return;
      }
      orderKey.current = ''; setCardLocked(false); setStationFailed(false);
      if (s === 'perk') setPerksUsed((u) => ({ ...u, [item.id]: (Number(u[item.id]) || 0) + qty }));
      if (s === 'renter_comp') setCompUsed((n) => n + 1);
      const summary = s === 'station' ? (viaStay ? `${money(total)} charged to the card on your booking.` : `Charged to ${stay?.boothName || 'the station'}.`)
        : s === 'renter_comp' ? `On the house, courtesy of ${stay?.boothName || 'your host'}.`
        : s === 'perk' ? `Included with your ${guest?.membershipName || 'membership'}.`
        : d.settledBy === 'card_on_file' ? `${money(total)} charged to your ${guest?.card?.brand || 'card'}${guest?.card?.last4 ? ` ending ${guest.card.last4}` : ''}.`
        : d.settledBy === 'balance' ? `${money(total)} added to your visit. Settle it when you check out.`
        : total > 0 ? `${money(total)} to pay when we bring it over.` : 'On us.';
      setDone({ requestId: String(d.requestId || ''), summary, item: `${item.name}${qty > 1 ? ` × ${qty}` : ''}${priced && priced.ok && priced.text ? `, ${priced.text}` : ''}`, at: Date.now() }); setStatus('pending'); setStep('done');
      setNote(''); setLookFor('');
    } finally { sending.current = false; setBusy(false); }
  };

  // After the code: the waiting order goes on, now that the guest's perks and card are on screen. If the code turned up
  // a membership that covers it, they're told and place it themselves (it's no longer what they chose to pay with).
  useEffect(() => {
    if (!resumeWith || busy) return;
    const r = resumeWith; setResumeWith(null);
    if (isPerk && !r.perkBefore) { setStep('details'); setGood('Good news: this one is included with your membership. Place the order when you’re ready.'); return; }
    void placeOrder(r.pass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeWith, busy, isPerk]);

  // The placed order's status, until it's delivered (or for 45 minutes): often at first, then less often.
  useEffect(() => {
    if (step !== 'done' || !done?.requestId) return;
    let stop = false; let timer: any = null;
    const tick = async () => {
      if (stop || Date.now() - done.at > WATCH_MS) return;
      try {
        const d = await fetch(`/api/concierge/requests?tenantId=${encodeURIComponent(tenantId)}&order=${encodeURIComponent(done.requestId)}`, { cache: 'no-store' }).then((r) => r.json());
        if (!stop && d?.ok && d.status) {
          const s = d.status === 'ready' && d.onItsWay ? 'on_its_way' : String(d.status);
          setStatus(s); if (s === 'delivered' || s === 'cancelled') return;
        }
      } catch { /* the next try */ }
      if (!stop) timer = setTimeout(tick, Date.now() - done.at < 5 * 60000 ? 8000 : 20000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [step, done, tenantId]);

  // The quantity sheet: focus inside it, Escape closes it, Tab stays in it, and the page behind can't be reached.
  useEffect(() => {
    const page = pageRef.current; if (!sheet) { page?.removeAttribute('inert'); return; }
    page?.setAttribute('inert', '');
    const box = sheetRef.current; const first = box?.querySelector<HTMLElement>('[data-autofocus]') || box?.querySelector<HTMLElement>('button');
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab' || !box) return;
      const els = Array.from(box.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href]')); if (!els.length) return;
      const a = els[0], z = els[els.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); page?.removeAttribute('inert'); };
  }, [sheet]);

  // ─── Pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const primary = (label: React.ReactNode, onClick: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={`${btn} w-full`} style={{ background: accent, color: onAccent }}>{label}</button>
  );
  const back = (to: Step) => <button type="button" onClick={() => { setNotice(''); setGood(''); setResumeOrder(false); setStep(to); }} className={linkBtn} style={{ color: INK }}>Back</button>;
  const noticeBox = <div role="alert" aria-live="assertive">{notice && <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>{notice}</p>}</div>;
  const goodBox = good && <p role="status" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: GREEN_TINT, color: GREEN }}>{good}</p>;
  const panel = 'rounded-3xl bg-white p-5 sm:p-6 space-y-4 border border-[#ececee]';
  const h2 = (text: React.ReactNode, extra?: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3"><h2 ref={heading} tabIndex={-1} className="text-[21px] font-semibold leading-tight outline-none" style={{ color: INK }}>{text}</h2>{extra}</div>
  );
  const signedIn = !!guest || !!pass;
  const headerWhere = where || stay?.boothName || '';

  const header = (
    <header className="bg-white px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-[#ececee] sticky top-0 z-30">
      {biz?.logoUrl
        ? <img src={biz.logoUrl} alt="" className="h-11 w-11 rounded-2xl object-cover" />
        : <span className="h-11 w-11 rounded-2xl flex items-center justify-center text-[15px] font-semibold" style={{ background: accent, color: onAccent }} aria-hidden>{initials(biz?.name || '')}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold leading-tight truncate" style={{ color: INK }}>{biz?.name || 'Menu'}</p>
        <p className="text-[13.5px] truncate" style={{ color: MUTED }}>{headerWhere ? `Ordering to ${headerWhere}` : 'Order from your seat'}</p>
      </div>
      {signedIn
        ? <div className="flex items-center gap-1">
            <span className="rounded-full px-3 py-1.5 text-[13.5px] font-semibold max-w-[120px] truncate" style={{ background: GREEN_TINT, color: GREEN }}>{guest ? `Hi, ${guest.firstName}` : 'Signed in'}</span>
            <button type="button" onClick={() => { signOut(); setNotice(''); if (step === 'phone' || step === 'code' || step === 'pay') setStep(pick ? 'details' : 'menu'); }} className={linkBtn} style={{ color: MUTED }}>Sign out</button>
          </div>
        : step !== 'phone' && step !== 'code' && step !== 'done' && <button type="button" onClick={() => { setNotice(''); setResumeOrder(false); setStep('phone'); }} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold border border-[#ececee] bg-white" style={{ color: INK }}>Sign in</button>}
    </header>
  );

  let body: React.ReactNode = null;

  if (step === 'menu') body = (
    <div className="space-y-4">
      <h1 className="sr-only">{biz?.name ? `${biz.name} menu` : 'Menu'}</h1>
      {noticeBox}{goodBox}
      {linkOld && <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>This station’s link is out of date, so nothing can go on the station from it. You can still order and pay when it arrives. Ask the front desk for the new link.</p>}
      {guest?.member && <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: GREEN_TINT, color: GREEN }}>Your {guest.membershipName || 'membership'} is on. Anything it covers says Included.</p>}
      {!guest?.member && hostComp && <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: GREEN_TINT, color: GREEN }}>Your host at {stationStay?.boothName} is treating you. Your next order is on the house.</p>}
      {menuErr ? <p className="rounded-3xl px-5 py-10 text-center text-[15px] bg-white border border-[#ececee]" style={{ color: MUTED }}>{menuErr}</p>
        : !menu ? <div className="flex justify-center py-20"><span className="h-7 w-7 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading the menu" /></div>
        : menu.length === 0 ? <p className="rounded-3xl px-5 py-10 text-center text-[15px] bg-white border border-[#ececee]" style={{ color: MUTED }}>Nothing on the menu right now. Please ask anyone on the team.</p>
        : <>
          {sections.length > 1 && <nav className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" aria-label="Menu sections">{sections.map((s) => (
            <button key={s} type="button" onClick={() => setSection(s)} aria-pressed={section === s} className="shrink-0 min-h-[44px] rounded-full px-5 text-[15px] font-medium"
              style={section === s ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{s}</button>))}</nav>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{shown.map((i) => {
            const left = perkLeft(i.id); const locked = i.membersOnly && !guest?.member;
            return (
              <button key={i.id} type="button" onClick={(e) => choose(i, e.currentTarget)} disabled={!i.available} className="text-left rounded-3xl bg-white overflow-hidden flex border border-[#ececee] disabled:opacity-55 active:scale-[0.99] transition-transform">
                <span className="p-4 flex flex-col gap-1 flex-1 min-w-0">
                  <span className="text-[17px] font-semibold leading-snug" style={{ color: INK }}>{i.name}</span>
                  {i.words && <span className="text-[14px] leading-snug line-clamp-2" style={{ color: MUTED }}>{i.words}</span>}
                  <span className="mt-auto pt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold" style={{ color: left > 0 ? GREEN : INK }}>{!i.available ? 'Sold out' : left > 0 ? 'Included' : startingPrice(i).price > 0 ? `${startingPrice(i).from ? 'from ' : ''}${money(startingPrice(i).price)}` : 'Free'}</span>
                    {locked && i.available && <span className="rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Members</span>}
                    {left > 0 && <span className="text-[13px]" style={{ color: GREEN }}>{left} left this cycle</span>}
                  </span>
                </span>
                {i.imageUrl && <img src={i.imageUrl} alt="" className="w-28 sm:w-32 object-cover shrink-0" />}
              </button>);
          })}</div>
        </>}
    </div>
  );

  if (step === 'details' && pick) body = (
    <div className="space-y-4">
      <div className={panel}>
        {h2(`${pick.item.name}${pick.qty > 1 ? ` × ${pick.qty}` : ''}`,
          <span className="text-[17px] font-semibold shrink-0" style={{ color: isPerk || (hostComp && total > 0) ? GREEN : INK }}>{isPerk ? 'Included' : total <= 0 ? 'Free' : hostComp ? 'On the house' : money(total)}</span>)}
        {!guest && <label className="block"><span className="text-[14.5px] font-medium" style={{ color: INK }}>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoComplete="off" className={field} placeholder="First name" /></label>}
        <label className="block"><span className="text-[14.5px] font-medium" style={{ color: INK }}>Where are you?</span>
          <input value={where} onChange={(e) => setWhere(e.target.value.slice(0, 60))} autoComplete="off" className={field} placeholder="Seat, room or station" /></label>
        <label className="block"><span className="text-[14.5px] font-medium" style={{ color: INK }}>What should we look for? <span className="font-normal" style={{ color: MUTED }}>Optional</span></span>
          <input value={lookFor} onChange={(e) => setLookFor(e.target.value.slice(0, 120))} autoComplete="off" className={field} placeholder="Green coat, by the window" /></label>
        <label className="block"><span className="text-[14.5px] font-medium" style={{ color: INK }}>Anything we should know? <span className="font-normal" style={{ color: MUTED }}>Optional</span></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 240))} rows={2} className={`${field} py-3`} placeholder="Oat milk, no ice, an allergy" /></label>
      </div>
      {goodBox}{noticeBox}
      {primary(busy ? 'Placing your order…' : covered ? 'Place order' : 'Next: how to pay', toPay)}
      <div className="text-center">{back('menu')}</div>
    </div>
  );

  if (step === 'pay' && pick) {
    const options: { id: Settle; title: string; sub: string; show: boolean }[] = [
      { id: 'card_on_file', title: guest?.card ? `${guest.card.brand} ending ${guest.card.last4}` : 'Card on file', sub: 'Charged now', show: cardOk },
      { id: 'stay', title: 'The card on my booking', sub: `Charged to your stay at ${stay?.boothName || 'your station'}`, show: canStay && !cardLocked },
      { id: 'balance', title: 'Add it to my visit', sub: 'Settle it when you check out', show: !!guest && !cardLocked },
      { id: 'desk', title: 'Pay when it arrives', sub: 'Card or cash, when we bring it over', show: !cardLocked },
    ];
    body = (
      <div className="space-y-4">
        <div className={panel}>
          {h2('How would you like to pay?', <span className="text-[18px] font-semibold tabular-nums shrink-0" style={{ color: INK }}>{money(total)}</span>)}
          <fieldset className="space-y-2">
            <legend className="sr-only">How to pay</legend>
            {options.filter((o) => o.show).map((o) => {
              const on = settle === o.id;
              return (
                <label key={o.id} className="w-full rounded-2xl px-4 py-3.5 flex items-center gap-3 bg-white cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#16171a]"
                  style={{ border: on ? `2px solid ${INK}` : `1px solid ${LINE}`, margin: on ? 0 : 1 }}>
                  <input type="radio" name="pay" value={o.id} checked={on} onChange={() => { setSettle(o.id); setNotice(''); }} className="sr-only" />
                  <span className="h-5 w-5 rounded-full shrink-0 box-border" style={{ border: on ? `6px solid ${INK}` : '2px solid #c9cbcf' }} aria-hidden />
                  <span className="min-w-0"><span className="block text-[16px] font-semibold" style={{ color: INK }}>{o.title}</span><span className="block text-[14px]" style={{ color: MUTED }}>{o.sub}</span></span>
                </label>);
            })}
          </fieldset>
          {!signedIn && <p className="text-[14.5px]" style={{ color: MUTED }}>A client here? <button type="button" onClick={() => { setNotice(''); setStep('phone'); }} className="font-semibold underline underline-offset-4 min-h-[44px]" style={{ color: INK }}>Sign in with your phone</button> to use your card or add it to your visit.</p>}
        </div>
        {noticeBox}
        {primary(busy ? 'Placing your order…' : cardLocked ? `Try my card again, ${money(total)}` : `Place order, ${money(total)}`, () => { void placeOrder(); })}
        <div className="text-center">{back('details')}</div>
      </div>
    );
  }

  if (step === 'phone') {
    // Where the code brings them back to: the payment choice when an order is waiting on it, else where they were.
    const after: Step = pick ? (resumeOrder || !covered ? 'pay' : 'details') : 'menu';
    body = (
      <div className="space-y-4">
        <div className={panel}>
          {h2('Your mobile number')}
          <p className="text-[15px]" style={{ color: MUTED }}>We’ll text you a code, so only you can use your membership, card or visit.</p>
          <p className="text-center text-[30px] font-semibold tabular-nums min-h-[48px] pt-1" style={{ color: phone ? INK : '#c9cbcf' }} aria-label={phone ? `Number entered: ${phone.split('').join(' ')}` : 'No number yet'}>{phone ? showPhone(phone) : '(555) 555-5555'}</p>
          <div className="grid grid-cols-3 gap-2 max-w-[320px] mx-auto">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => k === '' ? <span key={i} /> : (
            <button key={i} type="button" onClick={() => setPhone((p) => (k === 'del' ? p.slice(0, -1) : (p + k).slice(0, 10)))} aria-label={k === 'del' ? 'Delete' : k}
              className="h-16 rounded-2xl text-[22px] font-semibold active:scale-[0.97] transition-transform" style={{ background: SOFT, color: INK }}>{k === 'del' ? '⌫' : k}</button>))}</div>
        </div>
        {noticeBox}
        {primary(busy ? 'Sending…' : 'Text me a code', () => { void askForCode(phone, after, resumeOrder); }, phone.length !== 10)}
        <div className="text-center">{back(after)}</div>
      </div>
    );
  }

  if (step === 'code' && codeAsk) body = (
    <div className="space-y-4">
      <div className={panel}>
        {h2('Enter the code')}
        <p className="text-[15px]" style={{ color: MUTED }}>We texted a 6-digit code to {codeAsk.sentTo}.</p>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter') void confirmCode(); }}
          inputMode="numeric" autoComplete="one-time-code" aria-label="The 6-digit code"
          className="w-full min-h-[68px] rounded-2xl text-center text-[32px] font-semibold tracking-[0.35em] bg-white border border-[#ececee] outline-none focus:border-[#16171a]" style={{ color: INK }} placeholder="000000" />
      </div>
      {noticeBox}
      {primary(busy ? 'Checking…' : codeAsk.thenOrder ? 'Continue and place order' : 'Continue', () => { void confirmCode(); }, code.length !== 6)}
      <div className="flex justify-center gap-4"><button type="button" disabled={busy} onClick={() => askForCode(phone, codeAsk.back, codeAsk.thenOrder)} className={linkBtn} style={{ color: INK }}>Send a new code</button>{back(codeAsk.back)}</div>
    </div>
  );

  if (step === 'done' && done) {
    const s = STATUS[status] || STATUS.pending;
    body = (
      <div className="space-y-4">
        <div className="rounded-3xl p-6 space-y-2" style={{ background: accent, color: onAccent }}>
          <p className="text-[14.5px] font-medium">Order placed</p>
          <h2 ref={heading} tabIndex={-1} className="text-[28px] font-semibold leading-tight outline-none">{done.item}</h2>
          <p className="text-[15.5px]">{done.summary}</p>
        </div>
        <div className={panel} aria-live="polite">
          <div className="flex items-baseline justify-between gap-3"><p className="text-[19px] font-semibold" style={{ color: status === 'cancelled' ? AMBER : INK }}>{s.label}</p>{where && <span className="text-[14.5px] truncate" style={{ color: MUTED }}>To {where}</span>}</div>
          {s.step > 0 && <div className="grid grid-cols-4 gap-1.5" aria-hidden>{[1, 2, 3, 4].map((n) => <span key={n} className="h-2 rounded-full transition-colors" style={{ background: n <= s.step ? (s.step === 4 ? GREEN : INK) : LINE }} />)}</div>}
          {s.step > 0 && <div className="grid grid-cols-4 gap-1.5 text-[12.5px]" style={{ color: MUTED }} aria-hidden><span>Sent</span><span>Making</span><span>Ready</span><span className="text-right">Delivered</span></div>}
          <p className="text-[15.5px]" style={{ color: status === 'cancelled' ? AMBER : MUTED }}>{s.note}</p>
        </div>
        <button type="button" onClick={() => { setPick(null); setDone(null); setStep('menu'); }} className={`${btn} w-full bg-white border border-[#ececee]`} style={{ color: INK }}>Order something else</button>
      </div>
    );
  }

  const locked = !!pick && pick.item.membersOnly && !guest?.member;
  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div ref={pageRef} className="min-h-dvh flex flex-col">
        {header}
        <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-5 sm:p-6">{body}</main>
      </div>
      {sheet && pick && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}>
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#fff] overflow-hidden">
            {pick.item.imageUrl && <img src={pick.item.imageUrl} alt="" className="w-full h-48 object-cover" />}
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h2 id="sheet-title" className="text-[22px] font-semibold leading-tight" style={{ color: INK }}>{pick.item.name}</h2>{pick.item.words && <p className="text-[15px] mt-1.5" style={{ color: MUTED }}>{pick.item.words}</p>}</div>
                <button type="button" onClick={closeSheet} aria-label="Close" className="h-11 w-11 rounded-full text-[22px] shrink-0 border border-[#ececee]" style={{ color: INK }}>×</button>
              </div>
              {locked ? <>
                <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>This one is for members. Sign in with your phone to use your membership.</p>
                <button type="button" data-autofocus onClick={() => { setSheet(false); setNotice(''); setPick(null); setStep('phone'); }} className={`${btn} w-full`} style={{ background: accent, color: onAccent }}>Sign in with my phone</button>
              </> : (<>
                {(pick.item.choices || []).length > 0 && <div className="max-h-[46dvh] overflow-y-auto pr-1"><ChoicePicker item={pick.item} picks={picks} onChange={setPicks} accent={accent} /></div>}
                {priced && !priced.ok && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{priced.error}</p>}
                <div className="flex items-center gap-3">
                  <div className="flex items-center rounded-full border border-[#ececee] shrink-0">
                    <button type="button" aria-label="One fewer" disabled={pick.qty <= 1} onClick={() => setPick((p) => p && { ...p, qty: Math.max(1, p.qty - 1) })} className="h-12 w-12 text-[22px] disabled:opacity-35" style={{ color: INK }}>−</button>
                    <span className="min-w-[28px] text-center text-[18px] font-semibold tabular-nums" aria-live="polite" aria-label={`Quantity ${pick.qty}`}>{pick.qty}</span>
                    <button type="button" aria-label="One more" disabled={pick.qty >= 10} onClick={() => setPick((p) => p && { ...p, qty: Math.min(10, p.qty + 1) })} className="h-12 w-12 text-[22px] disabled:opacity-35" style={{ color: INK }}>+</button>
                  </div>
                  <button type="button" data-autofocus onClick={toDetails} disabled={!!priced && !priced.ok} className={`${btn} flex-1`} style={{ background: accent, color: onAccent }}>
                    {isPerk ? 'Add, included' : total > 0 ? `Add, ${money(total)}` : 'Add'}
                  </button>
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConciergePage() {
  return <Suspense fallback={<div className="min-h-dvh" style={{ background: SOFT }} />}><StationMenu /></Suspense>;
}
