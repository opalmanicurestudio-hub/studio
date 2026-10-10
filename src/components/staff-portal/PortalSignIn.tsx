'use client';
// src/components/staff-portal/PortalSignIn.tsx — SIGNING IN TO THE STAFF PORTAL. Three screens, picked by the device:
//   • Welcome back — a personal phone that's been used before: their face and name, then their PIN.
//   • Shared tablet — today's team as faces (tap yours, then your PIN) with the day's shifts drawn underneath; upright,
//     the person due next gets the big card. Turned on per device ("Use this as a shared tablet").
//   • Just your PIN — anything else: the time, the business, and a keypad. Your PIN says who you are.
// PINs are only ever checked on the server (/api/portal/auth). Choosing a face sends expectStaffId, so a PIN that isn't
// that person's is refused rather than signing someone else in.
import * as React from 'react';
import { rememberBrand } from '@/components/staff-portal/PortalBoot';

type Person = { id: string; name: string; avatarUrl?: string | null; state: 'working' | 'break' | 'off'; since?: string | null; breakSince?: string | null; shifts: { start: string; end: string; kind: string }[]; isRenter?: boolean };
type Brand = { name: string; logoUrl?: string | null; accent: string; sharedBoard?: boolean };
type Last = { id: string; name: string; avatarUrl?: string | null };

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT_BG = '#f6f6f7';
const key = (t: string, k: string) => `cf_portal_${k}_${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
const mins = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmt = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`; };
const clockText = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
const dayText = (d: Date) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '·';

function useClock() { const [d, setD] = React.useState(() => new Date()); React.useEffect(() => { const t = setInterval(() => setD(new Date()), 15000); return () => clearInterval(t); }, []); return d; }

function Face({ p, size = 80, ring }: { p: { name: string; avatarUrl?: string | null }; size?: number; ring: string }) {
  return (
    <span className="block shrink-0 rounded-full" style={{ width: size, height: size, padding: Math.max(3, size / 22), background: ring }}>
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full font-extrabold" style={{ background: '#f1f1f3', border: `${Math.max(2, size / 28)}px solid #fff`, fontSize: size * 0.32, color: INK }}>
        {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(p.name)}
      </span>
    </span>);
}

/** Where someone is today, for the board: due now, working, on break, later, or done. */
function standing(p: Person, now: number) {
  const next = p.shifts.map((s) => ({ a: mins(s.start), b: mins(s.end) })).filter((x) => !isNaN(x.a)).sort((x, y) => x.a - y.a);
  const upcoming = next.find((x) => x.b > now);
  if (p.state === 'break') return { rank: 2, label: 'on break', tone: '#9a5b00', ring: '#d9922e' };
  if (p.state === 'working') return { rank: 1, label: 'working', tone: '#1f8a4c', ring: '#1f8a4c' };
  if (upcoming && upcoming.a - now <= 15) return { rank: 0, label: upcoming.a < now ? `late · ${fmt(upcoming.a)}` : 'due now', tone: 'accent', ring: '#e6e6e8', due: true };
  if (upcoming) return { rank: 3, label: fmt(upcoming.a), tone: MUTED, ring: '#e6e6e8' };
  return { rank: 4, label: 'done', tone: MUTED, ring: '#e6e6e8' };
}

export function Keypad({ who, brand, error, busy, onPin, onBack, onForgot, footer }: { who?: Last | null; brand: Brand; error: string; busy: boolean; onPin: (pin: string) => void; onBack?: () => void; onForgot?: () => void; footer?: React.ReactNode }) {
  const [pin, setPin] = React.useState(''); const now = useClock(); const [shake, setShake] = React.useState(false);
  React.useEffect(() => { if (error) { setShake(true); const t = setTimeout(() => { setShake(false); setPin(''); }, 450); return () => clearTimeout(t); } }, [error]);
  const press = (d: string) => { if (busy) return; if (d === 'del') { setPin((p) => p.slice(0, -1)); return; } if (pin.length >= 4) return; const n = pin + d; setPin(n); if (n.length === 4) onPin(n); };
  React.useEffect(() => { const k = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col items-center gap-5 px-7 pb-8 pt-12" style={{ color: INK }}>
      <div className="flex w-full items-center justify-between">
        {onBack ? <button type="button" onClick={onBack} aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-2xl border" style={{ borderColor: LINE }}><svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg></button> : <span />}
        <span className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: '#55585e' }}>{brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-6 w-6 rounded-lg object-cover" /> : <span className="flex h-6 w-6 items-center justify-center rounded-lg text-[12px] font-extrabold text-white" style={{ background: INK }}>{initials(brand.name || 'T')}</span>}{brand.name}</span>
        <span className="w-11" />
      </div>
      {who ? (
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <Face p={who} size={96} ring={`conic-gradient(${brand.accent}, #d7e6e4, ${brand.accent})`} />
          <div><p className="text-[26px] font-extrabold tracking-tight">Hi {who.name.split(' ')[0]}</p><p className="text-[14px]" style={{ color: MUTED }}>Enter your 4-digit PIN</p></div>
        </div>) : (
        <div className="pt-4 text-center"><p className="text-[60px] font-extrabold leading-none tracking-tighter tabular-nums">{clockText(now)}</p><p className="mt-1.5 text-[15px]" style={{ color: MUTED }}>{dayText(now)}</p><p className="mt-6 text-[16px] font-semibold">Enter your PIN</p></div>)}
      <div aria-live="polite" aria-label={`${pin.length} of 4 digits entered`} className={`flex gap-4 ${shake ? 'animate-[cfshake_.4s]' : ''}`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className="h-4 w-4 rounded-full" style={pin.length > i ? { background: brand.accent } : { border: '2px solid #c9cacf' }} />)}
      </div>
      <p role="alert" className="min-h-[20px] text-center text-[14px] font-medium" style={{ color: '#b42318' }}>{error}</p>
      <div className="grid w-full max-w-[290px] grid-cols-3 gap-x-6 gap-y-3.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((d, i) => d === '' ? <span key={i} /> : (
          <button key={i} type="button" disabled={busy} onClick={() => press(d)} aria-label={d === 'del' ? 'Delete last digit' : d}
            className="flex h-[70px] items-center justify-center rounded-full text-[26px] font-semibold transition-transform active:scale-95 disabled:opacity-50" style={d === 'del' ? { background: 'transparent' } : { background: '#f4f4f5' }}>
            {d === 'del' ? <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="M17 9l-5 6M12 9l5 6" /></svg> : d}
          </button>))}
      </div>
      <div className="mt-auto flex flex-col items-center gap-2 pt-4 text-center">
        {onForgot && <button type="button" onClick={onForgot} className="text-[14px] font-semibold" style={{ color: brand.accent }}>Forgot your PIN?</button>}
        {footer}
      </div>
      <style>{`@keyframes cfshake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>);
}

export function WelcomeBack({ last, brand, onPin, onSwitch }: { last: Last; brand: Brand; onPin: () => void; onSwitch: () => void }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col items-center gap-6 px-6 pb-9 pt-14 text-center" style={{ color: INK, background: `radial-gradient(70% 38% at 50% 28%, ${brand.accent}22 0%, transparent 75%)` }}>
      <p className="text-[14px] font-semibold" style={{ color: MUTED }}>{brand.name}</p>
      <div className="mt-8"><Face p={last} size={132} ring={`conic-gradient(${brand.accent}, #d7e6e4, ${brand.accent})`} /></div>
      <div><p className="text-[30px] font-extrabold tracking-tight">Welcome back, {last.name.split(' ')[0]}</p><p className="mt-1 text-[15px]" style={{ color: MUTED }}>{greeting()} — your day is ready.</p></div>
      <div className="mt-auto flex w-full flex-col gap-2.5">
        <button type="button" onClick={onPin} className="h-[54px] rounded-[18px] text-[16px] font-bold text-white" style={{ background: INK }}>Use my PIN</button>
        <button type="button" onClick={onSwitch} className="h-10 text-[14px] font-semibold" style={{ color: MUTED }}>Not {last.name.split(' ')[0]}? Switch person</button>
      </div>
    </div>);
}

export function Board({ brand, people, now, onPick, onPin }: { brand: Brand; people: Person[]; now: Date; onPick: (p: Person) => void; onPin: () => void }) {
  const n = now.getHours() * 60 + now.getMinutes();
  const ranked = people.map((p) => ({ p, s: standing(p, n) })).sort((a, b) => a.s.rank - b.s.rank || a.p.name.localeCompare(b.p.name));
  const due = ranked.find((x) => (x.s as any).due);
  const all = people.flatMap((p) => p.shifts.map((s) => [mins(s.start), mins(s.end)])).flat().filter((x) => !isNaN(x));
  const from = Math.min(8 * 60, ...all.map((x) => Math.floor(x / 60) * 60)), to = Math.max(18 * 60, ...all.map((x) => Math.ceil(x / 60) * 60));
  const span = Math.max(60, to - from); const pct = (m: number) => `${Math.max(0, Math.min(100, ((m - from) / span) * 100))}%`;
  const hours: number[] = []; for (let h = from; h <= to; h += 120) hours.push(h);
  const toneOf = (t: string) => (t === 'accent' ? brand.accent : t);

  const tile = ({ p, s }: { p: Person; s: any }) => (
    <button key={p.id} type="button" onClick={() => onPick(p)} aria-label={`${p.name}, ${s.label}. Sign in`}
      className="flex flex-col items-center gap-2.5 rounded-[26px] px-2 py-5 text-center transition-transform active:scale-[0.98]"
      style={s.due ? { border: `2px solid ${brand.accent}`, background: `${brand.accent}14` } : { border: `1px solid ${LINE}`, background: '#fff' }}>
      <Face p={p} size={80} ring={s.ring} />
      <span><span className="block text-[16px] font-bold">{p.name}</span><span className="block text-[12px] font-semibold" style={{ color: toneOf(s.tone) }}>{s.label}</span></span>
    </button>);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col landscape:flex-row" style={{ color: INK, background: '#fff' }}>
      <aside className="flex shrink-0 flex-col gap-4 border-b px-6 py-6 landscape:w-[320px] landscape:border-b-0 landscape:border-r landscape:px-8 landscape:py-11" style={{ borderColor: LINE, background: `radial-gradient(120% 60% at 0% 0%, ${brand.accent}14 0%, transparent 70%), #f8f8f9` }}>
        <div className="flex items-center gap-3">{brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-11 w-11 rounded-[14px] object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[18px] font-extrabold text-white" style={{ background: INK }}>{initials(brand.name || 'T')}</span>}<span className="text-[16px] font-bold">{brand.name}</span></div>
        <div className="flex items-end justify-between gap-4 landscape:mt-12 landscape:block">
          <div><p className="text-[56px] font-extrabold leading-[0.95] tracking-tighter tabular-nums landscape:text-[84px]">{clockText(now)}</p><p className="mt-2 text-[16px] landscape:text-[18px]" style={{ color: MUTED }}>{dayText(now)}</p></div>
          <p className="hidden text-[16px] leading-relaxed landscape:mt-4 landscape:block" style={{ color: '#55585e' }}>Tap your face, then your PIN.</p>
        </div>
        <div className="hidden flex-col gap-2.5 landscape:mt-auto landscape:flex">
          <button type="button" onClick={onPin} className="h-14 rounded-[18px] text-[16px] font-bold text-white" style={{ background: INK }}>Not listed? Use your PIN</button>
          <a href="/login" className="flex h-11 items-center justify-center text-[15px] font-semibold" style={{ color: MUTED }}>Sign in with email</a>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-7 px-6 py-6 landscape:px-9 landscape:py-11">
        {due && <div className="flex items-center gap-5 rounded-[32px] border p-6 landscape:hidden" style={{ borderColor: LINE, boxShadow: '0 30px 60px -40px rgba(22,23,26,.45)' }}>
          <Face p={due.p} size={104} ring={`conic-gradient(${brand.accent}, #d7e6e4, ${brand.accent})`} />
          <div className="min-w-0 flex-1"><span className="rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: `${brand.accent}14`, color: brand.accent }}>Up next</span><p className="mt-2 text-[30px] font-extrabold tracking-tight">{due.p.name}</p><p className="text-[15px]" style={{ color: MUTED }}>{due.s.label}</p></div>
          <button type="button" onClick={() => onPick(due.p)} className="h-14 rounded-[18px] px-7 text-[17px] font-bold text-white" style={{ background: INK }}>Clock in</button>
        </div>}
        <section aria-label="Working today">
          <h1 className="mb-4 text-[26px] font-extrabold tracking-tight">Working today</h1>
          {ranked.length ? <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-4 landscape:grid-cols-5">{ranked.map(tile)}</div>
            : <p className="text-[15px]" style={{ color: MUTED }}>No shifts on the schedule today — use your PIN to sign in.</p>}
        </section>
        {ranked.some((x) => x.p.shifts.length) && <section aria-label="The day" className="rounded-[26px] p-5" style={{ background: '#f8f8f9' }}>
          <div className="mb-2 flex items-baseline justify-between"><span className="text-[17px] font-extrabold">The day</span>{ranked.filter((x) => x.s.rank === 4).length > 0 && <span className="text-[13px]" style={{ color: MUTED }}>{ranked.filter((x) => x.s.rank === 4).map((x) => x.p.name).join(', ')} finished</span>}</div>
          <div className="relative flex pl-[90px] text-[12px]" style={{ color: '#9a9ca1' }}>{hours.map((h) => <span key={h} className="absolute" style={{ left: `calc(90px + (100% - 90px) * ${(h - from) / span})` }}>{fmt(h)}</span>)}<span className="invisible">.</span></div>
          <div className="relative mt-2 flex flex-col gap-2">
            {n >= from && n <= to && <span aria-hidden className="absolute bottom-[-4px] top-[-4px] w-[2px] rounded" style={{ left: `calc(90px + (100% - 90px) * ${(n - from) / span})`, background: brand.accent }} />}
            {ranked.filter((x) => x.p.shifts.length).map(({ p, s }) => (
              <button key={p.id} type="button" onClick={() => onPick(p)} className="flex h-7 items-center text-left" aria-label={`${p.name}'s shift. Sign in`}>
                <span className="w-[90px] truncate text-[14px] font-semibold" style={(s as any).due ? { color: brand.accent, fontWeight: 700 } : undefined}>{p.name}</span>
                <span className="relative h-full flex-1">{p.shifts.map((sh, i) => { const a = mins(sh.start), b = mins(sh.end); if (isNaN(a) || isNaN(b)) return null; const started = p.state !== 'off' && a <= n;
                  return (<span key={i} className="absolute bottom-1.5 top-1.5 rounded-lg" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, ...(started ? { background: '#dcdde0' } : { border: `2px dashed ${(s as any).due ? brand.accent : '#c9cacf'}`, boxSizing: 'border-box' }) }}>
                    {started && <span className="absolute bottom-0 left-0 top-0 rounded-lg" style={{ width: `${Math.max(0, Math.min(100, ((Math.min(n, b) - a) / Math.max(1, b - a)) * 100))}%`, background: p.state === 'break' ? '#d9922e' : INK }} />}
                  </span>); })}</span>
              </button>))}
          </div>
        </section>}
        <div className="mt-auto flex flex-col gap-2.5 landscape:hidden">
          <button type="button" onClick={onPin} className="h-14 rounded-[18px] border text-[16px] font-semibold" style={{ borderColor: '#e6e6e8' }}>Not listed? Use your PIN</button>
          <a href="/login" className="flex h-11 items-center justify-center text-[15px] font-semibold" style={{ color: MUTED }}>Sign in with email</a>
        </div>
      </main>
    </div>);
}

export function PortalSignIn({ tenantId, notice, onSuccess, renderForgot }: { tenantId: string; notice?: string; onSuccess: (staff: any) => void; renderForgot?: (back: () => void) => React.ReactNode }) {
  const [brand, setBrand] = React.useState<Brand>({ name: '', accent: INK });
  const [shared, setShared] = React.useState(false); const [last, setLast] = React.useState<Last | null>(null);
  const [view, setView] = React.useState<'home' | 'pin' | 'forgot'>('home'); const [who, setWho] = React.useState<Last | null>(null);
  const [people, setPeople] = React.useState<Person[]>([]); const [error, setError] = React.useState(notice || ''); const [busy, setBusy] = React.useState(false);
  const now = useClock();

  React.useEffect(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('device') : null;
    if (q === 'shared') write(key(tenantId, 'mode'), 'shared'); if (q === 'personal') write(key(tenantId, 'mode'), null);
    setShared(read(key(tenantId, 'mode')) === 'shared');
    try { const l = JSON.parse(read(key(tenantId, 'last')) || 'null'); if (l?.id) setLast(l); } catch { /* none */ }
    fetch('/api/portal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'brand', tenantId }) })
      .then((r) => r.json()).then((d) => { if (d?.business) { setBrand(d.business); rememberBrand(tenantId, d.business); } }).catch(() => {});
  }, [tenantId]);

  React.useEffect(() => {
    if (!shared) return; let stop = false;
    const load = () => fetch('/api/portal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'today-board', tenantId }) })
      .then((r) => r.json()).then((d) => { if (stop) return; if (d?.business) { setBrand(d.business); rememberBrand(tenantId, d.business); } if (d?.off) { setShared(false); return; } setPeople(Array.isArray(d?.people) ? d.people : []); }).catch(() => {});
    load(); const t = setInterval(load, 60000); return () => { stop = true; clearInterval(t); };
  }, [shared, tenantId]);

  const signIn = async (pin: string) => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/portal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', tenantId, pin, ...(who?.id ? { expectStaffId: who.id } : {}) }) });
      const d = await res.json().catch(() => ({}));
      if (!d?.ok || !d.staff) { setError(d?.error || 'Incorrect PIN. Try again.'); return; }
      if (!d.customToken) { setError('Secure sign-in is unavailable right now. Try again in a moment.'); return; }
      const { getAuth, signInWithCustomToken } = await import('firebase/auth');
      try { await signInWithCustomToken(getAuth(), d.customToken); } catch { setError('Sign-in failed. Check your connection and try again.'); return; }
      if (!shared) write(key(tenantId, 'last'), JSON.stringify({ id: d.staff.id, name: d.staff.name || '', avatarUrl: d.staff.avatarUrl || null }));
      setView('home'); setWho(null); onSuccess(d.staff);
    } catch { setError('Couldn’t reach the sign-in service. Check your connection and try again.'); }
    finally { setBusy(false); }
  };

  const deviceToggle = (
    <button type="button" onClick={() => { const next = !shared; write(key(tenantId, 'mode'), next ? 'shared' : null); if (next) { write(key(tenantId, 'last'), null); setLast(null); } setShared(next); setView('home'); setWho(null); }}
      className="text-[12px] font-medium underline-offset-4 hover:underline" style={{ color: '#9a9ca1' }}>{shared ? 'This is my own phone' : brand.sharedBoard === false ? '' : 'Use this as a shared tablet'}</button>);
  const footer = (<><a href="/login" className="text-[14px] font-semibold" style={{ color: MUTED }}>Sign in with email</a>{deviceToggle}</>);

  if (view === 'forgot' && renderForgot) return <div className="cf-portal min-h-[100dvh] bg-white">{renderForgot(() => setView('home'))}</div>;
  if (view === 'pin') return <div className="cf-portal min-h-[100dvh] bg-white"><Keypad who={who} brand={brand} error={error} busy={busy} onPin={signIn} onBack={() => { setView('home'); setWho(null); setError(''); }} onForgot={renderForgot ? () => setView('forgot') : undefined} /></div>;
  if (shared) return <div className="cf-portal min-h-[100dvh] bg-white"><Board brand={brand} people={people} now={now} onPick={(p) => { setWho({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }); setError(''); setView('pin'); }} onPin={() => { setWho(null); setError(''); setView('pin'); }} /><div className="flex justify-center pb-4">{deviceToggle}</div></div>;
  if (last) return <div className="cf-portal min-h-[100dvh] bg-white"><WelcomeBack last={last} brand={brand} onPin={() => { setWho(last); setError(''); setView('pin'); }} onSwitch={() => { write(key(tenantId, 'last'), null); setLast(null); setWho(null); }} /></div>;
  return <div className="cf-portal min-h-[100dvh] bg-white"><Keypad who={null} brand={brand} error={error} busy={busy} onPin={signIn} onForgot={renderForgot ? () => setView('forgot') : undefined} footer={footer} /></div>;
}

/** Is this device the business's shared tablet? (The portal signs people out sooner there.) */
export function isSharedDevice(tenantId: string): boolean { return read(key(tenantId, 'mode')) === 'shared'; }
