'use client';
// src/app/refund/[tenantId]/[id]/page.tsx — THE CLIENT'S REFUND PAGE (lib/refund-payouts, /api/refund-payouts/public).
// For a refund on a cash sale: choose how to get it back (cash pickup, store credit, or an app the business offers), pick a
// pickup time, see the pickup code, and say "I'm on my way" — optionally sharing how far away they are while they travel.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', RED = '#b42318', GREEN = '#1f7a4d';
const BG = { backgroundColor: '#f7f7f8', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%), radial-gradient(100% 70% at 100% 0%, #e8eaf0 0%, transparent 50%)' };
const CARD: React.CSSProperties = { background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 20, boxShadow: '0 1px 2px rgba(22,23,26,0.04)' };
const LABEL = 'text-[12px] tracking-[0.1em]';
const money = (c: number) => `$${(Math.round(c) / 100).toFixed(2)}`;
const tl = (t: string) => { const h = Number(t.slice(0, 2)); const m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`; };
const wl = (w: any) => `${tl(w.start)}–${tl(w.end)}`;
const dl = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function RefundPage() {
  const { tenantId, id } = useParams() as { tenantId: string; id: string }; const k = useSearchParams().get('k') || '';
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(async () => { const r = await fetch(`/api/refund-payouts/public?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t load this page.' })); if (r.ok) setD(r); else setErr(r.error || 'This link isn’t valid.'); }, [tenantId, id, k]);
  React.useEffect(() => { load(); }, [load]);
  const post = async (b: any) => fetch('/api/refund-payouts/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, id, k, ...b }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
  const act = async (b: any) => { setBusy(true); setMsg(''); const r = await post(b); setBusy(false); if (!r.ok) { setMsg(r.error || 'That didn’t work.'); return null; } await load(); return r; };

  if (err) return <Shell><p className="text-[16px]">{err}</p></Shell>;
  if (!d) return <Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>;
  const R = d.refund; const accent = d.brand.accent || INK;
  const head = <div className="flex items-center gap-2.5">{d.brand.logo ? <img src={d.brand.logo} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-bold text-white" style={{ background: accent }}>{(d.brand.name || '·').slice(0, 1)}</span>}<span className="text-[14px] font-medium">{d.brand.name}</span></div>;
  const err2 = msg ? <p className="text-[14px] font-medium" style={{ color: RED }}>{msg}</p> : null;

  if (['handed', 'sent', 'credited'].includes(R.status)) return <Shell>{head}
    <h1 className="text-[32px] font-normal leading-tight tracking-[-0.03em]">{R.status === 'credited' ? 'Your credit is ready' : R.status === 'sent' ? 'Your refund is on its way' : 'All done'}</h1>
    <div className="p-5" style={CARD}><p className="text-[15.5px] leading-relaxed">{R.status === 'credited' ? `${money(R.amountCents)} is on your account for your next visit.` : R.status === 'sent' ? `We sent ${money(R.amountCents)} by ${R.app?.label} to ${R.app?.handle}.` : `Your ${money(R.amountCents)} refund was handed to you. Thank you for coming in.`}</p></div></Shell>;
  if (R.status === 'cancelled') return <Shell>{head}<p className="text-[16px]">This refund link is no longer active. Reply to our text if you have questions.</p></Shell>;

  if (R.status === 'to_send') return <Shell>{head}
    <h1 className="text-[32px] font-normal leading-tight tracking-[-0.03em]">We’ll send <b className="font-bold tabular-nums">{money(R.amountCents)}</b> by {R.app?.label}</h1>
    <div className="space-y-2 p-5 text-[15px]" style={CARD}>
      <Line k="To" v={`${R.app?.handle}${R.app?.accountName ? ` · ${R.app.accountName}` : ''}`} />{R.from && <Line k="From" v={R.from} />}
      <p className="pt-1 text-[13.5px]" style={{ color: MUTED }}>We’ll text you as soon as it’s sent.</p></div>
    <button type="button" disabled={busy} onClick={() => act({ action: 'change' })} className="text-[14px] font-medium underline underline-offset-2">That’s not right — change it</button>{err2}</Shell>;

  if (R.status === 'scheduled' || R.status === 'on_way') return <Shell>{head}
    <h1 className="text-[32px] font-normal leading-tight tracking-[-0.03em]">{R.status === 'on_way' ? 'See you soon' : `See you ${R.pickup ? dl(R.pickup.date).split(',')[0] : ''}, ${R.first}`}</h1>
    <div className="space-y-3.5 p-5" style={CARD}>
      <div className="flex items-baseline justify-between"><span className={LABEL} style={{ color: MUTED }}>cash refund</span><span className="text-[28px] font-bold tabular-nums">{money(R.amountCents)}</span></div>
      <div className="h-px" style={{ background: LINE }} />
      {R.pickup && <Line k="When" v={`${dl(R.pickup.date)} · ${R.pickup.label}`} />}<Line k="Where" v="Front desk" />
      {d.brand.address && <p className="text-[13.5px]" style={{ color: MUTED }}>{d.brand.address}</p>}
      <div className="flex items-center justify-between rounded-2xl border bg-white px-4 py-3" style={{ borderColor: LINE }}><span className={LABEL} style={{ color: MUTED }}>pickup code</span><span className="text-[30px] font-bold tracking-[0.16em] tabular-nums">{R.code}</span></div>
      <p className="text-[13px]" style={{ color: MUTED }}>Show this code at the desk. Only you can collect it.</p>
    </div>
    {d.onTheWay && (R.status === 'on_way' ? <OnWay d={d} post={post} reload={load} accent={accent} /> : <HeadingOver d={d} busy={busy} accent={accent} onGo={async (eta, live) => { const r = await act({ action: 'on_way', etaMin: eta, live }); return !!r; }} />)}
    {err2}
    <div className="flex flex-wrap justify-center gap-5 pt-2 text-[14px]">
      {!R.cashReady && <button type="button" disabled={busy} onClick={() => act({ action: 'change' })} className="underline underline-offset-2">Change time or another way</button>}
      {R.pickup && <a className="underline underline-offset-2" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics(R, d.brand))}`} download="refund-pickup.ics">Add to calendar</a>}
    </div></Shell>;

  if (R.status === 'pickup_time' || (R.status === 'choose' && R.method === 'pickup')) return <Shell>{head}
    <h1 className="text-[32px] font-normal leading-tight tracking-[-0.03em]">Pick a time for your <b className="font-bold tabular-nums">{money(R.amountCents)}</b></h1>
    <p className="-mt-2 text-[15px]" style={{ color: MUTED }}>Your envelope will be ready at the front desk.</p>
    <Windows windows={d.windows} busy={busy} accent={accent} onBook={(w) => act({ action: 'book', pickup: w })} />{err2}
    {d.methods.length > 1 && <button type="button" disabled={busy} onClick={() => act({ action: 'change' })} className="text-[14px] underline underline-offset-2">Rather have it another way?</button>}</Shell>;

  return <Shell>{head}<Choose d={d} busy={busy} accent={accent} onChoose={(b) => act({ action: 'choose', ...b })} />{err2}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[100dvh] text-[#16171a]" style={{ ...BG, letterSpacing: '-0.01em' }}><div className="mx-auto flex max-w-[480px] flex-col gap-4 px-5 pb-10 pt-6">{children}</div></main>;
}
const Line = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-4 text-[15px]"><span style={{ color: MUTED }}>{k}</span><span className="text-right font-medium">{v}</span></div>;

function Choose({ d, busy, accent, onChoose }: { d: any; busy: boolean; accent: string; onChoose: (b: any) => void }) {
  const R = d.refund; const [m, setM] = React.useState<string>(R.method || d.methods[0]?.id || ''); const [handle, setHandle] = React.useState(''); const [name, setName] = React.useState(''); const [w, setW] = React.useState<any>(null);
  const M = d.methods.find((x: any) => x.id === m); const app = !!M?.ask;
  const hint = (id: string) => id === 'pickup' ? 'An envelope will be ready for you at the front desk' : id === 'credit' ? 'Ready now' : 'Usually within a day';
  const ready = m === 'pickup' ? !!w : app ? handle.trim().length > 1 && name.trim().length > 1 : !!m;
  return <>
    <div><h1 className="text-[32px] font-normal leading-tight tracking-[-0.03em]">Your <b className="font-bold tabular-nums">{money(R.amountCents)}</b> refund</h1><p className="mt-1.5 text-[15px]" style={{ color: MUTED }}>You paid in cash, so choose what’s easiest for you.</p></div>
    <div role="radiogroup" aria-label="How you’d like it" className="space-y-2">
      {d.methods.map((x: any) => { const on = m === x.id; return <div key={x.id} className="p-4" style={on ? { background: '#fff', border: `1px solid ${INK}`, borderRadius: 20 } : CARD}>
        <label className="flex cursor-pointer items-center gap-3"><span className="flex-1"><span className="block text-[16px] font-medium">{x.id === 'pickup' ? 'Pick up in cash' : x.id === 'credit' ? 'Credit for your next visit' : x.label}</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{hint(x.id)}</span></span>
          <input type="radio" name="how" checked={on} onChange={() => setM(x.id)} className="h-5 w-5" style={{ accentColor: INK }} /></label>
        {on && x.id === 'pickup' && <div className="mt-3"><Windows windows={d.windows} busy={busy} accent={accent} pick={w} onPick={setW} /></div>}
        {on && x.ask && <div className="mt-3 space-y-3">
          <label className={`block ${LABEL}`} style={{ color: MUTED }}>{x.ask.toLowerCase()}<input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={x.placeholder || ''} autoComplete="off" className="mt-1.5 h-[52px] w-full rounded-2xl border bg-white px-3.5 text-[17px] tracking-normal text-[#16171a]" style={{ borderColor: LINE }} /></label>
          <label className={`block ${LABEL}`} style={{ color: MUTED }}>name on the account<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1.5 h-[52px] w-full rounded-2xl border bg-white px-3.5 text-[17px] tracking-normal text-[#16171a]" style={{ borderColor: LINE }} /></label>
          <div className="flex gap-2.5 rounded-2xl p-3 text-[14px] leading-snug" style={{ background: '#fdf3e6' }}><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: '#b45309' }} />Please double-check. We’ll send it to exactly this account, and app payments can’t be pulled back.</div>
          {x.from && <p className="text-[13.5px]" style={{ color: MUTED }}>It will come from {x.from}.</p>}</div>}
      </div>; })}
    </div>
    <button type="button" disabled={busy || !ready} onClick={() => onChoose({ method: m, handle, accountName: name, pickup: m === 'pickup' ? w : undefined })} className="h-[54px] w-full rounded-full text-[16px] font-medium text-white disabled:opacity-40" style={{ background: accent }}>
      {busy ? 'Saving…' : m === 'pickup' ? (w ? `Book ${w.dayLabel} ${wl(w)}` : 'Pick a time') : m === 'credit' ? 'Add it as credit' : app ? 'That’s me, send it' : 'Continue'}</button>
    <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Questions? Reply to our text anytime.</p>
  </>;
}

function Windows({ windows, busy, accent, pick, onPick, onBook }: { windows: any[]; busy: boolean; accent: string; pick?: any; onPick?: (w: any) => void; onBook?: (w: any) => void }) {
  const days = [...new Set(windows.map((w) => w.date))]; const [day, setDay] = React.useState(days[0] || ''); const [sel, setSel] = React.useState<any>(pick || null);
  if (!windows.length) return <p className="text-[15px]">No pickup times are open this week. Reply to our text and we’ll sort out a time with you.</p>;
  const choose = (w: any) => { setSel(w); onPick?.(w); };
  return <div className="space-y-3">
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{days.map((x) => { const w0 = windows.find((w) => w.date === x); return <button key={x} type="button" onClick={() => setDay(x)} className="h-11 shrink-0 rounded-full border px-4 text-[14px]" style={day === x ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>{w0?.dayLabel}</button>; })}</div>
    <div className="grid grid-cols-2 gap-2">{windows.filter((w) => w.date === day).map((w) => { const on = sel && sel.date === w.date && sel.start === w.start; return <button key={w.start} type="button" onClick={() => choose(w)} className="h-12 rounded-2xl border text-[14.5px]" style={on ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>{wl(w)}</button>; })}</div>
    {onBook && sel && <button type="button" disabled={busy} onClick={() => onBook(sel)} className="h-[54px] w-full rounded-full text-[16px] font-medium text-white" style={{ background: accent }}>{busy ? 'Booking…' : `Book ${sel.dayLabel} ${wl(sel)}`}</button>}
  </div>;
}

function HeadingOver({ d, busy, accent, onGo }: { d: any; busy: boolean; accent: string; onGo: (eta: number, live: boolean) => Promise<boolean> }) {
  const [eta, setEta] = React.useState(15); const [live, setLive] = React.useState(!!d.liveLocation);
  const go = async () => {
    if (live && typeof navigator !== 'undefined' && navigator.geolocation) {   // ask now, while they tapped — the browser prompt needs the tap
      const ok = await new Promise<boolean>((res) => navigator.geolocation.getCurrentPosition(() => res(true), () => res(false), { timeout: 15000, maximumAge: 60000 }));
      await onGo(eta, ok); return;
    }
    await onGo(eta, false);
  };
  return <div className="space-y-3 p-4" style={CARD}>
    <div><p className="text-[16px] font-medium">Heading over?</p><p className="text-[13.5px]" style={{ color: MUTED }}>Let us know and we’ll have it ready at the desk.</p></div>
    <div className="flex gap-2">{[5, 15, 30].map((n) => <button key={n} type="button" onClick={() => setEta(n)} className="h-11 flex-1 rounded-full border bg-white text-[14px]" style={{ borderColor: eta === n ? INK : LINE, fontWeight: eta === n ? 500 : 400 }}>{n} min</button>)}</div>
    {d.liveLocation && <label className="flex items-center gap-3 rounded-2xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
      <span className="flex-1"><span className="block text-[14.5px] font-medium">Share my live location</span><span className="block text-[12.5px]" style={{ color: MUTED }}>Only while I’m on the way. They see distance and time, not where I am.</span></span>
      <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="h-[22px] w-[22px]" style={{ accentColor: INK }} /></label>}
    <button type="button" disabled={busy} onClick={go} className="h-[52px] w-full rounded-full text-[15.5px] font-medium text-white" style={{ background: accent }}>{busy ? 'Letting them know…' : 'I’m on my way'}</button>
  </div>;
}

function OnWay({ d, post, reload, accent }: { d: any; post: (b: any) => Promise<any>; reload: () => void; accent: string }) {
  const trip = d.refund.trip || {}; const [live, setLive] = React.useState(!!trip.live); const [eta, setEta] = React.useState<number | null>(trip.etaMin ?? null); const [mi, setMi] = React.useState<number | null>(trip.distanceMi ?? null);
  const watch = React.useRef<number | null>(null); const last = React.useRef(0);
  const stop = React.useCallback(async (tell = true) => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; setLive(false); if (tell) await post({ action: 'stop_trip' }); }, [post]);
  React.useEffect(() => {
    if (!live || typeof navigator === 'undefined' || !navigator.geolocation) return;
    watch.current = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() - last.current < 20000) return; last.current = Date.now();
      const r = await post({ action: 'trip', lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (r?.etaMin != null) setEta(r.etaMin); if (r?.distanceMi != null) setMi(r.distanceMi); if (r && r.sharing === false) { stop(false); reload(); }
    }, () => { stop(); }, { enableHighAccuracy: false, maximumAge: 20000, timeout: 20000 });
    return () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); };
  }, [live, post, stop, reload]);
  return <div className="space-y-2 p-4" style={CARD}>
    <p className="text-[16px] font-medium">Thanks — we’ll have it ready at the front desk.</p>
    {live ? <><p className="text-[14px]" style={{ color: MUTED }}>{mi != null ? `About ${mi} mi away${eta ? `, ~${eta} min` : ''}. ` : 'Sharing how far away you are. '}It stops when you arrive.</p>
      <button type="button" onClick={() => stop()} className="text-[14px] underline underline-offset-2">Stop sharing</button></>
      : <p className="text-[14px]" style={{ color: MUTED }}>Your location isn’t shared.</p>}
    <span className="sr-only" style={{ color: accent }} />
  </div>;
}

function ics(R: any, brand: any) {
  const z = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `DTSTART:${z(R.pickup.startAt)}`, `DTEND:${z(R.pickup.endAt)}`, `SUMMARY:Pick up refund — ${brand.name}`, `DESCRIPTION:Pickup code ${R.code}`, ...(brand.address ? [`LOCATION:${String(brand.address).replace(/,/g, '\\,')}`] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
