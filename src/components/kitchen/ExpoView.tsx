'use client';
// src/components/kitchen/ExpoView.tsx — EXPO on the kitchen screen: each table's course (or each order) as one run, with
// every plate from every station and where it's up to. A run goes out only when all of it is ready, so a table never
// gets its mains one plate at a time. Beside it, what tables have held and not fired yet (lib/table-service), so the
// pass sees what's coming. It moves tickets with the screen's own bump (api/kitchen), the same as everywhere else. Each
// plate with an allergy says whether its station has noted it; a run with one not noted waits until someone has (the
// pass can tap it here).
import { useMemo } from 'react';
import { allergyFlags, needsAllergyNote, type KitchenTicket } from '@/lib/kitchen';
import { expoGroups, unfiredGroups, type ExpoTicket } from '@/lib/table-service';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const GREEN_TINT = '#eaf6ef', AMBER_TINT = '#fff7ed';
const LATE_S = 8 * 60;

const mins = (s: number) => (s < 60 ? 'just now' : `${Math.floor(s / 60)} min`);

export function ExpoView({ tickets, unfired, now, busyIds, onBump, onNote }: {
  tickets: KitchenTicket[]; unfired: KitchenTicket[]; now: number; busyIds: Set<string>;
  onBump: (list: KitchenTicket[], s: 'ready' | 'deliver') => void; onNote: (t: KitchenTicket) => void;
}) {
  const groups = useMemo(() => expoGroups(tickets as unknown as ExpoTicket[]), [tickets]);
  const coming = useMemo(() => unfiredGroups(unfired as unknown as ExpoTicket[]), [unfired]);
  const toNote = (g: { tickets: unknown[] }) => (g.tickets as KitchenTicket[]).filter((t) => needsAllergyNote(t));
  const runnable = groups.filter((g) => g.allReady && !toNote(g).length).length;
  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <section className="flex-1 min-w-0 w-full space-y-3" aria-label="Ready to run">
        <p className="px-1 text-[14px]" style={{ color: MUTED }}>{groups.length} {groups.length === 1 ? 'run' : 'runs'} cooking, {runnable} ready to go out</p>
        {groups.length === 0
          ? <p className="rounded-2xl px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>Nothing cooking. Fired courses and orders show here.</p>
          : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
            {groups.map((g) => {
              const list = g.tickets as unknown as KitchenTicket[];
              const waitingOn = g.total - g.ready;
              const s = Math.max(0, Math.round((now - Date.parse(g.at)) / 1000));
              const late = !g.allReady && Number.isFinite(s) && s >= LATE_S;
              const busy = list.some((t) => busyIds.has(t.id));
              const allergy = list.some((t) => allergyFlags(t).any);
              const unnoted = toNote(g); const canRun = g.allReady && !unnoted.length;
              return (
                <article key={g.key} className="rounded-3xl bg-[#fff] p-4 flex flex-col gap-1" style={canRun ? { boxShadow: `inset 0 0 0 2px ${GREEN}` } : undefined}>
                  <div className="flex items-start gap-2 pb-2 mb-1" style={{ borderBottom: `1px solid ${LINE}` }}>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[19px] font-semibold leading-tight truncate" style={{ color: INK }}>{g.label}</h3>
                      <p className="text-[13px]" style={{ color: MUTED }}>{g.sub}, fired {mins(s)} ago</p>
                    </div>
                    <span className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={canRun ? { background: GREEN_TINT, color: GREEN } : g.allReady || late ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }}>
                      {g.allReady && !unnoted.length ? 'All ready' : g.allReady ? 'Allergy to note' : late ? `${Math.floor(s / 60)} min` : `Waiting on ${waitingOn}`}
                    </span>
                  </div>
                  {allergy && <p className="rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Allergy on this run. Check each plate.</p>}
                  {list.map((t) => (
                    <div key={t.id} className="grid items-center gap-2 min-h-[40px]" style={{ gridTemplateColumns: '26px 1fr auto' }}>
                      <span className="h-6 w-6 rounded-full grid place-items-center text-[12px] font-semibold" style={{ background: t.seatNumber ? SOFT : 'transparent' }}>{t.seatNumber || ''}</span>
                      <span className="min-w-0 text-[14px] font-medium leading-tight" style={{ color: INK }}>{t.item}{t.quantity > 1 ? ` × ${t.quantity}` : ''}{t.remake ? ', remake' : ''}
                        <span className="block text-[12px] font-normal" style={{ color: MUTED }}>{[t.madeAt, t.choices, t.note].filter(Boolean).join(', ')}</span>
                        {allergyFlags(t).any && <span className="block text-[12px] font-semibold" style={{ color: AMBER }}>{allergyFlags(t).listed.map((a) => a.name).join(', ') || 'Allergy'}{t.allergyNotedAt ? `, noted${t.allergyNotedBy ? ` by ${t.allergyNotedBy}` : ''}` : ', not noted yet'}</span>}</span>
                      {needsAllergyNote(t) && t.status === 'ready'
                        ? <button type="button" disabled={busyIds.has(t.id)} onClick={() => onNote(t)} className="min-h-[44px] rounded-xl px-3 text-[13px] font-semibold text-[#fff]" style={{ background: AMBER }}>Allergy noted</button>
                        : <span className="text-[13px] font-semibold" style={{ color: t.status === 'ready' ? GREEN : t.status === 'in_progress' ? INK : AMBER }}>{t.status === 'ready' ? 'Ready' : t.status === 'in_progress' ? 'Making' : 'Waiting'}</span>}
                    </div>
                  ))}
                  <button type="button" disabled={!canRun || busy} onClick={() => onBump(list, 'deliver')}
                    className="mt-2 min-h-[48px] rounded-2xl text-[15px] font-semibold disabled:cursor-not-allowed"
                    style={canRun ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}`, color: MUTED }}>
                    {canRun ? `Run ${g.label}` : g.allReady ? 'Note the allergy first' : `Runs when all ${g.total} are ready`}
                  </button>
                </article>
              );
            })}
          </div>}
      </section>
      <aside className="w-full lg:w-[284px] shrink-0 rounded-3xl bg-[#fff] p-5 space-y-3" aria-label="Held, not fired">
        <h2 className="text-[17px] font-semibold" style={{ color: INK }}>Held, not fired</h2>
        <p className="text-[13px] -mt-2" style={{ color: MUTED }}>The server fires these from the table. You see what’s coming.</p>
        {coming.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Nothing held.</p> : coming.slice(0, 12).map((c, i) => (
          <div key={c.key} className="space-y-0.5 pt-3" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
            <div className="flex justify-between gap-2 text-[15px] font-semibold"><span>{c.label}</span><span className="font-medium" style={{ color: MUTED }}>{c.course}</span></div>
            <p className="text-[13px]" style={{ color: MUTED }}>{c.count} {c.count === 1 ? 'plate' : 'plates'}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}
