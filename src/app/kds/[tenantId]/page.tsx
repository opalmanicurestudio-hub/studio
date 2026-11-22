'use client';
// src/app/kds/[tenantId]/page.tsx — THE KITCHEN SCREEN. Every ticket the kitchen makes, in one place: lounge orders,
// event courses, table tabs and café sales at the desk (lib/kitchen). It runs on a tablet with nobody signed in: a
// manager sets it up once (api/kitchen 'pair'), and from then on the tablet carries its own key and reads and moves
// tickets through api/kitchen. It never locks; a PIN (checked by the server) only puts a name on what someone did.
//   Lanes: waiting, being made, ready. By course or by dish: a whole course or dish moved along at once.
//   Allergies are shown big on every ticket, including ones only typed into a note (lib/kitchen allergyFlags). A kitchen
//   ticket with one needs "Allergy noted" before it can be marked ready or served (checked by the server too).
//   Counts (lib/dish-counts): counted dishes show what's left tonight; the kitchen sets tonight's number under Counts.
//   Finishing together (lib/table-service startPlan): a quicker dish in a table's course, or a counter order, says when
//   to start it so it's done with the slowest one, and waits below what to start now.
//   A sound plays for every new ticket, the first one too, once the screen has been tapped (browsers need a tap).
//   ?event=<id> shows one event's tickets (linked from the event screen).
//   Drive-thru and counter orders carry a time they must be ready by: they're worked first (drive-thru on top), each
//   ticket counts down to its time, and "By order" keeps an order's items together for bagging.
//   Holding (lib/holding): batches cooked ahead show along the top with how long each has left; a ticket for something
//   held is made from the batch in one tap, and a batch past its time says to throw it out. Cook ahead (lib/cook-ahead;
//   design board "Cook ahead"): before them, how many batches to start and by when, from a usual day like today and
//   what's held now; Start a batch is the same tap as the + after them.
//   Through a Wi-Fi drop (lib/outbox, lib/last-seen; design canvas "When the Wi-Fi drops"): the tickets it last had, with
//   their time; Start, Ready, Served and Allergy noted are kept on the tablet and sent when the connection's back (a
//   ticket shows "Sends when it’s back" meanwhile). Cancelling needs the connection.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getAuth, signOut } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { allergyFlags, groupTickets, kitchenOrder, needsAllergyNote, type KitchenTicket, type KitchenStep } from '@/lib/kitchen';
import { leftWords, lowCount, MAX_COUNT, type CountRow } from '@/lib/dish-counts';
import { allergySig } from '@/lib/allergens';
import { startPlan, startWords, type StartAt } from '@/lib/table-service';
import { binFor, binState, type HoldBin } from '@/lib/holding';
import { timeLeft } from '@/lib/counter-orders';
import { PinPad as SharedPinPad } from '@/components/kitchen/PinPad';
import { ExpoView } from '@/components/kitchen/ExpoView';
import { ClosingSheet } from '@/components/kitchen/ClosingSheet';
import { SafetySheet } from '@/components/kitchen/SafetySheet';
import { CallSheet, CallStrip } from '@/components/kitchen/CallSheet';
import { FloorNoteSheet } from '@/components/kitchen/FloorNoteSheet';
import { tableLabel } from '@/lib/table-service';
import type { Call } from '@/lib/back-calls';
import { esc, PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import { renderHtml, ticketDoc } from '@/lib/printing';
import { flush, keptNow, noteNetwork, send, type Kept } from '@/lib/outbox';
import { keepLast, lastOf } from '@/lib/last-seen';
import { ConnectionBar } from '@/components/shared/ConnectionBar';
import { useKeepPage } from '@/components/pwa/keep-page';
import { LangToggle, ScreenLangProvider, useT } from '@/components/kitchen/ScreenLang';
import { tr } from '@/lib/screen-lang';
import type { MenuItem } from '@/lib/menu-server';

/** Signed in on a device with no screen key: the location picked in the app (lib/here-server), with more than one. */
const hereAsked = () => { try { const v = localStorage.getItem('selectedLocationId'); return v ? { locationId: v } : {}; } catch { return {}; } };
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const AMBER_TINT = '#fff7ed', GREEN_TINT = '#ecf6f0';
const POLL_MS = 4000;
const WARM_S = 5 * 60, LATE_S = 8 * 60;

type View = 'lanes' | 'order' | 'course' | 'dish' | 'expo';
type Holdable = { id: string; name: string; holdMinutes: number; batchSize: number };
/** Cook ahead (lib/cook-ahead-server): batches to start, by when (null: now), and the usual stretch it's for. */
// What's being said at a drive-thru speaker before it's sent (lib/lane-entry): only shown.
type Early = { orderId: string; number: string; lane: 1 | 2 | null; since: string; lines: { name: string; quantity: number; choicesText: string | null; itemId: string; madeAt?: string }[] };
type Cook = { itemId: string; name: string; batches: number; batchSize: number; by: string | null; need: number; from: string; to: string; held: number; weekday: string };
type Item = { id: string; name: string; imageUrl: string | null; unit: string | null; formula: { id: string; name: string; quantityUsed: number; unit: string }[] };
type Today = { status: string; at: string; deliveredAt: string | null; item: string };
type Data = { screen: string; business: { name: string; timeZone: string | null }; pace?: { behindMin: number; level: string } | null; tickets: KitchenTicket[]; unfired?: KitchenTicket[]; early?: Early[]; stations?: string[]; items: Record<string, Item>; today: Today[]; holds: HoldBin[]; holdable: Holdable[]; tossedToday: number; cook?: Cook[]; counts: CountRow[]; finishTogether?: boolean;
  /** The printers that print tickets, and whether each is answering (lib/printing-server). */
  printers?: { name: string; stations: string[]; ok: boolean; words: string }[] };
type Staff = { id: string; name: string; pass: string };

const keyName = (t: string) => `cf.kitchen.${t}`;
// A tap kept on the tablet with no connection (lib/outbox), as the screen shows it until it's sent.
const STEP_AFTER: Record<KitchenStep, string> = { claim: 'in_progress', release: 'pending', ready: 'ready', carry: 'ready', drop: 'ready', deliver: 'delivered', cancel: 'cancelled' };
const STEP_WORD: Record<KitchenStep, string> = { claim: 'start', release: 'not started', ready: 'ready', carry: 'ready', drop: 'ready', deliver: 'served', cancel: 'cancel' };
const LIVE_STATUS = ['pending', 'in_progress', 'ready'];
function withKept(tickets: KitchenTicket[], kept: Kept[], tenantId: string): KitchenTicket[] {
  let out = tickets;
  for (const k of kept) {
    if (k.url !== '/api/kitchen' || k.tenantId !== tenantId) continue;
    const b = k.body || {};
    const ids: { col: string; id: string }[] = b.action === 'bump' ? (Array.isArray(b.tickets) ? b.tickets : []) : [{ col: b.col, id: b.id }];
    const hit = (t: KitchenTicket) => ids.some((x) => x.id === t.id && x.col === t.col);
    if (b.action === 'act' || b.action === 'bump') { const st = STEP_AFTER[b.step as KitchenStep]; if (st) out = out.map((t) => (hit(t) ? ({ ...t, status: st, keptHere: true } as any) : t)); }
    if (b.action === 'allergyNoted') out = out.map((t) => (hit(t) ? ({ ...t, allergyNotedAt: k.at, keptHere: true } as any) : t));
  }
  return out.filter((t) => LIVE_STATUS.includes(t.status));
}
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

const secondsSince = (iso: string, now: number) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : 0; };
const waited = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
const clock = (iso: string, tz: string | null) => { const d = new Date(iso); if (isNaN(d.getTime())) return ''; try { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(' AM', 'am').replace(' PM', 'pm'); } catch { return ''; } };
const amount = (n: number) => String(Math.round(n * 10) / 10);
// The screen's words in its language (components/kitchen/ScreenLang); printing and anything outside a screen use English.
type Say = (en: string, vars?: Record<string, string | number>) => string;
const plain: Say = (en, vars) => tr('en', en, vars);
const where = (t: KitchenTicket, say: Say = plain) => t.source === 'event' ? `${t.eventTitle || say('Event')}${t.courseNumber !== null ? `, ${say('course {n}', { n: t.courseNumber })}` : ''}${t.tableNumber ? `, ${say('table {n}', { n: t.tableNumber })}` : ''}${t.seatNumber ? `, ${say('seat {n}', { n: t.seatNumber })}` : ''}` : say(t.station);
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

// A page printed from a hidden frame (no new window, so nothing is held back as a pop-up). One after another.
let frameQueue: Promise<void> = Promise.resolve();
function printFrame(html: string) {
  frameQueue = frameQueue.then(() => new Promise<void>((done) => {
    const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    const w = f.contentWindow; if (!w) { f.remove(); done(); return; }
    w.document.open(); w.document.write(html); w.document.close();
    const go = () => { try { w.focus(); w.print(); } catch { /* the tablet can't print */ } setTimeout(() => { f.remove(); done(); }, 1500); };
    const fonts = (w.document as any).fonts; if (fonts?.ready) fonts.ready.then(go, go); else setTimeout(go, 300);
  }));
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
  const say = useT();
  const f = allergyFlags(t);
  if (!f.any) return null;
  const strong = f.severe;
  return (
    <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: strong ? AMBER : AMBER_TINT, color: strong ? '#fff' : AMBER, border: `1px solid ${strong ? AMBER : '#f3d9b8'}` }} role="note" aria-label={say('Allergy')}>
      {f.listed.length > 0 && (
        <p className={compact ? 'text-[15px] font-semibold leading-snug' : 'text-[18px] font-semibold leading-snug'}>
          {strong ? `${say('Severe allergy:')} ` : `${say('Allergy:')} `}{f.listed.map((a) => `${say(a.name)}${a.severe && f.listed.length > 1 ? ` ${say('(severe)')}` : ''}`).join(', ')}
        </p>
      )}
      {f.mentions.map((m, i) => (
        <p key={i} className={compact ? 'text-[14px] font-medium leading-snug' : 'text-[15px] font-medium leading-snug'}>{f.listed.length ? `${say('Their note:')} ` : `${say('Allergy in their note:')} `}{m}</p>
      ))}
      {t.contains.length > 0 && <p className={compact ? 'text-[14px] font-semibold leading-snug' : 'text-[15px] font-semibold leading-snug'}>{say('The menu lists {what} in this dish.', { what: t.contains.map((x) => say(x)).join(', ').toLowerCase() })}</p>}
      {t.allergyNotedAt && <p className="text-[13.5px] font-medium leading-snug">{t.allergyNotedBy ? say('Allergy noted by {name}', { name: t.allergyNotedBy }) : say('Allergy noted')}</p>}
    </div>
  );
}

// ─── One ticket, in a lane ───────────────────────────────────────────────────────────────────────────────────────────
function TicketCard({ t, item, now, tz, busy, bin, start, onStep, onCancel, onPrint, onFromHold, onNote }: {
  t: KitchenTicket; item?: Item; now: number; tz: string | null; busy: boolean; bin: HoldBin | null; start?: StartAt;
  onStep: (t: KitchenTicket, s: KitchenStep) => void; onCancel: (t: KitchenTicket) => void; onPrint: (t: KitchenTicket) => void; onFromHold: (t: KitchenTicket, b: HoldBin) => void; onNote: (t: KitchenTicket) => void;
}) {
  const say = useT();
  const mustNote = needsAllergyNote(t);
  // Timed to finish with the slowest dish on its table or order: not started before then.
  const later = !!start && t.status === 'pending' && start.startAt > now;
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
            {t.lane && <span className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold" style={{ background: SOFT, color: INK }}>{say('Lane {n}', { n: t.lane })}</span>}
            {t.windowPlace && t.status !== 'delivered' && <WindowPlace n={t.windowPlace} />}
            <span>{say(sourceWord(t))} · {clock(t.at, tz)}{t.lines && t.lines > 1 ? ` · ${say('{a} of {b}', { a: t.line ?? '', b: t.lines })}` : ''}{t.isRedemption ? ` · ${say('Member perk')}` : ''}</span>
          </p>
          <h3 className="text-[22px] font-semibold leading-tight mt-1" style={{ color: INK }}>
            {t.item}{t.quantity > 1 && <span style={{ color: MUTED }}> × {t.quantity}</span>}
          </h3>
          {t.choices && <p className="mt-1 text-[18px] font-semibold leading-snug" style={{ color: INK }}>{t.choices}</p>}
          {t.alsoAt.length > 0 && <p className="mt-1 text-[14.5px] font-medium" style={{ color: MUTED }}>{t.alsoAt.map((a) => say('Also at {station}: {part}', { station: a.station, part: a.part })).join('. ')}</p>}
          {t.partFor && <p className="mt-1 text-[14.5px] font-medium" style={{ color: MUTED }}>{t.partFrom ? say('For {dish}, from {station}', { dish: t.partFor, station: t.partFrom }) : say('For {dish}', { dish: t.partFor })}</p>}
          {(t as any).keptHere && <p className="mt-2"><span className="rounded-full px-3 py-1 text-[13px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{say('Sends when it’s back')}</span></p>}
        </div>
        {later
          ? <span className="shrink-0 rounded-full px-3 py-1 text-[15px] font-semibold tabular-nums" style={{ background: SOFT, color: MUTED }} aria-label={say('Start {when}', { when: say(startWords(start!.startAt, now)) })}>{say('Start {when}', { when: say(startWords(start!.startAt, now)) })}</span>
          : due
          ? <span className="shrink-0 rounded-full px-3 py-1 text-[15px] font-semibold tabular-nums" style={late ? { background: AMBER, color: '#fff' } : warm ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }} aria-label={say(due.text)}>{say(due.text)}</span>
          : <span className="shrink-0 rounded-full px-3 py-1 text-[15px] font-semibold tabular-nums" style={late ? { background: AMBER, color: '#fff' } : warm ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }} aria-label={say('Waiting {time}', { time: waited(s) })}>{waited(s)}</span>}
      </div>
      <AllergyBanner t={t} />
      {start && t.status === 'pending' && <p className="text-[14px] leading-snug" style={{ color: later ? MUTED : INK }}>{later ? say('So it’s ready with the {dish}.', { dish: start.slowest }) : say('Start now, to be ready with the {dish}.', { dish: start.slowest })}</p>}
      {t.collect > 0 && <p className="rounded-xl px-3 py-2 text-[16px] font-semibold" style={{ background: SOFT, color: INK }}>{say('Collect {amount} when it’s handed over', { amount: `$${t.collect.toFixed(2)}` })}</p>}
      {(!quick || t.lookFor || plainNote) && <div className="text-[15px] leading-snug" style={{ color: INK }}>
        {!quick && <p className="font-medium">{t.name}</p>}
        {!quick && <p style={{ color: MUTED }}>{where(t, say)}</p>}
        {t.lookFor && <p className="mt-1">{say('Look for: {what}', { what: t.lookFor })}</p>}
        {t.accessNote && !flags.mentions.includes(t.accessNote) && <p className="mt-1">{say('How to reach them: {how}', { how: t.accessNote })}</p>}
        {plainNote && <p className="mt-1" style={{ color: MUTED }}>{plainNote}</p>}
      </div>}
      {item?.formula?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {item.formula.slice(0, 6).map((f, i) => (
            <span key={i} className="rounded-lg px-2 py-1 text-[13px]" style={{ background: SOFT, color: INK }}>{amount(f.quantityUsed * t.quantity)}{f.unit ? ` ${f.unit}` : ''} {f.name}</span>
          ))}
        </div>
      ) : null}
      {t.claimedBy && t.status !== 'pending' && <p className="text-[13px]" style={{ color: MUTED }}>{say('Started by {name}', { name: t.claimedBy.name })}</p>}
      {mustNote && (
        <button type="button" disabled={busy} onClick={() => onNote(t)} className={`${btn} w-full`} style={{ background: AMBER, color: '#fff' }}>{say('Allergy noted')}</button>
      )}
      {bin && !mustNote && (t.status === 'pending' || t.status === 'in_progress') && (
        <button type="button" disabled={busy} onClick={() => onFromHold(t, bin)} className={`${btn} w-full`} style={{ background: GREEN_TINT, color: GREEN, border: `1px solid #cfe8da` }}>
          {say('Take from holding, {n} held', { n: bin.quantity })}
        </button>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {t.status === 'pending' && <>
          <button type="button" disabled={busy} onClick={() => onStep(t, 'claim')} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{say('Start')}</button>
          {!mustNote && <button type="button" disabled={busy} onClick={() => onStep(t, 'ready')} className={btn} style={quiet}>{say('Ready')}</button>}
        </>}
        {t.status === 'in_progress' && <>
          {!mustNote && <button type="button" disabled={busy} onClick={() => onStep(t, 'ready')} className={`${btn} flex-1`} style={{ background: GREEN, color: '#fff' }}>{say('Ready')}</button>}
          <button type="button" disabled={busy} onClick={() => onStep(t, 'release')} className={btn} style={quiet}>{say('Not started')}</button>
        </>}
        {t.status === 'ready' && !mustNote && (
          <button type="button" disabled={busy} onClick={() => onStep(t, 'deliver')} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{say('Served')}</button>
        )}
        <button type="button" onClick={() => onPrint(t)} className={btn} style={quiet}>{say('Print')}</button>
        {!quick && <button type="button" disabled={busy} onClick={() => onCancel(t)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: RED }}>{say('Cancel')}</button>}
      </div>
    </article>
  );
}

// With two drive-thru lanes that merge: where the car is in the line to the window (lib/drive-lanes), so bags go out in
// that order. The car at the window stands out.
function WindowPlace({ n }: { n: number }) {
  const say = useT();
  const words = n === 1 ? say('Next at the window') : n === 2 ? say('1 car ahead') : say('{n} cars ahead', { n: n - 1 });
  return <span className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold" style={n === 1 ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{words}</span>;
}

// ─── Being ordered: what's said at a drive-thru speaker before it's sent (lib/lane-entry) ─────────────────────────────
// In a rush (or always, as the business sets it), so the grill can start before the order is sent. Only shown: it has no
// buttons, nothing is taken from stock, and it turns into tickets once it's sent; an item taken off goes away.
function BeingOrdered({ rows, now }: { rows: Early[]; now: number }) {
  const say = useT();
  const for_ = (iso: string) => { const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return (
    <section aria-labelledby="being-ordered" className="mb-4 rounded-2xl bg-[#fff] p-3" style={{ border: `1.5px dashed #c9cbd0` }}>
      <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
        <h2 id="being-ordered" className="text-[16px] font-semibold" style={{ color: INK }}>{say('Being ordered')}</h2>
        <span className="text-[13px]" style={{ color: MUTED }}>{say('Not sent yet')}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((e) => (
          <div key={e.orderId} className="space-y-1 rounded-xl px-3 py-2.5" style={{ background: SOFT }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-semibold tabular-nums" style={{ color: INK }}>{e.number}</span>
              {e.lane && <span className="rounded-full bg-[#fff] px-2 py-0.5 text-[12.5px] font-semibold" style={{ color: INK }}>{say('Lane {n}', { n: e.lane })}</span>}
              <span className="ml-auto text-[13px] tabular-nums" style={{ color: MUTED }}>{say('Ordering, {t}', { t: for_(e.since) })}</span>
            </div>
            {e.lines.map((l, i) => (
              <p key={i} className="text-[15px] leading-snug" style={{ color: INK }}>{l.quantity > 1 ? `${l.quantity} × ` : ''}{l.name}{l.choicesText && <span style={{ color: MUTED }}>, {l.choicesText}</span>}</p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── A course or a dish: its tickets in rows, moved along together or one by one ─────────────────────────────────────
function GroupPanel({ g, by, now, busyIds, plan, onStep, onBump, onNote }: {
  g: ReturnType<typeof groupTickets>[number]; by: 'course' | 'dish' | 'order'; now: number; busyIds: Set<string>; plan: Map<string, StartAt>;
  onStep: (t: KitchenTicket, s: KitchenStep) => void; onBump: (list: KitchenTicket[], s: 'ready' | 'deliver') => void; onNote: (t: KitchenTicket) => void;
}) {
  const say = useT();
  // A plate with an allergy nobody has noted yet stays out of "All ready" until someone has.
  const unnoted = g.tickets.filter((t) => (t.status === 'pending' || t.status === 'in_progress' || t.status === 'ready') && needsAllergyNote(t));
  const toReady = g.tickets.filter((t) => (t.status === 'pending' || t.status === 'in_progress') && !needsAllergyNote(t));
  const toServe = g.tickets.filter((t) => t.status === 'ready' && !needsAllergyNote(t));
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
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold leading-tight" style={{ color: INK }}>{by === 'dish' ? g.label : say(g.label)}{by === 'dish' && <span style={{ color: MUTED }}> × {g.count}</span>}</h2>
            {by === 'order' && g.tickets[0]?.lane && <span className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold" style={{ background: SOFT, color: INK }}>{say('Lane {n}', { n: g.tickets[0].lane })}</span>}
            {by === 'order' && g.tickets[0]?.windowPlace && toReady.length + toServe.length > 0 && <WindowPlace n={g.tickets[0].windowPlace} />}
          </div>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            {by === 'order' ? say(g.count === 1 ? '{n} item' : '{n} items', { n: g.count }) : say(g.tickets.length === 1 ? '{n} ticket' : '{n} tickets', { n: g.tickets.length })} · {due ? <b className="font-semibold tabular-nums" style={{ color: due.over ? AMBER : INK }}>{say(due.text)}</b> : say('oldest {time}', { time: waited(s) })}
            {withAllergy > 0 && <span style={{ color: AMBER }} className="font-semibold"> · {say(withAllergy === 1 ? '{n} with an allergy' : '{n} with allergies', { n: withAllergy })}{unnoted.length ? `, ${say('{n} to note', { n: unnoted.length })}` : ''}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {toReady.length > 0 && <button type="button" disabled={anyBusy} onClick={() => onBump(toReady, 'ready')} className={btn} style={{ background: GREEN, color: '#fff' }}>{unnoted.length ? say('Mark {n} ready', { n: toReady.length }) : toReady.length === 1 ? say('Ready') : say('All {n} ready', { n: toReady.length })}</button>}
          {toServe.length > 0 && <button type="button" disabled={anyBusy} onClick={() => onBump(toServe, 'deliver')} className={btn} style={{ background: INK, color: '#fff' }}>{by === 'order' && !toReady.length && g.tickets.some((t) => t.channel) ? say('Bagged and out') : toServe.length === 1 ? say('Served') : say('Serve the {n} ready', { n: toServe.length })}</button>}
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
                  <p className="text-[13.5px]" style={{ color: MUTED }}>{by === 'order' ? '' : `${where(t, say)} · `}{t.status === 'pending' ? (plan.get(t.id) && plan.get(t.id)!.startAt > now ? say('Start {when}, with the {dish}', { when: say(startWords(plan.get(t.id)!.startAt, now)), dish: plan.get(t.id)!.slowest }) : say('Waiting')) : t.status === 'in_progress' ? say('Being made') : say('Ready')}{t.note && !allergyFlags(t).mentions.includes(t.note) ? ` · ${t.note}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  {t.status === 'pending' && <button type="button" disabled={busy} onClick={() => onStep(t, 'claim')} className={btn} style={quiet}>{say('Start')}</button>}
                  {(t.status === 'pending' || t.status === 'in_progress') && (needsAllergyNote(t)
                    ? <button type="button" disabled={busy} onClick={() => onNote(t)} className={btn} style={{ background: AMBER, color: '#fff' }}>{say('Allergy noted')}</button>
                    : <button type="button" disabled={busy} onClick={() => onStep(t, 'ready')} className={btn} style={{ background: GREEN, color: '#fff' }}>{say('Ready')}</button>)}
                  {t.status === 'ready' && (needsAllergyNote(t)
                    ? <button type="button" disabled={busy} onClick={() => onNote(t)} className={btn} style={{ background: AMBER, color: '#fff' }}>{say('Allergy noted')}</button>
                    : <button type="button" disabled={busy} onClick={() => onStep(t, 'deliver')} className={btn} style={{ background: INK, color: '#fff' }}>{say('Served')}</button>)}
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
// With more than one location: here only, or every location (lib/menu-choices outWhere; design board "Sold out here or
// everywhere"). Each switch is for the place picked: under Every location, one out here only shows off until it's out
// everywhere too; under Here, one out everywhere switched back is back here only, still out at the others.
function SoldOutSheet({ post, onClose }: { post: (body: any) => Promise<{ status: number; d: any }>; onClose: () => void }) {
  const [menu, setMenu] = useState<MenuItem[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [here, setHere] = useState<{ id: string; name: string | null } | null>(null); const [where, setWhere] = useState<'here' | 'everywhere'>('here');
  const gen = useRef(0);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement | null>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    // Read again every 20 seconds while it's open, so a switch flipped on another screen (or the morning's reset) shows here.
    // A read that left before a switch was flipped is dropped, so it can never flip the switch back on screen.
    const load = () => { const g = gen.current; void post({ action: 'menu' }).then(({ d }) => { if (g !== gen.current) return; if (d.ok) { setMenu(d.menu); setHere(d.here?.id ? d.here : null); setErr(''); } else setErr(d.error || 'The menu didn’t load.'); }, () => undefined); };
    load(); const t = setInterval(load, 20000); return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input, button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const flip = async (m: MenuItem, out: boolean, groupId?: string, optionId?: string) => {
    const k = `${m.id}${groupId || ''}${optionId || ''}`; setBusy(k); setErr(''); gen.current++;
    const { d } = await post({ action: 'soldout', itemId: m.id, groupId, optionId, out, where: here ? where : 'everywhere' }).catch(() => ({ d: { ok: false, error: 'No connection. Try again.' } as any }));
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
  // (On for the place picked; and what each says, with more than one location.)
  const all = !here || where === 'everywhere';
  const isOn = (x: { soldOut: boolean; outWhere?: 'here' | 'everywhere' }) => x.soldOut && (!all || !here || x.outWhere !== 'here');
  const outWord = (x: { soldOut: boolean; outWhere?: 'here' | 'everywhere' }, long: boolean) => !x.soldOut ? '' : !here ? (long ? ', sold out' : ', out') : x.outWhere === 'here' ? (long ? ', sold out here' : ', out here') : x.outWhere === 'everywhere' ? (long ? ', sold out everywhere' : ', out everywhere') : (long ? ', sold out' : ', out');
  const scope = all ? (here ? ' at every location' : '') : ' here';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="sold-title" className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="sold-title" className="text-[20px] font-semibold" style={{ color: INK }}>Sold out</h2><p className="text-[14px] mt-1" style={{ color: MUTED }}>{!here ? 'Off every menu straight away. Switch it back when there’s more.' : all ? 'Off the menu at every location straight away. Switch it back when there’s more.' : `Off the menu at ${here.name || 'this location'} straight away: its guests, counter, kiosk and speaker. Switch it back when there’s more.`}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border text-[20px]" style={{ borderColor: LINE, color: INK }}>×</button>
        </div>
        {here && <div role="group" aria-label="Sold out where" className="flex gap-1.5">
          {([['here', `Here, ${here.name || 'this location'}`], ['everywhere', 'Every location']] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={where === v} onClick={() => setWhere(v)} className="min-h-[44px] flex-1 rounded-xl px-3 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2"
              style={where === v ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{label}</button>))}
        </div>}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
        {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {!menu ? <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Loading the menu…</p>
          : list.length === 0 ? <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Nothing on the menu{q ? ' by that name' : ''}.</p>
          : <ul className="space-y-2">{list.map((m) => (
            <li key={m.id} className="rounded-2xl p-3" style={{ background: m.soldOut ? AMBER_TINT : SOFT }}>
              <div className="flex min-h-[44px] items-center justify-between gap-3">
                <span className="text-[16px] font-semibold" style={{ color: m.soldOut ? AMBER : INK }}>{m.name}{outWord(m, true)}</span>
                {sw(isOn(m), `${m.name} sold out${scope}`, m.id, () => flip(m, !isOn(m)))}
              </div>
              {!m.soldOut && m.choices.map((g) => (
                <div key={g.id} className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[13px]" style={{ color: MUTED }}>{g.name}:</span>
                  {g.options.map((o) => (
                    <button key={o.id} type="button" aria-pressed={isOn(o)} disabled={busy === `${m.id}${g.id}${o.id}`} onClick={() => flip(m, !isOn(o), g.id, o.id)}
                      className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium disabled:opacity-50" style={isOn(o) ? { background: AMBER, color: '#fff' } : o.soldOut ? { background: AMBER_TINT, color: AMBER, border: `1px solid ${AMBER}` } : { background: '#fff', border: `1px solid ${LINE}`, color: INK }}
                      aria-label={`${o.name}${isOn(o) ? ` is sold out${scope}. Tap when it’s back` : `${outWord(o, true)}. Tap if it’s sold out${scope}`}`}>{o.name}{outWord(o, false)}</button>))}
                </div>))}
            </li>))}</ul>}
        {here && !all && <p className="text-[13px]" style={{ color: MUTED }}>Back on here, when it was out everywhere: back here, still out at the others.</p>}
      </div>
    </div>
  );
}

// ─── Tonight's counts: how many of a dish were made, counted down as it's rung in (lib/dish-counts) ─────────────────
function CountsSheet({ rows, post, onChanged, onClose }: { rows: CountRow[]; post: (body: any) => Promise<{ status: number; d: any }>; onChanged: (rows: CountRow[]) => void; onClose: () => void }) {
  const [menu, setMenu] = useState<MenuItem[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [adding, setAdding] = useState<Record<string, string>>({});
  useEffect(() => { void post({ action: 'menu' }).then(({ d }) => { if (d.ok) setMenu(d.menu); else setErr(d.error || 'The menu didn’t load.'); }, () => setErr('No connection.')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = async (itemId: string, value: number | 'off' | 'menu') => {
    setBusy(itemId); setErr('');
    const { d } = await post({ action: 'count', itemId, value }).catch(() => ({ d: { ok: false, error: 'No connection. Try again.' } as any }));
    setBusy(null); if (d.ok) { onChanged(d.counts || []); setAdding((a) => { const n = { ...a }; delete n[itemId]; return n; }); } else setErr(d.error || 'That didn’t go through.');
  };
  const counted = new Set(rows.map((r) => r.id));
  const others = (menu || []).filter((m) => !counted.has(m.id) && (!q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 30);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="counts-title" className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 sm:p-6 space-y-3" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="counts-title" className="text-[20px] font-semibold">Tonight’s counts</h2><p className="text-[14px] mt-1" style={{ color: MUTED }}>Change tonight’s number if you made more or fewer. At zero it’s sold out everywhere; tomorrow starts again from the menu’s number.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border text-[20px]" style={{ borderColor: LINE }}>×</button>
        </div>
        {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {rows.length === 0 && <p className="text-[14px]" style={{ color: MUTED }}>Nothing is counted tonight. Count a dish below, or set how many are made each night on the Menu page.</p>}
        {rows.map((r) => (
          <div key={r.id} className="grid items-center gap-3 min-h-[60px]" style={{ gridTemplateColumns: '1fr auto 140px', borderTop: `1px solid ${LINE}` }}>
            <div className="min-w-0"><p className="text-[15px] font-semibold truncate">{r.name}</p><p className="text-[13px]" style={{ color: MUTED }}>{r.used} ordered{r.fromTonight ? '' : ', the menu’s number'}</p>
              <button type="button" disabled={busy === r.id} onClick={() => set(r.id, 'off')} className="min-h-[44px] text-[13px] font-semibold underline" style={{ color: MUTED }}>Stop counting tonight</button></div>
            <b className="text-[15px] font-semibold tabular-nums" style={{ color: lowCount(r) ? AMBER : INK }}>{leftWords(r)}</b>
            <div className="flex h-11 items-center overflow-hidden rounded-xl" style={{ border: `1px solid ${LINE}` }}>
              <button type="button" disabled={busy === r.id || r.start <= 0} onClick={() => set(r.id, r.start - 1)} aria-label={`One fewer ${r.name}`} className="h-11 w-11 text-[20px] disabled:opacity-40">−</button>
              <span className="flex-1 text-center text-[16px] font-semibold tabular-nums">{r.start}</span>
              <button type="button" disabled={busy === r.id || r.start >= MAX_COUNT} onClick={() => set(r.id, r.start + 1)} aria-label={`One more ${r.name}`} className="h-11 w-11 text-[20px] disabled:opacity-40">+</button>
            </div>
          </div>))}
        <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
          <p className="text-[15px] font-semibold">Count another dish</p>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item to count" className="w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
          {!menu ? <p className="text-[14px]" style={{ color: MUTED }}>Loading the menu…</p> : others.map((m) => (
            <form key={m.id} onSubmit={(e) => { e.preventDefault(); const n = Number(adding[m.id]); if (adding[m.id] && Number.isInteger(n)) void set(m.id, n); }} className="flex items-center gap-2 min-h-[52px]">
              <span className="flex-1 min-w-0 text-[15px] truncate">{m.name}</span>
              <input inputMode="numeric" value={adding[m.id] || ''} onChange={(e) => setAdding((a) => ({ ...a, [m.id]: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="How many" aria-label={`How many ${m.name} tonight`} className="h-11 w-28 rounded-xl border px-3 text-[15px] outline-none" style={{ borderColor: LINE }} />
              <button type="submit" disabled={busy === m.id || !adding[m.id]} className={btn} style={quiet}>Count it</button>
            </form>))}
        </div>
      </div>
    </div>
  );
}

// ─── Holding: batches cooked ahead, each with the time it has left (lib/holding) ─────────────────────────────────────
function HoldingStrip({ holds, holdable, tossedToday, cook, tz, now, busy, onHold, onUse, onToss }: {
  holds: HoldBin[]; holdable: Holdable[]; tossedToday: number; cook: Cook[]; tz: string | null; now: number; busy: string | null;
  onHold: (h: Holdable) => void; onUse: (b: HoldBin) => void; onToss: (b: HoldBin) => void;
}) {
  const say = useT();
  return (
    <section aria-label={say('Holding')} className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-[16px] font-semibold" style={{ color: INK }}>{say('Holding')}</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>{tossedToday > 0 ? say('{n} thrown out today', { n: tossedToday }) : say('Nothing thrown out today')}</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {cook.map((c) => {
          const h = holdable.find((x) => x.id === c.itemId); const q = c.batches * c.batchSize;
          const what = c.by ? say(c.batches === 1 ? '1 batch ({q}) by {time}' : '{n} batches ({q}) by {time}', { n: c.batches, q, time: clock(c.by, tz) }) : say(c.batches === 1 ? '1 batch ({q}) now' : '{n} batches ({q}) now', { n: c.batches, q });
          return (
            <article key={`cook-${c.itemId}`} className="w-[300px] shrink-0 space-y-2 rounded-2xl p-3.5" style={{ background: AMBER_TINT, border: '1px solid #f3d9b8', color: INK }} aria-label={say('Cook ahead: {name}', { name: c.name })}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[16px] font-semibold">{c.name}</p>
                <p className="shrink-0 text-[13px] font-semibold" style={{ color: AMBER }}>{say('Cook ahead')}</p>
              </div>
              <p className="text-[19px] font-semibold leading-snug tabular-nums">{what}</p>
              <p className="text-[13.5px] leading-snug" style={{ color: '#5b5f65' }}>{say('A usual {day} sells about {n} from {from} to {to}.', { day: say(c.weekday), n: c.need, from: clock(c.from, tz), to: clock(c.to, tz) })} {c.held > 0 ? say('{n} held now.', { n: c.held }) : say('None held now.')}</p>
              {h && <button type="button" disabled={busy === `hold-${h.id}`} onClick={() => onHold(h)} aria-label={say('Start a batch of {n} {name}', { n: h.batchSize, name: h.name })} className={`${btn} w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2`} style={{ background: INK, color: '#fff' }}>{say('Start a batch of {n}', { n: h.batchSize })}</button>}
            </article>
          );
        })}
        {holds.map((b) => {
          const st = binState(b, now); const expired = st.state === 'expired'; const soon = st.state === 'soon';
          return (
            <article key={b.id} className="w-[236px] shrink-0 space-y-2.5 rounded-2xl p-3.5" style={{ background: expired ? AMBER : '#fff', color: expired ? '#fff' : INK, border: `1px solid ${expired ? AMBER : soon ? '#f3d9b8' : LINE}` }} aria-label={`${b.name}: ${say('{n} held', { n: b.quantity })}, ${say(st.text)}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[16px] font-semibold">{b.name}</p>
                <p className="text-[26px] font-semibold leading-none tabular-nums">{b.quantity}</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: expired ? 'rgba(255,255,255,0.3)' : SOFT }} aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.round(st.share * 100)}%`, background: soon ? AMBER : GREEN, transition: 'width 1s linear' }} />
              </div>
              <p className="text-[14px] font-semibold tabular-nums" style={{ color: expired ? '#fff' : soon ? AMBER : MUTED }}>{expired ? say('Past its time. Throw it out.') : say(st.text)}</p>
              <div className="flex gap-2">
                {!expired && <button type="button" disabled={busy === b.id} onClick={() => onUse(b)} className={`${btn} flex-1 whitespace-nowrap px-2`} style={quiet}>{say('Use 1')}</button>}
                <button type="button" disabled={busy === b.id} onClick={() => onToss(b)} className={`${btn} flex-1 whitespace-nowrap px-2`} style={expired ? { background: '#fff', color: AMBER } : { background: '#fff', border: `1px solid ${LINE}`, color: RED }}>{say('Throw out')}</button>
              </div>
            </article>
          );
        })}
        {holdable.map((h) => (
          <button key={h.id} type="button" disabled={busy === `hold-${h.id}`} onClick={() => onHold(h)} className="flex min-h-[44px] w-[160px] shrink-0 flex-col items-start justify-center gap-1 rounded-2xl px-3.5 py-3 text-left disabled:opacity-50" style={{ border: '1px dashed #c9cbd0', background: 'transparent', color: INK }}
            aria-label={say('Start a batch of {n} {name}, held {m} minutes', { n: h.batchSize, name: h.name, m: h.holdMinutes })}>
            <span className="text-[15px] font-semibold">+ {h.name}</span>
            <span className="text-[13px]" style={{ color: MUTED }}>{say('Batch of {n}, {m} min', { n: h.batchSize, m: h.holdMinutes })}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── Setting the screen up ───────────────────────────────────────────────────────────────────────────────────────────
function Setup({ tenantId, stopped, closed, onPaired, onMe }: { tenantId: string; stopped: string; closed: string; onPaired: (key: string) => void; onMe: () => void }) {
  const { user, isUserLoading } = useFirebase() as any;
  const [name, setName] = useState('Kitchen'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [screens, setScreens] = useState<{ id: string; name: string; lastSeenAt: string | null; createdBy: string | null }[] | null>(null);
  const call = async (body: any) => { const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }); return r.json().catch(() => ({})); };
  // A manager signed in here sees the screens already set up, to stop one that's lost or no longer used.
  const [maker, setMaker] = useState<'kitchen' | 'desk' | null>(null);
  useEffect(() => { if (!user) return; call({ action: 'screens' }).then((d) => { setScreens(d.ok ? d.screens || [] : null); if (d.ok) setMaker(d.maker === 'kitchen' ? 'kitchen' : 'desk'); }, () => setScreens(null)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickMaker = async (to: 'kitchen' | 'desk') => { const was = maker; setMaker(to); const d = await call({ action: 'maker', maker: to }).catch(() => ({})); if (!d.ok) { setMaker(was); setErr(d.error || 'That didn’t save. Try again.'); } };
  const stop = async (id: string) => { const d = await call({ action: 'revoke', id }).catch(() => ({})); if (d.ok) { setScreens((l) => (l || []).filter((x) => x.id !== id)); if (d.warning) setErr(d.warning); } else setErr(d.error || 'That screen couldn’t be stopped. Try again.'); };
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
            <div className="pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
              <button type="button" onClick={onMe} className={`${btn} w-full`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Just use it as me, on this device</button>
            </div>
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
  return <ScreenLangProvider><KitchenScreenInner /></ScreenLangProvider>;
}

function KitchenScreenInner() {
  const say = useT();
  const { tenantId } = useParams() as { tenantId: string };
  const { user, isUserLoading } = useFirebase() as any;
  const retried = useRef(false);
  const [key, setKey] = useState<string | null>(null);
  // On someone's own phone or computer, signed in: the screen works as them, with no key (api/kitchen, the team's way
  // in). Kept for this visit only. A tablet that's set up keeps using its key.
  const [me, setMe] = useState(false);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  // What's on screen, for a refresh that can't reach the server (it keeps it, or brings back the last one kept here).
  const dataRef = useRef<Data | null>(null); useEffect(() => { dataRef.current = data; }, [data]);
  useKeepPage();
  const [stopped, setStopped] = useState('');
  const [closed, setClosed] = useState('');
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>('lanes');
  // Which station this screen is for (lib/table-service): '' shows every station's tickets. Kept on this tablet.
  const [station, setStation] = useState('');
  // Printing new tickets on this tablet's own printer (no networked printer): kept on this tablet.
  const [autoPrint, setAutoPrint] = useState(false);
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
  const [closingOpen, setClosingOpen] = useState(false);
  // Food safety (components/kitchen/SafetySheet): the batches cooling, read every minute, so a check coming due shows here.
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [coolDue, setCoolDue] = useState<{ id: string; item: string; dueAt: string; stage: number; missed?: boolean }[]>([]);
  const [countsOpen, setCountsOpen] = useState(false);
  // Calls to the dish pit and the barback from this screen (components/kitchen/CallSheet, api/back), and who's coming.
  const [callOpen, setCallOpen] = useState(false); const [myCalls, setMyCalls] = useState<Call[]>([]); const [callTick, setCallTick] = useState(0);
  // Telling the floor (components/kitchen/FloorNoteSheet), and a runner called from expo for a table's plates.
  const [floorOpen, setFloorOpen] = useState(false); const [runBusy, setRunBusy] = useState<string | null>(null);
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
    if (read('cf.kitchen.autoprint') === 'on') setAutoPrint(true);
    try { const s = JSON.parse(sessionStorage.getItem('cf.kitchen.staff') || 'null'); if (s?.name && s?.pass) setStaff(s); } catch { /* */ }
    try { const e = new URLSearchParams(window.location.search).get('event'); if (e && /^[A-Za-z0-9_-]{1,160}$/.test(e)) setEventId(e); } catch { /* */ }
    // Opened from someone's own menu (lib/jobs pageHref): their station, or expo; and, with no key here, as them.
    try {
      const q = new URLSearchParams(window.location.search);
      const st = q.get('station'); if (st && st.length <= 40) setStation(st);
      if (q.get('view') === 'expo') setView('expo');
      if (!read(keyName(tenantId)) && (q.get('me') === '1' || sessionStorage.getItem(`cf.kds.me.${tenantId}`))) { setMe(true); setStaff(null); sessionStorage.setItem(`cf.kds.me.${tenantId}`, '1'); sessionStorage.removeItem('cf.kitchen.staff'); }
    } catch { /* */ }
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
    const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...(key ? { key } : { ...hereAsked() }), ...body }) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, d };
  }, [tenantId, key]);

  useEffect(() => {
    if (!tenantId) return; let stop = false;
    const go = async () => { const { d } = await post({ action: 'safety' }).catch(() => ({ d: null as any })); if (!stop && d?.ok) setCoolDue([...(d.undone || []).map((c: any) => ({ id: c.id, item: c.item, dueAt: c.cooling.dueAt, stage: c.cooling.stage, missed: true })), ...(d.cooling || []).map((c: any) => ({ id: c.id, item: c.item, dueAt: c.cooling.dueAt, stage: c.cooling.stage })).filter((c: any) => Date.parse(c.dueAt) - Date.now() < 15 * 60000)]); };
    void go(); const i = setInterval(() => { if (document.visibilityState === 'visible') void go(); }, 60000);
    return () => { stop = true; clearInterval(i); };
  }, [tenantId, post, safetyOpen]);

  // The dish pit and the barback (api/back), with this screen's key and whoever's working.
  const postBack = useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/back', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...(key ? { key } : {}), ...(staff && key ? { staffPass: staff.pass } : {}), ...body }) });
      return { status: r.status, d: await r.json().catch(() => ({})) };
    } catch { return { status: 0, d: {} as any }; }
  }, [tenantId, key, staff]);
  // This screen's calls: read often while one is going, now and then otherwise.
  const callsGoing = myCalls.some((c) => c.status !== 'done');
  useEffect(() => {
    if (!key && !me) return; let stop = false;
    const go = async () => { const { d } = await postBack({ action: 'calls' }); if (!stop && d?.ok) setMyCalls(d.mine || []); };
    void go(); const i = setInterval(go, callsGoing || myCalls.length ? 8000 : 30000);
    return () => { stop = true; clearInterval(i); };
  }, [key, me, postBack, callsGoing, myCalls.length, callTick]);

  const forgetHere = useCallback((why: string) => { write(keyName(tenantId), null); setKey(null); setMe(false); retried.current = false; try { sessionStorage.removeItem(`cf.kds.me.${tenantId}`); } catch { /* */ } setData(null); seen.current = null; setStopped(why); }, [tenantId]);
  // As yourself, it's your name on what's done: a PIN name left in this tab from a shared screen goes.
  const asMe = () => { try { sessionStorage.setItem(`cf.kds.me.${tenantId}`, '1'); sessionStorage.removeItem('cf.kitchen.staff'); } catch { /* */ } setStaff(null); retried.current = false; setMe(true); setStopped(''); seen.current = null; };

  // New tickets for this screen's station, printed on this tablet: one slip a table's course or an order, through the
  // tablet's print dialog (with Chrome set to print without asking, straight to its printer). Each ticket once, even
  // after the screen reloads.
  const printHere = (fresh: KitchenTicket[], d: Data) => {
    const st = station && (d.stations || []).includes(station) ? station : '';
    const mine = fresh.filter((t) => t.col === 'kdsTickets' && (!st || (t.madeAt || (d.stations || [])[0]) === st));
    let done: string[] = []; try { done = JSON.parse(read('cf.kitchen.printed') || '[]'); } catch { done = []; }
    const todo = mine.filter((t) => !done.includes(t.id)); if (!todo.length) return;
    const groups = new Map<string, KitchenTicket[]>();
    for (const t of todo) { const k = t.visitId ? `v:${t.visitId}|${t.course || 0}` : t.orderId ? `o:${t.orderId}` : `t:${t.id}`; groups.set(k, [...(groups.get(k) || []), t]); }
    for (const g of groups.values()) printFrame(renderHtml(ticketDoc(g, { tz: d.business.timeZone || null, at: new Date().toISOString(), station: st ? null : g[0].madeAt || null, buzz: false }), { font: PRINT_FONT_STACK, fontHref: PRINT_FONT_HREF }));
    write('cf.kitchen.printed', JSON.stringify([...done, ...todo.map((t) => t.id)].slice(-400)));
  };

  const load = useCallback(async () => {
    if ((!key && !me) || inFlight.current) return;
    inFlight.current = true; const at = acted.current;
    const lastKey = `kds.${tenantId}.${eventId || 'all'}`;
    try {
      // Taps kept with no connection go first, so the tickets read next already have them.
      if (keptNow().some((k) => k.url === '/api/kitchen' && k.tenantId === tenantId)) await flush();
      const { status, d } = await post({ action: 'tickets', ...(eventId ? { eventId } : {}) });
      noteNetwork(true);
      if (at !== acted.current) return;   // a tap happened meanwhile: the next refresh has it
      // As yourself, the first refusal can be a sign-in still being restored: one more try before asking to sign in.
      if (status === 401 && !key && !retried.current) { retried.current = true; setTimeout(() => void load(), 1500); return; }
      if (status === 401) { forgetHere(key ? d.error || 'This screen was stopped. A manager can set it up again.' : 'Please sign in again.'); return; }
      retried.current = false;
      if (d.closed) { setClosed(d.error || 'The kitchen screen is closed for now.'); return; }
      if (status === 403 && !key) { forgetHere(d.error || 'This is for the business’s own team.'); return; }
      if (!d.ok) return;
      setClosed('');
      const next: Data = { screen: d.screen, business: d.business, tickets: d.tickets || [], unfired: d.unfired || [], early: Array.isArray(d.early) ? d.early : [], stations: d.stations || [], items: d.items || {}, today: d.today || [], holds: d.holds || [], holdable: d.holdable || [], tossedToday: Number(d.tossedToday) || 0, cook: Array.isArray(d.cook) ? d.cook : [], counts: d.counts || [], finishTogether: d.finishTogether !== false, printers: Array.isArray(d.printers) ? d.printers : [],
        pace: d.pace && Number(d.pace.behindMin) > 0 ? { behindMin: Math.round(Number(d.pace.behindMin)), level: String(d.pace.level || 'busy') } : null };
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
        if (fresh.length && autoPrint) printHere(fresh, next);
        for (const i of ids) seen.current.add(i);
      } else seen.current = new Set(ids);
      keepLast(lastKey, next, { screen: true });
      // Any still kept (the connection dropped again mid-way) stay as tapped here.
      setData({ ...next, tickets: withKept(next.tickets, keptNow(), tenantId) }); setLastOk(Date.now());
    } catch {
      // No connection: keep what's on screen and try again; opened with none, what this tablet last had, as tapped here.
      noteNetwork(false);
      if (!dataRef.current) { const last = lastOf<Data>(lastKey, { screen: true }); if (last?.data?.tickets) {
        // What was up then counts as seen: a ticket that arrives meanwhile still rings when the connection's back.
        if (!seen.current) seen.current = new Set(last.data.tickets.map((t) => `${t.col}/${t.id}`));
        setData({ ...last.data, tickets: withKept(last.data.tickets, keptNow(), tenantId) }); setLastOk(last.at); } }
    } finally { inFlight.current = false; }
  }, [key, me, eventId, post, forgetHere, soundOn, autoPrint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key && (!me || isUserLoading)) return;
    load();
    const i = setInterval(load, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [key, me, isUserLoading, load]);

  const setBusy = (ids: string[], on: boolean) => setBusyIds((prev) => { const n = new Set(prev); for (const i of ids) { if (on) n.add(i); else n.delete(i); } return n; });
  const local = (list: KitchenTicket[], status: string, kept = false) => setData((d) => d ? { ...d, tickets: d.tickets.map((t) => list.some((x) => x.id === t.id && x.col === t.col) ? { ...t, status, ...(kept ? { keptHere: true } : {}), ...(status === 'in_progress' && staff ? { claimedBy: { staffId: staff.id, name: staff.name } } : {}) } : t).filter((t) => LIVE_STATUS.includes(t.status)) } : d);
  const after = STEP_AFTER;
  // A tap through the server: kept on the tablet with no connection (lib/outbox) when `keep`, sent when it's back.
  // The cook's pass is held for this session only, never in the tablet's lasting storage.
  const tap = (body: any, label: string, keep: boolean) => send('/api/kitchen', { tenantId, ...(key ? { key } : {}), ...body, ...(staff && key ? { staffPass: staff.pass } : {}) }, { label, auth: key ? 'none' : 'user', keep, tenantId, hold: ['staffPass'] });
  const keptWords = 'Saved on this tablet. It’s sent when the connection’s back.';

  const step = async (t: KitchenTicket, s: KitchenStep) => {
    acted.current++; setBusy([t.id], true);
    try {
      const { status, d, kept } = await tap({ action: 'act', col: t.col, id: t.id, step: s }, `${t.station}: ${t.item}, ${STEP_WORD[s]}`, s !== 'cancel');
      if (kept) { local([t], after[s], true); setNotice(keptWords); return; }
      if (d.offline) { setNotice(s === 'cancel' ? 'No connection. Cancelling needs the connection: try again when it’s back.' : 'No connection. Try again.'); return; }
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
      const { status, d, kept } = await tap({ action: 'bump', step: s, tickets: list.map((t) => ({ col: t.col, id: t.id })) },
        list.length === 1 ? `${list[0].station}: ${list[0].item}, ${STEP_WORD[s]}` : `${list.length} tickets at ${list[0].station}, ${STEP_WORD[s]}`, true);
      // Kept: an allergy still to note holds its ticket back, as the server would.
      if (kept) { local(list.filter((t) => !needsAllergyNote(t)), after[s], true); setNotice(list.some(needsAllergyNote) ? 'Tap Allergy noted on each with an allergy first. The rest are saved on this tablet and sent when the connection’s back.' : keptWords); return; }
      if (status === 401) { forgetHere(d.error || 'This screen was stopped.'); return; }
      if (d.staffOk === false) staffGone();
      if (d.ok) {
        if (d.failed > 0) setNotice(`${d.failed} of ${d.of} didn’t go through. They’re still up: try them again.`);
        else if (d.allergy > 0) { local(list.filter((t) => !needsAllergyNote(t)), after[s]); setNotice(`${d.allergy} of ${d.of} ${d.allergy === 1 ? 'has an allergy' : 'have allergies'} to note first. Tap Allergy noted on ${d.allergy === 1 ? 'it' : 'each'}.`); }
        else { local(list, after[s]); if (d.moved < d.of) setNotice(`${d.moved} of ${d.of} moved. The rest were already moved on.`); }
      }
      else setNotice(d.error || 'That didn’t go through. Try again.');
    } catch { setNotice('No connection. Try again.'); }
    finally { acted.current++; setBusy(ids, false); }
    load();
  };
  // "Allergy noted": the station has seen it and will make it safe. Then it can be marked ready.
  const noteAllergy = async (t: KitchenTicket) => {
    acted.current++; setBusy([t.id], true);
    try {
      const { status, d, kept } = await tap({ action: 'allergyNoted', col: t.col, id: t.id, seen: allergySig(t) }, `${t.station}: ${t.item}, allergy noted`, true);
      if (kept) { setData((x) => x ? { ...x, tickets: x.tickets.map((y) => (y.id === t.id && y.col === t.col ? ({ ...y, allergyNotedAt: new Date().toISOString(), allergyNotedBy: staff?.name || null, keptHere: true } as any) : y)) } : x); setNotice(keptWords); return; }
      if (status === 401) { forgetHere(d.error || 'This screen was stopped.'); return; }
      if (d.staffOk === false) staffGone();
      if (d.ok) setData((x) => x ? { ...x, tickets: x.tickets.map((y) => (y.id === t.id && y.col === t.col ? { ...y, allergyNotedAt: d.at || new Date().toISOString(), allergyNotedBy: d.by || staff?.name || null } : y)) } : x);
      else setNotice(d.error || 'That didn’t go through. Try again.');
    } catch { setNotice('No connection. Try again.'); }
    finally { acted.current++; setBusy([t.id], false); }
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
  // Being ordered at the speaker, this station's part of it (or every station's, on expo).
  const earlyHere = (data?.early || []).map((e) => ({ ...e, lines: e.lines.filter((l) => view === 'expo' || !myStation || l.madeAt === myStation) })).filter((e) => e.lines.length);
  const pickStation = (v: string) => { setStation(v); write('cf.kitchen.station', v || null); };
  const isHeld = (t: KitchenTicket) => t.status === 'pending' && !!t.holdUntil && Date.parse(t.holdUntil) > now;
  // (Worked out again only when one starts waiting or stops, not every second.)
  const heldKey = allTickets.filter(isHeld).map((t) => t.id).join('|');
  const tickets = useMemo(() => allTickets.filter((t) => !isHeld(t)), [allTickets, heldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tables with food on the go, for calling a table's server (components/kitchen/CallSheet).
  const callTables = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTickets as any[]) if (t?.source === 'tab' && t.visitId && !m.has(t.visitId)) m.set(t.visitId, tableLabel(t.tableNumber));
    return Array.from(m.entries()).map(([visitId, label]) => ({ visitId, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).slice(0, 40);
  }, [allTickets]);
  // A table's plates are up: the runners' phones buzz with the table and what's on it (api/back 'call').
  const sendRunner = async (r: { visitId: string; ticketIds: string[]; label: string }) => {
    setRunBusy(r.visitId);
    const { status, d } = await postBack({ action: 'call', to: 'runner', what: 'run', visitId: r.visitId, ticketIds: r.ticketIds, station: 'Expo' });
    setRunBusy(null);
    setNotice(d?.ok ? (d.already ? `A runner’s already called for ${r.label}.` : `Runner called for ${r.label}. Their phones buzzed.`) : status === 0 ? 'No connection. Try again in a moment.' : d?.error || 'That didn’t go through.');
    setCallTick((n) => n + 1);
  };
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
  // Finishing together: what each quicker dish waits for (worked out across every station, then shown on each).
  const plan = useMemo(() => (data?.finishTogether === false ? new Map<string, StartAt>() : startPlan((data?.tickets || []) as any)), [data]);
  const startLater = (t: KitchenTicket) => { const p = plan.get(t.id); return !!p && p.startAt > now; };
  const laterKey = tickets.filter(startLater).map((t) => t.id).join('|');
  const lanes = useMemo(() => ({
    // What to start now first; a dish timed to finish with a slower one waits below, soonest first.
    waiting: tickets.filter((t) => t.status === 'pending').sort((a, b) => Number(startLater(a)) - Number(startLater(b)) || (startLater(a) ? plan.get(a.id)!.startAt - plan.get(b.id)!.startAt : 0) || kitchenOrder(a, b)),
    making: tickets.filter((t) => t.status === 'in_progress').sort(kitchenOrder),
    // Ready to bag: with two drive-thru lanes that merge, the car nearer the window first (lib/drive-lanes).
    ready: tickets.filter((t) => t.status === 'ready').sort((a, b) => (a.windowPlace && b.windowPlace ? a.windowPlace - b.windowPlace : 0) || byTime(a, b)),
  }), [tickets, laterKey, plan]); // eslint-disable-line react-hooks/exhaustive-deps
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
  if (!key && !me) return <Setup tenantId={tenantId} stopped={stopped} closed={closed} onMe={asMe} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setMe(false); try { sessionStorage.removeItem(`cf.kds.me.${tenantId}`); } catch { /* */ } setStopped(''); setJustPaired(true); seen.current = null; }} />;

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
        : list.map((t) => <TicketCard key={`${t.col}/${t.id}`} t={t} item={t.itemId ? data?.items[String(t.itemId)] : undefined} now={now} tz={tz} busy={busyIds.has(t.id)} bin={binFor(data?.holds || [], t.itemId ? String(t.itemId) : null, t.quantity, now)} start={plan.get(t.id)} onStep={step} onCancel={setCancelFor} onPrint={print} onFromHold={fromHold} onNote={noteAllergy} />)}
    </section>
  );

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: SOFT, color: INK }}>
      <header className="bg-white px-4 sm:px-6 py-3 space-y-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight truncate">{data?.business.name || say('Kitchen')}</h1>
            <p className="text-[13.5px]" style={{ color: MUTED }}>{view === 'expo' ? say('Expo, every station') : myStation || data?.screen || say('Kitchen screen')}, {say(tickets.length === 1 ? '{n} ticket up' : '{n} tickets up', { n: tickets.length })}</p>
          </div>
          {data?.pace && <p role="status" className="rounded-2xl px-3 py-1.5 text-[13.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{say('About {n} min behind. The host stand and pickup times know.', { n: data.pace.behindMin })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl p-1" style={{ background: SOFT }} role="tablist" aria-label={say('How tickets are shown')}>
              {([['lanes', 'Lanes'], ['order', 'By order'], ['course', 'By course'], ['dish', 'By dish'], ['expo', 'Expo']] as [View, string][]).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pickView(v)} className="min-h-[44px] px-3 rounded-lg text-[14px] font-medium" style={view === v ? { background: '#fff', color: INK, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: MUTED }}>{say(label)}</button>
              ))}
            </div>
            {!key ? <span className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-[14px] bg-white" style={{ border: `1px solid ${LINE}` }}>{say('As you, on this device')}</span>
              : staff
              ? <span className="inline-flex items-center gap-2 rounded-xl pl-3 bg-white" style={{ border: `1px solid ${LINE}` }}><span className="text-[14px]">{say('Working:')} <b className="font-semibold">{staff.name.split(' ')[0]}</b></span><button type="button" onClick={() => pickStaff(null)} className="min-h-[42px] px-3 rounded-xl text-[14px] font-semibold" style={{ color: MUTED }}>{say('Done')}</button></span>
              : <button type="button" onClick={() => setPinOpen(true)} className={btn} style={quiet}>{say('Who’s working?')}</button>}
            {stations.length > 1 && view !== 'expo' && (
              <select value={myStation} onChange={(e) => pickStation(e.target.value)} aria-label={say('Which station this screen is for')} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold bg-[#fff]" style={{ border: `1px solid ${LINE}`, color: INK }}>
                <option value="">{say('Every station')}</option>
                {stations.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setSoldOpen(true)} className={btn} style={quiet}>{say('Sold out')}</button>
            <button type="button" onClick={() => setCountsOpen(true)} className={btn} style={quiet}>{say('Counts')}</button>
            <button type="button" onClick={() => setCallOpen(true)} className={btn} style={quiet}>{say('Call')}</button>
            <button type="button" onClick={() => setFloorOpen(true)} className={btn} style={(data as any)?.floorNote ? { ...quiet, borderColor: INK } : quiet}>{say('Tell the floor')}</button>
            <button type="button" onClick={() => setSafetyOpen(true)} className={btn} style={coolDue.length ? { ...quiet, borderColor: AMBER, color: AMBER } : quiet}>{say('Food safety')}</button>
            <button type="button" onClick={() => setClosingOpen(true)} className={btn} style={quiet}>{say('Closing')}</button>
            <button type="button" onClick={toggleSound} className={btn} style={quiet} aria-pressed={soundOn}>{soundOn ? say('Sound on') : say('Sound off')}</button>
            <LangToggle />
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className={btn} style={quiet} aria-expanded={menuOpen}>{say('Screen')}</button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-[#fff] p-2 z-40 space-y-1" style={{ border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
                  <button type="button" role="switch" aria-checked={autoPrint} onClick={() => { const v = !autoPrint; setAutoPrint(v); write('cf.kitchen.autoprint', v ? 'on' : null); if (v) { try { write('cf.kitchen.printed', JSON.stringify((data?.tickets || []).map((t) => t.id).slice(-400))); } catch { /* */ } } }}
                    className="w-full text-left min-h-[44px] px-3 rounded-xl text-[14px] font-semibold" style={{ color: INK }}>{autoPrint ? 'Printing new tickets here: on' : 'Print new tickets here'}</button>
                  <p className="px-3 pb-1 text-[13px]" style={{ color: MUTED }}>For a receipt printer set up on this tablet. Each new ticket opens the print dialog; with Chrome set to print without asking, it prints straight away. Tickets that come in while this screen is closed don’t print here. A printer on the network is set up in Settings, under Printers.</p>
                  {(data?.printers || []).filter((p) => p.ok && (!myStation || !p.stations.length || p.stations.includes(myStation))).slice(0, 1).map((p) => (
                    <p key={p.name} className="px-3 pb-1 text-[13px] font-medium" style={{ color: AMBER }}>{p.name} already prints {myStation ? myStation : p.stations.length ? p.stations.slice(0, 3).join(', ') : 'every station’s'} tickets, so with this on those would print twice.</p>))}
                  {key ? <button type="button" onClick={stopScreen} className="w-full text-left min-h-[44px] px-3 rounded-xl text-[14px] font-medium" style={{ color: RED }}>Stop this screen</button>
                    : <button type="button" onClick={() => { setMenuOpen(false); forgetHere(''); }} className="w-full text-left min-h-[44px] px-3 rounded-xl text-[14px] font-medium" style={{ color: INK }}>Stop using it here</button>}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]" style={{ color: MUTED }}>
          <span>{say('Today')} <b className="font-semibold tabular-nums" style={{ color: INK }}>{stats.total}</b></span>
          <span>{say('Served')} <b className="font-semibold tabular-nums" style={{ color: INK }}>{stats.served}</b></span>
          <span>{say('Waiting')} <b className="font-semibold tabular-nums" style={{ color: INK }}>{lanes.waiting.length}</b></span>
          <span>{say('Average wait')} <b className="font-semibold tabular-nums" style={{ color: INK }}>{stats.served ? waited(stats.avg) : say('none yet')}</b></span>
          {lateCount > 0 && <span style={{ color: AMBER }}>{say('Past their time')} <b className="font-semibold tabular-nums">{lateCount}</b></span>}
          {later.length > 0 && <span>{say('Later')} {later.slice(0, 4).map((l, i) => <b key={i} className="ml-1.5 font-semibold" style={{ color: INK }}>{l.number}{l.who ? ` · ${l.who}` : ''} {say('starts')} {new Date(l.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{i < Math.min(later.length, 4) - 1 ? ',' : ''}</b>)}{later.length > 4 ? ` ${say('and {n} more', { n: later.length - 4 })}` : ''}</span>}
          {view !== 'expo' && comingHere.length > 0 && <span>{say('Held for later')} <b className="font-semibold tabular-nums" style={{ color: INK }}>{comingHere.length}</b></span>}
          {stats.top && <span>{say('Most ordered')} <b className="font-semibold" style={{ color: INK }}>{stats.top}</b></span>}
          {(data?.counts || []).length > 0 && <span>{say('Left tonight')} {(data?.counts || []).slice(0, 6).map((c, i, a) => <b key={c.id} className="ml-1.5 font-semibold" style={{ color: lowCount(c) ? AMBER : INK }}>{c.name} {c.left > 0 ? c.left : say('sold out')}{i < a.length - 1 ? ',' : ''}</b>)}{(data?.counts || []).length > 6 ? ` ${say('and {n} more', { n: (data?.counts || []).length - 6 })}` : ''}</span>}
        </div>
      </header>

      <div className="px-4 sm:px-6 pt-3 space-y-2">
        {closed && <div className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>{closed}</div>}
        {!closed && <ConnectionBar tenantId={tenantId} down={stale} asOf={lastOk || null} kitchen />}
        <CallStrip calls={myCalls} post={postBack} now={Date.now()} onChanged={() => setCallTick((n) => n + 1)} />
        {!stale && (data?.printers || []).filter((p) => !p.ok && (!myStation || !p.stations.length || p.stations.includes(myStation))).map((p) => (
          <div key={p.name} role="status" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}><b className="font-semibold">{p.name} isn’t printing.</b> {p.words}. New tickets are on this screen. Check its paper and that it’s on the Wi-Fi.</div>))}
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
            <span>{say('Showing {name} only.', { name: eventTitle || say('one event') })}</span>
            <button type="button" onClick={showAll} className={btn} style={quiet}>{say('Show every ticket')}</button>
          </div>
        )}
        {notice && <div className="rounded-2xl px-4 py-3 text-[15px] bg-white" style={{ border: `1px solid ${LINE}` }} role="status">{notice}</div>}
      </div>

      <main className="flex-1 px-4 sm:px-6 py-4">
        {data && earlyHere.length > 0 && <BeingOrdered rows={earlyHere} now={now} />}
        {!data ? (
          <div className="flex justify-center py-16"><div className="h-7 w-7 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label={say('Loading tickets')} /></div>
        ) : view === 'lanes' ? (
          <div className="space-y-4">
            {(data.holds.length > 0 || data.holdable.length > 0) && <HoldingStrip holds={data.holds} holdable={data.holdable} tossedToday={data.tossedToday} cook={data.cook || []} tz={data.business.timeZone} now={now} busy={holdBusy} onHold={startHold} onUse={(b) => holdStep(b, 'holdUse')} onToss={(b) => holdStep(b, 'holdToss')} />}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              {lane(say('Waiting'), lanes.waiting, say('Nothing waiting.'))}
              {lane(say('Being made'), lanes.making, say('Nothing being made.'))}
              {lane(say('Ready to go out'), lanes.ready, say('Nothing ready yet.'))}
            </div>
          </div>
        ) : view === 'expo' ? (
          <ExpoView tickets={tickets} unfired={data.unfired || []} now={now} busyIds={busyIds} onBump={bump} onNote={noteAllergy} runs={myCalls} onRunner={sendRunner} runBusy={runBusy} />
        ) : groups.length === 0 ? (
          <p className="rounded-2xl px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>{say('No tickets up.')}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {groups.map((g) => <GroupPanel key={g.key} g={g} by={view as 'course' | 'dish' | 'order'} now={now} busyIds={busyIds} plan={plan} onStep={step} onBump={bump} onNote={noteAllergy} />)}
          </div>
        )}
      </main>

      {soundOn && !audioOk && (
        // Floats over the screen, so it going away after the first tap never moves a button under someone's finger.
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-full px-5 py-3 text-[15px] font-medium pointer-events-none" style={{ background: INK, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxWidth: 'calc(100vw - 32px)' }} role="status">{say('Tap anywhere to turn on the sound for new tickets')}</div>
      )}
      {safetyOpen && <SafetySheet post={(body) => post({ ...body, ...(staff ? { staffPass: staff.pass } : {}) })} onClose={() => setSafetyOpen(false)} onPin={() => setPinOpen(true)} />}
      {pinOpen && <SharedPinPad check={checkPin} onDone={(s) => { pickStaff(s); setPinOpen(false); }} onClose={() => setPinOpen(false)} line={say('Your PIN puts your name on the tickets you move. The screen works without it.')} />}
      {soldOpen && <SoldOutSheet post={(body) => post({ ...body, ...(staff ? { staffPass: staff.pass } : {}) })} onClose={() => setSoldOpen(false)} />}
      {countsOpen && <CountsSheet rows={data?.counts || []} post={(body) => post({ ...body, ...(staff ? { staffPass: staff.pass } : {}) })} onChanged={(rows) => setData((x) => (x ? { ...x, counts: rows } : x))} onClose={() => setCountsOpen(false)} />}
      {callOpen && <CallSheet post={postBack} station={view === 'expo' ? 'Expo' : myStation || null} people tables={callTables} onClose={() => setCallOpen(false)} onSent={(m) => { setNotice(m); setCallTick((n) => n + 1); }} />}
      {floorOpen && <FloorNoteSheet post={post} note={(data as any)?.floorNote || null} onClose={() => setFloorOpen(false)} onSent={(m) => { setNotice(m); void load(); }} />}
      {coolDue.length > 0 && !safetyOpen && (
        <button type="button" onClick={() => setSafetyOpen(true)} className="fixed bottom-4 right-4 z-30 min-h-[52px] rounded-2xl px-5 text-left text-[15px] font-semibold" style={{ background: AMBER_TINT, color: AMBER, border: `1px solid ${AMBER}`, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {coolDue.some((c) => c.missed) && <span className="block">{say('Say what was done')}: {coolDue.filter((c) => c.missed).map((c) => c.item).join(', ')}</span>}
          {coolDue.some((c) => !c.missed) && <span className="block">{say('Cooling check due')}: {coolDue.filter((c) => !c.missed).map((c) => say('{item}: {mark}', { item: c.item, mark: say('{t}°F by {time}', { t: c.stage === 1 ? 70 : 41, time: new Date(c.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }) })).join(', ')}</span>}
        </button>
      )}
      {closingOpen && <ClosingSheet post={(body) => post({ ...body, ...(staff ? { staffPass: staff.pass } : {}) })} onClose={() => setClosingOpen(false)} />}
      {cancelFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label={say('Cancel this ticket')}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 space-y-3">
            <h2 className="text-[20px] font-semibold">{say('Cancel {item} for {name}?', { item: cancelFor.item, name: cancelFor.name })}</h2>
            <p className="text-[15px]" style={{ color: MUTED }}>{say('It comes off every screen.')}{cancelFor.source === 'lounge' ? ` ${say('Anything taken off the shelf when it was ordered is put back.')}` : cancelFor.source === 'tab' ? ` ${say('It stays on the table’s bill until it’s taken off there.')}` : cancelFor.source === 'pos' ? ` ${say('The sale isn’t changed: refund it at the desk if it won’t be made.')}` : ''}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setCancelFor(null)} className={btn} style={quiet}>{say('Keep it')}</button>
              <button type="button" onClick={confirmCancel} className={btn} style={{ background: RED, color: '#fff' }}>{say('Cancel ticket')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
