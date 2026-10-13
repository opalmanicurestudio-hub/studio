'use client';
// Practice a shift: behind the front desk. A register point of view with real
// scanning (on-screen, typed, or a real USB / Bluetooth scanner), the client in
// front of you, the line behind them, and slips that show up in the shift review.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as R from '@/lib/practice/register';
import * as $ from '@/lib/practice/currency';
import * as Room from '@/lib/practice/room';
import * as T from '@/lib/practice/talk';
import { Mic, BrowserEars } from '@/lib/practice/mic';
import { LiveFace } from '@/lib/practice/face';
import { isEcho, listenError, encodeWav } from '@/lib/practice/vad';
import { autoPick, browserVoices, type Pick as VPick, type Preset, type VoiceOpt } from '@/lib/practice/voices';
import { VoicePicker, VoiceCheck, type CheckRow } from './voice-panels';
import { PhoneDock, CallCard, CallReviewCard } from './phone-panel';
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
  ring: () => { for (let i = 0; i < 6; i++) { tone(i % 2 ? 1250 : 1000, 0.07, 'sine', i * 0.08, 0.035); } },
  chime: () => { tone(784, 0.18); tone(1047, 0.25, 'sine', 0.12); },
  tap: () => tone(600, 0.04, 'triangle', 0, 0.03),
};
const muted = () => { try { return localStorage.getItem('cf_practice_mute') === '1'; } catch { return false; } };

const CUR_KEY = 'cf_practice_currency';
const VOICE_KEY = 'cf_practice_voice';
const TALK_KEY = 'cf_practice_talk';
/** Clients talk: the browser's own speech voices, a different pitch and pace for each client. */
function speak(text: string, v: { pitch: number; rate: number }, pron: string, onEnd?: () => void, voiceURI?: string | null, speed = 1) {
  try {
    const ss = window.speechSynthesis; if (!ss) { onEnd?.(); return; } ss.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, '')); u.pitch = v.pitch; u.rate = Math.max(0.5, Math.min(2, v.rate * speed)); u.lang = 'en-US';
    const all = ss.getVoices(); const chosen = voiceURI ? all.find((x) => x.voiceURI === voiceURI) : null;
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; u.pitch = 1; u.onend = () => onEnd?.(); u.onerror = () => onEnd?.(); ss.speak(u); return; }
    const voices = all.filter((x) => x.lang.startsWith('en'));
    // Prefer the most natural-sounding voices the device has.
    voices.sort((a, b) => Number(/natural|neural|enhanced|premium|google/i.test(b.name)) - Number(/natural|neural|enhanced|premium|google/i.test(a.name)));
    const fem = /female|samantha|victoria|karen|zira|susan|serena|moira|tessa|fiona|ava|allison|jenny|aria/i, mal = /male|daniel|alex|fred|david|guy|tom|aaron|arthur|oliver/i;
    const pick = voices.find((x) => (pron === 'he' ? mal.test(x.name) && !/female/i.test(x.name) : fem.test(x.name))) || voices[0];
    if (pick) u.voice = pick; u.onend = () => onEnd?.(); u.onerror = () => onEnd?.(); ss.speak(u);
  } catch { onEnd?.(); }
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
    const p = new URLSearchParams(window.location.search); const f = Number(p.get('fast')); if (f > 0) { speed.current = f; if (p.get('ears') === 'cloud') setTestEars(true); (window as any).__register = { s: () => sRef.current, rerender, codes: Object.fromEntries(R.SKUS.map((k) => [k.key, k.code])) }; }
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
      const talkingNow = ['thinking', 'client', 'hearing'].includes(talkStateRef.current) || face.current?.state === 'connecting';
      if (!(st.pace === 'relaxed' && talkingNow)) R.advance(st, 0.25 * speed.current);
      if (st.cur && st.cur.c.id !== had) { setSel(null); setMsg(null); setFlag(null); setNote(null); setVoidFor(null); setMode('scan'); setDetails({ phone: '', email: '', promo: false }); }
      if (st.ringing && (st.t - st.ringing.since) % 3 < 0.25 * speed.current && !muted()) SFX.ring();
      drainSfx();
      if (R.finished(st) && !pay) { R.phoneWrapUp(st); window.setTimeout(() => setScreen(st.mode === 'drill' ? 'review' : 'closeout'), 500); }
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
  const [shift, setShift] = useState<R.PhoneMode>('full'); const [pace, setPace] = useState<R.Pace>('relaxed'); const [callsOpt, setCallsOpt] = useState<'off' | 'few' | 'busy'>('few'); const [drillWho, setDrillWho] = useState('rosa');
  const start = () => { sRef.current = R.newRegister(code, shift, { pace, calls: shift === 'phones' ? 'busy' : callsOpt, client: drillWho }); setSeenRv(0); setScreen('play'); setSel(null); setMsg(null); setPay(null); setFlag(null); setPaused(false); setHand([]); setTendered(null); setCounts({}); rerender(); };
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
  const twoP = !!roomUi?.on; const twoPRef = useRef(twoP); twoPRef.current = twoP;
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

  // ── Checking guests in, and the phone ──────────────────────────────────
  const [arrQ, setArrQ] = useState(''); const [callQ, setCallQ] = useState(''); const [formWait, setFormWait] = useState<string | null>(null);
  const [lateCourtesy, setLateCourtesy] = useState(false);
  const truthOf = (st: R.RegState) => { const c = st.cur!.c; const b = R.bookingBy(st, c.booking || null); return { name: b?.name || c.name, phone: c.details?.phone || b?.phone || '', email: c.details?.email || b?.email || '', promo: c.details?.promo || false }; };
  const consentText = (svc: string, provider: string) => `${svc} with ${provider} · Opal Salon\n\n• I’ve told my provider about any allergies, sensitivities, medications, or skin, scalp or nail conditions.\n• I understand results vary and aren’t guaranteed.\n• I was offered a patch test where it applies.\n• I’ll follow the aftercare I’m given.\n• I can ask questions or stop the service at any time.\n\nPractice form: nothing is stored.`;
  /** The client checks or updates their own details on the client screen. */
  const sendDetails = (forCheckout = false) => {
    const st = sRef.current; if (!st.cur) return; const c = st.cur.c; const b = R.bookingBy(st, st.cur.arr?.booking || c.booking || null); const tr = truthOf(st);
    setFormWait('details');
    ask({ stage: 'details', who: c.name, title: c.kind === 'new' ? 'Welcome! Your details' : 'Is this still right?', note: c.kind === 'new' ? 'So we can send your reminders and receipts.' : 'Update anything that’s changed.', prefill: { name: b?.name || c.name, phone: c.kind === 'new' ? '' : b?.phone || '', email: c.kind === 'new' ? '' : b?.email || '' } },
      () => JSON.stringify({ phone: tr.phone, email: tr.email, promo: tr.promo }), 2200)
      .then((raw) => { let v = { phone: '', email: '', promo: false }; try { v = JSON.parse(String(raw)); } catch { /* keep empty */ } const st2 = sRef.current; setFormWait(null); if (!st2.cur) return;
        if (forCheckout) R.saveContact(st2, v); else R.confirmDetails(st2, v, 'client'); setDetails({ phone: v.phone, email: v.email, promo: v.promo }); rerender(); });
  };
  const sendConsent = () => {
    const st = sRef.current; if (!st.cur) return; const b = R.bookingBy(st, st.cur.arr?.booking || null); if (!b) return; setFormWait('consent');
    ask({ stage: 'consent', who: st.cur.c.name, title: `${b.service} consent form`, text: consentText(b.service, b.provider), prefill: { name: b.name, phone: '', email: '' } }, () => JSON.stringify({ signed: true, name: b.name }), 2600)
      .then(() => { setFormWait(null); if (sRef.current.cur) { R.signConsent(sRef.current, 'client'); rerender(); } });
  };
  const doneArrival = () => { R.finishArrival(s); drainSfx(); setArrQ(''); setLateCourtesy(false); view({ stage: 'idle' }); rerender(); };
  const excuseMe = () => { if (!s.ringing || !s.cur) return; excusedFor.current = s.ringing.call.id; s.cur.said = 'Of course, go ahead.'; s.cur.history?.push({ who: 'you', text: `Excuse me one moment, ${s.cur.c.name}.` }, { who: 'client', text: 'Of course, go ahead.' }); rerender(); };
  const answerCall = () => { primePlayer(); const excused = !s.cur || excusedFor.current === s.ringing?.call.id; R.answer(s, excused); excusedFor.current = null; drainSfx(); rerender(); };
  const phoneDone = () => { stopAudio.current?.(); drainSfx(); rerender(); };

  // ── Talking out loud: your mic, the client's real voice, and a coach ──
  const [talkOn, setTalkOn] = useState(false);
  const [coachOn, setCoachOn] = useState(true);
  const [caps, setCaps] = useState({ ai: false, voices: false, listen: false, faces: false });
  const [signedIn, setSignedIn] = useState(false);
  /** idle = mic off · listening = open, waiting for you · hearing = you're talking · thinking = the client is working out a reply · client = the client is talking */
  const [talkState, setTalkStateRaw] = useState<'idle' | 'listening' | 'hearing' | 'thinking' | 'client'>('idle');
  const talkStateRef = useRef(talkState); const setTalkState = (v: typeof talkState) => { talkStateRef.current = v; setTalkStateRaw(v); };
  const [handsFree, setHandsFree] = useState(true);
  const [interim, setInterim] = useState('');
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]); const [micId, setMicId] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false);
  const micBtn = useRef<HTMLButtonElement | null>(null);
  const loud = useRef({ max: 0, since: 0 });
  const lastClientLine = useRef<string | null>(null);
  const stopAudio = useRef<(() => void) | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [coachTip, setCoachTip] = useState<{ tip: string; scores: T.Scores; fillers: number; pace: string | null } | null>(null);
  const [typedLine, setTypedLine] = useState('');
  const [talkErr, setTalkErr] = useState<string | null>(null);
  const toneRef = useRef('neutral');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const payRef = useRef(pay); payRef.current = pay;
  const flagRef = useRef(flag); flagRef.current = flag;
  useEffect(() => {
    try { if (localStorage.getItem(TALK_KEY) === '1') setTalkOn(true); } catch { /* private mode */ }
    fetch('/api/practice/status').then((r) => r.json()).then((d) => setCaps({ ai: !!d.ai, voices: !!d.voices, listen: !!d.listen, faces: !!d.faces })).catch(() => {});
    const off = auth?.onAuthStateChanged?.((u) => setSignedIn(!!u && !u.isAnonymous)); return () => off?.();
  }, [auth]);
  const idToken = async () => { const u = auth?.currentUser; if (!u || u.isAnonymous) return null; try { return await u.getIdToken(); } catch { return null; } };
  const OFFER_NAMES = Object.fromEntries(R.OFFERS.map((o) => [o.key, o.name]));
  // ── Client voices: matched, mixed accents, fast talkers, or clear and slow. Chosen per person, remembered on this device. ──
  const [voiceOpts, setVoiceOpts] = useState<VoiceOpt[]>([]); const picks = useRef<Record<string, VPick>>({});
  const [preset, setPreset] = useState<Preset>('matched'); const [phoneFx, setPhoneFx] = useState(true);
  const [panel, setPanel] = useState<null | 'voices' | 'check'>(null); const panelRef = useRef(panel); panelRef.current = panel;
  const lastSpeakErr = useRef<string | null>(null);
  const checkLevel = useRef(0); const [faceChk, setFaceChk] = useState<{ ok: boolean; text: string } | null>(null); const [seenRv, setSeenRv] = useState(0);
  const [chk, setChk] = useState<{ mic: boolean | null; heard: string | null | false; voice: boolean | null; ai: { ok: boolean; text: string } | null; busy: string | null }>({ mic: null, heard: null, voice: null, ai: null, busy: null });
  const everyone = () => [...R.PEOPLE.map((c) => ({ id: c.id, name: c.party ? 'Maya' : c.name, voiceHint: c.voiceHint, line: c.hello, role: 'desk' as const })), ...[...R.CALLS, ...R.OVERNIGHT].map((c) => ({ id: c.id, name: c.name, voiceHint: c.voiceHint, line: c.opener, role: 'call' as const }))];
  const savePicks = (pr: Preset) => { try { localStorage.setItem('cf_practice_voice_picks', JSON.stringify({ preset: pr, picks: picks.current, phone: phoneFxRef.current })); } catch { /* private mode */ } };
  const phoneFxRef = useRef(phoneFx); phoneFxRef.current = phoneFx;
  const loadVoices = async (pr?: Preset) => {
    let opts: VoiceOpt[] = [];
    if (caps.voices) { const tk = await idToken(); if (tk) { try { const r = await fetch('/api/practice/voices', { headers: { authorization: `Bearer ${tk}` } }); const d = await r.json(); if (d.ok) opts = d.voices.map((v: Omit<VoiceOpt, 'src'>) => ({ ...v, src: 'eleven' as const })); else lastSpeakErr.current = d.error || null; } catch { /* device voices */ } } }
    if (!opts.length) opts = browserVoices(typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices() : []);
    setVoiceOpts(opts);
    let saved: { preset?: Preset; picks?: Record<string, VPick>; phone?: boolean } = {}; try { saved = JSON.parse(localStorage.getItem('cf_practice_voice_picks') || '{}'); } catch { /* none */ }
    const usePreset = pr || saved.preset || 'matched'; setPreset(usePreset); if (typeof saved.phone === 'boolean') setPhoneFx(saved.phone);
    const kept = pr ? {} : Object.fromEntries(Object.entries(saved.picks || {}).filter(([, v]) => opts.some((o) => o.id === v.id)));
    picks.current = { ...autoPick(everyone(), opts, usePreset), ...kept };
  };
  useEffect(() => { const ss = typeof window !== 'undefined' ? window.speechSynthesis : null; if (!ss) return; const h = () => { if (!caps.voices || !signedIn) loadVoices(); }; ss.addEventListener?.('voiceschanged', h); return () => ss.removeEventListener?.('voiceschanged', h); }, [caps.voices, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const assignVoices = () => loadVoices();

  // ── Playing voices: one player, unlocked by a tap (iPad and Safari block sound that starts later), with a phone-line sound for callers ──
  const player = useRef<{ ctx: AudioContext; el: HTMLAudioElement; phone: GainNode; direct: GainNode } | null>(null);
  const primePlayer = () => {
    try {
      if (player.current) { player.current.ctx.resume().catch(() => {}); return; }
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext; const ctx = new AC();
      const el = new Audio(); el.preload = 'auto'; (el as any).playsInline = true; el.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(el); const direct = ctx.createGain(); const phone = ctx.createGain(); phone.gain.value = 0;
      // A phone line only carries roughly 300–3,400 Hz: thinner, like a real call.
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 330; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; const boost = ctx.createGain(); boost.gain.value = 1.6;
      src.connect(direct); direct.connect(ctx.destination); src.connect(hp); hp.connect(lp); lp.connect(boost); boost.connect(phone); phone.connect(ctx.destination);
      ctx.resume().catch(() => {}); el.src = URL.createObjectURL(new Blob([encodeWav(new Float32Array(1600)).buffer as ArrayBuffer], { type: 'audio/wav' })); el.play().catch(() => {});
      player.current = { ctx, el, phone, direct };
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis?.speak(u); } catch { /* none */ }
    } catch { /* plain audio */ }
  };
  /** Clients speak: their chosen real voice when connected (played as it arrives), otherwise this device's voices. */
  const sayOut = async (text: string, c: R.Customer, tone: string, phone = false, force = false) => {
    stopAudio.current?.(); lastClientLine.current = text;
    let done = false; const finished = () => { if (done) return; done = true; stopAudio.current = null; if (micRef.current) micRef.current.clientTalking = false; if (talkStateRef.current === 'client') { setTalkState(resting()); earsRef.current && handsFreeRef.current && talkOnRef.current && earsRef.current.listen(); } };
    const begin = () => { lastVoiceOk.current = true; if (talkOnRef.current) { setTalkState('client'); if (micRef.current) micRef.current.clientTalking = true; earsRef.current?.pause(); } };
    const pick = picks.current[c.id]; const tk = caps.voices && pick?.src === 'eleven' ? await idToken() : null;
    // Face to face: her voice goes into the live face, which speaks and moves its lips.
    const f = face.current;
    if (tk && pick && !phone && f && f.state === 'live' && f.who === c.id) {
      try {
        const r = await fetch('/api/practice/speak', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ text, voiceId: pick.id, tone, speed: pick.speed, format: 'pcm' }) });
        if (r.ok && r.body) {
          lastSpeakErr.current = null; const t0 = performance.now(); let timer = 0;
          stopAudio.current = () => { window.clearTimeout(timer); f.interrupt(); finished(); };
          begin(); const ms = await f.say(r.body);
          if (!done) timer = window.setTimeout(finished, Math.max(300, ms - (performance.now() - t0) + 500));
          return;
        }
        const d = await r.json().catch(() => ({})); lastSpeakErr.current = d.error || null;
      } catch { /* fall back to plain voice */ }
    }
    if (tk && pick) {
      try {
        const r = await fetch('/api/practice/speak', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ text, voiceId: pick.id, tone, speed: pick.speed }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); lastSpeakErr.current = d.error || `The voice service answered ${r.status}.`; }
        if (r.ok && r.body) {
          lastSpeakErr.current = null; try { window.speechSynthesis?.cancel(); } catch { /* none */ }
          const MS: typeof MediaSource | undefined = (window as any).MediaSource;
          const P = player.current; if (P) { P.ctx.resume().catch(() => {}); }
          const routed = !!P && P.ctx.state === 'running';
          let a: HTMLAudioElement; let url: string; let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
          if (MS && MS.isTypeSupported('audio/mpeg')) {
            // Play while it downloads: the first words start in a fraction of a second.
            const ms = new MS(); url = URL.createObjectURL(ms); reader = r.body.getReader();
            ms.addEventListener('sourceopen', async () => {
              try {
                const sb = ms.addSourceBuffer('audio/mpeg');
                for (;;) { const { done: end, value } = await reader!.read(); if (end) break; if (value?.length) { sb.appendBuffer(value); await new Promise((ok) => sb.addEventListener('updateend', ok, { once: true })); } }
                if (ms.readyState === 'open') ms.endOfStream();
              } catch { /* stopped */ }
            }, { once: true });
          } else url = URL.createObjectURL(await r.blob());
          if (routed) { a = P!.el; a.pause(); a.src = url; P!.phone.gain.value = phone ? 1 : 0; P!.direct.gain.value = phone ? 0 : 1; } else { audioRef.current?.pause(); a = new Audio(url); audioRef.current = a; }
          const watchdog = window.setTimeout(() => { if (!done && a.paused) { lastSpeakErr.current = 'The voice loaded but this browser didn’t play it.'; stopAudio.current?.(); speak(text, c.voice, c.pron); } }, 7000);
          stopAudio.current = () => { window.clearTimeout(watchdog); a.pause(); reader?.cancel().catch(() => {}); URL.revokeObjectURL(url); finished(); };
          a.onplaying = () => { window.clearTimeout(watchdog); begin(); }; a.onended = () => { window.clearTimeout(watchdog); URL.revokeObjectURL(url); finished(); }; a.onerror = () => { window.clearTimeout(watchdog); finished(); };
          await a.play().catch(() => { window.clearTimeout(watchdog); lastSpeakErr.current = 'This browser blocked the sound. Tap the mic or the page once, then try again.'; finished(); speak(text, c.voice, c.pron); });
          return;
        }
      } catch { lastSpeakErr.current = 'Couldn’t reach the voice service.'; }
    }
    if (!force && !voice) { finished(); return; }
    begin(); stopAudio.current = () => { try { window.speechSynthesis?.cancel(); } catch { /* none */ } finished(); };
    const sp = pick?.speed || 1;
    // Some browsers never say when they've finished speaking: don't wait forever.
    window.setTimeout(finished, 1500 + (text.split(/\s+/).length / 2.6) * 1000 / Math.max(0.6, (c.voice?.rate || 1) * sp));
    speak(text, c.voice, c.pron, finished, pick?.src === 'browser' ? pick.id : null, sp);
  };
  const lastVoiceOk = useRef(false);

  // ── Face to face: a live, photo-real face for the client at the desk ──
  const [faceOn, setFaceOn] = useState(false); const [facePaused, setFacePaused] = useState<string | null>(null);
  const [, faceTick] = useState(0); const face = useRef<LiveFace | null>(null);
  if (!face.current && typeof window !== 'undefined') face.current = new LiveFace(() => faceTick((n) => n + 1));
  useEffect(() => { try { setFaceOn(localStorage.getItem('cf_practice_face') === '1'); } catch { /* private mode */ } return () => { face.current?.stop(); }; }, []);
  const faceToken = async (character: string) => {
    const tk = await idToken(); if (!tk) return { ok: false, error: 'Sign in to ClarityFlow for live video.' };
    try { const r = await fetch('/api/practice/avatar', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ character }) }); return await r.json(); }
    catch { return { ok: false, error: 'Couldn’t reach the live video service.' }; }
  };
  const faceWho = faceOn && talkOn && screen === 'play' && caps.faces && caps.voices && signedIn && !twoP && cur && !s.onCall && facePaused !== cur.c.id ? cur.c.id : null;
  useEffect(() => { const f = face.current; if (!f) return; if (faceWho) f.start(faceWho, 'cf-face', () => faceToken(faceWho)); else f.stop(); }, [faceWho]); // eslint-disable-line react-hooks/exhaustive-deps
  // Save minutes: a quiet face for two minutes pauses until you tap it.
  useEffect(() => { const iv = window.setInterval(() => { const f = face.current; if (f?.state === 'live' && Date.now() - f.lastUsed > 60000 && f.who) { setFacePaused(f.who); } }, 15000); return () => window.clearInterval(iv); }, []);
  const toggleFace = () => { primePlayer(); const n = !faceOn; setFaceOn(n); setFacePaused(null); try { localStorage.setItem('cf_practice_face', n ? '1' : '0'); } catch { /* private mode */ } };

  const stageNow = (p: PayStep) => !p ? 'the ticket is open and not paid yet' : p === 'split' || p === 'method' ? 'staff is about to take payment' : p === 'declined' || p === 'decline-wait' ? 'your card was just declined' : p === 'chip' ? 'the reader showed a chip error' : p === 'offline' || p === 'reconnecting' ? 'the card reader is offline' : p.startsWith('cash') ? 'paying with cash' : p === 'receipt' ? 'paid; choosing a receipt' : 'paying by card';
  /** What the client knows right now, for the conversation. */
  const contextFor = (st: R.RegState) => {
    const cur2 = st.cur!; const c = cur2.c; const sh = R.slip(c, 'shelf');
    if (R.isArrival(c) && cur2.arr) {
      const b = R.bookingBy(st, c.booking || null)!; const a = cur2.arr; const late = R.minutesLate(st);
      return { name: c.name, persona: c.persona, kind: c.kind, visits: c.visits, service: b.service, provider: b.provider, items: [], total: '', prefersPay: 'card',
        rebook: { wants: 'not today; you just arrived', done: null }, offer: { wants: null, offered: [], catalog: [] },
        details: { phone: b.phone, email: b.email, promo: false, saved: !!a.details },
        mood: cur2.mood, waitedMinutes: Math.max(0, (cur2.start - c.arrive) / 2), lineLength: R.line(st).length,
        stage: `you just arrived for your ${b.when} ${b.service} with ${b.provider} and are checking in${late > R.GRACE_MIN ? `; you're ${late} minutes late` : ''}. ${a.booking ? 'They found your booking.' : 'They haven’t found your booking yet; your full name is ' + b.name + '.'} ${b.consentNeeded && !b.consentOnFile && !a.consent ? 'A consent form is needed; you are happy to sign it.' : ''}`,
        history: cur2.history };
    } const al = R.allergy(c); const fl = flagRef.current;
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
  /** On a call, what you say goes to the caller: it counts as the steps you'd tap, and the caller answers in character. */
  const callTalk = async (text: string, seconds: number | null) => {
    const st = sRef.current; const oc = st.onCall; if (!oc) return; setHeard(text); setTalkErr(null);
    if (/\bhold\b/i.test(text) && !oc.outcome) {
      const asked = /(may|can|could|would|do you mind|is it ok|okay if)[^.?!]*hold|\?/i.test(text);
      oc.history.push({ who: 'you', text }); R.holdCall(st, asked); drainSfx(); setTalkState(resting()); rerender(); return;
    }
    // Two players: the second player is the caller and answers out loud; we only count what you did.
    if (twoPRef.current) { R.detectActs(st, text).forEach((id) => R.act(st, id)); oc.history.push({ who: 'you', text }); drainSfx(); setTalkState(resting()); rerender(); return; }
    setTalkState('thinking');
    const basic = R.talkCall(st, text); // the steps you just did, and the scripted reply
    const brief = R.callerBrief(st, oc); const found = R.bookingBy(st, oc.found);
    const ctx = { name: oc.call.name, persona: `${oc.call.persona} ${brief.facts.join(' ')}`, kind: oc.call.known ? 'returning' : 'new', visits: 3, service: R.KIND_LABEL[oc.call.kind], provider: 'the salon', items: [], total: '', prefersPay: 'card',
      rebook: { wants: oc.call.prefers ? `you'd take ${oc.call.prefers}` : 'only what your goal says', done: oc.outcome && 'slot' in oc.outcome ? oc.outcome.slot : null },
      offer: { wants: null, offered: [], catalog: [] }, details: oc.call.facts.phone ? { phone: oc.call.facts.phone, email: oc.call.facts.email || '', promo: false, saved: false } : null,
      mood: oc.mood, waitedMinutes: 0, lineLength: 0,
      stage: `${oc.call.outbound ? 'the salon called you back' : 'you phoned the salon'}; on the phone with the front desk${found ? `; they found the booking for ${found.name}, ${found.when}` : ''}${oc.outcome ? `; done so far: ${oc.outcome.kind}` : ''}${basic.acts.length ? `; what they just did: ${basic.acts.join(', ')}` : ''}`, history: oc.history };
    let res: T.TalkReply | null = null; const tk = caps.ai ? await idToken() : null;
    if (tk) { try { const r = await fetch('/api/practice/talk', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ context: ctx, said: text }) }); const d = await r.json(); if (d.ok && d.mode === 'ai') res = d; } catch { /* basic */ } }
    const oc2 = sRef.current.onCall; if (!oc2) { setTalkState(resting()); return; }
    if (res?.detected.offeredRebook && !oc2.offeredAnotherDay && (oc2.call.kind === 'cancel' || oc2.call.kind === 'reschedule')) R.offerAnotherDay(st);
    const reply = res?.reply || basic.reply;
    oc2.history.push({ who: 'you', text }); oc2.history.push({ who: 'client', text: reply }); toneRef.current = res?.tone || 'neutral'; oc2.said = reply;
    const scores = res?.coach.scores || { awareness: 3, confidence: 4, warmth: oc2.did.greeted === 'great' ? 5 : 3, retention: 3 }; const tip = res?.coach.tip || (oc2.did.greeted !== 'great' ? 'Answer with the salon’s name, yours, and “How can I help?”' : 'Good. Read the details back before you hang up.');
    const dl = T.delivery(text, seconds); st.talk.push({ who: `📞 ${oc2.call.name}`, you: text, reply, scores, tip, fillers: dl.fillers, wpm: dl.wpm });
    setCoachTip({ tip, scores, fillers: dl.fillers, pace: dl.pace }); drainSfx(); setTalkState(resting()); rerender();
  };
  const handleSaid = async (raw: string, seconds: number | null) => {
    if (sRef.current.onCall) { await callTalk(raw.trim(), seconds); return; }
    // A phone is ringing: “Excuse me one moment” to the guest counts as excusing yourself.
    if (sRef.current.ringing && /excuse me|one moment|one second|just a moment|be right with you|bear with me|give me (a|one) (moment|second|sec)/i.test(raw)) excusedFor.current = sRef.current.ringing.call.id;
    const st = sRef.current; const c0 = st.cur; const text = raw.trim(); if (!c0 || !text) { setTalkState(resting()); return; }
    setHeard(text); setTalkState('thinking'); setTalkErr(null);
    const ctx = contextFor(st); let res: T.TalkReply | null = null;
    const tk = caps.ai ? await idToken() : null;
    if (tk) { try { const r = await fetch('/api/practice/talk', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ context: ctx, said: text }) }); const d = await r.json(); if (d.ok) res = d; else setTalkErr(d.error || null); } catch { /* basic mode */ } }
    if (!res) res = T.basicTalk(T.sanitizeContext(ctx), text, OFFER_NAMES);
    const cur2 = sRef.current.cur; if (!cur2 || cur2.c.id !== c0.c.id) { setTalkState(resting()); return; }
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
    drainSfx(); setTalkState(resting()); rerender();
  };
  // Listening. The mic stays open while talking practice is on. Hands-free: just talk, and a short pause sends it,
  // like a real conversation. Hold to talk: hold the button or the space bar. Cut in any time the client is talking.
  const micRef = useRef<Mic | null>(null); const earsRef = useRef<BrowserEars | null>(null);
  const handsFreeRef = useRef(handsFree); handsFreeRef.current = handsFree;
  const talkOnRef = useRef(talkOn); talkOnRef.current = talkOn;
  const [testEars, setTestEars] = useState(false);
  const cloudEars = (caps.listen && signedIn) || testEars;
  const earsOn = useRef(false);
  const resting = () => ((micRef.current?.open || earsOn.current) && talkOnRef.current && handsFreeRef.current ? 'listening' : 'idle') as typeof talkState;
  const testListen = useRef<((t: string) => void) | null>(null);
  const excusedFor = useRef<string | null>(null);
  const someone = () => !!(sRef.current.cur || sRef.current.onCall);
  /** You finished a line: check it wasn't the client's own voice coming back, then send it. */
  const heardLine = (text: string, secs: number | null) => {
    const t = text.trim(); setInterim('');
    if (testListen.current) { const f = testListen.current; testListen.current = null; f(t); setTalkState(resting()); return; }
    if (!t || t.replace(/[^a-z]/gi, '').length < 2 || isEcho(t, lastClientLine.current) || !someone()) { setTalkState(resting()); return; }
    if (micRef.current) micRef.current.paused = true; earsRef.current?.pause();
    handleSaid(t, secs).finally(() => { if (micRef.current) micRef.current.paused = false; if (handsFreeRef.current && talkOnRef.current && talkStateRef.current !== 'client') earsRef.current?.listen(); });
  };
  const micHandlers = () => ({
    onLevel: (lv: number) => {
      if (panelRef.current === 'check') { checkLevel.current = lv; if (lv > 0.02) setChk((c) => (c.mic ? c : { ...c, mic: true })); }
      const b = micBtn.current; if (b) { const ring = Math.min(14, 3 + lv * 160); b.style.boxShadow = `0 0 0 ${ring}px ${talkStateRef.current === 'hearing' ? '#fdecec' : '#e9eefc'}`; }
      const now = performance.now(); const L = loud.current; L.max = Math.max(L.max, lv);
      if (now - L.since > 6000) { setQuiet(talkStateRef.current === 'listening' && L.max < 0.008); L.max = 0; L.since = now; }
    },
    onStart: (barge: boolean) => {
      if (barge) { stopAudio.current?.(); if (!cloudEarsRef.current) earsRef.current?.listen(); }
      if (cloudEarsRef.current && handsFreeRef.current && (talkStateRef.current === 'listening' || barge)) setTalkState('hearing');
    },
    onUtterance: (wav: Blob, secs: number) => { if (cloudEarsRef.current) sendRecording(wav, secs); },
    onDrop: () => { if (talkStateRef.current === 'hearing') setTalkState(resting()); },
  });
  const cloudEarsRef = useRef(cloudEars); cloudEarsRef.current = cloudEars;
  const sendRecording = async (wav: Blob, secs: number) => {
    if (!someone() && !testListen.current) { setTalkState(resting()); return; }
    setTalkState('thinking'); if (micRef.current) micRef.current.paused = true;
    try {
      const tk = await idToken(); const f = new FormData(); f.append('audio', wav, 'speech.wav');
      const r = await fetch('/api/practice/listen', { method: 'POST', headers: { authorization: `Bearer ${tk}` }, body: f }); const d = await r.json();
      if (!d.ok) { setTalkErr(d.error || 'Didn’t catch that. Try again.'); if (micRef.current) micRef.current.paused = false; setTalkState(resting()); return; }
      if (micRef.current) micRef.current.paused = false; heardLine(String(d.text || ''), secs);
    } catch { setTalkErr('Couldn’t reach listening. Check the connection and try again.'); if (micRef.current) micRef.current.paused = false; setTalkState(resting()); }
  };
  /** Open the mic (needs a tap the first time) and start listening the chosen way. */
  /** Safari and iPad allow only one listener on the mic at a time, so browser listening there runs without our level meter. */
  const oneMicOnly = () => { const ua = navigator.userAgent; return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(ua)); };
  const openMic = async (id = micId) => {
    setTalkErr(null);
    // Everything that needs the tap happens first, before any waiting.
    primePlayer(); if (!micRef.current) micRef.current = new Mic(() => micHandlers());
    const skipMeter = !cloudEarsRef.current && oneMicOnly();
    if (!skipMeter) micRef.current.prime();
    if (skipMeter || !navigator.mediaDevices?.getUserMedia) { if (!BrowserEars.available()) { setTalkErr('This browser can’t use a microphone here. Type what you’d say instead.'); return false; } }
    else {
      try {
        const m = micRef.current; await m.start(id); m.handsFree = handsFreeRef.current; m.levelOnly = !cloudEarsRef.current;
        Mic.mics().then(setMics); loud.current = { max: 0, since: performance.now() };
        // The mic opened but no sound arrives: say so instead of silently waiting.
        window.setTimeout(() => { if (micRef.current === m && m.open && m.frames === 0) { m.prime(); setTalkErr('The mic is on but no sound is coming through. Tap the mic button once more, or pick another mic.'); } }, 1800);
      } catch (e: any) { setTalkErr(listenError(String(e?.name || '')) || 'The microphone didn’t start. Try again.'); return false; }
    }
    if (!cloudEarsRef.current) {
      if (!BrowserEars.available()) { setTalkErr(listenError('network')); return false; }
      if (!earsRef.current) earsRef.current = new BrowserEars(() => ({
        onInterim: (t: string) => { setInterim(t); if (t && talkStateRef.current === 'listening') setTalkState('hearing'); },
        onFinal: (t: string, secs: number) => heardLine(t, secs),
        onError: (code: string) => { const m = listenError(code); if (m) { setTalkErr(m); setTalkState('idle'); } },
      }));
      earsOn.current = true; if (handsFreeRef.current) earsRef.current.listen();
    }
    setTalkState(resting()); return true;
  };
  const closeMic = () => { micRef.current?.stop(); earsRef.current?.pause(); earsOn.current = false; setInterim(''); setTalkState('idle'); };
  useEffect(() => () => closeMic(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Real listening switched on or off (signing in): restart the right way.
  useEffect(() => { if (micRef.current?.open) { micRef.current.levelOnly = !cloudEars; if (cloudEars) earsRef.current?.pause(); else if (handsFree) openMic(); } }, [cloudEars]); // eslint-disable-line react-hooks/exhaustive-deps
  const startListening = async () => {
    if (talkStateRef.current === 'thinking' || !someone()) return;
    if (!micRef.current?.open && !(await openMic())) return;
    stopAudio.current?.(); setTalkErr(null);
    if (cloudEarsRef.current) micRef.current?.pushStart(); else earsRef.current?.hold();
    setTalkState('hearing');
  };
  const stopListening = () => {
    if (handsFreeRef.current || talkStateRef.current !== 'hearing') return;
    if (cloudEarsRef.current) { micRef.current?.pushStop(); if (talkStateRef.current === 'hearing') setTalkState('idle'); } else earsRef.current?.release();
  };
  const switchMode = (hf: boolean) => {
    setHandsFree(hf); handsFreeRef.current = hf; try { localStorage.setItem('cf_practice_handsfree', hf ? '1' : '0'); } catch { /* private mode */ }
    if (micRef.current) micRef.current.handsFree = hf;
    if (!cloudEarsRef.current) { if (hf) earsRef.current?.listen(); else earsRef.current?.pause(); }
    setTalkState(resting());
  };
  useEffect(() => { try { if (localStorage.getItem('cf_practice_handsfree') === '0') setHandsFree(false); setMicId(localStorage.getItem('cf_practice_mic')); } catch { /* private mode */ } }, []);
  const callSaid = s.onCall?.said; const callId = s.onCall?.call.id;
  // Two players: the second player becomes the caller and gets a role card.
  useEffect(() => { if (!twoP || screen !== 'play') return; const oc = sRef.current.onCall;
    if (oc) { const b = R.callerBrief(sRef.current, oc); view({ stage: 'caller', who: b.who, title: R.KIND_LABEL[oc.call.kind], note: b.persona, text: b.facts.join('\n') }); }
    else if (!pending.current) view({ stage: 'idle' }); }, [callId, twoP, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const oc = sRef.current.onCall; if (!voice || screen !== 'play' || !oc || !callSaid || twoPRef.current) return; sayOut(callSaid, { id: oc.call.id, voice: oc.call.voice, pron: oc.call.voiceHint.gender === 'male' ? 'he' : 'she' } as R.Customer, toneRef.current, phoneFxRef.current); toneRef.current = 'neutral'; }, [callSaid, callId, voice, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTalk = () => { const n = !talkOn; setTalkOn(n); talkOnRef.current = n; try { localStorage.setItem(TALK_KEY, n ? '1' : '0'); } catch { /* private mode */ } if (n) { assignVoices(); openMic(); } else closeMic(); };
  useEffect(() => { if (screen === 'play') loadVoices(); }, [screen, caps.voices, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hold the space bar to talk (desktop).
  useEffect(() => {
    if (!talkOn || screen !== 'play') return;
    const isField = (e: KeyboardEvent) => { const t = e.target as HTMLElement; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat && !isField(e)) { e.preventDefault(); if (handsFreeRef.current) { if (micRef.current?.open) stopAudio.current?.(); else openMic(); } else startListening(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !isField(e)) { e.preventDefault(); stopListening(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Screens ──
  if (screen === 'menu') return <Shell><MenuCard onStart={start} code={code} onCode={pickCurrency} mode={shift} onMode={setShift} pace={pace} onPace={setPace} calls={callsOpt} onCalls={setCallsOpt} drillWho={drillWho} onDrill={setDrillWho} /></Shell>;
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

  const ab = cur?.arr ? R.bookingBy(s, cur.arr.booking) : null;
  const late = cur ? R.minutesLate(s) : 0;
  const step = (n: number, title: string, done: boolean, body: ReactNode) => <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 20, height: 20, borderRadius: 10, background: done ? GREEN : INK, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{done ? '✓' : n}</span><b style={{ fontSize: 12.8 }}>{title}</b></div>{body}</div>;
  const arrivalPanel = cur && R.isArrival(cur.c) && cur.arr && (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 14, background: cur.c.look.top, color: '#fff', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cur.c.name[0]}</span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>Checking in · {cur.c.name}</div><div style={{ fontSize: 11, color: MUTED }}>Arrived {clockOf(cur.arr.arrivedAt)}</div></div>
        {late > R.GRACE_MIN ? <Chip tone="amber">{late} min late</Chip> : <Chip tone="blue">Check-in</Chip>}
      </div>
      {step(1, 'Find the booking', !!ab, <>
        {!ab && <><input aria-label="Search bookings" value={arrQ} onChange={(e) => setArrQ(e.target.value)} placeholder="Name or phone" style={{ ...input, padding: '6px 10px', fontSize: 13 }} />
          {R.searchBookings(s, arrQ).slice(0, 5).map((b) => <button key={b.id} onClick={() => { R.pickBooking(s, b.id); rerender(); }} style={{ ...rowBtn, padding: '6px 10px', fontSize: 12.5 }}><b style={{ flex: 1, textAlign: 'left' }}>{b.name}</b><span style={{ color: MUTED }}>{b.when} · {b.service} · {b.provider}</span></button>)}</>}
        {ab && <div style={{ background: SOFT, borderRadius: 10, padding: '7px 10px', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><b style={{ flex: 1 }}>{ab.name} · {ab.when}</b><button style={mini} onClick={() => { cur.arr!.booking = null; rerender(); }}>Change</button></div>
          <div>{ab.service} with {ab.provider}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ab.deposit > 0 && <Chip tone="green">Deposit {money(ab.deposit)} paid</Chip>}{ab.consentNeeded && <Chip tone={ab.consentOnFile ? 'green' : 'amber'}>{ab.consentOnFile ? 'Consent on file' : 'Consent form needed'}</Chip>}<Chip>{ab.courtesyLeft} courtesy left</Chip></div>
        </div>}
      </>)}
      {step(2, cur.c.kind === 'new' ? 'Their details (new client)' : 'Confirm their details', !!cur.arr.details, <>
        {cur.arr.details ? <div style={{ fontSize: 12.5 }}>{cur.arr.details.phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')} · {cur.arr.details.email}{cur.arr.details.promo ? ' · offers on' : ''} <span style={{ color: MUTED }}>({cur.arr.details.by === 'client' ? 'entered by the client' : 'typed by you'})</span></div>
          : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Btn small onClick={() => sendDetails(false)} disabled={!!formWait || !ab}>{formWait === 'details' ? `${cur.c.name} is filling them in…` : 'Send to the client screen'}</Btn>
            {ab && cur.c.kind !== 'new' && <button style={mini} onClick={() => { R.confirmDetails(s, { phone: ab.phone, email: ab.email, promo: false }, 'desk'); rerender(); }}>They said it’s all the same</button>}</div>}
      </>)}
      {ab && ab.consentNeeded && !ab.consentOnFile && step(3, `${ab.service} consent form`, !!cur.arr.consent, cur.arr.consent ? <div style={{ fontSize: 12.5, color: GREEN }}>Signed on the client screen.</div>
        : <div><Btn small onClick={sendConsent} disabled={!!formWait}>{formWait === 'consent' ? `${cur.c.name} is reading and signing…` : 'Send the form to the client screen'}</Btn></div>)}
      {late > R.GRACE_MIN && step(4, `${late} minutes late (grace is ${R.GRACE_MIN})`, !!cur.arr.late, cur.arr.late ? <div style={{ fontSize: 12.5 }}>{cur.arr.late === 'short' ? 'A shorter service today' : cur.arr.late === 'reschedule' ? 'Moved to another day' : 'Full service (the next guest will wait)'}{cur.arr.courtesy ? ' · courtesy used, no late fee' : ' · late fee charged'}</div> : <>
        <div style={{ fontSize: 12, color: MUTED }}>{ab ? `${ab.provider}’s next guest is at ${ab.provider === 'Mei' ? '12:45' : '1:00'}.` : 'Find the booking first.'} Offer choices; the client decides.</div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" checked={lateCourtesy} onChange={(e) => setLateCourtesy(e.target.checked)} />Use a courtesy (no late fee){ab ? ` · ${ab.courtesyLeft} left` : ''}</label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{([['short', 'Shorter service today'], ['reschedule', 'Another day'], ['full', 'Full service anyway']] as const).map(([k, l]) => <button key={k} style={mini} onClick={() => { R.chooseLate(s, k, lateCourtesy); rerender(); }}>{l}</button>)}</div></>)}
      {step(late > R.GRACE_MIN ? 5 : 4, `Let ${ab?.provider || 'their provider'} know`, cur.arr.notified, cur.arr.notified ? <div style={{ fontSize: 12.5, color: GREEN }}>{ab?.provider || 'Their provider'} has been told {cur.c.name} is here.</div> : <div><button style={mini} onClick={() => { R.notifyProvider(s); drainSfx(); rerender(); }}>Send {ab?.provider || 'provider'} an “arrived” alert</button></div>)}
      <div style={{ flex: 1 }} />
      <Btn small onClick={doneArrival}>Finish check-in · send to the lounge</Btn>
    </div>
  );
  const pos = cur && !R.isArrival(cur.c) && (
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Btn small onClick={() => { R.saveContact(s, details); rerender(); }}>{cur.contact ? 'Update details' : 'Save details'}</Btn><Btn small ghost onClick={() => sendDetails(true)} disabled={!!formWait}>{formWait === 'details' ? `Waiting for ${cur.c.name}…` : 'Let her type them on the client screen'}</Btn></div>
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
  const onLine = s.onCall; const talkName = onLine ? onLine.call.name.split(' ')[0] : cur ? (cur.c.party ? 'Maya' : cur.c.name) : '';
  const micOpen = !!micRef.current?.open || (!cloudEars && talkState !== 'idle');
  const statusLine = !micOpen ? (handsFree ? 'Tap the mic to start talking' : 'Hold the mic (or Space) and talk') : talkState === 'hearing' ? (handsFree ? 'Hearing you… pause when you’re done' : 'Hearing you… let go to send') : talkState === 'thinking' ? `${talkName} is thinking…` : talkState === 'client' ? `${talkName} is talking. Just start talking to cut in` : handsFree ? `Listening. Just talk to ${talkName}` : 'Hold the mic (or Space) and talk';
  const talkEl = talkOn && (cur || onLine) && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: narrow || onLine ? '100%' : 360, background: 'rgba(255,255,255,.97)', border: `1px solid ${LINE}`, borderRadius: 18, padding: 10, boxSizing: 'border-box', boxShadow: onLine ? 'none' : '0 12px 28px -18px rgba(0,0,0,.45)' }}>
      {(interim.trim() || heard) && <div style={{ alignSelf: 'flex-end', background: interim.trim() ? SOFT : INK, color: interim.trim() ? MUTED : '#fff', borderRadius: '14px 14px 4px 14px', padding: '7px 11px', fontSize: 13, lineHeight: 1.4, maxWidth: '92%', fontStyle: interim.trim() ? 'italic' : 'normal' }}>“{interim.trim() || heard}”</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button ref={micBtn} aria-label={handsFree ? (micOpen ? 'Turn the mic off' : 'Start talking') : 'Hold to talk'}
          onClick={handsFree ? () => (talkState === 'client' ? stopAudio.current?.() : micOpen ? closeMic() : openMic()) : undefined}
          onPointerDown={handsFree ? undefined : (e) => { e.preventDefault(); startListening(); }} onPointerUp={handsFree ? undefined : stopListening} onPointerLeave={handsFree ? undefined : stopListening}
          style={{ width: 50, height: 50, borderRadius: 25, border: 'none', flexShrink: 0, cursor: 'pointer', touchAction: 'none', background: talkState === 'hearing' ? RED : micOpen ? GREEN : INK, color: '#fff', fontSize: 20, boxShadow: '0 8px 16px -8px rgba(0,0,0,.5)', transition: 'background .2s, box-shadow .08s', opacity: talkState === 'thinking' ? 0.6 : 1 }}>{talkState === 'thinking' ? '…' : '🎙'}</button>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: talkState === 'hearing' ? RED : talkState === 'client' ? BLUE : INK }}>{statusLine}</div>
          <form onSubmit={(e) => { e.preventDefault(); if (typedLine.trim() && talkState !== 'thinking') { stopAudio.current?.(); handleSaid(typedLine, null); setTypedLine(''); } }} style={{ display: 'flex', gap: 6 }}>
            <input aria-label="Say something" value={typedLine} onChange={(e) => setTypedLine(e.target.value)} placeholder="…or type what you’d say" style={{ ...input, padding: '7px 10px', fontSize: 12.5 }} />
          </form>
        </div>
      </div>
      {quiet && micOpen && <div style={{ fontSize: 12, color: AMBER, fontWeight: 600 }}>We can barely hear you. Move closer, or pick another mic below.</div>}
      {talkErr && <div style={{ fontSize: 12, color: RED, fontWeight: 600 }}>{talkErr} <button onClick={() => setPanel('check')} style={{ ...mini, fontSize: 10.5 }}>Run a voice check</button></div>}
      {coachOn && coachTip && <div style={{ background: '#f4f7ff', border: '1px solid #dbe4ff', borderRadius: 12, padding: '7px 10px', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div><b>Coach:</b> {coachTip.tip}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(['awareness', 'confidence', 'warmth', 'retention'] as const).map((k) => <span key={k} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: coachTip.scores[k] >= 4 ? '#e8f3ec' : coachTip.scores[k] <= 2 ? '#fdf1e3' : '#fff', color: coachTip.scores[k] >= 4 ? GREEN : coachTip.scores[k] <= 2 ? AMBER : INK, fontWeight: 600 }}>{k[0].toUpperCase() + k.slice(1)} {coachTip.scores[k]}/5</span>)}
          {coachTip.fillers > 0 && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: '#fdf1e3', color: AMBER, fontWeight: 600 }}>{coachTip.fillers} filler {coachTip.fillers === 1 ? 'word' : 'words'}</span>}
          {coachTip.pace && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: coachTip.pace === 'good' ? '#e8f3ec' : '#fdf1e3', color: coachTip.pace === 'good' ? GREEN : AMBER, fontWeight: 600 }}>Pace: {coachTip.pace}</span>}</div>
      </div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: MUTED, flexWrap: 'wrap' }}>
        <div role="group" aria-label="How you talk" style={{ display: 'inline-flex', background: SOFT, borderRadius: 999, padding: 2 }}>
          {([[true, 'Hands-free'], [false, 'Hold to talk']] as const).map(([v, l]) => <button key={l} onClick={() => switchMode(v)} style={{ border: 'none', borderRadius: 999, padding: '3px 9px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: handsFree === v ? '#fff' : 'transparent', color: handsFree === v ? INK : MUTED, boxShadow: handsFree === v ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>{l}</button>)}
        </div>
        {mics.length > 1 && <select aria-label="Microphone" value={micId || ''} onChange={(e) => { const id = e.target.value || null; setMicId(id); try { if (id) localStorage.setItem('cf_practice_mic', id); else localStorage.removeItem('cf_practice_mic'); } catch { /* private mode */ } openMic(id); }} style={{ fontSize: 10.5, border: `1px solid ${LINE}`, borderRadius: 999, padding: '3px 6px', maxWidth: 150, background: '#fff', color: INK }}>
          <option value="">Default mic</option>{mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
        <span style={{ flex: 1 }} />
        <span>{caps.ai && signedIn ? 'AI client' : 'Basic mode'} · {caps.voices && signedIn ? 'real voices' : 'browser voice'} · {cloudEars ? 'clear listening' : 'browser listening'}</span>
        <button onClick={() => { primePlayer(); setPanel('voices'); }} style={{ ...mini, fontSize: 10.5 }}>Choose voices</button>
        {caps.faces && <button onClick={toggleFace} style={{ ...mini, fontSize: 10.5, background: faceOn ? INK : '#fff', color: faceOn ? '#fff' : INK }}>{faceOn ? 'Face to face: on' : 'Face to face'}</button>}
        {caps.faces && faceOn && <span style={{ fontSize: 10.5, color: MUTED }}>Live video today {(() => { const ms = face.current?.usedNow() || 0; return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`; })()}</span>}
        <button onClick={() => setPanel('check')} style={{ ...mini, fontSize: 10.5 }}>Voice check</button>
        <button onClick={() => setCoachOn((v) => !v)} style={{ ...mini, fontSize: 10.5 }}>{coachOn ? 'Hide coach' : 'Show coach'}</button>
      </div>
      {!signedIn && (caps.ai || caps.voices) && <div style={{ fontSize: 11.5, color: MUTED }}>Sign in to ClarityFlow for the AI client, real voices and clear listening.</div>}
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
          : face.current && face.current.state !== 'off' && face.current.who === shownC.id ? (
            <div style={{ position: 'relative', width: narrow ? 150 : 300, height: narrow ? 200 : 400, borderRadius: 22, overflow: 'hidden', background: '#1b1a20', boxShadow: '0 30px 50px -24px rgba(0,0,0,.55)' }}>
              <video id="cf-face" autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {face.current.state === 'live' && <span style={{ position: 'absolute', left: 10, top: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999, background: 'rgba(220,38,38,.9)', color: '#fff', fontSize: 10.5, fontWeight: 800 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: '#fff' }} />LIVE</span>}
              {face.current.state === 'connecting' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12.5, fontWeight: 600, background: 'rgba(0,0,0,.35)' }}>Connecting live video…</div>}
              {face.current.state === 'error' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, textAlign: 'center', color: '#fff', fontSize: 12, background: 'rgba(0,0,0,.6)' }}>{face.current.error}</div>}
              {face.current.state === 'live' && !face.current.videoStarted && <button onClick={() => { (document.getElementById('cf-face') as HTMLVideoElement | null)?.play().catch(() => {}); }} style={{ position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', ...mini }}>Tap to start video</button>}
            </div>
          ) : faceOn && caps.faces && s.onCall && cur?.c.id === shownC.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><Person look={shownC.look} size={narrow ? 120 : 300} mood={cur?.mood ?? 0.9} /><span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Live video paused while you’re on the phone</span></div>
          ) : facePaused === shownC.id && faceOn ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><Person look={shownC.look} size={narrow ? 120 : 300} mood={cur?.mood ?? 0.9} /><button onClick={() => setFacePaused(null)} style={{ ...mini, fontSize: 11 }}>Paused to save minutes · resume live video</button></div>
          ) : <Person look={shownC.look} size={narrow ? 120 : 300} mood={cur?.mood ?? 0.9} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: narrow ? 0 : 90 }}>
        <Say tone={cur && cur.mood < 0.3 ? 'warn' : cur?.claim === 'discount' || pay === 'approved' || pay === 'receipt' ? 'ok' : 'soft'}>{pay === 'receipt' ? 'Thank you! See you next time.' : pay === 'approved' ? 'Thank you!' : talkOn && talkState === 'thinking' && !s.onCall ? '…' : cur?.said}</Say>
        {!narrow && greetEl}
        {!narrow && !s.onCall && talkEl}
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
  const lastRv = s.reviews.length ? s.reviews[s.reviews.length - 1] : null;
  const phoneEl = <>
    <PhoneDock s={s} narrow={narrow} talkEl={null} twoPlayer={twoP} excused={!!s.ringing && excusedFor.current === s.ringing.call.id} done={phoneDone} onExcuse={excuseMe} onAnswer={answerCall}
      onListen={(vm) => sayOut(vm.call.voicemail, { id: vm.call.id, voice: vm.call.voice, pron: vm.call.voiceHint.gender === 'male' ? 'he' : 'she' } as R.Customer, 'neutral', phoneFxRef.current, true)} />
    {s.onCall && <CallCard key={s.onCall.call.id} s={s} narrow={narrow} talkEl={talkEl} twoPlayer={twoP} excused done={phoneDone} onExcuse={excuseMe} onAnswer={answerCall} onListen={() => {}} beforeAct={() => stopAudio.current?.()} />}
    {lastRv && seenRv !== s.reviews.length && !s.onCall && !s.ringing && <CallReviewCard key={s.reviews.length} rv={lastRv} narrow={narrow} onClose={() => setSeenRv(s.reviews.length)} />}
  </>;
  const runHear = async () => {
    if (!micRef.current?.open && !earsOn.current && !(await openMic())) { setChk((c) => ({ ...c, heard: false })); return; }
    const m = micRef.current; const hfWas = m?.handsFree; if (m) { m.handsFree = true; m.paused = false; } if (!cloudEarsRef.current) earsRef.current?.listen();
    setChk((c) => ({ ...c, busy: 'hear', heard: null }));
    const t = window.setTimeout(() => { if (testListen.current) { testListen.current = null; setChk((c) => ({ ...c, busy: null, heard: false })); if (m && hfWas !== undefined) m.handsFree = hfWas; } }, 12000);
    testListen.current = (text) => { window.clearTimeout(t); if (m && hfWas !== undefined) m.handsFree = hfWas; if (!handsFreeRef.current && !cloudEarsRef.current) earsRef.current?.pause(); setChk((c) => ({ ...c, busy: null, heard: text || false })); };
  };
  const runVoice = () => {
    primePlayer(); lastVoiceOk.current = false; lastSpeakErr.current = null; setChk((c) => ({ ...c, busy: 'voice', voice: null }));
    const c0 = R.PEOPLE[0]; sayOut('Hi! This is how I’ll sound today.', c0, 'warm', false, true);
    let n = 0; const iv = window.setInterval(() => { n++; if (lastVoiceOk.current || n > 26) { window.clearInterval(iv); setChk((c) => ({ ...c, busy: null, voice: lastVoiceOk.current })); } }, 300);
  };
  const runAi = async () => {
    setChk((c) => ({ ...c, busy: 'ai', ai: null })); const tk = await idToken(); const t0 = performance.now();
    if (!tk) { setChk((c) => ({ ...c, busy: null, ai: { ok: false, text: 'Not signed in, so the AI client can’t be used.' } })); return; }
    try {
      const r = await fetch('/api/practice/talk', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify({ context: { name: 'Rosa', persona: 'Warm regular.', kind: 'returning', visits: 4, service: 'Gel manicure', provider: 'Ana', items: [], total: '$45.00', prefersPay: 'card', rebook: { wants: 'yes, in 3 weeks', done: null }, offer: { wants: null, offered: [], catalog: [] }, mood: 0.9, waitedMinutes: 1, lineLength: 0, stage: 'ticket open', history: [] }, said: 'Hi Rosa, welcome back! How was your manicure?' }) });
      const d = await r.json(); const ms = Math.round(performance.now() - t0);
      setChk((c) => ({ ...c, busy: null, ai: !d.ok ? { ok: false, text: d.error || `The server answered ${r.status}.` } : d.mode === 'ai' ? { ok: true, text: `Answered in ${(ms / 1000).toFixed(1)} s: “${d.reply}”` } : { ok: false, text: caps.ai ? 'The AI didn’t answer, so simple keyword replies were used. Check the AI key and its usage limit on the server.' : 'The AI isn’t connected on the server, so clients use simple keyword replies.' } }));
    } catch { setChk((c) => ({ ...c, busy: null, ai: { ok: false, text: 'Couldn’t reach the server.' } })); }
  };
  const micLive = !!micRef.current?.open || earsOn.current;
  const runFace = async () => { setChk((c) => ({ ...c, busy: 'face' })); const t = await faceToken(cur?.c.id || 'test'); setFaceChk(t.ok ? { ok: true, text: 'A live video session can start. Turn on Face to face in the talk panel.' } : { ok: false, text: t.error || 'The live video didn’t start.' }); setChk((c) => ({ ...c, busy: null })); };
  const checkRows: CheckRow[] = [
    { label: 'Signed in', ok: signedIn ? true : caps.ai || caps.voices ? false : null, detail: signedIn ? 'You’re signed in, so clear listening, real voices and the AI client can be used.' : 'Sign in to ClarityFlow (not as a guest). Without it you get browser listening, device voices and simple replies.' },
    { label: 'Voices on', ok: voice, detail: voice ? 'Clients will answer out loud.' : 'Voices are off in the top bar, so clients only answer in text.', action: voice ? undefined : { label: 'Turn on', run: toggleVoice } },
    { label: 'Microphone', ok: chk.mic === true ? true : talkErr && !micLive ? false : micLive ? null : null, detail: !micLive ? (talkErr || 'Open the mic, then say something: the bar should move.') : chk.mic ? 'Hearing sound.' : oneMicOnly() && !cloudEars ? 'On (this browser can’t show the level while it listens).' : 'Open. Say something: the bar should move.', action: micLive ? undefined : { label: 'Open mic', run: () => { openMic(); } } },
    { label: 'Listening', ok: chk.heard ? true : chk.heard === false ? false : null, detail: (cloudEars ? 'Clear listening (your voice account). ' : `Browser listening${caps.listen && !signedIn ? ' (sign in for clear listening)' : !caps.listen ? ' (clear listening isn’t connected on the server)' : ''}. `) + (chk.busy === 'hear' ? 'Say: “Hi, welcome to Opal.”' : chk.heard ? `Heard: “${chk.heard}”` : chk.heard === false ? (talkErr || 'Nothing came through. Check the mic choice and try again, or use Chrome.') : 'Press Test, then say a sentence.'), action: { label: chk.busy === 'hear' ? 'Listening…' : 'Test', run: runHear, busy: chk.busy === 'hear' } },
    { label: 'Client voice', ok: chk.voice, detail: (caps.voices && signedIn ? 'Real voices. ' : `Device voices${!caps.voices ? ' (real voices aren’t connected on the server)' : ' (sign in for real voices)'}. `) + (chk.voice === false ? (lastSpeakErr.current || 'No sound played. Check the volume, then tap Play again.') : chk.voice ? 'Played.' : 'Press Play: you should hear a client.'), action: { label: 'Play', run: runVoice, busy: chk.busy === 'voice' } },
    { label: 'Live video (face to face)', ok: faceChk ? faceChk.ok : null, detail: faceChk ? faceChk.text : caps.faces ? 'Optional. Press Test to check a live video session can start.' : 'Optional, not connected: add ANAM_API_KEY and ANAM_AVATAR_ID in Vercel.', action: caps.faces ? { label: 'Test', run: runFace, busy: chk.busy === 'face' } : undefined },
    { label: 'AI client', ok: chk.ai ? chk.ai.ok : null, detail: chk.ai ? chk.ai.text : caps.ai ? 'Press Test to send one line.' : 'Not connected on the server: clients use simple keyword replies (still playable).', action: { label: 'Test', run: runAi, busy: chk.busy === 'ai' } },
  ];
  const checkPanel = panel === 'check' && <VoiceCheck narrow={narrow} rows={checkRows} level={checkLevel.current} onClose={() => setPanel(null)} />;
  const voicePanel = panel === 'voices' && <VoicePicker narrow={narrow} real={!!caps.voices && signedIn} options={voiceOpts} picks={picks.current} preset={preset} phone={phoneFx}
    people={everyone().map((p) => ({ id: p.id, name: p.name, role: p.role, line: p.line }))}
    onPhone={(on) => { setPhoneFx(on); phoneFxRef.current = on; savePicks(preset); }}
    onPreset={(k) => { setPreset(k); picks.current = autoPick(everyone(), voiceOpts, k); savePicks(k); rerender(); }}
    onPick={(id, pk) => { picks.current = { ...picks.current, [id]: pk }; savePicks(preset); rerender(); }}
    onPreview={(id) => { primePlayer(); const p0 = everyone().find((x) => x.id === id)!; const full = R.PEOPLE.find((c) => c.id === id); const call = [...R.CALLS, ...R.OVERNIGHT].find((c) => c.id === id);
      sayOut(p0.line, (full || { id, voice: call!.voice, pron: call!.voiceHint.gender === 'male' ? 'he' : 'she' }) as R.Customer, 'warm', !!call && phoneFxRef.current, true); }}
    onClose={() => setPanel(null)} />;
  const printEl = rc && <div id="cf-print" style={{ display: 'none' }}><ReceiptPaper r={rc} width="72mm" /></div>;
  const pauseEl = paused && <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,23,26,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}><div style={{ background: '#fff', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}><b style={{ fontSize: 18 }}>Paused</b><Btn onClick={() => setPaused(false)}>Resume</Btn></div></div>;

  if (narrow) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#f6f3ef,#efe9e2)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, display: 'flex', flexDirection: 'column', gap: 10, padding: 10, boxSizing: 'border-box' }}>
      <Fonts />{hud}{coachEl}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{queue}</div>
      {client}{greetEl}{!s.onCall && talkEl}{claimCard}
      <div style={{ background: '#16171a', borderRadius: 16, padding: 7 }}>{pos || arrivalPanel || saleDone}</div>
      {clientScreen}
      {receiptPanel && <div style={{ paddingTop: 250, display: 'flex', justifyContent: 'center' }}>{receiptPanel}</div>}
      <div style={{ background: 'linear-gradient(180deg,#f4f4f6,#dfdfe3)', borderTop: '4px solid #fff', borderRadius: 16, padding: 8 }}>{counter}</div>
      {zoom && <div style={{ position: 'fixed', left: 8, right: 8, bottom: 8, zIndex: 20 }}>{zoom}</div>}
      {drawerPanel && <div style={{ position: 'fixed', left: 6, right: 6, bottom: 6, zIndex: 20, maxHeight: '70vh', overflow: 'auto' }}>{drawerPanel}</div>}
      {camera && <CameraScanner onCode={onCamera} onClose={() => setCamera(false)} />}
      {toast}{roomEl}{waitEl}{phoneEl}{printEl}{voicePanel}{checkPanel}
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
        <div style={{ background: '#16171a', borderRadius: 16, padding: 8, width: '100%', height: '100%', boxSizing: 'border-box', boxShadow: '0 26px 40px -20px rgba(0,0,0,.6)' }}>{pos || arrivalPanel || saleDone}</div>
      </div>
      <div style={{ position: 'absolute', left: 'calc(min(430px, 34vw) + 70px)', bottom: 40, zIndex: 3 }}>{counter}</div>
      <div style={{ position: 'absolute', right: 400, bottom: 40, zIndex: 4 }}>{receiptPanel || <ReceiptPrinter r={null} printing={false} />}</div>
      <div style={{ position: 'absolute', right: 40, bottom: 40, zIndex: 3 }}>{clientScreen || (cur && <Reader amount={money(total)} line1="Waiting for payment" />)}</div>
      {zoom && <div style={{ position: 'absolute', left: '50%', bottom: 30, transform: 'translateX(-30%)', zIndex: 10 }}>{zoom}</div>}
      {drawerPanel && <div style={{ position: 'absolute', left: 'calc(min(430px, 34vw) + 50px)', right: 390, bottom: 24, zIndex: 10, display: 'flex', justifyContent: 'center' }}>{drawerPanel}</div>}
      {camera && <CameraScanner onCode={onCamera} onClose={() => setCamera(false)} />}
      {toast}{roomEl}{waitEl}{phoneEl}{printEl}{voicePanel}{checkPanel}
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

function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, string, string])[] }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 6 }}>{items.map(([k, t, d]) => { const on = value === k;
    return <button key={k} onClick={() => onChange(k)} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 12, padding: '8px 10px', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}><b style={{ fontSize: 13 }}>{t}</b><div style={{ fontSize: 11, opacity: 0.8, marginTop: 2, lineHeight: 1.35 }}>{d}</div></button>; })}</div>;
}
function MenuCard({ onStart, code, onCode, mode, onMode, pace, onPace, calls, onCalls, drillWho, onDrill }: { onStart: () => void; code: $.CurrencyCode; onCode: (c: $.CurrencyCode) => void; mode: R.PhoneMode; onMode: (m: R.PhoneMode) => void; pace: R.Pace; onPace: (p: R.Pace) => void; calls: 'off' | 'few' | 'busy'; onCalls: (c: 'off' | 'few' | 'busy') => void; drillWho: string; onDrill: (id: string) => void }) {
  return (
    <div style={{ ...cardS, maxWidth: 580 }}>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT · BEHIND THE DESK</div>
      <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em' }}>Work the register</div>
      <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>Six clients, a growing line, and the slips that happen on a busy Saturday. Scan their products, fix what goes wrong, and take payment. Nothing real is charged.</div>
      <div style={{ background: SOFT, borderRadius: 14, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}>
        <b>You’ll practice</b><br />Scanning · labels that won’t read · double scans · voids with a reason · a shelf price that doesn’t match · a health flag · cash and change · closing the drawer
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>SHIFT</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {([['full', 'Full shift', 'The counter, check-ins and phone calls.'], ['drill', 'One conversation', 'One client, no phone, no clock. Best for talking and face to face.'], ['phones', 'Phone practice', 'Ten callers on two lines, two voicemails waiting.']] as const).map(([k, t, d]) => { const on = mode === k;
            return <button key={k} onClick={() => onMode(k)} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 14, padding: '10px 12px', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}><b style={{ fontSize: 14 }}>{t}</b><div style={{ fontSize: 12, opacity: 0.8, marginTop: 3, lineHeight: 1.4 }}>{d}</div></button>; })}
        </div>
      </div>
      {mode === 'drill' && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>WHO</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6 }}>{R.DRILLS.map((d) => { const on = drillWho === d.id;
          return <button key={d.id} onClick={() => onDrill(d.id)} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 12, padding: '8px 10px', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}><b style={{ fontSize: 13 }}>{d.title}</b><div style={{ fontSize: 11, opacity: 0.8, marginTop: 2, lineHeight: 1.35 }}>{d.sub}</div></button>; })}</div>
      </div>}
      {mode !== 'drill' && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>PACE</div>
        <Seg value={pace} onChange={onPace} items={[['relaxed', 'Relaxed', 'Waits for you. Best for talking.'], ['normal', 'Normal', 'A steady Saturday.'], ['rush', 'Rush', 'Lines and ringing phones.']] as const} />
      </div>}
      {mode === 'full' && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.06em' }}>PHONE CALLS</div>
        <Seg value={calls} onChange={onCalls} items={[['off', 'Off', 'Just the counter.'], ['few', 'A few', 'Two calls.'], ['busy', 'Busy', 'Five calls and a voicemail.']] as const} />
      </div>}
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
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 26 }}>☎️</span>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}><b>Phone scripts</b><br /><span style={{ color: MUTED }}>What to say for every kind of call: answering, hold, bookings, gift cards, upset clients. Print it for the desk or the classroom.</span></div>
        <a href="/practice/register/scripts" target="_blank" rel="noreferrer" style={{ ...pill, textDecoration: 'none', color: INK }}>Open</a>
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
      {s.reviews.length > 0 && <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ fontSize: 15 }}>The phone · {s.reviews.length} {s.reviews.length === 1 ? 'call' : 'calls'} · phone manner {Math.round(s.reviews.reduce((a, r) => a + r.score, 0) / s.reviews.length)}%</b>
        {s.reviews.map((r, i) => <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, borderTop: i ? `1px solid ${LINE}` : 'none', paddingTop: i ? 6 : 0 }}>
          <span style={{ flex: 1 }}><b>{r.who}</b> <span style={{ color: MUTED }}>· {r.outbound ? 'callback · ' : ''}{r.result}</span></span>
          <span style={{ fontSize: 11.5, color: MUTED }}>{r.checklist.filter((x) => !x.ok).map((x) => x.label.split(' (')[0]).join(' · ')}</span>
          <b style={{ color: r.score >= 80 ? GREEN : r.score >= 50 ? AMBER : RED }}>{r.score}%</b></div>)}
        {s.voicemails.some((v) => !v.returned) && <div style={{ fontSize: 12.5, color: RED }}>Voicemails not returned: {s.voicemails.filter((v) => !v.returned).map((v) => v.call.name).join(', ')}</div>}
      </div>}
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
