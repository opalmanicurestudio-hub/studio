'use client';
// src/app/kds/[tenantId]/page.tsx — THE KITCHEN SCREEN. Every ticket the kitchen makes, in one place: lounge orders,
// event courses, table tabs and café sales at the desk (lib/kitchen). It runs on a tablet with nobody signed in: a
// manager sets it up once (api/kitchen 'pair'), and from then on the tablet carries its own key and reads and moves
// tickets through api/kitchen. It never locks; a PIN (checked by the server) only puts a name on what someone did.
//   Lanes: waiting, being made, ready. By course or by dish: a whole course or dish moved along at once.
//   Allergies are shown big on every ticket, including ones only typed into a note (lib/kitchen allergyFlags).
//   A sound plays for every new ticket, the first one too, once the screen has been tapped (browsers need a tap).
//   ?event=<id> shows one event's tickets (linked from the event screen).
//   Drive-thru and counter orders carry a time they must be ready by: they're worked first (drive-thru on top), each
//   ticket counts down to its time, and "By order" keeps an order's items together for bagging.
//   Holding (lib/holding): batches cooked ahead show along the top with how long each has left; a ticket for something
//   held is made from the batch in one tap, and a batch past its time says to throw it out.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getAuth, signOut } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { allergyFlags, groupTickets, kitchenOrder, type KitchenTicket, type KitchenStep } from '@/lib/kitchen';
import { binFor, binState, type HoldBin } from '@/lib/holding';
import { timeLeft } from '@/lib/counter-orders';
import { PinPad as SharedPinPad } from '@/components/kitchen/PinPad';
import { ExpoView } from '@/components/kitchen/ExpoView';
import { esc, PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import type { MenuItem } from '@/lib/menu-server';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const AMBER_TINT = '#fff7ed', GREEN_TINT = '#ecf6f0';
const POLL_MS = 4000;
const WARM_S = 5 * 60, LATE_S = 8 * 60;

type View = 'lanes' | 'order' | 'course' | 'dish' | 'expo';
type Holdable = { id: string; name: string; holdMinutes: number; batchSize: number };
type Item = { id: string; name: string; imageUrl: string | null; unit: string | null; formula: { id: string; name: string; quantityUsed: number; unit: string }[] };
type Today = { status: string; at: string; deliveredAt: string | null; item: string };
type Data = { screen: string; business: { name: string; timeZone: string | null }; tickets: KitchenTicket[]; unfired?: KitchenTicket[]; stations?: string[]; items: Record<string, Item>; today: Today[]; holds: HoldBin[]; holdable: Holdable[]; tossedToday: number };
type Staff = { id: string; name: string; pass: string };

const keyName = (t: string) => `cf.kitchen.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

const secondsSince = (iso: string, now: number) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : 0; };
const waited = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
const clock = (iso: string, tz: string | null) => { const d = new Date(iso); if (isNaN(d.getTime())) return ''; try { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(' AM', 'am').replace(' PM', 'pm'); } catch { return ''; } };
const amount = (n: number) => String(Math.round(n * 10) / 10);
const where = (t: KitchenTicket) => t.source === 'event' ? `${t.eventTitle || 'Event'}${t.courseNumber !== null ? `, course ${t.courseNumber}` : ''}${t.tableNumber ? `, table ${t.tableNumber}` : ''}${t.seatNumber ? `, seat ${t.seatNumber}` : ''}` : t.station;
const CHANNEL_WORD: Record<string, string> = { 'drive-thru': 'Drive-thru', counter: 'Counter', kiosk: 'Kiosk', ahead: 'Ordered ahead' };
const sourceWord = (t: KitchenTicket) => t.channel ? CHANNEL_WORD[t.channel] : t.source === 'lounge' ? 'Lounge' : t.source === 'tab' ? 'Table' : t.source === 'pos' ? 'Desk' : t.source === 'event' ? 'Event' : 'Order';

// ─── Printing: the ticket as a label, through the tablet's own print dialog (a receipt printer set up on it works) ──
function printTicket(t: KitchenTicket, item: Item | undefined, staff: Staff | null, tz: string | null) {
  const flags = allergyFlags(t);
  const lines: { text: string; size?: 'big' | 'mid'; bold?: boolean; rule?: boolean }[] = [
    { text: `${t.item}${t.quantity > 1 ? ` × ${t.quantity}` : ''}`, size: 'big', bold: true },
    ...(t.choices ? [{ text: t.choices, size: 'mid' as const, bold: true }] : []),
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
function TicketCard({ t, item, now, tz, busy, bin, onStep, onCancel, onPrint, onFromHold }: {
  t: KitchenTicket; item?: Item; now: number; tz: string | null; busy: boolean; bin: HoldBin | null;
  onStep: (t: KitchenTicket, s: KitchenStep) => void; onCancel: (t: KitchenTicket) => void; onPrint: (t: KitchenTicket) => void; onFromHold: (t: KitchenTicket, b: HoldBin) => void;
}) {
  const s = secondsSince(t.at, now);
  // A quick-service ticket counts down to the time it has to be ready by; anything else counts up from when it came in.
  const due = t.dueAt && t.status !== 'ready' ? timeLeft(Date.parse(t.dueAt), now) : null;
  const late = due ? due.over : s >= LATE_S, warm = !late && (due ? due.left < 60 : s >= WARM_S);
  const flags = allergyFlags(t);
  const plainNote = t.note && !flags.mentions.includes(t.note) ? t.note : null;
  const quick = !!t.channel;
  return (
    <article className="rounded-2xl bg-[#fff] p-4 space-y-3" style={{ border: `${late ? 2 : 1}px solid ${late ? AMBER : LINE}`, padding: late ? 15 : 16 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium" style={{ color: MUTED }}>
            {t.orderNumber && <span className="rounded-lg px-2 py-0.5 text-[17px] font-semibold tabular-nums" style={t.channel === 'drive-thru' ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{t.orderNumber}</span>}
            <span>{sourceWord(t)} · {clock(t.at, tz)}{t.lines && t.lines > 1 ? ` · ${t.line} of ${t.lines}` : ''}{t.isRedemption ? ' · Member perk' : ''}</span>
          </p>
          <h3 className="text-[22px] font-semibold leading-tight mt-1" style={{ color: INK }}>
            {t.item}{t.quantity > 1 && <span style={{ color: MUTED }}> × {t.quantity}</span>}
          </h3>
          {t.choices && <p className="mt-1 text-[18px] font-semibold leading-snug" style={{ color: INK }}>{t.choices}</p>}
        </div>
        {due
          ? <span className="shrink-0 rounded-full px-3 py-1 text-[15px] font-semibold tabular-nums" style={late ? { background: AMBER, color: '#fff' } : warm ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }} aria-label={due.text}>{due.text}</span>
          : <span className="shrink-0 rounded-full px-3 py-1 text-[15px] font-semibold tabular-nums" style={late ? { background: AMBER, color: '#fff' } : warm ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }} aria-label={`Waiting ${waited(s)}`}>{waited(s)}</span>}
      </div>
      <AllergyBanner t={t} />
      {t.collect > 0 && <p className="rounded-xl px-3 py-2 text-[16px] font-semibold" style={{ background: SOFT, color: INK }}>Collect ${t.collect.toFixed(2)} when it’s handed over</p>}
      {(!quick || t.lookFor || plainNote) && <div className="text-[15px] leading-snug" style={{ color: INK }}>
        {!quick && <p className="font-medium">{t.name}</p>}
        {!quick && <p style={{ color: MUTED }}>{where(t)}</p>}
        {t.lookFor && <p className="mt-1">Look for: {t.lookFor}</p>}
        {t.accessNote && !flags.mentions.includes(t.accessNote) && <p className="mt-1">How to reach them: {t.accessNote}</p>}
        {plainNote && <p className="mt-1" style={{ color: MUTED }}>{plainNote}</p>}
      </div>}
      {item?.formula?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {item.formula.slice(0, 6).map((f, i) => (
            <span key={i} className="rounded-lg px-2 py-1 text-[13px]" style={{ background: SOFT, color: INK }}>{amount(f.quantityUsed * t.quantity)}{f.unit ? ` ${f.unit}` : ''} {f.name}</span>
          ))}
        </div>
      ) : null}
      {t.claimedBy && t.status !== 'pending' && <p className="text-[13px]" style={{ color: MUTED }}>Started by {t.claimedBy.name}</p>}
      {bin && (t.status === 'pending' || t.status === 'in_progress') && (
        <button type="button" disabled={busy} onClick={() => onFromHold(t, bin)} className={`${btn} w-full`} style={{ background: GREEN_TINT, color: GREEN, border: `1px solid #cfe8da` }}>
          Take from holding, {bin.quantity} held
        </button>
      )}
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
        {!quick && <button type="button" disabled={busy} onClick={() => onCancel(t)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: RED }}>Cancel</button>}
      </div>
    </article>
  );
}

// ─── A course or a dish: its tickets in rows, moved along together or one by one ─────────────────────────────────────
function GroupPanel({ g, by, now, busyIds, onStep, onBump }: {
  g: ReturnType<typeof groupTickets>[number]; by: 'course' | 'dish' | 'order'; now: number; busyIds: Set<string>;
  onStep: (t: KitchenTicket, s: KitchenStep) => void; onBump: (list: KitchenTicket[], s: 'ready' | 'deliver') => void;
}) {
  const toReady = g.tickets.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const toServe = g.tickets.filter((t) => t.status === 'ready');
  const withAllergy = g.tickets.filter((t) => allergyFlags(t).any).length;
  const s = secondsSince(g.at, now);
  // An order with a time (drive-thru, counter) counts down to it, the whole order together.
  const dueIso = by === 'order' ? g.tickets.map((t) => t.dueAt).filter(Boolean).sort()[0] : null;
  const due = dueIso && toReady.length ? timeLeft(Date.parse(dueIso), now) : null;
  const late = due ? due.over : s >= LATE_S;
  const anyBusy = g.tickets.some((t) => busyIds.has(t.id));
  // Guests with an allergy first, so they're never at the bottom of a long list.
  const rows = [...g.tickets].sort((a, b) => Number(allergyFlags(b).any) - Number(allergyFlags(a).any));
  return (
    <section className="rounded-2xl bg-[#fff] overflow-hidden" style={{ border: `1px solid ${late ? AMBER : LINE}` }}>
      <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold leading-tight" style={{ color: INK }}>{g.label}{by === 'dish' && <span style={{ color: MUTED }}> × {g.count}</span>}</h2>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            {by === 'order' ? `${g.count} ${g.count === 1 ? 'item' : 'items'}` : `${g.tickets.length} ${g.tickets.length === 1 ? 'ticket' : 'tickets'}`} · {due ? <b className="font-semibold tabular-nums" style={{ color: due.over ? AMBER : INK }}>{due.text}</b> : `oldest ${waited(s)}`}
            {withAllergy > 0 && <span style={{ color: AMBER }} className="font-semibold"> · {withAllergy} with {withAllergy === 1 ? 'an allergy' : 'allergies'}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {toReady.length > 0 && <button type="button" disabled={anyBusy} onClick={() => onBump(toReady, 'ready')} className={btn} style={{ background: GREEN, color: '#fff' }}>{toReady.length === 1 ? 'Ready' : `All ${toReady.length} ready`}</button>}
          {toServe.length > 0 && <button type="button" disabled={anyBusy} onClick={() => onBump(toServe, 'deliver')} className={btn} style={{ background: INK, color: '#fff' }}>{by === 'order' && !toReady.length && g.tickets.some((t) => t.channel) ? 'Bagged and out' : toServe.length === 1 ? 'Served' : `Serve the ${toServe.length} ready`}</button>}
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
                    {by === 'order' ? <>{t.item}{t.quantity > 1 ? ` × ${t.quantity}` : ''}</> : by === 'course' ? <>{t.item}{t.quantity > 1 ? ` × ${t.quantity}` : ''}<span style={{ color: MUTED }}> · {t.name}</span></> : <>{t.name}{t.quantity > 1 ? ` × ${t.quantity}` : ''}</>}
                  </p>
                  {t.choices && <p className="text-[15px] font-semibold" style={{ color: INK }}>{t.choices}</p>}
                  <p className="text-[13.5px]" style={{ color: MUTED }}>{by === 'order' ? '' : `${where(t)} · `}{t.status === 'pending' ? 'Waiting' : t.status === 'in_progress' ? 'Being made' : 'Ready'}{t.note && !allergyFlags(t).mentions.includes(t.note) ? ` · ${t.note}` : ''}</p>
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

// ─── Sold out: an item, or one of its choices, off every menu in one tap (lib/menu-server) ──────────────────────────
function SoldOutSheet({ post, onClose }: { post: (body: any) => Promise<{ status: number; d: any }>; onClose: () => void }) {
  const [menu, setMenu] = useState<MenuItem[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const gen = useRef(0);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement | null>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    // Read again every 20 seconds while it's open, so a switch flipped on another screen (or the morning's reset) shows here.
    // A read that left before a switch was flipped is dropped, so it can never flip the switch back on screen.
    const load = () => { const g = gen.current; void post({ action: 'menu' }).then(({ d }) => { if (g !== gen.current) return; if (d.ok) { setMenu(d.menu); setErr(''); } else setErr(d.error || 'The menu didn’t load.'); }, () => undefined); };
    load(); const t = setInterval(load, 20000); return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input, button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const flip = async (m: MenuItem, out: boolean, groupId?: string, optionId?: string) => {
    const k = `${m.id}${groupId || ''}${optionId || ''}`; setBusy(k); setErr(''); gen.current++;
    const { d } = await post({ action: 'soldout', itemId: m.id, groupId, optionId, out }).catch(() => ({ d: { ok: false, error: 'No connection. Try again.' } as any }));
    gen.current++; setBusy(null);
    if (d.ok) setMenu((cur) => (cur ? cur.map((x) => (x.id === m.id ? d.item : x)) : cur)); else setErr(d.error || 'That didn’t go through.');
  };
  const sw = (on: boolean, label: string, k: string, go: () => void) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy === k} onClick={go}
      className="flex h-11 w-16 shrink-0 items-center justify-center rounded-full disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]">
      <span aria-hidden className="relative h-8 w-14 rounded-full" style={{ background: on ? AMBER : '#d4d6da' }}>
        <span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] shadow" style={{ left: on ? 28 : 4 }} />
      </span>
    </button>);
  const list = (menu || []).filter((m) => m.onMenu && (!q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="sold-title" className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="sold-title" className="text-[20px] font-semibold" style={{ color: INK }}>Sold out</h2><p className="text-[14px] mt-1" style={{ color: MUTED }}>Off every menu straight away. Switch it back when there’s more.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border text-[20px]" style={{ borderColor: LINE, color: INK }}>×</button>
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
        {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {!menu ? <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Loading the menu…</p>
          : list.length === 0 ? <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Nothing on the menu{q ? ' by that name' : ''}.</p>
          : <ul className="space-y-2">{list.map((m) => (
            <li key={m.id} className="rounded-2xl p-3" style={{ background: m.soldOut ? AMBER_TINT : SOFT }}>
              <div className="flex min-h-[44px] items-center justify-between gap-3">
                <span className="text-[16px] font-semibold" style={{ color: m.soldOut ? AMBER : INK }}>{m.name}{m.soldOut ? ', sold out' : ''}</span>
                {sw(m.soldOut, `${m.name} sold out`, m.id, () => flip(m, !m.soldOut))}
              </div>
              {!m.soldOut && m.choices.map((g) => (
                <div key={g.id} className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[13px]" style={{ color: MUTED }}>{g.name}:</span>
                  {g.options.map((o) => (
                    <button key={o.id} type="button" aria-pressed={o.soldOut} disabled={busy === `${m.id}${g.id}${o.id}`} onClick={() => flip(m, !o.soldOut, g.id, o.id)}
                      className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium disabled:opacity-50" style={o.soldOut ? { background: AMBER, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}
                      aria-label={`${o.name}${o.soldOut ? ' is sold out. Tap when it’s back' : '. Tap if it’s sold out'}`}>{o.name}{o.soldOut ? ', out' : ''}</button>))}
                </div>))}
            </li>))}</ul>}
      </div>
    </div>
  );
}

// ─── Holding: batches cooked ahead, each with the time it has left (lib/holding) ─────────────────────────────────────
function HoldingStrip({ holds, holdable, tossedToday, now, busy, onHold, onUse, onToss }: {
  holds: HoldBin[]; holdable: Holdable[]; tossedToday: number; now: number; busy: string | null;
  onHold: (h: Holdable) => void; onUse: (b: HoldBin) => void; onToss: (b: HoldBin) => void;
}) {
  return (
    <section aria-label="Holding" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-[16px] font-semibold" style={{ color: INK }}>Holding</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>{tossedToday > 0 ? `${tossedToday} thrown out today` : 'Nothing thrown out today'}</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {holds.map((b) => {
          const st = binState(b, now); const expired = st.state === 'expired'; const soon = st.state === 'soon';
          return (
            <article key={b.id} className="w-[236px] shrink-0 space-y-2.5 rounded-2xl p-3.5" style={{ background: expired ? AMBER : '#fff', color: expired ? '#fff' : INK, border: `1px solid ${expired ? AMBER : soon ? '#f3d9b8' : LINE}` }} aria-label={`${b.name}: ${b.quantity} held, ${st.text}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[16px] font-semibold">{b.name}</p>
                <p className="text-[26px] font-semibold leading-none tabular-nums">{b.quantity}</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: expired ? 'rgba(255,255,255,0.3)' : SOFT }} aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.round(st.share * 100)}%`, background: soon ? AMBER : GREEN, transition: 'width 1s linear' }} />
              </div>
              <p className="text-[14px] font-semibold tabular-nums" style={{ color: expired ? '#fff' : soon ? AMBER : MUTED }}>{expired ? 'Past its time. Throw it out.' : st.text}</p>
              <div className="flex gap-2">
                {!expired && <button type="button" disabled={busy === b.id} onClick={() => onUse(b)} className={`${btn} flex-1 whitespace-nowrap px-2`} style={quiet}>Use 1</button>}
                <button type="button" disabled={busy === b.id} onClick={() => onToss(b)} className={`${btn} flex-1 whitespace-nowrap px-2`} style={expired ? { background: '#fff', color: AMBER } : { background: '#fff', border: `1px solid ${LINE}`, color: RED }}>Throw out</button>
              </div>
            </article>
          );
        })}
        {holdable.map((h) => (
          <button key={h.id} type="button" disabled={busy === `hold-${h.id}`} onClick={() => onHold(h)} className="flex min-h-[44px] w-[160px] shrink-0 flex-col items-start justify-center gap-1 rounded-2xl px-3.5 py-3 text-left disabled:opacity-50" style={{ border: '1px dashed #c9cbd0', background: 'transparent', color: INK }}
            aria-label={`Start a batch of ${h.batchSize} ${h.name}, held ${h.holdMinutes} minutes`}>
            <span className="text-[15px] font-semibold">+ {h.name}</span>
            <span className="text-[13px]" style={{ color: MUTED }}>Batch of {h.batchSize}, {h.holdMinutes} min</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── Setting the screen up ───────────────────────────────────────────────────────────────────────────────────────────
function Setup({ tenantId, stopped, closed, onPaired }: { tenantId: string; stopped: string; closed: string; onPaired: (key: string) => void }) {
  const { user, isUserLoading } = useFirebase() as any;
  const [name, setName] = useState('Kitchen'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [screens, setScreens] = useState<{ id: string; name: string; lastSeenAt: string | null; createdBy: string | null }[] | null>(null);
  const call = async (body: any) => { const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }); return r.json().catch(() => ({})); };
  // A manager signed in here sees the screens already set up, to stop one that's lost or no longer used.
  const [maker, setMaker] = useState<'kitchen' | 'desk' | null>(null);
  useEffect(() => { if (!user) return; call({ action: 'screens' }).then((d) => { setScreens(d.ok ? d.screens || [] : null); if (d.ok) setMaker(d.maker === 'kitchen' ? 'kitchen' : 'desk'); }, () => setScreens(null)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickMaker = async (to: 'kitchen' | 'desk') => { const was = maker; setMaker(to); const d = await call({ action: 'maker', maker: to }).catch(() => ({})); if (!d.ok) { setMaker(was); setErr(d.error || 'That didn’t save. Try again.'); } };
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
            {maker && (
              <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
                <p className="text-[14px] font-medium">Who makes the lounge’s drinks and extras?</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who makes lounge orders">
                  {([['kitchen', 'The kitchen screen'], ['desk', 'The front desk']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={maker === v} onClick={() => pickMaker(v)} className="min-h-[44px] px-3 rounded-xl text-[14px]" style={maker === v ? { border: `2px solid ${INK}`, fontWeight: 600, color: INK, background: '#fff' } : { border: `1px solid ${LINE}`, color: INK, background: '#fff' }}>{label}</button>
                  ))}
                </div>
                <p className="text-[13px]" style={{ color: MUTED }}>One or the other, so an order is never made twice. Ready orders show on the desk either way, to carry out.</p>
              </div>
            )}
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
  // Which station this screen is for (lib/table-service): '' shows every station's tickets. Kept on this tablet.
  const [station, setStation] = useState('');
  const [eventId, setEventId] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [audioOk, setAudioOk] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [cancelFor, setCancelFor] = useState<KitchenTicket | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const [holdBusy, setHoldBusy] = useState<string | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);
  const acted = useRef(0);   // bumped on every tap, so a refresh that left before it can't put the old state back

  // What this tablet remembers: its key, the view, sound, and who's working (this browser tab only).
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const v = read('cf.kitchen.view'); if (v === 'course' || v === 'dish' || v === 'lanes' || v === 'order' || v === 'expo') setView(v);
    const st = read('cf.kitchen.station'); if (st) setStation(st);
    if (read('cf.kitchen.sound') === 'off') setSoundOn(false);
    try { const s = JSON.parse(sessionStorage.getItem('cf.kitchen.staff') || 'null'); if (s?.name && s?.pass) setStaff(s); } catch { /* */ }
    try { const e = new URLSearchParams(window.location.search).get('event'); if (e && /^[A-Za-z0-9_-]{1,160}$/.test(e)) setEventId(e); } catch { /* */ }
    setReady(true);
  }, [tenantId]);
  const [skew, setSkew] = useState(0);
  useEffect(() => { const i = setInterval(() => setNow(Date.now() + skew), 1000); return () => clearInterval(i); }, [skew]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); }, [notice]);

  // Sound needs one tap on the screen before a browser lets it play.
  // An iPad starts sound only from a real tap (a click or the end of a touch), so those are what unlock it.
  const unlock = useCallback(() => {
    try {
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      if (!audio.current) audio.current = new AC();
      const ctx = audio.current!;
      if (ctx.state !== 'running') ctx.resume().then(() => setAudioOk(ctx.state === 'running'), () => setAudioOk(false)); else setAudioOk(true);
    } catch { /* no sound on this device */ }
  }, []);
  useEffect(() => {
    const h = () => unlock(); const evs = ['click', 'touchend', 'keydown'];
    for (const e of evs) window.addEventListener(e, h, { passive: true });
    return () => { for (const e of evs) window.removeEventListener(e, h); };
  }, [unlock]);

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
      const next: Data = { screen: d.screen, business: d.business, tickets: d.tickets || [], items: d.items || {}, today: d.today || [], holds: d.holds || [], holdable: d.holdable || [], tossedToday: Number(d.tossedToday) || 0 };
      // The server's clock, not the tablet's: countdowns and holding times are never off because a tablet's clock is.
      if (d.now && Number.isFinite(Date.parse(d.now))) setSkew(Date.parse(d.now) - Date.now());
      // A sound for every ticket not seen before (the first one after a quiet spell too), never for what was already up.
      // (An order placed ahead for later rings once it's time to start, not when it comes in: only what's showing counts.)
      const srvNow = d.now && Number.isFinite(Date.parse(d.now)) ? Date.parse(d.now) : Date.now();
      const showing = next.tickets.filter((t) => !(t.status === 'pending' && t.holdUntil && Date.parse(t.holdUntil) > srvNow));
      const ids = showing.map((t) => `${t.col}/${t.id}`);
      if (seen.current) {
        const fresh = showing.filter((t) => t.status === 'pending' && !seen.current!.has(`${t.col}/${t.id}`));
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
  const after: Record<KitchenStep, string> = { claim: 'in_progress', release: 'pending', ready: 'ready', carry: 'ready', drop: 'ready', deliver: 'delivered', cancel: 'cancelled' };

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

  // Orders placed ahead for later wait under Later until it's time to start (or the guest says they're here).
  // A station's screen shows what that station makes; expo sees the whole pass.
  const stations = data?.stations || [];
  const myStation = station && stations.includes(station) ? station : '';
  const allTickets = (data?.tickets || []).filter((t) => view === 'expo' || !myStation || t.madeAt === myStation);
  const comingHere = (data?.unfired || []).filter((t) => !myStation || t.madeAt === myStation);
  const pickStation = (v: string) => { setStation(v); write('cf.kitchen.station', v || null); };
  const isHeld = (t: KitchenTicket) => t.status === 'pending' && !!t.holdUntil && Date.parse(t.holdUntil) > now;
  // (Worked out again only when one starts waiting or stops, not every second.)
  const heldKey = allTickets.filter(isHeld).map((t) => t.id).join('|');
  const tickets = useMemo(() => allTickets.filter((t) => !isHeld(t)), [allTickets, heldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const later = useMemo(() => {
    const by = new Map<string, { number: string; who: string | null; start: number; due: number | null; count: number }>();
    for (const t of allTickets) {
      if (!isHeld(t)) continue;
      const k = t.orderId || t.id; const cur = by.get(k);
      by.set(k, { number: t.orderNumber || '', who: t.name && t.name !== 'Guest' ? t.name : null, start: Date.parse(t.holdUntil!), due: t.dueAt ? Date.parse(t.dueAt) : null, count: (cur?.count || 0) + t.quantity });
    }
    return Array.from(by.values()).sort((a, b) => a.start - b.start);
  }, [allTickets, heldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byTime = (a: KitchenTicket, b: KitchenTicket) => String(a.at).localeCompare(String(b.at));
  // What to make next: drive-thru first, then whatever is due soonest (lib/kitchen kitchenOrder).
  const lanes = useMemo(() => ({
    waiting: tickets.filter((t) => t.status === 'pending').sort(kitchenOrder),
    making: tickets.filter((t) => t.status === 'in_progress').sort(kitchenOrder),
    ready: tickets.filter((t) => t.status === 'ready').sort(byTime),
  }), [tickets]);
  const groups = useMemo(() => view === 'lanes' || view === 'expo' ? [] : groupTickets(tickets, view), [tickets, view]);
  const lateCount = tickets.filter((t) => t.status !== 'ready' && t.dueAt && Date.parse(t.dueAt) < now).length;
  const holdCall = async (k: string, body: any) => {
    acted.current++; setHoldBusy(k);
    try {
      const { status, d } = await post({ ...body, ...(staff ? { staffPass: staff.pass } : {}) });
      if (status === 401) { forgetHere(d.error || 'This screen was stopped.'); return null; }
      if (d.staffOk === false) staffGone();
      if (!d.ok) setNotice(d.error || 'That didn’t go through. Try again.');
      return d;
    } catch { setNotice('No connection. Try again.'); return null; }
    finally { acted.current++; setHoldBusy(null); load(); }
  };
  const startHold = (h: Holdable) => { void holdCall(`hold-${h.id}`, { action: 'hold', itemId: h.id }); };
  const holdStep = (b: HoldBin, action: 'holdUse' | 'holdToss') => { void holdCall(b.id, { action, binId: b.id, quantity: 1 }); };
  const fromHold = async (t: KitchenTicket, b: HoldBin) => {
    setBusy([t.id], true);
    const d = await holdCall(b.id, { action: 'fromHold', col: t.col, id: t.id, binId: b.id });
    setBusy([t.id], false);
    if (d?.ok && !d.already) local([t], 'ready');
  };
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
        : list.map((t) => <TicketCard key={`${t.col}/${t.id}`} t={t} item={t.itemId ? data?.items[String(t.itemId)] : undefined} now={now} tz={tz} busy={busyIds.has(t.id)} bin={binFor(data?.holds || [], t.itemId ? String(t.itemId) : null, t.quantity, now)} onStep={step} onCancel={setCancelFor} onPrint={print} onFromHold={fromHold} />)}
    </section>
  );

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: SOFT, color: INK }}>
      <header className="bg-white px-4 sm:px-6 py-3 space-y-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight truncate">{data?.business.name || 'Kitchen'}</h1>
            <p className="text-[13.5px]" style={{ color: MUTED }}>{view === 'expo' ? 'Expo, every station' : myStation || data?.screen || 'Kitchen screen'}, {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} up</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl p-1" style={{ background: SOFT }} role="tablist" aria-label="How tickets are shown">
              {([['lanes', 'Lanes'], ['order', 'By order'], ['course', 'By course'], ['dish', 'By dish'], ['expo', 'Expo']] as [View, string][]).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pickView(v)} className="min-h-[44px] px-3 rounded-lg text-[14px] font-medium" style={view === v ? { background: '#fff', color: INK, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: MUTED }}>{label}</button>
              ))}
            </div>
            {staff
              ? <span className="inline-flex items-center gap-2 rounded-xl pl-3 bg-white" style={{ border: `1px solid ${LINE}` }}><span className="text-[14px]">Working: <b className="font-semibold">{staff.name.split(' ')[0]}</b></span><button type="button" onClick={() => pickStaff(null)} className="min-h-[42px] px-3 rounded-xl text-[14px] font-semibold" style={{ color: MUTED }}>Done</button></span>
              : <button type="button" onClick={() => setPinOpen(true)} className={btn} style={quiet}>Who’s working?</button>}
            {stations.length > 1 && view !== 'expo' && (
              <select value={myStation} onChange={(e) => pickStation(e.target.value)} aria-label="Which station this screen is for" className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold bg-[#fff]" style={{ border: `1px solid ${LINE}`, color: INK }}>
                <option value="">Every station</option>
                {stations.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setSoldOpen(true)} className={btn} style={quiet}>Sold out</button>
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
          {lateCount > 0 && <span style={{ color: AMBER }}>Past their time <b className="font-semibold tabular-nums">{lateCount}</b></span>}
          {later.length > 0 && <span>Later {later.slice(0, 4).map((l, i) => <b key={i} className="ml-1.5 font-semibold" style={{ color: INK }}>{l.number}{l.who ? ` · ${l.who}` : ''} starts {new Date(l.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{i < Math.min(later.length, 4) - 1 ? ',' : ''}</b>)}{later.length > 4 ? ` and ${later.length - 4} more` : ''}</span>}
          {view !== 'expo' && comingHere.length > 0 && <span>Held for later <b className="font-semibold tabular-nums" style={{ color: INK }}>{comingHere.length}</b></span>}
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
          <div className="space-y-4">
            {(data.holds.length > 0 || data.holdable.length > 0) && <HoldingStrip holds={data.holds} holdable={data.holdable} tossedToday={data.tossedToday} now={now} busy={holdBusy} onHold={startHold} onUse={(b) => holdStep(b, 'holdUse')} onToss={(b) => holdStep(b, 'holdToss')} />}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              {lane('Waiting', lanes.waiting, 'Nothing waiting.')}
              {lane('Being made', lanes.making, 'Nothing being made.')}
              {lane('Ready to go out', lanes.ready, 'Nothing ready yet.')}
            </div>
          </div>
        ) : view === 'expo' ? (
          <ExpoView tickets={tickets} unfired={data.unfired || []} now={now} busyIds={busyIds} onBump={bump} />
        ) : groups.length === 0 ? (
          <p className="rounded-2xl px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>No tickets up.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {groups.map((g) => <GroupPanel key={g.key} g={g} by={view as 'course' | 'dish' | 'order'} now={now} busyIds={busyIds} onStep={step} onBump={bump} />)}
          </div>
        )}
      </main>

      {soundOn && !audioOk && (
        // Floats over the screen, so it going away after the first tap never moves a button under someone's finger.
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-full px-5 py-3 text-[15px] font-medium pointer-events-none" style={{ background: INK, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxWidth: 'calc(100vw - 32px)' }} role="status">Tap anywhere to turn on the sound for new tickets</div>
      )}
      {pinOpen && <SharedPinPad check={checkPin} onDone={(s) => { pickStaff(s); setPinOpen(false); }} onClose={() => setPinOpen(false)} line="Your PIN puts your name on the tickets you move. The screen works without it." />}
      {soldOpen && <SoldOutSheet post={(body) => post({ ...body, ...(staff ? { staffPass: staff.pass } : {}) })} onClose={() => setSoldOpen(false)} />}
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
