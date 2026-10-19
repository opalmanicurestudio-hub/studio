'use client';
// src/components/orders/ShipSheet.tsx — SHIP ONE ORDER. Pick a box (weight comes from the items plus the box), pick a
// rate (cheapest first), buy and print the label, then mark it shipped. Or type tracking from a label bought elsewhere.
// Insurance and signature follow the shop's shipping rules automatically (the label route applies them).
import { isZplLabel, slipAfterLabel } from '@/lib/label-format';
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { shipIt } from '@/lib/orders-flow';
import { firstName, money } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, muted } from './ui';

type Preset = { id: string; name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number };
type Rate = { id: string; provider: string; service: string; amountCents: number; days: number | null };

export function ShipSheet({ fs, tenantId, order, inventory, rs, actor, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; inventory: any[]; rs: any; actor: Actor; onClose: () => void; onDone: (msg: string) => void }) {
  const presets: Preset[] = (rs?.packagingPresets || []).slice(0, 8);
  const itemsOz = React.useMemo(() => (order.lines || []).reduce((s: number, l: any) => {
    if (l.digital === true) return s;
    const w = Number(inventory.find((i: any) => i.id === l.productId)?.weightOz) || 4;
    return s + w * Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
  }, 0), [order, inventory]);
  const [preset, setPreset] = React.useState<Preset | null>(presets[0] || null);
  const [oz, setOz] = React.useState(() => Math.max(4, Math.ceil(itemsOz + (presets[0]?.weightOz || 3))));
  const [editWeight, setEditWeight] = React.useState(false);
  const [rates, setRates] = React.useState<Rate[]>([]); const [rate, setRate] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false); const [err, setErr] = React.useState('');
  const [label, setLabel] = React.useState<{ url: string; carrier: string; number: string; trackUrl: string } | null>(order.labelUrl ? { url: order.labelUrl, carrier: order.carrier || '', number: order.trackingNumber || '', trackUrl: order.trackingUrl || '' } : null);
  const [manual, setManual] = React.useState(!(rs?.shippoConnected || rs?.shippoApiKey) && !label);
  const [mCarrier, setMCarrier] = React.useState(''); const [mNumber, setMNumber] = React.useState('');
  const dims = preset || { lengthIn: 10, widthIn: 8, heightIn: 4 } as any;

  const post = async (body: any) => {
    const r = await fetch('/api/retail/shipping-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', ...body }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'That didn’t work.'); return d;
  };
  const loadRates = React.useCallback(async () => {
    if (manual || label) return; setLoading(true); setErr('');
    try { const d = await post({ action: 'rates', parcels: [{ weightOz: oz, lengthIn: dims.lengthIn, widthIn: dims.widthIn, heightIn: dims.heightIn }] }); const rs2 = (d.rates || []).sort((a: Rate, b: Rate) => a.amountCents - b.amountCents); setRates(rs2); setRate(rs2[0]?.id || ''); }
    catch (e: any) { setErr(e.message); } setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oz, preset?.id, manual, label]);
  React.useEffect(() => { void loadRates(); }, [loadRates]);

  const buy = async () => {
    setLoading(true); setErr('');
    try { const d = await post({ action: 'purchase', rateId: rate }); setLabel({ url: d.labelUrl || '', carrier: d.carrier || '', number: d.trackingNumber || '', trackUrl: d.trackingUrl || '' }); if (d.labelUrl) window.open(d.labelUrl, '_blank'); }
    catch (e: any) { setErr(e.message); } setLoading(false);
  };
  const markShipped = async (t: { carrier?: string; number?: string; url?: string }) => {
    setLoading(true); const r = await shipIt(fs, tenantId, order, actor, t); setLoading(false);
    if (r.ok) onDone(`${firstName(order.customerName)}’s order is on its way. They get tracking when the carrier scans it.`); else setErr(r.message);
  };
  const chosen = rates.find((r) => r.id === rate);
  const pill = (on: boolean) => ({ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: C.paper, color: C.ink } as React.CSSProperties);

  return (
    <Sheet title={`Ship ${firstName(order.customerName)}’s order`} sub={order.shippingAddress ? `To ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode || ''}` : undefined} onClose={onClose}>
      {label ? (
        <div className="mt-2">
          <div className="rounded-2xl p-4" style={{ background: C.soft }}><p className="m-0 text-[17px] font-semibold">Label ready</p><p className="m-0 mt-1 text-[15px]" style={muted}>{[label.carrier, label.number].filter(Boolean).join(' · ')}</p><p className="m-0 mt-2 text-[14px] font-semibold" style={{ color: order.labelCheckedAt ? C.ok : C.ink }}>{order.labelCheckedAt ? 'Label on the box and checked' : 'Stick it on, then scan the label to check it’s the right box'}</p></div>
          <div className="mt-3 flex flex-col gap-2">
            {label.url && <Btn kind="soft" onClick={() => window.open(label.url, '_blank')}>{isZplLabel(label.url) ? 'Download the printer file again' : 'Print the label again'}</Btn>}
            {slipAfterLabel(rs) && order.qrToken && <Btn kind="soft" onClick={() => window.open(`/print/packing-slip/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken || '')}`, '_blank')}>Print the packing slip</Btn>}
            <Btn kind="primary" className="text-[17px]" disabled={loading} onClick={() => void markShipped({ carrier: label.carrier, number: label.number, url: label.trackUrl })}>Mark as shipped</Btn>
          </div>
        </div>
      ) : manual ? (
        <div className="mt-2 flex flex-col gap-2.5">
          <label className="text-[13px] font-semibold" style={muted}>Carrier<input value={mCarrier} onChange={(e) => setMCarrier(e.target.value)} placeholder="USPS, UPS, FedEx" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, color: C.ink, background: C.paper }} /></label>
          <label className="text-[13px] font-semibold" style={muted}>Tracking number<input value={mNumber} onChange={(e) => setMNumber(e.target.value)} className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, color: C.ink, background: C.paper }} /></label>
          <p className="m-0 text-[14px]" style={muted}>{firstName(order.customerName)} gets an email with this tracking number.</p>
          <Btn kind="primary" className="text-[17px]" disabled={loading || !mNumber.trim()} onClick={() => void markShipped({ carrier: mCarrier.trim(), number: mNumber.trim() })}>Mark as shipped</Btn>
          {(rs?.shippoConnected || rs?.shippoApiKey) && <Btn kind="plain" onClick={() => setManual(false)} style={muted}>Buy a label here instead</Btn>}
        </div>
      ) : (
        <div className="mt-2">
          <p className="m-0 text-[13px] font-semibold" style={muted}>Box</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {presets.map((p) => <button key={p.id} type="button" onClick={() => { setPreset(p); setOz(Math.max(4, Math.ceil(itemsOz + (p.weightOz || 0)))); }} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={pill(preset?.id === p.id)}>{p.name}</button>)}
            {presets.length === 0 && <span className="text-[15px]" style={muted}>Standard box, 10 × 8 × 4</span>}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.soft }}>
            {editWeight ? <label className="flex items-center gap-2">Weight <input type="number" min={1} value={oz} onChange={(e) => setOz(Math.max(1, Number(e.target.value) || 1))} className="h-10 w-20 rounded-xl border px-2 text-[17px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /> oz</label>
              : <span><b className="font-semibold">{Math.floor(oz / 16) ? `${Math.floor(oz / 16)} lb ` : ''}{oz % 16} oz</b> <span style={muted}>from the items and box</span></span>}
            <button type="button" onClick={() => setEditWeight((e) => !e)} className="h-11 px-1 font-semibold">{editWeight ? 'Done' : 'Change'}</button>
          </div>
          <p className="m-0 mt-4 text-[13px] font-semibold" style={muted}>Carrier{order.shippingCents ? ` · they paid ${money(order.shippingCents)} for shipping` : ''}</p>
          <div className="mt-2 flex flex-col gap-2">
            {loading && rates.length === 0 && <p className="m-0 py-3 text-[15px]" style={muted}>Getting rates…</p>}
            {rates.map((r, i) => (
              <button key={r.id} type="button" onClick={() => setRate(r.id)} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left" style={pill(rate === r.id)}>
                <span className="h-5 w-5 shrink-0 rounded-full" style={{ border: rate === r.id ? `6px solid ${C.ink}` : `2px solid ${C.line}`, boxSizing: 'border-box' }} />
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{r.provider} {r.service}</span><span className="block text-[13px]" style={muted}>{r.days ? `About ${r.days} day${r.days === 1 ? '' : 's'}` : 'Delivery time varies'}{i === 0 ? ' · cheapest' : ''}</span></span>
                <span className="text-[15px] font-semibold">{money(r.amountCents)}</span>
              </button>))}
          </div>
          <p className="m-0 mt-3 text-[14px]" style={muted}>Insurance and signature follow your shipping rules. {firstName(order.customerName)} gets tracking when the carrier first scans the box.</p>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={loading || !chosen} onClick={() => void buy()}>{chosen ? `Buy label for ${money(chosen.amountCents)} and print` : 'Choose a rate'}</Btn>
          <Btn kind="plain" className="mt-1 w-full" style={muted} onClick={() => setManual(true)}>I already have tracking</Btn>
        </div>)}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
    </Sheet>);
}
