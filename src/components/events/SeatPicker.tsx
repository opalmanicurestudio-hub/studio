'use client';
// src/components/events/SeatPicker.tsx — CHOOSING SEATS on an event's page (design canvas "Event night"; lib/event-seats).
// The seating chart as a map: each table shows its seats, taken, being paid for, open or chosen. Tapping a table opens
// its seats as buttons below the map; a table with every seat open can be bought whole when the business allows it.
// Nothing about who sits where is shown, only whether a seat is free.
import * as React from 'react';
import type { MapTable } from '@/lib/event-seats';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d';
export type Pick = { tableId: string; seatId: string };
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const tableWord = (name: string) => (/^\d+$/.test(name) ? `Table ${name}` : name);

/** Where each seat sits around its table, as a share of the table's box. */
const around = (i: number, n: number) => { const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2; return { left: `${50 + Math.cos(a) * 42}%`, top: `${50 + Math.sin(a) * 42}%` }; };

export default function SeatPicker({ tables, picks, max, whole, wholeTables, onPicks, onWhole }: {
  tables: MapTable[]; picks: Pick[]; max: number; whole: string | null; wholeTables: boolean;
  onPicks: (p: Pick[]) => void; onWhole: (tableId: string | null) => void;
}) {
  const [open, setOpen] = React.useState<string | null>(() => picks[0]?.tableId || null);
  const placed = tables.every((t) => t.x !== null && t.y !== null);
  const chosen = (t: string, s: string) => (whole ? whole === t : picks.some((p) => p.tableId === t && p.seatId === s));
  const toggle = (t: string, s: string) => {
    if (whole) onWhole(null);
    const on = picks.some((p) => p.tableId === t && p.seatId === s);
    if (on) onPicks(picks.filter((p) => !(p.tableId === t && p.seatId === s)));
    else if (picks.length < max) onPicks([...picks, { tableId: t, seatId: s }]);
  };
  const cur = tables.find((t) => t.id === open) || null;
  const openCount = (t: MapTable) => t.seats.filter((s) => s.state === 'open').length;

  const table = (t: MapTable) => {
    const mine = t.seats.filter((s) => chosen(t.id, s.id)).length;
    return (
      <button key={t.id} type="button" onClick={() => setOpen(t.id)} aria-pressed={open === t.id}
        aria-label={`${tableWord(t.name)}: ${openCount(t)} of ${t.seats.length} seats open${mine ? `, ${mine} chosen` : ''}`}
        className={`relative h-[84px] w-[84px] shrink-0 rounded-full ${RING}`} style={placed ? { position: 'absolute', left: `calc(${t.x}% - 42px)`, top: `calc(${t.y}% - 42px)` } : undefined}>
        <span className="absolute inset-[21px] flex items-center justify-center rounded-full border text-[13px] font-semibold"
          style={open === t.id ? { background: INK, color: '#fff', borderColor: INK } : { background: SOFT, color: INK, borderColor: LINE }}>{t.name.length > 4 ? t.name.slice(0, 3) : t.name}</span>
        {t.seats.map((s, i) => { const c = chosen(t.id, s.id);
          return <span key={s.id} aria-hidden className="absolute h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ ...around(i, t.seats.length), boxSizing: 'border-box',
            ...(c ? { background: GREEN } : s.state === 'taken' ? { background: INK } : s.state === 'held' ? { background: '#d9d9dc' } : { background: '#fff', border: `1.5px solid ${INK}` }) }} />; })}
      </button>);
  };

  return (
    <div className="space-y-3">
      <div className={placed ? 'relative w-full overflow-hidden rounded-2xl border' : 'flex flex-wrap justify-center gap-3 rounded-2xl border p-3'} style={{ borderColor: LINE, ...(placed ? { aspectRatio: '4 / 3' } : {}) }}>
        {tables.map(table)}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ color: MUTED }}>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: '#fff', border: `1.5px solid ${INK}` }} />Open</span>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: INK }} />Taken</span>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: '#d9d9dc' }} />Someone paying now</span>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: GREEN }} />Yours</span>
      </p>
      {!cur ? <p className="text-[14px]" style={{ color: MUTED }}>Tap a table to see its seats.</p> : (
        <div className="space-y-2">
          <p className="text-[15px] font-semibold">{tableWord(cur.name)}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`Seats at ${tableWord(cur.name)}`}>
            {cur.seats.map((s) => { const c = chosen(cur.id, s.id); const can = s.state === 'open';
              return <button key={s.id} type="button" disabled={!can || (!c && !whole && picks.length >= max)} aria-pressed={c} onClick={() => toggle(cur.id, s.id)}
                aria-label={`Seat ${s.label}${s.state === 'taken' ? ', taken' : s.state === 'held' ? ', someone is paying for it' : ''}`}
                className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-[15px] font-semibold tabular-nums disabled:opacity-40 ${RING}`}
                style={c ? { background: GREEN, color: '#fff', borderColor: GREEN } : { background: '#fff', color: INK, borderColor: LINE }}>{s.label}{!can && <span className="block text-[11px] font-medium leading-none">{s.state === 'taken' ? 'Taken' : 'Paying'}</span>}</button>; })}
          </div>
          {wholeTables && cur.wholeOpen && (
            <button type="button" aria-pressed={whole === cur.id} onClick={() => { onPicks([]); onWhole(whole === cur.id ? null : cur.id); }}
              className={`min-h-[44px] w-full rounded-xl border px-4 text-[15px] font-semibold ${RING}`}
              style={whole === cur.id ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', color: INK, borderColor: LINE }}>
              {whole === cur.id ? `All ${cur.seats.length} seats at ${tableWord(cur.name).toLowerCase()} chosen` : `Buy the whole table, all ${cur.seats.length} seats`}</button>)}
          {!whole && picks.length >= max && <p className="text-[13px]" style={{ color: MUTED }}>That’s the most at once ({max}).{wholeTables ? ' A bigger group can buy a whole table.' : ''}</p>}
        </div>)}
    </div>
  );
}
