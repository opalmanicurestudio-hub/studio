'use client';
// src/components/inventory/ListingExtras.tsx — THE PARTS OF A PRODUCT THAT USED TO LIVE IN SHOP SETTINGS, now on the
// product's own In the shop tab: its photos and video, its wholesale price and minimum, its documents for customers,
// and selling it before it's in stock (a pre-order run, or made to order). Each is its own section with its own save.
import * as React from 'react';
import { ArrowDown, ArrowUp, Loader, Trash2 } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload-image';
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { collectImages } from '@/lib/product-public';
import { Section } from './ListingSection';
import { VariantSettings } from '@/components/retail/VariantSettings';
import { useFirebase } from '@/firebase';
import type { Firestore } from 'firebase/firestore';

type Save = (patch: Record<string, any>) => Promise<void> | void;
const label = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground';
const hint = 'text-[10px] font-bold text-muted-foreground';
const field = 'h-11 rounded-xl border-2 font-bold text-xs';
const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, '_');

// ─── Photos and video ───────────────────────────────────────────────────────────

export function PhotosSection({ product, onSave }: { product: any; onSave: Save }) {
  const { selectedTenant } = useTenant() as any; const tenantId = String(selectedTenant?.id || '');
  const { toast } = useToast();
  const start = React.useMemo(() => ({ imgs: collectImages(product).slice(0, 10), video: String(product.videoUrl || '') }), [product]);
  const [d, setD] = React.useState(start);
  const base = React.useRef(start);
  React.useEffect(() => { if (JSON.stringify(start) !== JSON.stringify(base.current)) { setD((cur) => (JSON.stringify(cur) === JSON.stringify(base.current) ? start : cur)); base.current = start; } }, [start]);
  const [busy, setBusy] = React.useState<'img' | 'video' | null>(null);
  const [link, setLink] = React.useState('');
  const dirty = JSON.stringify(d) !== JSON.stringify(start);

  const addImages = async (files: FileList | null) => {
    if (!files?.length || !tenantId) return;
    setBusy('img');
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 10 - d.imgs.length)) {
        if (f.size > 10 * 1024 * 1024) { toast({ variant: 'destructive', title: `${f.name} is too large`, description: 'Photos up to 10 MB.' }); continue; }
        urls.push(await uploadImage(`tenants/${tenantId}/products/${product.id}/${Date.now()}-${safeName(f.name)}`, f, 1600));
      }
      if (urls.length) setD((x) => ({ ...x, imgs: [...x.imgs, ...urls].slice(0, 10) }));
    } catch { toast({ variant: 'destructive', title: 'The upload didn’t finish', description: 'Check your connection and try again.' }); }
    finally { setBusy(null); }
  };
  const addVideo = async (files: FileList | null) => {
    const f = files?.[0]; if (!f || !tenantId) return;
    if (f.size > 100 * 1024 * 1024) { toast({ variant: 'destructive', title: 'That video is too large', description: 'Videos up to 100 MB.' }); return; }
    setBusy('video');
    try {
      const r = storageRef(getStorage(), `tenants/${tenantId}/products/${product.id}/${Date.now()}-${safeName(f.name)}`);
      await uploadBytes(r, f, { contentType: f.type || 'video/mp4' });
      const url = await getDownloadURL(r);
      setD((x) => ({ ...x, video: url }));
    } catch { toast({ variant: 'destructive', title: 'The upload didn’t finish', description: 'Check your connection and try again.' }); }
    finally { setBusy(null); }
  };
  const move = (i: number, by: number) => setD((x) => { const a = [...x.imgs]; const j = i + by; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, imgs: a }; });

  return (
    <Section title="Photos and video" hint="The first photo is the one shown in the shop’s lists." dirty={dirty}
      onSave={async () => { await onSave({ imageUrls: d.imgs, imageUrl: d.imgs[0] || null, photoUrl: null, images: [], videoUrl: d.video || '' }); }}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {d.imgs.map((u, i) => (
          <div key={u} className="space-y-1">
            <img src={u} alt={`Photo ${i + 1}${i === 0 ? ', the cover' : ''}`} className="aspect-square w-full rounded-xl border-2 object-cover" />
            <div className="flex justify-between">
              <Button variant="ghost" size="icon" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)} className="h-11 w-11 rounded-lg"><ArrowUp className="h-4 w-4 -rotate-90" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove photo ${i + 1}`} onClick={() => setD((x) => ({ ...x, imgs: x.imgs.filter((_, k) => k !== i) }))} className="h-11 w-11 rounded-lg text-muted-foreground"><Trash2 className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Move photo ${i + 1} later`} disabled={i === d.imgs.length - 1} onClick={() => move(i, 1)} className="h-11 w-11 rounded-lg"><ArrowDown className="h-4 w-4 -rotate-90" /></Button>
            </div>
          </div>))}
        {d.imgs.length < 10 && (
          <label className="flex aspect-square cursor-pointer items-center justify-center rounded-xl border-2 border-dashed focus-within:ring-2 focus-within:ring-ring text-[10px] font-black uppercase tracking-widest hover:bg-muted">
            <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos" disabled={!!busy} onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }} />
            {busy === 'img' ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Add'}
          </label>)}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-2.5">
        <p className="min-w-0 truncate text-xs font-bold">{d.video ? 'A video is attached' : 'No video'}</p>
        <div className="flex shrink-0 gap-2">
          {d.video && <Button variant="ghost" onClick={() => setD((x) => ({ ...x, video: '' }))} className="h-11 rounded-xl text-[10px] font-black uppercase tracking-widest">Remove</Button>}
          <label className="inline-flex h-11 cursor-pointer items-center rounded-xl border-2 px-3 focus-within:ring-2 focus-within:ring-ring text-[10px] font-black uppercase tracking-widest hover:bg-muted">
            <input type="file" accept="video/*" className="sr-only" aria-label="Upload a video" disabled={!!busy} onChange={(e) => { void addVideo(e.target.files); e.target.value = ''; }} />
            {busy === 'video' ? 'Uploading…' : d.video ? 'Replace' : 'Upload a video'}
          </label>
        </div>
      </div>
      {d.imgs.length < 10 && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const u = link.trim(); if (!/^https?:\/\/\S+$/i.test(u)) { toast({ variant: 'destructive', title: 'That isn’t a web address', description: 'Paste a link that starts with https://' }); return; } setD((x) => ({ ...x, imgs: [...x.imgs, u].slice(0, 10) })); setLink(''); }}>
          <Input aria-label="Add a photo by its web address" value={link} placeholder="Or paste a photo’s web address" onChange={(e) => setLink(e.target.value)} className={`${field} flex-1`} />
          <Button type="submit" variant="outline" disabled={!link.trim()} className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Add</Button>
        </form>)}
      <p className={hint}>Up to 10 photos (10 MB each) and one video (100 MB).</p>
    </Section>
  );
}

// ─── Wholesale ──────────────────────────────────────────────────────────────────

export function WholesaleSection({ product, onSave }: { product: any; onSave: Save }) {
  const start = { price: product.wholesalePriceDollars != null && Number(product.wholesalePriceDollars) > 0 ? String(product.wholesalePriceDollars) : '', min: product.wholesaleMinQty != null ? String(product.wholesaleMinQty) : '' };
  const [d, setD] = React.useState(start);
  const dirty = d.price !== start.price || d.min !== start.min;
  return (
    <Section title="Wholesale" hint="The price and minimum for business accounts. Blank uses each account’s discount." dirty={dirty}
      onSave={async () => { await onSave({ wholesalePriceDollars: Number(d.price) > 0 ? Math.round(Number(d.price) * 100) / 100 : null, wholesaleMinQty: d.min.trim() === '' ? null : Math.max(0, Math.floor(Number(d.min) || 0)) }); }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label className={label} htmlFor="ws-price">Wholesale price ($)</Label><Input id="ws-price" inputMode="decimal" value={d.price} placeholder={`Retail $${Number(product.msrp || 0).toFixed(2)}`} onChange={(e) => setD({ ...d, price: e.target.value.replace(/[^0-9.]/g, '') })} className={field} /></div>
        <div className="space-y-1"><Label className={label} htmlFor="ws-min">Minimum to order</Label><Input id="ws-min" inputMode="numeric" value={d.min} placeholder="None" onChange={(e) => setD({ ...d, min: e.target.value.replace(/\D/g, '') })} className={field} /></div>
      </div>
    </Section>
  );
}

// ─── How each variant sells ─────────────────────────────────────────────────────

/** A listing's variants: a wholesale price and weight of their own, or a setting of their own put back to the listing's. */
export function VariantsSellSection({ product, inventory }: { product: any; inventory: any[] }) {
  const { firestore } = useFirebase() as any;
  const { selectedTenant } = useTenant() as any; const tenantId = String(selectedTenant?.id || '');
  const { toast } = useToast();
  const byId = React.useMemo(() => new Map((inventory || []).map((i: any) => [String(i.id), i])), [inventory]);
  return <VariantSettings firestore={(firestore as Firestore) || null} tenantId={tenantId} listing={product} byId={byId}
    onToast={(t) => toast({ title: t.title, description: t.description, ...(t.bad ? { variant: 'destructive' as const } : {}) })} />;
}

// ─── Documents for customers ────────────────────────────────────────────────────

export function DocumentsSection({ product, onSave }: { product: any; onSave: Save }) {
  const { selectedTenant } = useTenant() as any; const tenantId = String(selectedTenant?.id || '');
  const { toast } = useToast();
  const start = (Array.isArray(product.documents) ? product.documents : []).filter((x: any) => x?.name && x?.url).map((x: any) => ({ name: String(x.name), url: String(x.url) }));
  const [docs, setDocs] = React.useState<{ name: string; url: string }[]>(start);
  const [busy, setBusy] = React.useState(false);
  const dirty = JSON.stringify(docs) !== JSON.stringify(start);
  const badAt = docs.findIndex((x) => !x.name.trim() || !/^https?:\/\/\S+$/i.test(x.url.trim()));
  const upload = async (files: FileList | null) => {
    const f = files?.[0]; if (!f || !tenantId) return;
    if (f.size > 20 * 1024 * 1024) { toast({ variant: 'destructive', title: 'That file is too large', description: 'Documents up to 20 MB.' }); return; }
    setBusy(true);
    try {
      const r = storageRef(getStorage(), `tenants/${tenantId}/products/${product.id}/${Date.now()}-${safeName(f.name)}`);
      await uploadBytes(r, f, { contentType: f.type || 'application/pdf' });
      const url = await getDownloadURL(r);
      setDocs((x) => [...x, { name: f.name.replace(/\.[^.]+$/, ''), url }].slice(0, 20));
    } catch { toast({ variant: 'destructive', title: 'The upload didn’t finish', description: 'Check your connection and try again.' }); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Documents for customers" hint="Safety data sheets, ingredients, instructions. Anyone viewing the product can open them." dirty={dirty}
      onSave={async () => { if (badAt >= 0) { toast({ variant: 'destructive', title: 'Not saved yet', description: `Document ${badAt + 1} needs a name and a web link.` }); return; } await onSave({ documents: docs.map((x) => ({ name: x.name.trim(), url: x.url.trim() })) }); }}>
      {docs.map((x, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={`Document ${i + 1} name`} value={x.name} onChange={(e) => setDocs(docs.map((y, k) => (k === i ? { ...y, name: e.target.value.slice(0, 80) } : y)))} className={`${field} flex-1`} />
          <Input aria-label={`Document ${i + 1} link`} value={x.url} onChange={(e) => setDocs(docs.map((y, k) => (k === i ? { ...y, url: e.target.value } : y)))} className={`${field} flex-1`} />
          <Button variant="ghost" size="icon" aria-label={`Remove ${x.name || `document ${i + 1}`}`} onClick={() => setDocs(docs.filter((_, k) => k !== i))} className="h-11 w-11 shrink-0 rounded-xl text-muted-foreground"><Trash2 className="h-4 w-4" /></Button>
        </div>))}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex h-11 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
          <input type="file" accept=".pdf,image/*" className="sr-only" aria-label="Upload a document" disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
          {busy ? 'Uploading…' : 'Upload a document'}
        </label>
        <Button variant="outline" onClick={() => setDocs([...docs, { name: '', url: 'https://' }].slice(0, 20))} className="h-11 rounded-xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest">Add a link</Button>
      </div>
    </Section>
  );
}

// ─── Before it's in stock: pre-order and made to order ──────────────────────────

export function BeforeStockSection({ product, onSave }: { product: any; onSave: Save }) {
  const { selectedTenant } = useTenant() as any; const tenantId = String(selectedTenant?.id || '');
  const { toast } = useToast();
  const start = {
    pre: product.preorder === true, eta: String(product.preorderEtaAt || ''), closes: String(product.preorderClosesAt || ''), limit: product.preorderLimit ? String(product.preorderLimit) : '',
    made: Number(product.leadDays?.max) > 0, min: Number(product.leadDays?.min) > 0 ? String(product.leadDays.min) : '', max: Number(product.leadDays?.max) > 0 ? String(product.leadDays.max) : '',
  };
  const [d, setD] = React.useState(start);
  const [run, setRun] = React.useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));

  const save = async () => {
    const max = Math.min(120, Math.max(0, Math.floor(Number(d.max) || Number(d.min) || 0)));
    const min = Math.min(max, Math.max(1, Math.floor(Number(d.min) || max)));
    await onSave({
      preorder: d.pre, preorderEtaAt: d.pre ? d.eta || null : null, preorderClosesAt: d.pre ? d.closes || null : null,
      preorderLimit: d.pre ? Math.max(0, Math.floor(Number(d.limit) || 0)) || null : null,
      // Made to order: the longest time is what the ship-by date counts; the shortest is only shown.
      leadDays: d.made && max > 0 ? { min, max } : null,
    });
    // The draft now reads as it was saved, so the section doesn't stay unsaved.
    const made = d.made && max > 0;
    setD((x) => ({ ...x, limit: x.pre && Math.floor(Number(x.limit) || 0) > 0 ? String(Math.floor(Number(x.limit))) : '', made, min: made ? String(min) : '', max: made ? String(max) : '' }));
  };

  // The run's two actions, as they worked in Shop settings: each checks first, then asks, then tells every buyer.
  const runAction = async (kind: 'eta' | 'cancel') => {
    if (!tenantId || run) return;
    if (kind === 'eta' && (!start.eta || dirty)) { toast({ variant: 'destructive', title: 'Save the new date first', description: 'Change Ships by, save, then tell everyone.' }); return; }
    setRun(true);
    try {
      const url = kind === 'eta' ? '/api/retail/preorder-run-eta' : '/api/retail/preorder-run-cancel';
      const peek = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, productId: product.id, dryRun: true }) }).then((r) => r.json());
      if (!peek.ok) { toast({ variant: 'destructive', title: 'Could not check the run', description: peek.error || 'Try again.' }); return; }
      if (!peek.orders) { toast({ title: kind === 'eta' ? 'Nobody to tell' : 'Nothing to cancel', description: 'No open pre-orders on this product.' }); return; }
      const ok = window.confirm(kind === 'eta'
        ? `Tell ${peek.orders} customer(s) the new date is ${start.eta}? Each can keep waiting or cancel for a full refund.`
        : `Cancel this run? ${peek.orders} customer order(s), $${(peek.refundCents / 100).toFixed(2)} to refund. Each person is emailed. Refunds within your automatic amount go back on their own; the rest wait on Problems for someone allowed to send them.`);
      if (!ok) return;
      const why = window.prompt(kind === 'eta' ? 'Why the change? (optional, goes in the email word for word)' : 'Tell them why (goes in the email word for word):') || '';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'eta' ? { tenantId, productId: product.id, newDate: start.eta, note: why } : { tenantId, productId: product.id, reason: why }) });
      const data = await res.json();
      if (!res.ok) toast({ variant: 'destructive', title: kind === 'eta' ? 'Not sent' : 'Not cancelled', description: data.error || 'Try again.' });
      else toast({ title: kind === 'eta' ? 'Everyone told' : 'Run cancelled', description: kind === 'eta' ? `${data.orders} order(s) updated, ${data.emailed} emailed.` : `${data.orders} order(s), $${(data.refundCents / 100).toFixed(2)} to refund${data.sentCents ? `, $${(data.sentCents / 100).toFixed(2)} of it sent back already` : ''}, ${data.emailed} emailed.` });
    } catch { toast({ variant: 'destructive', title: 'Not done', description: 'Check your connection and try again.' }); }
    finally { setRun(false); }
  };

  return (
    <Section title="Before it’s in stock" hint="Take pre-orders with a ship-by date, or make it to order." dirty={dirty} onSave={save}>
      <div className="flex items-start justify-between gap-3 rounded-xl border-2 p-3">
        <div className="min-w-0"><p className="text-xs font-black uppercase tracking-tight">Take pre-orders</p><p className="text-[11px] font-bold text-muted-foreground">Sold before it lands, with a ship-by date you can keep. Miss it and buyers get a one-tap refund.</p></div>
        <Switch aria-label="Take pre-orders" checked={d.pre} onCheckedChange={(v: boolean) => set({ pre: v })} />
      </div>
      {d.pre && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className={label} htmlFor="po-eta">Ships by</Label><Input id="po-eta" type="date" value={d.eta} onChange={(e) => set({ eta: e.target.value })} className={field} /></div>
            <div className="space-y-1"><Label className={label} htmlFor="po-close">Orders close</Label><Input id="po-close" type="date" value={d.closes} onChange={(e) => set({ closes: e.target.value })} className={field} /></div>
          </div>
          <div className="space-y-1"><Label className={label} htmlFor="po-limit">Most this run can take</Label><Input id="po-limit" inputMode="numeric" value={d.limit} placeholder="No limit" onChange={(e) => set({ limit: e.target.value.replace(/\D/g, '') })} className={field} /></div>
          <p className={hint}>Taken so far: {Number(product.preorderSold) || 0}. Leave the close date blank to keep taking orders until you turn it off.</p>
          {start.pre && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="outline" disabled={run} onClick={() => void runAction('eta')} className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">{run ? 'Working…' : 'Tell everyone the new date'}</Button>
              <Button type="button" variant="outline" disabled={run} onClick={() => void runAction('cancel')} className="h-11 rounded-xl border-2 border-destructive/30 font-black uppercase text-[10px] tracking-widest text-destructive">{run ? 'Working…' : 'Cancel the run and refund'}</Button>
            </div>)}
        </div>)}
      <div className="flex items-start justify-between gap-3 rounded-xl border-2 p-3">
        <div className="min-w-0"><p className="text-xs font-black uppercase tracking-tight">Made to order</p><p className="text-[11px] font-bold text-muted-foreground">Takes more business days than your usual time. In a cart with other items, the whole order follows the longest one.</p></div>
        <Switch aria-label="Made to order" checked={d.made} onCheckedChange={(v: boolean) => set({ made: v, min: v && !d.min ? '5' : d.min, max: v && !d.max ? '7' : d.max })} />
      </div>
      {d.made && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          <span>Ships in</span>
          <Input aria-label="Fewest business days" inputMode="numeric" value={d.min} onChange={(e) => set({ min: e.target.value.replace(/\D/g, '') })} className="h-11 w-16 rounded-xl border-2 text-center font-mono text-sm font-bold" />
          <span>to</span>
          <Input aria-label="Most business days" inputMode="numeric" value={d.max} onChange={(e) => set({ max: e.target.value.replace(/\D/g, '') })} className="h-11 w-16 rounded-xl border-2 text-center font-mono text-sm font-bold" />
          <span>business days</span>
        </div>)}
    </Section>
  );
}
