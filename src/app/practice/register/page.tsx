'use client';
// Practice a shift: behind the front desk. A register point of view with real
// scanning (on-screen, typed, or a real USB / Bluetooth scanner), the client in
// front of you, the line behind them, and slips that show up in the shift review.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as R from '@/lib/practice/register';
import { Barcode, Bottle, Btn, Chip, Person, Reader, Say, ScannerGun, INK, MUTED, LINE, SOFT, GREEN, AMBER, RED, BLUE } from './parts';

type PayStep = null | 'tip' | 'reader' | 'processing' | 'approved';
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

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;
const clockOf = (t: number) => { const m = 11 * 60 + Math.floor(t / 2); const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export default function RegisterPractice() {
  const sRef = useRef<R.RegState>(R.newRegister());
  const s = sRef.current;
  const [, setTick] = useState(0); const rerender = useCallback(() => setTick((x) => x + 1), []);
  const [screen, setScreen] = useState<'menu' | 'play' | 'review'>('menu');
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
  const speed = useRef(1);
  const holdT = useRef<number | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search); const f = Number(p.get('fast')); if (f > 0) { speed.current = f; (window as any).__register = { s: () => sRef.current, rerender, codes: Object.fromEntries(R.SKUS.map((k) => [k.key, k.code])) }; }
    const onR = () => setNarrow(window.innerWidth < 860); onR(); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR);
  }, [rerender]);

  const drainSfx = useCallback(() => { const q = sRef.current.sfx.splice(0); if (!muted()) q.forEach((k, i) => window.setTimeout(() => SFX[k]?.(), i * 90)); }, []);

  // The clock keeps running: the line grows while you work.
  useEffect(() => {
    if (screen !== 'play') return;
    const id = window.setInterval(() => {
      if (paused) return;
      const st = sRef.current; const had = st.cur?.c.id;
      R.advance(st, 0.25 * speed.current);
      if (st.cur && st.cur.c.id !== had) { setSel(null); setMsg(null); setFlag(null); setNote(null); setVoidFor(null); setMode('scan'); }
      drainSfx();
      if (R.finished(st) && !pay) window.setTimeout(() => setScreen('review'), 500);
      rerender();
    }, 250);
    return () => window.clearInterval(id);
  }, [screen, paused, pay, rerender, drainSfx]);

  const afterScan = useCallback((r: R.ScanResult, via: string) => {
    if (r.kind === 'added') {
      setMsg({ text: via === 'usb' ? 'Beep. Read by your scanner.' : 'Beep. Added to the ticket.', tone: 'ok' });
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
        setUsb(true); const sku = R.skuByCode(code); if (sku) setSel(sku.key);
        afterScan(R.scan(sRef.current, sku ? sku.code : code, 'usb'), 'usb');
      } else if (e.key === 'Enter') buf = '';
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [screen, afterScan]);

  const start = () => { sRef.current = R.newRegister(); setScreen('play'); setSel(null); setMsg(null); setPay(null); setFlag(null); setPaused(false); rerender(); };
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
  const takePayment = () => {
    if (!cur) return; setSel(null); setPay('tip'); setTipShown(null);
    window.setTimeout(() => { if (sRef.current.cur) setTipShown(R.tipFor(sRef.current.cur).pct); }, 1000);
    window.setTimeout(() => setPay('reader'), 2000);
  };
  const cardGo = () => {
    setPay('processing'); SFX.tap();
    window.setTimeout(() => { setPay('approved'); if (!muted()) SFX.chime(); }, 1000);
    window.setTimeout(() => { R.pay(sRef.current); drainSfx(); setPay(null); setSel(null); setMsg(null); setFlag(null); setNote(null); rerender(); }, 1800);
  };

  // ── Screens ──
  if (screen === 'menu') return <Shell><MenuCard onStart={start} /></Shell>;
  if (screen === 'review') return <Shell><ReviewCard s={s} onAgain={start} /></Shell>;

  const done = s.done; const clean = done.filter((d) => d.clean).length;
  const avg = done.length ? Math.round(done.reduce((a, d) => a + d.seconds, 0) / done.length) : 0;
  const waiting = R.line(s); const longest = Math.min(1, ...waiting.map((c) => s.waiting[c.id] ?? 1));
  const retail = cur ? cur.lines.filter((l) => l.kind === 'retail' && !l.voided).length : 0;
  const coach = cur && cur.c.id === 'rosa' && done.length === 0 && !pay ? (retail === 0 ? (sel ? (narrow ? 'Press and hold the barcode to scan it.' : 'Press and hold on the barcode to scan it.') : 'Tap the cuticle oil on the counter.') : 'One bottle, one line on the ticket. Take payment.') : null;
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
      <div style={{ fontSize: 12.5, color: MUTED }}>The system says {k.name} is <b style={{ color: INK }}>${k.price}</b>. {cur.c.name} says the sign said <b style={{ color: INK }}>${sh.claim}</b>.</div>
      {calling ? <div style={{ fontSize: 13, fontWeight: 600, color: BLUE }}>Calling {R.MANAGER}… she’s checking on her phone</div> : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn small onClick={manager}>Ask {R.MANAGER} to approve ${k.price - sh.claim} off</Btn>
        <Btn small ghost onClick={() => { R.refuseClaim(s); rerender(); }}>Explain it’s ${k.price}</Btn></div>}
    </div>); })();

  const pos = cur && (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: narrow ? 0 : 300, boxSizing: 'border-box', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 14, background: cur.c.look.top, color: '#fff', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: '0 1px 2px rgba(0,0,0,.35)' }}>{cur.c.name[0]}</span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>{cur.c.name}</div><div style={{ fontSize: 11, color: MUTED }}>{cur.c.visits === 1 ? 'First visit' : `${cur.c.visits}th visit`} · {cur.c.service.label} with {cur.c.service.provider}</div></div>
        <Chip>Ticket</Chip>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1.5px solid ${INK}`, paddingTop: 7, fontSize: 16, fontWeight: 800 }}><span>Total</span><span>{money(total)}</span></div>
      {!pay && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Btn small onClick={takePayment}>Take payment · {money(total)}</Btn></div>}
    </div>
  );

  const clientScreen = pay && cur && (
    <div style={{ background: '#1d1e22', borderRadius: 20, padding: 9, width: narrow ? '100%' : 330, boxSizing: 'border-box', boxShadow: '0 26px 40px -20px rgba(0,0,0,.6)' }}>
      <div style={{ background: 'linear-gradient(180deg,#fbfaf8,#f1eee9)', borderRadius: 13, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minHeight: 190, justifyContent: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', color: MUTED }}>CLIENT SCREEN</div>
        {pay === 'tip' ? <>
          <div style={{ fontSize: 18 }}>Add a tip for {cur.c.service.provider}?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, width: '100%' }}>{[15, 18, 20].map((p) => { const on = tipShown === p; return <div key={p} style={{ border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 14, padding: '10px 0', textAlign: 'center', transition: 'all .2s' }}><b>{p}%</b><div style={{ fontSize: 10.5, opacity: 0.7 }}>${Math.round(cur.c.service.price * p / 100)}</div></div>; })}</div>
          <div style={{ fontSize: 11.5, color: tipShown === 0 ? AMBER : MUTED }}>{tipShown === 0 ? `${cur.c.name} chose no tip.` : tipShown ? `${cur.c.name} chose ${tipShown}%.` : `${cur.c.name} is choosing…`}</div>
        </> : pay === 'reader' ? <>
          <div style={{ fontSize: 17 }}>{money(total + R.tipFor(cur).amount)}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{cur.c.name} is ready to pay by card.</div>
          <div style={{ display: 'flex', gap: 6 }}><Btn small onClick={cardGo}>Tap</Btn><Btn small onClick={cardGo}>Insert chip</Btn><Btn small onClick={cardGo}>Swipe</Btn></div>
        </> : pay === 'processing' ? <div style={{ fontSize: 15, fontWeight: 600 }}>Processing…</div>
          : <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>Approved ✓</div>}
      </div>
    </div>
  );

  const zoom = sku && cur && !pay && (
    <div style={{ background: 'rgba(255,255,255,.97)', border: `1px solid ${LINE}`, borderRadius: 22, padding: 16, boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 12, width: narrow ? '100%' : 560, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 15, flex: 1 }}>{R.skuLabel(sku)}</b>
        <div style={{ display: 'flex', background: SOFT, borderRadius: 999, padding: 3 }}>{(['scan', 'type', 'name'] as Mode[]).map((m) => <button key={m} onClick={() => setMode(m)} style={{ ...seg, background: mode === m ? '#fff' : 'transparent', boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,.12)' : 'none' }}>{m === 'scan' ? 'Scan' : m === 'type' ? (narrow ? 'Type #' : 'Type the number') : (narrow ? 'Find' : 'Look up by name')}</button>)}</div>
        <button onClick={() => { setSel(null); setMsg(null); }} style={pill}>Done</button></div>
      {mode === 'scan' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: narrow ? 6 : 40, background: 'repeating-linear-gradient(92deg,#d8c09c 0px,#d4bb95 22px,#dcc4a1 40px,#d1b791 63px,#d8c09c 90px)', borderRadius: 16, padding: '14px 10px', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd}>
        <Bottle sku={sku} w={narrow ? 92 : 112} h={narrow ? 180 : 214} smudge={smudged} />
        <ScannerGun beam={holding} size={narrow ? 0.8 : 1} />
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
        {R.lookup(q).map((k) => <button key={k.key} onClick={() => nameGo(k.key)} style={{ ...rowBtn }}><span style={{ width: 14, height: 22, borderRadius: 4, background: k.color }} /><span style={{ flex: 1, textAlign: 'left' }}>{R.skuLabel(k)}</span><b>${k.price}</b></button>)}
        {!q && <div style={{ fontSize: 12, color: MUTED }}>Similar products have similar names. Check the size.</div>}
      </div>}
      {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.tone === 'ok' ? GREEN : msg.tone === 'warn' ? AMBER : RED, textAlign: 'center' }}>{msg.text}</div>}
      {cur.c.items.length > 1 && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
        <span style={{ fontSize: 12, color: MUTED }}>On the counter:</span>
        {cur.c.items.map((it) => { const k = R.skuBy(it.sku); return <button key={it.sku} aria-label={`Pick up ${R.skuLabel(k)}`} onClick={() => { setSel(it.sku); setMsg(null); }} style={{ ...mini, display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: sel === it.sku ? INK : LINE }}><span style={{ width: 8, height: 14, borderRadius: 2, background: k.color }} />{R.skuLabel(k)}{it.n > 1 ? ` ×${it.n}` : ''}</button>; })}
      </div>}
    </div>
  );

  const counter = cur && (
    <div style={{ display: 'flex', gap: narrow ? 10 : 16, alignItems: 'flex-end', overflowX: 'auto', padding: '10px 4px 4px' }}>
      {items.map((it, i) => <Bottle key={`${it.key}${i}`} sku={R.skuBy(it.key)} w={narrow ? 54 : 66} h={narrow ? 104 : 126} selected={sel === it.key} onClick={() => { setSel(it.key); setMode('scan'); setMsg(null); }} smudge={cur.c.slips.some((x) => x.kind === 'unreadable' && x.sku === it.key)} />)}
    </div>
  );

  const client = cur ? (
    <div style={{ display: 'flex', alignItems: narrow ? 'center' : 'flex-end', gap: narrow ? 10 : 18 }}>
      <div style={{ flexShrink: 0, transition: 'transform .3s' }}><Person look={cur.c.look} size={narrow ? 120 : 300} mood={cur.mood} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: narrow ? 0 : 90 }}>
        <Say tone={cur.mood < 0.3 ? 'warn' : cur.claim === 'discount' || pay === 'approved' ? 'ok' : 'soft'}>{pay === 'approved' ? 'Thank you! See you next time.' : cur.said}</Say>
        {!narrow && claimCard}
      </div>
    </div>
  ) : <div style={{ fontSize: 15, color: MUTED, padding: 40 }}>{waiting.length ? 'Next client is walking up…' : 'Nobody at the desk right now.'}</div>;

  const coachEl = coach && <div style={{ background: BLUE, color: '#fff', borderRadius: 14, padding: '10px 16px', fontSize: 14, fontWeight: 600, boxShadow: '0 14px 30px -14px rgba(37,99,235,.6)' }}>{coach}</div>;
  const pauseEl = paused && <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,23,26,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}><div style={{ background: '#fff', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}><b style={{ fontSize: 18 }}>Paused</b><Btn onClick={() => setPaused(false)}>Resume</Btn></div></div>;

  if (narrow) return (
    <div style={{ minHeight: '100vh', background: '#efe7dc', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, display: 'flex', flexDirection: 'column', gap: 10, padding: 10, boxSizing: 'border-box' }}>
      <Fonts />{hud}{coachEl}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{queue}</div>
      {client}{claimCard}
      <div style={{ background: '#16171a', borderRadius: 16, padding: 7 }}>{pos}</div>
      {clientScreen}
      <div style={{ background: 'linear-gradient(180deg,#dcc6a4,#c4a67c)', borderRadius: 16, padding: 8 }}>{counter}</div>
      {zoom && <div style={{ position: 'fixed', left: 8, right: 8, bottom: 8, zIndex: 20 }}>{zoom}</div>}
      {pauseEl}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, background: 'linear-gradient(180deg,#efe6da 0%,#e9dfd1 58%,#e2d6c5 100%)' }}>
      <Fonts />
      {/* the salon behind the client */}
      <div style={{ position: 'absolute', left: '50%', top: 70, width: 420, height: 280, transform: 'translateX(-10%)', borderRadius: 12, background: '#f6f1ea', boxShadow: 'inset 0 0 0 10px #fbf8f3' }} />
      <div style={{ position: 'absolute', right: 70, top: 160, width: 84, height: 210, borderRadius: '42px 42px 10px 10px', background: 'radial-gradient(circle at 40% 30%,#6fa36a,#2f6b3a)' }} />
      <div style={{ position: 'absolute', right: 88, top: 350, width: 48, height: 60, borderRadius: '6px 6px 14px 14px', background: '#c9876a' }} />
      <div style={{ position: 'absolute', left: 16, right: 16, top: 14, zIndex: 5 }}>{hud}</div>
      <div style={{ position: 'absolute', right: 24, top: 74, zIndex: 5 }}>{queue}</div>
      {coachEl && <div style={{ position: 'absolute', left: '50%', top: 74, transform: 'translateX(-50%)', zIndex: 6 }}>{coachEl}</div>}
      <div style={{ position: 'absolute', left: '38%', bottom: '40%', zIndex: 1 }}>{client}</div>
      {/* the counter */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', background: 'linear-gradient(180deg,#dcc6a4 0%,#cfb48c 30%,#c4a67c 100%)', borderTop: '10px solid #e8d6b8', zIndex: 2 }} />
      <div style={{ position: 'absolute', left: 28, bottom: 34, width: 'min(430px, 34vw)', height: 'min(430px, 58vh)', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ background: '#16171a', borderRadius: 16, padding: 8, width: '100%', height: '100%', boxSizing: 'border-box', boxShadow: '0 26px 40px -20px rgba(0,0,0,.6)' }}>{pos}</div>
      </div>
      <div style={{ position: 'absolute', left: 'calc(min(430px, 34vw) + 70px)', bottom: 40, zIndex: 3 }}>{counter}</div>
      <div style={{ position: 'absolute', right: 40, bottom: 40, zIndex: 3 }}>{clientScreen || (cur && <Reader amount={money(total)} line1="Waiting for payment" />)}</div>
      {zoom && <div style={{ position: 'absolute', left: '50%', bottom: 30, transform: 'translateX(-30%)', zIndex: 10 }}>{zoom}</div>}
      {pauseEl}
    </div>
  );
}

// ── Menu and review ─────────────────────────────────────────────────────
function Shell({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#efe6da,#e2d6c5)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}><Fonts />{children}</div>;
}
function Fonts() { return <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'); @keyframes regBeam { from { opacity: .55 } to { opacity: 1 } }`}</style>; }
const cardS = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '22px 24px', display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%', boxShadow: '0 30px 60px -36px rgba(22,23,26,.5)' };

function MenuCard({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ ...cardS, maxWidth: 580 }}>
      <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT · BEHIND THE DESK</div>
      <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em' }}>Work the register</div>
      <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>Six clients, a growing line, and the slips that happen on a busy Saturday. Scan their products, fix what goes wrong, and take payment. Nothing real is charged.</div>
      <div style={{ background: SOFT, borderRadius: 14, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}>
        <b>You’ll practice</b><br />Scanning · labels that won’t read · double scans · voids with a reason · a shelf price that doesn’t match · a health flag at checkout
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
