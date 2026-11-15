'use client';
// src/components/back/CallList.tsx — WHAT'S BEEN ASKED FOR, on the dish and barback screens (lib/back-calls, api/back):
// each call big enough to read from across the room, the longest waiting first (amber once the managers have been told),
// "On my way" so nobody doubles up, "Done" when it's there, and "Not me after all" for whoever took it.
import type { Call } from '@/lib/back-calls';
import { AMBER, AMBER_TINT, GREEN, INK, LINE, MUTED, big, btn, first } from '@/components/back/screen-kit';

export type QueueCall = Call & { mins: number; late: boolean };

export function CallList({ calls, me, busy, empty, onStep }: { calls: QueueCall[]; me: { id: string | null; name: string | null }; busy: boolean; empty: string; onStep: (c: QueueCall, step: 'coming' | 'done' | 'release') => void }) {
  if (!calls.length) return <p className="rounded-2xl bg-[#fff] px-4 py-5 text-[15px]" style={{ color: MUTED }}>{empty}</p>;
  return (
    <ul className="space-y-2">{calls.map((c) => {
      const mine = c.status === 'coming' && (c.takenById ? c.takenById === me.id : !!me.name && c.takenBy === me.name);
      return (
        <li key={c.id} className="rounded-2xl border p-4 space-y-3" style={c.late ? { background: AMBER_TINT, borderColor: '#f3c99a' } : { background: '#fff', borderColor: LINE }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-[18px] font-semibold leading-snug">{c.words}</p><p className="text-[14px]" style={{ color: MUTED }}>{[c.from, first(c.askedBy)].filter(Boolean).join(', ')}</p></div>
            <span className="shrink-0 text-[13.5px] tabular-nums" style={{ color: c.late ? AMBER : MUTED }}>{c.status === 'coming' ? (mine ? 'You’re on it' : `${first(c.takenBy)} on the way`) : c.mins < 1 ? 'Just now' : `${c.mins} min`}</span>
          </div>
          {c.status === 'open'
            ? <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => onStep(c, 'coming')} className={`${big} flex-1`} style={{ background: INK, color: '#fff' }}>On my way</button>
                <button type="button" disabled={busy} onClick={() => onStep(c, 'done')} className={big} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Done</button></div>
            : <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => onStep(c, 'done')} className={`${big} flex-1`} style={{ background: GREEN, color: '#fff' }}>Done</button>
                {mine && <button type="button" disabled={busy} onClick={() => onStep(c, 'release')} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Not me after all</button>}</div>}
        </li>
      );
    })}</ul>
  );
}
