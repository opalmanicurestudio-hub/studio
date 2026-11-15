'use client';
// src/components/kitchen/FloorNoteSheet.tsx — TELL THE FLOOR, from the kitchen screen (design canvas "The bar and the
// pass"; api/kitchen 'floorNote', lib/floor-word). A few words ("Fish is 10 minutes out. Push the pasta.") that every
// phone on the floor tonight buzzes with once, and that stay on My tables and the host stand until the kitchen clears
// them, or for 3 hours.
import { useEffect, useRef, useState } from 'react';
import { NOTE_HOURS, NOTE_MAX, type FloorNote } from '@/lib/floor-word';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Post = (body: any) => Promise<{ status: number; d: any }>;

export function FloorNoteSheet({ post, note, onClose, onSent }: { post: Post; note: FloorNote | null; onClose: () => void; onSent: (msg: string) => void }) {
  const [text, setText] = useState(note?.text || ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const send = async (value: string | null) => {
    setBusy(true); setErr('');
    const { status, d } = await post({ action: 'floorNote', text: value });
    setBusy(false);
    if (!d?.ok) { setErr(status === 0 ? 'No connection. Try again in a moment.' : d?.error || 'That didn’t go through.'); return; }
    onSent(value === null ? 'The floor’s message is cleared.' : `Sent to the floor${d.told ? `: ${d.told} ${d.told === 1 ? 'phone' : 'phones'}` : ''}.`); onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="floor-note-title" className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#fff] p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="floor-note-title" className="text-[20px] font-semibold">Tell the floor</h2>
            <p className="text-[14px] mt-1" style={{ color: MUTED }}>Every server’s phone buzzes once. It stays on My tables and the host stand until you clear it, or for {NOTE_HOURS} hours.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${ring}`} style={{ borderColor: LINE }}>×</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(text.trim()); }} className="space-y-3">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX))} placeholder="Fish is 10 minutes out. Push the pasta." aria-label="What the floor should know"
            className="w-full min-h-[52px] rounded-2xl border px-4 text-[17px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !text.trim() || text.trim() === note?.text} className={`min-h-[52px] flex-1 rounded-2xl px-4 text-[16px] font-semibold disabled:opacity-50 ${ring}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Sending…' : 'Send to the floor'}</button>
            {note && <button type="button" disabled={busy} onClick={() => void send(null)} className={`min-h-[52px] rounded-2xl px-4 text-[15px] font-semibold disabled:opacity-50 ${ring}`} style={{ background: SOFT, color: INK }}>Clear it</button>}
          </div>
        </form>
        {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      </div>
    </div>
  );
}
