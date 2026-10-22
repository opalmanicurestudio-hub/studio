'use client';
// src/components/orders/DaySheets.tsx — WHAT THE TODAY COUNTS OPEN (lib/ship-day).
//   Late: past the date its customer was first given, what happened, whether they've been told, and the next step.
//   At risk: due today and, at the team's pace, not going to make the pickup; pack them first, or tell the customers
//   the new date now (each gets one message with the date and their right to cancel).
//   Carrier: parcels going back to the sender, deliveries that failed, parcels gone quiet (a quiet one opens its
//   choices: send a replacement, tell the customer, or wait; components/orders/LossSheets).
import * as React from 'react';
import type { CarrierItem, LateItem, Pace, RiskItem, Step } from '@/lib/ship-day';
import { pastWord, sharedTellDay, tellableNow, whenWord } from '@/lib/ship-day';
import { dayKey, formatTime } from '@/lib/tenant-time';
import { firstName, orderNum } from '@/lib/orders-view';
import { Btn, C, Sheet, muted } from './ui';

/** 'Marcus T.' */
export const shortName = (n: unknown) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Customer'; };

const card = { border: `1px solid ${C.line}` } as React.CSSProperties;

export function LateSheet({ items, today, tz, now, busy, onStep, onClose }: { items: LateItem[]; today: string; tz: string; now: number; busy: string; onStep: (it: LateItem, s: Step) => void; onClose: () => void }) {
  return (
    <Sheet title={items.length ? `Late: ${items.length}` : 'Nothing is late'} sub="Past the date the customer was given." onClose={onClose} closeLabel="Done">
      <div className="mt-1 flex flex-col gap-2.5">
        {items.map((it) => {
          const o = it.order; const who = firstName(o.customerName);
          return (
            <div key={o.id} className="rounded-[18px] px-4 py-3.5" style={card}>
              <div className="flex items-baseline justify-between gap-2.5"><span className="min-w-0 truncate text-[16px] font-semibold">{orderNum(o)} {shortName(o.customerName)}</span><span className="shrink-0 text-[14px] font-semibold" style={{ color: C.warn }}>due {pastWord(it.first, today, tz)}</span></div>
              <p className="m-0 mt-1 text-[14px] leading-snug" style={muted}>{it.what}</p>
              {it.told && it.toldStands ? <p className="m-0 mt-1.5 text-[14px] font-semibold" style={{ color: C.ok }}>{toldLine(who, it.told, today, tz)}</p>
                : it.autoTell ? <p className="m-0 mt-1.5 text-[14px]" style={muted}>{autoLine(who, it.autoTell, now, today, tz, !!it.told)}</p>
                : it.shown ? <p className="m-0 mt-1.5 text-[14px]" style={{ color: C.warn }}>{it.told ? `${toldLine(who, it.told, today, tz)}. That has gone by too.` : `${who} hasn’t been told yet.`}</p> : null}
              {it.steps.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {it.steps.map((s, i) => <Btn key={s.kind} kind={i === 0 ? 'primary' : 'soft'} className="h-11" disabled={!!busy} onClick={() => onStep(it, s)}>{busy === `${o.id}:${s.kind}` ? 'One moment…' : s.label}</Btn>)}
                </div>)}
            </div>);
        })}
        {items.length === 0 && <p className="m-0 py-6 text-center text-[15px]" style={muted}>Every order is on time.</p>}
      </div>
    </Sheet>);
}

/** 'Priya is told after 4:00 PM that it ships tomorrow, unless it’s labeled first.', then 'Priya is being told it ships
 *  tomorrow.' once that time has come (the hourly check sends it). */
function autoLine(who: string, a: { at: string; day: string }, now: number, today: string, tz: string, again: boolean): string {
  const w = whenWord(a.day, today, tz);
  const ships = w === 'today' || w === 'tomorrow' ? w : `on ${w}`;
  return now < Date.parse(a.at) ? `${who} is told${again ? ' again' : ''} after ${formatTime(new Date(a.at), tz)} that it ships ${ships}, unless it’s labeled first.` : `${who} is being told${again ? ' again' : ''} it ships ${ships}.`;
}

/** 'Marcus was told on Tuesday: ships by Friday', 'Kim was told today: ships tomorrow'. */
function toldLine(who: string, told: { day: string; at: string | null }, today: string, tz: string): string {
  const t = Date.parse(String(told.at || ''));
  const when = Number.isFinite(t) ? pastWord(dayKey(new Date(t), tz), today, tz) : '';
  const said = when ? (when === 'today' || when === 'yesterday' ? ` ${when}` : ` on ${when}`) : '';
  const by = whenWord(told.day, today, tz);
  return `${who} was told${said}: ships ${by === 'today' || by === 'tomorrow' ? by : `by ${by}`}`;
}

const STATUS_TONE: Record<string, React.CSSProperties> = {
  not_started: { border: `1px solid ${C.line}`, color: C.muted }, packing: { background: C.okSoft, color: C.ok },
  address: { background: C.warnSoft, color: C.warn }, held: { background: C.warnSoft, color: C.warn },
};

export function RiskSheet({ items, pickupWords, pace, now, tz, busy, canPack, onPackFirst, onTell, onOpenOrder, onClose }: {
  items: RiskItem[]; pickupWords: string; pace: Pace; now: number; tz: string; busy: string; canPack: boolean;
  onPackFirst: () => void; onTell: () => void; onOpenOrder: (id: string) => void; onClose: () => void;
}) {
  const packable = items.filter((i) => i.why === 'not_started' || i.why === 'packing');
  // Telling customers a new date is offered only in the hour before their pickup, when a miss is likely whatever the
  // pace guess says, and only to customers who were given a date.
  const tellable = tellableNow(items, now);
  const later = items.filter((i) => i.shown && !tellable.includes(i));
  const opens = later.length ? formatTime(new Date(Math.min(...later.map((i) => Date.parse(i.tellFrom)))), tz) : '';
  const shared = sharedTellDay(tellable);
  const tellWord = shared ? whenWord(shared, dayKey(new Date(now), tz), tz) : null;
  const paceWords = `about ${pace.minutesPerOrder} min an order${pace.packers > 1 ? ` with ${pace.packers} people packing` : ''}${pace.from === 'default' ? ', a first guess until a few more orders are packed' : ''}`;
  return (
    <Sheet title={items.length ? `At risk: ${items.length}` : 'Nothing is at risk'} sub={items.length ? `Due to ship today, and likely to miss ${pickupWords} at today’s pace (${paceWords}).` : `Everything due today can make it at today’s pace (${paceWords}).`} onClose={onClose} closeLabel="Done">
      <div className="mt-1">
        {items.map((it) => (
          <button key={it.order.id} type="button" onClick={() => onOpenOrder(it.order.id)} className="cf-press flex min-h-[64px] w-full items-center gap-3 border-b py-2.5 text-left" style={{ borderColor: C.line, color: C.ink }}>
            <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{orderNum(it.order)} {shortName(it.order.customerName)}</span><span className="block truncate text-[14px]" style={muted}>{it.detail}</span></span>
            <span className="inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold" style={STATUS_TONE[it.why]}>{it.status}</span>
          </button>))}
      </div>
      {items.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {canPack && packable.length > 0 && <Btn kind="primary" className="h-12 w-full" disabled={!!busy} onClick={onPackFirst}>{busy === 'rush' ? 'Moving them up…' : packable.length === 1 ? 'Pack this one first' : 'Pack these first'}</Btn>}
          {tellable.length > 0 && <Btn kind="soft" className="h-12 w-full" disabled={!!busy} onClick={onTell}>{busy === 'tell' ? 'Telling them…' : `Tell ${tellable.length === 1 ? firstName(tellable[0].order.customerName) : 'them'} now${tellWord ? `: ships ${tellWord}` : ''}`}</Btn>}
          {tellable.length > 0 && <p className="m-0 text-center text-[13px] leading-snug" style={muted}>“Tell {tellable.length === 1 ? firstName(tellable[0].order.customerName) : 'them'} now” sends {tellable.length === 1 ? 'one message' : 'each customer one message'} with the new date and keeps their right to cancel{tellable.length < items.length ? '. Only customers who were given a date are told' : ''}.</p>}
          {tellable.length === 0 && later.length > 0 && <p className="m-0 text-center text-[13px] leading-snug" style={muted}>From {opens}, an hour before the pickup, you can tell {later.length === 1 ? firstName(later[0].order.customerName) : 'these customers'} the new date if it still looks likely to miss.</p>}
        </div>)}
    </Sheet>);
}

export function CarrierSheet({ items, busy, onOpenOrder, onStalled, onSeen, onClose }: { items: CarrierItem[]; busy: string; onOpenOrder: (id: string) => void; onStalled?: (it: CarrierItem) => void; onSeen: (it: CarrierItem) => void; onClose: () => void }) {
  return (
    <Sheet title={items.length ? `Carrier: ${items.length}` : 'No carrier problems'} sub="Parcels the carrier is having trouble with." onClose={onClose} closeLabel="Done">
      <div className="mt-1 flex flex-col gap-2.5">
        {items.map((it) => (
          <div key={it.order.id} className="rounded-[18px] px-4 py-3.5" style={it.kind === 'returned' ? { border: `2px solid ${C.ink}` } : card}>
            <p className="m-0 text-[16px] font-semibold leading-snug">{it.title}</p>
            <p className="m-0 mt-1 text-[14px] leading-snug" style={muted}>{it.detail}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {it.kind === 'stalled' && onStalled
                ? <Btn kind="primary" className="h-11" onClick={() => onStalled(it)}>Choose what to do</Btn>
                : <Btn kind="primary" className="h-11" onClick={() => onOpenOrder(it.order.id)}>{it.kind === 'stalled' ? 'Open the order' : `Message ${firstName(it.order.customerName)}`}</Btn>}
              <Btn kind="soft" className="h-11" disabled={busy === it.order.id} onClick={() => onSeen(it)}>{busy === it.order.id ? 'One moment…' : 'It’s sorted'}</Btn>
            </div>
          </div>))}
        {items.length === 0 && <p className="m-0 py-6 text-center text-[15px]" style={muted}>Every parcel is moving.</p>}
      </div>
    </Sheet>);
}
