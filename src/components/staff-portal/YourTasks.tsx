'use client';
// src/components/staff-portal/YourTasks.tsx — STAFF APP → Today → "Your tasks" (design canvas Op2). The opportunities
// handed to this person: who, why, roughly what it's worth, when it's due. Tapping one opens it full screen (OppTask):
// the words to use, call or send, and what happened. Nothing shows when there's nothing to do. /api/opportunities.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { payPost } from '@/components/pay/pay-client';
import { OppTask, EST, INK, MUTED, LINE, AMBER } from '@/components/opportunities/OppTask';
import { PLAYBOOKS, type OppKind } from '@/lib/opportunities';

export function YourTasks({ tenantId, accent = INK }: { tenantId: string; accent?: string }) {
  const [items, setItems] = React.useState<any[] | null>(null); const [openId, setOpenId] = React.useState<string | null>(null); const [all, setAll] = React.useState(false);
  const load = React.useCallback(() => payPost('/api/opportunities', { tenantId, action: 'list' }).then((r) => setItems(r.ok ? r.items : [])), [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  const open = (items || []).filter((o) => o.status === 'open');
  const sel = (items || []).find((o) => o.id === openId) || null;
  if (!open.length && !sel) return null;
  const dueWord = (iso: string) => { const t = new Date(iso); const eod = new Date(); eod.setHours(23, 59, 59, 999); if (t <= eod) return 'Due today'; if (t.getTime() <= eod.getTime() + 864e5) return 'Due tomorrow'; return t.getTime() - eod.getTime() < 6 * 864e5 ? `Due ${t.toLocaleDateString('en-US', { weekday: 'short' })}` : `Due ${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; };
  const shown = all ? open : open.slice(0, 3);
  return (
    <section className="space-y-2.5" aria-label="Your tasks" style={{ color: INK }}>
      <div className="flex items-end justify-between px-1"><div><p className="text-[18px] font-semibold">Your tasks</p><p className="text-[12.5px]" style={{ color: MUTED }}>{open.length} to do · between clients</p></div>
        {open.length > 3 && <button type="button" onClick={() => setAll(!all)} className="text-[13px] font-semibold" style={{ color: accent }}>{all ? 'Fewer' : `All ${open.length}`}</button>}</div>
      {shown.map((o, i) => <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="flex w-full flex-col gap-1.5 rounded-[18px] border bg-white p-3.5 text-left" style={{ borderColor: i === 0 ? INK : LINE }}>
        <span className="flex items-start justify-between gap-2"><span className="text-[15.5px] font-bold">{o.title || o.clientName}</span><EST cents={o.valueCents || 0} note={o.valueNote} /></span>
        <span className="text-[13px] leading-snug" style={{ color: MUTED }}>{o.why}</span>
        <span className="flex items-center justify-between"><span className="text-[12.5px]" style={{ color: o.priority === 'high' ? AMBER : MUTED }}>{PLAYBOOKS[o.kind as OppKind]?.label} · {dueWord(o.dueAt || o.expiresAt)}</span>
          <span className="inline-flex h-9 items-center rounded-full px-4 text-[13.5px] font-semibold" style={i === 0 ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}` }}>{i === 0 ? 'Start' : 'Open'}</span></span></button>)}
      {sel && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[80] overflow-y-auto" style={{ background: '#fff' }} role="dialog" aria-label="Task">
          <div className="mx-auto max-w-[520px] px-4 pb-10 pt-5"><OppTask tenantId={tenantId} item={sel} onClose={() => setOpenId(null)} onChanged={(closed) => { void load().then(() => { if (closed) setOpenId(null); }); }} /></div></div>, document.body)}
    </section>);
}
