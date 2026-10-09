'use client';
// src/components/pos/desk/PrepPlan.tsx — PREP BY PROVIDER. Each provider's next visits in order, with the exact kit and
// linen bundle set aside for each one and whether it's ready (green), will be ready in time (amber, with the time), or
// won't be (red). Re-plans live from the set-aside plan; a provider's own screen passes `staffId` to see just theirs.
import * as React from 'react';
import { Initials } from '@/components/pos/desk/hk-ui';
import type { SetVisit, SetItem } from '@/lib/setaside';

const clock = (v: number) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
const LOOK: Record<SetItem['state'], { bg: string; fg: string; dot: string }> = {
  ready: { bg: '#e3f3e7', fg: '#1f6b3a', dot: '#1f6b3a' }, in_time: { bg: '#fdf1dc', fg: '#7a4a00', dot: '#c47f00' },
  late: { bg: '#fbeae8', fg: '#b42318', dot: '#b42318' }, none: { bg: '#fbeae8', fg: '#b42318', dot: '#b42318' } };

export function PrepPlan({ plan, staff, staffId, perProvider = 4, title = 'Prep by provider', onSetOut, setOut = {} }: { plan: { visits: SetVisit[] }; staff: any[]; staffId?: string | null; perProvider?: number; title?: string; onSetOut?: (item: SetItem, visit: SetVisit) => void; setOut?: Record<string, string> }) {
  const rows = plan.visits.filter((v) => v.items.length && (!staffId || v.staffId === staffId));
  if (!rows.length) return null;
  const groups = new Map<string, SetVisit[]>();
  for (const v of rows) { const k = v.staffId || '—'; if (!groups.has(k)) groups.set(k, []); if (groups.get(k)!.length < perProvider) groups.get(k)!.push(v); }
  const nameOf = (id: string) => staff.find((m: any) => m.id === id)?.name || 'Unassigned';
  const issues = rows.filter((v) => !v.ok).length;
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-[700]">{title}</p>
        <p className="text-[12px]" style={{ color: issues ? '#b42318' : 'var(--muted, #6a655d)' }}>{issues ? `${issues} visit${issues === 1 ? '' : 's'} short` : 'Everything set aside'}</p>
      </div>
      <div className={staffId ? '' : 'flex snap-x gap-3 overflow-x-auto pb-1'}>
        {[...groups.entries()].map(([sid, list]) => (
          <div key={sid} className={`${staffId ? '' : 'w-[290px] shrink-0 snap-start'} rounded-[20px] bg-white p-3 shadow-[0_1px_0_rgba(23,24,26,0.04),0_8px_22px_-14px_rgba(23,24,26,0.25)]`} style={{ border: '1px solid #ece6dd' }}>
            {!staffId && <div className="mb-2 flex items-center gap-2"><Initials name={nameOf(sid)} size={30} /><p className="truncate text-[14px] font-[700]">{String(nameOf(sid)).split(' ')[0]}</p></div>}
            <ol className="space-y-2">
              {list.map((v) => (
                <li key={v.visitId} className="rounded-2xl p-2.5" style={{ background: v.ok ? '#faf8f5' : '#fdf3f2' }}>
                  <p className="text-[14px]"><b className="font-[800] tabular-nums">{clock(v.startMs)}</b> <span className="font-[600]">{v.clientName.split(' ')[0]}</span></p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {v.items.map((it, i) => { const L = LOOK[it.state]; const isOut = !!(it.refId && setOut[it.refId] === v.visitId); const canSet = !!onSetOut && it.state === 'ready' && !!it.refId && !isOut;
                      const inner = <>
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: isOut ? '#17181A' : L.dot }} />
                        {it.type}{it.code ? <span className="font-[800] tracking-[0.04em]">{it.code}</span> : null}
                        <span className="font-[500] opacity-80">{isOut ? '· set out ✓' : canSet ? '· set out' : it.state === 'ready' ? '' : `· ${it.note.replace(/^Ready /, '').replace(/^Not before /, 'after ').replace(/\s?[AP]M\b/gi, '')}`}</span></>;
                      return canSet
                        ? <button key={i} type="button" onClick={() => onSetOut!(it, v)} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-[600]" style={{ background: L.bg, color: L.fg, border: `1px dashed ${L.dot}` }} title="Tap when it's set out at the station">{inner}</button>
                        : <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-[600]" style={{ background: isOut ? '#EDE8E1' : L.bg, color: isOut ? '#17181A' : L.fg }} title={it.note}>{inner}</span>; })}
                  </div>
                </li>))}
            </ol>
          </div>))}
      </div>
    </section>);
}
