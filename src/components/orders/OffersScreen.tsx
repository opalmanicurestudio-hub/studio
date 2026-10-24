'use client';
// src/components/orders/OffersScreen.tsx — BUNDLES, KITS, BOXES, LOOKS AND BOUGHT-TOGETHER PICKS for the online shop
// (lib/retail-offers has the rules). Managers make and change them (a saving is money off); the team can see them.
// Every saving is worked out again at checkout from what is in the cart, and item prices never change: what an offer
// saves comes off as its own line.
import * as React from 'react';
import Link from 'next/link';
import { collection, deleteDoc, doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { listedInShop, listingsOf } from '@/lib/variants';
import { listingPriceCents } from '@/lib/retail-orders';
import { collectImages } from '@/lib/product-public';
import { uploadImage } from '@/lib/upload-image';
import {
  MAX_ITEMS, MAX_PCT, MAX_POOL, MAX_TIERS, draftProblems, groupOf, groupSaving, problemsOf, readOffer,
  type Offer, type OfferKind, type SaveType,
} from '@/lib/retail-offers';
import { Btn, C, Empty, Group, Ic, LargeTitle, ListRow, Seg, Sheet, Thumb, Toggle, UndoBar, muted } from './ui';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const KINDS: { id: OfferKind; title: string; note: string }[] = [
  { id: 'set', title: 'Bundle or kit', note: 'A fixed group of products, at a saving or a set price' },
  { id: 'box', title: 'Build your own box', note: 'Shoppers pick any products from a list; more picks, bigger saving' },
  { id: 'look', title: 'Shop the look', note: 'A photo with tappable dots on the products in it' },
  { id: 'together', title: 'Bought-together picks', note: 'What to suggest with one product, optionally at a saving' },
];
const kindTitle = (k: OfferKind) => KINDS.find((x) => x.id === k)?.title || 'Offer';
/** What stops an offer working, judged the way the shop and checkout read it (lib/retail-offers readOffer). */
function issuesOf(o: Offer): string[] {
  const xs = [...draftProblems(o), ...problemsOf(o)];
  if (!xs.length && !readOffer({ ...o, status: 'live' }, o.id)) xs.push('Something in it can’t be used. Check each part.');
  return [...new Set(xs)];
}

type Prod = { id: string; name: string; priceCents: number; photo: string };

function blank(kind: OfferKind, id: string, order: number): Offer {
  return {
    id, kind, name: '', blurb: '', status: 'draft', kit: kind === 'set', photoUrl: '', items: [], anchorId: '', pool: [],
    tiers: kind === 'box' ? [{ count: 3, pct: 10 }, { count: 4, pct: 15 }, { count: 6, pct: 20 }] : [],
    save: kind === 'set' ? { type: 'pct', value: 10 } : null, hotspots: [], order,
  };
}

/** A saved offer, as the editor holds it (drafts may still be missing things; lib/retail-offers decides if it works). */
function fromDoc(id: string, d: any): Offer {
  const kind: OfferKind = ['set', 'box', 'look', 'together'].includes(d?.kind) ? d.kind : 'set';
  return {
    ...blank(kind, id, Number(d?.order) || 0), ...d, id, kind,
    items: Array.isArray(d?.items) ? d.items.map((it: any) => ({ productId: String(it?.productId || ''), qty: Math.max(1, Math.floor(Number(it?.qty) || 1)) })).filter((it: any) => it.productId) : [],
    pool: Array.isArray(d?.pool) ? d.pool : [],
    tiers: Array.isArray(d?.tiers) ? d.tiers : [], hotspots: Array.isArray(d?.hotspots) ? d.hotspots : [],
    save: d?.save && d.save.type ? d.save : null, status: d?.status === 'live' ? 'live' : 'draft',
  };
}

export function OffersScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, role } = useTenant() as any;
  const { inventory } = useInventory() as any;
  const tenantId = String(selectedTenant?.id || '');
  const canEdit = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [offers, setOffers] = React.useState<Offer[] | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [edit, setEdit] = React.useState<Offer | null>(null);
  const [toast, setToast] = React.useState('');

  React.useEffect(() => {
    if (!fs || !tenantId) return;
    return onSnapshot(collection(fs, `tenants/${tenantId}/retailOffers`), (snap) => {
      setOffers(snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
    }, () => setOffers([]));
  }, [fs, tenantId]);

  // The products sold online, as listings (a product with variants is one listing; its variants are chosen in the shop).
  const products: Prod[] = React.useMemo(() => {
    const all = (inventory || []) as any[]; const listings = listingsOf(all);
    return all.filter((i) => listedInShop(i, listings) && i.status !== 'archived')
      .map((i) => ({ id: String(i.id), name: String(i.name || 'Item'), priceCents: listingPriceCents(i, 'retail'), photo: collectImages(i)[0] || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory]);
  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const start = (kind: OfferKind) => {
    setPicking(false);
    setEdit(blank(kind, doc(collection(fs, `tenants/${tenantId}/retailOffers`)).id, (offers?.length || 0) + 1));
  };

  const summary = (o: Offer) => {
    if (o.kind === 'box') return o.tiers.length ? `Pick ${o.tiers.map((t) => t.count).join(', ')} · save ${o.tiers[0].pct}${o.tiers.length > 1 ? `–${o.tiers[o.tiers.length - 1].pct}` : ''}% · ${o.pool.length} products` : `${o.pool.length} products`;
    const g = groupOf(o); const full = g.reduce((s, it) => s + (byId.get(it.productId)?.priceCents || 0) * it.qty, 0);
    const off = groupSaving(o.save, full);
    const count = g.reduce((s, it) => s + it.qty, 0);
    const n = o.kind === 'together' ? `${o.items.length} ${o.items.length === 1 ? 'pick' : 'picks'}` : o.kind === 'look' ? `${o.items.length} products · ${o.hotspots.length} dots` : `${count} items`;
    return `${n}${off > 0 ? ` · saves ${money(off)}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-5 lg:px-8" style={{ color: C.ink }}>
      <Link href="/retail-orders/setup" className="cf-press inline-flex h-11 items-center gap-1 text-[15px]" style={muted}>{Ic.back} Setup</Link>
      <LargeTitle title="Bundles and kits" sub="Kits, build-your-own boxes, shoppable looks and what to suggest together."
        right={canEdit ? <Btn kind="primary" onClick={() => setPicking(true)}>New</Btn> : undefined} />
      <p className="m-0 mt-3 text-[14px] leading-snug" style={muted}>Each product keeps its own price and stock. What an offer saves comes off at checkout as its own line, worked out from what is in the cart. Promo codes don’t stack on items an offer already covers.</p>
      {!canEdit && <p className="m-0 mt-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: C.soft }}>Only managers can make or change offers, because a saving is money off.</p>}

      {offers === null ? <p className="mt-10 text-center text-[15px]" style={muted}>Loading…</p>
        : offers.length === 0 ? <Empty title="No offers yet" sub="Start with a kit of things you already use on clients, or a box shoppers fill themselves." action={canEdit ? <Btn kind="primary" onClick={() => setPicking(true)}>Make the first one</Btn> : undefined} />
          : KINDS.map((k) => { const list = offers.filter((o) => o.kind === k.id); if (!list.length) return null;
            return (
              <Group key={k.id} title={k.title}>
                {list.map((o) => { const probs = issuesOf(o); const g = groupOf(o); const photo = o.photoUrl || byId.get(g[0]?.productId || o.pool[0] || '')?.photo;
                  return (
                    <ListRow key={o.id} onClick={() => setEdit(o)} lead={<Thumb src={photo} />}
                      title={o.kind === 'together' ? (byId.get(o.anchorId)?.name || 'Bought-together picks') : (o.name || 'Untitled')}
                      detail={probs.length ? <span style={{ color: C.warn }}>{probs[0]}</span> : summary(o)}
                      trail={<span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={o.status === 'live' && !probs.length ? { background: C.okSoft, color: C.ok } : { background: C.paper, color: C.muted }}>{o.status === 'live' && !probs.length ? 'In the shop' : 'Draft'}</span>} />);
                })}
              </Group>); })}

      {picking && (
        <Sheet title="What are you making?" onClose={() => setPicking(false)}>
          <div className="mt-2 overflow-hidden rounded-2xl" style={{ background: C.soft }}>
            {KINDS.map((k) => <ListRow key={k.id} onClick={() => start(k.id)} title={k.title} detail={k.note} trail={<span style={muted}>{Ic.chev}</span>} />)}
          </div>
        </Sheet>)}
      {edit && <Editor key={edit.id} fs={fs} tenantId={tenantId} start={edit} products={products} byId={byId} canEdit={canEdit}
        exists={!!offers?.some((o) => o.id === edit.id)} onClose={() => setEdit(null)} onToast={setToast} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={24} />}
    </div>);
}

// ─── The editor ─────────────────────────────────────────────────────────────────────────────────────────────────

function Editor({ fs, tenantId, start, products, byId, canEdit, exists, onClose, onToast }: {
  fs: Firestore; tenantId: string; start: Offer; products: Prod[]; byId: Map<string, Prod>; canEdit: boolean; exists: boolean; onClose: () => void; onToast: (m: string) => void;
}) {
  const [o, setO] = React.useState<Offer>(start);
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const [sure, setSure] = React.useState(false);
  const [dot, setDot] = React.useState<string>(start.items[0]?.productId || '');
  const set = (p: Partial<Offer>) => { setO((x) => ({ ...x, ...p })); setErr(''); };
  const probs = issuesOf(o);
  const g = groupOf(o);
  const full = g.reduce((s, it) => s + (byId.get(it.productId)?.priceCents || 0) * it.qty, 0);
  const off = groupSaving(o.save, full);

  const save = async (status: 'live' | 'draft') => {
    if (!canEdit || busy) return;
    if (status === 'live' && probs.length) { setErr(probs[0]); return; }
    setBusy(status);
    try {
      const { id, ...rest } = o;
      await setDoc(doc(fs, `tenants/${tenantId}/retailOffers/${id}`), JSON.parse(JSON.stringify({ ...rest, status, updatedAt: new Date().toISOString(), ...(exists ? {} : { createdAt: new Date().toISOString() }) })));
      onToast(status === 'live' ? `${o.name || 'Picks'} ${start.status === 'live' ? 'updated in the shop' : 'is in the shop'}` : 'Saved as a draft');
      onClose();
    } catch (e: any) { setErr(e?.code === 'permission-denied' ? 'Only managers can change offers.' : 'That didn’t save. Please try again.'); }
    setBusy('');
  };
  const remove = async () => {
    if (!sure) { setSure(true); return; }
    setBusy('delete');
    try { await deleteDoc(doc(fs, `tenants/${tenantId}/retailOffers/${o.id}`)); onToast('Deleted'); onClose(); }
    catch { setErr('That didn’t delete. Please try again.'); }
    setBusy('');
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('photo');
    try { set({ photoUrl: await uploadImage(`tenants/${tenantId}/shop-offers/${o.id}-${Date.now().toString(36)}.jpg`, file, 1800) }); }
    catch { setErr('That photo didn’t upload.'); }
    setBusy('');
  };

  const items = o.items;
  const setItems = (next: typeof items) => {
    const ids = new Set(next.map((it) => it.productId));
    set({ items: next, hotspots: o.hotspots.filter((h) => ids.has(h.productId)) });
    if (!ids.has(dot)) setDot(next[0]?.productId || '');
  };

  return (
    <Sheet wide title={exists ? (o.kind === 'together' ? 'Bought-together picks' : o.name || kindTitle(o.kind)) : `New ${kindTitle(o.kind).toLowerCase()}`} sub={KINDS.find((k) => k.id === o.kind)?.note} onClose={onClose} closeLabel="Close">
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        {o.kind !== 'together' && (
          <Group>
            <label className="block px-4 pt-3 text-[13px] font-semibold" style={muted} htmlFor="offer-name">Name</label>
            <input id="offer-name" value={o.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={o.kind === 'box' ? 'Build your hand care box' : o.kind === 'look' ? 'The soft almond' : 'At-home manicure kit'}
              className="h-12 w-full bg-transparent px-4 text-[17px] outline-none" />
            <div style={{ borderTop: `1px solid ${C.line}` }} />
            <label className="block px-4 pt-3 text-[13px] font-semibold" style={muted} htmlFor="offer-blurb">A line about it (optional)</label>
            <textarea id="offer-blurb" value={o.blurb} maxLength={400} rows={2} onChange={(e) => set({ blurb: e.target.value })} placeholder="What it’s for, in the shop’s words."
              className="w-full resize-none bg-transparent px-4 pb-3 pt-1 text-[16px] outline-none" />
          </Group>)}

        {o.kind === 'set' && (
          <Group foot="A kit shows in the shop as its own product, with its name, photo and price. A bundle shows only on the pages of the products in it.">
            <div className="px-4 py-3"><Seg value={o.kit ? 'kit' : 'bundle'} options={[{ id: 'kit', label: 'Kit' }, { id: 'bundle', label: 'Bundle' }]} onChange={(v) => set({ kit: v === 'kit' })} /></div>
          </Group>)}

        {o.kind === 'together' && (
          <Group title="The product these go with">
            <ProductSelect products={products} value={o.anchorId} onChange={(id) => set({ anchorId: id, items: items.filter((it) => it.productId !== id) })} />
          </Group>)}

        {(o.kind === 'look' || (o.kind === 'set' && o.kit)) && (
          <Group title={o.kind === 'look' ? 'The photo' : 'Kit photo (optional)'} foot={o.kind === 'look' ? 'Choose a product below, then tap the photo where it is to place its dot.' : 'Without one, the first product’s photo is used.'}>
            <div className="p-3">
              {o.photoUrl ? (
                <div className="relative mx-auto max-w-md overflow-hidden rounded-2xl" style={{ background: C.line }}>
                  {o.kind === 'look' ? (
                    <button type="button" aria-label={dot ? `Place the dot for ${byId.get(dot)?.name || 'this product'}` : 'Choose a product below first'} disabled={!dot}
                      onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10; const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10; set({ hotspots: [...o.hotspots.filter((h) => h.productId !== dot), { productId: dot, x, y }] }); }}
                      className="block w-full cursor-crosshair">
                      <img src={o.photoUrl} alt="" className="block w-full" />
                    </button>) : <img src={o.photoUrl} alt="" className="block w-full" />}
                  {o.kind === 'look' && o.hotspots.map((h) => { const i = items.findIndex((it) => it.productId === h.productId);
                    return <span key={h.productId} aria-hidden="true" className="pointer-events-none absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[12px] font-semibold shadow" style={{ left: `${h.x}%`, top: `${h.y}%`, background: h.productId === dot ? '#16171a' : '#fff', color: h.productId === dot ? '#fff' : '#16171a' }}>{i + 1}</span>; })}
                </div>) : null}
              <div className="mt-3 flex gap-2">
                <label className="cf-press inline-flex h-12 flex-1 cursor-pointer items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: C.paper }}>
                  {busy === 'photo' ? 'Uploading…' : o.photoUrl ? 'Change photo' : 'Add a photo'}
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f); }} />
                </label>
                {o.photoUrl && <Btn kind="plain" onClick={() => set({ photoUrl: '', hotspots: [] })}>Remove</Btn>}
              </div>
            </div>
          </Group>)}

        {o.kind !== 'box' && (
          <Group title={o.kind === 'together' ? 'Suggest with it' : o.kind === 'look' ? 'Products in the photo' : 'What’s in it'}
            foot={o.kind === 'together' ? 'Products with no picks are paired automatically from what customers buy together.' : undefined}>
            {items.map((it, i) => { const p = byId.get(it.productId);
              return (
                <div key={it.productId} className="flex min-h-[64px] items-center gap-3 pl-4" style={o.kind === 'look' && dot === it.productId ? { background: C.paper } : undefined}>
                  {o.kind === 'look' ? <button type="button" onClick={() => setDot(it.productId)} aria-pressed={dot === it.productId} aria-label={`Place the dot for ${p?.name || 'this product'}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[13px] font-semibold" style={dot === it.productId ? { background: C.ink, color: C.paper } : { background: C.paper }}>{i + 1}</button> : <Thumb src={p?.photo} size={44} />}
                  <span className="flex min-w-0 flex-1 items-center gap-2 self-stretch py-2 pr-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[16px]">{p?.name || 'A product no longer sold online'}</span><span className="block text-[13px]" style={p ? muted : { color: C.warn }}>{p ? money(p.priceCents) : 'Remove it, or put it back in the shop'}{o.kind === 'look' ? (o.hotspots.some((h) => h.productId === it.productId) ? ' · dot placed' : ' · no dot yet') : ''}</span></span>
                    {o.kind === 'set' && (
                      <span className="flex items-center rounded-full" style={{ background: C.paper }}>
                        <button type="button" aria-label={`One fewer ${p?.name || ''}`} onClick={() => setItems(items.map((x) => x.productId === it.productId ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} className="h-11 w-11 text-[18px]">−</button>
                        <span className="w-5 text-center text-[15px] tabular-nums">{it.qty}</span>
                        <button type="button" aria-label={`One more ${p?.name || ''}`} onClick={() => setItems(items.map((x) => x.productId === it.productId ? { ...x, qty: Math.min(10, x.qty + 1) } : x))} className="h-11 w-11 text-[18px]">+</button>
                      </span>)}
                    <button type="button" aria-label={`Remove ${p?.name || 'this product'}`} onClick={() => setItems(items.filter((x) => x.productId !== it.productId))} className="grid h-11 w-11 shrink-0 place-items-center" style={{ color: C.muted }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                  </span>
                </div>); })}
            {items.length < (o.kind === 'together' ? 6 : MAX_ITEMS) && (
              <ProductAdd products={products.filter((p) => p.id !== o.anchorId && !items.some((it) => it.productId === p.id))} onAdd={(id) => { setItems([...items, { productId: id, qty: 1 }]); if (o.kind === 'look') setDot(id); }} label={items.length ? 'Add another product' : 'Add a product'} />)}
          </Group>)}

        {o.kind === 'box' && (<>
          <Group title="Pick this many, save this much" foot="The step reached sets the saving on everything in the box. A box holds up to the top step’s number of items; more makes another box.">
            {o.tiers.map((t, i) => (
              <div key={i} className="flex min-h-[56px] items-center gap-2 px-4" style={{ borderBottom: `1px solid ${C.line}` }}>
                <label className="flex items-center gap-2 text-[16px]">Pick <input aria-label="How many products" inputMode="numeric" value={t.count || ''} onChange={(e) => set({ tiers: o.tiers.map((x, j) => j === i ? { ...x, count: Math.max(0, Math.min(24, Math.floor(Number(e.target.value) || 0))) } : x) })} className="h-11 w-14 rounded-xl text-center text-[16px] tabular-nums" style={{ background: C.paper }} /></label>
                <label className="flex items-center gap-2 text-[16px]">save <input aria-label="Percent off" inputMode="numeric" value={t.pct || ''} onChange={(e) => set({ tiers: o.tiers.map((x, j) => j === i ? { ...x, pct: Math.max(0, Math.min(MAX_PCT, Math.floor(Number(e.target.value) || 0))) } : x) })} className="h-11 w-14 rounded-xl text-center text-[16px] tabular-nums" style={{ background: C.paper }} />%</label>
                <span className="flex-1" />
                <button type="button" aria-label={`Remove the ${t.count}-item step`} onClick={() => set({ tiers: o.tiers.filter((_, j) => j !== i) })} className="grid h-11 w-11 shrink-0 place-items-center" style={{ color: C.muted }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
              </div>))}
            {o.tiers.length < MAX_TIERS && <button type="button" onClick={() => { const last = o.tiers[o.tiers.length - 1]; set({ tiers: [...o.tiers, { count: (last?.count || 1) + 1, pct: Math.min(MAX_PCT, (last?.pct || 5) + 5) }] }); }} className="cf-press h-12 w-full px-4 text-left text-[16px] font-semibold">Add a step</button>}
          </Group>
          <Group title={`Products shoppers can pick (${o.pool.length})`}>
            {o.pool.map((id) => { const p = byId.get(id);
              return <ListRow key={id} lead={<Thumb src={p?.photo} size={44} />} title={p?.name || 'A product no longer sold online'} detail={p ? money(p.priceCents) : 'Remove it, or put it back in the shop'}
                trail={<button type="button" aria-label={`Remove ${p?.name || 'this product'}`} onClick={() => set({ pool: o.pool.filter((x) => x !== id) })} className="grid h-11 w-11 shrink-0 place-items-center" style={{ color: C.muted }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>} />; })}
            {o.pool.length < MAX_POOL && <ProductAdd products={products.filter((p) => !o.pool.includes(p.id))} onAdd={(id) => set({ pool: [...o.pool, id] })} label={o.pool.length ? 'Add another product' : 'Add products'} />}
          </Group>
        </>)}

        {o.kind !== 'box' && (
          <Group title="What it saves" foot={o.kind === 'set' ? 'Comes off once for each complete set in the cart.' : 'Only when every product is in the cart. Leave it off to just help people shop.'}>
            {o.kind !== 'set' && <div className="flex min-h-[56px] items-center gap-3 px-4" style={{ borderBottom: o.save ? `1px solid ${C.line}` : undefined }}><span className="flex-1 text-[17px]">A saving when bought together</span><Toggle label="A saving when bought together" on={!!o.save} onChange={(v) => set({ save: v ? { type: 'pct', value: 10 } : null })} /></div>}
            {o.save && (
              <div className="space-y-3 px-4 py-3">
                <Seg value={o.save.type} options={[{ id: 'pct' as SaveType, label: 'Percent off' }, { id: 'off' as SaveType, label: 'Amount off' }, ...(o.kind === 'set' ? [{ id: 'price' as SaveType, label: 'Set price' }] : [])]}
                  onChange={(v) => set({ save: { type: v, value: v === 'pct' ? 10 : v === 'off' ? 500 : Math.max(100, Math.round(full * 0.9)) } })} />
                <label className="flex items-center gap-2 text-[17px]">
                  {o.save.type === 'pct' ? null : <span>$</span>}
                  <input aria-label={o.save.type === 'pct' ? 'Percent off' : o.save.type === 'off' ? 'Amount off in dollars' : 'Set price in dollars'} inputMode="decimal"
                    value={o.save.type === 'pct' ? String(o.save.value || '') : o.save.value ? String(o.save.value / 100) : ''}
                    onChange={(e) => { const v = Number(e.target.value) || 0; set({ save: { ...o.save!, value: o.save!.type === 'pct' ? Math.max(0, Math.min(MAX_PCT, Math.round(v))) : Math.max(0, Math.round(v * 100)) } }); }}
                    className="h-12 w-28 rounded-xl px-3 text-[17px] tabular-nums" style={{ background: C.paper }} />
                  {o.save.type === 'pct' ? <span>% off</span> : null}
                </label>
                {full > 0 && <p className="m-0 text-[14px]" style={muted}>At today’s prices: {money(full)} on their own, {money(full - off)} together{off > 0 ? <> · saves <b style={{ color: C.ok }}>{money(off)}</b></> : ''}.</p>}
                {o.save.type === 'price' && o.save.value >= full && full > 0 && <p className="m-0 text-[14px]" style={{ color: C.warn }}>The set price is not below the items’ own prices, so it saves nothing.</p>}
              </div>)}
          </Group>)}

        {probs.length > 0 && <div className="mt-5 rounded-2xl px-4 py-3 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{probs.map((p) => <p key={p} className="m-0">{p}</p>)}</div>}
        {err && <p role="alert" className="m-0 mt-3 text-[14px]" style={{ color: C.bad }}>{err}</p>}

        {canEdit && (
          <div className="mt-6 flex flex-col gap-2">
            <Btn kind="primary" disabled={!!busy || probs.length > 0} onClick={() => save('live')}>{busy === 'live' ? 'Saving…' : start.status === 'live' && exists ? 'Save changes' : 'Put it in the shop'}</Btn>
            <Btn disabled={!!busy} onClick={() => save('draft')}>{busy === 'draft' ? 'Saving…' : start.status === 'live' && exists ? 'Take it out of the shop' : 'Save as a draft'}</Btn>
            {exists && <Btn kind="danger" disabled={!!busy} onClick={remove}>{sure ? 'Delete it for good' : 'Delete'}</Btn>}
          </div>)}
      </fieldset>
    </Sheet>);
}

/** A searchable list to add one product. */
function ProductAdd({ products, onAdd, label }: { products: Prod[]; onAdd: (id: string) => void; label: string }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const shown = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="cf-press h-12 w-full px-4 text-left text-[16px] font-semibold">{label}</button>;
  return (
    <div className="p-3">
      <div className="flex items-center gap-2 rounded-xl px-3" style={{ background: C.paper }}>
        <span style={muted}>{Ic.search}</span>
        <input autoFocus aria-label="Find a product" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product" className="h-11 flex-1 bg-transparent text-[16px] outline-none" />
        <button type="button" onClick={() => { setOpen(false); setQ(''); }} className="h-11 px-1 text-[15px]" style={muted}>Done</button>
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto rounded-xl" style={{ background: C.paper }}>
        {shown.length === 0 ? <p className="m-0 p-4 text-[14px]" style={muted}>{products.length ? 'No products match.' : 'Every product sold online is already here.'}</p>
          : shown.map((p) => <ListRow key={p.id} onClick={() => onAdd(p.id)} lead={<Thumb src={p.photo} size={40} />} title={p.name} detail={money(p.priceCents)} trail={<span className="text-[15px] font-semibold">Add</span>} />)}
      </div>
    </div>);
}

/** Choosing one product. */
function ProductSelect({ products, value, onChange }: { products: Prod[]; value: string; onChange: (id: string) => void }) {
  const p = products.find((x) => x.id === value);
  const [open, setOpen] = React.useState(!value);
  if (!open && p) return <ListRow onClick={() => setOpen(true)} lead={<Thumb src={p.photo} size={44} />} title={p.name} detail={money(p.priceCents)} trail={<span className="text-[15px]" style={muted}>Change</span>} />;
  return <ProductAdd products={products} onAdd={(id) => { onChange(id); setOpen(false); }} label="Choose the product" />;
}
