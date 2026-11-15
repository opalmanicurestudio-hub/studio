'use client';
// src/components/events/TableKindFields.tsx — WHAT KIND OF TABLE IT IS, set on each table of an event's seating chart
// (design canvas "Table shapes"; lib/table-kinds; components/events/SeatingChartTab). Its shape, drawn with its seats,
// what guests should know about it, and a short note. Guests see all of it when they choose their seats.
import * as React from 'react';
import { drawTable, featuresOf, MAX_TABLE_NOTE, shapeOf, TABLE_FEATURES, TABLE_SHAPES, type TableFeature, type TableShape } from '@/lib/table-kinds';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

function Mini({ shape, seats }: { shape: TableShape; seats: number }) {
  const d = drawTable(shape, seats); const k = Math.min(1, 64 / d.w, 44 / d.h);
  return (
    <span aria-hidden className="relative block" style={{ width: d.w * k, height: d.h * k }}>
      <span className="absolute border" style={{ left: d.top.x * k, top: d.top.y * k, width: d.top.w * k, height: d.top.h * k, borderRadius: d.top.round ? '50%' : 4, background: SOFT, borderColor: LINE }} />
      {d.seats.map((p, i) => <span key={i} className="absolute rounded-full" style={{ left: p.x * k - 3.5, top: p.y * k - 3.5, width: 7, height: 7, border: `1.2px solid ${INK}`, background: '#fff', boxSizing: 'border-box' }} />)}
    </span>
  );
}

export default function TableKindFields({ table, onChange }: { table: any; onChange: (patch: { shape?: TableShape; features?: TableFeature[]; note?: string }) => void }) {
  const shape = shapeOf(table); const features = featuresOf(table); const seats = Math.max(1, Number(table?.seatCount) || (Array.isArray(table?.seats) ? table.seats.length : 4));
  const hint = TABLE_SHAPES.find((s) => s.id === shape)?.hint || '';
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <fieldset className="space-y-1.5">
        <legend className="text-[13px] font-semibold">Shape</legend>
        <div className="grid grid-cols-2 gap-2">
          {TABLE_SHAPES.map((s) => (
            <button key={s.id} type="button" aria-pressed={shape === s.id} onClick={() => onChange({ shape: s.id })}
              className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border bg-[#fff] p-2 text-[13px] font-semibold ${RING}`}
              style={shape === s.id ? { borderColor: INK, boxShadow: `inset 0 0 0 1px ${INK}` } : { borderColor: LINE }}>
              <Mini shape={s.id} seats={s.id === 'counter' ? Math.min(seats, 6) : Math.min(seats, 10)} />{s.label}
            </button>))}
        </div>
        <p className="text-[12.5px]" style={{ color: MUTED }}>{hint}</p>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="text-[13px] font-semibold">What guests should know</legend>
        <div className="flex flex-wrap gap-2">
          {TABLE_FEATURES.map((f) => { const on = features.includes(f.id);
            return <button key={f.id} type="button" aria-pressed={on} onClick={() => onChange({ features: on ? features.filter((x) => x !== f.id) : [...features, f.id] })}
              className={`min-h-[44px] rounded-full px-3.5 text-[13px] font-semibold ${RING}`} style={on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{f.label}</button>; })}
        </div>
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-semibold">A note for guests <span className="font-normal" style={{ color: MUTED }}>(optional)</span></span>
        <input value={String(table?.note || '')} maxLength={MAX_TABLE_NOTE} onChange={(e) => onChange({ note: e.target.value })} placeholder="Next to the stage"
          className={`h-11 w-full rounded-xl border bg-[#fff] px-3 text-[14px] ${RING}`} style={{ borderColor: LINE }} />
      </label>
    </div>
  );
}
