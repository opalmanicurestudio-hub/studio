'use client';
// /screen — THE CLIENT SCREEN (an iPad at the desk). Pair once with a 6-digit code; then it shows the business's welcome,
// the live ticket, asks for a tip, gets card-on-file approval (and a signature when required), and says thank you with a
// receipt offer. Everything it shows comes from its own document; everything the client does goes through the server.
import { ClientPayForm } from '@/components/pay/ClientPayForm';
import * as React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

const KEY = 'cf_client_screen_id';
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
async function call(body: any) {
  return fetch('/api/client-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
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
    <canvas ref={ref} aria-label="Sign here" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
      className="h-48 w-full rounded-3xl" style={{ background: '#fff', border: '2px dashed #d6d3d1', touchAction: 'none' }} />
    <div className="flex items-center justify-between text-[15px]" style={{ color: '#78716c' }}><span>Sign with your finger</span><button type="button" onClick={clear} className="font-semibold underline underline-offset-4">Clear</button></div>
  </div>;
}

export default function ClientScreenPage() {
  const { firestore } = useFirebase() as any;
  const [id, setId] = React.useState<string | null>(null); const [s, setS] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);   // shown at once — no waiting on the database
  const [blocked, setBlocked] = React.useState(false);            // the database refused to let this screen read its status
  const [custom, setCustom] = React.useState(''); const [sig, setSig] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  const [rch, setRch] = React.useState<'email' | 'sms' | null>(null); const [rto, setRto] = React.useState(''); const [rmsg, setRmsg] = React.useState<string | null>(null);
  // Pair (or reuse this iPad's pairing).
  React.useEffect(() => {
    let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (saved) { setId(saved); return; }
    call({ action: 'pair_start' }).then((r: any) => { if (r?.ok) { try { localStorage.setItem(KEY, r.screenId); } catch { /* */ } setCode(r.code); setId(r.screenId); } else setErr(r?.error || 'Couldn’t start pairing — check the connection and reload.'); });
  }, []);
  React.useEffect(() => { if (!firestore || !id) return; return onSnapshot(doc(firestore, 'clientScreens', id), (snap) => {
    if (!snap.exists()) { try { localStorage.removeItem(KEY); } catch { /* */ } setId(null); window.location.reload(); return; }
    const d: any = snap.data();
    if (!d?.tenantId && d?.codeExpiresAt && Date.parse(d.codeExpiresAt) < Date.now()) { try { localStorage.removeItem(KEY); } catch { /* */ } window.location.reload(); return; }   // expired code → a fresh one
    setBlocked(false); setS(d); }, (e: any) => { if (String(e?.code || e?.message || '').includes('permission')) setBlocked(true); else setErr('Lost connection — reconnecting…'); }); }, [firestore, id]);
  // Stay awake; tell the desk we're here.
  React.useEffect(() => { let lock: any = null; const ask = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not supported */ } };
    ask(); const vis = () => { if (document.visibilityState === 'visible') ask(); }; document.addEventListener('visibilitychange', vis); return () => { document.removeEventListener('visibilitychange', vis); try { lock?.release(); } catch { /* */ } }; }, []);
  React.useEffect(() => { if (!id || !s?.tenantId) return; call({ action: 'ping', screenId: id }); const t = setInterval(() => call({ action: 'ping', screenId: id }), 60000); return () => clearInterval(t); }, [id, s?.tenantId]);
  const [payWay, setPayWay] = React.useState<'here' | 'phone' | null>(null); const [qr, setQr] = React.useState<string | null>(null);
  const [thanksOver, setThanksOver] = React.useState<string | null>(null);   // the thank-you goes back to the welcome after a minute
  const q = s?.request;
  React.useEffect(() => { setPayWay(null); setQr(null); if (q?.kind !== 'pay' || !q.phoneUrl) return;
    import('qrcode').then((m: any) => (m.default || m).toDataURL(q.phoneUrl, { width: 520, margin: 1 })).then((u: string) => setQr(u)).catch(() => setQr(null)); }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (q?.kind !== 'thanks' || !q.id) return; const t = setTimeout(() => setThanksOver(q.id), 60000); return () => clearTimeout(t); }, [q?.kind, q?.id]);
  React.useEffect(() => { setCustom(''); setSig(null); setRch(null); setRto(''); setRmsg(null); setErr(null); }, [q?.id]);
  const accent = s?.brand?.accent || '#1c1917';
  const respond = async (body: any) => { setBusy(true); setErr(null); const r: any = await call({ action: 'respond', screenId: id, requestId: q?.id, ...body }); setBusy(false); if (!r?.ok) setErr(r?.error || 'That didn’t go through — please try again.'); };
  const big = 'min-h-[76px] rounded-3xl px-6 text-[22px] font-semibold transition active:scale-[.98] disabled:opacity-40';
  const shell = (children: React.ReactNode) => (   // a function, not a component — so inputs keep focus while typing
    <main className="flex min-h-[100dvh] flex-col items-center justify-center p-8" style={{ background: '#faf8f5', color: '#1c1917', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", paddingTop: 'max(2rem, env(safe-area-inset-top))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-2xl space-y-6">{children}</div>
      {err && <p role="alert" className="mt-6 text-[18px] font-semibold" style={{ color: '#a15c07' }}>{err}</p>}
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
      : <p className="text-center text-[22px]" style={{ color: '#78716c' }}>{err || 'Starting…'}</p>}
    {id && !code && startOver}</>);
  if (!s.tenantId) return shell(<>
    <p className="text-center text-[18px]" style={{ color: '#78716c' }}>Pair this screen with your front desk</p>
    <p className="text-center text-[64px] font-semibold tracking-[0.2em] tabular-nums">{s.code || '······'}</p>
    <p className="text-center text-[17px]" style={{ color: '#78716c' }}>At the POS: <b>● Client screen</b> → enter this code → <b>Pair</b>.</p>
    {startOver}
  </>);
  const brandTop = <div className="flex flex-col items-center gap-3">{s.brand?.logo ? <img src={s.brand.logo} alt="" className="max-h-20 max-w-[60%] object-contain" /> : null}{s.brand?.name ? <p className="text-[20px] font-semibold">{s.brand.name}</p> : null}</div>;
  const tk = s.ticket;
  // Tip
  if (q?.kind === 'tip' && !q.answeredAt) {
    const base = Number(q.base) || 0;
    return shell(<>{brandTop}
      <p className="text-center text-[34px] font-semibold">Add a tip?</p>
      <p className="text-center text-[18px]" style={{ color: '#78716c' }}>{q.tipOn === 'after_tax' ? 'On your total' : 'On your services and products'} · {money(base)}</p>
      <div className={`grid gap-3 ${q.presets.length > 3 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {q.presets.map((p: number) => { const amt = Math.round(base * p) / 100; return <button key={p} type="button" disabled={busy} onClick={() => respond({ tip: amt, tipLabel: `${p}%` })} className={`${big} min-h-[120px] flex flex-col items-center justify-center`} style={{ background: '#fff', border: '2px solid #e7e2dc' }}>
          <span className="text-[34px]">{p}%</span><span className="text-[18px]" style={{ color: '#78716c' }}>{money(amt)}</span></button>; })}
      </div>
      {q.allowCustom && <div className="flex gap-3"><input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Other amount" aria-label="Other tip amount"
        className="min-h-[76px] min-w-0 flex-1 rounded-3xl px-6 text-[24px] outline-none" style={{ background: '#fff', border: '2px solid #e7e2dc' }} />
        <button type="button" disabled={busy || !(Number(custom) > 0)} onClick={() => respond({ tip: Number(custom), tipLabel: 'custom' })} className={big} style={{ background: accent, color: '#fff' }}>Add</button></div>}
      {q.showNoTip && <button type="button" disabled={busy} onClick={() => respond({ tip: 0, tipLabel: 'none' })} className={`${big} w-full`} style={{ background: 'transparent', border: '2px solid #e7e2dc', color: '#57534e' }}>No tip</button>}
    </>);
  }
  // Approve a card-on-file charge (and sign if the business requires it)
  if (q?.kind === 'approve' && !q.answeredAt) return shell(<>{brandTop}
    <p className="text-center text-[34px] font-semibold">Approve this charge?</p>
    <div className="rounded-3xl p-6 text-center" style={{ background: '#fff', border: '1px solid #e7e2dc' }}>
      <p className="text-[48px] font-semibold tabular-nums">{money(q.amount)}</p><p className="text-[20px]" style={{ color: '#57534e' }}>to {q.cardLabel}</p></div>
    {q.signature && <><p className="text-[16px]" style={{ color: '#57534e' }}>{q.text}</p><Signature onChange={setSig} /></>}
    <div className="grid grid-cols-2 gap-3">
      <button type="button" disabled={busy} onClick={() => respond({ approved: false })} className={big} style={{ background: 'transparent', border: '2px solid #e7e2dc', color: '#57534e' }}>Not now</button>
      <button type="button" disabled={busy || (q.signature && !sig)} onClick={() => respond({ approved: true, signature: sig })} className={big} style={{ background: accent, color: '#fff' }}>{busy ? 'Sending…' : 'Approve'}</button>
    </div>
  </>);
  if ((q?.kind === 'tip' || q?.kind === 'approve') && q.answeredAt) return shell(<>{brandTop}<p className="text-center text-[30px] font-semibold">Thank you</p><p className="text-center text-[20px]" style={{ color: '#78716c' }}>Just a moment…</p></>);
  // Pay on the iPad, or on their own phone (QR)
  if (q?.kind === 'pay' && !q.answeredAt) {
    const both = q.payOnScreen !== false && q.payOnPhone !== false; const way = payWay || (both ? null : q.payOnPhone === false ? 'here' : 'phone');
    return shell(<>{brandTop}
      <p className="text-center text-[22px]" style={{ color: '#57534e' }}>Total to pay</p>
      <p className="text-center text-[56px] font-semibold tabular-nums">{money(q.amount)}</p>
      {!way && <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setPayWay('here')} className={`${big} min-h-[120px]`} style={{ background: accent, color: '#fff' }}>Pay here<span className="block text-[16px] font-normal opacity-80">card</span></button>
        <button type="button" onClick={() => setPayWay('phone')} className={`${big} min-h-[120px]`} style={{ background: '#fff', border: '2px solid #e7e2dc' }}>Pay on your phone<span className="block text-[16px] font-normal" style={{ color: '#78716c' }}>Apple Pay · Google Pay</span></button>
      </div>}
      {way === 'here' && <div className="rounded-3xl p-5" style={{ background: '#fff', border: '1px solid #e7e2dc' }}><ClientPayForm screenId={id} requestId={q.id} big onPaid={() => { /* the screen updates when the server confirms */ }} /></div>}
      {way === 'phone' && <div className="space-y-3 text-center">{qr ? <img src={qr} alt="Scan to pay on your phone" className="mx-auto h-72 w-72 rounded-3xl bg-white p-3" /> : <p>Making your code…</p>}
        <p className="text-[20px]">Scan with your phone’s camera to pay</p></div>}
      {both && way && <button type="button" onClick={() => setPayWay(null)} className="mx-auto block text-[17px] font-semibold underline underline-offset-4" style={{ color: '#57534e' }}>Pay another way</button>}
    </>);
  }
  if (q?.kind === 'pay' && q.answeredAt) return shell(<>{brandTop}<p className="text-center text-[34px] font-semibold">Paid — thank you!</p>{s.response?.saved ? <p className="text-center text-[18px]" style={{ color: '#57534e' }}>Your card is saved for next time.</p> : null}</>);
  // Cash: what's due, then their change (with "keep it as a tip")
  if (q?.kind === 'cash') return shell(<>{brandTop}
    <p className="text-center text-[22px]" style={{ color: '#57534e' }}>Paying cash</p>
    <p className="text-center text-[64px] font-semibold tabular-nums">{money(q.due)}</p>
  </>);
  if (q?.kind === 'change' && !q.answeredAt) return shell(<>{brandTop}
    <p className="text-center text-[22px]" style={{ color: '#57534e' }}>You gave {money(q.tendered)} · total {money(q.due)}</p>
    <p className="text-center text-[26px] font-semibold">Your change</p>
    <p className="text-center text-[64px] font-semibold tabular-nums">{money(q.change)}</p>
    {q.offerKeep && <div className="grid grid-cols-2 gap-3">
      <button type="button" disabled={busy} onClick={() => respond({ keep: false })} className={big} style={{ background: '#fff', border: '2px solid #e7e2dc' }}>My change, please</button>
      <button type="button" disabled={busy} onClick={() => respond({ keep: true })} className={big} style={{ background: accent, color: '#fff' }}>Keep it as a tip</button>
    </div>}
  </>);
  if (q?.kind === 'change' && q.answeredAt) return shell(<>{brandTop}<p className="text-center text-[30px] font-semibold">{s.response?.keep ? 'Thank you — that’s very kind!' : 'Here’s your change'}</p>{!s.response?.keep && <p className="text-center text-[48px] font-semibold tabular-nums">{money(q.change)}</p>}</>);
  // Thank you (+ receipt)
  if (q?.kind === 'thanks' && thanksOver !== q.id) return shell(<>{brandTop}
    <p className="text-center text-[40px] font-semibold">Thank you{q.clientFirst ? `, ${q.clientFirst}` : ''}!</p>
    {q.total ? <p className="text-center text-[22px]" style={{ color: '#57534e' }}>Paid {money(q.total)}</p> : null}
    {q.offerReceipt && q.receiptId && <div className="space-y-3">
      {!rch && !rmsg && <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setRch('sms')} className={big} style={{ background: '#fff', border: '2px solid #e7e2dc' }}>Text my receipt</button><button type="button" onClick={() => setRch('email')} className={big} style={{ background: '#fff', border: '2px solid #e7e2dc' }}>Email my receipt</button></div>}
      {rch && <div className="flex gap-3"><input value={rto} onChange={(e) => setRto(e.target.value)} type={rch === 'email' ? 'email' : 'tel'} inputMode={rch === 'email' ? 'email' : 'tel'} autoComplete={rch === 'email' ? 'email' : 'tel'} placeholder={rch === 'email' ? 'Your email' : 'Your mobile number'} aria-label={rch === 'email' ? 'Your email' : 'Your mobile number'}
        className="min-h-[76px] min-w-0 flex-1 rounded-3xl px-6 text-[22px] outline-none" style={{ background: '#fff', border: '2px solid #e7e2dc' }} />
        <button type="button" disabled={busy || !rto.trim()} onClick={async () => { setBusy(true); const r: any = await call({ action: 'receipt', screenId: id, channel: rch, to: rto }); setBusy(false); if (r?.ok) { setRmsg('Sent — thank you!'); setRch(null); } else setErr(r?.error || 'It didn’t send.'); }} className={big} style={{ background: accent, color: '#fff' }}>Send</button></div>}
      {rmsg && <p className="text-center text-[20px] font-semibold">{rmsg}</p>}
    </div>}
  </>);
  // The live ticket
  const momentBanner = (tk?.moments || []).length ? <div className="space-y-1 rounded-3xl p-5 text-center" style={{ background: `color-mix(in srgb, ${accent} 10%, #fff)` }}>{tk.moments.map((m: string, i: number) => <p key={i} className="text-[22px] font-semibold">{m}</p>)}</div> : null;
  if (tk && (tk.lines || []).length) return shell(<>
    {momentBanner}
    <div className="flex items-center justify-between">{s.brand?.logo ? <img src={s.brand.logo} alt="" className="max-h-12 max-w-[40%] object-contain" /> : <p className="text-[20px] font-semibold">{s.brand?.name}</p>}{tk.clientFirst ? <p className="text-[20px]" style={{ color: '#57534e' }}>Hi {tk.clientFirst}</p> : null}</div>
    <div className="space-y-3 rounded-3xl p-6" style={{ background: '#fff', border: '1px solid #e7e2dc' }}>
      {tk.lines.map((l: any, i: number) => <div key={i} className="flex justify-between gap-4 text-[20px]"><span>{l.label}{l.note ? <span style={{ color: '#78716c' }}> · {l.note}</span> : null}</span><span className="tabular-nums">{money(l.amount)}</span></div>)}
      <hr style={{ borderColor: '#e7e2dc' }} />
      <div className="space-y-1.5 text-[18px]" style={{ color: '#57534e' }}>
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(tk.subtotal)}</span></div>
        {tk.discount > 0 && <div className="flex justify-between"><span>Discounts</span><span className="tabular-nums">−{money(tk.discount)}</span></div>}
        {tk.tax > 0 && <div className="flex justify-between"><span>{tk.taxLabel}</span><span className="tabular-nums">{money(tk.tax)}</span></div>}
        {tk.tip > 0 && <div className="flex justify-between"><span>Tip</span><span className="tabular-nums">{money(tk.tip)}</span></div>}
        {tk.paid > 0 && <div className="flex justify-between"><span>Already paid</span><span className="tabular-nums">−{money(tk.paid)}</span></div>}
      </div>
      <div className="flex justify-between pt-1 text-[30px] font-semibold"><span>Total</span><span className="tabular-nums">{money(tk.due ?? tk.total)}</span></div>
    </div>
  </>);
  // A personal welcome (client chosen, nothing rung up yet)
  if (tk?.clientFirst) return shell(<>{brandTop}<p className="text-center text-[38px] font-semibold">Hi {tk.clientFirst}</p>{momentBanner}<p className="text-center text-[20px]" style={{ color: '#78716c' }}>We’ll have everything ready for you in a moment.</p></>);
  // Welcome
  return shell(<>{brandTop}<p className="text-center text-[26px]" style={{ color: '#57534e' }}>{s.settings?.welcome || 'Welcome'}</p></>);
}
