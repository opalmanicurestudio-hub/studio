'use client';
// src/app/kds/[tenantId]/page.tsx — THE KITCHEN SCREEN. Every ticket the kitchen makes, in one place: lounge orders,
// event courses, table tabs and café sales at the desk (lib/kitchen). It runs on a tablet with nobody signed in: a
// manager sets it up once (api/kitchen 'pair'), and from then on the tablet carries its own key and reads and moves
// tickets through api/kitchen. It never locks; a PIN (checked by the server) only puts a name on what someone did.
//   Lanes: waiting, being made, ready. By course or by dish: a whole course or dish moved along at once.
//   Allergies are shown big on every ticket, including ones only typed into a note (lib/kitchen allergyFlags).
//   A sound plays for every new ticket, the first one too, once the screen has been tapped (browsers need a tap).
//   ?event=<id> shows one event's tickets (linked from the event screen).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getAuth, signOut } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { allergyFlags, groupTickets, type KitchenTicket, type KitchenStep } from '@/lib/kitchen';
import { esc, PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const AMBER_TINT = '#fff7ed', GREEN_TINT = '#ecf6f0';
const POLL_MS = 4000;
const WARM_S = 5 * 60, LATE_S = 8 * 60;

type View = 'lanes' | 'course' | 'dish';
type Item = { id: string; name: string; imageUrl: string | null; unit: string | null; formula: { id: string; name: string; quantityUsed: number; unit: string }[] };
type Today = { status: string; at: string; deliveredAt: string | null; item: string };
type Data = { screen: string; business: { name: string; timeZone: string | null }; tickets: KitchenTicket[]; items: Record<string, Item>; today: Today[] };
type Staff = { id: string; name: string; pass: string };

const keyName = (t: string) => `cf.kitchen.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

const secondsSince = (iso: string, now: number) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : 0; };
const waited = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
const clock = (iso: string, tz: string | null) => { const d = new Date(iso); if (isNaN(d.getTime())) return ''; try { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(' AM', 'am').replace(' PM', 'pm'); } catch { return ''; } };
const amount = (n: number) => String(Math.round(n * 10) / 10);
const where = (t: KitchenTicket) => t.source === 'event' ? `${t.eventTitle || 'Event'}${t.courseNumber !== null ? `, course ${t.courseNumber}` : ''}${t.tableNumber ? `, table ${t.tableNumber}` : ''}${t.seatNumber ? `, seat ${t.seatNumber}` : ''}` : t.station;
const sourceWord = (t: KitchenTicket) => t.source === 'lounge' ? 'Lounge' : t.source === 'tab' ? 'Table' : t.source === 'pos' ? 'Desk' : t.source === 'event' ? 'Event' : 'Order';

// ─── Printing: the ticket as a label, through the tablet's own print dialog (a receipt printer set up on it works) ──
function printTicket(t: KitchenTicket, item: Item | undefined, staff: Staff | null, tz: string | null) {
  const flags = allergyFlags(t);
  const lines: { text: string; size?: 'big' | 'mid'; bold?: boolean; rule?: boolean }[] = [
    { text: `${t.item}${t.quantity > 1 ? ` × ${t.quantity}` : ''}`, size: 'big', bold: true },
    { text: t.name, size: 'mid', bold: true },
    { text: `${where(t)}  ${clock(t.at, tz)}` },
  ];
  if (flags.any) {
    lines.push({ text: '', rule: true });
    if (flags.listed.length) lines.push({ text: `Allergy: ${flags.listed.map((a) => `${a.name}${a.severe ? ' (severe)' : ''}`).join(', ')}`, size: 'mid', bold: true });
    for (const m of flags.mentions) lines.push({ text: `Note: ${m}`, bold: true });
  }
  if (item?.formula?.length) {
    lines.push({ text: '', rule: true });
    for (const f of item.formula.slice(0, 6)) lines.push({ text: `${amount(f.quantityUsed * t.quantity)}${f.unit ? ` ${f.unit}` : ''} ${f.name}` });
  }
  if (t.note && !flags.mentions.includes(t.note)) { lines.push({ text: '', rule: true }); lines.push({ text: t.note }); }
  lines.push({ text: '', rule: true });
  lines.push({ text: `${staff ? `${staff.name}  ` : ''}#${t.id.slice(-6)}` });
  const body = lines.map((l) => l.rule ? '<hr style="border:none;border-top:1px dashed #000;margin:5px 0;">'
    : `<div style="font-size:${l.size === 'big' ? '18px' : l.size === 'mid' ? '14px' : '11px'};font-weight:${l.bold ? 600 : 400};line-height:1.4;margin:1px 0;">${esc(l.text)}</div>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket</title><link href="${PRINT_FONT_HREF}" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:${PRINT_FONT_STACK};font-variant-numeric:tabular-nums;width:72mm;padding:4px 6px;background:#fff;color:#000;}
@media print{@page{margin:0;size:80mm auto;}body{width:80mm;}}</style></head><body>${body}<div style="height:16px"></div></body></html>`;
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = () => { const go = () => { w.focus(); w.print(); w.close(); }; const f = (w.document as any).fonts; if (f?.ready) f.ready.then(go, go); else go(); };
  return true;
}

// ─── A short two-note chime ──────────────────────────────────────────────────────────────────────────────────────────
function chime(ctx: AudioContext) {
  const tone = (freq: number, at: number, len: number) => {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime + at);
    g.gain.setValueAtTime(0, ctx.currentTime + at); g.gain.linearRampToValueAtTime(0.4, ctx.currentTime + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + len);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + len);
  };
  tone(880, 0, 0.3); tone(1100, 0.15, 0.4);
}

const btn = 'min-h-[44px] px-4 rounded-xl text-[14px] font-semibold disabled:opacity-50 transition-opacity';
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;

// ─── Allergy banner: big enough to read across a kitchen ─────────────────────────────────────────────────────────────
function AllergyBanner({ t, compact = false }: { t: KitchenTicket; compact?: boolean }) {
  const f = allergyFlags(t);
  if (!f.any) return null;
  const strong = f.severe;
  return (
    <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: strong ? AMBER : AMBER_TINT, color: strong ? '#fff' : AMBER, border: `1px solid ${strong ? AMBER : '#f3d9b8'}` }} role="note" aria-label="Allergy">
      {f.listed.length > 0 && (
        <p className={compact ? 'text-[15px] font-semibold leading-snug' : 'text-[18px] font-semibold leading-snug'}>
          {strong ? 'Severe allergy: ' : 'Allergy: '}{f.listed.map((a) => `${a.name}${a.severe && f.listed.length > 1 ? ' (severe)' : ''}`).join(', ')}
        </p>
      )}
      {f.mentions.map((m, i) => (
        <p key={i} className={compact ? 'text-[14px] font-medium leading-snug' : 'text-[15px] font-medium leading-snug'}>{f.listed.length ? 'Their note: ' : 'Allergy in their note: '}{m}</p>
      ))}
    </div>
  );
}

// ─── One ticket, in a lane ───────────────────────────────────────────────────────────────────────────────────────────
function TicketCard({ t, item, now, tz, busy, onStep, onCancel, onPrint }: {
  t: KitchenTicket; item?: Item; now: number; tz: string | null; busy: boolean;
  onStep: (t: KitchenTicket, s: KitchenStep) => void; onCancel: (t: KitchenTicket) => void; onPrint: (t: KitchenTicket) => void;
}) {
  const s = secondsSince(t.at, now);
  const late = s >= LATE_S, warm = !late && s >= WARM_S;
  const flags = allergyFlags(t);
  const plainNote = t.note && !flags.mentions.includes(t.note) ? t.note : null;
  return (
    <article className="rounded-2xl bg-white p-4 space-y-3" style={{ border: `1px solid ${late ? AMBER : LINE}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium" style={{ color: MUTED }}>{sourceWord(t)} · {clock(t.at, tz)}{t.isRedemption ? ' · Member perk' : ''}</p>
          <h3 className="text-[22px] font-semibold leading-tight mt-0.5" style={{ color: INK }}>
            {t.item}{t.quantity > 1 && <span style={{ color: MUTED }}> × {t.quantity}</span>}
          </h3>
        </div>
        <span className="shrink-0 rounded-full px-3 py-1 text-[15px] font-semibold tabular-nums" style={late ? { background: AMBER, color: '#fff' } : warm ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }} aria-label={`Waiting ${waited(s)}`}>{waited(s)}</span>
      </div>
      <AllergyBanner t={t} />
      {t.collect > 0 && <p className="rounded-xl px-3 py-2 text-[16px] font-semibold" style={{ background: SOFT, color: INK }}>Collect ${t.collect.toFixed(2)} when it’s handed over</p>}
      <div className="text-[15px] leading-snug" style={{ color: INK }}>
        <p className="font-medium">{t.name}</p>
        <p style={{ color: MUTED }}>{where(t)}</p>
        {t.lookFor && <p className="mt-1">Look for: {t.lookFor}</p>}
        {t.accessNote && !flags.mentions.includes(t.accessNote) && <p className="mt-1">How to reach them: {t.accessNote}</p>}
        {plainNote && <p className="mt-1" style={{ color: MUTED }}>{plainNote}</p>}
      </div>
      {item?.formula?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {item.formula.slice(0, 6).map((f, i) => (
            <span key={i} className="rounded-lg px-2 py-1 text-[13px]" style={{ background: SOFT, color: INK }}>{amount(f.quantityUsed * t.quantity)}{f.unit ? ` ${f.unit}` : ''} {f.name}</span>
          ))}
        </div>
      ) : null}
      {t.claimedBy && t.status !== 'pending' && <p className="text-[13px]" style={{ color: MUTED }}>Started by {t.claimedBy.name}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {t.status === 'pending' && <>
          <button type="button" disabled={busy} onClick={() => onStep(t, 'claim')} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Start</button>
          <button type="button" disabled={busy} onClick={() => onStep(t, 'ready')} className={btn} style={quiet}>Ready</button>
        </>}
        {t.status === 'in_progress' && <>
          <button type="button" disabled={busy} onClick={() => onStep(t, 'ready')} className={`${btn} flex-1`} style={{ background: GREEN, color: '#fff' }}>Ready</button>
          <button type="button" disabled={busy} onClick={() => onStep(t, 'release')} className={btn} style={quiet}>Not started</button>
        </>}
        {t.status === 'ready' && (
          <button type="button" disabled={busy} onClick={() => onStep(t, 'deliver')} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Served</button>
        )}
        <button type="button" onClick={() => onPrint(t)} className={btn} style={quiet}>Print</button>
        <button type="button" disabled={busy} onClick={() => onCancel(t)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: RED }}>Cancel</button>
      </div>
    </article>
  );
}

// ─── A course or a dish: its tickets in rows, moved along together or one by one ─────────────────────────────────────
function GroupPanel({ g, by, now, busyIds, onStep, onBump }: {
  g: ReturnType<typeof groupTickets>[number]; by: 'course' | 'dish'; now: number; busyIds: Set<string>;
  onStep: (t: KitchenTicket, s: KitchenStep) => void; onBump: (list: KitchenTicket[], s: 'ready' | 'deliver') => void;
}) {
  const toReady = g.tickets.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const toServe = g.tickets.filter((t) => t.status === 'ready');
  const withAllergy = g.tickets.filter((t) => allergyFlags(t).any).length;
  const s = secondsSince(g.at, now);
  const anyBusy = g.tickets.some((t) => busyIds.has(t.id));
  // Guests with an allergy first, so they're never at the bottom of a long list.
  const rows = [...g.tickets].sort((a, b) => Number(allergyFlags(b).any) - Number(allergyFlags(a).any));
  return (
    <section className="rounded-2xl bg-white overflow-hidden" style={{ border: `1px solid ${s >= LATE_S ? AMBER : LINE}` }}>
      <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold leading-tight" style={{ color: INK }}>{g.label}{by === 'dish' && <span style={{ color: MUTED }}> × {g.count}</span>}</h2>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            {g.tickets.length} {g.tickets.length === 1 ? 'ticket' : 'tickets'} · oldest {waited(s)}
            {withAllergy > 0 && <span style={{ color: AMBER }} className="font-semibold"> · {withAllergy} with {withAllergy === 1 ? 'an allergy' : 'allergies'}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {toReady.length > 0 && <button type="button" disabled={anyBusy} onClick={() => onBump(toReady, 'ready')} className={btn} style={{ background: GREEN, color: '#fff' }}>All {toReady.length} ready</button>}
          {toServe.length > 0 && <button type="button" disabled={anyBusy} onClick={() => onBump(toServe, 'deliver')} className={btn} style={{ background: INK, color: '#fff' }}>Serve the {toServe.length} ready</button>}
        </div>
      </div>
      <ul>
        {rows.map((t, i) => {
          const busy = busyIds.has(t.id);
          return (
            <li key={`${t.col}/${t.id}`} className="p-3 sm:px-4 space-y-2" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[16px] font-medium leading-snug" style={{ color: INK }}>
                    {by === 'course' ? <>{t.item}{t.quantity > 1 ? ` × ${t.quantity}` : ''}<span style={{ color: MUTED }}> · {t.name}</span></> : <>{t.name}{t.quantity > 1 ? ` × ${t.quantity}` : ''}</>}
                  </p>
                  <p className="text-[13.5px]" style={{ color: MUTED }}>{where(t)} · {t.status === 'pending' ? 'Waiting' : t.status === 'in_progress' ? 'Being made' : 'Ready'}{t.note && !allergyFlags(t).mentions.includes(t.note) ? ` · ${t.note}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  {t.status === 'pending' && <button type="button" disabled={busy} onClick={() => onStep(t, 'claim')} className={btn} style={quiet}>Start</button>}
                  {(t.status === 'pending' || t.status === 'in_progress') && <button type="button" disabled={busy} onClick={() => onStep(t, 'ready')} className={btn} style={{ background: GREEN, color: '#fff' }}>Ready</button>}
                  {t.status === 'ready' && <button type="button" disabled={busy} onClick={() => onStep(t, 'deliver')} className={btn} style={{ background: INK, color: '#fff' }}>Served</button>}
                </div>
              </div>
              <AllergyBanner t={t} compact />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── "Who's working?": a PIN puts a name on what's done (never needed to use the screen) ────────────────────────────
function PinPad({ check, onDone, onClose }: { check: (pin: string) => Promise<{ ok: true; staff: Staff } | { ok: false; error: string }>; onDone: (s: Staff) => void; onClose: () => void }) {
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const press = async (k: string) => {
    if (busy) return;
    if (k === 'back') { setPin((p) => p.slice(0, -1)); setErr(''); return; }
    const next = (pin + k).slice(0, 4); setPin(next); setErr('');
    if (next.length < 4) return;
    setBusy(true);
    const r = await check(next);
    setBusy(false);
    if (r.ok) onDone(r.staff); else { setErr(r.error); setPin(''); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label="Who’s working">
      <div className="w-full max-w-xs rounded-3xl bg-white p-5 space-y-4">
        <div>
          <h2 className="text-[20px] font-semibold" style={{ color: INK }}>Who’s working?</h2>
          <p className="text-[14px] mt-1" style={{ color: MUTED }}>Your PIN puts your name on the tickets you move. The screen works without it.</p>
        </div>
        <div className="flex justify-center gap-3" aria-label={`${pin.length} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="h-3.5 w-3.5 rounded-full" style={{ background: i < pin.length ? INK : LINE }} />)}
        </div>
        {err && <p className="text-[14px] text-center" style={{ color: AMBER }}>{err}</p>}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((k, i) => k === ''
            ? <span key={i} />
            : <button key={i} type="button" disabled={busy} onClick={() => press(k)} className="h-14 rounded-2xl text-[20px] font-semibold disabled:opacity-50" style={{ background: SOFT, color: INK }} aria-label={k === 'back' ? 'Delete' : k}>{k === 'back' ? '⌫' : k}</button>)}
        </div>
        <button type="button" onClick={onClose} className={`${btn} w-full`} style={quiet}>Close</button>
      </div>
    </div>
  );
}

// ─── Setting the screen up ───────────────────────────────────────────────────────────────────────────────────────────
function Setup({ tenantId, stopped, closed, onPaired }: { tenantId: string; stopped: string; closed: string; onPaired: (key: string) => void }) {
  const { user, isUserLoading } = useFirebase() as any;
  const [name, setName] = useState('Kitchen'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [screens, setScreens] = useState<{ id: string; name: string; lastSeenAt: string | null; createdBy: string | null }[] | null>(null);
  const call = async (body: any) => { const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }); return r.json().catch(() => ({})); };
  // A manager signed in here sees the screens already set up, to stop one that's lost or no longer used.
  useEffect(() => { if (!user) return; call({ action: 'screens' }).then((d) => setScreens(d.ok ? d.screens || [] : null), () => setScreens(null)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = async (id: string) => { const d = await call({ action: 'revoke', id }).catch(() => ({})); if (d.ok) setScreens((l) => (l || []).filter((x) => x.id !== id)); else setErr(d.error || 'That screen couldn’t be stopped. Try again.'); };
  const pair = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pair', tenantId, name }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.key) onPaired(String(d.key)); else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(false);
  };
  const next = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : `/kds/${tenantId}`;
  return (
    <main className="min-h-dvh flex items-center justify-center p-4" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6 space-y-4" style={{ border: `1px solid ${LINE}` }}>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Set up the kitchen screen</h1>
          <p className="text-[15px] mt-1.5 leading-relaxed" style={{ color: MUTED }}>A manager sets this tablet up once. After that it keeps working when they sign out: anyone in the kitchen can move tickets along, and a PIN only puts a name on what they did.</p>
        </div>
        {closed && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{closed}</div>}
        {stopped && !closed && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{stopped}</div>}
        {isUserLoading ? (
          <div className="h-7 w-7 rounded-full border-[3px] animate-spin mx-auto" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />
        ) : user ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[14px] font-medium">Name this screen</span>
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="mt-1.5 w-full min-h-[44px] rounded-xl px-3 text-[16px] outline-none" style={{ border: `1px solid ${LINE}` }} placeholder="Kitchen, Bar, Pass" />
            </label>
            {err && <p className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
            <button type="button" onClick={pair} disabled={busy} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Setting up…' : 'Set up this screen'}</button>
            <p className="text-[13px]" style={{ color: MUTED }}>Signed in as {user.email || 'you'}. Only an owner or manager can set up a screen.</p>
            {screens && screens.length > 0 && (
              <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
                <p className="text-[14px] font-medium">Screens already set up</p>
                {screens.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-[14px]"><p className="font-medium truncate">{x.name}</p><p style={{ color: MUTED }}>{x.lastSeenAt ? `Last used ${new Date(x.lastSeenAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not used yet'}</p></div>
                    <button type="button" onClick={() => stop(x.id)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: RED }}>Stop</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <a href={`/login?next=${encodeURIComponent(next)}`} className={`${btn} w-full inline-flex items-center justify-center`} style={{ background: INK, color: '#fff' }}>Sign in to set it up</a>
        )}
      </div>
    </main>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export default function KitchenScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const { user } = useFirebase() as any;
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [stopped, setStopped] = useState('');
  const [closed, setClosed] = useState('');
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>('lanes');
  const [eventId, setEventId] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [audioOk, setAudioOk] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [cancelFor, setCancelFor] = useState<KitchenTicket | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);
  const acted = useRef(0);   // bumped on every tap, so a refresh that left before it can't put the old state back

  // What this tablet remembers: its key, the view, sound, and who's working (this browser tab only).
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const v = read('cf.kitchen.view'); if (v === 'course' || v === 'dish' || v === 'lanes') setView(v);
    if (read('cf.kitchen.sound') === 'off') setSoundOn(false);
    try { const s = JSON.parse(sessionStorage.getItem('cf.kitchen.staff') || 'null'); if (s?.name && s?.pass) setStaff(s); } catch { /* */ }
    try { const e = new URLSearchParams(window.location.search).get('event'); if (e && /^[A-Za-z0-9_-]{1,160}$/.test(e)) setEventId(e); } catch { /* */ }
    setReady(true);
  }, [tenantId]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); }, [notice]);

  // Sound needs one tap on the screen before a browser lets it play.
  const unlock = useCallback(() => {
    try {
      if (!audio.current) audio.current = new AudioContext();
      if (audio.current.state === 'suspended') audio.current.resume().then(() => setAudioOk(true), () => {}); else setAudioOk(true);
    } catch { /* no sound on this device */ }
  }, []);
  useEffect(() => { const h = () => unlock(); window.addEventListener('pointerdown', h, { passive: true }); return () => window.removeEventListener('pointerdown', h); }, [unlock]);

  const post = useCallback(async (body: any) => {
    const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, ...body }) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, d };
  }, [tenantId, key]);

  const forgetHere = useCallback((why: string) => { write(keyName(tenantId), null); setKey(null); setData(null); seen.current = null; setStopped(why); }, [tenantId]);

  const load = useCallback(async () => {
    if (!key || inFlight.current) return;
    inFlight.current = true; const at = acted.current;
    try {
      const { status, d } = await post({ action: 'tickets', ...(eventId ? { eventId } : {}) });
      if (at !== acted.current) return;   // a tap happened meanwhile: the next refresh has it
      if (status === 401) { forgetHere(d.error || 'This screen was stopped. A manager can set it up again.'); return; }
      if (d.closed) { setClosed(d.error || 'The kitchen screen is closed for now.'); return; }
      if (!d.ok) return;
      setClosed('');
      const next: Data = { screen: d.screen, business: d.business, tickets: d.tickets || [], items: d.items || {}, today: d.today || [] };
      // A sound for every ticket not seen before (the first one after a quiet spell too), never for what was already up.
      const ids = next.tickets.map((t) => `${t.col}/${t.id}`);
      if (seen.current) {
        const fresh = next.tickets.filter((t) => t.status === 'pending' && !seen.current!.has(`${t.col}/${t.id}`));
        if (fresh.length && soundOn && audio.current && audio.current.state === 'running') chime(audio.current);
        for (const i of ids) seen.current.add(i);
      } else seen.current = new Set(ids);
      setData(next); setLastOk(Date.now());
    } catch { /* offline: keep what's on screen and try again */ } finally { inFlight.current = false; }
  }, [key, eventId, post, forgetHere, soundOn]);

  useEffect(() => {
    if (!key) return;
    load();
    const i = setInterval(load, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [key, load]);

  const setBusy = (ids: string[], on: boolean) => setBusyIds((prev) => { const n = new Set(prev); for (const i of ids) { if (on) n.add(i); else n.delete(i); } return n; });
  const local = (list: KitchenTicket[], status: string) => setData((d) => d ? { ...d, tickets: d.tickets.map((t) => list.some((x) => x.id === t.id && x.col === t.col) ? { ...t, status, ...(status === 'in_progress' && staff ? { claimedBy: { staffId: staff.id, name: staff.name } } : {}) } : t).filter((t) => ['pending', 'in_progress', 'ready'].includes(t.status)) } : d);
  const after: Record<KitchenStep, string> = { claim: 'in_progress', release: 'pending', ready: 'ready', deliver: 'delivered', cancel: 'cancelled' };

  const step = async (t: KitchenTicket, s: KitchenStep) => {
    acted.current++; setBusy([t.id], true);
    try {
      const { status, d } = await post({ action: 'act', col: t.col, id: t.id, step: s, ...(staff ? { staffPass: staff.pass } : {}) });
      if (status === 401) { forgetHere(d.error || 'This screen was stopped.'); return; }
      if (d.staffOk === false) staffGone();
      if (d.ok && d.already) setNotice(`${t.item} for ${t.name} was already moved on, maybe on another screen.`);
      else if (d.ok) local([t], after[s]);
      else setNotice(d.error || 'That didn’t go through. Try again.');
    } catch { setNotice('No connection. Try again.'); }
    finally { acted.current++; setBusy([t.id], false); }
    load();
  };
  const bump = async (list: KitchenTicket[], s: 'ready' | 'deliver') => {
    const ids = list.map((t) => t.id); acted.current++; setBusy(ids, true);
    try {
      const { status, d } = await post({ action: 'bump', step: s, tickets: list.map((t) => ({ col: t.col, id: t.id })), ...(staff ? { staffPass: staff.pass } : {}) });
      if (status === 401) { forgetHere(d.error || 'This screen was stopped.'); return; }
      if (d.staffOk === false) staffGone();
      if (d.ok) {
        if (d.failed > 0) setNotice(`${d.failed} of ${d.of} didn’t go through. They’re still up: try them again.`);
        else { local(list, after[s]); if (d.moved < d.of) setNotice(`${d.moved} of ${d.of} moved. The rest were already moved on.`); }
      }
      else setNotice(d.error || 'That didn’t go through. Try again.');
    } catch { setNotice('No connection. Try again.'); }
    finally { acted.current++; setBusy(ids, false); }
    load();
  };
  const checkPin = async (pin: string): Promise<{ ok: true; staff: Staff } | { ok: false; error: string }> => {
    try {
      const { status, d } = await post({ action: 'pin', pin });
      if (status === 401) { forgetHere(d.error || 'This screen was stopped.'); return { ok: false, error: 'This screen was stopped.' }; }
      return d.ok ? { ok: true, staff: { id: String(d.staff.id), name: String(d.staff.name), pass: String(d.pass) } } : { ok: false, error: d.error || 'That PIN isn’t right.' };
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  };
  const confirmCancel = async () => { const t = cancelFor; setCancelFor(null); if (t) await step(t, 'cancel'); };
  const print = (t: KitchenTicket) => { if (!printTicket(t, t.itemId ? data?.items[String(t.itemId)] : undefined, staff, data?.business.timeZone || null)) setNotice('Allow pop-ups for this page to print.'); };

  // The server no longer counts this person's pass (it ran out, or they're off the team): stop showing their name.
  const staffGone = () => { pickStaff(null); setNotice('Your name is no longer on this screen. Enter your PIN again to put it back.'); };
  const pickView = (v: View) => { setView(v); write('cf.kitchen.view', v); };
  const toggleSound = () => { const v = !soundOn; setSoundOn(v); write('cf.kitchen.sound', v ? 'on' : 'off'); unlock(); };
  const pickStaff = (s: Staff | null) => { setStaff(s); try { if (s) sessionStorage.setItem('cf.kitchen.staff', JSON.stringify(s)); else sessionStorage.removeItem('cf.kitchen.staff'); } catch { /* */ } };
  // Stopped on the server first: a screen forgotten only here would still work for anyone who copied its key.
  const stopScreen = async () => {
    setMenuOpen(false);
    try { const { status, d } = await post({ action: 'forget' }); if (d.ok || status === 401) { forgetHere('This screen was stopped. A manager can set it up again.'); return; } } catch { /* below */ }
    setNotice('The screen couldn’t reach the server to stop. Try again, or a manager can stop it from the setup page on another device.');
  };
  const showAll = () => { setEventId(null); seen.current = null; try { window.history.replaceState(null, '', window.location.pathname); } catch { /* */ } };

  const tickets = data?.tickets || [];
  const byTime = (a: KitchenTicket, b: KitchenTicket) => String(a.at).localeCompare(String(b.at));
  const lanes = useMemo(() => ({
    waiting: tickets.filter((t) => t.status === 'pending').sort(byTime),
    making: tickets.filter((t) => t.status === 'in_progress').sort(byTime),
    ready: tickets.filter((t) => t.status === 'ready').sort(byTime),
  }), [tickets]);
  const groups = useMemo(() => view === 'lanes' ? [] : groupTickets(tickets, view), [tickets, view]);
  const stats = useMemo(() => {
    const day = (data?.today || []).filter((x) => x.status !== 'cancelled');
    const served = day.filter((x) => x.status === 'delivered' && x.deliveredAt);
    const waits = served.map((x) => (Date.parse(String(x.deliveredAt)) - Date.parse(x.at)) / 1000).filter((n) => Number.isFinite(n) && n >= 0);
    const avg = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
    const count: Record<string, number> = {}; for (const x of day) if (x.item) count[x.item] = (count[x.item] || 0) + 1;
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { total: day.length, served: served.length, avg, top };
  }, [data]);

  if (!ready) return <main className="min-h-dvh" style={{ background: SOFT }} />;
  if (!key) return <Setup tenantId={tenantId} stopped={stopped} closed={closed} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); setJustPaired(true); seen.current = null; }} />;

  const tz = data?.business.timeZone || null;
  const stale = lastOk > 0 && now - lastOk > 15000;
  const eventTitle = eventId ? tickets.find((t) => t.eventId === eventId)?.eventTitle : null;
  const lane = (title: string, list: KitchenTicket[], empty: string) => (
    <section className="min-w-0 space-y-3" aria-label={title}>
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[16px] font-semibold" style={{ color: INK }}>{title}</h2>
        <span className="min-w-[32px] h-8 px-2 rounded-full inline-flex items-center justify-center text-[15px] font-semibold tabular-nums" style={{ background: list.length ? INK : '#fff', color: list.length ? '#fff' : MUTED, border: list.length ? undefined : `1px solid ${LINE}` }}>{list.length}</span>
      </div>
      {list.length === 0
        ? <p className="rounded-2xl px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>{empty}</p>
        : list.map((t) => <TicketCard key={`${t.col}/${t.id}`} t={t} item={t.itemId ? data?.items[String(t.itemId)] : undefined} now={now} tz={tz} busy={busyIds.has(t.id)} onStep={step} onCancel={setCancelFor} onPrint={print} />)}
    </section>
  );

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: SOFT, color: INK }}>
      <header className="bg-white px-4 sm:px-6 py-3 space-y-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight truncate">{data?.business.name || 'Kitchen'}</h1>
            <p className="text-[13.5px]" style={{ color: MUTED }}>{data?.screen || 'Kitchen screen'} · {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} up</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl p-1" style={{ background: SOFT }} role="tablist" aria-label="How tickets are shown">
              {([['lanes', 'Lanes'], ['course', 'By course'], ['dish', 'By dish']] as [View, string][]).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pickView(v)} className="min-h-[40px] px-3 rounded-lg text-[14px] font-medium" style={view === v ? { background: '#fff', color: INK, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: MUTED }}>{label}</button>
              ))}
            </div>
            {staff
              ? <span className="inline-flex items-center gap-2 rounded-xl pl-3 bg-white" style={{ border: `1px solid ${LINE}` }}><span className="text-[14px]">Working: <b className="font-semibold">{staff.name.split(' ')[0]}</b></span><button type="button" onClick={() => pickStaff(null)} className="min-h-[42px] px-3 rounded-xl text-[14px] font-semibold" style={{ color: MUTED }}>Done</button></span>
              : <button type="button" onClick={() => setPinOpen(true)} className={btn} style={quiet}>Who’s working?</button>}
            <button type="button" onClick={toggleSound} className={btn} style={quiet} aria-pressed={soundOn}>{soundOn ? 'Sound on' : 'Sound off'}</button>
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className={btn} style={quiet} aria-expanded={menuOpen}>Screen</button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white p-2 z-40 space-y-1" style={{ border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
                  <p className="px-3 pt-2 pb-1 text-[13px]" style={{ color: MUTED }}>Printing uses this tablet’s print dialog. A receipt printer set up on the tablet works.</p>
                  <button type="button" onClick={stopScreen} className="w-full text-left min-h-[44px] px-3 rounded-xl text-[14px] font-medium" style={{ color: RED }}>Stop this screen</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]" style={{ color: MUTED }}>
          <span>Today <b className="font-semibold tabular-nums" style={{ color: INK }}>{stats.total}</b></span>
          <span>Served <b className="font-semibold tabular-nums" style={{ color: INK }}>{stats.served}</b></span>
          <span>Waiting <b className="font-semibold tabular-nums" style={{ color: INK }}>{lanes.waiting.length}</b></span>
          <span>Average wait <b className="font-semibold tabular-nums" style={{ color: INK }}>{stats.served ? waited(stats.avg) : 'none yet'}</b></span>
          {stats.top && <span>Most ordered <b className="font-semibold" style={{ color: INK }}>{stats.top}</b></span>}
        </div>
      </header>

      <div className="px-4 sm:px-6 pt-3 space-y-2">
        {closed && <div className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>{closed}</div>}
        {stale && !closed && <div className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>The screen can’t reach the server. Tickets may be out of date; it keeps trying.</div>}
        {justPaired && (
          <div className="rounded-2xl px-4 py-3 text-[15px] flex flex-wrap items-center justify-between gap-2" style={{ background: GREEN_TINT, color: GREEN }}>
            <span>This screen is set up and keeps working on its own.{user ? ' You can sign out of your account on this tablet now.' : ''}</span>
            <span className="flex gap-2">
              {user && <button type="button" onClick={() => { signOut(getAuth()).catch(() => {}); setJustPaired(false); }} className={btn} style={quiet}>Sign out</button>}
              <button type="button" onClick={() => setJustPaired(false)} className={btn} style={quiet}>Close</button>
            </span>
          </div>
        )}
        {eventId && (
          <div className="rounded-2xl px-4 py-2 text-[15px] flex flex-wrap items-center justify-between gap-2 bg-white" style={{ border: `1px solid ${LINE}` }}>
            <span>Showing {eventTitle || 'one event'} only.</span>
            <button type="button" onClick={showAll} className={btn} style={quiet}>Show every ticket</button>
          </div>
        )}
        {notice && <div className="rounded-2xl px-4 py-3 text-[15px] bg-white" style={{ border: `1px solid ${LINE}` }} role="status">{notice}</div>}
      </div>

      <main className="flex-1 px-4 sm:px-6 py-4">
        {!data ? (
          <div className="flex justify-center py-16"><div className="h-7 w-7 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading tickets" /></div>
        ) : view === 'lanes' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            {lane('Waiting', lanes.waiting, 'Nothing waiting.')}
            {lane('Being made', lanes.making, 'Nothing being made.')}
            {lane('Ready to go out', lanes.ready, 'Nothing ready yet.')}
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-2xl px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>No tickets up.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {groups.map((g) => <GroupPanel key={g.key} g={g} by={view as 'course' | 'dish'} now={now} busyIds={busyIds} onStep={step} onBump={bump} />)}
          </div>
        )}
      </main>

      {soundOn && !audioOk && (
        // Floats over the screen, so it going away after the first tap never moves a button under someone's finger.
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-full px-5 py-3 text-[15px] font-medium pointer-events-none" style={{ background: INK, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxWidth: 'calc(100vw - 32px)' }} role="status">Tap anywhere to turn on the sound for new tickets</div>
      )}
      {pinOpen && <PinPad check={checkPin} onDone={(s) => { pickStaff(s); setPinOpen(false); }} onClose={() => setPinOpen(false)} />}
      {cancelFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label="Cancel this ticket">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 space-y-3">
            <h2 className="text-[20px] font-semibold">Cancel {cancelFor.item} for {cancelFor.name}?</h2>
            <p className="text-[15px]" style={{ color: MUTED }}>It comes off every screen.{cancelFor.source === 'lounge' ? ' Anything taken off the shelf when it was ordered is put back.' : cancelFor.source === 'tab' ? ' It stays on the table’s bill until it’s taken off there.' : cancelFor.source === 'pos' ? ' The sale isn’t changed: refund it at the desk if it won’t be made.' : ''}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setCancelFor(null)} className={btn} style={quiet}>Keep it</button>
              <button type="button" onClick={confirmCancel} className={btn} style={{ background: RED, color: '#fff' }}>Cancel ticket</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
