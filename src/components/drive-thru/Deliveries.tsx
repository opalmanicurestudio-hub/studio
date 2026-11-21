'use client';
// src/components/drive-thru/Deliveries.tsx — HOT FOOD DELIVERIES ON THE COUNTER PAGE (lib/food-delivery-server, read with
// the counter's lane). Ready ones first (hot food waiting on a driver: leave now), then the ones being made, out with a
// driver, and couldn't be delivered; delivered ones last. Out for delivery, Delivered, and Couldn't deliver (why) go to
// api/counter. Who's driving is picked once on this screen (kept on this device): one of the business's drivers (their tip
// is theirs), someone else by name, or whoever is signed in. Drivers can also take hot food from their own phone.
import { useEffect, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const GREEN_TINT = '#ecf6f0', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const DRIVER_KEY = 'cf.counter.driver';
const REASONS = [
  { code: 'no_answer', label: 'No one answered' },
  { code: 'no_access', label: 'Couldn’t get in' },
  { code: 'bad_address', label: 'Wrong or missing address' },
  { code: 'other', label: 'Something else' },
];

export type FoodDriver = { id: string; name: string };
export type DeliveryRow = { orderId: string; number: string; name: string | null; to: string; note: string | null; arriveAt: string | null; driveMin: number;
  step: 'making' | 'ready' | 'out' | 'delivered' | 'failed'; readyFor: number | null; leaveAt: string | null; driver: string | null; outAt: string | null; deliveredAt: string | null;
  why: string | null; phone: string | null; tip?: number;
  /** Ready: another ready one going the same way (adds a few minutes to the trip, both on time). */
  with?: { orderId: string; number: string; addMin: number } | null };

const clock = (iso: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const since = (iso: string | null, now: number) => Math.max(0, Math.floor((now - (Date.parse(String(iso || '')) || now)) / 60000));

export function Deliveries({ rows, drivers = [], now, busy, act }: { rows: DeliveryRow[]; drivers?: FoodDriver[]; now: number; busy: string | null;
  act: (label: string, body: any, after?: (d: any) => void) => void }) {
  // Kept as 'id:<their team record>' for one of the drivers, or the name typed for someone else.
  const [driver, setDriver] = useState(''); const [other, setOther] = useState(false); const [failing, setFailing] = useState<string | null>(null);
  useEffect(() => { try { const v = localStorage.getItem(DRIVER_KEY) || ''; setDriver(v); setOther(!!v && !v.startsWith('id:')); } catch { /* private window */ } }, []);
  const keepDriver = (v: string) => { setDriver(v); try { if (v.trim()) localStorage.setItem(DRIVER_KEY, v.trim()); else localStorage.removeItem(DRIVER_KEY); } catch { /* private window */ } };
  if (!rows.length) return null;
  const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
  const going = rows.filter((r) => r.step !== 'delivered'); const done = rows.filter((r) => r.step === 'delivered');
  const pickedId = driver.startsWith('id:') && drivers.some((d) => d.id === driver.slice(3)) ? driver.slice(3) : '';
  const outBody = (r: DeliveryRow) => ({ action: 'deliveryOut', orderId: r.orderId, ...(pickedId ? { driverId: pickedId } : (other || !drivers.length) && driver.trim() && !driver.startsWith('id:') ? { driver: driver.trim() } : {}) });
  const out = (r: DeliveryRow) => act(`dout-${r.orderId}`, outBody(r));
  // Two ready ones going the same way: offered once, on the first of the two in the list.
  const pairOf = (r: DeliveryRow): DeliveryRow | null => {
    const w = r.with ? going.find((x) => x.orderId === r.with!.orderId && x.step === 'ready') : null;
    if (!w) return null;
    return going.indexOf(w) > going.indexOf(r) || w.with?.orderId !== r.orderId ? w : null;
  };
  const field = `block min-h-[44px] rounded-xl px-3 text-[15px] font-normal ${RING}`;
  return (
    <section aria-labelledby="counter-deliveries" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="counter-deliveries" className="text-[17px] font-semibold">Deliveries</h2>
          <p className="text-[13px]" style={{ color: MUTED }}>Hot food goes out as soon as it’s ready.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {drivers.length > 0 && <label className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: MUTED }}>Driver
            <select value={pickedId ? `id:${pickedId}` : other ? 'other' : ''} onChange={(e) => { const v = e.target.value; setOther(v === 'other'); keepDriver(v === 'other' ? '' : v); }}
              className={`${field} w-[190px] bg-[#fff]`} style={{ border: `1px solid ${LINE}`, color: INK }}>
              <option value="">Whoever’s signed in</option>
              {drivers.map((d) => <option key={d.id} value={`id:${d.id}`}>{d.name}</option>)}
              <option value="other">Someone else</option>
            </select></label>}
          {(drivers.length === 0 || other) && <label className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: MUTED }}>{drivers.length ? <span className="sr-only">Their name</span> : 'Driver'}
            <input value={driver.startsWith('id:') ? '' : driver} onChange={(e) => keepDriver(e.target.value.slice(0, 40))} placeholder={drivers.length ? 'Their name' : 'Whoever’s signed in'} autoComplete="off"
              className={`${field} w-[190px]`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>}
        </div>
      </div>
      {going.length > 0 && <ul className="grid grid-cols-1 items-start gap-2.5 lg:grid-cols-2">{going.map((r) => {
        const chip = r.step === 'ready' ? { text: `Ready ${r.readyFor ? `${r.readyFor} min` : 'now'}: leave now`, style: { background: AMBER_TINT, color: AMBER } }
          : r.step === 'out' ? { text: `Out with ${r.driver || 'a driver'}, ${since(r.outAt, now)} min`, style: { background: SOFT, color: INK } }
          : r.step === 'failed' ? { text: `Couldn’t deliver: ${r.why || 'see why'}`, style: { background: AMBER_TINT, color: AMBER } }
          : { text: r.arriveAt ? `Arrive by ${clock(r.arriveAt)}` : 'Being made', style: { background: SOFT, color: INK } };
        const asking = failing === r.orderId;
        return (
          <li key={r.orderId} className="flex flex-col gap-2 rounded-2xl p-3" style={{ border: `1px solid ${r.step === 'ready' ? AMBER : LINE}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0"><span className="text-[17px] font-semibold">{r.number}</span>{r.name ? <span className="ml-1.5 text-[15px] font-semibold">{r.name}</span> : null}
                {r.step === 'making' && <span className="ml-2 text-[13.5px]" style={{ color: MUTED }}>Being made{r.leaveAt ? `, ready ${clock(r.leaveAt)}` : ''}</span>}</p>
              <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={chip.style}>{chip.text}</span>
            </div>
            {r.step === 'ready' && pairOf(r) && <p className="text-[13.5px] font-semibold" style={{ color: GREEN }}>Goes with {pairOf(r)!.number}: adds about {Math.max(1, r.with!.addMin)} min, both on time.</p>}
            {r.step === 'ready' && !pairOf(r) && r.with && going.some((x) => x.orderId === r.with!.orderId && x.step === 'ready') && <p className="text-[13.5px] font-semibold" style={{ color: GREEN }}>Goes with {r.with.number}.</p>}
            <p className="text-[13.5px] leading-relaxed" style={{ color: MUTED }}>{r.to}.{r.arriveAt && r.step !== 'making' ? ` Arrive by ${clock(r.arriveAt)}.` : ''}{r.driveMin ? ` About a ${r.driveMin}-minute drive.` : ''}
              {r.note ? <span className="block" style={{ color: INK }}>Note: {r.note}</span> : null}</p>
            {asking ? (
              <div className="space-y-2" role="group" aria-label={`Why ${r.number} couldn’t be delivered`}>
                <p className="text-[13.5px] font-semibold">What happened?</p>
                <div className="grid grid-cols-2 gap-2">{REASONS.map((x) => (
                  <button key={x.code} type="button" disabled={!!busy} onClick={() => act(`dfail-${r.orderId}`, { action: 'deliveryFailed', orderId: r.orderId, why: x.code }, () => setFailing(null))} className={`${btn} px-3 text-[14px]`} style={quiet}>{x.label}</button>))}</div>
                <button type="button" onClick={() => setFailing(null)} className={`${btn} w-full text-[14px]`} style={{ color: MUTED }}>Back</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {r.step === 'ready' && <button type="button" disabled={!!busy} onClick={() => out(r)} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Out for delivery</button>}
                {r.step === 'ready' && pairOf(r) && <button type="button" disabled={!!busy} onClick={() => act(`dout-${r.orderId}`, outBody(r), () => out(pairOf(r)!))} className={`${btn} flex-1`} style={quiet}>Send both</button>}
                {r.step === 'out' && <>
                  <button type="button" disabled={!!busy} onClick={() => act(`ddone-${r.orderId}`, { action: 'deliveryDone', orderId: r.orderId })} className={`${btn} flex-1`} style={quiet}>Delivered</button>
                  <button type="button" disabled={!!busy} onClick={() => setFailing(r.orderId)} className={`${btn} flex-1`} style={quiet}>Couldn’t deliver</button></>}
                {r.step === 'failed' && <button type="button" disabled={!!busy} onClick={() => out(r)} className={`${btn} flex-1`} style={quiet}>Send it out again</button>}
                {r.phone && r.step !== 'making' && <a href={`tel:+1${r.phone}`} className={`${btn} inline-flex items-center justify-center px-3`} style={{ color: INK, textDecoration: 'underline', textUnderlineOffset: 4 }} aria-label={`Phone ${r.name || r.number}`}>Phone them</a>}
              </div>)}
            {r.step === 'failed' && <p className="text-[13px]" style={{ color: MUTED }}>A manager can refund it, or send it out again.</p>}
          </li>); })}</ul>}
      {done.length > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>Delivered today: {done.slice(0, 8).map((r) => `${r.number}${r.deliveredAt ? ` at ${clock(r.deliveredAt)}` : ''}`).join(', ')}{done.length > 8 ? `, and ${done.length - 8} more` : ''}.</p>}
    </section>
  );
}
