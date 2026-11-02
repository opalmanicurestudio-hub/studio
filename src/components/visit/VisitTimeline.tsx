'use client';
// src/components/visit/VisitTimeline.tsx — the client's simple view of their visit (from the visit ticket):
// "Booked · Checked in 1:58 · With Bea 2:04 · Paid". Only stage moves and notes marked for them — never staff notes.
// In the visit link's look: the mood's card and colors, the latest step in the business's color, times on the
// business's clock when it has set its zone.
import * as React from 'react';

export function VisitTimeline({ items, showTimes = true, label = 'Your visit', zone }: { items?: { at: string; text: string }[] | null; showTimes?: boolean; label?: string; zone?: string | null }) {
  const list = (items || []).filter((x) => x && x.text).slice(-8);
  if (!list.length) return null;
  return (
    <section aria-label={label}>
      <p className="px-1 pb-2 text-[13px] font-semibold" style={{ color: 'var(--muted, #6d7075)' }}>{label}</p>
      <ol className="v-grp space-y-2.5 px-4 py-4 text-left text-[14.5px]" style={{ background: 'var(--card, #fff)', borderRadius: 18 }}>
        {list.map((x, i) => {
          const last = i === list.length - 1; const t = new Date(x.at);
          return (
            <li key={`${x.at}-${i}`} className="flex items-baseline gap-3" aria-current={last ? 'step' : undefined}>
              <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: last ? 'var(--accent-text, var(--accent, #16171a))' : 'var(--line, #ececee)', transform: 'translateY(-1px)' }} />
              <span className="flex-1" style={{ fontWeight: last ? 600 : 400 }}>{x.text}</span>
              {showTimes && !isNaN(t.getTime()) && <span className="shrink-0 tabular-nums" style={{ color: 'var(--muted, #6d7075)' }}>{t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) })}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
