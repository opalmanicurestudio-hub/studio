'use client';
// src/components/opportunities/VisitMoments.tsx — BEFORE THEY LEAVE (design canvas OE5): one quiet line each for what's
// worth a word while the client is still here (their next visit with a real open time, balances, products they're likely
// out of, a membership that really would save them money). Used on the staff app's Now card and the planner's
// appointment sheet. Nothing is sent to the client; /api/opportunities (visit).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', BLUE = '#2563eb';
const DOT: Record<string, string> = { next: BLUE, balance: '#1f7a4d', product: MUTED, nudge: MUTED };

export function VisitMoments({ tenantId, appointment, compact = false }: { tenantId: string; appointment: any; compact?: boolean }) {
  const [m, setM] = React.useState<any[] | null>(null);
  const id = String(appointment?.id || ''); const done = ['completed', 'checked_out', 'paid', 'cancelled', 'no_show'].includes(String(appointment?.status || ''));
  React.useEffect(() => { if (!tenantId || !id || !appointment?.clientId || done) { setM([]); return; } let live = true;
    payPost('/api/opportunities', { tenantId, action: 'visit', appointmentId: id }).then((r) => { if (live) setM(r?.ok ? r.moments || [] : []); }); return () => { live = false; }; }, [tenantId, id, appointment?.clientId, done]);
  if (!m || !m.length) return null;
  return (
    <div className={`space-y-1.5 ${compact ? 'rounded-[16px] p-3' : 'rounded-2xl border p-3.5'}`} style={compact ? { background: '#f6f6f7', color: INK } : { borderColor: LINE, color: INK }}>
      <p className="text-[11.5px] font-bold uppercase tracking-[0.06em]" style={{ color: MUTED }}>Before they leave</p>
      {m.map((x) => <div key={x.key} className="flex gap-2"><span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[x.kind] || MUTED }} aria-hidden="true" />
        <div className="min-w-0"><p className="text-[13.5px] leading-snug">{x.line}</p>{x.sub && !compact && <p className="text-[12px] leading-snug" style={{ color: MUTED }}>{x.sub}</p>}</div></div>)}
    </div>);
}
