'use client';
// src/components/kitchen/CallSheet.tsx — CALL THE DISH PIT OR THE BARBACK (design canvas "Dish and barback"; lib/back-
// calls, api/back). On the kitchen screen (whichever station it's set to, the bar too) and the barback's screen: one tap
// for what's needed, a few words for "A bottle of…" and "Something else". CallStrip shows this screen's own calls and
// who's on the way, and lets one be cancelled while nobody has taken it.
import { useState } from 'react';
import { CALL_KINDS, NOTE_MAX, TO_WORD, callState, type Call, type CallTo } from '@/lib/back-calls';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Post = (body: any) => Promise<{ status: number; d: any }>;

export function CallSheet({ post, station, only, onClose, onSent }: { post: Post; station: string | null; only?: CallTo; onClose: () => void; onSent: (msg: string) => void }) {
  const [asking, setAsking] = useState<{ to: CallTo; what: string; label: string } | null>(null);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async (to: CallTo, what: string, words?: string) => {
    setBusy(true); setErr('');
    const { status, d } = await post({ action: 'call', to, what, note: words || null, station });
    setBusy(false);
    if (!d?.ok) { setErr(status === 0 ? 'No connection. Try again in a moment.' : d?.error || 'That didn’t go through.'); return; }
    onSent(d.already ? `Already asked. ${callState(d.call)}.` : `Asked ${TO_WORD[to].toLowerCase()}.`); onClose();
  };
  const tap = (to: CallTo, k: { id: string; label: string; needsNote?: boolean }) => { if (k.needsNote) { setAsking({ to, what: k.id, label: k.label }); setNote(''); setErr(''); } else void send(to, k.id); };
  const groups = (only ? [only] : (['dish', 'barback'] as CallTo[]));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="call-title" className="w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="call-title" className="text-[20px] font-semibold">{asking ? asking.label : 'Call'}</h2>
            <p className="text-[14px] mt-1" style={{ color: MUTED }}>{asking ? (asking.what === 'bottle' ? 'Which one?' : 'A few words on what you need.') : 'You’ll see who’s on the way.'}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${ring}`} style={{ borderColor: LINE }}>×</button>
        </div>
        {asking ? (
          <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) void send(asking.to, asking.what, note.trim()); }} className="space-y-3">
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} placeholder={asking.what === 'bottle' ? 'House vodka' : 'Hotel pans to line 2'} aria-label={asking.what === 'bottle' ? 'Which bottle' : 'What you need'}
              className="w-full min-h-[52px] rounded-2xl border px-4 text-[17px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setAsking(null)} className={`min-h-[52px] rounded-2xl px-4 text-[15px] font-semibold ${ring}`} style={{ border: `1px solid ${LINE}` }}>Back</button>
              <button type="submit" disabled={busy || !note.trim()} className={`min-h-[52px] flex-1 rounded-2xl px-4 text-[16px] font-semibold disabled:opacity-50 ${ring}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Asking…' : 'Ask'}</button>
            </div>
          </form>
        ) : groups.map((to) => (
          <div key={to}>
            {groups.length > 1 && <p className="mb-2 text-[13px] font-semibold" style={{ color: MUTED }}>{TO_WORD[to]}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CALL_KINDS[to].map((k) => <button key={k.id} type="button" disabled={busy} onClick={() => tap(to, k)} className={`min-h-[60px] rounded-2xl px-3 text-[15.5px] font-semibold disabled:opacity-50 ${ring}`} style={{ background: SOFT, color: INK }}>{k.label}</button>)}
            </div>
          </div>
        ))}
        {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      </div>
    </div>
  );
}

/** This screen's own calls, and who's on the way. Nothing when there are none. */
export function CallStrip({ calls, post, now, onChanged }: { calls: Call[]; post: Post; now: number; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!calls.length) return null;
  const cancel = async (c: Call) => { setBusy(c.id); await post({ action: 'callStep', id: c.id, step: 'cancel' }); setBusy(null); onChanged(); };
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Your calls" role="status">
      {calls.map((c) => {
        const tone = c.status === 'done' ? { background: GREEN_TINT, color: GREEN } : c.status === 'coming' ? { background: '#fff', color: INK, border: `1px solid ${LINE}` } : { background: AMBER_TINT, color: AMBER };
        return (
          <li key={c.id} className="flex items-center gap-2 rounded-2xl pl-3 pr-1 min-h-[44px] text-[14px]" style={tone}>
            <span><b className="font-semibold">{c.words}</b>, {callState(c, now)}</span>
            {c.status === 'open' ? <button type="button" disabled={busy === c.id} onClick={() => void cancel(c)} className={`min-h-[44px] rounded-xl px-3 text-[13.5px] font-semibold disabled:opacity-50 ${ring}`} style={{ color: INK }} aria-label={`Cancel ${c.words}`}>Cancel</button> : <span className="w-2" />}
          </li>
        );
      })}
    </ul>
  );
}
