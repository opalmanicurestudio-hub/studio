'use client';
// src/components/pos/desk/HereNow.tsx — "HERE NOW" on the front desk (K7): everyone in the building who hasn't started
// yet, from the kiosk, the front door or the desk itself, with what's outstanding and whose move it is.
import type { HereRow } from '@/lib/here-now';
import { Btn } from '@/components/pos/desk/kit';

const toneStyle = (t: 'alert' | 'warn' | 'info') => t === 'alert'
  ? { background: 'color-mix(in srgb, var(--danger, #b91c1c) 12%, transparent)', color: 'var(--danger, #b91c1c)' }
  : t === 'warn' ? { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' }
  : { background: 'var(--soft, #efebe6)' };

export function HereNow({ rows, onOpenVisit, onOpenPickups, onDoorDone }: { rows: HereRow[]; onOpenVisit: (id: string) => void; onOpenPickups: () => void; onDoorDone: (id: string) => void }) {
  if (!rows.length) return null;
  const toDo = rows.filter((r) => r.owner === 'Front desk').length;
  return (
    <section aria-label="Here now" className="mb-4 space-y-2">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>Here now · {rows.length}{toDo ? ` · ${toDo} need the desk` : ''}</p>
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3" style={r.urgent ? { borderColor: 'var(--danger, #fca5a5)', background: 'color-mix(in srgb, var(--danger, #b91c1c) 6%, transparent)' } : { background: 'var(--card, #fff)' }}>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{r.name} <span className="font-normal" style={{ color: 'var(--muted)' }}>· {r.what}</span></p>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{r.waitMin < 1 ? 'Just arrived' : `Here ${r.waitMin} min`} · next: <b style={{ color: 'var(--ink)' }}>{r.owner}</b></p>
            {r.outstanding.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{r.outstanding.map((o) => <span key={o.key} className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={toneStyle(o.tone)}>{o.label}</span>)}</div>}
          </div>
          <div className="flex gap-2">
            {r.kind === 'guest' && r.appointmentId && <Btn quiet onClick={() => onOpenVisit(r.appointmentId!)}>Open visit</Btn>}
            {r.kind === 'door' && r.intent === 'pickup' && <Btn quiet onClick={onOpenPickups}>Open pickups</Btn>}
            {r.kind === 'door' && r.doorId && <Btn onClick={() => onDoorDone(r.doorId!)}>Got it</Btn>}
          </div>
        </div>))}
    </section>);
}
