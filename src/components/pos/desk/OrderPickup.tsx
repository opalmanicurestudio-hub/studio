'use client';
// src/components/pos/desk/OrderPickup.tsx — ORDER PICKUP AT THE DESK. Online orders ready for collection (and curbside
// arrivals), found by scanning their pickup QR, typing the order number or searching a name. Hand over with the QR —
// or, without it, say how you checked it's them. Same shared handover as the orders board (stock becomes a sale, the
// order completes, the event is logged). Optionally the customer signs for it on the client screen (iPad).
import * as React from 'react';
import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { handoffByScan, handoffWithoutScan } from '@/lib/retail-fulfill';
import { parseOrderQr } from '@/lib/retail-orders';

const money = (c: any) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
const CHECKS = ['Photo ID', 'Name and order number', 'Their order email or phone'];

export function OrderPickup({ firestore, tenantId, actor, scanned, screen }: {
  firestore: Firestore; tenantId: string; actor: { id: string; name: string }; scanned?: string | null;
  screen?: { connected: boolean; name: string | null; ask: (kind: string, extra?: any) => Promise<string | null>; response: any } | null;
}) {
  const [orders, setOrders] = React.useState<any[]>([]); const [q, setQ] = React.useState(''); const [sel, setSel] = React.useState<any>(null);
  const [check, setCheck] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<string | null>(null); const [done, setDone] = React.useState<string | null>(null);
  const [signReq, setSignReq] = React.useState<{ id: string | null; status: 'waiting' | 'signed' } | null>(null);
  React.useEffect(() => { if (!firestore || !tenantId) return;
    return onSnapshot(query(collection(firestore, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ['ready', 'arrived'])), (s) => setOrders(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setOrders([])); }, [firestore, tenantId]);
  // A scanned pickup code picks its order straight away.
  const token = scanned ? (parseOrderQr(scanned) ?? scanned.trim()) : null;
  React.useEffect(() => { if (!token || !orders.length) return; const o = orders.find((x) => x.qrToken === token); if (o) { setSel(o); setMsg(null); } }, [token, orders.length]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { const r = screen?.response; if (signReq?.id && r?.requestId === signReq.id && r?.kind === 'sign' && r.signed) setSignReq({ id: signReq.id, status: 'signed' }); }, [screen?.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = q.trim().toLowerCase().replace(/^#/, '');
  const list = orders.filter((o) => !t || String(o.orderNumber) === t || String(o.customerName || '').toLowerCase().includes(t) || o.qrToken === (parseOrderQr(q) ?? q.trim()))
    .sort((a, b) => (a.stage === 'arrived' ? -1 : 0) - (b.stage === 'arrived' ? -1 : 0) || String(a.readyAt || '').localeCompare(String(b.readyAt || '')));
  const withQr = !!sel && !!token && sel.qrToken === token;
  const hand = async () => {
    if (!sel) return; setBusy(true); setMsg(null);
    const r = withQr ? await handoffByScan(firestore, tenantId, sel.qrToken, actor) : await handoffWithoutScan(firestore, tenantId, sel.id, check, actor);
    setBusy(false); if (r.ok) { setDone(`Order #${sel.orderNumber} handed over to ${sel.customerName || 'the customer'}.`); setSel(null); setCheck(''); setSignReq(null); } else setMsg(r.message);
  };
  const askSign = async () => { if (!sel || !screen?.connected) return; const items = (sel.lines || []).map((l: any) => `${Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0))} × ${l.name}${l.optionsLabel ? ` (${l.optionsLabel})` : ''}`).join(', ');
    const id = await screen.ask('sign', { title: `Order #${sel.orderNumber} — collected`, text: `I’ve collected order #${sel.orderNumber}: ${items}.`, what: 'pickup', ref: sel.id, clientId: sel.clientId || null, clientName: sel.customerName || null });
    setSignReq({ id, status: 'waiting' }); };
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const primary = { background: 'var(--accent)', color: 'var(--accent-ink)' } as React.CSSProperties;
  if (sel) return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-3xl p-4" style={box}>
        <div className="flex items-start justify-between gap-2"><div><p className="text-[20px] font-semibold">Order #{sel.orderNumber}</p><p className="text-[15px]" style={muted}>{sel.customerName}{sel.businessName ? ` · ${sel.businessName}` : ''}</p></div>
          <span className="rounded-full px-3 py-1 text-[12px] font-semibold" style={sel.stage === 'arrived' ? primary : soft}>{sel.stage === 'arrived' ? `Here${sel.curbside?.spotOrVehicle ? ` · ${sel.curbside.spotOrVehicle}` : ''}` : 'Ready'}</span></div>
        <ul className="space-y-1 text-[15px]">{(sel.lines || []).map((l: any) => { const n = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
          return <li key={l.lineId} className="flex justify-between gap-2"><span>{n} × {l.name}{l.optionsLabel ? <span style={muted}> · {l.optionsLabel}</span> : null}{l.qtyShorted ? <span style={{ color: 'var(--warn)' }}> · {l.qtyShorted} refunded</span> : null}</span><span className="tabular-nums">{money(n * (l.unitPriceCents || 0))}</span></li>; })}</ul>
        <p className="flex justify-between border-t pt-2 text-[15px] font-semibold" style={{ borderColor: 'var(--line)' }}><span>Paid online</span><span className="tabular-nums">{money(sel.totalCents)}</span></p>
      </section>
      {screen?.connected && <section className="space-y-2 rounded-3xl p-4" style={box}>
        <p className="text-[14px]">{signReq?.status === 'signed' ? `Signed on ${screen.name} ✓` : signReq ? `Waiting for them to sign on ${screen.name}…` : `Ask them to sign for it on ${screen.name} (optional).`}</p>
        {signReq?.status !== 'signed' && <button type="button" onClick={askSign} className="h-10 rounded-full px-4 text-[13px] font-semibold" style={soft}>{signReq ? 'Ask again' : 'Send to sign'}</button>}
      </section>}
      <section className="space-y-2 rounded-3xl p-4" style={box}>
        {withQr ? <p className="text-[14px] font-semibold">Their pickup code matches ✓</p> : <>
          <p className="text-[14px] font-semibold">No pickup code scanned — how did you check it’s them?</p>
          <div className="flex flex-wrap gap-1.5">{CHECKS.map((c) => <button key={c} type="button" aria-pressed={check === c} onClick={() => setCheck(c)} className="h-9 rounded-full px-3 text-[13px]" style={check === c ? primary : soft}>{c}</button>)}</div></>}
        <button type="button" disabled={busy || (!withQr && !check)} onClick={hand} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={primary}>{busy ? 'Handing over…' : 'Hand over'}</button>
        <button type="button" onClick={() => { setSel(null); setMsg(null); }} className="text-[13px] underline underline-offset-4">Back to the list</button>
      </section>
      {msg && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }} role="alert">{msg}</p>}
    </div>);
  return (
    <div className="space-y-3">
      {done && <p className="rounded-2xl p-3 text-[14px] font-semibold" style={soft} role="status">✓ {done}</p>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan their pickup code, or type an order number or name" aria-label="Find an order" data-scan-field
        className="h-12 w-full rounded-xl px-4 text-[16px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
      {token && !orders.some((o) => o.qrToken === token) && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>That pickup code isn’t for an order that’s ready — it may already be collected, or still being packed.</p>}
      {!list.length ? <p className="py-4 text-center text-[14px]" style={muted}>{orders.length ? 'No ready order matches that.' : 'No orders are waiting to be collected.'}</p>
        : <div className="space-y-2">{list.map((o) => <button key={o.id} type="button" onClick={() => { setSel(o); setDone(null); }} className="flex w-full items-center justify-between gap-2 rounded-2xl p-3 text-left" style={box}>
          <span><span className="block text-[15px] font-semibold">#{o.orderNumber} · {o.customerName}</span><span className="block text-[13px]" style={muted}>{(o.lines || []).reduce((n: number, l: any) => n + Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)), 0)} items · {money(o.totalCents)}</span></span>
          <span className="rounded-full px-3 py-1 text-[12px] font-semibold" style={o.stage === 'arrived' ? primary : soft}>{o.stage === 'arrived' ? 'Here now' : 'Ready'}</span></button>)}</div>}
    </div>
  );
}
