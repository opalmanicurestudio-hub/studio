'use client';
// Practice a shift, two players: the client screen. Open this on a second device (an iPad is perfect),
// enter the code from the desk, and play the client: choose a tip, tap your card, keep the change,
// pick your next visit, say yes or no to a membership, and choose a receipt.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import * as Room from '@/lib/practice/room';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const fmt = (currency: string, cents: number) => new Intl.NumberFormat({ USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', CAD: 'en-CA' }[currency] || 'en-US', { style: 'currency', currency }).format(cents / 100);

export default function ClientScreen() {
  const auth = useAuth(); const db = useFirestore();
  const [tp, setTp] = useState<Room.Transport | null>(null);
  useEffect(() => { const local = new URLSearchParams(window.location.search).get('local') === '1'; setTp(local ? Room.localTransport() : Room.cloudTransport(db, auth)); }, [db, auth]);
  const [code, setCode] = useState(''); const [room, setRoom] = useState<string | null>(null);
  const [view, setView] = useState<Room.DeskView | null>(null); const [err, setErr] = useState<string | null>(null);
  const [answered, setAnswered] = useState<number>(-2); const [custom, setCustom] = useState(''); const [joining, setJoining] = useState(false);

  useEffect(() => { const c = new URLSearchParams(window.location.search).get('room'); if (c) setCode(Room.cleanCode(c)); }, []);
  useEffect(() => {
    if (!room || !tp) return;
    return tp.watch(room, (r) => { if (!r) { setErr('This room has ended. Ask the desk for a new code.'); setRoom(null); return; } setView(r.desk); });
  }, [room, tp]);

  const join = async () => {
    setErr(null); setJoining(true);
    try { const id = Room.cleanCode(code); await tp!.join(id); setRoom(id); }
    catch (e: any) { setErr(e?.message?.includes('permission') ? 'Couldn’t join. Check the code, or ask the desk to start a new room.' : e?.message || 'Couldn’t join.'); }
    setJoining(false);
  };
  const send = (choice: string | number) => { if (!room || !view || !tp) return; setAnswered(view.seq); tp.send(room, { seq: view.seq, choice, at: Date.now() }); };
  const fullscreen = () => { try { document.documentElement.requestFullscreen?.(); } catch { /* not supported */ } };

  if (!room) return (
    <Frame>
      <div style={{ fontSize: 12, letterSpacing: '.12em', color: MUTED }}>PRACTICE A SHIFT · CLIENT SCREEN</div>
      <div style={{ fontSize: 30, fontWeight: 300, letterSpacing: '-0.02em' }}>Play the client</div>
      <div style={{ fontSize: 15, color: MUTED, lineHeight: 1.5, maxWidth: 440, textAlign: 'center' }}>Put this device on the counter facing you. Enter the code shown on the desk screen. You choose the tip, tap the card, keep the change, pick a next visit and more.</div>
      <form onSubmit={(e) => { e.preventDefault(); join(); }} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', width: '100%', maxWidth: 360 }}>
        <input aria-label="Room code" value={code} onChange={(e) => setCode(Room.cleanCode(e.target.value))} placeholder="CODE" autoCapitalize="characters" style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 34, letterSpacing: '.3em', fontWeight: 800, border: `1.5px solid ${LINE}`, borderRadius: 18, padding: '14px 10px', fontFamily: 'inherit' }} />
        <Big disabled={code.length !== 6 || joining}>{joining ? 'Joining…' : 'Join'}</Big>
      </form>
      {err && <div style={{ color: RED, fontWeight: 600, fontSize: 14 }}>{err}</div>}
    </Frame>
  );

  const v = view; const waiting = !v || answered === v.seq;
  const f = (c: number) => fmt(v?.currency || 'USD', c);
  let body: ReactNode;
  if (!v || v.stage === 'idle') body = <><Logo /><div style={{ color: MUTED }}>Waiting for the desk…</div></>;
  else if (v.stage === 'thanks') body = <><Logo /><div style={{ fontSize: 26, fontWeight: 300 }}>Thank you{v.who ? `, ${v.who}` : ''}!</div><div style={{ color: MUTED }}>See you next time.</div></>;
  else if (v.stage === 'cart') body = <><div style={{ fontSize: 13, letterSpacing: '.1em', color: MUTED }}>YOUR VISIT{v.who ? ` · ${v.who.toUpperCase()}` : ''}</div>
    <div style={{ width: '100%', maxWidth: 520, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '6px 16px' }}>
      {(v.lines || []).map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: i ? `1px solid ${LINE}` : 'none', fontSize: 16, color: l.price < 0 ? GREEN : INK }}><span>{l.label}</span><span>{f(Math.round(l.price * 100))}</span></div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: `1.5px solid ${INK}`, fontSize: 20, fontWeight: 800 }}><span>Total</span><span>{f(v.total || 0)}</span></div>
    </div></>;
  else if (v.stage === 'details') body = <DetailsForm key={v.seq} v={v} disabled={waiting} onSend={(x) => send(JSON.stringify(x))} />;
  else if (v.stage === 'caller') body = <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
    <div style={{ fontSize: 13, letterSpacing: '.1em', color: MUTED }}>📞 YOU’RE THE CALLER · {(v.title || '').toUpperCase()}</div>
    <div style={{ fontSize: 30, fontWeight: 300 }}>{v.who}</div>
    <div style={{ fontSize: 15, lineHeight: 1.5 }}>{v.note}</div>
    <div style={{ background: '#f3f3f5', borderRadius: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>{(v.text || '').split('\n').filter(Boolean).map((l) => <div key={l} style={{ fontSize: 14.5, lineHeight: 1.45 }}>• {l}</div>)}</div>
    <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>Talk to the desk out loud, like a phone call (turn away so you can’t see their screen). Only give your details when they ask. Be the person on this card: if they’re kind and clear, warm up; if they’re rushed or blame you, push back.</div>
  </div>;
  else if (v.stage === 'consent') body = <ConsentForm key={v.seq} v={v} disabled={waiting} onSend={(x) => send(JSON.stringify(x))} />;
  else body = <>
    {v.title && <div style={{ fontSize: 28, fontWeight: 300, textAlign: 'center', letterSpacing: '-0.01em' }}>{v.title}</div>}
    {v.amount !== undefined && <div style={{ fontSize: 40, fontWeight: 800 }}>{f(v.amount)}</div>}
    {v.note && <div style={{ color: MUTED, fontSize: 15, textAlign: 'center', maxWidth: 480 }}>{v.note}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: (v.choices || []).length > 3 ? '1fr 1fr' : '1fr', gap: 10, width: '100%', maxWidth: 520 }}>
      {(v.choices || []).map((c) => <button key={String(c.value)} disabled={waiting} onClick={() => send(c.value)} style={{ border: `1.5px solid ${LINE}`, background: '#fff', borderRadius: 18, padding: '16px 14px', fontFamily: 'inherit', cursor: waiting ? 'default' : 'pointer', opacity: waiting ? 0.55 : 1, color: INK, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{c.label}</div>{c.sub && <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>{c.sub}</div>}</button>)}
    </div>
    {v.stage === 'keep' && !waiting && <form onSubmit={(e) => { e.preventDefault(); const c = Math.round(Number(custom.replace(',', '.')) * 100); if (c >= 0) send(c); }} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 520 }}>
      <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" placeholder="Keep part: enter an amount" style={{ flex: 1, border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '12px 14px', fontSize: 16, fontFamily: 'inherit' }} /><Big>Keep</Big></form>}
    {waiting && <div style={{ color: MUTED, fontSize: 14 }}>Sent. The desk takes it from here.</div>}
  </>;
  return (
    <Frame>
      <div style={{ position: 'fixed', top: 12, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: MUTED }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: GREEN }} />Connected · room {room}<span style={{ flex: 1 }} /><button onClick={fullscreen} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '6px 12px', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>Full screen</button>
      </div>
      {body}
    </Frame>
  );
}

/** The client checks or updates their own details: their info, their choice about promo texts. */
function DetailsForm({ v, disabled, onSend }: { v: Room.DeskView; disabled: boolean; onSend: (x: { phone: string; email: string; promo: boolean }) => void }) {
  const [phone, setPhone] = useState(v.prefill?.phone || ''); const [email, setEmail] = useState(v.prefill?.email || ''); const [promo, setPromo] = useState(false);
  const field = { width: '100%', boxSizing: 'border-box' as const, border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '13px 14px', fontSize: 17, fontFamily: 'inherit' };
  const ok = phone.replace(/\D/g, '').length >= 10 && /.+@.+\..+/.test(email);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 480 }}>
    <div style={{ fontSize: 28, fontWeight: 300, textAlign: 'center' }}>{v.title || 'Your details'}</div>
    <div style={{ color: MUTED, fontSize: 15, textAlign: 'center' }}>{v.note || 'Please check these, or update them.'}</div>
    {v.prefill?.name && <div style={{ fontSize: 15, textAlign: 'center' }}><b>{v.prefill.name}</b></div>}
    <label style={{ fontSize: 13, color: MUTED }}>Mobile number<input aria-label="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" style={field} /></label>
    <label style={{ fontSize: 13, color: MUTED }}>Email<input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoCapitalize="none" autoComplete="email" style={field} /></label>
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 15 }}><input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} style={{ width: 22, height: 22 }} />Send me offers by text (optional)</label>
    <div style={{ fontSize: 12.5, color: MUTED }}>Appointment reminders are always sent. Offers only if you tick the box.</div>
    <Big disabled={disabled || !ok} onClick={() => onSend({ phone, email, promo })}>{disabled ? 'Sent' : 'Save my details'}</Big>
  </div>;
}
/** The consent form: read it, sign with a finger, agree. */
function ConsentForm({ v, disabled, onSend }: { v: Room.DeskView; disabled: boolean; onSend: (x: { signed: boolean; name: string }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null); const [inked, setInked] = useState(false); const [agree, setAgree] = useState(false); const [name, setName] = useState(v.prefill?.name || '');
  useEffect(() => {
    const c = ref.current; if (!c) return; const g = c.getContext('2d')!; g.lineWidth = 2.4; g.lineCap = 'round'; g.strokeStyle = INK; let down = false;
    const pt = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]; };
    const d = (e: PointerEvent) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); };
    const m = (e: PointerEvent) => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); setInked(true); };
    const u = () => { down = false; };
    c.addEventListener('pointerdown', d); c.addEventListener('pointermove', m); c.addEventListener('pointerup', u);
    return () => { c.removeEventListener('pointerdown', d); c.removeEventListener('pointermove', m); c.removeEventListener('pointerup', u); };
  }, []);
  const clear = () => { const c = ref.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); setInked(false); };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 560 }}>
    <div style={{ fontSize: 26, fontWeight: 300, textAlign: 'center' }}>{v.title || 'Consent form'}</div>
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', fontSize: 14, lineHeight: 1.55, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-line' }}>{v.text}</div>
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 15 }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 22, height: 22 }} />I’ve read this and agree</label>
    <label style={{ fontSize: 13, color: MUTED }}>Full name<input aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '11px 14px', fontSize: 16, fontFamily: 'inherit' }} /></label>
    <div style={{ position: 'relative' }}>
      <canvas ref={ref} aria-label="Sign here" width={1000} height={260} style={{ width: '100%', height: 130, background: '#fff', border: `1.5px dashed ${LINE}`, borderRadius: 16, touchAction: 'none', display: 'block' }} />
      {!inked && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, pointerEvents: 'none' }}>Sign here with your finger</div>}
      {inked && <button onClick={clear} style={{ position: 'absolute', right: 8, top: 8, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontFamily: 'inherit' }}>Clear</button>}
    </div>
    <Big disabled={disabled || !inked || !agree || name.trim().length < 2} onClick={() => onSend({ signed: true, name: name.trim() })}>{disabled ? 'Signed' : 'Sign'}</Big>
  </div>;
}

function Logo() { return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><div style={{ width: 64, height: 64, borderRadius: 32, background: 'radial-gradient(circle at 35% 30%, #ffffff, #e9e4f2 55%, #cfd9ea)', boxShadow: '0 10px 24px -14px rgba(0,0,0,.4)' }} /><div style={{ fontSize: 14, letterSpacing: '.3em', fontWeight: 700 }}>OPAL SALON</div></div>; }
function Big({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return <button type={onClick ? 'button' : 'submit'} onClick={onClick} disabled={disabled} style={{ border: `1px solid ${INK}`, background: INK, color: '#fff', borderRadius: 999, padding: '14px 28px', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>{children}</button>;
}
function Frame({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#fbfaf8,#f1eee9)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '56px 20px 24px', boxSizing: 'border-box' }}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700;800&display=swap');`}</style>{children}</div>;
}
