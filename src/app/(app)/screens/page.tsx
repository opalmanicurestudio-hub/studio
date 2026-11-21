'use client';
// src/app/(app)/screens/page.tsx — THE SCREENS PAGE (design board "Screens in the menu"; lib/screens). Every tablet and TV
// screen this business can set up, sorted by where it goes, each with what it's for, Open (a new tab here) and On a tablet
// (a code to scan with the tablet's camera, or its link to copy). The speaker says when the voice assistant isn't on yet
// (api/counter/voice 'config'). Under them, the tablets set up with a screen, when each was last used, and Stop for one
// that's lost or replaced (api/kitchen 'screens' and 'revoke', a manager's). The search at the top opens this page on one
// screen (?show=kiosk).
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { screenById, screenPath, setUpBy, shownAreas, type ScreenDef } from '@/lib/screens';
import { SCREEN_ICONS } from '@/components/screens/screen-icons';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318', WARN = 'var(--warn-ink)';
// It can be black (lib/app-theme): the app's black look takes over these colors when they're set inline, so the cards are
// `background: '#fff'` (not a class), and warnings and Stop use the ink that changes with it. The code to scan stays white.
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`;
const dark = { background: INK, color: '#fff' } as const;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;

type SetUp = { id: string; name: string; kind: string; lastSeenAt: string | null; locationId?: string | null };
// What each tablet was set up as (lib/screen-keys ScreenKind). The boards and the window screen share one kind: they only show.
const KIND_WORD: Record<string, string> = { kitchen: 'Kitchen, dish or barback screen', floor: 'Floor staff', 'drive-thru': 'Drive-thru lane or speaker', 'drive-thru-board': 'A board or the window screen', host: 'Host stand tablet', kiosk: 'Kiosk' };

/** When it was last used (seen-at is kept at most every few minutes, so anything under that is "a few minutes ago"). */
function lastUsed(iso: string | null, now: number): string {
  const t = Date.parse(String(iso || '')); if (!Number.isFinite(t)) return 'Not used yet';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 6) return 'Last used a few minutes ago';
  if (m < 60) return `Last used ${m} minutes ago`;
  const h = Math.floor(m / 60); if (h < 48) return `Last used ${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  return `Last used ${Math.floor(h / 24)} days ago`;
}

const call = async (url: string, body: any): Promise<{ status: number; d: any }> => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

// ─── One screen: what it is, Open, and On a tablet (its code and link) ──────────────────────────────────────────────
function Row({ s, tenantId, open, onOpen, onClose, found, note }: { s: ScreenDef; tenantId: string; open: boolean; onOpen: () => void; onClose: () => void; found: boolean; note?: React.ReactNode }) {
  const Icon = SCREEN_ICONS[s.id];
  const path = screenPath(s, tenantId);
  const [url, setUrl] = useState(path);
  useEffect(() => { setUrl(`${window.location.origin}${path}`); }, [path]);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (!open) return; let live = true; setQr(null);
    void import('qrcode').then((Q: any) => Q.toDataURL(url, { margin: 1, width: 360, color: { dark: INK, light: '#ffffff' } })).then((img: string) => { if (live) setQr(img); }).catch(() => null);
    return () => { live = false; };
  }, [open, url]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(t); }, [copied]);
  // A browser that won't copy says so: the link is right there to select by hand.
  const copy = async () => { setCopyFailed(false); try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopyFailed(true); } };
  const how = setUpBy(s);
  // Done puts you back on On a tablet, not at the top of the page.
  const toggle = React.useRef<HTMLButtonElement>(null);
  const done = () => { onClose(); toggle.current?.focus(); };
  return (
    <li id={`screen-${s.id}`} className="scroll-mt-24 rounded-2xl p-3 sm:p-4" style={{ background: '#fff', color: INK, border: `1px solid ${open || found ? INK : LINE}` }}>
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: SOFT }}><Icon className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 basis-[180px]">
          <h3 className="text-[15.5px] font-semibold">{s.label}</h3>
          <p className="mt-0.5 text-[13.5px] leading-snug" style={{ color: MUTED }}>{s.line}</p>
          {note}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button ref={toggle} type="button" aria-expanded={open} aria-controls={open ? `code-${s.id}` : undefined} onClick={open ? onClose : onOpen} className={`${btn} flex-1 sm:flex-none`} style={open ? dark : quiet}>On a tablet</button>
          <a id={`open-${s.id}`} href={path} target="_blank" rel="noopener" className={`${btn} flex-1 sm:flex-none`} style={quiet}>Open<span className="sr-only"> the {s.label.toLowerCase()} in a new tab</span></a>
        </div>
      </div>
      {open && (
        <div id={`code-${s.id}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } }} className="mt-3 flex flex-col gap-4 rounded-xl p-3 sm:flex-row sm:items-center sm:p-4" style={{ background: SOFT }}>
          {qr ? <img src={qr} alt={`Code that opens the ${s.label.toLowerCase()} on a tablet`} className="h-32 w-32 shrink-0 rounded-xl bg-[#fff] p-1.5" /> : <span className="h-32 w-32 shrink-0 rounded-xl bg-[#fff]" aria-hidden />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-[14.5px] font-semibold">Scan this with the tablet’s camera</p>
            <p className="text-[13.5px] leading-snug" style={{ color: MUTED }}>{how === 'code' ? 'Or open this link on it, then pair it with the code from the front desk.' : how === 'manager' ? 'Or open this link on it. The first time, a manager signs in there to set it up, and it stays set up.' : 'Or open this link on it.'}</p>
            <p className="break-all text-[13.5px]">{url}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={copy} className={btn} style={quiet}>{copied ? 'Copied' : 'Copy link'}</button>
              <button type="button" onClick={done} className={btn} style={quiet}>Done</button>
            </div>
            <p aria-live="polite" className={copyFailed ? 'text-[13.5px]' : 'sr-only'} style={copyFailed ? { color: WARN } : undefined}>{copyFailed ? 'Couldn’t copy. Select the link above and copy it.' : copied ? 'Link copied' : ''}</p>
          </div>
        </div>
      )}
    </li>
  );
}

// ─── The tablets set up with a screen (a manager's) ─────────────────────────────────────────────────────────────────
function SetUpList({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<SetUp[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  // With more than one location (lib/here-server): which each tablet is at; it shows only that location's orders.
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const saidRef = React.useRef<HTMLParagraphElement>(null);
  // Asked to stop: on Keep it (the safe one). Kept: back on Stop. Stopped: on what was said.
  const ask = (id: string | null, back?: string) => { setAsking(id); setTimeout(() => document.getElementById(id ? `keep-${id}` : `stop-${back}`)?.focus(), 0); };
  const load = React.useCallback(async () => {
    setErr('');
    try {
      const { status, d } = await call('/api/kitchen', { tenantId, action: 'screens' });
      if (d.ok) { setList((d.screens || []).map((x: any) => ({ id: String(x.id), name: String(x.name || ''), kind: String(x.kind || 'kitchen'), lastSeenAt: x.lastSeenAt || null, locationId: x.locationId || null }))); setLocs(Array.isArray(d.locations) ? d.locations : []); }
      else if (status === 401 || status === 403) setHidden(true);
      else setErr(d.error || 'The tablets set up couldn’t be loaded. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setNow(Date.now());
  }, [tenantId]);
  useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const stop = async (x: SetUp) => {
    setBusy(x.id); setErr(''); setSaid('');
    try {
      const { d } = await call('/api/kitchen', { tenantId, action: 'revoke', id: x.id });
      if (d.ok) { setList((l) => (l || []).filter((y) => y.id !== x.id)); setAsking(null); setSaid(d.warning || `${x.name} is stopped. To use that tablet again, open its screen there and set it up.`); setTimeout(() => saidRef.current?.focus(), 0); }
      else setErr(d.error || 'That tablet couldn’t be stopped. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(null);
  };
  const place = async (x: SetUp, locationId: string) => {
    setBusy(x.id); setErr(''); setSaid('');
    try {
      const { d } = await call('/api/kitchen', { tenantId, action: 'screenPlace', id: x.id, locationId: locationId || null });
      if (d.ok) { setList((l) => (l || []).map((y) => (y.id === x.id ? { ...y, locationId: d.locationId || null } : y))); setSaid(`${x.name} is at ${locs.find((l) => l.id === d.locationId)?.name || 'every location'} now.`); }
      else setErr(d.error || 'That didn’t change. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(null);
  };
  if (hidden) return null;
  return (
    <section aria-labelledby="set-up-head" className="space-y-3">
      <div>
        <h2 id="set-up-head" className="text-[17px] font-semibold">Set up on tablets</h2>
        <p className="mt-0.5 text-[13.5px] text-muted-foreground">Every tablet that has a screen set up. Stop one that’s lost or replaced, and it stops working right away.</p>
      </div>
      {err && <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}><span>{err}</span><button type="button" onClick={() => void load()} className={btn} style={quiet}>Try again</button></div>}
      <p ref={saidRef} tabIndex={-1} aria-live="polite" className={said ? `rounded-2xl px-4 py-3 text-[14px] ${RING}` : 'sr-only'} style={said ? { background: SOFT, color: INK } : undefined}>{said}</p>
      {list === null && !err ? <div className="h-16 rounded-2xl" style={{ background: SOFT }} aria-busy="true" />
        : list && list.length === 0 ? <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>No tablets are set up yet. Open a screen on the tablet (On a tablet, above), and a manager sets it up there.</p>
        : list && (
          <ul className="overflow-hidden rounded-2xl" style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>
            {list.map((x, i) => (
              <li key={x.id} className="px-4 py-3" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 basis-[180px]">
                    <p className="truncate text-[15px] font-semibold">{x.name}</p>
                    <p className="text-[13.5px]" style={{ color: MUTED }}>{KIND_WORD[x.kind] || KIND_WORD.kitchen}. {lastUsed(x.lastSeenAt, now)}</p>
                  </div>
                  {locs.length > 1 && <label className="block basis-[160px]"><span className="sr-only">Where {x.name} is</span>
                    <select value={x.locationId || ''} disabled={busy === x.id} onChange={(e) => void place(x, e.target.value)} className={`min-h-[44px] w-full rounded-xl bg-[#fff] px-3 text-[14.5px] ${RING}`} style={{ border: `1px solid ${LINE}` }}>
                      <option value="">Every location</option>
                      {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select></label>}
                  {asking !== x.id && <button id={`stop-${x.id}`} type="button" onClick={() => ask(x.id)} className={btn} style={{ ...quiet, color: 'var(--bad-ink)' }} aria-label={`Stop ${x.name}`}>Stop</button>}
                </div>
                {asking === x.id && (
                  <div role="group" aria-label={`Stop ${x.name}?`} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: SOFT }}>
                    <p className="min-w-0 flex-1 basis-[200px] text-[14px]">Stop this tablet? It stops working right away, and needs setting up again to use.</p>
                    <button type="button" onClick={() => void stop(x)} disabled={busy === x.id} className={btn} style={{ background: RED, color: '#fff' }}>{busy === x.id ? 'Stopping…' : 'Stop it'}</button>
                    <button id={`keep-${x.id}`} type="button" onClick={() => ask(null, x.id)} disabled={busy === x.id} className={btn} style={quiet}>Keep it</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function Screens() {
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const areas = useMemo(() => shownAreas(selectedTenant), [selectedTenant]);
  const q = useSearchParams();
  const want = q.get('show');
  const [openId, setOpenId] = useState<string | null>(null);
  // Opened from the search on one screen: there, outlined, with its Open ready. Once for each search, so a refresh of the
  // business doesn't pull you back to it while you're doing something else on the page.
  const foundId = (() => { const s = screenById(want); return s && areas.some((a) => a.screens.some((x) => x.id === s.id)) ? s.id : null; })();
  useEffect(() => {
    if (!foundId) return;
    const t = setTimeout(() => { document.getElementById(`screen-${foundId}`)?.scrollIntoView({ block: 'center' }); (document.getElementById(`open-${foundId}`) as HTMLElement | null)?.focus({ preventScroll: true }); }, 60);
    return () => clearTimeout(t);
  }, [want, foundId]);
  const speakerShown = areas.some((a) => a.screens.some((s) => s.id === 'speaker'));
  const [voice, setVoice] = useState<{ on: boolean; setUp: boolean } | null>(null);
  useEffect(() => {
    if (!tenantId || !speakerShown) return; let live = true;
    call('/api/counter/voice', { tenantId, action: 'config' }).then(({ d }) => { if (live && d.ok) setVoice({ on: !!d.on, setUp: !!d.setUp }); }, () => null);
    return () => { live = false; };
  }, [tenantId, speakerShown]);
  if (!tenantId) return null;
  const speakerNote = voice && !voice.on ? (
    <p className="mt-1.5 text-[13.5px] leading-snug" style={{ color: WARN }}>
      {voice.setUp ? 'The voice assistant is off.' : 'The voice assistant isn’t set up yet.'} {voice.setUp ? 'Turn it on' : 'Set it up'} from the <Link href="/menu" className={`rounded underline underline-offset-4 ${RING}`} style={{ color: WARN }}>Menu page</Link>, under Drive-thru.
    </p>
  ) : null;
  return (
    <main className="mx-auto w-full max-w-[880px] space-y-8 px-4 pb-16 pt-6 text-foreground sm:px-6">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Screens</h1>
        <p className="mt-1 max-w-[640px] text-[14.5px] leading-relaxed text-muted-foreground">Each one runs on its own tablet or TV. Open it here, or on the tablet with its code.</p>
      </header>
      {areas.length === 0 && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>No screens yet. They come with the tools that use them, like the drive-thru or the kitchen screen.</p>}
      {areas.map((a) => (
        <section key={a.id} aria-labelledby={`area-${a.id}`} className="space-y-3">
          <h2 id={`area-${a.id}`} className="text-[17px] font-semibold">{a.label}</h2>
          <ul className="space-y-2.5">
            {a.screens.map((s) => (
              <Row key={s.id} s={s} tenantId={tenantId} open={openId === s.id} onOpen={() => setOpenId(s.id)} onClose={() => setOpenId(null)} found={foundId === s.id}
                note={s.id === 'speaker' ? speakerNote : undefined} />
            ))}
          </ul>
        </section>
      ))}
      <SetUpList tenantId={tenantId} />
    </main>
  );
}

export default function ScreensPage() { return <React.Suspense fallback={null}><Screens /></React.Suspense>; }
