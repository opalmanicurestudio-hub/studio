'use client';
// src/components/orders/PopupScreen.tsx — POP-UPS (app/(app)/popup; lib/popup): selling from a table somewhere else, a
// market stall, a fair, a show. A manager sets one up: its name and place, the day, and how many of each product came.
// On the day:
//   • the register sells from it: "Open the register" opens the front desk for this pop-up, and each sale there counts
//     against what came (api/checkout/complete);
//   • what's left of each product, live as the table and the line sell;
//   • orders from the line (when it's taking them): each with the number it's called by, to bag (on Pickups, the same
//     bag list as every pickup), call when it's ready, and hand over.
// Every change goes through the server (api/retail/popup); the line's orders are read live like the Orders screen's.
import * as React from 'react';
import Link from 'next/link';
import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { type Actor } from '@/lib/fulfil-client';
import { firstName, itemCount } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { callWords, POPUP_MAX_ITEMS } from '@/lib/popup';
import { Btn, C, Empty, LargeTitle, Sheet, Thumb, UndoBar, feel, muted } from './ui';
import { HandoverSheet } from './HandoverSheet';

type Item = { id: string; name: string; priceCents: number; imageUrl: string | null; number: number | null; qty: number; soldAtTable: number; ordered: number; left: number; gone?: boolean };
type Pop = { id: string; name: string; place: string; day: string; status: 'open' | 'closed'; lineOrders: boolean; today: boolean; lineCount: number; called: number; items: Item[] };
type Prod = { id: string; name: string; priceCents: number; imageUrl: string | null; onHand: number };
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const dayWords = (d: string) => { const t = Date.parse(`${d}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : d; };
const field = 'mt-1 block h-12 w-full rounded-2xl border px-4 text-[16px] font-normal';
/** The front desk opened for a pop-up keeps it here (per business, this browser tab), so its sales count against it. */
export const popupSessionKey = (t: string) => `cf-popup-${t}`;

export function PopupScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, staffId } = useTenant() as any; const { user } = useUser() as any;
  const tenantId = String(selectedTenant?.id || '');
  const perms = useFulfilmentPerms();
  const actor: Actor = React.useMemo(() => ({ id: staffId || user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user, staffId]);
  const [pops, setPops] = React.useState<Pop[] | null>(null);
  const [today, setToday] = React.useState('');
  const [canEdit, setCanEdit] = React.useState(false);
  const [err, setErr] = React.useState(''); const [toast, setToast] = React.useState('');
  const [editing, setEditing] = React.useState<Pop | 'new' | null>(null);
  const [busy, setBusy] = React.useState('');
  const [handId, setHandId] = React.useState<string | null>(null);

  const call = React.useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/retail/popup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const load = React.useCallback(async () => {
    const d = await call({ action: 'list' });
    if (d.ok) { setPops(d.popups || []); setToday(String(d.today || '')); setCanEdit(!!d.canEdit); setErr(''); } else { setErr(d.error || 'The pop-ups couldn’t be read.'); setPops((p) => p || []); }
  }, [call]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);

  const live = (pops || []).find((p) => p.today) || null;
  // What's left moves as the table and the line sell: read again every half minute while one is on.
  React.useEffect(() => { if (!live) return; const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [live?.id, load]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The line's orders, live (paid ones; one still being paid for isn't shown).
  const [line, setLine] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!fs || !tenantId || !live) { setLine([]); return; }
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('popupId', '==', live.id)),
      (s) => setLine(s.docs.map((d) => ({ ...(d.data() as any), id: d.id })).filter((o) => !['placed', 'cancelled'].includes(String(o.stage))).sort((a, b) => (Number(a.popupNumber) || 0) - (Number(b.popupNumber) || 0))), () => setLine([]));
  }, [fs, tenantId, live?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (k: string, body: any, done: string) => {
    setBusy(k); const d = await call(body); setBusy(''); feel(!!d.ok);
    if (!d.ok) { setToast(d.error || 'That didn’t save.'); return; }
    setToast(done); await load();
  };
  const openRegister = (p: Pop) => {
    try { sessionStorage.setItem(popupSessionKey(tenantId), JSON.stringify({ id: p.id, name: p.name, day: p.day })); } catch { /* the desk asks again */ }
    window.location.href = `/pos?popup=${encodeURIComponent(p.id)}`;
  };
  const callIt = async (o: any) => {
    if (perms.canPack === false) { feel(false); setToast('Handing orders over isn’t part of your role. Ask a manager to add it.'); return; }
    setBusy(`call-${o.id}`);
    try {
      const r = await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: o.id, text: `${callWords(o.popupNumber)} is ready, ${firstName(o.customerName)}. Come up to the table.`, called: true }) });
      const d = await r.json().catch(() => ({})); const sent = !!d.ok || r.status === 502;
      feel(sent); setToast(sent ? `${callWords(o.popupNumber)} called.` : d.error || 'That didn’t send. Try again.');
    } catch { feel(false); setToast('No connection. Try again.'); } finally { setBusy(''); }
  };

  const upcoming = (pops || []).filter((p) => !p.today && p.status === 'open' && p.day >= today);
  const past = (pops || []).filter((p) => !p.today && (p.status === 'closed' || p.day < today)).slice(0, 6);

  return (
    <div className="cf-settings min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-3xl px-4 pt-6">
        <LargeTitle title="Pop-ups" sub="Sell from a table somewhere else: a market, a fair, a show. Bring stock, sell at the register, and take orders from the line."
          right={canEdit ? <Btn kind="primary" onClick={() => setEditing('new')}>Set one up</Btn> : undefined} />
        {err && <p role="alert" className="m-0 mt-4 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        {!pops ? <p className="m-0 mt-6 text-[15px]" style={muted}>Loading…</p>
          : !pops.length ? <Empty title="No pop-ups yet" sub={canEdit ? 'Set one up with what you’re bringing, and the register counts what’s left as you sell.' : 'A manager sets them up.'} />
          : null}

        {live && (
          <section className="mt-6 rounded-3xl border-2 p-4 sm:p-5" style={{ borderColor: C.ink }}>
            <p className="m-0 text-[13px] font-semibold" style={muted}>Today</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0"><h2 className="m-0 text-[26px] font-light tracking-[-0.01em]">{live.name}</h2>{live.place && <p className="m-0 mt-0.5 text-[15px]" style={muted}>{live.place}</p>}</div>
              <div className="flex flex-wrap gap-2">
                <Btn kind="primary" onClick={() => openRegister(live)}>Open the register</Btn>
                <a href={`/print/popup-sign/${encodeURIComponent(tenantId)}/${encodeURIComponent(live.id)}`} target="_blank" rel="noreferrer" className="cf-press inline-flex h-12 items-center rounded-full px-5 text-[16px] font-semibold" style={{ background: C.soft, color: C.ink }}>Print the sign</a>
                {canEdit && <Btn onClick={() => setEditing(live)}>Change it</Btn>}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: C.soft }}>
              <div className="min-w-0"><p className="m-0 text-[16px] font-semibold">Orders from the line</p>
                <p className="m-0 text-[14px]" style={muted}>{live.lineOrders ? 'On. Customers scan the sign, order and pay on their phone, and get a number.' : 'Off. Turn it on and put the sign on the table.'}</p></div>
              {canEdit ? <button type="button" role="switch" aria-checked={live.lineOrders} aria-label="Orders from the line" disabled={busy === 'line'}
                onClick={() => void act('line', { action: 'lineOrders', id: live.id, on: !live.lineOrders }, live.lineOrders ? 'No more orders from the line.' : 'Taking orders from the line.')}
                className="relative h-11 w-[72px] shrink-0 rounded-full transition-colors" style={{ background: live.lineOrders ? C.ok : '#d2d3d7' }}>
                <span aria-hidden="true" className="absolute top-1 h-9 w-9 rounded-full bg-[#fff] shadow transition-all" style={{ left: live.lineOrders ? 32 : 4 }} /></button>
                : <span className="text-[14px] font-semibold" style={live.lineOrders ? { color: C.ok } : muted}>{live.lineOrders ? 'On' : 'Off'}</span>}
            </div>

            <h3 className="m-0 mt-5 text-[13px] font-semibold" style={muted}>What’s left</h3>
            {!live.items.length ? <p className="m-0 mt-2 text-[15px]" style={muted}>No products on it yet.{canEdit ? ' Change it to add what you’re bringing.' : ''}</p> : (
              <ul className="m-0 mt-1 list-none p-0">
                {live.items.map((it) => (
                  <li key={it.id} className="flex min-h-[60px] items-center gap-3 border-b py-2" style={{ borderColor: C.line }}>
                    {it.number != null ? <span aria-hidden="true" className="grid h-9 min-w-9 shrink-0 place-items-center rounded-xl px-1.5 text-[16px] font-semibold tabular-nums" style={{ background: C.line }}>{it.number}</span> : <span className="w-9 shrink-0" />}
                    <Thumb src={it.imageUrl || undefined} size={44} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15.5px] font-semibold">{it.number != null && <span className="sr-only">No. {it.number}, </span>}{it.name}</span>
                      <span className="block truncate text-[14px]" style={muted}>{it.gone ? 'Not for sale any more' : `${money(it.priceCents)}, ${it.qty} came, ${it.soldAtTable} sold at the table${it.ordered ? `, ${it.ordered} from the line` : ''}`}</span></span>
                    <span className="shrink-0 rounded-full px-2.5 py-1 text-[14px] font-semibold tabular-nums" style={it.left <= 0 ? { background: C.soft, color: C.muted } : it.left <= 2 ? { background: C.warnSoft, color: C.warn } : { background: C.okSoft, color: C.ok }}>{it.left <= 0 ? 'Sold out' : `${it.left} left`}</span>
                  </li>))}
              </ul>)}

            {(live.lineOrders || line.length > 0) && <>
              <h3 className="m-0 mt-5 text-[13px] font-semibold" style={muted}>Ordered from the line</h3>
              {!line.length ? <p className="m-0 mt-2 text-[15px]" style={muted}>Paid orders from the line show here with their number.</p> : (
                <ul className="m-0 mt-1 list-none p-0">
                  {line.map((o) => { const st = String(o.stage); const bagged = st === 'ready' || st === 'arrived'; const done = st === 'completed';
                    return (
                      <li key={o.id} className="flex min-h-[64px] flex-wrap items-center gap-3 border-b py-2" style={{ borderColor: C.line }}>
                        <span className="w-16 shrink-0 text-[20px] font-semibold tabular-nums">{callWords(o.popupNumber) || '—'}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-[15.5px] font-semibold">{o.customerName || 'Customer'}</span>
                          <span className="block text-[14px]" style={muted}>{itemCount(o)} item{itemCount(o) === 1 ? '' : 's'}{done ? ', picked up' : bagged ? (o.popupCalledAt ? ', called' : ', bagged') : ''}</span></span>
                        {!done && !bagged && <Link href={`/retail-orders/pickups?open=${encodeURIComponent(o.id)}`} className="cf-press inline-flex h-11 items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: C.ink, color: C.paper }} aria-label={`Bag it, ${callWords(o.popupNumber)}`}>Bag it</Link>}
                        {bagged && <Btn disabled={busy === `call-${o.id}`} aria-label={`Call ${callWords(o.popupNumber)}`} onClick={() => void callIt(o)}>{busy === `call-${o.id}` ? 'Calling…' : 'Call it'}</Btn>}
                        {bagged && <Btn kind="primary" aria-label={`Hand over ${callWords(o.popupNumber)}`} onClick={() => { if (perms.canPack === false) { setToast('Handing orders over isn’t part of your role. Ask a manager to add it.'); return; } setHandId(o.id); }}>Hand over</Btn>}
                      </li>); })}
                </ul>)}
            </>}
            {canEdit && <button type="button" disabled={busy === 'close'} onClick={() => void act('close', { action: 'close', id: live.id }, `${live.name} is over. Its sales stay on the books.`)} className="mt-5 h-11 text-[15px] font-semibold underline underline-offset-4" style={{ color: C.muted }}>Close the pop-up</button>}
          </section>)}

        {upcoming.length > 0 && <section className="mt-8"><h2 className="m-0 text-[13px] font-semibold" style={muted}>Coming up</h2>
          <div className="mt-2 overflow-hidden rounded-2xl" style={{ background: C.soft }}>{upcoming.map((p) => (
            <button key={p.id} type="button" disabled={!canEdit} onClick={() => setEditing(p)} className="flex min-h-[64px] w-full items-center justify-between gap-3 border-b px-4 py-2 text-left" style={{ borderColor: C.line }}>
              <span className="min-w-0"><span className="block truncate text-[16px] font-semibold">{p.name}</span><span className="block truncate text-[14px]" style={muted}>{dayWords(p.day)}{p.place ? `, ${p.place}` : ''}, {p.items.length} product{p.items.length === 1 ? '' : 's'}</span></span>
              {canEdit && <span className="shrink-0 text-[14px] font-semibold">Change</span>}
            </button>))}</div></section>}

        {past.length > 0 && <section className="mt-8"><h2 className="m-0 text-[13px] font-semibold" style={muted}>Gone by</h2>
          <ul className="m-0 mt-2 list-none p-0">{past.map((p) => { const sold = p.items.reduce((s, it) => s + it.soldAtTable, 0);
            return <li key={p.id} className="flex min-h-[52px] items-center justify-between gap-3 border-b py-2 text-[15px]" style={{ borderColor: C.line }}><span className="min-w-0 truncate">{p.name}, {dayWords(p.day)}</span><span className="shrink-0" style={muted}>{sold} sold at the table{p.called ? `, ${p.called} number${p.called === 1 ? '' : 's'} given out` : ''}</span></li>; })}</ul></section>}
      </div>
      {editing && <PopupForm tenantId={tenantId} today={today} start={editing === 'new' ? null : editing} call={call} onClose={() => setEditing(null)} onSaved={async (m) => { setEditing(null); setToast(m); await load(); }} />}
      {handId && line.find((o) => o.id === handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={line.find((o) => o.id === handId)} actor={actor} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); setToast(m); }} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
    </div>);
}

/** Set one up, or change it: its name, place and day, and what's coming (from the shop's products). */
function PopupForm({ tenantId, today, start, call, onClose, onSaved }: { tenantId: string; today: string; start: Pop | null; call: (b: any) => Promise<any>; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = React.useState(start?.name || ''); const [place, setPlace] = React.useState(start?.place || '');
  const [day, setDay] = React.useState(start?.day || today);
  const [qty, setQty] = React.useState<Record<string, number>>(() => Object.fromEntries((start?.items || []).map((it) => [it.id, it.qty])));
  const [order, setOrder] = React.useState<string[]>(() => (start?.items || []).map((it) => it.id));
  const [catalog, setCatalog] = React.useState<Prod[] | null>(null); const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { void call({ action: 'catalog' }).then((d) => setCatalog(d.ok ? d.products || [] : [])); }, [call]);
  const byId = new Map((catalog || []).map((p) => [p.id, p]));
  for (const it of start?.items || []) if (!byId.has(it.id)) byId.set(it.id, { id: it.id, name: it.name, priceCents: it.priceCents, imageUrl: it.imageUrl, onHand: 0 });
  const hits = q.trim() ? (catalog || []).filter((p) => !order.includes(p.id) && p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12) : [];
  const save = async () => {
    setBusy(true); setErr('');
    const d = await call({ action: 'save', ...(start ? { id: start.id } : {}), name, place, day, items: order.map((id) => ({ id, qty: qty[id] ?? 0 })) });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    onSaved(start ? 'Saved.' : `${name.trim()} is set up.`);
  };
  void tenantId;
  return (
    <Sheet title={start ? `Change ${start.name}` : 'Set up a pop-up'} onClose={onClose} closeLabel="Cancel">
      <div className="mt-2 space-y-3">
        <label className="block text-[13px] font-semibold" style={muted}>Name<input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Saturday market" className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
        <div className="grid grid-cols-[1.4fr_1fr] gap-2">
          <label className="block text-[13px] font-semibold" style={muted}>Where<input value={place} onChange={(e) => setPlace(e.target.value.slice(0, 80))} placeholder="Stall 14" className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <label className="block text-[13px] font-semibold" style={muted}>Day<input type="date" min={today || undefined} value={day} onChange={(e) => setDay(e.target.value)} className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
        </div>
        <div>
          <p className="m-0 text-[13px] font-semibold" style={muted}>What you’re bringing</p>
          {!order.length && <p className="m-0 mt-1 text-[14px]" style={muted}>Add products, and how many of each.</p>}
          <ul className="m-0 mt-1 list-none p-0">{order.map((id) => { const p = byId.get(id); return (
            <li key={id} className="flex min-h-[56px] items-center gap-3 border-b py-1.5" style={{ borderColor: C.line }}>
              <Thumb src={p?.imageUrl || undefined} size={40} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{p?.name || 'Product'}</span>{p && <span className="block text-[13px]" style={muted}>{money(p.priceCents)}{p.onHand ? `, ${p.onHand} on hand` : ''}</span>}</span>
              <label className="sr-only" htmlFor={`pq-${id}`}>How many of {p?.name || 'it'}</label>
              <input id={`pq-${id}`} inputMode="numeric" value={String(qty[id] ?? 0)} onChange={(e) => setQty((x) => ({ ...x, [id]: Math.min(9999, Number(e.target.value.replace(/\D/g, '')) || 0) }))} className="h-11 w-20 rounded-xl border px-3 text-right text-[16px] tabular-nums" style={{ borderColor: C.line }} />
              <button type="button" onClick={() => setOrder((o) => o.filter((x) => x !== id))} aria-label={`Take ${p?.name || 'it'} off`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]" style={{ background: C.soft }}>×</button>
            </li>); })}</ul>
          {order.length < POPUP_MAX_ITEMS && <>
            <label className="sr-only" htmlFor="popup-find">Find a product</label>
            <input id="popup-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder={catalog ? 'Find a product to add' : 'Loading products…'} className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
            {hits.length > 0 && <ul className="m-0 mt-1 list-none overflow-hidden rounded-2xl p-0" style={{ background: C.soft }}>{hits.map((p) => (
              <li key={p.id}><button type="button" onClick={() => { setOrder((o) => [...o, p.id]); setQty((x) => ({ ...x, [p.id]: Math.min(p.onHand || 1, 10) })); setQ(''); }} className="flex min-h-[52px] w-full items-center gap-3 px-3 py-1.5 text-left">
                <Thumb src={p.imageUrl || undefined} size={36} /><span className="min-w-0 flex-1 truncate text-[15px]">{p.name}</span><span className="shrink-0 text-[14px]" style={muted}>{p.onHand} on hand</span></button></li>))}</ul>}
          </>}
        </div>
        {err && <p role="alert" className="m-0 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        <Btn kind="primary" className="w-full" disabled={busy || !name.trim() || !day} onClick={() => void save()}>{busy ? 'Saving…' : start ? 'Save' : 'Set it up'}</Btn>
      </div>
    </Sheet>);
}
