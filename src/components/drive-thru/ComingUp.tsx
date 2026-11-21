'use client';
// src/components/drive-thru/ComingUp.tsx — COMING UP, on the counter page (lib/ahead-days-server comingUp; design board
// "Orders for another day"). The orders for another day still waiting for their day, soonest first, so the team can plan:
// when, who, how many people and items, and when the kitchen starts it. On its day it goes to the kitchen by itself; one
// that couldn't (something sold out, a count too low) says why and can be sent once that's fixed. A manager can cancel one
// before it goes, with every line back to the card (api/counter 'laterCancel'; the guest gets a text).
import { useState } from 'react';
import { dayWords } from '@/lib/ahead-days';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const clock = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const WAY: Record<string, string> = { inside: 'Pickup', curbside: 'Curbside', delivery: 'Delivery' };

export type ComingUpRow = { orderId: string; number: string; name: string | null; day: string; at: string; way: string; people: number | null; items: number; total: number;
  to: string | null; startsAt: string; releaseAt: string; phone: string | null; cancelBy: string | null; failed: string | null; stuck: string | null; today: boolean };

export function ComingUp({ rows, now, busy, act, notify, askPin }: { rows: ComingUpRow[]; now: number; busy: string | null;
  act: (label: string, body: any, after?: (d: any) => void, onFail?: (d: any) => boolean) => void; notify?: (text: string) => void;
  askPin?: (body: any, line: string, done: (d: any) => void) => void }) {
  const [asking, setAsking] = useState<string | null>(null);
  if (!rows.length) return null;
  const week = rows.filter((r) => Date.parse(r.at) - now < 7 * 864e5).length;
  const cancel = (r: ComingUpRow) => {
    const body = { action: 'laterCancel', orderId: r.orderId };
    const done = (d: any) => { setAsking(null); notify?.(`${r.number} canceled. ${usd((Number(d.cents) || 0) / 100)} is going back to their card${r.phone ? ', and they got a text' : ''}.`); };
    act(`lcancel-${r.orderId}`, body, done, (d) => { if (!d.needsManager || !askPin) return false; askPin(body, `It cancels ${r.number} and refunds ${usd(r.total)} to their card. It doesn’t change who’s signed in here.`, done); return true; });
  };
  const send = (r: ComingUpRow) => act(`lsend-${r.orderId}`, { action: 'laterSend', orderId: r.orderId }, () => notify?.(`${r.number} is on the kitchen screen.`));
  return (
    <section aria-labelledby="coming-up-h" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="coming-up-h" className="text-[17px] font-semibold">Coming up</h2>
        {week > 0 && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: SOFT, color: INK }}>{week} {week === 1 ? 'order' : 'orders'} this week</span>}
      </div>
      <ul className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
        {rows.map((r) => { const ask = asking === r.orderId; return (
          <li key={r.orderId} className="space-y-1.5 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <p className="flex items-baseline justify-between gap-3 text-[14.5px]"><span><span className="font-semibold">{dayWords(r.day, true)}, {clock(r.at)}</span> {r.name || r.number}</span><span className="tabular-nums">{usd(r.total)}</span></p>
            <p className="text-[13.5px]" style={{ color: MUTED }}>
              {r.way === 'delivery' && r.to ? `Delivery to ${r.to}` : WAY[r.way] || 'Pickup'}{r.people ? `, ${r.people} people` : ''}, {r.items} {r.items === 1 ? 'item' : 'items'}. {r.failed ? '' : `The kitchen starts it at ${clock(r.startsAt)}.`}
            </p>
            {r.failed && <p role="status" className="rounded-xl px-3 py-2 text-[13.5px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>Couldn’t go to the kitchen: {r.failed} Fix that and it goes by itself, or send it now.</p>}
            {r.stuck && <p role="status" className="rounded-xl px-3 py-2 text-[13.5px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>Canceled, but not all of the refund went back: {r.stuck} Cancel it again to finish.</p>}
            {ask ? (
              <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
                <p className="text-[14px]">Cancel {r.number} and refund {usd(r.total)} to their card?{r.phone ? ' They get a text.' : ''}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" disabled={!!busy} onClick={() => cancel(r)} className={`${btn} whitespace-nowrap sm:flex-1`} style={{ background: INK, color: '#fff' }}>Cancel and refund</button>
                  <button type="button" disabled={!!busy} onClick={() => setAsking(null)} className={`${btn} sm:flex-1`} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Keep it</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(r.today || r.failed) && <button type="button" disabled={!!busy} onClick={() => send(r)} className={btn} style={{ background: r.failed ? INK : '#fff', color: r.failed ? '#fff' : INK, border: r.failed ? 'none' : `1px solid ${LINE}` }}>Send it now</button>}
                <button type="button" disabled={!!busy} onClick={() => setAsking(r.orderId)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{r.stuck ? 'Cancel it again' : 'Cancel and refund'}</button>
                {r.phone && <a href={`tel:+1${r.phone}`} className={`${btn} inline-flex items-center justify-center px-3`} style={{ color: INK, textDecoration: 'underline', textUnderlineOffset: 4 }} aria-label={`Phone ${r.name || r.number}`}>Phone them</a>}
              </div>)}
          </li>); })}
      </ul>
      <p className="text-[12.5px]" style={{ color: MUTED }}>Each one goes to the kitchen screen by itself on its day, under Later until it’s time to start{rows.some((r) => r.way === 'delivery') ? ', and a delivery joins the drivers’ list' : ''}.</p>
    </section>);
}
