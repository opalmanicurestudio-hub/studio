'use client';
// src/components/money/MileageScreen.tsx — MILEAGE (the /mileage page; api/mileage; lib/trip-log; design board "Mileage:
// logged as you go, with proof"). The year so far at the IRS rate, a drive started and ended from the phone, a trip added
// after, drives the books point to (a card purchase in a store, an off-site event) logged with a tap, and the year's log
// with its odometer readings, to print or download for the accountant. `post` and `where` come from the page (the
// server, and the phone's location), so the screen can be shown with any answers.
import * as React from 'react';
import { PURPOSES, milesText, purposeLabel, logBodyHtml, type Trip, type TripPlace } from '@/lib/trip-log';
import { printPage } from '@/lib/print-style';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[48px] items-center justify-center rounded-full px-5 text-[15px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${INK}` }; const quiet = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const card = 'rounded-3xl bg-[#fff] p-4';
const field = `h-12 w-full rounded-2xl border bg-[#fff] px-3.5 text-[15px] ${RING}`;
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const md = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const monthOf = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

type Summary = { year: number; trips: number; backed: number; sameDay: number; businessTenths: number; commuteTenths: number; amountCents: number; rate: { year: number; label: string; stale: boolean }; odometer: { start: number | null; end: number | null }; totalTenths: number | null; otherTenths: number | null };
type Sugg = { id: string; kind: 'card' | 'event'; title: string; day: string; amountCents: number | null; to: TripPlace; oneWayTenths: number; purpose: string };
type Drive = { startedAt: string; from: TripPlace; ended: string | null; to: TripPlace | null; oneWayTenths: number | null; road: boolean; commute?: boolean };
export type MileageData = { year: number; today: string; years: number[]; summary: Summary; trips: Trip[]; places: TripPlace[]; origin: TripPlace | null; suggestions: Sugg[]; drive: Drive | null; owner?: boolean; setup: { home: TripPlace | null; homeIsMain: boolean; odometer: Record<string, { start?: number | null; end?: number | null }> } };
type Draft = { from: TripPlace; to: TripPlace; oneWayTenths: number; road: boolean; commute: boolean; fromDrive: boolean; started?: string; ended?: string; typed?: string };

export function MileageScreen(p: { post: (body: any) => Promise<any>; where: () => Promise<{ lat: number; lng: number } | null>; business: string; backHref?: string; initial?: MileageData | null; startView?: 'home' | 'log' | 'add' | 'setup' }) {
  const [d, setD] = React.useState<MileageData | null>(p.initial || null);
  const [year, setYear] = React.useState<number | null>(p.initial?.year ?? null);
  const [view, setView] = React.useState<'home' | 'log' | 'add' | 'setup' | 'save'>(p.startView || 'home');
  const [err, setErr] = React.useState(''); const [said, setSaid] = React.useState(''); const [busy, setBusy] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const load = React.useCallback(async (y?: number | null) => {
    const r = await p.post({ action: 'list', ...(y ? { year: y } : {}) });
    if (r?.ok) { setD(r); setYear(r.year); setErr('');
      if (r.drive?.ended && r.drive.to) { setDraft({ from: r.drive.from, to: r.drive.to, oneWayTenths: r.drive.oneWayTenths || 1, road: r.drive.road, commute: !!r.drive.commute, fromDrive: true, started: r.drive.startedAt, ended: r.drive.ended }); setView('save'); } }
    else setErr(r?.error || 'That didn’t load. Try again.');
  }, [p]);
  React.useEffect(() => { if (!p.initial) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, body: any, then?: (r: any) => void) => {
    setBusy(key); setErr(''); setSaid('');
    const r = await p.post(body); setBusy(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through. Try again.'); return null; }
    then?.(r); return r;
  };

  const start = async () => {
    setBusy('start'); setErr('');
    const at = await p.where();
    if (!at) { setBusy(null); setErr('Your phone didn’t share where you are. Turn on location for ClarityFlow in your phone’s settings, or add the trip after.'); return; }
    setBusy(null); await act('start', { action: 'start', ...at }, () => load(year));
  };
  const end = async () => {
    setBusy('end'); setErr('');
    const at = await p.where();
    if (!at) { setBusy(null); setErr('Your phone didn’t share where you are. Turn on location, or cancel the drive and add the trip after.'); return; }
    setBusy(null);
    await act('end', { action: 'end', ...at }, (r) => { setDraft({ from: r.from, to: r.to, oneWayTenths: r.oneWayTenths, road: r.road, commute: !!r.commute, fromDrive: true, started: r.startedAt, ended: r.ended }); setView('save'); });
  };

  if (!d) return <div className="mx-auto w-full max-w-[560px] px-4 py-6"><p className="text-[15px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Loading your mileage…'}</p></div>;
  const s = d.summary; const thisYear = d.years[0]; const past = d.year !== thisYear;
  const live = d.drive && !d.drive.ended ? d.drive : null;

  const header = (title: string, back?: () => void) => (
    <div className="flex items-center gap-2">
      {back ? <button type="button" onClick={back} aria-label="Back" className={`flex h-11 w-11 items-center justify-center rounded-full bg-[#fff] ${RING}`}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg></button>
        : p.backHref ? <a href={p.backHref} aria-label="Back to Write-offs" className={`flex h-11 w-11 items-center justify-center rounded-full bg-[#fff] ${RING}`}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg></a> : null}
      <h1 className="text-[22px] font-bold tracking-[-0.01em]">{title}</h1>
    </div>
  );
  const msg = (err || said) && <p role={err ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-[14px]" style={err ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }}>{err || said}</p>;
  const wrap = (children: React.ReactNode) => <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3.5 px-4 pb-10 pt-4" style={{ color: INK }}>{children}</div>;

  /* ─── A drive under way ─── */
  if (live && view === 'home') return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[560px] flex-col gap-5 rounded-none px-4 pb-8 pt-6 sm:rounded-3xl" style={{ background: INK, color: '#fff' }}>
      <p className="flex items-center gap-2.5 text-[15px] font-semibold" style={{ color: '#d4d4d8' }}><span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: '#4ade80', boxShadow: '0 0 0 6px rgba(74,222,128,0.18)' }} />Drive in progress</p>
      <Elapsed since={live.startedAt} />
      <p className="text-[16px]" style={{ color: '#d4d4d8' }}>Started {clock(live.startedAt)} at {live.from.label}</p>
      <div className="flex flex-col gap-2.5 rounded-2xl p-4 text-[15px]" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <p>When you get there, tap End drive. The miles come from the map between where you started and where you ended.</p>
        <p>Your phone doesn’t follow you the whole way, so it’s easy on the battery. Close the app if you like: the drive keeps going.</p>
      </div>
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <div className="flex-1" />
      <button type="button" onClick={end} disabled={!!busy} className={`${btn} min-h-[56px] text-[17px] font-bold`} style={{ background: '#fff', color: INK }}>{busy === 'end' ? 'Finding where you are…' : 'End drive'}</button>
      <button type="button" onClick={() => act('cancel', { action: 'cancel' }, () => { setSaid('Drive cancelled.'); void load(year); })} disabled={!!busy} className={`min-h-[44px] self-start text-[15px] font-semibold ${RING}`} style={{ color: '#d4d4d8' }}>Cancel this drive</button>
    </div>
  );

  /* ─── Save a drive, or a trip added after ─── */
  if (view === 'save' && draft) return wrap(<>
    {header(draft.fromDrive ? 'Drive ended' : 'Add a trip', draft.fromDrive ? undefined : () => setView('add'))}
    {draft.fromDrive && draft.started && draft.ended && <p className="-mt-2 px-1 text-[14px]" style={{ color: MUTED }}>{new Date(draft.ended).toDateString() === new Date().toDateString() ? 'Today' : new Date(draft.ended).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {clock(draft.started)} to {clock(draft.ended)}</p>}
    <SaveTrip draft={draft} busy={!!busy} msg={msg}
      onSave={(c) => draft.fromDrive
        ? act('save', { action: 'save', ...c }, (r) => { setDraft(null); setView('home'); setSaid(`Saved: ${milesText(r.trip.tenths)} miles${r.trip.use === 'commute' ? ', as commuting' : ''}.`); void load(thisYear); })
        : act('add', { action: 'add', from: draft.from, to: draft.to, ...(draft.typed ? { miles: draft.typed } : {}), ...c }, (r) => { setDraft(null); setView('home'); setSaid(`Saved: ${milesText(r.trip.tenths)} miles on ${md(r.trip.day)}${r.trip.use === 'commute' ? ', as commuting' : ''}.`); void load(thisYear); })}
      onCancel={draft.fromDrive ? () => act('cancel', { action: 'cancel' }, () => { setDraft(null); setView('home'); void load(year); }) : () => { setDraft(null); setView('home'); }}
      today={d.today} />
  </>);

  /* ─── Add a trip after ─── */
  if (view === 'add') return wrap(<>
    {header('Add a trip', () => setView('home'))}
    <AddTrip places={d.places} origin={d.origin} busy={busy === 'miles'} msg={msg}
      onNext={(from, to, miles) => act('miles', { action: 'miles', from, to, ...(miles ? { miles } : {}) }, (r) => {
        if (r.oneWayTenths == null) { setErr('One of those places isn’t on the map. Type the miles one way instead.'); return; }
        setDraft({ from: r.from, to: r.to, oneWayTenths: r.oneWayTenths, road: r.road, commute: !!r.commute, fromDrive: false, typed: miles || undefined }); setView('save');
      })} />
  </>);

  /* ─── Home and the main place of business ─── */
  if (view === 'setup') return wrap(<>
    {header('Places', () => setView('home'))}
    {msg}
    <Setup setup={d.setup} places={d.places} busy={busy === 'setup'} onSave={(x) => act('setup', { action: 'setup', ...x }, () => { setSaid('Saved.'); void load(year); })} />
  </>);

  /* ─── The year's log ─── */
  if (view === 'log') return wrap(<>
    {header(`${d.year} mileage log`, () => setView('home'))}
    {d.years.length > 1 && <div className="flex gap-2">{d.years.map((y) => <button key={y} type="button" aria-pressed={y === d.year} onClick={() => load(y)} className={`${btn} min-h-[44px] px-4 text-[14px]`} style={y === d.year ? solid : quiet}>{y}</button>)}</div>}
    {msg}
    <LogView d={d} busy={busy}
      onReading={(which, v) => act('setup', { action: 'setup', year: d.year, [which]: v }, () => { setSaid('Odometer saved.'); void load(d.year); })}
      onEdit={(id, x) => act(`edit_${id}`, { action: 'edit', id, ...x }, () => { setSaid('Trip changed. What it was is kept with it.'); void load(d.year); })}
      onRemove={(id) => act(`rm_${id}`, { action: 'remove', id }, () => { setSaid('Taken out of the log.'); void load(d.year); })}
      onPrint={() => { const w = window.open('', '_blank'); if (!w) { setErr('Your browser blocked the new window. Allow pop-ups for ClarityFlow and try again.'); return; }
        w.document.write(printPage({ title: `${d.year} mileage log`, heading: `${d.year} mileage <b>log</b>`, shopName: p.business, subtitle: 'Every business drive: the date, where, why and the miles.', body: logBodyHtml(d.trips, d.year, d.setup as any), footNote: 'Each trip was saved when it was logged. Changes to a trip are kept with it.' })); w.document.close(); }}
      onCsv={() => act('csv', { action: 'export', year: d.year }, (r) => { const blob = new Blob([r.csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mileage-${d.year}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); })} />
  </>);

  /* ─── Home ─── */
  return wrap(<>
    {header('Mileage')}
    <section aria-label={`${d.year} so far`} className={`${card} flex flex-col gap-1`}>
      <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{past ? d.year : `${d.year} so far`}</p>
      <p className="text-[34px] font-bold tracking-[-0.02em]">{milesText(s.businessTenths, true)} miles</p>
      <p className="text-[15px]"><span className="font-bold" style={{ color: GREEN }}>{usd(s.amountCents)}</span> at the IRS rate of {s.rate.label} a mile</p>
      {s.rate.stale && <p className="text-[13px]" style={{ color: AMBER }}>The IRS’s rate for {d.year} isn’t in yet, so this uses {s.rate.year}’s. It’s added as soon as it’s announced.</p>}
      <p className="mt-1 text-[13px]" style={{ color: MUTED }}>{s.trips} trip{s.trips === 1 ? '' : 's'}.{d.setup.home || d.setup.homeIsMain ? ' Drives between home and work aren’t counted: that’s commuting.' : ''}</p>
      {!past && d.owner !== false && <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={start} disabled={!!busy} className={btn} style={solid}>{busy === 'start' ? 'Finding you…' : 'Start a drive'}</button>
        <button type="button" onClick={() => { setErr(''); setView('add'); }} className={btn} style={plain}>Add a trip</button>
      </div>}
    </section>
    {msg}
    {d.owner === false && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>The owner keeps the mileage log, as it’s for their car. You can see it and download it.</p>}
    {d.owner !== false && !d.setup.home && !d.setup.homeIsMain && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>Add your home under Home and places, so drives between home and work are kept as commuting, which isn’t a write-off, and drives from home for the business are counted.</p>}
    {!d.origin && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>To suggest drives and work out miles from your business, its address needs to be on the map. Check it in Settings, Locations{d.setup.homeIsMain ? '' : ', or set your home below if you run the business from home'}.</p>}

    {!past && d.owner !== false && d.suggestions.length > 0 && <section aria-label="Did you drive to these?" className="flex flex-col gap-2">
      <h2 className="mx-1 mt-1 text-[16px] font-bold">Did you drive to these?</h2>
      <p className="mx-1 text-[13px]" style={{ color: MUTED }}>From your card purchases and events. One tap logs the round trip from {d.origin?.label.split(',')[0] || 'your business'}, with the purchase or event kept as proof.</p>
      {d.suggestions.map((x) => (
        <div key={x.id} className="flex flex-col gap-2.5 rounded-[20px] bg-[#fff] px-4 py-3.5">
          <div className="flex justify-between gap-3">
            <div className="min-w-0"><span className="block text-[15px] font-semibold">{x.title}</span>
              <span className="block text-[13px]" style={{ color: MUTED }}>{md(x.day)}. {x.kind === 'card' ? `Card purchase${x.amountCents ? `, ${usd(x.amountCents)}` : ''}` : 'Event'}</span></div>
            <span className="shrink-0 text-[15px] font-semibold">{milesText(x.oneWayTenths * 2)} mi</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => act(`s_${x.id}`, { action: 'suggested', id: x.id, roundTrip: true }, (r) => { setSaid(`Logged: ${milesText(r.trip.tenths)} miles, with the ${x.kind === 'card' ? 'purchase' : 'event'} as proof.`); void load(thisYear); })} disabled={!!busy}
              className={`${btn} min-h-[44px] flex-1 text-[14px] font-bold`} style={{ background: GREEN_TINT, color: GREEN }}>{busy === `s_${x.id}` ? 'Logging…' : 'Log it, round trip'}</button>
            <button type="button" onClick={() => act(`d_${x.id}`, { action: 'dismiss', id: x.id }, () => load(thisYear))} disabled={!!busy} className={`${btn} min-h-[44px] px-4 text-[14px]`} style={quiet}>Not a drive</button>
          </div>
        </div>))}
    </section>}

    <section aria-label="Recent trips" className="rounded-[20px] bg-[#fff] px-4 pb-1.5">
      <h2 className="pb-1 pt-3 text-[16px] font-bold">Recent trips</h2>
      {d.trips.length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>None yet. Start a drive when you head out for supplies, the bank, a class or a client, or add one you already made.</p>}
      {d.trips.slice(0, 5).map((t) => <TripRow key={t.id} t={t} />)}
    </section>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => setView('log')} className={btn} style={quiet}>The year’s log</button>
      {d.owner !== false && <button type="button" onClick={() => setView('setup')} className={btn} style={quiet}>Home and places</button>}
    </div>
  </>);
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const min = Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
  return <p className="text-[56px] font-bold leading-none tracking-[-0.03em]">{min < 60 ? `${min} min` : `${Math.floor(min / 60)} hr ${min % 60} min`}</p>;
}

function TripRow({ t }: { t: Trip }) {
  const commute = t.use === 'commute';
  return (
    <div className="flex justify-between gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
      <div className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{t.to.label.split(',')[0]}</span>
        <span className="block text-[13px]" style={{ color: MUTED }}>{md(t.day)}. {commute ? 'Commuting, not counted' : `${purposeLabel(t.purpose)}${t.roundTrip ? ', round trip' : ''}`}</span>
      </div>
      <span className="shrink-0 text-[15px] font-semibold" style={{ color: commute ? MUTED : INK }}>{milesText(t.tenths)} mi</span>
    </div>
  );
}

function Chips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div role="group" aria-label="What was it for?" className="flex flex-wrap gap-2">
    {PURPOSES.map((x) => <button key={x.id} type="button" aria-pressed={value === x.id} onClick={() => onChange(x.id)}
      className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={value === x.id ? { background: INK, color: '#fff', border: `1px solid ${INK}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{x.label}</button>)}
  </div>;
}

function SaveTrip({ draft, onSave, onCancel, busy, msg, today }: { draft: Draft; onSave: (c: any) => void; onCancel: () => void; busy: boolean; msg: React.ReactNode; today: string }) {
  const [round, setRound] = React.useState(true); const [purpose, setPurpose] = React.useState(''); const [note, setNote] = React.useState(''); const [day, setDay] = React.useState(today);
  const total = draft.oneWayTenths * (round ? 2 : 1);
  return <>
    <section aria-label="Where" className="rounded-[20px] bg-[#fff] px-4 py-1.5">
      <div className="flex min-h-[56px] items-center gap-3" style={{ borderBottom: `1px solid ${LINE}` }}><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-2" style={{ borderColor: INK }} />
        <span className="min-w-0"><span className="block text-[12px] font-semibold" style={{ color: MUTED }}>From</span><span className="block text-[15px] font-semibold">{draft.from.label}</span></span></div>
      <div className="flex min-h-[56px] items-center gap-3" style={{ borderBottom: `1px solid ${LINE}` }}><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: INK }} />
        <span className="min-w-0"><span className="block text-[12px] font-semibold" style={{ color: MUTED }}>To</span><span className="block text-[15px] font-semibold">{draft.to.label}</span></span></div>
      <div className="flex min-h-[56px] items-center justify-between" style={{ borderBottom: `1px solid ${LINE}` }}><span className="text-[15px]">Miles{draft.typed ? ', as typed' : draft.road ? ', from the map' : ', estimated from the map'}</span><span className="text-[15px] font-bold">{milesText(draft.oneWayTenths)}</span></div>
      <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3">
        <span><span className="block text-[15px]">Count the drive back too</span><span className="block text-[13px]" style={{ color: MUTED }}>{milesText(draft.oneWayTenths * 2)} miles in all</span></span>
        <input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} className="h-[22px] w-[22px] accent-[#16171a]" />
      </label>
    </section>
    {draft.commute
      ? <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>Home to the business is commuting, which isn’t a write-off. It’s kept for your return’s commuting miles. If you run the business from home, say so under Home and places.</p>
      : <section aria-label="What was it for?" className={`${card} flex flex-col gap-3`}>
        <h2 className="text-[16px] font-bold">What was it for?</h2>
        <Chips value={purpose} onChange={setPurpose} />
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>A few words (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} className={field} style={{ borderColor: LINE }} placeholder="Restock supplies" /></label>
        {!draft.fromDrive && <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Day</span>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className={field} style={{ borderColor: LINE }} /></label>}
      </section>}
    {msg}
    <button type="button" disabled={busy || (!draft.commute && !purpose)} onClick={() => onSave({ purpose: draft.commute ? 'other' : purpose, note, roundTrip: round, day, use: draft.commute ? 'commute' : 'business' })} className={`${btn} min-h-[52px] text-[16px] font-bold`} style={solid}>
      {busy ? 'Saving…' : `Save trip, ${milesText(total)} miles`}</button>
    <button type="button" onClick={onCancel} disabled={busy} className={`min-h-[44px] self-center text-[14px] font-semibold ${RING}`} style={{ color: MUTED }}>{draft.fromDrive ? 'Don’t keep this drive' : 'Cancel'}</button>
    <p className="px-1 text-center text-[13px]" style={{ color: MUTED }}>Saved with the date and time, the places, the reason and the miles: what a mileage log needs to show.</p>
  </>;
}

function PlacePick({ label, places, value, onChange }: { label: string; places: TripPlace[]; value: { ref?: string | null; label: string } | null; onChange: (v: { ref?: string | null; label: string } | null) => void }) {
  const typed = !!value && !value.ref && !places.some((x) => !x.ref && x.label === value.label);
  const [typing, setTyping] = React.useState(typed);
  const id = React.useId();
  return <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-[13px] font-semibold" style={{ color: MUTED }}>{label}</label>
    {!typing
      ? <select id={id} className={field} style={{ borderColor: LINE }} value={value ? (value.ref || `label:${value.label}`) : ''}
          onChange={(e) => { const v = e.target.value; if (v === '__type') { setTyping(true); onChange(null); return; }
            const pl = places.find((x) => (x.ref || `label:${x.label}`) === v); onChange(pl ? { ref: pl.ref || null, label: pl.label, ...(pl.lat != null ? { lat: pl.lat, lng: pl.lng } : {}) } as any : null); }}>
          <option value="">Pick a place</option>
          {places.map((x) => <option key={x.ref || x.label} value={x.ref || `label:${x.label}`}>{x.ref === 'home' ? `Home, ${x.label}` : x.label}</option>)}
          <option value="__type">Type an address</option>
        </select>
      : <div className="flex gap-2"><input id={id} className={field} style={{ borderColor: LINE }} placeholder="88 Main St, Raleigh, NC" value={value?.label || ''} onChange={(e) => onChange(e.target.value ? { label: e.target.value } : null)} maxLength={160} autoComplete="street-address" />
          <button type="button" onClick={() => { setTyping(false); onChange(null); }} className={`${btn} min-h-[48px] px-4 text-[14px]`} style={quiet}>List</button></div>}
  </div>;
}

function AddTrip({ places, origin, onNext, busy, msg }: { places: TripPlace[]; origin: TripPlace | null; onNext: (from: any, to: any, miles: string) => void; busy: boolean; msg: React.ReactNode }) {
  const [from, setFrom] = React.useState<any>(origin ? { ref: origin.ref || null, label: origin.label, ...(origin.lat != null ? { lat: origin.lat, lng: origin.lng } : {}) } : null);
  const [to, setTo] = React.useState<any>(null); const [miles, setMiles] = React.useState(''); const [own, setOwn] = React.useState(false);
  return <>
    <section className={`${card} flex flex-col gap-3`}>
      <PlacePick label="From" places={places} value={from} onChange={setFrom} />
      <PlacePick label="To" places={places} value={to} onChange={setTo} />
      {!own ? <button type="button" onClick={() => setOwn(true)} className={`min-h-[44px] self-start text-[14px] font-semibold underline underline-offset-2 ${RING}`}>Type the miles instead</button>
        : <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Miles one way</span>
          <input inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} className={field} style={{ borderColor: LINE }} placeholder="6.4" /></label>}
      <p className="text-[13px]" style={{ color: MUTED }}>{own ? 'Typed miles are kept as typed.' : 'The miles come from the map, by road.'}</p>
    </section>
    {msg}
    <button type="button" disabled={busy || !from?.label || !to?.label || (own && !miles)} onClick={() => onNext(from, to, own ? miles : '')} className={btn} style={solid}>{busy ? 'Working out the miles…' : 'Next'}</button>
  </>;
}

function Setup({ setup, places, onSave, busy }: { setup: MileageData['setup']; places: TripPlace[]; onSave: (x: any) => void; busy: boolean }) {
  const [home, setHome] = React.useState(setup.home?.label || ''); const [main, setMain] = React.useState(!!setup.homeIsMain);
  const biz = places.filter((x) => (x.ref || '').startsWith('biz:'));
  return <>
    <section className={`${card} flex flex-col gap-2`}>
      <h2 className="text-[16px] font-bold">Your business</h2>
      {biz.length ? biz.map((x) => <p key={x.ref} className="text-[15px]">{x.label}{x.lat == null && <span className="block text-[13px]" style={{ color: AMBER }}>Not found on the map. Check the address in Settings, Locations.</span>}</p>)
        : <p className="text-[14px]" style={{ color: MUTED }}>No address yet. Add it in Settings, Locations.</p>}
    </section>
    <section className={`${card} flex flex-col gap-3`}>
      <h2 className="text-[16px] font-bold">Home</h2>
      <p className="text-[13px]" style={{ color: MUTED }}>So drives between home and work are kept as commuting, which isn’t a write-off. Kept only for the mileage log, and seen only by people who keep the books.</p>
      <input value={home} onChange={(e) => setHome(e.target.value)} maxLength={160} className={field} style={{ borderColor: LINE }} placeholder="12 Oak St, Raleigh, NC" autoComplete="street-address" aria-label="Home address" />
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px]"><input type="checkbox" checked={main} onChange={(e) => setMain(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />I run the business from home</label>
      {main && <p className="text-[13px]" style={{ color: MUTED }}>Then drives from home for the business usually count, and none are commuting. Your accountant can confirm home is your main place of business.</p>}
      <button type="button" disabled={busy} onClick={() => onSave({ home: home.trim() ? { label: home.trim() } : null, homeIsMain: main })} className={btn} style={solid}>{busy ? 'Saving…' : 'Save'}</button>
    </section>
  </>;
}

function LogView({ d, busy, onReading, onEdit, onRemove, onPrint, onCsv }: { d: MileageData; busy: string | null; onReading: (which: 'start' | 'end', v: string | null) => void; onEdit: (id: string, x: any) => void; onRemove: (id: string) => void; onPrint: () => void; onCsv: () => void }) {
  const s = d.summary; const o = d.setup.odometer?.[String(d.year)] || {};
  const [start, setStart] = React.useState(o.start != null ? String(o.start) : ''); const [end, setEnd] = React.useState(o.end != null ? String(o.end) : '');
  React.useEffect(() => { setStart(o.start != null ? String(o.start) : ''); setEnd(o.end != null ? String(o.end) : ''); }, [d.year, o.start, o.end]);
  const [open, setOpen] = React.useState<string | null>(null); const [sure, setSure] = React.useState<string | null>(null);
  const months: [string, Trip[]][] = [];
  for (const t of d.trips) { const m = monthOf(t.day); const last = months[months.length - 1]; if (last && last[0] === m) last[1].push(t); else months.push([m, [t]]); }
  const row = (k: string, v: string, sub?: string, tone?: 'good' | 'muted') => <div className="flex min-h-[52px] items-center justify-between gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
    <span><span className="block text-[15px]">{k}</span>{sub && <span className="block text-[13px]" style={{ color: MUTED }}>{sub}</span>}</span>
    <span className="text-[15px] font-bold" style={{ color: tone === 'good' ? GREEN : tone === 'muted' ? MUTED : INK }}>{v}</span></div>;
  return <>
    {s.trips > 0 && <section aria-label="How it holds up" className="flex flex-col gap-1 rounded-[20px] px-4 py-3.5" style={{ background: GREEN_TINT, color: GREEN }}>
      <p className="text-[15px] font-bold">What your log shows</p>
      <p className="text-[14px]">Every trip has the date, where you went, why, and the miles. {s.sameDay} of your {s.trips} trip{s.trips === 1 ? ' was' : 's were'} logged within a day of the drive, and {s.backed} {s.backed === 1 ? 'is' : 'are'} backed by a purchase or event. Logging at the time is what holds up best.</p>
    </section>}
    <section aria-label="The year" className="rounded-[20px] bg-[#fff] px-4 [&>div:last-child]:border-b-0">
      {row('Business miles', milesText(s.businessTenths))}
      {row(`At ${s.rate.label} a mile`, usd(s.amountCents), s.rate.stale ? `${d.year}’s IRS rate isn’t in yet: this is ${s.rate.year}’s` : undefined, 'good')}
      {row('Commuting, not counted', milesText(s.commuteTenths), undefined, 'muted')}
      {s.totalTenths != null && row('Other miles', milesText(s.otherTenths || 0), 'From your odometer, less business and commuting', 'muted')}
    </section>
    <section aria-label="Odometer" className={`${card} flex flex-col gap-2.5`}>
      <h2 className="text-[16px] font-bold">Odometer</h2>
      <p className="text-[13px]" style={{ color: MUTED }}>Two readings a year give your accountant the total miles your tax return asks about.</p>
      <div className="grid grid-cols-2 gap-2">
        {([['start', 'January 1', start, setStart], ['end', 'December 31', end, setEnd]] as const).map(([k, lab, v, set]) => (
          <label key={k} className="flex flex-col gap-1"><span className="text-[12px] font-semibold" style={{ color: MUTED }}>{lab}</span>
            <input inputMode="numeric" value={v} readOnly={d.owner === false} onChange={(e) => set(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} onBlur={() => { const was = k === 'start' ? o.start : o.end; if (d.owner !== false && String(was ?? '') !== v) onReading(k, v || null); }}
              className={field} style={{ borderColor: LINE }} placeholder={k === 'end' && d.year === d.years[0] ? 'On December 31' : 'Miles'} /></label>))}
      </div>
    </section>
    {months.map(([m, list]) => <section key={m} aria-label={m} className="rounded-[20px] bg-[#fff] px-4 pb-1.5">
      <h2 className="pb-1 pt-3 text-[16px] font-bold">{m}</h2>
      {list.map((t) => <div key={t.id} className="py-3" style={{ borderTop: `1px solid ${LINE}` }}>
        <button type="button" aria-expanded={open === t.id} onClick={() => { setOpen(open === t.id ? null : t.id); setSure(null); }} className={`flex w-full min-h-[44px] flex-col gap-1.5 text-left ${RING}`}>
          <span className="flex w-full justify-between gap-2.5"><span className="min-w-0 text-[15px] font-semibold">{t.to.label}</span><span className="shrink-0 text-[15px] font-semibold" style={{ color: t.use === 'commute' ? MUTED : INK }}>{milesText(t.tenths)}</span></span>
          <span className="flex flex-wrap items-center gap-1.5"><span className="text-[13px]" style={{ color: MUTED }}>{md(t.day)}. {t.use === 'commute' ? 'Commuting, not counted' : `${purposeLabel(t.purpose)}${t.note ? `: ${t.note}` : ''}`}{t.roundTrip ? ', round trip' : ''}</span>
            {t.proof ? <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>{t.proof.kind === 'card' ? 'Card purchase' : 'Event'}</span>
              : <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: SOFT, color: INK }}>{t.how === 'drive' ? 'Logged by drive' : t.how === 'typed' ? 'Miles typed' : 'From the map'}</span>}</span>
        </button>
        {open === t.id && d.owner === false && <p className="mt-2 rounded-2xl p-3 text-[13px]" style={{ background: SOFT, color: MUTED }}>From {t.from.label}. Logged {new Date(t.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} by {t.by.name}.{t.proof ? ` Proof: ${t.proof.label}.` : ''}{t.edits && t.edits.length ? ` Changed: ${t.edits.map((e) => e.was).join('; ')}.` : ''}</p>}
        {open === t.id && d.owner !== false && <TripEdit t={t} busy={busy === `edit_${t.id}` || busy === `rm_${t.id}`} sure={sure === t.id} onSure={() => setSure(t.id)} onEdit={(x) => onEdit(t.id, x)} onRemove={() => onRemove(t.id)} />}
      </div>)}
    </section>)}
    {d.trips.length === 0 && <p className="rounded-2xl bg-[#fff] px-4 py-3 text-[14px]" style={{ color: MUTED }}>No trips logged for {d.year}.</p>}
    <div className="flex flex-col gap-2">
      <button type="button" onClick={onPrint} className={btn} style={solid}>Print or save the log as a PDF</button>
      <button type="button" onClick={onCsv} disabled={busy === 'csv'} className={btn} style={plain}>Spreadsheet for your accountant</button>
    </div>
    <p className="px-1 text-[13px]" style={{ color: MUTED }}>This uses the IRS mileage rate. If you’d rather write off what the car actually costs, your accountant can compare the two.</p>
  </>;
}

function TripEdit({ t, busy, sure, onSure, onEdit, onRemove }: { t: Trip; busy: boolean; sure: boolean; onSure: () => void; onEdit: (x: any) => void; onRemove: () => void }) {
  const [purpose, setPurpose] = React.useState<string>(t.purpose); const [miles, setMiles] = React.useState(milesText(t.oneWayTenths)); const [round, setRound] = React.useState(t.roundTrip); const [note, setNote] = React.useState(t.note || '');
  return <div className="mt-2 flex flex-col gap-3 rounded-2xl p-3" style={{ background: SOFT }}>
    <p className="text-[13px]" style={{ color: MUTED }}>From {t.from.label}. Logged {new Date(t.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} by {t.by.name}.{t.proof ? ` Proof: ${t.proof.label}.` : ''}</p>
    {t.edits && t.edits.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>Changed: {t.edits.map((e) => e.was).join('; ')}.</p>}
    {t.use !== 'commute' && <Chips value={purpose} onChange={setPurpose} />}
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold" style={{ color: MUTED }}>Miles one way</span><input inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} className={field} style={{ borderColor: LINE }} /></label>
      <label className="flex min-h-[48px] cursor-pointer items-center gap-2.5 self-end text-[14px]"><input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Round trip</label>
    </div>
    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} className={field} style={{ borderColor: LINE }} aria-label="A few words" placeholder="A few words (optional)" />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => onEdit({ ...(purpose !== t.purpose ? { purpose } : {}), ...(miles !== milesText(t.oneWayTenths) ? { miles } : {}), ...(round !== t.roundTrip ? { roundTrip: round } : {}), ...(note !== (t.note || '') ? { note } : {}) })} className={`${btn} min-h-[44px] text-[14px]`} style={solid}>Save changes</button>
      {!sure ? <button type="button" disabled={busy} onClick={onSure} className={`${btn} min-h-[44px] text-[14px]`} style={quiet}>Take out of the log</button>
        : <button type="button" disabled={busy} onClick={onRemove} className={`${btn} min-h-[44px] text-[14px]`} style={{ background: AMBER_TINT, color: AMBER }}>Yes, take it out</button>}
    </div>
  </div>;
}
