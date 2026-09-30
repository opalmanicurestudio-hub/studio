'use client';
// src/components/visit/VisitTimeline.tsx — the client's simple view of their visit (from the visit ticket):
// "Booked · Checked in 1:58 · With Bea 2:04 · Paid". Only stage moves and notes marked for them — never staff notes.
import * as React from 'react';

export function VisitTimeline({ items, showTimes = true }: { items?: { at: string; text: string }[] | null; showTimes?: boolean }) {
  const list = (items || []).filter((x) => x && x.text).slice(-8);
  if (!list.length) return null;
  return (
    <ol className="space-y-2 rounded-3xl bg-white p-5 text-left text-[14px] shadow-sm" aria-label="Your visit">
      <li className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">Your visit</li>
      {list.map((x, i) => (
        <li key={`${x.at}-${i}`} className="flex items-baseline gap-3">
          <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i === list.length - 1 ? 'var(--accent, #1c1917)' : '#d6d0c8' }} />
          <span className="flex-1">{x.text}</span>
          {showTimes && <span className="shrink-0 tabular-nums text-stone-500">{new Date(x.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
        </li>
      ))}
    </ol>
  );
}
