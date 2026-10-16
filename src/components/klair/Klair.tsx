'use client';
// src/components/klair/Klair.tsx — KLAIR ON SCREEN (lib/klair, api/klair). A round button on every screen opens her:
// full screen and black on a phone, a black panel beside the page on a computer. You talk (or type); what she
// understood is underlined in mint, anything unsure gets an amber dashed line; the result comes up on a white slip:
// an answer, "which one?", exactly what will change (with Move it / Not this), or "needs your OK". Done comes with
// Undo. From inside a visit she only means that client (openKlair({ appointmentId, clientName })).
// She speaks short replies only when you spoke to her, and only if the business left her voice on.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { klairSettings } from '@/lib/klair';
import { openVisit } from '@/lib/visit-client';

export function openKlair(ctx?: { appointmentId?: string; clientName?: string }) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cf:klair', { detail: ctx || {} })); }

type Res = any;
const MINT = '#7fd1a5', AMBER = '#f0b35a', INK = '#16171a', MUTED = '#6d7075', SOFT = '#f5f5f7';
const SUGGEST = ['What’s next?', 'Who hasn’t confirmed tomorrow?', 'Any gaps today?', 'Tell my next client I’m 10 minutes late'];
const VISIT_SUGGEST = ['Book again in 3 weeks', 'Send aftercare', 'Ask them to confirm', 'Send their visit link'];

function Bars({ live, color = MINT, h = 28 }: { live: boolean; color?: string; h?: number }) {
  return <span aria-hidden className="inline-flex items-center gap-[4px]" style={{ height: h }}>{[8, 16, 26, 12, 22, 30, 14, 20, 10].map((x, i) => <i key={i} className={live ? 'klair-bar' : ''} style={{ display: 'block', width: 4, borderRadius: 2, background: color, height: Math.round((x / 30) * h), animationDelay: `${i * 0.08}s` }} />)}</span>;
}

export function KlairHost() {
  const { selectedTenant } = useTenant() as any; const K = klairSettings(selectedTenant || {});
  const tenantId = selectedTenant?.id || '';
  const [open, setOpen] = React.useState(false); const [ctx, setCtx] = React.useState<{ appointmentId?: string; clientName?: string } | null>(null);
  const [text, setText] = React.useState(''); const [interim, setInterim] = React.useState(''); const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false); const [res, setRes] = React.useState<Res | null>(null); const [err, setErr] = React.useState('');
  const viaVoice = React.useRef(false); const rec = React.useRef<any>(null);
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const f = () => setWide(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  React.useEffect(() => { const h = (e: any) => { setCtx(e?.detail?.appointmentId ? e.detail : null); setRes(null); setErr(''); setText(''); setOpen(true); }; window.addEventListener('cf:klair', h); return () => window.removeEventListener('cf:klair', h); }, []);
  React.useEffect(() => { if (!open) { try { rec.current?.stop?.(); } catch { /* fine */ } setListening(false); try { window.speechSynthesis?.cancel(); } catch { /* fine */ } } }, [open]);

  const speak = (line?: string | null) => { if (!line || !viaVoice.current || !K.speak) return; try { const u = new SpeechSynthesisUtterance(line); const vs = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    const pick = K.voice === 'bright' ? vs.find((v) => /samantha|zira|female|aria/i.test(v.name)) : K.voice === 'calm' ? vs.find((v) => /daniel|alex|male|guy/i.test(v.name)) : vs.find((v) => /karen|serena|victoria|google us english/i.test(v.name));
    if (pick) u.voice = pick; u.rate = 1.02; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { /* no voice */ } };
  const post = async (body: any) => { setBusy(true); setErr('');
    try { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r = await fetch('/api/klair', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, voice: viaVoice.current, ...body }) }).then((x) => x.json());
      if (r?.ok === false) { setErr(r.error || 'That didn’t work.'); return; } setRes(r); speak(r.say); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); } };
  const ask = (q: string) => { const s = q.trim(); if (!s) return; setText(s); setInterim(''); void post({ action: 'ask', text: s, context: ctx?.appointmentId ? { appointmentId: ctx.appointmentId } : undefined }); };
  const listen = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) { setErr('Talking isn’t available in this browser. Type instead.'); return; }
    if (listening) { try { rec.current?.stop(); } catch { /* fine */ } return; }
    const r = new SR(); rec.current = r; r.lang = 'en-US'; r.interimResults = true; r.continuous = false; viaVoice.current = true; setRes(null); setErr(''); setText(''); setInterim('');
    let final = ''; r.onresult = (e: any) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript; else t += e.results[i][0].transcript; } setInterim(final + t); };
    r.onend = () => { setListening(false); if (final.trim()) ask(final); }; r.onerror = () => { setListening(false); setErr('I didn’t hear that. Try again, or type.'); };
    setListening(true); try { r.start(); } catch { setListening(false); } };

  if (!tenantId || !K.on) return null;
  const sentence = res?.shown ? res.shown : (interim || text) ? [{ text: interim || text, got: false }] : null;
  const close = () => { setOpen(false); setRes(null); setText(''); setInterim(''); setErr(''); setCtx(null); };
  const btn = (label: string, onClick: () => void, primary = false, disabled = false) => <button type="button" disabled={disabled || busy} onClick={onClick} className="h-12 rounded-full px-5 text-[15px] font-semibold disabled:opacity-50" style={primary ? { background: INK, color: '#fff', flex: 1 } : { background: SOFT, color: INK }}>{label}</button>;
  const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const Who = ({ name, sub }: { name: string; sub?: string }) => <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[14px] font-semibold" style={{ background: SOFT, boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${MINT}` }}>{initials(name)}</span><span className="min-w-0"><span className="block text-[16px] font-semibold">{name}</span>{sub && <span className="block whitespace-pre-line text-[13.5px]" style={{ color: MUTED }}>{sub}</span>}</span></div>;

  const slip = res && (() => {
    if (res.kind === 'answer') return <div><p className="m-0 text-[16px] leading-snug">{res.text}</p>{res.open && <div className="mt-3 flex gap-2">{btn('Open the visit', () => { openVisit(res.open); close(); })}</div>}</div>;
    if (res.kind === 'list') return <div><p className="m-0 text-[16px]">{res.text}</p><ul className="my-3 space-y-1.5">{res.items.map((x: any) => <li key={x.id} className="flex justify-between gap-3 text-[14.5px]"><span>{x.label}</span><span style={{ color: MUTED }}>{x.sub}</span></li>)}</ul><div className="flex gap-2">{btn(res.confirmLabel, () => void post({ action: 'confirm', id: res.id }), true)}{btn('Not now', close)}</div></div>;
    if (res.kind === 'choose') return <div><p className="m-0 text-[18px] font-light">Which {res.unsure}?</p>{res.options.map((o: any, i: number) => <button key={i} type="button" disabled={busy} onClick={() => void post({ action: 'choose', id: res.id, pick: i })} className="mt-2.5 flex w-full items-center gap-3 rounded-2xl border p-3 text-left" style={{ borderColor: '#ececee' }}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13.5px] font-semibold" style={{ background: SOFT }}>{initials(o.name)}</span><span><span className="block text-[15.5px] font-semibold">{o.name}</span><span className="block whitespace-pre-line text-[13px]" style={{ color: MUTED }}>{o.sub}</span></span></button>)}<p className="mb-0 mt-3 text-[13.5px]" style={{ color: MUTED }}>Tap one or say the last name. Nothing changes until you choose.</p></div>;
    if (res.kind === 'preview') return <div>{res.who ? <Who name={res.who.clientName} sub={res.sub} /> : <p className="m-0 text-[17px] font-semibold">{res.title}</p>}
      <dl className="my-4 grid gap-x-3 gap-y-1.5 text-[15px]" style={{ gridTemplateColumns: '92px 1fr' }}>{res.rows.map((r: any, i: number) => <React.Fragment key={i}><dt style={{ color: MUTED }}>{r.k}</dt><dd className="m-0" style={r.struck ? { color: MUTED, textDecoration: 'line-through' } : r.strong ? { fontWeight: 600 } : undefined}>{r.v}</dd></React.Fragment>)}</dl>
      {res.others?.length > 0 && <p className="mb-3 mt-0 text-[13px]" style={{ color: MUTED }}>Also open: {res.others.join(', ')}</p>}
      <div className="flex gap-2">{btn(res.confirmLabel || 'Do it', () => void post({ action: 'confirm', id: res.id }), true)}{btn('Not this', close)}</div></div>;
    if (res.kind === 'needs_ok') return <div style={{ borderTop: '6px solid #b45309', margin: '-20px -20px 0', padding: '16px 20px 0', borderRadius: '26px 26px 0 0' }}><p className="m-0 text-[14px] font-semibold" style={{ color: '#b45309' }}>Needs your OK</p>{res.who && <div className="mt-3"><Who name={res.who.clientName} /></div>}<p className="mt-3 text-[15px]">{res.text}</p>{res.open && <div className="flex gap-2">{btn('Open the visit', () => { openVisit(res.open); close(); }, true)}{btn('Not now', close)}</div>}</div>;
    if (res.kind === 'done') return <div><p className="m-0 text-[14px] font-semibold" style={{ color: '#1f7a4d' }}>Done</p><p className="mt-1.5 text-[16px]">{res.text}</p><div className="mt-3 flex gap-2">{res.canUndo && btn('Undo', () => void post({ action: 'undo', id: res.id }))}{btn('Close', close)}</div></div>;
    return null; })();

  const panelStyle: React.CSSProperties = wide ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, zIndex: 70 } : { position: 'fixed', inset: 0, zIndex: 70 };
  return (<>
    <style>{`@keyframes klairBar{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}.klair-bar{animation:klairBar 1s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion: reduce){.klair-bar{animation:none}}`}</style>
    {!open && <button type="button" onClick={() => { setCtx(null); setOpen(true); }} aria-label={`Ask ${K.name}`} title={`Ask ${K.name}`}
      className="fixed z-[65] grid h-14 w-14 place-items-center rounded-full shadow-lg" style={{ right: 'max(16px, env(safe-area-inset-right))', bottom: wide ? 24 : 'calc(84px + env(safe-area-inset-bottom))', background: INK, color: '#fff' }}><Bars live={false} color="#fff" h={20} /></button>}
    {open && <div role="dialog" aria-modal={!wide} aria-label={`Ask ${K.name}`} style={{ ...panelStyle, background: '#000', color: '#fff', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center justify-between px-5 pt-5"><span className="inline-flex h-8 items-center rounded-full border px-3 text-[13px]" style={{ borderColor: '#2a2b2f', color: '#c9cbd0' }}>{ctx?.clientName ? `Only about ${ctx.clientName.split(' ')[0]}` : K.name}</span><button type="button" onClick={close} className="h-9 px-2 text-[14px]" style={{ color: '#c9cbd0' }}>Done</button></div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="mt-8"><Bars live={listening || busy} /></div>
        {sentence ? <p aria-live="polite" className="mt-5 text-[30px] font-light leading-[1.22]" style={{ letterSpacing: '-0.02em' }}>{sentence.flatMap((s: any, i: number) => { if (s.got) return [<span key={i} style={{ borderBottom: `2px solid ${MINT}`, paddingBottom: 1 }}>{s.text}</span>];
          const u = res?.unsure ? String(res.unsure) : ''; const at = u ? s.text.toLowerCase().indexOf(u.toLowerCase()) : -1;
          if (at < 0) return [<span key={i}>{s.text}</span>];
          return [<span key={`${i}a`}>{s.text.slice(0, at)}</span>, <span key={`${i}b`} style={{ borderBottom: `2px dashed ${AMBER}`, paddingBottom: 1 }}>{s.text.slice(at, at + u.length)}</span>, <span key={`${i}c`}>{s.text.slice(at + u.length)}</span>]; })}</p>
          : <p className="mt-5 text-[30px] font-light leading-[1.22]" style={{ letterSpacing: '-0.02em', color: '#c9cbd0' }}>{listening ? 'Listening…' : ctx?.clientName ? `What should I do for ${ctx.clientName.split(' ')[0]}?` : 'What do you need?'}</p>}
        {res?.shown && res.shown.some((s: any) => s.got) && !res.unsure && <p className="mt-3 text-[13.5px]" style={{ color: '#9a9ca3' }}>Underlined is what I understood.</p>}
        {res?.kind === 'choose' && <p className="mt-3 text-[13.5px]" style={{ color: AMBER }}>{res.text}</p>}
        {err && <p role="alert" className="mt-4 text-[14px]" style={{ color: AMBER }}>{err}</p>}
        {!res && !listening && !busy && <div className="mt-8 flex flex-wrap gap-2">{(ctx?.appointmentId ? VISIT_SUGGEST : SUGGEST).map((s) => <button key={s} type="button" onClick={() => { viaVoice.current = false; ask(s); }} className="h-10 rounded-full border px-4 text-[14px]" style={{ borderColor: '#2a2b2f', color: '#e6e7ea' }}>{s}</button>)}</div>}
      </div>
      {slip ? <div className="px-5 pb-6 pt-5" style={{ background: '#fff', color: INK, borderRadius: '26px 26px 0 0', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>{slip}</div>
        : <form onSubmit={(e) => { e.preventDefault(); viaVoice.current = false; ask(text); }} className="flex items-center gap-2.5 px-5" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type it" aria-label={`Type to ${K.name}`} className="h-12 min-w-0 flex-1 rounded-full border bg-transparent px-5 text-[15px] outline-none" style={{ borderColor: '#2a2b2f', color: '#fff' }} />
            <button type="button" onClick={listen} aria-label={listening ? 'Stop listening' : 'Talk'} className="grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: listening ? MINT : '#fff', color: INK }}><Bars live={listening} color={INK} h={18} /></button>
          </form>}
    </div>}
  </>);
}
