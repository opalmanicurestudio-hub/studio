'use client';
// Practice a shift: behind the front desk. A register point of view with real
// scanning (on-screen, typed, or a real USB / Bluetooth scanner), the client in
// front of you, the line behind them, and slips that show up in the shift review.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as R from '@/lib/practice/register';
import * as $ from '@/lib/practice/currency';
import * as Room from '@/lib/practice/room';
import * as T from '@/lib/practice/talk';
import { useAuth, useFirestore } from '@/firebase';
import QRCode from 'qrcode';
import { Barcode, Bottle, Btn, CameraScanner, Cash, CashDrawer, Chip, Person, Reader, ReceiptPaper, ReceiptPrinter, Say, ScannerGun, INK, MUTED, LINE, SOFT, GREEN, AMBER, RED, BLUE } from './parts';

type PayStep = null | 'split' | 'method' | 'tip' | 'reader' | 'processing' | 'approved' | 'declined' | 'decline-wait' | 'chip' | 'offline' | 'reconnecting' | 'cash-total' | 'cash-keep' | 'cash-count' | 'cash-done' | 'receipt';
type Mode = 'scan' | 'type' | 'name';

// ── Sounds (tiny synth, shares the practice mute setting) ───────────────
let ac: AudioContext | null = null;
function tone(f: number, d: number, type: OscillatorType = 'sine', at = 0, v = 0.06) {
  try {
    ac = ac || new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, ac.currentTime + at); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + d);
    o.connect(g).connect(ac.destination); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + d + 0.02);
  } catch { /* no audio */ }
}
const SFX: Record<string, () => void> = {
  beep: () => tone(1850, 0.08, 'square', 0, 0.03),
  err: () => { tone(320, 0.09, 'square', 0, 0.03); tone(320, 0.09, 'square', 0.13, 0.03); },
  coin: () => { tone(988, 0.12); tone(1319, 0.2, 'sine', 0.09); },
  bell: () => { tone(1568, 0.5, 'sine', 0, 0.04); tone(2093, 0.4, 'sine', 0.02, 0.02); },
  chime: () => { tone(784, 0.18); tone(1047, 0.25, 'sine', 0.12); },
  tap: () => tone(600, 0.04, 'triangle', 0, 0.03),
};
const muted = () => { try { return localStorage.getItem('cf_practice_mute') === '1'; } catch { return false; } };

const CUR_KEY = 'cf_practice_currency';
const VOICE_KEY = 'cf_practice_voice';
const TALK_KEY = 'cf_practice_talk';
/** Clients talk: the browser's own speech voices, a different pitch and pace for each client. */
function speak(text: string, v: { pitch: number; rate: number }, pron: string) {
  try {
    const ss = window.speechSynthesis; if (!ss) return; ss.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, '')); u.pitch = v.pitch; u.rate = v.rate; u.lang = 'en-US';
    const voices = ss.getVoices().filter((x) => x.lang.startsWith('en'));
    const fem = /female|samantha|victoria|karen|zira|susan|serena|moira|tessa|fiona|ava|allison|jenny|aria/i, mal = /male|daniel|alex|fred|david|guy|tom|aaron|arthur|oliver/i;
    const pick = voices.find((x) => (pron === 'he' ? mal.test(x.name) && !/female/i.test(x.name) : fem.test(x.name))) || voices[0];
    if (pick) u.voice = pick; ss.speak(u);
  } catch { /* no speech */ }
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const clockOf = (t: number) => { const m = 11 * 60 + Math.floor(t / 2); const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export default function RegisterPractice() {
  const sRef = useRef<R.RegState>(R.newRegister());
  const s = sRef.current;
  const auth = useAuth(); const db = useFirestore();
  const money = (n: number) => R.fm(s, n);
  const cash = (c: number) => $.fmt(s.currency, c);
  const [, setTick] = useState(0); const rerender = useCallback(() => setTick((x) => x + 1), []);
  const [screen, setScreen] = useState<'menu' | 'play' | 'closeout' | 'review'>('menu');
  const [code, setCode] = useState<$.CurrencyCode>('USD');
  const [tendered, setTendered] = useState<number | null>(null);
  const [other, setOther] = useState('');
  const [hand, setHand] = useState<number[]>([]);
  const [cashErr, setCashErr] = useState<string | null>(null);
  const [keepShown, setKeepShown] = useState(false);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [voice, setVoice] = useState(true);
  const [camera, setCamera] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [receiptShown, setReceiptShown] = useState(false);
  const [lastC, setLastC] = useState<R.Customer | null>(null);
  const [details, setDetails] = useState({ phone: '', email: '', promo: false });
  const [paused, setPaused] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('scan');
  const [holding, setHolding] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad' } | null>(null);
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [flag, setFlag] = useState<{ id: number; text: string } | null>(null);
  const [voidFor, setVoidFor] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pay, setPay] = useState<PayStep>(null);
  const [tipShown, setTipShown] = useState<number | null>(null);
  const [calling, setCalling] = useState(false);
  const [usb, setUsb] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [compact, setCompact] = useState(false);
  const speed = useRef(1);
  const holdT = useRef<number | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search); const f = Number(p.get('fast')); if (f > 0) { speed.current = f; (window as any).__register = { s: () => sRef.current, rerender, codes: Object.fromEntries(R.SKUS.map((k) => [k.key, k.code])) }; }
    try { const c = localStorage.getItem(CUR_KEY) as $.CurrencyCode | null; if (c && $.CODES.includes(c)) setCode(c); if (localStorage.getItem(VOICE_KEY) === '0') setVoice(false); } catch { /* private mode */ }
    const onR = () => { setNarrow(window.innerWidth < 860); setCompact(window.innerWidth < 1500); }; onR(); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR);
  }, [rerender]);

  const drainSfx = useCallback(() => { const q = sRef.current.sfx.splice(0); if (!muted()) q.forEach((k, i) => window.setTimeout(() => SFX[k]?.(), i * 90)); }, []);

  // Scan messages fade after a moment when the scan panel isn't open.
  useEffect(() => { if (!msg || sel) return; const id = window.setTimeout(() => setMsg(null), 2200); return () => window.clearTimeout(id); }, [msg, sel]);

  // Clients talk out loud when they say something new.
  const said = s.cur?.said; const saidBy = s.cur?.c.id;
  useEffect(() => { const c = sRef.current.cur?.c; if (!voice || screen !== 'play' || !said || !c) return; sayOut(said, c, toneRef.current); toneRef.current = 'neutral'; }, [said, saidBy, voice, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleVoice = () => { setVoice((v) => { try { localStorage.setItem(VOICE_KEY, v ? '0' : '1'); } catch { /* private mode */ } if (v) try { window.speechSynthesis?.cancel(); } catch { /* none */ } return !v; }); };

  // The clock keeps running: the line grows while you work.
  useEffect(() => {
    if (screen !== 'play') return;
    const id = window.setInterval(() => {
      if (paused) return;
      const st = sRef.current; const had = st.cur?.c.id;
      R.advance(st, 0.25 * speed.current);
      if (st.cur && st.cur.c.id !== had) { setSel(null); setMsg(null); setFlag(null); setNote(null); setVoidFor(null); setMode('scan'); setDetails({ phone: '', email: '', promo: false }); }
      drainSfx();
      if (R.finished(st) && !pay) window.setTimeout(() => setScreen('closeout'), 500);
      rerender();
    }, 250);
    return () => window.clearInterval(id);
  }, [screen, paused, pay, rerender, drainSfx]);

  const afterScan = useCallback((r: R.ScanResult, via: string) => {
    if (r.kind === 'added') {
      setMsg({ text: via === 'usb' ? 'Beep. Read by your scanner.' : via === 'camera' ? 'Beep. Read by your camera.' : 'Beep. Added to the ticket.', tone: 'ok' });
      if (r.flag && r.lines) setFlag({ id: r.lines[0].id, text: r.flag });
    } else if (r.kind === 'unreadable') setMsg({ text: 'Beep-beep. The label won’t read.', tone: 'warn' });
    else if (r.kind === 'unknown') setMsg({ text: 'That number isn’t in the system. Check it and try again.', tone: 'bad' });
    drainSfx(); rerender();
  }, [drainSfx, rerender]);

  // A real USB or Bluetooth scanner types the digits very fast, then Enter.
  useEffect(() => {
    if (screen !== 'play') return;
    let buf = '', first = 0;
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
      const now = performance.now();
      if (/^\d$/.test(e.key)) { if (!buf || now - first > 600) { buf = ''; first = now; } buf += e.key; return; }
      if (e.key === 'Enter' && buf.length >= 11 && now - first < 900) {
        const code = buf.slice(-14); buf = '';
        if (!sRef.current.cur) return;
        setUsb(true); const sku = R.skuByCode(code);
        afterScan(R.scan(sRef.current, sku ? sku.code : code, 'usb'), 'usb');
      } else if (e.key === 'Enter') buf = '';
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [screen, afterScan]);

  const onCamera = useCallback((code: string) => {
    if (!sRef.current.cur) return; const sku = R.skuByCode(code);
    afterScan(R.scan(sRef.current, sku ? sku.code : code, 'camera'), 'camera');
  }, [afterScan]);
  const start = () => { sRef.current = R.newRegister(code); setScreen('play'); setSel(null); setMsg(null); setPay(null); setFlag(null); setPaused(false); setHand([]); setTendered(null); setCounts({}); rerender(); };
  const pickCurrency = (c: $.CurrencyCode) => { setCode(c); try { localStorage.setItem(CUR_KEY, c); } catch { /* private mode */ } };
  const cur = s.cur;
  const sku = sel ? R.skuBy(sel) : null;
  const smudged = !!(cur && sku && cur.c.slips.some((x) => x.kind === 'unreadable' && x.sku === sku.key));

  const holdStart = () => {
    if (!sku || holding) return; setHolding(true); SFX.tap();
    holdT.current = window.setTimeout(() => { setHolding(false); if (sRef.current.cur) afterScan(R.scan(sRef.current, sku.code, 'gun'), 'gun'); }, 480);
  };
  const holdEnd = () => { if (holdT.current && holding) { window.clearTimeout(holdT.current); setHolding(false); } };
  const typedGo = () => { if (!cur) return; afterScan(R.scan(s, typed.replace(/\D/g, ''), 'typed'), 'typed'); setTyped(''); };
  const nameGo = (key: string) => { const l = R.addByName(s, key); const k = R.skuBy(key); const al = cur && R.allergy(cur.c);
    setMsg({ text: `Added ${R.skuLabel(k)}.`, tone: 'ok' }); if (l && al && k.fragrance) setFlag({ id: l.id, text: `${cur!.c.name} has a ${al} allergy on file. This product has ${al}.` }); setQ(''); drainSfx(); rerender(); };
  const manager = () => { setCalling(true); window.setTimeout(() => { R.askDiscount(s); setCalling(false); drainSfx(); rerender(); }, 1500); };
  const resetCash = () => { setHand([]); setTendered(null); setOther(''); setCashErr(null); setKeepShown(false); };
  // ── Two players: the client screen on a second device ────────────────
  const roomRef = useRef<{ id: string | null; on: boolean; tp: Room.Transport | null }>({ id: null, on: false, tp: null });
  const seqRef = useRef(0);
  const pending = useRef<{ seq: number; resolve: (v: string | number) => void; ai: () => string | number } | null>(null);
  const [roomUi, setRoomUi] = useState<{ id: string; on: boolean; local: boolean; qr: string | null } | null>(null);
  const [showRoom, setShowRoom] = useState(false);
  const [waitingClient, setWaitingClient] = useState(false);
  const [prefPick, setPrefPick] = useState<'card' | 'cash' | null>(null);
  const [cardWhich, setCardWhich] = useState<'same' | 'another'>('same');
  const [asking, setAsking] = useState<string | null>(null);
  const twoP = !!roomUi?.on;
  const view = (v: Omit<Room.DeskView, 'seq' | 'currency'>) => { const r = roomRef.current; if (!r.id || !r.on || !r.tp) return 0; seqRef.current++; r.tp.push(r.id, { ...v, seq: seqRef.current, currency: sRef.current.currency }).catch(() => {}); return seqRef.current; };
  /** Ask the client. With a client screen connected, the second player answers; otherwise the game answers for them. */
  const ask = (v: Omit<Room.DeskView, 'seq' | 'currency'>, ai: () => string | number, delay = 1000): Promise<string | number> => {
    const r = roomRef.current;
    if (r.id && r.on) { const my = view(v); setWaitingClient(true); return new Promise((res) => { pending.current = { seq: my, resolve: (x) => { setWaitingClient(false); res(x); }, ai }; }); }
    return new Promise((res) => window.setTimeout(() => res(ai()), delay));
  };
  const chooseForThem = () => { const p = pending.current; if (p) { pending.current = null; p.resolve(p.ai()); } };
  const openRoom = async (local: boolean) => {
    try {
      const tp = local ? Room.localTransport() : Room.cloudTransport(db, auth);
      const id = await tp.create(sRef.current.currency); roomRef.current = { id, on: false, tp };
      const url = `${window.location.origin}/practice/client?room=${id}${local ? '&local=1' : ''}`;
      let qr: string | null = null; try { qr = await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#16171a', light: '#ffffff' } }); } catch { /* no QR */ }
      setRoomUi({ id, on: false, local, qr });
      tp.watch(id, (r) => {
        const m = r?.client; if (!m) return;
        if (m.choice === 'joined' && m.seq === -1 && !roomRef.current.on) { roomRef.current.on = true; setRoomUi((u) => (u ? { ...u, on: true } : u)); }
        const p = pending.current; if (p && m.seq === p.seq) { pending.current = null; p.resolve(m.choice); }
      });
    } catch { setRoomUi(null); setMsg({ text: 'Couldn’t start a client screen. Check your connection and try again.', tone: 'bad' }); }
  };
  // Keep the client screen showing the ticket while you scan.
  const liveKey = s.cur ? `${s.cur.c.id}:${s.cur.lines.filter((l) => !l.voided).length}:${R.totalOf(s.cur)}` : 'none';
  useEffect(() => {
    if (!roomUi?.on || pay || pending.current) return; const st = sRef.current;
    if (st.cur) view({ stage: 'cart', who: st.cur.c.name, lines: R.live(st.cur).map((l) => ({ label: l.label, price: l.price })), total: $.cents(R.totalOf(st.cur)) });
    else view({ stage: 'idle' });
  }, [liveKey, roomUi?.on, pay]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseTender = (v: number) => {
    if (v < R.cashDue(s)) { setCashErr('That’s less than the total.'); return; }
    setCashErr(null); setTendered(v); setPay('cash-keep'); SFX.tap();
    const extra = $.sum(R.handOver(s)) - R.cashDue(s);
    ask({ stage: 'keep', who: R.payerName(s), title: 'Your change', amount: extra, note: 'Would you like to keep the change as a tip?', choices: [{ value: 'all', label: 'Keep the change as a tip' }, { value: 'none', label: 'My change, please' }] }, () => R.keepChoice(sRef.current), 1000)
      .then((v2) => { const st = sRef.current; if (!st.cur) return; R.setKeep(st, v2 === 'all' ? extra : v2 === 'none' ? 0 : Number(v2)); setKeepShown(true); rerender(); window.setTimeout(() => { setPay('cash-count'); if (!muted()) SFX.tap(); }, 1100); });
  };
  const takePiece = (v: number) => { const left = (s.drawer[v] || 0) - hand.filter((x) => x === v).length; if (left > 0) { setHand((h) => [...h, v]); if (!muted()) SFX.tap(); } };
  const finishReceipt = () => {
    const rc0 = sRef.current.lastReceipt; view({ stage: 'thanks', who: rc0?.who });
    sRef.current.busy = false; setPrinting(false); setReceiptShown(false); setPay(null); resetCash(); setSel(null); setMsg(null); setFlag(null); setNote(null); setCardWhich('same'); setPrefPick(null); rerender();
  };
  /** After a payment: the next person in a group, or the receipt. */
  const afterPaid = (r: { partial?: boolean } | null) => {
    drainSfx(); setCardWhich('same');
    if (r?.partial) { resetCash(); startMethod(); return; }
    const rc0 = sRef.current.lastReceipt; sRef.current.busy = true; setPay('receipt'); setReceiptShown(false); rerender();
    ask({ stage: 'receipt', who: rc0?.who, title: 'Would you like a receipt?', choices: [{ value: 'print', label: 'Print' }, { value: 'text', label: 'Text it' }, { value: 'email', label: 'Email it' }, { value: 'none', label: 'No receipt' }] }, () => rc0?.choice || 'none', 900)
      .then((ch) => {
        R.setReceipt(sRef.current, ch as R.Customer['receipt']); setReceiptShown(true); rerender();
        if (ch === 'print') window.setTimeout(() => { setPrinting(true); if (!muted()) tone(180, 0.6, 'sawtooth', 0, 0.012); }, 400);
        else window.setTimeout(finishReceipt, 1900);
      });
  };
  const handOverChange = () => {
    const r = R.payCash(s, tendered ?? 0, hand);
    if (!r) return; if (!r.ok) { setCashErr(r.error); return; }
    drainSfx(); setPay('cash-done');
    window.setTimeout(() => afterPaid(r), 900);
  };
  const startMethod = () => {
    const st = sRef.current; if (!st.cur) return; setPrefPick(null);
    const line = (m: string) => (m === 'cash' ? (st.cur!.parts ? 'I’ll pay my part in cash.' : 'I’ll pay cash.') : st.cur!.parts ? 'Card for me, please.' : 'Card, please.');
    st.cur.said = `${st.cur.parts ? `${R.payerName(st)}: ` : ''}${line(R.prefers(st))}`;
    setPay('method'); rerender();
    if (roomRef.current.on) ask({ stage: 'method', who: R.payerName(st), title: 'How would you like to pay?', amount: R.dueNow(st), choices: [{ value: 'card', label: '💳 Card' }, { value: 'cash', label: '💵 Cash' }] }, () => R.prefers(sRef.current))
      .then((m) => { const c2 = sRef.current; if (!c2.cur) return; c2.cur.said = `${c2.cur.parts ? `${R.payerName(c2)}: ` : ''}${line(String(m))}`; setPrefPick(m as 'card' | 'cash'); rerender(); });
  };
  const takePayment = () => {
    if (!cur) return; setSel(null); resetCash(); setLastC(cur.c);
    if (cur.c.party && !cur.split) { cur.said = cur.c.party.ask; setPay('split'); rerender(); return; }
    startMethod();
  };
  /** The client taps, inserts or swipes (on their own screen in two-player). */
  const askCard = (title = 'Tap, insert or swipe') => {
    if (!roomRef.current.on) return; const st = sRef.current; if (!st.cur) return;
    ask({ stage: 'card', who: R.payerName(st), title, amount: R.dueNow(st) + R.tipNow(st).amount, choices: [{ value: 'tap', label: 'Tap' }, { value: 'insert', label: 'Insert chip' }, { value: 'swipe', label: 'Swipe' }] }, () => 'tap').then((w) => cardGo(w as R.CardWay));
  };
  const chooseMethod = (m: 'card' | 'cash') => {
    if (!cur) return; resetCash(); if (pending.current) { pending.current = null; setWaitingClient(false); }
    if (m === 'cash') { R.handOver(s); setPay('cash-total'); view({ stage: 'cart', who: R.payerName(s), title: 'Paying with cash', lines: R.live(cur).map((l) => ({ label: l.label, price: l.price })), total: R.cashDue(s) }); rerender(); return; }
    setPay('tip'); setTipShown(null);
    const base = cur.parts ? R.dueNow(s) * 0.85 : $.cents(cur.c.service.price);
    ask({ stage: 'tip', who: R.payerName(s), title: 'Add a tip?', amount: R.dueNow(s), choices: [...[15, 18, 20, 25].map((p2): Room.Choice => ({ value: p2, label: `${p2}%`, sub: cash(Math.round((base * p2) / 10000) * 100) })), { value: 0, label: 'No tip' }] }, () => R.tipNow(sRef.current).pct, 1000)
      .then((pct) => { R.setTip(sRef.current, Number(pct)); setTipShown(Number(pct)); window.setTimeout(() => { setPay('reader'); askCard(); }, 700); });
  };
  const cardGo = (way: R.CardWay | 'onfile') => {
    setPay('processing'); SFX.tap();
    window.setTimeout(() => {
      const st = sRef.current; if (!st.cur) return; const res = R.cardAttempt(st, way, cardWhich); drainSfx(); rerender();
      if (res === 'approved') { setPay('approved'); if (!muted()) SFX.chime(); window.setTimeout(() => afterPaid(R.pay(sRef.current)), 800); return; }
      if (!muted()) SFX.err();
      if (res === 'declined') { setPay('declined'); view({ stage: 'card', who: R.payerName(st), title: 'Declined', note: 'The desk will help you.', choices: [] }); }
      else if (res === 'chip-error') { setPay('chip'); askCard('Chip error. Remove the card and try again.'); }
      else { setPay('offline'); view({ stage: 'card', who: R.payerName(st), title: 'Reader offline', note: 'One moment, please.', choices: [] }); }
    }, 1000);
  };
  /** After a decline: what you say, then the client chooses another card or cash. */
  const sayAfterDecline = (q: R.DeclineLine['q']) => {
    R.declineReply(s, q); drainSfx(); setPay('decline-wait'); rerender();
    ask({ stage: 'declined', who: R.payerName(s), title: 'That card didn’t go through', note: 'How would you like to pay?', choices: [{ value: 'another', label: 'Use another card' }, { value: 'cash', label: 'Pay with cash' }] }, () => 'another', 1100)
      .then((c2) => { if (c2 === 'cash') { chooseMethod('cash'); return; } setCardWhich('another'); setPay('reader'); askCard('Tap, insert or swipe your other card'); });
  };
  const reconnectReader = () => { setPay('reconnecting'); window.setTimeout(() => { R.reconnect(sRef.current); setPay('reader'); askCard(); rerender(); }, 2500); };
  const offerNextVisit = () => {
    const st = sRef.current; if (!st.cur) return; const c = st.cur.c; setAsking('rebook');
    const opts = R.rebookOptions(st);
    ask({ stage: 'rebook', who: c.name, title: 'Book your next visit?', note: c.rebook !== 'no' ? `${c.service.provider.split(',')[0]} usually sees you every ${c.rebook} weeks.` : undefined, choices: [...opts.map((o): Room.Choice => ({ value: o.weeks, label: `In ${o.weeks} weeks`, sub: o.label })), { value: 'no', label: 'Not now', sub: 'I’ll book online' }] }, () => R.rebookAnswer(sRef.current), 1100)
      .then((pk) => { R.rebook(sRef.current, pk === 'no' ? 'no' : Number(pk)); setAsking(null); drainSfx(); rerender(); });
  };
  const offerIt = (key: string) => {
    const st = sRef.current; if (!st.cur) return; const o = R.offerBy(key); setAsking(key);
    ask({ stage: 'offer', who: st.cur.c.name, title: o.name, amount: $.cents(o.price), note: `${o.desc}${o.per ? ` Billed every ${o.per}.` : ''}`, choices: [{ value: 'yes', label: o.kind === 'membership' ? 'Yes, sign me up' : 'Yes, I’ll take it' }, { value: 'no', label: 'No, thank you' }] }, () => R.offerAnswer(sRef.current, key), 1100)
      .then((a2) => { R.offer(sRef.current, key, a2 === 'yes' ? 'yes' : 'no'); setAsking(null); drainSfx(); rerender(); });
  };

  // ── Talking out loud: your mic, the client's real voice, and a coach ──
  const [talkOn, setTalkOn] = useState(false);
  const [coachOn, setCoachOn] = useState(true);
  const [caps, setCaps] = useState({ ai: false, voices: false, listen: false });
  const [signedIn, setSignedIn] = useState(false);
  const [talkState, setTalkState] = useState<'idle' | 'listening' | 'hearing' | 'thinking'>('idle');
  const [heard, setHeard] = useState<string | null>(null);
  const [coachTip, setCoachTip] = useState<{ tip: string; scores: T.Scores; fillers: number; pace: string | null } | null>(null);
  const [typedLine, setTypedLine] = useState('');
  const [talkErr, setTalkErr] = useState<string | null>(null);
  const voiceMap = useRef<Record<string, string>>({});
  const toneRef = useRef('neutral');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const payRef = useRef(pay); payRef.current = pay;
  const flagRef = useRef(flag); flagRef.current = flag;
  useEffect(() => {
    try { if (localStorage.getItem(TALK_KEY) === '1') setTalkOn(true); } catch { /* private mode */ }
    fetch('/api/practice/status').then((r) => r.json()).then((d) => setCaps({ ai: !!d.ai, voices: !!d.voices, listen: !!d.listen })).catch(() => {});
    const off = auth?.onAuthStateChanged?.((u) => setSignedIn(!!u && !u.isAnonymous)); return () => off?.();
  }, [auth]);
  const idToken = async () => { const u = auth?.currentUser; if (!u || u.isAnonymous) return null; try { return await u.getIdToken(); } catch { return null; } };
  const OFFER_NAMES = Object.fromEntries(R.OFFERS.map((o) => [o.key, o.name]));
  /** Give each client a real voice that fits them (from the business's voice account). */
  const assignVoices = async () => {
    if (!caps.voices) return; const tk = await idToken(); if (!tk) return;
    try {
      const r = await fetch('/api/practice/voices', { headers: { authorization: `Bearer ${tk}` } }); const d = await r.json(); if (!d.ok) return;
      const vs: { id: string; gender: string; age: string; accent: string }[] = d.voices; const used = new Set<string>();
      const all = [...(sRef.current.cur ? [sRef.current.cur.c] : []), ...sRef.current.queue];
      for (const c of all) {
        const score = (v: typeof vs[0]) => (v.gender.toLowerCase() === c.voiceHint.gender ? 10 : 0) + (v.age.toLowerCase().startsWith(c.voiceHint.age.split('_')[0]) ? 4 : 0) + (/americ/i.test(v.accent) ? 1 : 0) - (used.has(v.id) ? 8 : 0);
        const best = [...vs].sort((a, b) => score(b) - score(a))[0]; if (best) { voiceMap.current[c.id] = best.id; used.add(best.id); }
      }
    } catch { /* fall back to browser voices */ }
  };
  /** Clients speak: a real voice when connected, otherwise the browser's own voices. */
  const sayOut = async (text: string, c: R.Customer, tone: string) => {
    const vid = voiceMap.current[c.id]; const tk = caps.voices && vid ? await idToken() : null;
    if (tk && vid) {
      try {
        const r = await fetch('/api/practice/speak', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ text, voiceId: vid, tone }) });
        if (r.ok) { const url = URL.createObjectURL(await r.blob()); audioRef.current?.pause(); try { window.speechSynthesis?.cancel(); } catch { /* none */ } const a = new Audio(url); audioRef.current = a; a.onended = () => URL.revokeObjectURL(url); await a.play().catch(() => {}); return; }
      } catch { /* fall back */ }
    }
    speak(text, c.voice, c.pron);
  };
  const stageNow = (p: PayStep) => !p ? 'the ticket is open and not paid yet' : p === 'split' || p === 'method' ? 'staff is about to take payment' : p === 'declined' || p === 'decline-wait' ? 'your card was just declined' : p === 'chip' ? 'the reader showed a chip error' : p === 'offline' || p === 'reconnecting' ? 'the card reader is offline' : p.startsWith('cash') ? 'paying with cash' : p === 'receipt' ? 'paid; choosing a receipt' : 'paying by card';
  /** What the client knows right now, for the conversation. */
  const contextFor = (st: R.RegState) => {
    const cur2 = st.cur!; const c = cur2.c; const sh = R.slip(c, 'shelf'); const al = R.allergy(c); const fl = flagRef.current;
    return {
      name: c.party ? 'Maya' : c.name, persona: c.persona, kind: c.kind, visits: c.visits, service: c.party ? c.party.members.map((m) => `${m.name}: ${m.service.label}`).join(', ') : c.service.label, provider: c.service.provider,
      items: R.live(cur2).filter((l) => l.kind !== 'service').map((l) => l.label), total: money(R.totalOf(cur2)), prefersPay: R.prefers(st),
      rebook: { wants: c.rebook === 'no' ? 'no, you would rather book online later' : `yes, in ${c.rebook} weeks (your usual)`, done: cur2.rebooked ? (cur2.rebooked === 'no' ? 'you said you’d book online later' : cur2.rebooked) : null },
      offer: { wants: c.wants ? R.offerBy(c.wants).name : null, offered: cur2.offered.map((k) => R.offerBy(k).name), catalog: R.offersFor(st).slice(0, 3).map((o) => `${o.name}: ${money(o.price)}${o.per ? ' a month' : ''}. ${o.desc}`) },
      shelf: sh ? { item: R.skuBy(sh.sku).name, system: money(R.skuBy(sh.sku).price), claim: money(sh.claim), status: cur2.claim || 'open' } : null,
      allergy: al ? { allergy: al, flaggedItem: fl ? R.live(cur2).find((l) => l.id === fl.id)?.label || null : null } : null,
      declined: payRef.current === 'declined' || payRef.current === 'decline-wait', chipError: payRef.current === 'chip', readerOffline: payRef.current === 'offline',
      details: c.details ? { phone: c.details.phone, email: c.details.email, promo: c.details.promo, saved: !!cur2.contact } : null,
      party: c.party ? { members: c.party.members.map((m) => m.name).join(', '), split: 'split it evenly three ways; Jo pays her part in cash' } : null,
      mood: cur2.mood, waitedMinutes: Math.max(0, (cur2.start - c.arrive) / 2), lineLength: R.line(st).length, stage: stageNow(payRef.current), history: cur2.history,
    };
  };
  /** You said something: the client answers, and what you offered or did counts in the game. */
  const handleSaid = async (raw: string, seconds: number | null) => {
    const st = sRef.current; const c0 = st.cur; const text = raw.trim(); if (!c0 || !text) { setTalkState('idle'); return; }
    setHeard(text); setTalkState('thinking'); setTalkErr(null);
    const ctx = contextFor(st); let res: T.TalkReply | null = null;
    const tk = caps.ai ? await idToken() : null;
    if (tk) { try { const r = await fetch('/api/practice/talk', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ context: ctx, said: text }) }); const d = await r.json(); if (d.ok) res = d; else setTalkErr(d.error || null); } catch { /* basic mode */ } }
    if (!res) res = T.basicTalk(T.sanitizeContext(ctx), text, OFFER_NAMES);
    const cur2 = sRef.current.cur; if (!cur2 || cur2.c.id !== c0.c.id) { setTalkState('idle'); return; }
    const d = res.detected; const p = payRef.current;
    if (d.greeting && !cur2.greeted) R.greet(st, d.greeting);
    if (d.askedPhone && cur2.c.details) R.askDetail(st, 'phone');
    if (d.askedEmail && cur2.c.details) R.askDetail(st, 'email');
    if (d.suggestedSafe && flagRef.current) { R.suggestSafe(st, flagRef.current.id); setFlag(null); }
    if (d.shelf === 'explain' && cur2.claim === 'open') R.refuseClaim(st);
    if (!p && d.offeredRebook && !cur2.rebooked) R.rebook(st, R.rebookAnswer(st));
    if (!p && d.offeredOffer && !cur2.offered.includes(d.offeredOffer)) R.offer(st, d.offeredOffer, R.offerAnswer(st, d.offeredOffer));
    if (d.declineHandling && p === 'declined') sayAfterDecline(d.declineHandling);
    if (d.shelf === 'manager' && cur2.claim === 'open') manager();
    cur2.history.push({ who: 'you', text }); cur2.history.push({ who: 'client', text: res.reply });
    cur2.mood = Math.max(0, Math.min(1, cur2.mood + res.moodDelta));
    toneRef.current = res.tone; cur2.said = res.reply;
    const dl = T.delivery(text, seconds);
    st.talk.push({ who: cur2.c.name, you: text, reply: res.reply, scores: res.coach.scores, tip: res.coach.tip, fillers: dl.fillers, wpm: dl.wpm });
    setCoachTip({ tip: res.coach.tip, scores: res.coach.scores, fillers: dl.fillers, pace: dl.pace });
    drainSfx(); setTalkState('idle'); rerender();
  };
  /** Listen: real listening when connected (recorded, sent once, not kept), otherwise the browser's own. */
  const startListening = async () => {
    if (talkState !== 'idle' || !sRef.current.cur) return; setTalkErr(null);
    if (caps.listen && signedIn && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); const chunks: Blob[] = []; const t0 = performance.now();
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop()); const secs = (performance.now() - t0) / 1000; setTalkState('hearing');
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); const tk = await idToken();
          try {
            const f = new FormData(); f.append('audio', blob, blob.type.includes('mp4') ? 'speech.mp4' : 'speech.webm');
            const r = await fetch('/api/practice/listen', { method: 'POST', headers: { authorization: `Bearer ${tk}` }, body: f }); const d = await r.json();
            if (!d.ok || !d.text) { setTalkErr(d.error || 'Didn’t catch that. Try again.'); setTalkState('idle'); return; }
            handleSaid(d.text, secs);
          } catch { setTalkErr('Couldn’t hear that. Try again.'); setTalkState('idle'); }
        };
        rec.start(); recRef.current = { stop: () => { if (rec.state !== 'inactive') rec.stop(); } }; setTalkState('listening');
        window.setTimeout(() => recRef.current?.stop(), 20000); return;
      } catch { setTalkErr('The microphone is blocked. Allow the mic for this site, or type instead.'); setTalkState('idle'); return; }
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setTalkErr('This browser can’t listen. Type what you’d say instead.'); return; }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1; const t0 = performance.now(); let got = false;
    r.onresult = (e: any) => { got = true; handleSaid(String(e.results?.[0]?.[0]?.transcript || ''), (performance.now() - t0) / 1000); };
    r.onerror = () => { setTalkErr('Didn’t catch that. Try again, or type it.'); setTalkState('idle'); };
    r.onend = () => { if (!got) setTalkState((x) => (x === 'listening' ? 'idle' : x)); };
    recRef.current = { stop: () => r.stop() }; r.start(); setTalkState('listening');
  };
  const stopListening = () => recRef.current?.stop();
  const toggleTalk = () => setTalkOn((v) => { const n = !v; try { localStorage.setItem(TALK_KEY, n ? '1' : '0'); } catch { /* private mode */ } if (n) assignVoices(); return n; });
  useEffect(() => { if (talkOn && screen === 'play' && caps.voices && signedIn && !Object.keys(voiceMap.current).length) assignVoices(); }, [talkOn, screen, caps.voices, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hold the space bar to talk (desktop).
  useEffect(() => {
    if (!talkOn || screen !== 'play') return;
    const isField = (e: KeyboardEvent) => { const t = e.target as HTMLElement; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat && !isField(e)) { e.preventDefault(); startListening(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !isField(e)) { e.preventDefault(); stopListening(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Screens ──
  if (screen === 'menu') return <Shell><MenuCard onStart={start} code={code} onCode={pickCurrency} /></Shell>;
  if (screen === 'review') return <Shell><ReviewCard s={s} onAgain={start} /></Shell>;
  if (screen === 'closeout') return <Shell><CloseOutCard s={s} narrow={narrow} counts={counts} setCounts={setCounts} onDone={() => setScreen('review')} rerender={rerender} /></Shell>;

  const done = s.done; const clean = done.filter((d) => d.clean).length;
  const avg = done.length ? Math.round(done.reduce((a, d) => a + d.seconds, 0) / done.length) : 0;
  const waiting = R.line(s); const longest = Math.min(1, ...waiting.map((c) => s.waiting[c.id] ?? 1));
  const retail = cur ? cur.lines.filter((l) => l.kind === 'retail' && !l.voided).length : 0;
  const coach = cur && cur.c.id === 'rosa' && done.length === 0 && !pay ? (!cur.greeted ? 'Rosa is at the desk. Greet her: pick what to say.' : retail === 0 ? (sel ? (narrow ? 'Press and hold the barcode to scan it.' : 'Press and hold on the barcode to scan it.') : 'Tap the cuticle oil on the counter.') : !cur.rebooked ? 'One bottle, one line. Now offer Rosa her next visit.' : !cur.offered.length ? 'Rosa comes every 3 weeks: mention the Nail Club once.' : 'Take payment.') : null;
  const items = cur ? cur.c.items.flatMap((it) => Array.from({ length: it.n }, (_, k) => ({ key: it.sku, k }))) : [];
  const total = cur ? R.totalOf(cur) : 0;

  const hud = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'rgba(255,255,255,.95)', border: `1px solid ${LINE}`, borderRadius: 16, padding: '8px 10px', boxShadow: '0 10px 30px -20px rgba(22,23,26,.4)' }}>
      <Chip tone="ink">Register · {clockOf(s.t)}</Chip>
      <Chip tone={done.length && clean < done.length ? 'amber' : 'green'}>Accuracy {done.length ? Math.round((clean / done.length) * 100) : 100}%</Chip>
      {!narrow && <Chip>Avg checkout {done.length ? `${avg}s` : '—'}</Chip>}
      {s.streak > 1 && <Chip tone="amber">Streak ×{s.streak}</Chip>}
      <Chip tone="blue">{s.points} pts</Chip>
      {usb && <Chip tone="green">Scanner connected</Chip>}
      <span style={{ flex: 1 }} />
      <button onClick={toggleTalk} style={{ ...pill, ...(talkOn ? { background: '#eaf6ef', borderColor: '#cfe6d8', color: GREEN } : {}) }} aria-label={talkOn ? 'Turn talk mode off' : 'Turn talk mode on'}>🎙 {narrow ? '' : talkOn ? 'Talk mode on' : 'Talk'}</button>
      <button onClick={() => setShowRoom(true)} style={{ ...pill, ...(twoP ? { background: '#eaf6ef', borderColor: '#cfe6d8', color: GREEN } : {}) }} aria-label="Two players">📱 {narrow ? '' : twoP ? 'Client screen on' : 'Two players'}</button>
      <button onClick={() => setCamera(true)} style={pill} aria-label="Scan with camera">📷 {narrow ? '' : 'Camera'}</button>
      <button onClick={toggleVoice} style={pill} aria-label={voice ? 'Turn voices off' : 'Turn voices on'}>{voice ? '🔊' : '🔇'} {narrow ? '' : 'Voices'}</button>
      <button onClick={() => setPaused((p) => !p)} style={pill}>{paused ? 'Resume' : 'Pause'}</button>
      <button onClick={() => setScreen('menu')} style={pill}>Exit</button>
    </div>
  );
  const queue = waiting.length > 0 && (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px 5px 6px', boxShadow: '0 10px 20px -12px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>
      <span style={{ display: 'flex' }}>{waiting.slice(0, 3).map((c, i) => <span key={c.id} style={{ width: 32, height: 32, borderRadius: 16, background: c.look.top, border: '2px solid #fff', marginLeft: i ? -10 : 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}><span style={{ width: 16, height: 16, borderRadius: 8, background: c.look.skin, marginBottom: 6 }} /></span>)}</span>
      <span><b style={{ fontSize: 12.5, display: 'block' }}>{waiting.length} waiting</b><span style={{ fontSize: 11, fontWeight: 600, color: longest < 0.5 ? RED : longest < 0.8 ? AMBER : GREEN }}>{longest < 0.5 ? 'getting impatient' : longest < 0.8 ? 'starting to wait' : 'just arrived'}</span></span>
    </div>
  );

  const claimCard = cur?.claim === 'open' && (() => { const sh = R.slip(cur.c, 'shelf')!; const k = R.skuBy(sh.sku); return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 340, boxShadow: '0 10px 24px -16px rgba(0,0,0,.4)' }}>
      <div style={{ fontSize: 12.5, color: MUTED }}>The system says {k.name} is <b style={{ color: INK }}>{money(k.price)}</b>. {cur.c.name} says the sign said <b style={{ color: INK }}>{money(sh.claim)}</b>.</div>
      {calling ? <div style={{ fontSize: 13, fontWeight: 600, color: BLUE }}>Calling {R.MANAGER}… she’s checking on her phone</div> : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn small onClick={manager}>Ask {R.MANAGER} to approve {money(k.price - sh.claim)} off</Btn>
        <Btn small ghost onClick={() => { R.refuseClaim(s); rerender(); }}>Explain it’s {money(k.price)}</Btn></div>}
    </div>); })();

  const pos = cur && (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: narrow ? 0 : 300, boxSizing: 'border-box', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 14, background: cur.c.look.top, color: '#fff', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: '0 1px 2px rgba(0,0,0,.35)' }}>{cur.c.name[0]}</span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>{cur.c.name}</div><div style={{ fontSize: 11, color: MUTED }}>{cur.c.party ? `Group · ${cur.c.party.members.length} guests` : cur.c.kind === 'new' ? 'First visit' : `${ordinal(cur.c.visits)} visit`} · {cur.c.party ? cur.c.party.members.map((m) => m.name).join(', ') : `${cur.c.service.label} with ${cur.c.service.provider}`}</div></div>
        {cur.c.kind === 'new' ? <Chip tone="blue">New client</Chip> : cur.c.kind === 'regular' ? <Chip tone="green">Regular</Chip> : <Chip>Ticket</Chip>}
      </div>
      {flag && <div style={{ background: '#fdf6ec', border: '1px solid #f3dfc4', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#9a4a07' }}>Health flag · private</div><div style={{ fontSize: 12, color: '#9a4a07' }}>{flag.text}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Btn small onClick={() => { R.suggestSafe(s, flag.id); setFlag(null); drainSfx(); rerender(); }}>Suggest the fragrance-free one</Btn><Btn small ghost onClick={() => setFlag(null)}>Sell it anyway</Btn></div>
      </div>}
      <div style={{ overflow: 'auto', flex: 1 }}>
        {cur.lines.map((l) => (
          <div key={l.id} style={{ borderTop: `1px solid ${LINE}`, padding: '6px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12.8, color: l.voided ? RED : l.kind === 'discount' ? GREEN : INK }}>
              <span style={{ textDecoration: l.voided ? 'line-through' : undefined, flex: 1 }}>{l.kind === 'retail' ? '🛍 ' : ''}{l.label}</span>
              <span style={{ textDecoration: l.voided ? 'line-through' : undefined }}>{money(l.price)}</span>
              {l.kind === 'retail' && !l.voided && !pay && <span style={{ display: 'flex', gap: 4 }}>
                <button style={mini} onClick={() => setVoidFor(voidFor === l.id ? null : l.id)}>Void</button>
                <button style={mini} onClick={() => { setNote(R.editPrice(s, l.id).note); drainSfx(); rerender(); }}>Price</button></span>}
            </div>
            {l.voided && <div style={{ fontSize: 11, color: MUTED }}>Voided · {l.voided}</div>}
            {voidFor === l.id && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}><span style={{ fontSize: 11.5, color: MUTED, alignSelf: 'center' }}>Reason:</span>{R.VOID_REASONS.map((r) => <button key={r} style={mini} onClick={() => { R.voidLine(s, l.id, r); setVoidFor(null); drainSfx(); rerender(); }}>{r}</button>)}</div>}
          </div>
        ))}
      </div>
      {note && <div style={{ fontSize: 12, color: RED, fontWeight: 600 }}>{note}</div>}
      {cur.c.details && !pay && <div style={{ background: '#f4f7ff', border: '1px solid #dbe4ff', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontSize: 12.5, flex: 1 }}>First visit: save {R.their(cur.c)} details</b>{cur.contact && <Chip tone="green">Saved</Chip>}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><button style={mini} onClick={() => { R.askDetail(s, 'phone'); rerender(); }}>Ask for {R.their(cur.c)} phone</button><button style={mini} onClick={() => { R.askDetail(s, 'email'); rerender(); }}>Ask for {R.their(cur.c)} email</button></div>
        <input aria-label="Client phone" value={details.phone} onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))} placeholder="Mobile number" inputMode="tel" style={{ ...input, padding: '6px 10px', fontSize: 13 }} />
        <input aria-label="Client email" value={details.email} onChange={(e) => setDetails((d) => ({ ...d, email: e.target.value }))} placeholder="Email" inputMode="email" autoCapitalize="none" style={{ ...input, padding: '6px 10px', fontSize: 13 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}><input type="checkbox" checked={details.promo} onChange={(e) => setDetails((d) => ({ ...d, promo: e.target.checked }))} />Send offers by text <span style={{ color: MUTED }}>(only if they say yes)</span></label>
        <div><Btn small onClick={() => { R.saveContact(s, details); rerender(); }}>{cur.contact ? 'Update details' : 'Save details'}</Btn></div>
      </div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1.5px solid ${INK}`, paddingTop: 7, fontSize: 16, fontWeight: 800 }}><span>Total</span><span>{money(total)}</span></div>
      {!pay && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>📅 Next visit</span>
          {cur.rebooked ? <Chip tone={cur.rebooked === 'no' ? undefined : 'green'}>{cur.rebooked === 'no' ? 'Will book online' : cur.rebooked}</Chip>
            : asking === 'rebook' ? <span style={{ fontSize: 12, color: BLUE }}>{twoP ? 'Choosing on the client screen…' : 'Asking…'}</span>
            : <button style={mini} onClick={offerNextVisit}>Offer next visit{cur.c.rebook !== 'no' && !cur.c.party ? ` · usually ${cur.c.rebook} wks` : ''}</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>⭐ Memberships & packages</span>
          {R.offersFor(s).slice(0, 3).map((o) => { const done2 = cur.offered.includes(o.key); const ok = R.fits(cur.c, o); return <button key={o.key} disabled={done2 || !!asking} onClick={() => offerIt(o.key)} title={o.desc} style={{ ...mini, opacity: done2 ? 0.5 : 1, borderColor: ok ? '#cfe6d8' : LINE, background: ok ? '#f2f8f4' : '#fff' }}>{asking === o.key ? 'Asking…' : `${o.name} · ${money(o.price)}${o.per ? '/mo' : ''}`}{done2 ? ' ✓' : ''}</button>; })}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><Btn small onClick={takePayment} disabled={!!asking}>Take payment · {money(total)}</Btn></div>
      </div>}
      {pay === 'split' && cur.c.party && <div style={{ background: SOFT, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, color: MUTED }}>How is the group paying?</div>
        {(['own', 'even', 'one'] as const).map((m) => m === 'one' ? <div key={m} style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}><span style={{ fontSize: 12.5 }}>One person pays:</span>{cur.c.party!.members.map((mm) => <button key={mm.name} style={mini} onClick={() => { R.setSplit(s, 'one', mm.name); startMethod(); }}>{mm.name}</button>)}</div>
          : <button key={m} style={{ ...rowBtn, padding: '7px 10px', fontSize: 13 }} onClick={() => { R.setSplit(s, m); startMethod(); }}>{m === 'own' ? 'Each pays for their own' : `Split evenly, ${cur.c.party!.members.length} ways`}</button>)}
      </div>}
      {pay === 'method' && <div style={{ background: SOFT, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cur.parts && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{cur.parts.map((p, i) => <Chip key={i} tone={p.paid ? 'green' : i === cur.partIdx ? 'ink' : undefined}>{p.paid ? '✓ ' : ''}{p.who} · {cash(p.amount)}</Chip>)}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}><span>{cur.parts ? `${R.payerName(s)} pays` : 'Amount due'}</span><b>{cash(R.dueNow(s))}</b></div>
        <div style={{ fontSize: 12, color: MUTED }}>{R.payerName(s)} would like to pay by {R.prefers(s)}. You can take either.</div>
        <div style={{ display: 'flex', gap: 6 }}><Btn small ghost={(prefPick || R.prefers(s)) !== 'card'} onClick={() => chooseMethod('card')}>💳 Card</Btn><Btn small ghost={(prefPick || R.prefers(s)) !== 'cash'} onClick={() => chooseMethod('cash')}>💵 Cash</Btn></div>
        {twoP && !prefPick && <div style={{ fontSize: 11.5, color: BLUE }}>{R.payerName(s)} is choosing on the client screen…</div>}
      </div>}
      {pay === 'declined' && <div style={{ background: '#fdecec', border: '1px solid #f3c5c0', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ fontSize: 12.5, color: RED }}>The reader says: Declined. What do you say?</b>
        {R.DECLINE_LINES.map((d) => <button key={d.q} onClick={() => sayAfterDecline(d.q)} style={{ ...rowBtn, padding: '7px 10px', fontSize: 12.5, textAlign: 'left', background: INK, color: '#fff', borderColor: INK, borderRadius: '14px 14px 4px 14px' }}>“{d.text}”</button>)}
        <button onClick={() => cardGo('tap')} style={{ ...mini, alignSelf: 'flex-start' }}>Run the same card again</button>
      </div>}
      {(pay === 'offline' || pay === 'reconnecting') && <div style={{ background: '#fdf6ec', border: '1px solid #f3dfc4', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ fontSize: 12.5, color: AMBER }}>The card reader is offline.</b>
        {pay === 'reconnecting' ? <div style={{ fontSize: 12.5 }}>Reconnecting the reader…</div> : <>
          <button style={{ ...rowBtn, padding: '7px 10px', fontSize: 12.5 }} onClick={reconnectReader}>Reconnect the reader</button>
          <button style={{ ...rowBtn, padding: '7px 10px', fontSize: 12.5 }} onClick={() => { if (sRef.current.cur) sRef.current.cur.said = 'Sure, use the card you have on file.'; cardGo('onfile'); }}>Ask to use {R.their(cur.c)} card on file</button>
          <button style={{ ...rowBtn, padding: '7px 10px', fontSize: 12.5 }} onClick={() => { R.writeDownCard(s); setNote('Card numbers should never be written down.'); rerender(); }}>Write the card number down for later</button></>}
      </div>}
      {pay === 'cash-total' && <div style={{ background: SOFT, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: MUTED }}>{R.payerName(s)} handed you this. Leave it on the drawer ledge, then enter the amount received.</div>
        {R.cashDue(s) !== R.dueNow(s) && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Cash total <span style={{ color: MUTED }}>(rounded to 5¢)</span></span><b>{cash(R.cashDue(s))}</b></div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{(cur.given || []).map((v, i) => <Cash key={i} code={s.currency} value={v} size={0.62} />)}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>CASH RECEIVED</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{R.tenderOptions(s).map((v) => <button key={v} onClick={() => chooseTender(v)} style={mini}>{cash(v)}</button>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); const v = Math.round(Number(other.replace(',', '.')) * 100); if (v > 0) chooseTender(v); }} style={{ display: 'flex', gap: 6 }}><input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other amount" inputMode="decimal" style={{ ...input, padding: '6px 10px', fontSize: 13 }} /><Btn small ghost>Enter</Btn></form>
        {cashErr && <div style={{ fontSize: 12, color: RED, fontWeight: 600 }}>{cashErr}</div>}
      </div>}
      {(pay === 'cash-keep' || pay === 'cash-count') && tendered !== null && <div style={{ background: SOFT, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        {R.cashDue(s) !== R.dueNow(s) && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cash total (rounded)</span><b>{cash(R.cashDue(s))}</b></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cash received</span><b>{cash(tendered)}</b></div>
        {pay === 'cash-count' && (cur.kept || 0) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: GREEN }}><span>Kept as a tip</span><b>{cash(cur.kept || 0)}</b></div>}
        {pay === 'cash-count' ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800 }}><span>Change due</span><span>{cash(R.changeShown(s, tendered))}</span></div> : <div style={{ color: MUTED }}>{R.payerName(s)} is choosing on the client screen…</div>}
      </div>}
    </div>
  );

  const rc = s.lastReceipt;
  const saleDone = pay === 'receipt' && rc && (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 28, height: 28, borderRadius: 14, background: '#eaf6ef', color: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>✓</span><b style={{ fontSize: 15, flex: 1 }}>Sale complete</b><Chip>#{rc.no}</Chip></div>
      <div style={{ fontSize: 13, color: MUTED }}>{rc.who}</div>
      {rc.tenders.map((t, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{t.method === 'card' ? '💳 Card' : '💵 Cash'}{rc.tenders.length > 1 ? ` · ${t.who}` : ''}</span><b>{cash(t.amount + t.tip)}</b></div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1.5px solid ${INK}`, paddingTop: 7, fontSize: 15, fontWeight: 800 }}><span>Total</span><span>{money(rc.total)}</span></div>
      <div style={{ fontSize: 12.5, color: MUTED }}>Receipt: {rc.choice === 'print' ? 'printing at the desk' : rc.choice === 'text' ? 'sent by text' : rc.choice === 'email' ? 'sent by email' : 'none'}</div>
    </div>
  );
  const clientScreen = pay && (cur || pay === 'receipt') && (
    <div style={{ background: '#1d1e22', borderRadius: 20, padding: 9, width: narrow ? '100%' : 330, boxSizing: 'border-box', boxShadow: '0 26px 40px -20px rgba(0,0,0,.6)' }}>
      <div style={{ background: 'linear-gradient(180deg,#fbfaf8,#f1eee9)', borderRadius: 13, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minHeight: 190, justifyContent: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', color: MUTED }}>CLIENT SCREEN</div>
        {pay === 'tip' ? <>
          <div style={{ fontSize: 18 }}>Add a tip?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, width: '100%' }}>{[15, 18, 20].map((p) => { const on = tipShown === p; const base = cur!.parts ? R.dueNow(s) * 0.85 : $.cents(cur!.c.service.price); return <div key={p} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 14, padding: '10px 0', textAlign: 'center', transition: 'all .2s' }}><b>{p}%</b><div style={{ fontSize: 10.5, opacity: 0.7 }}>{cash(Math.round((base * p) / 10000) * 100)}</div></div>; })}</div>
          <div style={{ fontSize: 11.5, color: tipShown === 0 ? AMBER : MUTED }}>{tipShown === 0 ? `${R.payerName(s)} chose no tip.` : tipShown ? `${R.payerName(s)} chose ${tipShown}%.` : `${R.payerName(s)} is choosing…`}</div>
        </> : pay === 'reader' ? <>
          <div style={{ fontSize: 17 }}>{cash(R.dueNow(s) + R.tipNow(s).amount)}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{R.payerName(s)} is ready to pay by card.</div>
          {twoP ? <div style={{ fontSize: 12.5, color: BLUE, fontWeight: 600 }}>Waiting for {R.payerName(s)} to tap on the client screen…</div> : <div style={{ display: 'flex', gap: 6 }}><Btn small onClick={() => cardGo('tap')}>Tap</Btn><Btn small onClick={() => cardGo('insert')}>Insert chip</Btn><Btn small onClick={() => cardGo('swipe')}>Swipe</Btn></div>}
        </> : pay === 'processing' ? <div style={{ fontSize: 15, fontWeight: 600 }}>Processing…</div>
          : pay === 'declined' || pay === 'decline-wait' ? <><div style={{ fontSize: 22, fontWeight: 800, color: RED }}>Declined</div><div style={{ fontSize: 12.5, color: MUTED }}>{pay === 'decline-wait' ? `${R.payerName(s)} is deciding…` : 'Talk to the client.'}</div></>
          : pay === 'chip' ? <><div style={{ fontSize: 17, fontWeight: 700, color: AMBER }}>Chip error</div><div style={{ fontSize: 12.5, color: MUTED }}>Remove the card and try again.</div>{!twoP && <div style={{ display: 'flex', gap: 6 }}><Btn small onClick={() => cardGo('insert')}>Insert again</Btn><Btn small onClick={() => cardGo('tap')}>Tap</Btn><Btn small onClick={() => cardGo('swipe')}>Swipe</Btn></div>}</>
          : pay === 'offline' || pay === 'reconnecting' ? <><div style={{ fontSize: 17, fontWeight: 700, color: AMBER }}>{pay === 'reconnecting' ? 'Reconnecting…' : 'Reader offline'}</div><div style={{ fontSize: 12.5, color: MUTED }}>{pay === 'reconnecting' ? 'Finding the Wi-Fi.' : 'The reader lost its connection.'}</div></>
          : pay === 'cash-total' ? <>
          <div style={{ fontSize: 12.5, color: MUTED }}>Total · paying with cash</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{cash(R.cashDue(s))}</div>
          {R.cashDue(s) !== R.dueNow(s) && <div style={{ fontSize: 11.5, color: MUTED }}>Rounded from {cash(R.dueNow(s))} for cash</div>}
        </> : pay === 'cash-keep' ? <>
          <div style={{ fontSize: 17 }}>Your change is {cash($.sum(cur!.given || []) - R.cashDue(s))}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>{(['all', 'part', 'none'] as const).map((k) => { const kept = cur!.kept ?? -1; const extra = $.sum(cur!.given || []) - R.cashDue(s);
            const on = keepShown && (k === 'all' ? kept === extra && kept > 0 : k === 'none' ? kept === 0 : kept > 0 && kept < extra);
            return <div key={k} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 12, padding: '8px 10px', fontSize: 13, fontWeight: 600, textAlign: 'center', transition: 'all .2s' }}>{k === 'all' ? 'Keep the change as a tip' : k === 'none' ? 'My change, please' : on ? `Keep ${cash(kept)} as a tip` : 'Keep part as a tip'}</div>; })}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{keepShown ? `${R.payerName(s)} chose.` : `${R.payerName(s)} is choosing…`}</div>
        </> : pay === 'cash-count' ? <><div style={{ fontSize: 12.5, color: MUTED }}>Change</div><div style={{ fontSize: 24, fontWeight: 800 }}>{cash(Math.max(0, $.sum(cur!.given || []) - R.cashDue(s) - (cur!.kept || 0)))}</div><div style={{ fontSize: 11.5, color: MUTED }}>{cur!.kept ? `Tip: ${cash(cur!.kept)}. Thank you!` : 'Thank you!'}</div></>
          : pay === 'cash-done' ? <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>Thank you ✓</div>
          : pay === 'receipt' && rc ? <>
          <div style={{ fontSize: 17 }}>Would you like a receipt?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, width: '100%' }}>{(['print', 'text', 'email', 'none'] as const).map((k) => { const on = receiptShown && rc.choice === k; return <div key={k} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 12, padding: '8px 6px', fontSize: 12.5, fontWeight: 600, textAlign: 'center', transition: 'all .2s' }}>{k === 'print' ? 'Print' : k === 'text' ? 'Text it' : k === 'email' ? 'Email it' : 'No receipt'}</div>; })}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{!receiptShown ? 'Choosing…' : rc.choice === 'print' ? 'Printing at the desk…' : rc.choice === 'text' ? 'Texted to •••• 0187' : rc.choice === 'email' ? `Emailed${rc.email ? ` to ${rc.email}` : ''}` : 'No receipt. Thank you!'}</div>
        </>
          : pay === 'split' || pay === 'method' ? <><div style={{ fontSize: 12.5, color: MUTED }}>Total</div><div style={{ fontSize: 26, fontWeight: 800 }}>{cur ? money(total) : ''}</div><div style={{ fontSize: 11.5, color: MUTED }}>Waiting for the desk…</div></>
          : <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>Approved ✓</div>}
      </div>
    </div>
  );

  const zoom = sku && cur && !pay && (
    <div style={{ background: 'rgba(255,255,255,.97)', border: `1px solid ${LINE}`, borderRadius: 22, padding: 16, boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 12, width: narrow ? '100%' : 560, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 15, flex: 1 }}>{R.skuLabel(sku)}</b>
        <div style={{ display: 'flex', background: SOFT, borderRadius: 999, padding: 3 }}>{(['scan', 'type', 'name'] as Mode[]).map((m) => <button key={m} onClick={() => setMode(m)} style={{ ...seg, background: mode === m ? '#fff' : 'transparent', boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,.12)' : 'none' }}>{m === 'scan' ? 'Scan' : m === 'type' ? (narrow ? 'Type #' : 'Type the number') : (narrow ? 'Find' : 'Look up by name')}</button>)}</div>
        <button onClick={() => { setSel(null); setMsg(null); }} style={pill}>Done</button></div>
      {mode === 'scan' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: narrow ? 6 : 40, background: 'linear-gradient(180deg,#f4f4f6,#e4e4e8)', borderRadius: 16, padding: '14px 10px', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd}>
        <Bottle sku={sku} w={narrow ? 92 : 112} h={narrow ? 180 : 214} smudge={smudged} />
        <ScannerGun beam={holding} ok={!holding && msg?.tone === 'ok'} size={narrow ? 0.62 : 0.85} />
      </div>}
      {mode === 'scan' && <div style={{ fontSize: 12.5, color: MUTED, textAlign: 'center' }}>Press and hold on the counter to scan. A real scanner works too: just scan the practice sheet.</div>}
      {mode === 'type' && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div style={{ transform: 'scale(1.3)', margin: '10px 0' }}><Barcode code={sku.code} h={40} unit={1.5} smudge={smudged} /></div>
        <form onSubmit={(e) => { e.preventDefault(); typedGo(); }} style={{ display: 'flex', gap: 8, width: '100%' }}>
          <input autoFocus inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type the 12 numbers under the barcode" style={input} />
          <Btn small>Enter</Btn></form>
      </div>}
      {mode === 'name' && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" style={input} />
        {R.lookup(q).map((k) => <button key={k.key} onClick={() => nameGo(k.key)} style={{ ...rowBtn }}><span style={{ width: 14, height: 22, borderRadius: 4, background: k.color }} /><span style={{ flex: 1, textAlign: 'left' }}>{R.skuLabel(k)}</span><b>{money(k.price)}</b></button>)}
        {!q && <div style={{ fontSize: 12, color: MUTED }}>Similar products have similar names. Check the size.</div>}
      </div>}
      {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.tone === 'ok' ? GREEN : msg.tone === 'warn' ? AMBER : RED, textAlign: 'center' }}>{msg.text}</div>}
      {cur.c.items.length > 1 && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
        <span style={{ fontSize: 12, color: MUTED }}>On the counter:</span>
        {cur.c.items.map((it) => { const k = R.skuBy(it.sku); return <button key={it.sku} aria-label={`Pick up ${R.skuLabel(k)}`} onClick={() => { setSel(it.sku); setMsg(null); }} style={{ ...mini, display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: sel === it.sku ? INK : LINE }}><span style={{ width: 8, height: 14, borderRadius: 2, background: k.color }} />{R.skuLabel(k)}{it.n > 1 ? ` ×${it.n}` : ''}</button>; })}
      </div>}
    </div>
  );

  const receiptPanel = pay === 'receipt' && rc && rc.choice === 'print' && (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <ReceiptPrinter r={rc} printing={printing} />
      {printing && <div style={{ display: 'flex', gap: 6 }}><Btn small onClick={finishReceipt}>Tear it off and hand it over</Btn><Btn small ghost onClick={() => window.print()}>🖨 Print for real</Btn></div>}
    </div>
  );
  const handSum = $.sum(hand);
  const drawerPanel = cur && (pay === 'cash-count' || pay === 'cash-done') && tendered !== null && (
    <div style={{ background: 'rgba(255,255,255,.97)', border: `1px solid ${LINE}`, borderRadius: 22, padding: 14, boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 10, width: narrow ? '100%' : 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15, flex: 1 }}>Count the change</b>
        <span style={{ fontSize: 12.5, color: MUTED }}>Change due</span><b style={{ fontSize: 17 }}>{cash(R.changeShown(s, tendered))}</b>
      </div>
      <CashDrawer code={s.currency} drawer={Object.fromEntries(Object.entries(s.drawer).map(([v, n]) => [v, n - hand.filter((x) => x === Number(v)).length]))} onTake={pay === 'cash-count' ? takePiece : undefined} narrow={narrow} w={narrow ? undefined : compact ? 540 : 660} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: SOFT, borderRadius: 14, padding: '8px 10px', minHeight: 54, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: MUTED }}>In your hand:</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>{hand.length ? hand.map((v, i) => <button key={i} aria-label={`Put back ${$.denomLabel(s.currency, v)}`} onClick={() => setHand((h) => h.filter((_, k) => k !== i))} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}><Cash code={s.currency} value={v} size={0.5} /></button>) : <span style={{ fontSize: 12, color: MUTED }}>Tap the drawer to take notes and coins.</span>}</div>
        <b style={{ fontSize: 16 }}>{cash(handSum)}</b>
      </div>
      <div style={{ fontSize: 12, color: MUTED }}>Count it back up from the total: {cash(R.cashDue(s) + (cur.kept || 0))}{hand.length ? hand.reduce((acc, v) => { const t = acc.t + v; return { t, txt: `${acc.txt} → ${cash(R.cashDue(s) + (cur.kept || 0) + t)}` }; }, { t: 0, txt: '' }).txt : ''}</div>
      {cashErr && <div style={{ fontSize: 12, color: RED, fontWeight: 600 }}>{cashErr}</div>}
      {pay === 'cash-count' && <div style={{ display: 'flex', gap: 8 }}><Btn onClick={handOverChange}>Hand it over</Btn><Btn ghost onClick={() => setHand([])}>Put it all back</Btn></div>}
    </div>
  );

  const counter = cur && (
    <div style={{ display: 'flex', gap: narrow ? 10 : 16, alignItems: 'flex-end', overflowX: 'auto', padding: '10px 4px 4px' }}>
      {items.map((it, i) => <Bottle key={`${it.key}${i}`} sku={R.skuBy(it.key)} w={narrow ? 54 : 66} h={narrow ? 104 : 126} selected={sel === it.key} onClick={() => { setSel(it.key); setMode('scan'); setMsg(null); }} smudge={cur.c.slips.some((x) => x.kind === 'unreadable' && x.sku === it.key)} />)}
    </div>
  );

  const shownC = cur?.c || (pay === 'receipt' ? lastC : null);
  const listening = talkState === 'listening';
  const talkEl = talkOn && cur && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: narrow ? '100%' : 360, background: 'rgba(255,255,255,.97)', border: `1px solid ${LINE}`, borderRadius: 18, padding: 10, boxSizing: 'border-box', boxShadow: '0 12px 28px -18px rgba(0,0,0,.45)' }}>
      {heard && <div style={{ alignSelf: 'flex-end', background: INK, color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '7px 11px', fontSize: 13, lineHeight: 1.4, maxWidth: '92%' }}>“{heard}”</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button aria-label={listening ? 'Stop and send' : 'Talk'} onClick={listening ? stopListening : startListening} disabled={talkState === 'hearing' || talkState === 'thinking'} style={{ width: 50, height: 50, borderRadius: 25, border: 'none', flexShrink: 0, cursor: 'pointer', background: listening ? RED : INK, color: '#fff', fontSize: 20, boxShadow: listening ? '0 0 0 7px #fdecec' : '0 8px 16px -8px rgba(0,0,0,.5)', transition: 'all .2s', opacity: talkState === 'hearing' || talkState === 'thinking' ? 0.5 : 1 }}>{listening ? '■' : '🎙'}</button>
        <form onSubmit={(e) => { e.preventDefault(); if (typedLine.trim() && talkState === 'idle') { handleSaid(typedLine, null); setTypedLine(''); } }} style={{ flex: 1, display: 'flex', gap: 6 }}>
          <input aria-label="Say something" value={typedLine} onChange={(e) => setTypedLine(e.target.value)} placeholder={listening ? 'Listening… tap ■ to send' : talkState === 'hearing' ? 'Hearing you…' : talkState === 'thinking' ? `${cur.c.party ? 'Maya' : cur.c.name} is answering…` : 'Tap the mic and talk, or type'} style={{ ...input, padding: '9px 11px', fontSize: 13 }} />
        </form>
      </div>
      {talkErr && <div style={{ fontSize: 12, color: RED, fontWeight: 600 }}>{talkErr}</div>}
      {coachOn && coachTip && <div style={{ background: '#f4f7ff', border: '1px solid #dbe4ff', borderRadius: 12, padding: '7px 10px', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div><b>Coach:</b> {coachTip.tip}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(['awareness', 'confidence', 'warmth', 'retention'] as const).map((k) => <span key={k} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: coachTip.scores[k] >= 4 ? '#e8f3ec' : coachTip.scores[k] <= 2 ? '#fdf1e3' : '#fff', color: coachTip.scores[k] >= 4 ? GREEN : coachTip.scores[k] <= 2 ? AMBER : INK, fontWeight: 600 }}>{k[0].toUpperCase() + k.slice(1)} {coachTip.scores[k]}/5</span>)}
          {coachTip.fillers > 0 && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: '#fdf1e3', color: AMBER, fontWeight: 600 }}>{coachTip.fillers} filler {coachTip.fillers === 1 ? 'word' : 'words'}</span>}
          {coachTip.pace && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: coachTip.pace === 'good' ? '#e8f3ec' : '#fdf1e3', color: coachTip.pace === 'good' ? GREEN : AMBER, fontWeight: 600 }}>Pace: {coachTip.pace}</span>}</div>
      </div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: MUTED, flexWrap: 'wrap' }}>
        <span>{caps.ai && signedIn ? 'AI client' : 'Basic mode'} · {caps.voices && signedIn ? 'real voices' : 'browser voice'}{narrow ? '' : ' · hold Space to talk'}</span><span style={{ flex: 1 }} />
        <button onClick={() => setCoachOn((v) => !v)} style={{ ...mini, fontSize: 10.5 }}>{coachOn ? 'Hide coach' : 'Show coach'}</button>
      </div>
      {!signedIn && (caps.ai || caps.voices) && <div style={{ fontSize: 11.5, color: MUTED }}>Sign in to ClarityFlow for the AI client and real voices.</div>}
    </div>
  );
  const greetEl = cur && !cur.greeted && !pay && !talkOn && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxWidth: 340 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>SAY</span>
      {R.greetOptions(cur.c).map((g) => <button key={g.text} onClick={() => { R.greet(s, g.q); drainSfx(); rerender(); }} style={{ ...rowBtn, padding: '7px 11px', fontSize: 13, textAlign: 'left', background: INK, color: '#fff', borderColor: INK, borderRadius: '14px 14px 4px 14px' }}>“{g.text}”</button>)}
    </div>
  );
  const client = shownC ? (
    <div style={{ display: 'flex', alignItems: narrow ? 'center' : 'flex-end', gap: narrow ? 10 : 18 }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end' }}>
        {shownC.party ? shownC.party.members.map((m, i) => { const now = cur?.parts ? R.payerName(s) === m.name : i === 0; return <div key={m.name} style={{ marginLeft: i ? (narrow ? -34 : -90) : 0, opacity: cur?.parts && !now ? 0.75 : 1, transform: now ? 'translateY(-6px)' : undefined, transition: 'all .3s', zIndex: now ? 2 : 1 }}><Person look={m.look} size={narrow ? 84 : 220} mood={cur?.mood ?? 0.9} /></div>; })
          : <Person look={shownC.look} size={narrow ? 120 : 300} mood={cur?.mood ?? 0.9} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: narrow ? 0 : 90 }}>
        <Say tone={cur && cur.mood < 0.3 ? 'warn' : cur?.claim === 'discount' || pay === 'approved' || pay === 'receipt' ? 'ok' : 'soft'}>{pay === 'receipt' ? 'Thank you! See you next time.' : pay === 'approved' ? 'Thank you!' : cur?.said}</Say>
        {!narrow && greetEl}
        {!narrow && talkEl}
        {!narrow && claimCard}
      </div>
    </div>
  ) : <div style={{ fontSize: 15, color: MUTED, padding: 40 }}>{waiting.length ? 'Next client is walking up…' : 'Nobody at the desk right now.'}</div>;

  const coachEl = coach && <div style={{ background: BLUE, color: '#fff', borderRadius: 14, padding: '10px 16px', fontSize: 14, fontWeight: 600, boxShadow: '0 14px 30px -14px rgba(37,99,235,.6)' }}>{coach}</div>;
  const toast = msg && !zoom && <div role="status" style={{ position: 'fixed', left: '50%', top: narrow ? 118 : 120, transform: 'translateX(-50%)', zIndex: 40, background: msg.tone === 'ok' ? '#eaf6ef' : msg.tone === 'warn' ? '#fdf6ec' : '#fdecec', color: msg.tone === 'ok' ? GREEN : msg.tone === 'warn' ? AMBER : RED, border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, boxShadow: '0 10px 24px -14px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>{msg.text}</div>;
  const roomEl = showRoom && <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,23,26,.45)', zIndex: 55, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
    <div style={{ background: '#fff', borderRadius: 22, padding: 20, width: 'min(460px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 17, flex: 1 }}>Two players</b><Btn small ghost onClick={() => setShowRoom(false)}>Done</Btn></div>
      <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>One person works the desk. The other plays the client on a second device facing them (an iPad is perfect): choosing the tip, tapping the card, keeping the change, picking a next visit and answering offers.</div>
      {!roomUi ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={() => openRoom(false)}>Connect a client screen</Btn><Btn ghost onClick={() => openRoom(true)}>Use a second tab on this computer</Btn></div>
        : <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {roomUi.qr && <img src={roomUi.qr} alt="Scan to open the client screen" width={150} height={150} style={{ borderRadius: 12, border: `1px solid ${LINE}` }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 12, color: MUTED }}>On the other device, open</div>
            <b style={{ fontSize: 13 }}>{typeof window !== 'undefined' ? window.location.host : ''}/practice/client</b>
            <div style={{ fontSize: 12, color: MUTED }}>and enter the code</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '.2em' }}>{roomUi.id}</div>
            {roomUi.local && <a href={`/practice/client?room=${roomUi.id}&local=1`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>Open the client screen in a new tab</a>}
            <Chip tone={roomUi.on ? 'green' : 'amber'}>{roomUi.on ? 'Client screen connected' : 'Waiting for the client screen…'}</Chip>
          </div>
        </div>}
    </div>
  </div>;
  const waitEl = waitingClient && <div style={{ position: 'fixed', left: '50%', bottom: narrow ? 10 : 18, transform: 'translateX(-50%)', zIndex: 45, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '7px 8px 7px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 12px 26px -14px rgba(0,0,0,.45)', fontSize: 13 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: BLUE }} />Waiting for the client screen…<button style={mini} onClick={chooseForThem}>Choose for them</button></div>;
  const printEl = rc && <div id="cf-print" style={{ display: 'none' }}><ReceiptPaper r={rc} width="72mm" /></div>;
  const pauseEl = paused && <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,23,26,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}><div style={{ background: '#fff', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}><b style={{ fontSize: 18 }}>Paused</b><Btn onClick={() => setPaused(false)}>Resume</Btn></div></div>;

  if (narrow) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#f6f3ef,#efe9e2)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, display: 'flex', flexDirection: 'column', gap: 10, padding: 10, boxSizing: 'border-box' }}>
      <Fonts />{hud}{coachEl}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{queue}</div>
      {client}{greetEl}{talkEl}{claimCard}
      <div style={{ background: '#16171a', borderRadius: 16, padding: 7 }}>{pos || saleDone}</div>
      {clientScreen}
      {receiptPanel && <div style={{ paddingTop: 250, display: 'flex', justifyContent: 'center' }}>{receiptPanel}</div>}
      <div style={{ background: 'linear-gradient(180deg,#f4f4f6,#dfdfe3)', borderTop: '4px solid #fff', borderRadius: 16, padding: 8 }}>{counter}</div>
      {zoom && <div style={{ position: 'fixed', left: 8, right: 8, bottom: 8, zIndex: 20 }}>{zoom}</div>}
      {drawerPanel && <div style={{ position: 'fixed', left: 6, right: 6, bottom: 6, zIndex: 20, maxHeight: '70vh', overflow: 'auto' }}>{drawerPanel}</div>}
      {camera && <CameraScanner onCode={onCamera} onClose={() => setCamera(false)} />}
      {toast}{roomEl}{waitEl}{printEl}
      {pauseEl}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, background: 'linear-gradient(180deg,#f6f3ef 0%,#f1ece6 58%,#ece6df 100%)' }}>
      <Fonts />
      {/* the salon behind the client */}
      <div style={{ position: 'absolute', left: '50%', top: 70, width: 420, height: 280, transform: 'translateX(-10%)', borderRadius: 16, background: '#fbfaf8', boxShadow: 'inset 0 0 0 10px #fff, 0 20px 40px -30px rgba(0,0,0,.4)' }} />
      <div style={{ position: 'absolute', right: 70, top: 160, width: 84, height: 210, borderRadius: '42px 42px 10px 10px', background: 'radial-gradient(circle at 40% 30%,#7fb27a,#2f6b3a)' }} />
      <div style={{ position: 'absolute', right: 88, top: 350, width: 48, height: 60, borderRadius: '6px 6px 14px 14px', background: '#efe9e2', boxShadow: 'inset 0 0 0 2px #e2dbd2' }} />
      <div style={{ position: 'absolute', left: 16, right: 16, top: 14, zIndex: 5 }}>{hud}</div>
      <div style={{ position: 'absolute', right: 24, top: 74, zIndex: 5 }}>{queue}</div>
      {coachEl && <div style={{ position: 'absolute', left: '50%', top: 74, transform: 'translateX(-50%)', zIndex: 6 }}>{coachEl}</div>}
      <div style={{ position: 'absolute', left: '38%', bottom: '40%', zIndex: 1 }}>{client}</div>
      {/* the counter */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', background: 'linear-gradient(180deg,#f4f4f6 0%,#e9e9ec 40%,#dfdfe3 100%)', borderTop: '8px solid #fff', zIndex: 2 }} />
      <div style={{ position: 'absolute', left: 28, bottom: 34, width: 'min(430px, 34vw)', height: 'min(430px, 58vh)', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ background: '#16171a', borderRadius: 16, padding: 8, width: '100%', height: '100%', boxSizing: 'border-box', boxShadow: '0 26px 40px -20px rgba(0,0,0,.6)' }}>{pos || saleDone}</div>
      </div>
      <div style={{ position: 'absolute', left: 'calc(min(430px, 34vw) + 70px)', bottom: 40, zIndex: 3 }}>{counter}</div>
      <div style={{ position: 'absolute', right: 400, bottom: 40, zIndex: 4 }}>{receiptPanel || <ReceiptPrinter r={null} printing={false} />}</div>
      <div style={{ position: 'absolute', right: 40, bottom: 40, zIndex: 3 }}>{clientScreen || (cur && <Reader amount={money(total)} line1="Waiting for payment" />)}</div>
      {zoom && <div style={{ position: 'absolute', left: '50%', bottom: 30, transform: 'translateX(-30%)', zIndex: 10 }}>{zoom}</div>}
      {drawerPanel && <div style={{ position: 'absolute', left: 'calc(min(430px, 34vw) + 50px)', right: 390, bottom: 24, zIndex: 10, display: 'flex', justifyContent: 'center' }}>{drawerPanel}</div>}
      {camera && <CameraScanner onCode={onCamera} onClose={() => setCamera(false)} />}
      {toast}{roomEl}{waitEl}{printEl}
      {pauseEl}
    </div>
  );
}

// ── Menu and review ─────────────────────────────────────────────────────
function Shell({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#f6f3ef,#ece6df)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}><Fonts />{children}</div>;
}
function Fonts() { return <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'); @keyframes regBeam { from { opacity: .55 } to { opacity: 1 } } #cf-print { display: none } @media print { body * { visibility: hidden !important } #cf-print, #cf-print * { visibility: visible !important } #cf-print { display: block !important; position: fixed; left: 0; top: 0 } @page { size: 80mm auto; margin: 3mm } }`}</style>; }
const cardS = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '22px 24px', display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%', boxShadow: '0 30px 60px -36px rgba(22,23,26,.5)' };

function MenuCard({ onStart, code, onCode }: { onStart: () => void; code: $.CurrencyCode; onCode: (c: $.CurrencyCode) => void }) {
  return (
    <div style={{ ...cardS, maxWidth: 580 }}>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT · BEHIND THE DESK</div>
      <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em' }}>Work the register</div>
      <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>Six clients, a growing line, and the slips that happen on a busy Saturday. Scan their products, fix what goes wrong, and take payment. Nothing real is charged.</div>
      <div style={{ background: SOFT, borderRadius: 14, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}>
        <b>You’ll practice</b><br />Scanning · labels that won’t read · double scans · voids with a reason · a shelf price that doesn’t match · a health flag · cash and change · closing the drawer
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>CURRENCY</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8 }}>
          {$.CODES.map((c) => { const cu = $.CURRENCIES[c]; const on = c === code; return <button key={c} onClick={() => onCode(c)} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 14, padding: '9px 10px', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
            <span style={{ width: 26, height: 26, borderRadius: 13, background: on ? '#fff' : SOFT, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{cu.symbol}</span>
            <span><b style={{ fontSize: 13, display: 'block' }}>{c}</b><span style={{ fontSize: 11, opacity: 0.75 }}>{$.fmt(c, 2350)}</span></span></button>; })}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>{$.CURRENCIES[code].notes.slice(-3).reverse().map((n) => <Cash key={n.value} code={code} value={n.value} size={0.6} />)}{$.CURRENCIES[code].coins.slice(0, 3).map((k) => <Cash key={k.value} code={code} value={k.value} size={0.9} />)}</div>
        <div style={{ fontSize: 12, color: MUTED }}>{$.CURRENCIES[code].tip} Practice notes and coins, not real ones.</div>
      </div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 26 }}>🔦</span>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}><b>Have a real barcode scanner?</b><br /><span style={{ color: MUTED }}>Plug it in (USB or Bluetooth), print the practice sheet, and scan the products for real.</span></div>
        <a href="/practice/register/sheet" target="_blank" rel="noreferrer" style={{ ...pill, textDecoration: 'none', color: INK }}>Practice sheet</a>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Btn onClick={onStart}>Start the register</Btn><a href="/practice" style={{ fontSize: 13, color: MUTED, marginLeft: 8 }}>← Back to the salon floor</a></div>
    </div>
  );
}

function CloseOutCard({ s, narrow, counts, setCounts, onDone, rerender }: { s: R.RegState; narrow: boolean; counts: Record<number, number>; setCounts: (f: (c: Record<number, number>) => Record<number, number>) => void; onDone: () => void; rerender: () => void }) {
  const f = (c: number) => $.fmt(s.currency, c); const counted = $.drawerTotal(counts); const res = s.close;
  return (
    <div style={{ ...cardS, maxWidth: 980, maxHeight: '94vh', overflow: 'auto' }}>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>END OF SHIFT</div>
      <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em' }}>Close out the drawer</div>
      <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>Count every slot and enter how many of each you have. The register works out what should be there; you count what is there. The drawer started with a {f(s.float)} float.</div>
      <div style={{ overflowX: 'auto' }}><CashDrawer code={s.currency} drawer={s.drawer} counts={counts} setCount={res ? undefined : (v, n) => setCounts((c) => ({ ...c, [v]: n }))} narrow={narrow} /></div>
      {!res ? <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><span style={{ fontSize: 14 }}>You counted <b>{f(counted)}</b></span><span style={{ flex: 1 }} /><Btn onClick={() => { R.closeOut(s, counts); rerender(); }}>Submit the count</Btn></div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {[['Should be there', f(res.expected)], ['You counted', f(res.counted)], ['Actually there', f(res.actual)], ['Over / short', res.overShort === 0 ? 'Balanced' : `${f(Math.abs(res.overShort))} ${res.overShort < 0 ? 'short' : 'over'}`]].map(([k, v]) => <div key={k} style={{ background: SOFT, borderRadius: 12, padding: '10px 12px' }}><div style={{ fontSize: 11.5, color: MUTED }}>{k}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div></div>)}
        </div>}
      {res && <div style={{ fontSize: 13, color: res.countOff === 0 ? GREEN : AMBER, fontWeight: 600 }}>{res.countOff === 0 ? 'Your count matched the drawer exactly.' : `Your count was off by ${f(Math.abs(res.countOff))}: check the ${res.off.map((v) => $.denomLabel(s.currency, v)).join(', ')}.`}</div>}
      {res && <div><Btn onClick={onDone}>See the shift review</Btn></div>}
    </div>
  );
}

function ReviewCard({ s, onAgain }: { s: R.RegState; onAgain: () => void }) {
  const rv = R.review(s);
  return (
    <div style={{ ...cardS, maxWidth: 720, maxHeight: '92vh', overflow: 'auto' }}>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>SHIFT REVIEW · REGISTER</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ fontSize: 26, fontWeight: 300 }}>{rv.stars === 3 ? 'A clean register' : rv.stars === 2 ? 'Good shift, a few slips' : 'A tough Saturday'}</div><div style={{ fontSize: 26, color: '#d29a1e' }}>{'★'.repeat(rv.stars)}<span style={{ color: LINE }}>{'★'.repeat(3 - rv.stars)}</span></div></div>
      {rv.best && <div style={{ background: '#eaf6ef', color: GREEN, borderRadius: 12, padding: '9px 12px', fontSize: 13.5, fontWeight: 600 }}>Best moment: {rv.best}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        {[['Checkouts', String(rv.checkouts)], ['Accuracy', `${rv.accuracy}%`], ['Avg checkout', `${rv.avgSeconds}s`], ['Best streak', String(rv.bestStreak)], ['Points', String(rv.points)]].map(([k, v]) => <div key={k} style={{ background: SOFT, borderRadius: 12, padding: '10px 12px' }}><div style={{ fontSize: 11.5, color: MUTED }}>{k}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div></div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        {[['Rebooked', `${rv.sales.rebooks} of ${rv.sales.rebookChances}`], ['Memberships sold', String(rv.sales.members)], ['Packages sold', String(rv.sales.packages)]].map(([k, v]) => <div key={k} style={{ background: '#f2f8f4', borderRadius: 12, padding: '10px 12px' }}><div style={{ fontSize: 11.5, color: MUTED }}>{k}</div><div style={{ fontSize: 20, fontWeight: 700, color: GREEN }}>{v}</div></div>)}
      </div>
      {rv.drawer && <div style={{ background: rv.drawer.overShort === 0 ? '#eaf6ef' : '#fdf6ec', color: rv.drawer.overShort === 0 ? GREEN : '#9a4a07', borderRadius: 12, padding: '9px 12px', fontSize: 13.5, fontWeight: 600 }}>
        {rv.drawer.overShort === 0 ? 'Drawer balanced at close.' : `Drawer ${$.fmt(s.currency, Math.abs(rv.drawer.overShort))} ${rv.drawer.overShort < 0 ? 'short' : 'over'} at close.`}{rv.tipJar ? ` Cash tips in the tip jar: ${$.fmt(s.currency, rv.tipJar)}.` : ''}</div>}
      {s.talk.length > 0 && (() => { const avg = T.averageScores(s.talk.map((x) => x.scores))!; const fill = s.talk.reduce((a, x) => a + x.fillers, 0); const paces = s.talk.map((x) => x.wpm).filter((x): x is number => !!x);
        const best = [...s.talk].sort((a, b) => (b.scores.awareness + b.scores.confidence + b.scores.warmth + b.scores.retention) - (a.scores.awareness + a.scores.confidence + a.scores.warmth + a.scores.retention))[0];
        const tips = [...new Set(s.talk.filter((x) => x.scores.awareness + x.scores.confidence + x.scores.warmth + x.scores.retention < 15).map((x) => x.tip).filter(Boolean))].slice(0, 3);
        return <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b style={{ fontSize: 15 }}>How you spoke · {s.talk.length} {s.talk.length === 1 ? 'line' : 'lines'}</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6 }}>{(['awareness', 'confidence', 'warmth', 'retention'] as const).map((k) => <div key={k} style={{ background: SOFT, borderRadius: 10, padding: '7px 10px' }}><div style={{ fontSize: 11, color: MUTED }}>{k === 'awareness' ? 'Situational awareness' : k[0].toUpperCase() + k.slice(1)}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{avg[k]}/5</div></div>)}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{fill} filler {fill === 1 ? 'word' : 'words'}{paces.length ? ` · average pace ${Math.round(paces.reduce((a, b) => a + b, 0) / paces.length)} words a minute` : ''}</div>
          {best && <div style={{ fontSize: 13 }}><b style={{ color: GREEN }}>Best line:</b> “{best.you}” <span style={{ color: MUTED }}>to {best.who}</span></div>}
          {tips.map((t) => <div key={t} style={{ fontSize: 12.5, display: 'flex', gap: 6 }}><span style={{ color: BLUE }}>→</span>{t}</div>)}
        </div>; })()}
      <b style={{ fontSize: 15, marginTop: 4 }}>{rv.mistakes.length ? 'What happened after you rang them up' : 'Nothing came back to bite you. Nice work.'}</b>
      {rv.mistakes.map((m, i) => (
        <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 5, background: m.minor ? '#fff' : '#fffaf5' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{m.what}{m.minor && <span style={{ marginLeft: 8 }}><Chip>Training moment</Chip></span>}</div>
          <div style={{ fontSize: 13, color: RED, display: 'flex', gap: 6 }}><span>↳</span><span>{m.later}</span></div>
          <div style={{ fontSize: 13, color: GREEN, display: 'flex', gap: 6 }}><span>✓</span><span>{m.right}</span></div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={onAgain}>Play again</Btn><a href="/practice" style={{ ...pill, textDecoration: 'none', color: INK, padding: '11px 18px' }}>Salon floor</a></div>
    </div>
  );
}

const pill = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: INK } as const;
const mini = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: INK } as const;
const seg = { border: 'none', borderRadius: 999, padding: '6px 11px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: INK } as const;
const input = { flex: 1, border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' } as const;
const rowBtn = { display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', color: INK } as const;
