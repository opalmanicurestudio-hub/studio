'use client';
// src/components/staff-portal/DeliveriesTab.tsx — THE DRIVER'S DELIVERIES IN THE STAFF APP (mockups 4A to 4C,
// lib/delivery-run). Three screens:
//   · The run: delivery orders waiting to go, put in the van and started together (each goes out with whoever started
//     it, and its customer is texted), then this driver's stops in order.
//   · A stop: where it's going and what they asked, their maps app, a message through the shop (no numbers either
//     way), then the proof the shop asks for (a photo, the customer's code on big orders) and Delivered.
//   · Can't deliver: what happened (the customer is messaged straight away and has a few minutes to answer here), then
//     leave it where they asked, bring it back to the shop, or go on and come back.
// While the driver has stops out, the staff app keeps the customers' order pages up to date (DriverLiveUpdates, below,
// lib/delivery-live): the route and arrival times, and roughly where the driver is unless they turn that off here. It
// stops when the last stop is done.
import * as React from 'react';
import { collection, doc, limit, query, where } from 'firebase/firestore';
import { useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { oneLine } from '@/lib/address-flow';
import { deliveryFrom, type DeliveryPlan } from '@/lib/delivery-plan';
import { DOOR_WAIT_MS, FAIL_REASONS, mapsLink, proofNeeded, runFor, stopHint, streetLines, type FailCode } from '@/lib/delivery-run';
import { formatTime, tenantTimeZone } from '@/lib/tenant-time';
import { SEND_EVERY_MS } from '@/lib/delivery-live';
import { markAtDoor, markDelivered, markDeliveryFailed, markOutForDelivery, skipDeliveryStop } from '@/lib/fulfil-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', OK = '#1f7a4d', WARN = '#b45309';
const card: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 20, background: '#fff' };
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const shortName = (n: any) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Customer'; };
const num = (o: any) => String(o?.orderNumber ?? '').padStart(4, '0');
const itemsOf = (o: any) => (o?.lines || []).reduce((n: number, l: any) => n + Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0)), 0);

/**
 * The shop's delivery plan, and this team member's part in it: named as a driver on the plan (Deliveries in their bar),
 * or able to deliver because the shop keeps no list (Deliveries under Me).
 */
export function useDeliveryDriver(firestore: any, tenantId: string, staffId: string): { plan: DeliveryPlan | null; tenant: any; isDriver: boolean; canDeliver: boolean } {
  const ref = useMemoFirebase(() => (firestore && tenantId ? doc(firestore, 'tenants', tenantId) : null), [firestore, tenantId]);
  const { data: tenant } = useDoc<any>(ref);
  const plan = tenant ? deliveryFrom(tenant.retailSettings) : null;
  const isDriver = !!plan?.on && plan.drivers.includes(staffId);
  return { plan, tenant, isDriver, canDeliver: !!plan?.on && (isDriver || plan.drivers.length === 0) };
}

const SHARE_KEY = 'cf-share-location';
type Sharing = 'off' | 'asking' | 'on' | 'blocked' | 'none';

// The driver's choice to share where they are (this device) and how it's going, shared by the staff app's updates
// (DriverLiveUpdates, always running while they have stops out) and the switch on the Deliveries tab.
const live = {
  share: ((): boolean => { try { return typeof localStorage === 'undefined' || localStorage.getItem(SHARE_KEY) !== '0'; } catch { return true; } })(),
  sharing: 'off' as Sharing,
  subs: new Set<() => void>(),
};
const changed = () => live.subs.forEach((f) => f());
function useLive(): { share: boolean; sharing: Sharing; setShare: (v: boolean) => void } {
  const [, bump] = React.useState(0);
  React.useEffect(() => { const f = () => bump((n) => n + 1); live.subs.add(f); return () => { live.subs.delete(f); }; }, []);
  return { share: live.share, sharing: live.sharing, setShare: (v: boolean) => { live.share = v; try { localStorage.setItem(SHARE_KEY, v ? '1' : '0'); } catch { /* this device only */ } changed(); } };
}
const setSharing = (v: Sharing) => { if (live.sharing !== v) { live.sharing = v; changed(); } };

/**
 * KEEPS THE CUSTOMERS' ORDER PAGES UP TO DATE while this driver has stops out (api/retail/driver-location): every half
 * minute, or when they've moved about a block, with where they are when they share it (a fix from the last minute). Runs
 * for the whole staff app, whichever tab is open; once the last stop is done, one last word clears it.
 */
export function DriverLiveUpdates({ tenantId, firestore, staffId }: { tenantId: string; firestore: any; staffId: string }) {
  const q = useMemoFirebase(() => (firestore && tenantId && staffId ? query(collection(firestore, `tenants/${tenantId}/retailOrders`), where('delivery.driverId', '==', staffId), where('delivery.status', '==', 'out'), limit(60)) : null), [firestore, tenantId, staffId]);
  const { data } = useCollection<any>(q);
  const active = (data || []).some((o: any) => o.method === 'delivery' && ['packed', 'ready'].includes(String(o.stage)));
  const { share } = useLive();
  const last = React.useRef<{ at: number; lat?: number; lng?: number }>({ at: 0 });
  const pos = React.useRef<GeolocationPosition | null>(null);
  const wasActive = React.useRef(false);
  const send = React.useCallback(async (force: boolean) => {
    const p = live.share && pos.current && Date.now() - pos.current.timestamp <= 60e3 ? pos.current : null;
    const wants = live.share && live.sharing !== 'blocked';
    const now = Date.now();
    const moved = p && last.current.lat !== undefined ? Math.abs(p.coords.latitude - (last.current.lat as number)) + Math.abs(p.coords.longitude - (last.current.lng as number)) > 0.0015 : !!p;
    if (!force && now - last.current.at < SEND_EVERY_MS && !moved) return;
    last.current = { at: now, ...(p ? { lat: p.coords.latitude, lng: p.coords.longitude } : {}) };
    try {
      await fetch('/api/retail/driver-location', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        // How old the fix is, as this phone measures it (so its clock being off doesn't matter). Still sharing without a
        // new one (standing at a door): the last good location stands for a few minutes.
        body: JSON.stringify({ tenantId, sharing: wants, ...(p ? { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, fixAgeMs: Math.max(0, Date.now() - p.timestamp) } : {}) }) });
    } catch { /* the next update tries again */ }
  }, [tenantId]);
  React.useEffect(() => {
    if (!active) { if (wasActive.current) { wasActive.current = false; pos.current = null; void send(true); } setSharing('off'); return; }
    wasActive.current = true;
    let watch: number | null = null;
    if (share && typeof navigator !== 'undefined' && navigator.geolocation) {
      setSharing('asking');
      watch = navigator.geolocation.watchPosition(
        (p) => { pos.current = p; setSharing('on'); void send(false); },
        (e) => { pos.current = null; setSharing(e.code === 1 ? 'blocked' : 'none'); },
        { enableHighAccuracy: true, maximumAge: 15e3, timeout: 20e3 });
    } else { pos.current = null; setSharing(share ? 'none' : 'off'); }
    void send(true);
    // A phone standing still may not report a new place on its own: each half minute it's asked for one, unless it
    // just reported.
    const tick = setInterval(() => {
      const recent = pos.current && Date.now() - pos.current.timestamp < 20e3;
      if (share && navigator.geolocation && !recent) navigator.geolocation.getCurrentPosition((p) => { pos.current = p; void send(true); }, () => void send(true), { enableHighAccuracy: true, maximumAge: 0, timeout: 10e3 });
      else void send(true);
    }, SEND_EVERY_MS);
    return () => { clearInterval(tick); if (watch !== null) navigator.geolocation.clearWatch(watch); };
  }, [active, share, send]);
  return null;
}

function when(o: any, tz: string): string {
  const d = o?.delivery || {};
  // The window as checkout worded it, without its day ("5–7 pm"); a run is today's.
  if (d.window?.label) return String(d.window.label).replace(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, /, '');
  if (d.window?.start && d.window?.end) return `${formatTime(d.window.start, tz)}–${formatTime(d.window.end, tz)}`;
  if (d.asap?.by) return `by ${formatTime(d.asap.by, tz)}`;
  return '';
}

function Btn({ kind = 'soft', children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'soft' | 'line' }) {
  const style: React.CSSProperties = kind === 'primary' ? { background: INK, color: '#fff' } : kind === 'line' ? { border: `1px solid ${INK}`, color: INK, background: '#fff' } : { background: SOFT, color: INK };
  return <button type="button" {...rest} className={`flex h-12 items-center justify-center rounded-full px-5 text-[15px] font-semibold disabled:opacity-45 ${className}`} style={{ ...style, ...(rest.style || {}) }}>{children}</button>;
}

export function DeliveriesTab({ tenantId, firestore, staffMember }: { tenantId: string; firestore: any; staffMember: any }) {
  const me = String(staffMember?.id || '');
  const { plan, tenant } = useDeliveryDriver(firestore, tenantId, me);
  const tz = tenantTimeZone(tenant);
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/retailOrders`), where('method', '==', 'delivery'), where('stage', 'in', ['packed', 'ready']), limit(200)) : null), [firestore, tenantId]);
  const { data: orders, isLoading } = useCollection<any>(q);
  const { toTake, route } = React.useMemo(() => runFor(orders || [], me), [orders, me]);
  const live = useLive();
  const [view, setView] = React.useState<{ kind: 'run' } | { kind: 'stop' | 'fail'; id: string; left?: boolean }>({ kind: 'run' });
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState<{ text: string; bad?: boolean } | null>(null);
  React.useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 6000); return () => clearTimeout(t); }, [note]);

  const stop = view.kind !== 'run' ? (orders || []).find((o: any) => o.id === view.id) || null : null;
  // The order left the run (delivered, brought back, or taken by someone else): back to the run.
  React.useEffect(() => { if (view.kind !== 'run' && orders && (!stop || stop.delivery?.status !== 'out' || String(stop.delivery?.driverId || '') !== me)) setView({ kind: 'run' }); }, [view, orders, stop, me]);

  const start = async () => {
    setBusy('start'); const bad: string[] = [];
    for (const id of picked) { const r = await markOutForDelivery(tenantId, id); if (!r.ok) bad.push(r.message); }
    setBusy(''); setPicked(new Set());
    setNote(bad.length ? { text: bad[0], bad: true } : { text: 'On your way. Each customer has been texted.' });
  };

  if (!plan?.on) return <p className="text-[15px]" style={{ color: MUTED }}>Local delivery isn’t turned on for this shop.</p>;
  if (stop && view.kind === 'stop') return <StopScreen key={`${stop.id}-${view.left ? 'left' : 'hand'}`} startLeft={view.left === true} tenantId={tenantId} order={stop} plan={plan} tz={tz} index={route.findIndex((o: any) => o.id === stop.id) + 1} total={route.length} onBack={() => setView({ kind: 'run' })} onFail={() => setView({ kind: 'fail', id: stop.id })} onDone={(m) => { setNote({ text: m }); setView({ kind: 'run' }); }} />;
  if (stop && view.kind === 'fail') return <FailScreen tenantId={tenantId} firestore={firestore} order={stop} tz={tz} onBack={() => setView({ kind: 'stop', id: stop.id })} onLeave={() => setView({ kind: 'stop', id: stop.id, left: true })} onDone={(m) => { setNote({ text: m }); setView({ kind: 'run' }); }} />;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div>
        <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{first(staffMember?.name)} · {today}</p>
        <h2 className="text-[28px] font-light tracking-[-0.02em]">{route.length ? `${route.length} stop${route.length === 1 ? '' : 's'}` : 'Deliveries'}</h2>
        {toTake.length > 0 && <p className="text-[14px]" style={{ color: MUTED }}>{toTake.length} waiting to go out</p>}
      </div>
      {note && <p role="status" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: note.bad ? '#fff7ed' : '#eaf6ef', color: note.bad ? WARN : OK }}>{note.text}</p>}
      {isLoading && !orders ? <p role="status" className="text-[15px]" style={{ color: MUTED }}>Loading deliveries…</p> : null}

      {toTake.length > 0 && (
        <section aria-labelledby="take-h" className="p-4" style={{ ...card, borderColor: picked.size ? INK : LINE, borderWidth: picked.size ? 2 : 1 }}>
          <div className="flex items-center justify-between gap-3"><h3 id="take-h" className="text-[16px] font-semibold">Put in the van</h3><span className="text-[14px] font-semibold">{picked.size} of {toTake.length}</span></div>
          <ul className="mt-2 space-y-1">
            {toTake.map((o: any) => { const on = picked.has(o.id); const tries = Number(o.delivery?.tries) || 0; return (
              <li key={o.id}>
                <label className="flex min-h-12 cursor-pointer items-start gap-3 py-1.5">
                  <input type="checkbox" checked={on} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} className="mt-1 h-5 w-5 accent-[#16171a]" />
                  <span className="min-w-0 flex-1 text-[15px]">
                    <span className="block font-semibold">{shortName(o.customerName)} · {num(o)}</span>
                    <span className="block text-[13.5px]" style={{ color: MUTED }}>{[streetLines(o.shippingAddress)[0], when(o, tz), `${itemsOf(o)} item${itemsOf(o) === 1 ? '' : 's'}`, o.stage === 'packed' ? 'packed, not on the shelf yet' : o.shelfSlot ? `shelf ${o.shelfSlot}` : ''].filter(Boolean).join(' · ')}</span>
                    {tries > 0 && <span className="block text-[13px] font-semibold" style={{ color: WARN }}>Brought back{o.delivery?.failReason ? `: ${String(o.delivery.failReason).toLowerCase()}` : ''}. Try {tries + 1}.</span>}
                  </span>
                </label>
              </li>); })}
          </ul>
        </section>)}

      {route.length > 0 && (
        <section aria-label="Your location" className="flex items-start gap-3 p-4" style={card}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Share my location</span>
            <span className="block text-[13px]" style={{ color: live.sharing === 'blocked' ? WARN : MUTED }}>
              {live.sharing === 'blocked' ? 'Location is blocked for this app. Allow it in your browser settings to share it.'
                : live.sharing === 'none' ? 'Your location isn’t available right now. Customers still see how many stops are before theirs.'
                : live.share ? 'Customers see roughly where you are, and when you should arrive, only while their order is on its way. It stops when your last stop is done. It updates while this app is open, so come back to it between stops.'
                : 'Off. Customers see how many stops are before theirs, not where you are.'}
            </span>
          </span>
          <button type="button" role="switch" aria-checked={live.share} aria-label="Share my location" onClick={() => live.setShare(!live.share)}
            className="relative mt-0.5 h-7 w-12 flex-none rounded-full" style={{ background: live.share ? INK : '#c9cbcf' }}>
            <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full transition-all" style={{ left: live.share ? 23 : 3, background: '#fff' }} />
          </button>
        </section>)}

      {route.length > 0 && (
        <section aria-labelledby="route-h" className="space-y-2">
          <h3 id="route-h" className="text-[13px] font-semibold" style={{ color: MUTED }}>Your route</h3>
          {route.map((o: any, i: number) => (
            <button key={o.id} type="button" onClick={() => setView({ kind: 'stop', id: o.id })} className="flex w-full items-start gap-3 p-4 text-left" style={card}>
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ background: INK }}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{shortName(o.customerName)} · {num(o)}</span>
                <span className="block text-[14px]" style={{ color: MUTED }}>{[streetLines(o.shippingAddress)[0], when(o, tz)].filter(Boolean).join(' · ')}</span>
                {stopHint(o, plan) && <span className="block text-[14px]">{stopHint(o, plan)}</span>}
                {o.delivery?.skippedAt && <span className="block text-[13px] font-semibold" style={{ color: WARN }}>Coming back to this one</span>}
              </span>
            </button>))}
        </section>)}

      {!toTake.length && !route.length && orders && <p className="rounded-2xl p-5 text-[15px]" style={{ background: SOFT, color: MUTED }}>Nothing to deliver right now. Packed delivery orders show up here.</p>}

      {toTake.length > 0 && (
        <div className="space-y-2">
          <Btn kind="primary" className="w-full" disabled={!picked.size || !!busy} onClick={() => void start()}>{busy === 'start' ? 'Starting…' : picked.size ? `Start with ${picked.size} order${picked.size === 1 ? '' : 's'}` : 'Start the route'}</Btn>
          <p className="text-center text-[13px]" style={{ color: MUTED }}>Tick each order as it goes in the van. Starting tells each customer you’re on the way. Customers see roughly where you are only while you’re on their delivery.</p>
        </div>)}
    </div>);
}

function StopScreen({ tenantId, order, plan, tz, index, total, startLeft, onBack, onFail, onDone }: { tenantId: string; order: any; plan: DeliveryPlan; tz: string; index: number; total: number; startLeft: boolean; onBack: () => void; onFail: () => void; onDone: (m: string) => void }) {
  const d = order.delivery || {};
  const name = first(order.customerName) || 'them';
  const [left, setLeft] = React.useState(startLeft);
  const [photo, setPhoto] = React.useState<{ url: string; preview: string } | null>(null);
  const [pin, setPin] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState<{ open: boolean; text: string; sent: boolean }>({ open: false, text: '', sent: false });
  const need = proofNeeded(order, plan, left);
  const apple = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const lines = streetLines(order.shippingAddress);

  const takePhoto = async (f: File | undefined) => {
    if (!f) return; setBusy('photo'); setErr('');
    try {
      const dataUrl = await downscaleImageToDataUrl(f, { maxDim: 1600, quality: 0.8 });
      const r = await fetch('/api/retail/delivery-photo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, dataUrl }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setErr(j.error || 'The photo didn’t save. Try again.'); return; }
      setPhoto({ url: j.url, preview: dataUrl });
    } catch { setErr('The photo didn’t save. Check the connection and try again.'); }
    finally { setBusy(''); }
  };
  const deliver = async () => {
    setBusy('done'); setErr('');
    const r = await markDelivered(tenantId, order.id, { photoUrl: photo?.url || null, left, where: left ? String(d.note || '') : '', pin: need.pin ? pin : undefined });
    setBusy('');
    if (!r.ok) { setErr(r.message); return; }
    onDone(`${r.message} ${name} has been told.`);
  };
  const send = async () => {
    setBusy('msg'); setErr('');
    try {
      const r = await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, text: msg.text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { setErr(j.error || 'That didn’t send. Try again.'); return; }
      setMsg({ open: false, text: '', sent: true });
    } catch { setErr('That didn’t send. Check the connection.'); }
    finally { setBusy(''); }
  };
  const ready = (!need.photo || !!photo) && (!need.pin || pin.length >= 4);

  return (
    <div className="space-y-3" style={{ color: INK }}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to your route" className="flex h-11 w-11 items-center justify-center rounded-full" style={{ border: `1px solid ${LINE}` }}>‹</button>
        <p className="flex-1 text-center text-[16px] font-semibold">{index > 0 ? `Stop ${index} of ${total}` : 'Stop'}</p><span className="w-11" />
      </div>
      <section className="space-y-2 p-4" style={card}>
        <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Order {num(order)} · {itemsOf(order)} item{itemsOf(order) === 1 ? '' : 's'}{when(order, tz) ? ` · ${when(order, tz)}` : ''}</p>
        <p className="text-[24px] font-light tracking-[-0.01em]">{shortName(order.customerName)}</p>
        {lines.map((l, i) => <p key={i} className="text-[16px]">{l}</p>)}
        {d.note && <p className="rounded-xl px-3 py-2 text-[15px]" style={{ background: SOFT }}>“{d.note}”{d.noteChangedAt && d.outAt && d.noteChangedAt > d.outAt ? <span className="block text-[13px] font-semibold" style={{ color: WARN }}>{name} changed this while you were on the way</span> : null}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <a href={mapsLink(oneLine(order.shippingAddress), apple)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center rounded-full text-[15px] font-semibold" style={{ border: `1px solid ${LINE}` }}>Open in Maps</a>
          <Btn kind="line" style={{ borderColor: LINE }} onClick={() => setMsg((m) => ({ ...m, open: !m.open }))}>Message {name}</Btn>
        </div>
        {msg.open && (
          <div className="space-y-2">
            <textarea value={msg.text} maxLength={500} rows={3} onChange={(e) => setMsg({ ...msg, text: e.target.value })} aria-label={`Message to ${name}`} placeholder="For example, I’m outside the main entrance." className="w-full rounded-xl px-3 py-2 text-[15px]" style={{ border: `1px solid ${LINE}` }} />
            <Btn kind="primary" className="w-full" disabled={!msg.text.trim() || busy === 'msg'} onClick={() => void send()}>{busy === 'msg' ? 'Sending…' : 'Send'}</Btn>
          </div>)}
        <p className="text-[13px]" style={{ color: MUTED }}>{msg.sent ? `Sent. ${name} answers on their order page.` : 'Messages go through the shop; numbers stay hidden both ways.'}</p>
      </section>

      <section className="space-y-2 p-4" style={card} aria-label="How it was delivered">
        <div role="radiogroup" aria-label="How it was delivered" className="grid grid-cols-2 gap-2">
          {[{ v: false, l: 'Handed to them' }, { v: true, l: 'Left where they asked' }].map((o) => (
            <button key={String(o.v)} type="button" role="radio" aria-checked={left === o.v} onClick={() => setLeft(o.v)} className="min-h-12 rounded-xl px-3 text-[15px] font-semibold" style={left === o.v ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{o.l}</button>))}
        </div>
        {need.photo ? (
          <div className="space-y-2 pt-1">
            <p className="text-[15px] font-semibold">Take a photo of {left ? 'where you left it' : 'the delivery'}</p>
            <p className="text-[13px]" style={{ color: MUTED }}>{plan.proof.photo === 'always' ? 'The shop asks for one on every delivery.' : plan.proof.photo === 'left' ? 'The shop asks for one when it’s left.' : 'A big order left without its code needs one.'} The customer sees it on their order page.</p>
            <div className="flex items-center gap-3">
              {photo ? <img src={photo.preview} alt="The delivery photo" className="h-24 w-24 rounded-xl object-cover" /> : <span className="flex h-24 w-24 items-center justify-center rounded-xl text-[13px]" style={{ background: SOFT, color: MUTED }}>Photo</span>}
              <label className="flex h-12 cursor-pointer items-center rounded-full px-5 text-[15px] font-semibold" style={{ border: `1px solid ${LINE}` }}>
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy === 'photo'} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void takePhoto(f); }} />
                {busy === 'photo' ? 'Saving…' : photo ? 'Take it again' : 'Take a photo'}
              </label>
            </div>
          </div>
        ) : <p className="text-[14px]" style={{ color: MUTED }}>No photo needed.</p>}
        {need.pin ? (
          <label className="block space-y-1 pt-1">
            <span className="block text-[15px] font-semibold">Their delivery code</span>
            <span className="block text-[13px]" style={{ color: MUTED }}>Big orders ask for the code on their order page.</span>
            <input inputMode="numeric" autoComplete="off" value={pin} maxLength={8} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="h-12 w-40 rounded-xl px-3 text-[18px] tracking-[0.3em]" style={{ border: `1px solid ${LINE}` }} />
          </label>
        ) : plan.proof.pinOverCents ? <p className="text-[14px]" style={{ color: MUTED }}>No code needed for this order.</p> : null}
      </section>

      {err && <p role="alert" className="text-[15px]" style={{ color: WARN }}>{err}</p>}
      <Btn kind="primary" className="w-full" disabled={!ready || !!busy} onClick={() => void deliver()}>{busy === 'done' ? 'Saving…' : 'Delivered'}</Btn>
      <Btn kind="line" className="w-full" style={{ borderColor: LINE }} disabled={!!busy} onClick={onFail}>Can’t deliver it</Btn>
    </div>);
}

function FailScreen({ tenantId, firestore, order, tz, onBack, onLeave, onDone }: { tenantId: string; firestore: any; order: any; tz: string; onBack: () => void; onLeave: () => void; onDone: (m: string) => void }) {
  const d = order.delivery || {};
  const name = first(order.customerName) || 'them';
  const [code, setCode] = React.useState<FailCode | ''>((d.doorCode as FailCode) || '');
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const doorAt = Date.parse(String(d.doorAt || '')) || 0;
  const left = doorAt ? Math.max(0, DOOR_WAIT_MS - (now - doorAt)) : DOOR_WAIT_MS;
  // Their answer, from the order page (it lands in the shop's messages): the newest since the driver got there.
  const casesQ = useMemoFirebase(() => (firestore && doorAt ? query(collection(firestore, `tenants/${tenantId}/retailSupport`), where('orderId', '==', String(order.id)), limit(10)) : null), [firestore, tenantId, order.id, doorAt]);
  const { data: cases } = useCollection<any>(casesQ);
  const reply = React.useMemo(() => {
    const all: { at: string; text: string }[] = [];
    for (const c of cases || []) {
      if (c.message && c.createdAt) all.push({ at: String(c.createdAt), text: String(c.message) });
      for (const f of Array.isArray(c.followUps) ? c.followUps : []) if (f?.message) all.push({ at: String(f.at || ''), text: String(f.message) });
    }
    return all.filter((m) => (Date.parse(m.at) || 0) >= doorAt).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  }, [cases, doorAt]);

  // Choosing a reason is only a choice; the customer is messaged when the driver asks for it (once per try).
  const pick = async (c: FailCode) => {
    setCode(c); setErr('');
    if (!doorAt) return;
    setBusy('door'); const r = await markAtDoor(tenantId, order.id, c); setBusy(''); if (!r.ok) setErr(r.message);
  };
  const tell = async () => {
    if (!code) return;
    setBusy('door'); setErr('');
    const r = await markAtDoor(tenantId, order.id, code);
    setBusy(''); if (!r.ok) setErr(r.message);
  };
  const back = async () => {
    setBusy('back'); setErr('');
    const label = FAIL_REASONS.find((x) => x.code === code)?.label || '';
    const r = await markDeliveryFailed(tenantId, order.id, label, code || 'other');
    setBusy(''); if (!r.ok) { setErr(r.message); return; }
    onDone(`Bringing it back. ${name} has been told, and the shop sees why.`);
  };
  const later = async () => {
    setBusy('skip'); setErr('');
    const r = await skipDeliveryStop(tenantId, order.id);
    setBusy(''); if (!r.ok) { setErr(r.message); return; }
    onDone(r.message);
  };
  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
  const inWindow = !d.window?.end || Date.parse(d.window.end) > now;

  return (
    <div className="space-y-3" style={{ color: INK }}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to the stop" className="flex h-11 w-11 items-center justify-center rounded-full" style={{ border: `1px solid ${LINE}` }}>‹</button>
        <p className="flex-1 text-center text-[16px] font-semibold">Can’t deliver · {num(order)}</p><span className="w-11" />
      </div>
      <p className="text-[13px] font-semibold" style={{ color: MUTED }}>What happened?</p>
      <div role="radiogroup" aria-label="What happened" className="space-y-2">
        {FAIL_REASONS.map((r) => (
          <button key={r.code} type="button" role="radio" aria-checked={code === r.code} disabled={busy === 'door'} onClick={() => void pick(r.code)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px]" style={{ border: `${code === r.code ? 2 : 1}px solid ${code === r.code ? INK : LINE}`, background: '#fff' }}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ border: `2px solid ${code === r.code ? INK : '#c9cacd'}` }}>{code === r.code && <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK }} />}</span>{r.label}
          </button>))}
      </div>
      {code && !doorAt && <Btn kind="primary" className="w-full" disabled={busy === 'door'} onClick={() => void tell()}>{busy === 'door' ? 'Sending…' : `Tell ${name} you’re at the door`}</Btn>}
      {doorAt > 0 && (
        <section className="space-y-2 p-4" style={card} aria-live="polite">
          <div className="flex items-baseline justify-between gap-3"><p className="text-[16px] font-semibold">We’ve messaged {name}</p><p className="text-[22px] font-semibold tabular-nums">{left > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : '0:00'}</p></div>
          {reply ? <p className="rounded-xl px-3 py-2 text-[15px]" style={{ background: SOFT }}><span className="font-semibold">{name}:</span> {reply.text}</p>
            : <p className="text-[14px]" style={{ color: MUTED }}>{left > 0 ? `Wait up to ${Math.round(DOOR_WAIT_MS / 60000)} minutes for an answer. It shows here.` : 'No answer yet. Choose what to do.'}</p>}
          <div className="h-1.5 rounded-full" style={{ background: SOFT }}><div className="h-1.5 rounded-full" style={{ width: `${Math.round(((DOOR_WAIT_MS - left) / DOOR_WAIT_MS) * 100)}%`, background: INK }} /></div>
        </section>)}
      {code && (
        <section className="space-y-2" aria-label="Then">
          <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Then</p>
          {d.note && <button type="button" onClick={onLeave} disabled={!!busy} className="block w-full rounded-2xl px-4 py-3 text-left" style={card}><span className="block text-[15px] font-semibold">Leave it where they asked</span><span className="block text-[13px]" style={{ color: MUTED }}>“{String(d.note).slice(0, 60)}” · take a photo</span></button>}
          <button type="button" onClick={() => void back()} disabled={!!busy} className="block w-full rounded-2xl px-4 py-3 text-left" style={card}><span className="block text-[15px] font-semibold">{busy === 'back' ? 'Saving…' : 'Bring it back to the shop'}</span><span className="block text-[13px]" style={{ color: MUTED }}>It goes back on the ready shelf, and {name} is told why</span></button>
          {inWindow && <button type="button" onClick={() => void later()} disabled={!!busy} className="block w-full rounded-2xl px-4 py-3 text-left" style={card}><span className="block text-[15px] font-semibold">{busy === 'skip' ? 'Saving…' : 'Go to the next stop, come back after'}</span><span className="block text-[13px]" style={{ color: MUTED }}>{d.window?.end ? `Still inside their ${when(order, tz)} window` : 'It moves to the end of your route'}</span></button>}
        </section>)}
      {err && <p role="alert" className="text-[15px]" style={{ color: WARN }}>{err}</p>}
      <p className="text-center text-[13px]" style={{ color: MUTED }}>{name} sees what happens on their order page. The shop is told if it comes back.</p>
    </div>);
}
