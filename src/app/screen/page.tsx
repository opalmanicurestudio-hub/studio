'use client';
// /screen — THE CLIENT SCREEN (an iPad at the desk). Pair once with a 6-digit code; then it follows the checkout by itself:
// welcome → the live ticket → (pay on the iPad: review → tip → pay here / on your phone) · (card on file: tip → approve + sign)
// · (cash: the total → their change: keep it all / keep some / my change) → thank you → back to the business's logo.
// Everything it shows comes from its own document; everything the client does goes through the server.
// Motion is gentle, follows the business's setting (lively / calm / off) and the iPad's "Reduce Motion".
import * as React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { ClientPayForm } from '@/components/pay/ClientPayForm';

const KEY = 'cf_client_screen_id';
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
async function call(body: any) {
  return fetch('/api/client-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
}

const CSS = `
@keyframes cs-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes cs-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes cs-drift{0%{transform:translate(-10%,-10%) scale(1)}50%{transform:translate(10%,6%) scale(1.15)}100%{transform:translate(-10%,-10%) scale(1)}}
@keyframes cs-dot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
@keyframes cs-spin{to{transform:rotate(360deg)}}
@keyframes cs-ring{0%{transform:scale(.92);opacity:.55}100%{transform:scale(1.18);opacity:0}}
@keyframes cs-draw{to{stroke-dashoffset:0}}
@keyframes cs-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
@keyframes cs-fall{0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:1}100%{transform:translate3d(var(--dx),105vh,0) rotate(720deg);opacity:.9}}
.cs-in{animation:cs-in .45s cubic-bezier(.2,.8,.2,1) both}
.cs-float{animation:cs-float 6s ease-in-out infinite}
.cs-pop{animation:cs-pop .5s cubic-bezier(.2,.8,.2,1) both}
.cs-calm .cs-float,.cs-calm .cs-glow{animation-duration:14s}
.cs-off *,.cs-off *::before,.cs-off *::after{animation:none!important;transition:none!important}
@media (prefers-reduced-motion:reduce){.cs-root *,.cs-root *::before,.cs-root *::after{animation:none!important;transition:none!important}}
`;
function Dots() { return <span aria-hidden className="inline-flex gap-1.5 align-middle">{[0, 1, 2].map((i) => <span key={i} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'currentColor', animation: `cs-dot 1.2s ${i * 0.18}s infinite ease-in-out` }} />)}</span>; }
function Spinner({ color }: { color: string }) { return <span aria-hidden className="inline-block h-10 w-10 rounded-full" style={{ border: `4px solid color-mix(in srgb, ${color} 18%, transparent)`, borderTopColor: color, animation: 'cs-spin .9s linear infinite' }} />; }
function Check({ color }: { color: string }) {
  return <svg viewBox="0 0 88 88" className="cs-pop mx-auto h-28 w-28" aria-hidden><circle cx="44" cy="44" r="40" fill="none" stroke={color} strokeWidth="5" strokeDasharray="252" strokeDashoffset="252" style={{ animation: 'cs-draw .7s .05s ease-out forwards' }} />
    <path d="M27 45 L39 57 L62 33" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset="60" style={{ animation: 'cs-draw .45s .6s ease-out forwards' }} /></svg>;
}
function Confetti({ accent }: { accent: string }) {
  const bits = React.useMemo(() => Array.from({ length: 36 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.6, dur: 2.4 + Math.random() * 1.6, dx: `${(Math.random() - 0.5) * 30}vw`, size: 6 + Math.random() * 8,
    color: [accent, '#f5c26b', '#f28b82', '#8ecae6', '#b5e48c'][i % 5], round: i % 3 === 0 })), [accent]);
  return <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">{bits.map((b, i) => <span key={i} className="absolute top-0"
    style={{ left: `${b.left}%`, width: b.size, height: b.round ? b.size : b.size * 0.45, borderRadius: b.round ? 999 : 2, background: b.color, ['--dx' as any]: b.dx, animation: `cs-fall ${b.dur}s ${b.delay}s cubic-bezier(.2,.6,.4,1) both` }} />)}</div>;
}
function CountUp({ value }: { value: number }) {
  const [v, setV] = React.useState(value); const from = React.useRef(value);
  React.useEffect(() => { const a = from.current, b = value; if (a === b) return; const t0 = performance.now(); let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 450); setV(a + (b - a) * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); else from.current = b; };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf); }, [value]);
  return <>{money(v)}</>;
}
function Signature({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = React.useRef<HTMLCanvasElement>(null); const drawing = React.useRef(false); const dirty = React.useRef(false);
  React.useEffect(() => { const c = ref.current; if (!c) return; const r = c.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); const g = c.getContext('2d')!; g.scale(dpr, dpr); g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#1c1917'; }, []);
  const pt = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e: React.PointerEvent) => { e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); drawing.current = true; const g = ref.current!.getContext('2d')!; const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const g = ref.current!.getContext('2d')!; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); };
  return <div className="space-y-2">
    <canvas ref={ref} aria-label="Sign here" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} className="h-48 w-full rounded-3xl" style={{ background: '#fff', border: '2px dashed #d6d3d1', touchAction: 'none' }} />
    <div className="flex items-center justify-between text-[15px]" style={{ color: '#78716c' }}><span>Sign with your finger</span><button type="button" onClick={clear} className="font-semibold underline underline-offset-4">Clear</button></div>
  </div>;
}

export default function ClientScreenPage() {
  const { firestore } = useFirebase() as any;
  const [id, setId] = React.useState<string | null>(null); const [s, setS] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null); const [blocked, setBlocked] = React.useState(false);
  const [custom, setCustom] = React.useState(''); const [sig, setSig] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  const [rch, setRch] = React.useState<'email' | 'sms' | null>(null); const [rto, setRto] = React.useState(''); const [rmsg, setRmsg] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<'review' | 'tip' | 'pay'>('review'); const [payWay, setPayWay] = React.useState<'here' | 'phone' | null>(null); const [qr, setQr] = React.useState<string | null>(null);
  const [keepSome, setKeepSome] = React.useState(false); const [keepAmt, setKeepAmt] = React.useState('');
  const [thanksOver, setThanksOver] = React.useState<string | null>(null); const [clock, setClock] = React.useState('');
  React.useEffect(() => {
    let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (saved) { setId(saved); return; }
    call({ action: 'pair_start' }).then((r: any) => { if (r?.ok) { try { localStorage.setItem(KEY, r.screenId); } catch { /* */ } setCode(r.code); setId(r.screenId); } else setErr(r?.error || 'Couldn’t start pairing — check the connection and reload.'); });
  }, []);
  React.useEffect(() => { if (!firestore || !id) return; return onSnapshot(doc(firestore, 'clientScreens', id), (snap) => {
    if (!snap.exists()) { try { localStorage.removeItem(KEY); } catch { /* */ } setId(null); window.location.reload(); return; }
    const d: any = snap.data();
    if (!d?.tenantId && d?.codeExpiresAt && Date.parse(d.codeExpiresAt) < Date.now()) { try { localStorage.removeItem(KEY); } catch { /* */ } window.location.reload(); return; }
    setBlocked(false); setS(d); }, (e: any) => { if (String(e?.code || e?.message || '').includes('permission')) setBlocked(true); else setErr('Lost connection — reconnecting…'); }); }, [firestore, id]);
  React.useEffect(() => { let lock: any = null; const ask = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not supported */ } };
    ask(); const vis = () => { if (document.visibilityState === 'visible') ask(); }; document.addEventListener('visibilitychange', vis); return () => { document.removeEventListener('visibilitychange', vis); try { lock?.release(); } catch { /* */ } }; }, []);
  React.useEffect(() => { if (!id || !s?.tenantId) return; call({ action: 'ping', screenId: id }); const t = setInterval(() => call({ action: 'ping', screenId: id }), 60000); return () => clearInterval(t); }, [id, s?.tenantId]);
  React.useEffect(() => { const tick = () => setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })); tick(); const t = setInterval(tick, 20000); return () => clearInterval(t); }, []);
  const q = s?.request;
  React.useEffect(() => { setCustom(''); setSig(null); setRch(null); setRto(''); setRmsg(null); setErr(null); setPayWay(null); setQr(null); setKeepSome(false); setKeepAmt('');
    if (q?.kind === 'pay') setStep(q.review ? 'review' : q.askTip && !q.tipChosen ? 'tip' : 'pay'); }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (q?.kind !== 'pay' || !q.phoneUrl || step !== 'pay') return;
    import('qrcode').then((m: any) => (m.default || m).toDataURL(q.phoneUrl, { width: 560, margin: 1 })).then((u: string) => setQr(u)).catch(() => setQr(null)); }, [q?.id, step]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (q?.kind !== 'thanks' || !q.id) return; const t = setTimeout(() => setThanksOver(q.id), (Number(q.returnAfter) || 20) * 1000); return () => clearTimeout(t); }, [q?.kind, q?.id]);

  const accent = s?.brand?.accent || '#1c1917';
  const motion = s?.settings?.motion === 'off' ? 'cs-off' : s?.settings?.motion === 'calm' ? 'cs-calm' : '';
  const confettiOn = s?.settings?.confetti !== false && !motion.includes('off');
  const respond = async (body: any) => { setBusy(true); setErr(null); const r: any = await call({ action: 'respond', screenId: id, requestId: q?.id, ...body }); setBusy(false); if (!r?.ok) setErr(r?.error || 'That didn’t go through — please try again.'); };
  const big = 'min-h-[76px] rounded-3xl px-6 text-[22px] font-semibold transition active:scale-[.98] disabled:opacity-40';
  const ghost = { background: '#fff', border: '2px solid #e7e2dc' } as React.CSSProperties;
  const solid = { background: accent, color: '#fff' } as React.CSSProperties;
  const stageKey = `${q?.id || 'none'}|${q?.kind || ''}|${step}|${q?.answeredAt ? 'a' : ''}|${thanksOver === q?.id ? 'o' : ''}`;
  const shell = (children: React.ReactNode, opts: { glow?: boolean; confetti?: boolean } = {}) => (   // a function, not a component — so inputs keep focus while typing
    <main className={`cs-root ${motion} relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden p-8`} style={{ background: '#faf8f5', color: '#1c1917', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", paddingTop: 'max(2rem, env(safe-area-inset-top))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
      <style>{CSS}</style>
      {opts.glow && <div aria-hidden className="cs-glow pointer-events-none absolute -inset-1/4" style={{ background: `radial-gradient(40% 40% at 30% 30%, color-mix(in srgb, ${accent} 22%, transparent), transparent 70%), radial-gradient(35% 35% at 75% 70%, color-mix(in srgb, ${accent} 14%, transparent), transparent 70%)`, animation: 'cs-drift 18s ease-in-out infinite' }} />}
      {opts.confetti && confettiOn && <Confetti accent={accent} />}
      <div key={stageKey} className="cs-in relative w-full max-w-2xl space-y-6">{children}</div>
      {err && <p role="alert" className="relative mt-6 text-[18px] font-semibold" style={{ color: '#a15c07' }}>{err}</p>}
    </main>);
  const startOver = <button type="button" onClick={() => { try { localStorage.removeItem(KEY); } catch { /* */ } window.location.reload(); }} className="mx-auto block text-[16px] font-semibold underline underline-offset-4" style={{ color: '#57534e' }}>Start over with a new code</button>;
  if (blocked) return shell(<>
    <p className="text-center text-[26px] font-semibold">This screen can’t read its status yet</p>
    {code && <><p className="text-center text-[18px]" style={{ color: '#78716c' }}>Your pairing code</p><p className="text-center text-[56px] font-semibold tracking-[0.2em] tabular-nums">{code}</p></>}
    <p className="text-center text-[17px]" style={{ color: '#57534e' }}>The database rules that let a client screen read its own status haven’t been published. In the Firebase console → Firestore → Rules, paste the latest rules and tap Publish, then reload this page.</p>
    {startOver}</>);
  if (!id || !s) return shell(<>
    {code ? <><p className="text-center text-[18px]" style={{ color: '#78716c' }}>Pair this screen with your front desk</p><p className="text-center text-[64px] font-semibold tracking-[0.2em] tabular-nums">{code}</p>
      <p className="text-center text-[17px]" style={{ color: '#78716c' }}>At the POS: <b>● Client screen</b> → enter this code → <b>Pair</b>.</p></>
      : <p className="text-center text-[22px]" style={{ color: '#78716c' }}>{err || <>Starting <Dots /></>}</p>}
    {id && !code && startOver}</>);
  if (!s.tenantId) return shell(<>
    <p className="text-center text-[18px]" style={{ color: '#78716c' }}>Pair this screen with your front desk</p>
    <p className="text-center text-[64px] font-semibold tracking-[0.2em] tabular-nums">{s.code || code || '······'}</p>
    <p className="text-center text-[17px]" style={{ color: '#78716c' }}>At the POS: <b>● Client screen</b> → enter this code → <b>Pair</b>.</p>
    {startOver}</>);
  const brandTop = <div className="flex flex-col items-center gap-3">{s.brand?.logo ? <img src={s.brand.logo} alt="" className="max-h-20 max-w-[60%] object-contain" /> : null}{s.brand?.name ? <p className="text-[20px] font-semibold">{s.brand.name}</p> : null}</div>;
  const tk = s.ticket;
  const celebrating = (tk?.moments || []).length > 0;
  const momentBanner = (tk?.moments || []).length ? <div className="cs-pop space-y-1 rounded-3xl p-5 text-center" style={{ background: `color-mix(in srgb, ${accent} 12%, #fff)` }}>{tk.moments.map((m: string, i: number) => <p key={i} className="text-[22px] font-semibold">{m}</p>)}</div> : null;
  const ticketLines = (lines: any[]) => lines.map((l: any, i: number) => <div key={`${l.label}-${i}`} className="cs-in flex justify-between gap-4 text-[20px]" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}><span>{l.label}{l.note ? <span style={{ color: '#78716c' }}> · {l.note}</span> : null}</span><span className="tabular-nums">{money(l.amount)}</span></div>);

  // ── Pay on the iPad: review → tip → pay here / on your phone ──
  if (q?.kind === 'pay' && !q.answeredAt) {
    if (step === 'review') return shell(<>{brandTop}
      <p className="text-center text-[30px] font-semibold">{tk?.clientFirst ? `Here’s your total, ${tk.clientFirst}` : 'Here’s your total'}</p>
      {tk?.lines?.length ? <div className="space-y-3 rounded-3xl p-6" style={{ background: '#fff', border: '1px solid #e7e2dc' }}>{ticketLines(tk.lines)}
        {(tk.discount > 0 || tk.tax > 0) && <div className="space-y-1 border-t pt-2 text-[18px]" style={{ borderColor: '#e7e2dc', color: '#57534e' }}>{tk.discount > 0 && <div className="flex justify-between"><span>Discounts</span><span>−{money(tk.discount)}</span></div>}{tk.tax > 0 && <div className="flex justify-between"><span>{tk.taxLabel}</span><span>{money(tk.tax)}</span></div>}</div>}</div> : null}
      <p className="text-center text-[56px] font-semibold tabular-nums"><CountUp value={Number(q.amount) || 0} /></p>
      <button type="button" onClick={() => setStep(q.askTip && !q.tipChosen ? 'tip' : 'pay')} className={`${big} w-full`} style={solid}>Looks right</button>
    </>, { glow: true });
    if (step === 'tip') {
      const base = Number(q.tipBase) || 0; const presets: number[] = q.presets || [18, 20, 25];
      const choose = async (tip: number) => { setBusy(true); const r: any = await call({ action: 'pay_tip', screenId: id, requestId: q.id, tip }); setBusy(false); if (r?.ok) setStep('pay'); else setErr(r?.error || 'Try again.'); };
      return shell(<>{brandTop}
        <p className="text-center text-[34px] font-semibold">Add a tip?</p>
        <div className={`grid gap-3 ${presets.length > 3 ? 'grid-cols-2' : 'grid-cols-3'}`}>{presets.map((p, i) => { const amt = Math.round(base * p) / 100; return <button key={p} type="button" disabled={busy} onClick={() => choose(amt)} className={`${big} cs-in flex min-h-[120px] flex-col items-center justify-center`} style={{ ...ghost, animationDelay: `${i * 70}ms` }}><span className="text-[34px]">{p}%</span><span className="text-[18px]" style={{ color: '#78716c' }}>{money(amt)}</span></button>; })}</div>
        {q.allowCustom !== false && <div className="flex gap-3"><input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Other amount" aria-label="Other tip amount" className="min-h-[76px] min-w-0 flex-1 rounded-3xl px-6 text-[24px] outline-none" style={ghost} />
          <button type="button" disabled={busy || !(Number(custom) > 0)} onClick={() => choose(Number(custom))} className={big} style={solid}>Add</button></div>}
        {q.showNoTip !== false && <button type="button" disabled={busy} onClick={() => choose(0)} className={`${big} w-full`} style={{ ...ghost, color: '#57534e' }}>No tip</button>}
        {busy && <p className="text-center text-[18px]" style={{ color: '#78716c' }}>Updating your total <Dots /></p>}
      </>, { glow: true });
    }
    const both = q.payOnScreen !== false && q.payOnPhone !== false; const way = payWay || (both ? null : q.payOnPhone === false ? 'here' : 'phone');
    return shell(<>{brandTop}
      <p className="text-center text-[22px]" style={{ color: '#57534e' }}>Total to pay{Number(q.tip) > 0 ? ` · includes ${money(q.tip)} tip` : ''}</p>
      <p className="text-center text-[56px] font-semibold tabular-nums"><CountUp value={Number(q.amount) || 0} /></p>
      {!way && <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setPayWay('here')} className={`${big} cs-in min-h-[120px]`} style={solid}>Pay here<span className="block text-[16px] font-normal opacity-80">card</span></button>
        <button type="button" onClick={() => setPayWay('phone')} className={`${big} cs-in min-h-[120px]`} style={{ ...ghost, animationDelay: '80ms' }}>Pay on your phone<span className="block text-[16px] font-normal" style={{ color: '#78716c' }}>Apple Pay · Google Pay</span></button>
      </div>}
      {way === 'here' && <div className="rounded-3xl p-5" style={{ background: '#fff', border: '1px solid #e7e2dc' }}><ClientPayForm screenId={id} requestId={q.id} big onPaid={() => { /* the screen moves on when the server confirms */ }} /></div>}
      {way === 'phone' && <div className="space-y-3 text-center">{qr ? <div className="relative mx-auto h-80 w-80"><span aria-hidden className="absolute inset-0 rounded-[2rem]" style={{ border: `3px solid ${accent}`, animation: 'cs-ring 2s ease-out infinite' }} /><img src={qr} alt="Scan to pay on your phone" className="relative h-80 w-80 rounded-[2rem] bg-white p-4 shadow-sm" /></div> : <Spinner color={accent} />}
        <p className="text-[20px]">Scan with your phone’s camera to pay</p><p className="text-[16px]" style={{ color: '#78716c' }}>This screen moves on by itself when you’ve paid <Dots /></p></div>}
      {both && way && <button type="button" onClick={() => setPayWay(null)} className="mx-auto block text-[17px] font-semibold underline underline-offset-4" style={{ color: '#57534e' }}>Pay another way</button>}
    </>);
  }
  if (q?.kind === 'pay' && q.answeredAt) return shell(<>{brandTop}<Check color={accent} /><p className="text-center text-[34px] font-semibold">Paid — thank you!</p>{s.response?.saved ? <p className="text-center text-[18px]" style={{ color: '#57534e' }}>Your card is saved for next time.</p> : null}</>, { confetti: true });
  // ── A tip on its own (card on file) ──
  if (q?.kind === 'tip' && !q.answeredAt) {
    const base = Number(q.base) || 0;
    return shell(<>{brandTop}
      <p className="text-center text-[34px] font-semibold">Add a tip?</p>
      <p className="text-center text-[18px]" style={{ color: '#78716c' }}>{q.tipOn === 'after_tax' ? 'On your total' : 'On your services and products'} · {money(base)}</p>
      <div className={`grid gap-3 ${q.presets.length > 3 ? 'grid-cols-2' : 'grid-cols-3'}`}>{q.presets.map((p: number, i: number) => { const amt = Math.round(base * p) / 100; return <button key={p} type="button" disabled={busy} onClick={() => respond({ tip: amt, tipLabel: `${p}%` })} className={`${big} cs-in flex min-h-[120px] flex-col items-center justify-center`} style={{ ...ghost, animationDelay: `${i * 70}ms` }}><span className="text-[34px]">{p}%</span><span className="text-[18px]" style={{ color: '#78716c' }}>{money(amt)}</span></button>; })}</div>
      {q.allowCustom && <div className="flex gap-3"><input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Other amount" aria-label="Other tip amount" className="min-h-[76px] min-w-0 flex-1 rounded-3xl px-6 text-[24px] outline-none" style={ghost} />
        <button type="button" disabled={busy || !(Number(custom) > 0)} onClick={() => respond({ tip: Number(custom), tipLabel: 'custom' })} className={big} style={solid}>Add</button></div>}
      {q.showNoTip && <button type="button" disabled={busy} onClick={() => respond({ tip: 0, tipLabel: 'none' })} className={`${big} w-full`} style={{ ...ghost, color: '#57534e' }}>No tip</button>}
    </>, { glow: true });
  }
  // ── Approve a card-on-file charge (and sign if required) ──
  if (q?.kind === 'approve' && !q.answeredAt) return shell(<>{brandTop}
    <p className="text-center text-[34px] font-semibold">Approve this charge?</p>
    <div className="rounded-3xl p-6 text-center" style={{ background: '#fff', border: '1px solid #e7e2dc' }}><p className="text-[48px] font-semibold tabular-nums"><CountUp value={Number(q.amount) || 0} /></p><p className="text-[20px]" style={{ color: '#57534e' }}>to {q.cardLabel}</p></div>
    {q.signature && <><p className="text-[16px]" style={{ color: '#57534e' }}>{q.text}</p><Signature onChange={setSig} /></>}
    <div className="grid grid-cols-2 gap-3">
      <button type="button" disabled={busy} onClick={() => respond({ approved: false })} className={big} style={{ ...ghost, color: '#57534e' }}>Not now</button>
      <button type="button" disabled={busy || (q.signature && !sig)} onClick={() => respond({ approved: true, signature: sig })} className={big} style={solid}>{busy ? <Dots /> : 'Approve'}</button>
    </div>
  </>);
  if ((q?.kind === 'tip' || q?.kind === 'approve') && q.answeredAt) return shell(<>{brandTop}<p className="text-center text-[30px] font-semibold">Thank you</p><p className="text-center text-[20px]" style={{ color: '#78716c' }}>Just a moment <Dots /></p></>);
  // ── Cash: the total, then their change (keep it all / keep some / my change) ──
  if (q?.kind === 'cash') return shell(<>{brandTop}
    <p className="text-center text-[22px]" style={{ color: '#57534e' }}>Paying cash</p>
    <p className="text-center text-[64px] font-semibold tabular-nums"><CountUp value={Number(q.due) || 0} /></p>
  </>, { glow: true });
  if (q?.kind === 'change' && !q.answeredAt) {
    const change = Number(q.change) || 0; const k = Math.min(change, Number(keepAmt) || 0);
    return shell(<>{brandTop}
      <p className="text-center text-[20px]" style={{ color: '#57534e' }}>You gave {money(q.tendered)} · total {money(q.due)}</p>
      <p className="text-center text-[26px] font-semibold">Your change</p>
      <p className="text-center text-[64px] font-semibold tabular-nums"><CountUp value={change} /></p>
      {q.offerKeep && !keepSome && <div className="grid gap-3 sm:grid-cols-3">
        <button type="button" disabled={busy} onClick={() => respond({ keepAmount: change })} className={big} style={solid}>Keep it all as a tip</button>
        <button type="button" disabled={busy} onClick={() => setKeepSome(true)} className={big} style={ghost}>Keep some</button>
        <button type="button" disabled={busy} onClick={() => respond({ keepAmount: 0 })} className={big} style={ghost}>My change, please</button>
      </div>}
      {q.offerKeep && keepSome && <div className="space-y-3">
        <p className="text-center text-[20px]">How much would you like to leave as a tip?</p>
        <div className="flex gap-3"><input autoFocus value={keepAmt} onChange={(e) => setKeepAmt(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder={`Up to ${money(change)}`} aria-label="Tip amount from your change"
          className="min-h-[76px] min-w-0 flex-1 rounded-3xl px-6 text-center text-[30px] outline-none tabular-nums" style={ghost} /></div>
        <div className="grid grid-cols-4 gap-2">{[1, 2, 5, 10].filter((n) => n <= change).map((n) => <button key={n} type="button" onClick={() => setKeepAmt(String(n))} className="min-h-[60px] rounded-2xl text-[20px] font-semibold" style={ghost}>${n}</button>)}</div>
        {k > 0 && <p className="text-center text-[18px]" style={{ color: '#57534e' }}>Tip {money(k)} · your change {money(change - k)}</p>}
        <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => { setKeepSome(false); setKeepAmt(''); }} className={big} style={ghost}>Back</button>
          <button type="button" disabled={busy || !(k > 0)} onClick={() => respond({ keepAmount: k })} className={big} style={solid}>Leave {money(k)}</button></div>
      </div>}
    </>);
  }
  if (q?.kind === 'change' && q.answeredAt) { const kept = Number(s.response?.keepAmount) || 0; const back = Math.max(0, (Number(q.change) || 0) - kept);
    return shell(<>{brandTop}{kept > 0 ? <><Check color={accent} /><p className="text-center text-[30px] font-semibold">Thank you — that’s very kind!</p></> : null}
      {back > 0 && <><p className="text-center text-[24px]" style={{ color: '#57534e' }}>Here’s your change</p><p className="text-center text-[56px] font-semibold tabular-nums">{money(back)}</p></>}</>, { confetti: kept > 0 }); }
  // ── Thank you (+ receipt), then back to the logo ──
  if (q?.kind === 'thanks' && thanksOver !== q.id) return shell(<>{brandTop}
    <Check color={accent} />
    <p className="text-center text-[40px] font-semibold">Thank you{q.clientFirst ? `, ${q.clientFirst}` : ''}!</p>
    {q.total ? <p className="text-center text-[22px]" style={{ color: '#57534e' }}>Paid {money(q.total)}</p> : null}
    {q.offerReceipt && q.receiptId && <div className="space-y-3">
      {!rch && !rmsg && <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setRch('sms')} className={big} style={ghost}>Text my receipt</button><button type="button" onClick={() => setRch('email')} className={big} style={ghost}>Email my receipt</button></div>}
      {rch && <div className="flex gap-3"><input value={rto} onChange={(e) => setRto(e.target.value)} type={rch === 'email' ? 'email' : 'tel'} inputMode={rch === 'email' ? 'email' : 'tel'} autoComplete={rch === 'email' ? 'email' : 'tel'} placeholder={rch === 'email' ? 'Your email' : 'Your mobile number'} aria-label={rch === 'email' ? 'Your email' : 'Your mobile number'}
        className="min-h-[76px] min-w-0 flex-1 rounded-3xl px-6 text-[22px] outline-none" style={ghost} />
        <button type="button" disabled={busy || !rto.trim()} onClick={async () => { setBusy(true); const r: any = await call({ action: 'receipt', screenId: id, channel: rch, to: rto }); setBusy(false); if (r?.ok) { setRmsg('Sent — thank you!'); setRch(null); } else setErr(r?.error || 'It didn’t send.'); }} className={big} style={solid}>{busy ? <Dots /> : 'Send'}</button></div>}
      {rmsg && <p className="text-center text-[20px] font-semibold">{rmsg}</p>}
    </div>}
  </>, { confetti: celebrating });
  // ── The live ticket ──
  if (tk && (tk.lines || []).length) return shell(<>
    {momentBanner}
    <div className="flex items-center justify-between">{s.brand?.logo ? <img src={s.brand.logo} alt="" className="max-h-12 max-w-[40%] object-contain" /> : <p className="text-[20px] font-semibold">{s.brand?.name}</p>}{tk.clientFirst ? <p className="text-[20px]" style={{ color: '#57534e' }}>Hi {tk.clientFirst}</p> : null}</div>
    <div className="space-y-3 rounded-3xl p-6" style={{ background: '#fff', border: '1px solid #e7e2dc' }}>
      {ticketLines(tk.lines)}
      <hr style={{ borderColor: '#e7e2dc' }} />
      <div className="space-y-1.5 text-[18px]" style={{ color: '#57534e' }}>
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(tk.subtotal)}</span></div>
        {tk.discount > 0 && <div className="flex justify-between"><span>Discounts</span><span className="tabular-nums">−{money(tk.discount)}</span></div>}
        {tk.tax > 0 && <div className="flex justify-between"><span>{tk.taxLabel}</span><span className="tabular-nums">{money(tk.tax)}</span></div>}
        {tk.tip > 0 && <div className="flex justify-between"><span>Tip</span><span className="tabular-nums">{money(tk.tip)}</span></div>}
        {tk.paid > 0 && <div className="flex justify-between"><span>Already paid</span><span className="tabular-nums">−{money(tk.paid)}</span></div>}
      </div>
      <div className="flex justify-between pt-1 text-[30px] font-semibold"><span>Total</span><span className="tabular-nums"><CountUp value={Number(tk.due ?? tk.total) || 0} /></span></div>
    </div>
  </>);
  // ── A personal welcome, then the business's own welcome (logo) ──
  if (tk?.clientFirst) return shell(<>{brandTop}<p className="text-center text-[40px] font-semibold">Hi {tk.clientFirst}</p>{momentBanner}<p className="text-center text-[20px]" style={{ color: '#78716c' }}>We’ll have everything ready in a moment <Dots /></p></>, { glow: true, confetti: celebrating });
  return shell(<>
    <div className="cs-float flex flex-col items-center gap-4">{s.brand?.logo ? <img src={s.brand.logo} alt="" className="max-h-28 max-w-[70%] object-contain" /> : s.brand?.name ? <p className="text-[34px] font-semibold">{s.brand.name}</p> : null}</div>
    <p className="text-center text-[26px]" style={{ color: '#57534e' }}>{s.settings?.welcome || 'Welcome'}</p>
    {clock && <p className="text-center text-[18px] tabular-nums" style={{ color: '#a8a29e' }}>{clock}</p>}
  </>, { glow: true });
}
