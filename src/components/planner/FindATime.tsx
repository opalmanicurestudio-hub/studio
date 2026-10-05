'use client';
// src/components/planner/FindATime.tsx — FIND A TIME: the next openings for a service, with a provider or anyone,
// from a date onward. Uses the desk's open-times route (the same availability engine as online booking: hours, days
// off, blocks, other bookings, resources) scanning up to six weeks ahead. Tap an opening → the booking dialog opens on
// that service, provider, day and time.
import * as React from 'react';
import { format } from 'date-fns';
import { qualifiedFor } from '@/lib/availability';

export function FindATime({ tenantId, services, staff, from, isMobile, onBook, onBookGroup, onClose }: {
  tenantId: string; services: any[]; staff: any[]; from: Date; isMobile?: boolean;
  onBook: (x: { serviceId: string; staffId?: string; date: Date; time: string }) => void;
  onBookGroup?: (x: { date: Date; time: string; people: { serviceId: string; staffId: string }[] }) => void;   // a group time → the Book sheet in group mode
  onClose: () => void;
}) {
  const [who, setWho] = React.useState<'one' | 'group'>('one'); const [people, setPeople] = React.useState<string[]>([]);
  const bookable = React.useMemo(() => services.filter((s) => s.status !== 'archived' && s.type !== 'addon' && !s.isAddon).sort((a, b) => String(a.name).localeCompare(String(b.name))), [services]);
  const [serviceId, setServiceId] = React.useState(bookable[0]?.id || ''); const [staffId, setStaffId] = React.useState('any'); const [start, setStart] = React.useState(format(from, 'yyyy-MM-dd'));
  const [busy, setBusy] = React.useState(false); const [result, setResult] = React.useState<any[] | null>(null); const [error, setError] = React.useState<string | null>(null);
  const qualified = React.useMemo(() => { const sv = bookable.find((x) => x.id === serviceId); try { return sv ? qualifiedFor(sv, staff) : staff; } catch { return staff; } }, [bookable, serviceId, staff]);   // the engine's own rule
  const find = async () => { if (!serviceId) return; setBusy(true); setError(null); setResult(null);
    try { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const party = who === 'group' ? [serviceId, ...people].filter(Boolean) : [];
      const r: any = await fetch('/api/appointments/open-times', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, serviceId, staffId, date: start, scanDays: 42, ...(party.length >= 2 ? { party } : {}) }) }).then((x) => x.json()).catch(() => null);
      if (!r?.ok) setError(r?.error || 'Couldn’t look that up — try again.'); else setResult(r.openings || []); } finally { setBusy(false); } };
  React.useEffect(() => { if (who === 'group' && people.length < 1) { setResult(null); return; } void find(); }, [serviceId, staffId, start, who, people.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = (result || []).reduce((m: Map<string, any[]>, o: any) => { m.set(o.date, [...(m.get(o.date) || []), o]); return m; }, new Map<string, any[]>());
  const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties; const field = 'h-11 w-full rounded-xl border px-3 text-[15px]'; const line = { borderColor: 'var(--line, #e7e2dc)', background: 'var(--card, #fff)' } as React.CSSProperties;
  const asDate = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  return (
    <div role="dialog" aria-label="Find a time" className={`fixed inset-0 z-50 flex ${isMobile ? 'items-end' : 'items-center justify-center p-4'}`} style={{ background: 'rgba(28,25,23,.38)' }} onClick={onClose}>
      <div className={isMobile ? 'max-h-[88dvh] w-full overflow-auto rounded-t-[28px] p-4 pb-8' : 'max-h-[86dvh] w-full max-w-lg overflow-auto rounded-[26px] p-5'} style={{ background: 'var(--card, #fff)' }} onClick={(e) => e.stopPropagation()}>
        {isMobile && <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--line, #d6d3d1)' }} />}
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-[20px] font-light">Find a time</h2><button type="button" onClick={onClose} className="text-[14px] font-semibold" style={muted}>Close</button></div>
        <div className="mb-3 inline-flex gap-1 rounded-full p-1" style={{ background: 'var(--soft, #efebe6)' }} role="tablist" aria-label="Who for">{([['one', 'One person'], ['group', 'A group']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={who === k} onClick={() => { setWho(k); if (k === 'group' && !people.length) setPeople([serviceId]); }} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={who === k ? { background: 'var(--ink, #1c1917)', color: '#fff' } : {}}>{l}</button>)}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-[12px] font-semibold sm:col-span-3">{who === 'group' ? 'Person 1' : 'Service'}<select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={field} style={line}>{bookable.map((s) => <option key={s.id} value={s.id}>{s.name}{s.duration ? ` · ${s.duration} min` : ''}</option>)}</select></label>
          {who === 'group' && <div className="space-y-2 sm:col-span-3">{people.map((sid, i) => (
            <div key={i} className="flex items-end gap-2"><label className="flex-1 space-y-1 text-[12px] font-semibold">Person {i + 2}<select value={sid} onChange={(e) => setPeople(people.map((x, j) => (j === i ? e.target.value : x)))} className={field} style={line}>{bookable.map((s) => <option key={s.id} value={s.id}>{s.name}{s.duration ? ` · ${s.duration} min` : ''}</option>)}</select></label>
              <button type="button" onClick={() => setPeople(people.filter((_, j) => j !== i))} aria-label={`Remove person ${i + 2}`} className="h-11 rounded-xl px-3 text-[13px]" style={muted}>Remove</button></div>))}
            {people.length < 11 && <button type="button" onClick={() => setPeople([...people, serviceId])} className="h-10 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>+ Add a person</button>}
            <p className="text-[12px]" style={muted}>Everyone starts together, each with a different provider.</p></div>}
          {who === 'one' && <label className="space-y-1 text-[12px] font-semibold sm:col-span-2">With<select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={field} style={line}><option value="any">Anyone who does it</option>{qualified.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <label className="space-y-1 text-[12px] font-semibold">From<input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={field} style={line} /></label>
        </div>
        <div className="mt-4 space-y-3" aria-live="polite">
          {busy && <p className="text-[14px]" style={muted}>Looking ahead…</p>}
          {error && <p className="text-[14px]" style={{ color: 'var(--warn, #b45309)' }}>{error}</p>}
          {result && !busy && !result.length && <p className="text-[14px]" style={muted}>{who === 'group' ? 'No time in the next six weeks when everyone can start together — try fewer people, or book them back to back.' : `No openings in the next six weeks${staffId !== 'any' ? ' with them — try “Anyone”' : ''}.`}</p>}
          {[...byDay.entries()].map(([d, list]) => (
            <div key={d}><p className="mb-1.5 text-[13px] font-semibold">{format(asDate(d), 'EEEE d MMMM')}</p>
              {Array.isArray(list[0]?.assignment) ? <div className="space-y-2">{list.map((o: any) => (
                <button key={o.time} type="button" onClick={() => onBookGroup?.({ date: asDate(d), time: o.time, people: o.assignment.map((a: any) => ({ serviceId: a.serviceId, staffId: a.staffId })) })} className="block w-full rounded-2xl p-3 text-left text-[14px]" style={{ background: 'var(--soft, #efebe6)' }}>
                  <b>{o.label || o.time}</b> <span style={muted}>· {o.assignment.map((a: any) => `${bookable.find((s) => s.id === a.serviceId)?.name || 'Service'} (${a.staffName || '—'})`).join(', ')}</span></button>))}</div> :
              <div className="flex flex-wrap gap-2">{list.map((o: any) => { const who = o.staff?.[0]; return (
                <button key={o.time + (who?.id || '')} type="button" onClick={() => onBook({ serviceId, staffId: staffId !== 'any' ? staffId : who?.id, date: asDate(d), time: o.time })} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>
                  {o.label || o.time}{staffId === 'any' && who?.name ? <span className="font-normal" style={muted}> · {who.name}{o.staff.length > 1 ? ` +${o.staff.length - 1}` : ''}</span> : null}</button>); })}</div>}</div>))}
        </div>
      </div>
    </div>);
}
