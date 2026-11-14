'use client';
// src/components/kitchen/ClosingSheet.tsx — CLOSING on the kitchen screen: tonight's checklist items for the kitchen and
// the bar (lib/night-close), ticked or read right here, so whoever's on the line logs the walk-in and freezer without
// signing in anywhere else. A reading outside its limit asks what was done. Saved through api/kitchen 'closingCheck'.
import { useEffect, useState } from 'react';
import { limitWords, tempOk, type CheckMark, type CloseItem } from '@/lib/night-close';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
type Post = (body: any) => Promise<{ status: number; d: any }>;
const at = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function ClosingSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const [items, setItems] = useState<CloseItem[] | null>(null); const [checks, setChecks] = useState<Record<string, CheckMark>>({});
  const [closed, setClosed] = useState(false); const [err, setErr] = useState('');
  const load = async () => { const { d } = await post({ action: 'closing' }); if (d?.ok) { setItems(d.items); setChecks(d.checks || {}); setClosed(!!d.closed); } else setErr(d?.error || 'The checklist didn’t load.'); };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (item: CloseItem, x: any) => { setErr(''); const { d } = await post({ action: 'closingCheck', itemId: item.id, ...x }); if (!d?.ok) { setErr(d?.error || 'That didn’t save.'); return false; } await load(); return true; };
  const left = (items || []).filter((i) => !checks[i.id]?.done).length;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-labelledby="closing-title">
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 space-y-3" style={{ color: INK }}>
        <div className="flex items-start gap-3">
          <div className="flex-1"><h2 id="closing-title" className="text-[20px] font-semibold">Closing</h2>
            <p className="text-[14px]" style={{ color: MUTED }}>{closed ? 'The night is closed.' : items ? (left ? `${left} left for the kitchen and bar` : 'All done here.') : 'Loading…'}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 rounded-xl grid place-items-center" style={{ border: `1px solid ${LINE}` }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
        {(items || []).map((i) => <Line key={i.id} item={i} m={checks[i.id]} locked={closed} onSave={save} />)}
        {items && !items.length && <p className="text-[14px]" style={{ color: MUTED }}>Nothing on the checklist for the kitchen or bar.</p>}
      </div>
    </div>
  );
}

function Line({ item, m, locked, onSave }: { item: CloseItem; m?: CheckMark; locked: boolean; onSave: (i: CloseItem, x: any) => Promise<boolean> }) {
  const [v, setV] = useState(''); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false);
  const n = Number(v); const reading = v.trim() !== '' && Number.isFinite(n); const out = item.kind === 'temp' && reading && !tempOk(item, n);
  const go = async (x: any) => { setBusy(true); const r = await onSave(item, x); setBusy(false); if (r) { setV(''); setWhy(''); } };
  return (
    <div className="py-2" style={{ borderTop: `1px solid ${LINE}` }}>
      <div className="flex items-center gap-3 min-h-[48px]">
        <span className="h-7 w-7 shrink-0 rounded-full grid place-items-center" style={m?.done ? { background: m.out ? AMBER_TINT : GREEN_TINT } : { border: '1.5px solid #c9cacd' }} aria-hidden>
          {m?.done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={m.out ? AMBER : GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}</span>
        <div className="flex-1 min-w-0"><p className="text-[16px] font-medium">{item.label}</p>
          <p className="text-[13px]" style={{ color: m?.out ? AMBER : MUTED }}>{m?.done ? `${m.by}, ${at(m.at)}${m.out && m.note ? `. ${m.note}` : ''}` : item.kind === 'temp' ? limitWords(item) : item.area === 'bar' ? 'Bar' : item.area === 'kitchen' ? 'Kitchen' : 'Anyone'}</p></div>
        {m?.done && item.kind === 'temp' && <span className="text-[16px] font-semibold tabular-nums" style={{ color: m.out ? AMBER : INK }}>{m.value}°F</span>}
        {!m?.done && !locked && item.kind === 'check' && <button type="button" disabled={busy} onClick={() => go({ done: true })} className="min-h-[48px] rounded-xl px-5 text-[15px] font-semibold text-[#fff]" style={{ background: INK }}>Done</button>}
      </div>
      {!m?.done && !locked && item.kind === 'temp' && (
        <form onSubmit={(e) => { e.preventDefault(); if (reading && (!out || why.trim())) void go({ value: n, ...(why.trim() ? { note: why.trim() } : {}) }); }} className="pl-10 pb-1 space-y-2">
          <div className="flex gap-2 items-center">
            <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.-]/g, '').slice(0, 6))} placeholder="Reading" aria-label={`${item.label} reading in °F`} className="h-12 w-28 rounded-xl px-3 text-[17px] outline-none" style={{ border: `1px solid ${out ? AMBER : LINE}` }} />
            <span className="text-[15px]" style={{ color: MUTED }}>°F</span>
            <button type="submit" disabled={busy || !reading || (out && !why.trim())} className="min-h-[48px] rounded-xl px-5 text-[15px] font-semibold disabled:opacity-40 text-[#fff]" style={{ background: INK }}>Save</button>
          </div>
          {out && <input value={why} onChange={(e) => setWhy(e.target.value.slice(0, 160))} placeholder="Outside the limit. What was done?" aria-label="What was done about it" className="h-12 w-full rounded-xl px-3 text-[15px] outline-none" style={{ border: `1px solid ${AMBER}`, background: AMBER_TINT }} />}
        </form>
      )}
    </div>
  );
}
