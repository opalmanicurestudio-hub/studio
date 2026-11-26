'use client';
// src/components/staff-portal/PortalBriefing.tsx — THE PRE-SHIFT BRIEFING ON THE TEAM'S PHONES (design board "The
// pre-shift briefing on the team's phones", option B; api/briefing, lib/briefing-server). One line at the top of the
// team portal's Today, on a day with something to act on (a note, a booking worth knowing, the kitchen out or low on
// something): the guests expected and the busiest hour, and whether the manager left a note. Tapped, the
// briefing opens in short, the same as the app's: the note, the bookings worth knowing (allergies first), what's out
// or low in the kitchen, and "Got it" at the end, so the manager sees who read it. A food business's team only (the
// portal shows it where the floor links show); renters never see it.
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { hourWords, type ToKnow } from '@/lib/briefing';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Brief = {
  day: string; guests: { expected: number | null; peak: number | null };
  toKnow: ToKnow[]; kitchen: { soldOut: string[]; low: string[] };
  note: { text: string; by: string; at: string } | null; read: { mine: boolean };
};

async function post(body: any): Promise<any> {
  try {
    const r = await fetch('/api/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false }));
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const clock = (hm: string) => { const [h, m] = String(hm || '').split(':').map(Number); if (!Number.isFinite(h)) return hm; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; };
const first = (s: string) => String(s || '').trim().split(/\s+/)[0] || '';

export function PortalBriefing({ tenantId }: { tenantId: string }) {
  const [b, setB] = React.useState<Brief | null>(null);
  const [open, setOpen] = React.useState(false); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const load = React.useCallback(async () => {
    const d = await post({ action: 'view', tenantId });
    if (d?.ok && d.briefing) setB(d.briefing);
  }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  // Only when there's something to act on: the manager's note, a booking worth knowing (an allergy, a regular), or the
  // kitchen out of or low on something. A plain night adds nothing to Today, so the line is never one to scroll past.
  if (!b || !(b.note || b.toKnow.length || b.kitchen?.soldOut?.length || b.kitchen?.low?.length)) return null;

  const g = b.guests || { expected: null, peak: null };
  const line = [g.expected ? `${g.expected} guest${g.expected === 1 ? '' : 's'}` : '', g.peak !== null && g.peak !== undefined ? `busiest at ${hourWords(g.peak)}` : '', b.note ? `a note from ${first(b.note.by) || 'the manager'}` : '']
    .filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) || 'Before service';
  const gotIt = async () => {
    setBusy(true); setErr('');
    const d = await post({ action: 'read', tenantId, day: b.day });
    setBusy(false);
    // (Left open past midnight: the briefing it was for has gone, so today's is loaded instead.)
    if (!d?.ok) { if (/which day/i.test(String(d?.error || ''))) { setOpen(false); await load(); return; } setErr(d?.error || 'That didn’t go through. Try again.'); return; }
    setB({ ...b, read: { ...b.read, mine: true } }); setOpen(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`flex w-full items-center justify-between gap-3 rounded-2xl border bg-[#fff] px-4 py-3 text-left ${RING}`} style={{ borderColor: LINE, color: INK }}>
        <span className="min-w-0"><span className="block text-[15px] font-semibold">Pre-shift briefing</span>
          <span className="block text-[13px]" style={{ color: MUTED }}>{line}</span></span>
        {b.read.mine
          ? <span className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 text-[14px] font-semibold" style={{ color: GREEN }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>Read</span>
          : <span className="inline-flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Open</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">Pre-shift briefing</DialogTitle>
          <DialogDescription className="sr-only">Tonight’s guests, the manager’s note, bookings worth knowing and the kitchen.</DialogDescription>
          <div className="space-y-4" style={{ color: INK }}>
            {(g.expected || (g.peak !== null && g.peak !== undefined)) ? <div className="flex gap-6">
              {g.expected ? <p><span className="block text-[24px] font-semibold tabular-nums tracking-tight">{g.expected}</span><span className="text-[12.5px]" style={{ color: MUTED }}>guests expected</span></p> : null}
              {g.peak !== null && g.peak !== undefined ? <p><span className="block text-[24px] font-semibold tracking-tight">{hourWords(g.peak)}</span><span className="text-[12.5px]" style={{ color: MUTED }}>busiest hour</span></p> : null}
            </div> : null}
            {b.note && <div className="rounded-2xl px-3 py-2.5 text-[14px] leading-snug" style={{ background: SOFT }}><p className="whitespace-pre-wrap">{b.note.text}</p><p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>{b.note.by}</p></div>}
            <section>
              <p className="text-[13px]" style={{ color: MUTED }}>Bookings worth knowing</p>
              {b.toKnow.length === 0 ? <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Nothing special in the bookings.</p> : <ul className="mt-1">{b.toKnow.slice(0, 8).map((k, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-[14px]" style={{ borderColor: LINE }}>
                  <span><span className="font-semibold tabular-nums">{clock(k.time)}</span> {k.name}, {k.size}</span>
                  <span className="flex flex-wrap gap-1.5">{k.tags.slice(0, 3).map((t, j) => <span key={j} className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={t.warn ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: MUTED }}>{t.text}</span>)}</span>
                </li>))}</ul>}
            </section>
            {(b.kitchen?.soldOut?.length || b.kitchen?.low?.length) ? <section>
              <p className="text-[13px]" style={{ color: MUTED }}>The kitchen</p>
              {b.kitchen.soldOut.length > 0 && <p className="flex justify-between gap-3 border-t py-2 text-[14px]" style={{ borderColor: LINE }}><span>Out</span><span className="text-right" style={{ color: MUTED }}>{b.kitchen.soldOut.join(', ')}</span></p>}
              {b.kitchen.low.length > 0 && <p className="flex justify-between gap-3 border-t py-2 text-[14px]" style={{ borderColor: LINE }}><span>Running low</span><span className="text-right" style={{ color: MUTED }}>{b.kitchen.low.join(', ')}</span></p>}
            </section> : null}
            {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
            {b.read.mine
              ? <p className="flex min-h-[48px] items-center justify-center gap-1.5 text-[15px] font-semibold" style={{ color: GREEN }}>You’ve read it</p>
              : <button type="button" disabled={busy} onClick={() => void gotIt()} className={`flex min-h-[48px] w-full items-center justify-center rounded-full text-[15px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Got it'}</button>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
