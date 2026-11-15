'use client';
// src/components/events/SeatPicker.tsx — CHOOSING SEATS on an event's page (design canvas "Event night"; lib/event-seats).
// The seating chart as a map: each table shows its seats, taken, being paid for, open or chosen. Tapping a table opens
// its seats as buttons below the map; a table with every seat open can be bought whole when the business allows it.
// Nothing about who sits where is shown, only whether a seat is free. Each table is drawn in its own shape, with its
// seats where they really are, and says what kind of table it is (lib/table-kinds).
import * as React from 'react';
import type { MapTable } from '@/lib/event-seats';
import { drawTable } from '@/lib/table-kinds';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d';
export type Pick = { tableId: string; seatId: string };
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const tableWord = (name: string) => (/^\d+$/.test(name) ? `Table ${name}` : name);
/** The label on the map: "Table 12" shows as 12 (the word "Table" is dropped, as the seats match it), a long name cut. */
const short = (name: string) => { const n = name.replace(/^table\s+/i, '').trim() || name; return n.length > 5 ? `${n.slice(0, 4)}…` : n; };


export default function SeatPicker({ tables, picks, max, whole, wholeTables, onPicks, onWhole }: {
  tables: MapTable[]; picks: Pick[]; max: number; whole: string | null; wholeTables: boolean;
  onPicks: (p: Pick[]) => void; onWhole: (tableId: string | null) => void;
}) {
  const [open, setOpen] = React.useState<string | null>(() => picks[0]?.tableId || null);
  // The business's own layout where its tables fit at this width without touching; otherwise the tables in rows.
  const box = React.useRef<HTMLDivElement | null>(null); const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = box.current; if (!el) return; const set = () => setWidth(el.clientWidth);
    set(); if (typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect();
  }, []);
  const sized = tables.map((t) => ({ t, d: drawTable(t.shape || 'round', t.seats.length) }));
  const widest = Math.max(0, ...sized.map((x) => x.d.w));
  const mapW = Math.max(width, Math.max(280, widest + 120)); const mapH = (mapW * 3) / 4;
  const rects = sized.map(({ t, d }) => { const l = Math.min(Math.max(0, ((t.x ?? 0) / 100) * mapW - d.w / 2), mapW - d.w); const tp = Math.min(Math.max(0, ((t.y ?? 0) / 100) * mapH - d.h / 2), mapH - d.h); return { l, t: tp, r: l + d.w, b: tp + d.h }; });
  const touching = rects.some((a, i) => rects.some((b, j) => j > i && a.l < b.r + 6 && b.l < a.r + 6 && a.t < b.b + 6 && b.t < a.b + 6));
  const placed = width > 0 && tables.every((t) => t.x !== null && t.y !== null) && !touching;
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
    const d = drawTable(t.shape || 'round', t.seats.length); const on = open === t.id;
    return (
      <button key={t.id} type="button" onClick={() => setOpen(t.id)} aria-pressed={on}
        aria-label={`${tableWord(t.name)}, ${(t.kind || 'a table').toLowerCase()}: ${openCount(t)} of ${t.seats.length} seats open${mine ? `, ${mine} chosen` : ''}`}
        className={`relative shrink-0 rounded-xl ${RING}`} style={{ width: d.w, height: d.h, ...(placed ? { position: 'absolute', left: rects[tables.indexOf(t)].l, top: rects[tables.indexOf(t)].t } : {}) }}>
        <span className="absolute flex items-center justify-center overflow-hidden border text-[12.5px] font-semibold" style={{ left: d.top.x, top: d.top.y, width: d.top.w, height: d.top.h, borderRadius: d.top.round ? '50%' : 6,
          ...(on ? { background: INK, color: '#fff', borderColor: INK } : { background: SOFT, color: INK, borderColor: LINE }) }}>{short(t.name)}</span>
        {t.seats.map((s, i) => { const c = chosen(t.id, s.id); const p = d.seats[i]; if (!p) return null;
          return <span key={s.id} aria-hidden className="absolute h-[13px] w-[13px] rounded-full" style={{ left: p.x - 6.5, top: p.y - 6.5, boxSizing: 'border-box',
            ...(c ? { background: GREEN } : s.state === 'taken' ? { background: INK } : s.state === 'held' ? { background: '#d9d9dc' } : { background: '#fff', border: `1.5px solid ${INK}` }) }} />; })}
      </button>);
  };


  return (
    <div className="space-y-3">
      <div ref={box} className="overflow-x-auto rounded-2xl border" style={{ borderColor: LINE }}>
        <div className={placed ? 'relative' : 'flex flex-wrap items-center justify-center gap-3 p-3'} style={placed ? { width: mapW, height: mapH } : undefined}>
          {tables.map(table)}
        </div>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ color: MUTED }}>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: '#fff', border: `1.5px solid ${INK}` }} />Open</span>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: INK }} />Taken</span>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: '#d9d9dc' }} />Someone paying now</span>
        <span><span aria-hidden className="mr-1 inline-block h-[11px] w-[11px] rounded-full align-[-1px]" style={{ background: GREEN }} />Yours</span>
      </p>
      {!cur ? <p className="text-[14px]" style={{ color: MUTED }}>Tap a table to see its seats.</p> : (
        <div className="space-y-2">
          <div>
            <p className="text-[15px] font-semibold">{tableWord(cur.name)}</p>
            {cur.kind && <p className="text-[14px]">{cur.kind}.</p>}
            {cur.features?.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5">{cur.features.map((f) => <span key={f} className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: SOFT, color: INK }}>{f}</span>)}</p>}
            {cur.note && <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{cur.note}</p>}
          </div>
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
