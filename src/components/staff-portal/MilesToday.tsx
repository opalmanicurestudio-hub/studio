'use client';
// src/components/staff-portal/MilesToday.tsx — MILES TODAY, on the driver's Deliveries tab (api/drivers/miles; lib/mileage;
// design board "Sold out on the apps too, and every driver's miles kept"). The odometer when they start and when they're
// done; the day's hot food trips beside it, as a check.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', WARN = '#b45309', OK = '#1f7a4d';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Day = { startOdo: number | null; endOdo: number | null; hotTrips: number; hotMilesTenths: number };

export function MilesToday({ tenantId }: { tenantId: string }) {
  const [day, setDay] = React.useState<Day | null>(null); const [busy, setBusy] = React.useState('');
  const [start, setStart] = React.useState(''); const [end, setEnd] = React.useState(''); const [say, setSay] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const call = React.useCallback(async (body: any) => {
    try { const r = await fetch('/api/drivers/miles', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) }); return await r.json().catch(() => ({ ok: false })); }
    catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  React.useEffect(() => { void call({ action: 'today' }).then((d) => { if (d?.ok) { setDay(d.day); setStart(d.day.startOdo !== null && d.day.startOdo !== undefined ? String(d.day.startOdo) : ''); setEnd(d.day.endOdo !== null && d.day.endOdo !== undefined ? String(d.day.endOdo) : ''); } }); }, [call]);
  if (!day) return null;
  const save = async (which: 'start' | 'end', value: string) => {
    setBusy(which); setSay(null);
    const d = await call({ action: 'odometer', which, value });
    setBusy('');
    if (d.ok) { setDay(d.day); setSay({ text: which === 'start' ? 'Saved. Add the end when you’re done.' : d.day.startOdo !== null ? `Saved: ${(d.day.endOdo - d.day.startOdo).toLocaleString('en-US')} miles today.` : 'Saved.' }); }
    else setSay({ text: d.error || 'That didn’t save. Try again.', bad: true });
  };
  const field = `min-h-[48px] min-w-0 flex-1 rounded-xl px-3 text-[16px] ${RING}`;
  const saveBtn = (_on: boolean) => `h-12 rounded-full px-5 text-[15px] font-semibold disabled:opacity-45 ${RING}`;
  const trips = day.hotTrips ? `So far: ${day.hotTrips} hot food ${day.hotTrips === 1 ? 'trip' : 'trips'}, about ${Math.round(day.hotMilesTenths / 10)} miles there and back.` : null;
  return (
    <section aria-labelledby="miles-h" className="space-y-2.5 rounded-[20px] p-4" style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>
      <h3 id="miles-h" className="text-[16px] font-semibold">Miles today</h3>
      <label className="block text-[14px] font-semibold" htmlFor="odo-start">The odometer when you start</label>
      <div className="flex gap-2">
        <input id="odo-start" value={start} onChange={(e) => setStart(e.target.value.replace(/[^\d,.]/g, '').slice(0, 10))} inputMode="numeric" placeholder="Odometer" className={field} style={{ border: `1px solid ${LINE}` }} />
        <button type="button" disabled={!!busy || !start.trim()} onClick={() => void save('start', start)} className={saveBtn(true)} style={day.startOdo === null ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, color: INK }}>{busy === 'start' ? 'Saving…' : 'Save'}</button>
      </div>
      <label className="block text-[14px] font-semibold" htmlFor="odo-end">And when you’re done</label>
      <div className="flex gap-2">
        <input id="odo-end" value={end} onChange={(e) => setEnd(e.target.value.replace(/[^\d,.]/g, '').slice(0, 10))} inputMode="numeric" placeholder="Odometer" className={field} style={{ border: `1px solid ${LINE}` }} />
        <button type="button" disabled={!!busy || !end.trim()} onClick={() => void save('end', end)} className={saveBtn(false)} style={day.startOdo !== null && day.endOdo === null ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, color: INK }}>{busy === 'end' ? 'Saving…' : 'Save'}</button>
      </div>
      {say && <p role={say.bad ? 'alert' : 'status'} className="text-[14px] font-medium" style={{ color: say.bad ? WARN : OK }}>{say.text}</p>}
      {trips && <p className="text-[13px]" style={{ color: MUTED }}>{trips}</p>}
    </section>);
}
