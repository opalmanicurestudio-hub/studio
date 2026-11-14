'use client';
// src/app/(app)/close/page.tsx — CLOSE THE NIGHT. Anyone on the team ticks the closing checklist and logs the fridge and
// freezer readings (the kitchen screen has its own items too); a reading outside its limit asks what was done. The
// drawer is counted at the front desk; this shows whether it's done. A manager sees the night's report build as the
// night goes, and closes it: the report is kept, the night's tip shares approved when tips are shared by the day, and
// the report emailed. Earlier nights can be opened from the night picker (lib/night-close, api/close).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { limitWords, tempOk, weekdayOf, type CheckMark, type CloseItem, type CloseSettings, type NightReport } from '@/lib/night-close';
import { NightReportView } from '@/components/close/NightReportView';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
type State = { day: string; today: string; closed: boolean; closedAt: string | null; closedBy: string | null; emailedTo: string[]; tipsApproved: boolean; tipsNote: string | null; left: number; settings: CloseSettings; checks: Record<string, CheckMark>; openTills: number; can: { ok: boolean; why: string | null }; manager: boolean; report: NightReport | null };
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const dateWords = (day: string) => { const d = new Date(`${day}T12:00:00Z`); return `${weekdayOf(day)}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`; };

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/close', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export default function ClosePage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [day, setDay] = useState<string>('');
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The whole report (with the night's tip shares) when the page opens or is refreshed; the checklist every half minute.
  const load = useCallback(async (full = false) => { if (!tenantId) return; const d = await post({ tenantId, action: 'state', ...(day ? { day } : {}), ...(full ? { tips: true } : { lite: true }) });
    if (d.ok) { setS((cur) => ({ ...d, report: full || !cur ? d.report : cur.report })); setErr(''); } else setErr(d.error || 'That didn’t load.'); }, [tenantId, day]);
  useEffect(() => { void load(true); const t = setInterval(() => void load(false), 30000); return () => clearInterval(t); }, [load]);

  const mark = async (item: CloseItem, input: { done?: boolean; value?: number; note?: string }) => {
    if (!tenantId || !s) return null; setErr('');
    const d = await post({ tenantId, action: 'check', day: s.day, itemId: item.id, ...input });
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return false; }
    setS({ ...s, checks: d.mark ? { ...s.checks, [item.id]: d.mark } : Object.fromEntries(Object.entries(s.checks).filter(([k]) => k !== item.id)) }); void load(false); return true;
  };
  const close = async () => { if (!tenantId || !s) return; setConfirming(false); setBusy(true); setErr(''); setNote('');
    const d = await post({ tenantId, action: 'close', day: s.day }); setBusy(false);
    if (!d.ok) { setErr(d.error || 'The night didn’t close.'); return; }
    setNote(`${d.emailedTo?.length ? `Closed. The report went to ${d.emailedTo.join(', ')}.` : d.wanted ? 'Closed. The report email didn’t go out; try Send again.' : 'Closed. Add someone to send the report to in closing settings.'}${d.tipsNote ? ` ${d.tipsNote}` : ''}`); void load(true); };
  const resend = async () => { if (!tenantId || !s) return; setBusy(true); setErr(''); const d = await post({ tenantId, action: 'send', day: s.day }); setBusy(false); if (d.ok) setNote(`Sent to ${d.emailedTo.join(', ')}.`); else setErr(d.error || 'That didn’t send.'); };

  const items = s?.settings.items || [];
  const left = items.filter((i) => !s?.checks[i.id]?.done).length + (s?.openTills || 0);
  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Close the night</h1>
            <p className="text-[15px]" style={{ color: MUTED }}>{s ? `${dateWords(s.day)}. ${s.closed ? `Closed by ${s.closedBy} at ${timeOf(s.closedAt)}.` : s.day === s.today ? 'Still open.' : 'Not closed.'}` : 'Loading…'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s?.manager && <input type="date" value={s?.day || ''} max={s?.today} onChange={(e) => setDay(e.target.value)} aria-label="Pick a night" className="min-h-[44px] rounded-xl px-3 text-[14px] bg-[#fff]" style={{ border: `1px solid ${LINE}` }} />}
            {s?.manager && <Link href="/settings/closing" className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14px] font-semibold bg-[#fff]" style={{ border: `1px solid ${LINE}` }}>Closing settings</Link>}
            {s?.manager && !s.closed && <button type="button" onClick={() => void load(true)} className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14px] font-semibold bg-[#fff]" style={{ border: `1px solid ${LINE}` }}>Refresh report</button>}
            {s?.manager && !s.closed && <button type="button" disabled={busy || !s.can.ok} onClick={() => setConfirming(true)} className="min-h-[48px] rounded-2xl px-6 text-[15px] font-semibold disabled:opacity-40 text-[#fff]" style={{ background: INK }}>{s.can.ok ? 'Close the night' : `${left} left before closing`}</button>}
            {s?.manager && s.closed && <button type="button" disabled={busy} onClick={resend} className="min-h-[48px] rounded-2xl px-6 text-[15px] font-semibold disabled:opacity-40 text-[#fff]" style={{ background: INK }}>Send again</button>}
          </div>
        </header>
        {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
        {note && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: GREEN_TINT }} role="status">{note}</p>}
        {s && !s.closed && !s.can.ok && s.manager && <p className="text-[14px]" style={{ color: MUTED }}>{s.can.why}</p>}
        {confirming && s && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#fff] p-6 space-y-4">
              <h2 id="confirm-title" className="text-[20px] font-semibold">Close {weekdayOf(s.day)} night?</h2>
              <p className="text-[15px] leading-relaxed" style={{ color: MUTED }}>The report is kept as it is now and sent. Sales after this won’t be on it, and the checklist locks.{s.left ? ` ${s.left} ${s.left === 1 ? 'item is' : 'items are'} not done and will show that way.` : ''}</p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setConfirming(false)} className="min-h-[48px] rounded-2xl px-5 text-[15px] font-semibold" style={{ border: `1px solid ${LINE}` }}>Not yet</button>
                <button type="button" onClick={close} className="min-h-[48px] rounded-2xl px-5 text-[15px] font-semibold text-[#fff]" style={{ background: INK }}>Close the night</button>
              </div>
            </div>
          </div>
        )}

        {s && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-5 items-start">
            <section className="rounded-3xl bg-[#fff] p-5" aria-labelledby="ck-title">
              <h2 id="ck-title" className="text-[18px] font-semibold">Closing checklist</h2>
              <p className="text-[13px] mb-2" style={{ color: MUTED }}>Kept with the night’s report, ready if an inspector asks.</p>
              <DrawerRow open={s.openTills} />
              {items.map((i) => <ItemRow key={i.id} item={i} m={s.checks[i.id]} locked={s.closed} onMark={mark} />)}
              {!items.length && <p className="text-[14px] py-3" style={{ color: MUTED }}>No checklist set. A manager can add one in closing settings.</p>}
            </section>
            <div className="space-y-3">
              {s.manager && s.report ? <NightReportView r={s.report} /> : <section className="rounded-3xl bg-[#fff] p-5 text-[14px]" style={{ color: MUTED }}>A manager sees the night’s report here and closes the night.</section>}
              {s.manager && s.closed && <p className="text-[13px]" style={{ color: MUTED }}>{s.tipsApproved ? 'The night’s tip shares were approved at close and are on each person’s pay record.' : s.tipsNote || 'Tips weren’t approved at close. They’re on the Money page.'}{s.emailedTo.length ? ` Emailed to ${s.emailedTo.join(', ')}.` : ''}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DrawerRow({ open }: { open: number }) {
  return (
    <div className="flex items-center gap-3 min-h-[56px]" style={{ borderBottom: `1px solid ${LINE}` }}>
      <Dot ok={open === 0} />
      <div className="flex-1 min-w-0"><p className="text-[15px] font-medium">Count and close the drawer</p><p className="text-[12.5px]" style={{ color: open ? AMBER : MUTED }}>{open ? `${open === 1 ? 'A drawer is' : `${open} drawers are`} still open` : 'Done at the front desk'}</p></div>
      {open > 0 && <Link href="/pos" className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14px] font-semibold" style={{ border: `1px solid ${LINE}` }}>Front desk</Link>}
    </div>
  );
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className="h-7 w-7 shrink-0 rounded-full grid place-items-center" style={ok ? { background: warn ? AMBER_TINT : GREEN_TINT } : { border: `1.5px solid #c9cacd` }} aria-hidden>
    {ok && (warn ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2.6" strokeLinecap="round"><path d="M12 7v6M12 16.5v.5" /></svg>
      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>)}
  </span>;
}

function ItemRow({ item, m, locked, onMark }: { item: CloseItem; m?: CheckMark; locked: boolean; onMark: (i: CloseItem, x: { done?: boolean; value?: number; note?: string }) => Promise<boolean | null> }) {
  const [val, setVal] = useState(''); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false);
  const n = Number(val); const reading = val.trim() !== '' && Number.isFinite(n);
  const out = item.kind === 'temp' && reading && !tempOk(item, n);
  const save = async (x: { done?: boolean; value?: number; note?: string }) => { setBusy(true); const r = await onMark(item, x); setBusy(false); if (r) { setVal(''); setWhy(''); } };
  return (
    <div className="py-2 min-h-[56px]" style={{ borderBottom: `1px solid ${LINE}` }}>
      <div className="flex items-center gap-3">
        <Dot ok={!!m?.done} warn={!!m?.out} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium">{item.label}</p>
          <p className="text-[12.5px]" style={{ color: m?.out ? AMBER : MUTED }}>{m?.done ? `${m.by}, ${timeOf(m.at)}${m.out && m.note ? `. ${m.note}` : ''}` : item.kind === 'temp' ? limitWords(item) : AREA_WORD[item.area]}</p>
        </div>
        {m?.done && item.kind === 'temp' && <span className="text-[15px] font-semibold tabular-nums" style={{ color: m.out ? AMBER : INK }}>{m.value}°F</span>}
        {m?.done && !locked && <button type="button" onClick={() => save({ done: false })} disabled={busy} className="min-h-[44px] px-3 text-[13px] font-semibold" style={{ color: MUTED }}>Undo</button>}
        {!m?.done && !locked && item.kind === 'check' && <button type="button" disabled={busy} onClick={() => save({ done: true })} className="min-h-[44px] rounded-xl px-4 text-[14px] font-semibold" style={{ border: `1px solid ${LINE}` }}>Done</button>}
      </div>
      {!m?.done && !locked && item.kind === 'temp' && (
        <form onSubmit={(e) => { e.preventDefault(); if (reading && (!out || why.trim())) void save({ value: n, ...(why.trim() ? { note: why.trim() } : {}) }); }} className="mt-2 pl-10 space-y-2">
          <div className="flex gap-2">
            <input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.-]/g, '').slice(0, 6))} placeholder="Reading" aria-label={`${item.label} reading in °F`} className="h-11 w-28 rounded-xl px-3 text-[15px] outline-none" style={{ border: `1px solid ${out ? AMBER : LINE}` }} />
            <span className="self-center text-[14px]" style={{ color: MUTED }}>°F</span>
            <button type="submit" disabled={busy || !reading || (out && !why.trim())} className="min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40" style={{ border: `1px solid ${LINE}` }}>Save</button>
          </div>
          {out && <input value={why} onChange={(e) => setWhy(e.target.value.slice(0, 160))} placeholder="Outside the limit. What was done? Like moved dairy to the walk-in." aria-label="What was done about it" className="h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ border: `1px solid ${AMBER}`, background: AMBER_TINT }} />}
        </form>
      )}
    </div>
  );
}
const AREA_WORD: Record<string, string> = { kitchen: 'Kitchen', bar: 'Bar', front: 'Front', anyone: 'Anyone' };
