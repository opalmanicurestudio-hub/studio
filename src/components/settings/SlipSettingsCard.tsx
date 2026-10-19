'use client';
// src/components/settings/SlipSettingsCard.tsx — WHAT GOES IN THE BOX. The smart packing slip's size and sections,
// with a live preview of a sample order that has a little of everything. Return and damage wording comes from the
// shop's Policies, so the preview shows exactly what customers will read.
import * as React from 'react';
import QRCode from 'qrcode';
import { buildSlip, slipSettingsOf, type SlipSize } from '@/lib/order-slip';
import { SMART_SLIP_CSS, SmartSlip } from '@/components/print/SmartSlip';

const SAMPLE = (gift: boolean) => ({
  orderNumber: 1042, customerName: 'Dana Parker', packageCount: gift ? 1 : 2, claimedByName: 'Maya',
  ...(gift ? { gift: { to: 'Sam', message: 'Happy birthday! Treat those hands.' } } : {}),
  lines: [
    { lineId: 'a', productId: 'p1', name: 'Argan repair oil 50 ml', unitPriceCents: 2400, qtyOrdered: 2 },
    { lineId: 'b', productId: 'p2', name: 'Rose cuticle oil', unitPriceCents: 1800, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'Swapped', swappedToName: 'Lavender cuticle oil' },
    { lineId: 'c', productId: 'p3', name: 'Lavender cuticle oil', unitPriceCents: 1600, qtyOrdered: 1, swapForLineId: 'b', swapForName: 'Rose cuticle oil' },
    { lineId: 'd', productId: 'p4', name: 'Cuticle balm', unitPriceCents: 1200, qtyOrdered: 1, qtyShorted: 1, status: 'backordered' },
  ],
});
const SAMPLE_PRODUCTS = { p1: { careNote: 'Your care note for this product prints here.', batches: [{ stock: 5, lot: '24B', expirationDate: '2027-03-01', receivedDate: '2026-09-01' }] } };

const SECTIONS: { key: string; label: string; note: string }[] = [
  { key: 'notInBox', label: 'Not in this box', note: 'Short, back-ordered or pre-ordered items, and what happens next' },
  { key: 'swap', label: 'We made a swap', note: 'What they ordered, what came instead, and the money back' },
  { key: 'boxes', label: 'Sent in more than one box', note: 'How many boxes, tracked from the order page' },
  { key: 'care', label: 'How to use', note: 'From the care note on each product' },
  { key: 'useBy', label: 'Use by and batch', note: 'For products you track by batch' },
  { key: 'gift', label: 'Gift slip for gift orders', note: 'Their message, no prices, gift exchange code' },
  { key: 'damage', label: 'Arrived damaged?', note: 'Uses your problem report window and photo rule from Policies' },
  { key: 'returns', label: 'Easy returns', note: 'Uses your return window from Policies' },
  { key: 'prices', label: 'Prices on the slip', note: 'Never on gift orders' },
];

export function SlipSettingsCard({ rs, setRs }: { rs: any; setRs: (next: any) => void }) {
  const st = slipSettingsOf(rs);
  const [giftView, setGiftView] = React.useState(false);
  const [qr, setQr] = React.useState('');
  React.useEffect(() => { QRCode.toDataURL('https://example.com/order', { width: 200, margin: 0 }).then(setQr).catch(() => {}); }, []);
  const set = (patch: any) => setRs({ ...rs, slip: { ...(rs.slip || {}), ...patch } });
  const model = buildSlip(SAMPLE(giftView), rs, SAMPLE_PRODUCTS as any);
  const scale = st.size === '4x6' ? 0.62 : st.size === 'half' ? 0.45 : 0.29;
  const box = st.size === '4x6' ? [4, 6] : st.size === 'half' ? [5.5, 8.5] : [8.5, 11];

  return (
    <div className="space-y-4">
      <style>{SMART_SLIP_CSS}</style>
      <div>
        <p className="text-sm font-bold">What goes in the box</p>
        <p className="text-[12px] text-muted-foreground">One slip per order. Each section prints only when it applies to that order.</p>
      </div>
      <div role="radiogroup" aria-label="Slip size" className="grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1">
        {([['4x6', '4×6 label'], ['half', 'Half-letter'], ['letter', 'Full letter']] as [SlipSize, string][]).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={st.size === id} onClick={() => set({ size: id })}
            className={`h-10 rounded-lg text-[13px] font-semibold ${st.size === id ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{label}</button>))}
      </div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="divide-y rounded-xl border">
          {SECTIONS.map((s) => {
            const on = (st as any)[s.key] === true;
            return (
              <label key={s.key} className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0"><span className="block text-sm font-semibold">{s.label}</span><span className="block text-[12px] text-muted-foreground">{s.note}</span></span>
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} onChange={(e) => set({ [s.key]: e.target.checked })} />
              </label>);
          })}
          <p className="m-0 px-3 py-2 text-[12px] text-muted-foreground">The order page code is always on the slip.</p>
        </div>
        <div className="space-y-2">
          <div className="flex gap-2 text-[12px] font-semibold">
            <button type="button" onClick={() => setGiftView(false)} className={`h-8 rounded-full px-3 ${!giftView ? 'bg-foreground text-background' : 'bg-muted/50'}`}>Sample order</button>
            <button type="button" onClick={() => setGiftView(true)} className={`h-8 rounded-full px-3 ${giftView ? 'bg-foreground text-background' : 'bg-muted/50'}`}>Gift order</button>
          </div>
          <div aria-label="Slip preview" className="overflow-hidden rounded-lg border shadow-sm" style={{ width: `${box[0] * 96 * scale}px`, height: `${box[1] * 96 * scale}px` }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <SmartSlip m={model} size={st.size} shopName="Your shop" qr={qr} giftQr={qr} />
            </div>
          </div>
        </div>
      </div>
    </div>);
}
