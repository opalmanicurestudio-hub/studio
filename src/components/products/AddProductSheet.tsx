'use client';
// src/components/products/AddProductSheet.tsx — ADD A PRODUCT IN ONE STEP. A photo, the name, whether it's sold or used
// in services, the price, how many are on the shelf now, its barcode if it has one, and whether it's sold online too.
// Everything else (variants, codes, supplier, cost, wording for the shop) is added later on the product's own page, which
// opens when it's saved. A barcode another product already has stops it being added, with the reason (lib/codes-client).
import * as React from 'react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import type { Firestore } from 'firebase/firestore';
import { uploadImage } from '@/lib/upload-image';
import { syncPublicFields } from '@/lib/product-public';
import { addProduct } from '@/lib/codes-client';
import { clashText, formClashes } from '@/components/inventory/ProductCodesField';
import { Btn, C, Sheet, Toggle, muted } from '@/components/orders/ui';
import type { ProductFeatures } from '@/lib/product-features';

export function AddProductSheet({ fs, tenantId, inventory, onClose, features = { sell: true, online: true } }: { fs: Firestore; tenantId: string; inventory: any[]; onClose: () => void; features?: ProductFeatures }) {
  const router = useRouter();
  const [name, setName] = React.useState(''); const [kind, setKind] = React.useState<'retail' | 'professional'>(features.sell ? 'retail' : 'professional');
  const [price, setPrice] = React.useState(''); const [stock, setStock] = React.useState(''); const [barcode, setBarcode] = React.useState('');
  const [online, setOnline] = React.useState(false); const [photo, setPhoto] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const pick = async (f?: File | null) => {
    if (!f) return;
    setUploading(true); setErr('');
    try {
      const ext = (f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      setPhoto(await uploadImage(`tenants/${tenantId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`, f, 1200));
    } catch { setErr('That photo didn’t upload. Try again, or add it later on its page.'); }
    setUploading(false);
  };
  const priceN = Number(String(price).replace(/[^0-9.]/g, '')); const stockN = Math.max(0, Math.floor(Number(stock) || 0));
  const ready = name.trim().length > 0 && (kind === 'professional' || priceN > 0);
  const save = async () => {
    if (!ready || busy) return;
    setErr('');
    const code = barcode.trim();
    if (code) { const c = formClashes(inventory as any[], { barcode: code }).block; if (c.length) { setErr(`That barcode belongs to another product: ${clashText(c)}`); return; } }
    setBusy(true);
    const id = `prod-${nanoid(8)}`; const now = new Date().toISOString();
    const r = await addProduct(fs, tenantId, syncPublicFields({
      id, name: name.trim(), type: kind, category: '', description: '', totalStock: stockN, supplier: '', costPerUnit: 0,
      ...(kind === 'retail' ? { msrp: priceN, showOnline: features.online && online } : priceN > 0 && features.sell ? { msrp: priceN } : {}),
      ...(photo ? { imageUrl: photo } : {}), ...(code ? { barcode: code } : {}),
      batches: [{ id: `batch-${nanoid(6)}`, stock: stockN, costPerUnit: 0, receivedDate: now }], createdAt: now,
    })).catch((e: any) => ({ ok: false, error: e?.message || 'That didn’t save. Try again.' }));
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t save. Try again.'); return; }
    onClose(); router.push(`/inventory/product/${id}`);
  };
  const seg = (on: boolean): React.CSSProperties => ({ background: on ? C.paper : 'transparent', color: on ? C.ink : C.muted, boxShadow: on ? '0 1px 2px rgba(22,23,26,.08)' : 'none' });
  const input: React.CSSProperties = { border: `1px solid ${C.line}`, background: C.paper, color: C.ink };
  return (
    <Sheet title="Add a product" onClose={onClose}>
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label={photo ? 'Change the photo' : 'Add a photo'} className="relative grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl text-[13px] font-medium" style={{ background: C.soft, color: C.muted, border: photo ? 'none' : `1px dashed ${C.muted}` }}>
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : uploading ? 'Adding…' : '+ Photo'}
          </button>
          <p className="m-0 text-[14px]" style={muted}>{features.online ? 'A photo now, or later. A product needs one before it shows in the shop.' : 'A photo now, or later. It helps the team find the right one.'}</p>
        </div>
        <div><label htmlFor="ap-name" className="mb-1.5 block text-[13px] font-semibold" style={muted}>Name</label>
          <input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className="h-12 w-full rounded-xl px-4 text-[16px] outline-none" style={input} /></div>
        {features.sell && <div><p className="m-0 mb-1.5 text-[13px] font-semibold" style={muted}>What it’s for</p>
          <div className="grid grid-cols-2 gap-1 rounded-full p-1" style={{ background: C.soft }} role="group" aria-label="What it’s for">
            <button type="button" aria-pressed={kind === 'retail'} onClick={() => setKind('retail')} className="h-11 rounded-full text-[15px] font-medium" style={seg(kind === 'retail')}>To sell</button>
            <button type="button" aria-pressed={kind === 'professional'} onClick={() => setKind('professional')} className="h-11 rounded-full text-[15px] font-medium" style={seg(kind === 'professional')}>For services</button>
          </div></div>}
        <div className={`grid gap-3 ${features.sell ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {features.sell && <div><label htmlFor="ap-price" className="mb-1.5 block text-[13px] font-semibold" style={muted}>{kind === 'retail' ? 'Price' : 'Price, if sold too'}</label>
            <input id="ap-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$0.00" className="h-12 w-full rounded-xl px-4 text-[16px] tabular-nums outline-none" style={input} /></div>}
          <div><label htmlFor="ap-stock" className="mb-1.5 block text-[13px] font-semibold" style={muted}>On the shelf now</label>
            <input id="ap-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} placeholder="0" className="h-12 w-full rounded-xl px-4 text-[16px] tabular-nums outline-none" style={input} /></div>
        </div>
        <div><label htmlFor="ap-code" className="mb-1.5 block text-[13px] font-semibold" style={muted}>Barcode, if it has one</label>
          <input id="ap-code" value={barcode} onChange={(e) => setBarcode(e.target.value)} data-scan-field autoComplete="off" placeholder="Scan or type it" className="h-12 w-full rounded-xl px-4 text-[16px] outline-none" style={input} /></div>
        {kind === 'retail' && features.online && (
          <div className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: C.soft }} onClick={(e) => { if (!(e.target as HTMLElement).closest('[role="switch"]')) setOnline(!online); }}>
            <div><p className="m-0 text-[15px] font-semibold">Sell it online too</p><p className="m-0 mt-0.5 text-[13px]" style={muted}>It goes live once it has a price and a photo</p></div>
            <Toggle on={online} onChange={setOnline} label="Sell it online too" />
          </div>
        )}
        <p className="m-0 text-[13px]" style={muted}>{features.online ? 'Variants, codes, supplier, cost and the shop’s wording can all be added on its page next.' : 'Codes, supplier, cost and where it’s kept can all be added on its page next.'}</p>
        {err && <p role="alert" className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" type="submit" className="w-full text-[17px]" disabled={!ready || busy || uploading}>{busy ? 'Adding…' : 'Add it'}</Btn>
      </form>
    </Sheet>
  );
}
