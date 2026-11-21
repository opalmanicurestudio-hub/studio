'use client';
// src/components/drive-thru/Deliveries.tsx — HOT FOOD DELIVERIES ON THE COUNTER PAGE (lib/food-delivery-server, read with
// the counter's lane). Ready ones first (hot food waiting on a driver: leave now), then the ones being made, out with a
// driver, and couldn't be delivered; delivered ones last. Out for delivery, Delivered, and Couldn't deliver (why) go to
// api/counter. Who's driving is picked once on this screen (kept on this device): one of the business's drivers (their tip
// is theirs), someone else by name, or whoever is signed in. Drivers can also take hot food from their own phone.
// One that couldn't be delivered (design board "When hot food can't be delivered"): sent out again, or refunded in one
// step (a manager's: the food, its tax, the tip, and the fee by the second-try rule); one the guest is picking up
// instead waits with their code until it's handed over.
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
  step: 'making' | 'ready' | 'out' | 'delivered' | 'failed' | 'pickup' | 'picked_up' | 'refunded'; readyFor: number | null; leaveAt: string | null; driver: string | null; outAt: string | null; deliveredAt: string | null;
  why: string | null; phone: string | null; tip?: number;
  /** Couldn't be delivered (or picked up instead): what a refund gives back, in dollars; the fee the rule keeps. */
  back?: { why: string; keepWhen: string; keepFee: boolean; food: number; tax: number; tip: number; fee: number; stuck: boolean; stuckWhy?: string | null; textFailed?: boolean } | null;
  /** Picked up instead: their pickup code, and what hasn't gone back to their card yet (dollars). */
  code?: string | null; owed?: number;
  /** Out with a driver: about when it gets there now, and whether that's past the guest's time. */
  eta?: string | null; late?: boolean;
  /** From an earlier business day and not finished. */
  earlier?: boolean;
  /** Ready: another ready one going the same way (adds a few minutes to the trip, both on time). */
  with?: { orderId: string; number: string; addMin: number } | null };

const clock = (iso: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const since = (iso: string | null, now: number) => Math.max(0, Math.floor((now - (Date.parse(String(iso || '')) || now)) / 60000));

export type DriverNow = { onNow: number | null; outNow: number; backAt: string | null };
export type Slow = { paused: boolean; until: string | null; extraMin: number; extraUntil: string | null; by: string | null };

const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export function Deliveries({ rows, drivers = [], now, busy, act, driverNow = null, slow = null, notify, askPin }: { rows: DeliveryRow[]; drivers?: FoodDriver[]; now: number; busy: string | null;
  act: (label: string, body: any, after?: (d: any) => void, onFail?: (d: any) => boolean) => void; driverNow?: DriverNow | null; slow?: Slow | null;
  /** Said on the counter screen when a step goes through. */
  notify?: (text: string) => void;
  /** A manager's PIN for a refund, when the person here isn't one: the same step again with it. */
  askPin?: (body: any, line: string, done: (d: any) => void) => void }) {
  // Kept as 'id:<their team record>' for one of the drivers, or the name typed for someone else.
  const [driver, setDriver] = useState(''); const [other, setOther] = useState(false); const [failing, setFailing] = useState<string | null>(null); const [slowOpen, setSlowOpen] = useState(false);
  // Refunding one: which, and whether the delivery fee goes back too (the second-try rule's answer to start with).
  const [refunding, setRefunding] = useState<string | null>(null); const [feeToo, setFeeToo] = useState(false);
  useEffect(() => { try { const v = localStorage.getItem(DRIVER_KEY) || ''; setDriver(v); setOther(!!v && !v.startsWith('id:')); } catch { /* private window */ } }, []);
  const keepDriver = (v: string) => { setDriver(v); try { if (v.trim()) localStorage.setItem(DRIVER_KEY, v.trim()); else localStorage.removeItem(DRIVER_KEY); } catch { /* private window */ } };
  // (With delivery on, the section shows even before the first order: to slow new deliveries down ahead of a rush.)
  if (!rows.length && !driverNow && !slow) return null;
  const slowed = !!slow && (slow.paused || slow.extraMin > 0);
  const slowDo = (body: any) => act('slow', { action: 'deliverySlow', ...body }, () => setSlowOpen(false));
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
  // A refund: the food and its tax, the tip (unless a pickup already gave it back), and the fee when it goes back too
  // (for a pickup, only when the rule kept it then).
  const feeOffered = (r: DeliveryRow) => !!r.back && r.back.fee > 0 && (r.step === 'failed' || r.back.keepFee);
  const refundTotal = (r: DeliveryRow) => (r.back ? r.back.food + r.back.tax + (r.step === 'failed' ? r.back.tip : 0) + (feeOffered(r) && feeToo ? r.back.fee : 0) : 0);
  const openRefund = (r: DeliveryRow) => { setRefunding(r.orderId); setFeeToo(r.step === 'failed' ? !r.back?.keepFee : false); setFailing(null); };
  const refunded = (d: any) => { setRefunding(null); notify?.(`${d.number || 'It'}: ${usd((Number(d.cents) || 0) / 100)} refunded to their card${d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}.`); };
  const refund = (r: DeliveryRow) => {
    const body = { action: 'deliveryRefund', orderId: r.orderId, fee: feeOffered(r) && feeToo };
    act(`drefund-${r.orderId}`, body, refunded, (d) => { if (!d.needsManager || !askPin) return false; askPin(body, `It refunds ${r.number}, ${usd(refundTotal(r))}, to their card. It doesn’t change who’s signed in here.`, refunded); return true; });
  };
  return (
    <section aria-labelledby="counter-deliveries" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="counter-deliveries" className="text-[17px] font-semibold">Deliveries</h2>
          <p className="text-[13px]" style={{ color: MUTED }}>{driverNow && driverNow.onNow !== null
            ? `${driverNow.onNow} ${driverNow.onNow === 1 ? 'driver' : 'drivers'} on now.${driverNow.outNow ? ` ${driverNow.outNow} out${driverNow.backAt ? `, back about ${clock(driverNow.backAt)}` : ''}.` : ''}`
            : 'Hot food goes out as soon as it’s ready.'}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {slow && <button type="button" aria-expanded={slowOpen} onClick={() => setSlowOpen((v) => !v)} className={`${btn} px-3 text-[14px]`} style={quiet}>Slow it down</button>}
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
      {slow && slowOpen && <div className="space-y-2 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="Slow new deliveries down">
        <p className="text-[13.5px] font-semibold">New deliveries</p>
        <div className="grid grid-cols-2 gap-2">{[15, 30].map((m) => <button key={m} type="button" disabled={!!busy} onClick={() => slowDo({ mode: 'extra', minutes: m })} className={`${btn} whitespace-nowrap px-2 text-[14px]`} style={quiet}>Add {m} min</button>)}</div>
        <div className="grid grid-cols-3 gap-2">{([[30, 'Pause 30 min'], [60, 'Pause 1 hour'], ['day', 'Pause for today']] as [number | 'day', string][]).map(([m, w]) => <button key={String(m)} type="button" disabled={!!busy} onClick={() => slowDo({ mode: 'pause', minutes: m })} className={`${btn} whitespace-nowrap px-2 text-[14px]`} style={quiet}>{w}</button>)}</div>
        <p className="text-[12.5px]" style={{ color: MUTED }}>Orders already placed keep their times. Added time lasts an hour. Shop orders in a delivery window aren’t changed.</p>
      </div>}
      {slowed && <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-xl px-3 py-1.5 text-[13.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>
        {slow!.paused ? `New deliveries paused until ${clock(slow!.until)}.` : `New deliveries: ${slow!.extraMin} minutes added until ${clock(slow!.extraUntil)}.`}
        <button type="button" disabled={!!busy} onClick={() => slowDo({ mode: 'clear' })} className={`inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4 ${RING}`} style={{ color: AMBER }}>{slow!.paused ? 'Take orders again' : 'Back to normal'}</button></p>}
      {going.length > 0 && <ul className="grid grid-cols-1 items-start gap-2.5 lg:grid-cols-2">{going.map((r) => {
        const chip = r.earlier && (r.step === 'ready' || r.step === 'making') ? { text: 'From yesterday', style: { background: AMBER_TINT, color: AMBER } }
          : r.step === 'ready' ? { text: `Ready ${r.readyFor ? `${r.readyFor} min` : 'now'}: leave now`, style: { background: AMBER_TINT, color: AMBER } }
          : r.step === 'out' ? { text: `Out with ${r.driver || 'a driver'}, ${since(r.outAt, now)} min`, style: { background: SOFT, color: INK } }
          : r.step === 'failed' ? { text: `Couldn’t deliver: ${r.why || 'see why'}`, style: { background: AMBER_TINT, color: AMBER } }
          : r.step === 'pickup' ? { text: 'Picking it up', style: { background: GREEN_TINT, color: GREEN } }
          : r.step === 'picked_up' ? { text: 'Picked up', style: { background: GREEN_TINT, color: GREEN } }
          : { text: r.arriveAt ? `Arrive by ${clock(r.arriveAt)}` : 'Being made', style: { background: SOFT, color: INK } };
        const asking = failing === r.orderId;
        return (
          <li key={r.orderId} className="flex flex-col gap-2 rounded-2xl p-3" style={{ border: `1px solid ${r.step === 'ready' ? AMBER : LINE}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0"><span className="text-[17px] font-semibold">{r.number}</span>{r.name ? <span className="ml-1.5 text-[15px] font-semibold">{r.name}</span> : null}
                {r.step === 'making' && !r.earlier && <span className="ml-2 text-[13.5px]" style={{ color: MUTED }}>Being made{r.leaveAt ? `, ready ${clock(r.leaveAt)}` : ''}</span>}</p>
              <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={chip.style}>{chip.text}</span>
            </div>
            {r.step === 'out' && r.late && <p className="text-[13.5px] font-semibold" style={{ color: AMBER }}>Running late{r.eta ? `: now about ${clock(r.eta)}` : ''}.</p>}
            {r.earlier && (r.step === 'making' || r.step === 'ready') && <p className="text-[13.5px]" style={{ color: AMBER }}>{r.step === 'ready' ? 'Paid, never went out. Send it now, or a manager refunds it.' : 'Paid, never went out. A manager refunds it.'}</p>}
            {r.step === 'ready' && pairOf(r) && <p className="text-[13.5px] font-semibold" style={{ color: GREEN }}>Goes with {pairOf(r)!.number}: adds about {Math.max(1, r.with!.addMin)} min, both on time.</p>}
            {r.step === 'ready' && !pairOf(r) && r.with && going.some((x) => x.orderId === r.with!.orderId && x.step === 'ready') && <p className="text-[13.5px] font-semibold" style={{ color: GREEN }}>Goes with {r.with.number}.</p>}
            {r.step === 'picked_up' ? null : r.step === 'pickup' ? <p className="text-[13.5px] leading-relaxed" style={{ color: MUTED }}>Coming to the counter.{r.code ? <> Pickup code <b className="font-semibold" style={{ color: INK }}>{r.code}</b>.</> : ''}</p>
              : <p className="text-[13.5px] leading-relaxed" style={{ color: MUTED }}>{r.to}.{r.arriveAt && r.step !== 'making' ? ` Arrive by ${clock(r.arriveAt)}.` : ''}{r.driveMin ? ` About a ${r.driveMin}-minute drive.` : ''}
              {r.note ? <span className="block" style={{ color: INK }}>Note: {r.note}</span> : null}</p>}
            {(r.step === 'pickup' || r.step === 'picked_up') && !!r.owed && <p className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-semibold" style={{ color: AMBER }}>{usd(r.owed)} hasn’t gone back to their card yet.{r.back?.stuckWhy ? ` ${r.back.stuckWhy}` : ''}
              <button type="button" disabled={!!busy} onClick={() => act(`dowed-${r.orderId}`, { action: 'deliveryOwed', orderId: r.orderId }, (d) => notify?.(`${d.number || 'It'}: sent back to their card.`))} className={`inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4 ${RING}`} style={{ color: AMBER }}>Send it again</button></p>}
            {refunding === r.orderId && r.back ? (
              <div className="space-y-2 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }} role="group" aria-label={`Refund ${r.number}`}>
                <p className="text-[15px] font-semibold">Refund {r.number} to their card</p>
                <p className="flex justify-between text-[13.5px]"><span>Food</span><span>{usd(r.back.food)}</span></p>
                {r.back.tax > 0 && <p className="flex justify-between text-[13.5px]"><span>Sales tax</span><span>{usd(r.back.tax)}</span></p>}
                {r.step === 'failed' && r.back.tip > 0 && <p className="flex justify-between text-[13.5px]"><span>Driver tip</span><span>{usd(r.back.tip)}</span></p>}
                {feeOffered(r) && <label className="flex min-h-[44px] items-center gap-3 text-[13.5px]"><input type="checkbox" checked={feeToo} onChange={(e) => setFeeToo(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />The delivery fee too, {usd(r.back.fee)}</label>}
                <p className="flex justify-between text-[15px] font-semibold"><span>Refund</span><span>{usd(refundTotal(r))}</span></p>
                <div className="flex gap-2">
                  <button type="button" disabled={!!busy || refundTotal(r) <= 0} onClick={() => refund(r)} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Refund {usd(refundTotal(r))}</button>
                  <button type="button" onClick={() => setRefunding(null)} className={btn} style={quiet}>Back</button>
                </div>
                <p className="text-[12.5px]" style={{ color: MUTED }}>{r.step === 'failed' && r.back.keepFee && r.back.keepWhen ? `By your second-try rule, the delivery fee is kept when ${r.back.keepWhen}. ` : ''}A manager’s, as any refund. The guest gets a text.</p>
              </div>
            ) : asking ? (
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
                {r.step === 'failed' && <>
                  <button type="button" disabled={!!busy} onClick={() => out(r)} className={`${btn} flex-1`} style={quiet}>Send it out again</button>
                  <button type="button" disabled={!!busy || !r.back} onClick={() => openRefund(r)} className={`${btn} flex-1`} style={quiet}>Refund it</button></>}
                {r.step === 'pickup' && <>
                  <button type="button" disabled={!!busy} onClick={() => act(`dhand-${r.orderId}`, { action: 'deliveryHanded', orderId: r.orderId }, (d) => notify?.(`${d.number || 'It'} was handed over.`))} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Handed over</button>
                  <button type="button" disabled={!!busy || !r.back} onClick={() => openRefund(r)} className={`${btn} flex-1`} style={quiet}>Refund it</button></>}
                {r.phone && r.step !== 'making' && <a href={`tel:+1${r.phone}`} className={`${btn} inline-flex items-center justify-center px-3`} style={{ color: INK, textDecoration: 'underline', textUnderlineOffset: 4 }} aria-label={`Phone ${r.name || r.number}`}>Phone them</a>}
              </div>)}
            {r.step === 'failed' && refunding !== r.orderId && (r.back?.stuck
              ? <p className="text-[13.5px] font-semibold" style={{ color: AMBER }}>The refund didn’t finish{r.back.stuckWhy ? `: ${r.back.stuckWhy.replace(/\.$/, '')}` : ''}. Refund it again to finish it.</p>
              : r.back?.textFailed ? <p className="text-[13.5px] font-semibold" style={{ color: AMBER }}>The text to them didn’t go. Phone them: they can pick it up, or a manager refunds it.</p>
              : <p className="text-[13px]" style={{ color: MUTED }}>They were texted to pick it up or get a refund on their order page.</p>)}
          </li>); })}</ul>}
      {done.length > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>Delivered today: {done.slice(0, 8).map((r) => `${r.number}${r.deliveredAt ? ` at ${clock(r.deliveredAt)}` : ''}`).join(', ')}{done.length > 8 ? `, and ${done.length - 8} more` : ''}.</p>}
    </section>
  );
}
