'use client';
// src/components/shop/offers.tsx — BUNDLES, KITS, BOXES AND LOOKS IN THE SHOP (lib/retail-offers has the rules).
// Every price shown is worked out with the same matcher checkout runs on the server, from the products' own prices,
// so the saving a shopper sees is the saving they get. Adding a bundle adds each product to the bag as itself.
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { addToCart, readCart } from '@/lib/shop-cart';
import { firstChoices, shopLine } from '@/lib/variants';
import { boxNext, boxPct, groupOf, matchOffers, picksFor, type Offer } from '@/lib/retail-offers';

export const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const SAVE = '#1f7a4d';

type P = any;   // a product as the catalog sends it
export type ShopOffer = Offer & { groupsLeft: number | null };

const needsChoice = (p: P) => Array.isArray(p?.optionGroups) && p.optionGroups.length > 0;

/** One select per choice group (scent, size…). A variant that can't be bought is shown as sold out and can't be picked. */
export function ChoicePicks({ product, value, onChange, compact }: { product: P; value: Record<string, string>; onChange: (v: Record<string, string>) => void; compact?: boolean }) {
  if (!needsChoice(product)) return null;
  return (
    <div className={compact ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-2'}>
      {product.optionGroups.map((g: any) => (
        <label key={g.id} className="flex min-w-0 items-center gap-1.5 text-[12px]">
          <span className="sr-only">{g.name} for {product.name}</span>
          <select value={value[g.id] || ''} onChange={(e) => onChange({ ...value, [g.id]: e.target.value })}
            className={`h-11 ${compact ? 'max-w-[11rem]' : 'max-w-[14rem]'} rounded-xl border bg-white px-2 text-[14px]`} style={{ borderColor: '#e2e2e2' }}>
            {g.choices.map((c: any) => <option key={c.id} value={c.id} disabled={g.variants && c.inStock === false}>{c.label}{g.variants && c.inStock === false ? ' (sold out)' : ''}</option>)}
          </select>
        </label>
      ))}
    </div>);
}

function Photo({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  return (
    <span className={`${/\babsolute\b/.test(className) ? '' : 'relative '}block overflow-hidden bg-neutral-100 ${className}`}>
      {src ? <Image src={src} alt={alt} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" /> : <span className="absolute inset-0 grid place-items-center"><Package className="h-6 w-6 opacity-20" aria-hidden="true" /></span>}
    </span>);
}

/** What a group of picked products costs and saves, the way checkout will work it out. */
export function preview(picks: { product: P; qty: number; selections: Record<string, string> }[], offers: Offer[]) {
  const lines = picks.filter((x) => x.qty > 0).map((x, i) => ({ id: `l${i}`, productId: String(x.product.id), unitPriceCents: shopLine(x.product, x.selections).unitCents, qty: x.qty }));
  const full = lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);
  const m = matchOffers(lines, offers);
  return { full, save: m.cents, pay: full - m.cents, applied: m.applied };
}

/** Puts each pick in the bag as itself. Returns the bag's new count. */
export function addPicks(tenantId: string, picks: { product: P; qty: number; selections: Record<string, string> }[]): number {
  for (const x of picks) if (x.qty > 0) addToCart(tenantId, String(x.product.id), x.qty, needsChoice(x.product) ? x.selections : undefined);
  return Object.values(readCart(tenantId)).reduce((a, b) => a + b, 0);
}

// ─── On a product page: "Buy it together" ─────────────────────────────────────────────────────────────────────────

/**
 * A bundle this product is in (the one that saves the most), else the shop's picks for it, else what customers buy
 * with it. Each row has a tick; the total and the saving follow the ticks.
 */
export function BuyTogether({ tenantId, product, selections, products, offers, pairs, onAdded }: {
  tenantId: string; product: P; selections: Record<string, string>; products: P[]; offers: ShopOffer[]; pairs: Record<string, string[]>; onAdded: (count: number) => void;
}) {
  const byId = React.useMemo(() => new Map(products.map((p: P) => [String(p.id), p])), [products]);
  const plan = React.useMemo(() => {
    const id = String(product.id);
    const sets = offers.filter((o) => o.kind === 'set' && o.items.some((it) => it.productId === id) && o.items.every((it) => byId.get(it.productId)?.inStock));
    if (sets.length) {
      const best = sets.map((o) => ({ o, s: preview(o.items.map((it) => ({ product: byId.get(it.productId), qty: it.qty, selections: firstChoices(byId.get(it.productId)?.optionGroups) })), offers).save })).sort((a, b) => b.s - a.s)[0].o;
      return { title: best.kit ? `Get the ${best.name}` : 'Buy it together', offer: best as Offer | null, rows: best.items.map((it) => ({ id: it.productId, qty: it.qty })) };
    }
    const picks = picksFor(id, offers, pairs, new Set(products.filter((p: P) => p.inStock).map((p: P) => String(p.id))));
    if (!picks.ids.length) return null;
    return { title: 'Often bought together', offer: picks.offer, rows: [{ id, qty: 1 }, ...picks.ids.map((x) => ({ id: x, qty: 1 }))] };
  }, [product.id, offers, pairs, byId, products]); // eslint-disable-line react-hooks/exhaustive-deps

  const [on, setOn] = React.useState<Record<string, boolean>>({});
  const [sel, setSel] = React.useState<Record<string, Record<string, string>>>({});
  const [added, setAdded] = React.useState(false);
  React.useEffect(() => { setOn({}); setSel({}); setAdded(false); }, [plan?.offer?.id, product.id]);
  if (!plan) return null;

  const rows = plan.rows.map((r) => ({ ...r, product: r.id === String(product.id) ? product : byId.get(r.id) })).filter((r) => r.product);
  if (rows.length < 2) return null;
  const isOn = (id: string) => on[id] !== false;
  const choiceOf = (r: { id: string; product: P }) => r.id === String(product.id) ? selections : (sel[r.id] || firstChoices(r.product.optionGroups));
  const picks = rows.map((r) => ({ product: r.product, qty: isOn(r.id) ? r.qty : 0, selections: choiceOf(r) }));
  const pv = preview(picks, offers);
  const count = picks.filter((x) => x.qty > 0).reduce((n, x) => n + x.qty, 0);

  return (
    <section aria-labelledby="together-heading" className="rounded-[1.5rem] border-2 bg-white p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="together-heading" className="text-[15px] font-semibold tracking-[-0.01em]">{plan.title}</h2>
        {plan.offer?.save && <span className="text-[12px] font-semibold" style={{ color: SAVE }}>{plan.offer.save.type === 'pct' ? `Save ${plan.offer.save.value}% together` : 'Save when bought together'}</span>}
      </div>
      <ul className="mt-3 divide-y" style={{ borderColor: '#ececee' }}>
        {rows.map((r) => {
          const p = r.product; const line = shopLine(p, choiceOf(r)); const here = r.id === String(product.id);
          return (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <label className="-ml-2.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center"><input type="checkbox" checked={isOn(r.id)} onChange={(e) => { setOn({ ...on, [r.id]: e.target.checked }); setAdded(false); }} aria-label={`Include ${p.name}`} className="h-5 w-5 accent-neutral-900" /></label>
              <Photo src={p.imageUrls?.[0]} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{here ? <b className="font-semibold">This item: </b> : null}{p.name}{r.qty > 1 ? ` × ${r.qty}` : ''}</span>
                <span className="block text-[13px] text-neutral-500">{money(line.unitCents * r.qty)}</span>
                {!here && isOn(r.id) && <span className="mt-1 block"><ChoicePicks compact product={p} value={choiceOf(r)} onChange={(v) => { setSel({ ...sel, [r.id]: v }); setAdded(false); }} /></span>}
              </span>
              {!here && <Link href={`/shop/${tenantId}/product/${p.id}`} className="inline-flex h-11 shrink-0 items-center px-1 text-[13px] underline underline-offset-4">View</Link>}
            </li>);
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: '#ececee' }}>
        <div>
          <p className="m-0 text-[13px] text-neutral-500">Total for {count} {count === 1 ? 'item' : 'items'}</p>
          <p className="m-0 flex items-baseline gap-2"><span className="text-[22px] font-semibold tracking-[-0.02em]">{money(pv.pay)}</span>{pv.save > 0 && <span className="text-[14px] text-neutral-500 line-through">{money(pv.full)}</span>}</p>
          {pv.save > 0 && <p className="m-0 text-[13px] font-semibold" style={{ color: SAVE }}>You save {money(pv.save)}</p>}
        </div>
        <button type="button" disabled={!count || added} onClick={() => { if (added) return; onAdded(addPicks(tenantId, picks)); setAdded(true); }}
          className="h-12 rounded-full bg-neutral-900 px-6 text-[15px] font-semibold text-white disabled:opacity-40">
          {added ? 'Added to your bag' : count === 1 ? 'Add to bag' : `Add all ${count} to bag`}
        </button>
      </div>
    </section>);
}

// ─── On the shop's main page: kits, boxes and looks ───────────────────────────────────────────────────────────────

/** Kits (bundles shown as their own product), build-your-own boxes and shoppable looks, as tiles above the products. */
export function OfferStrip({ tenantId, offers, products }: { tenantId: string; offers: ShopOffer[]; products: P[] }) {
  const byId = new Map(products.map((p: P) => [String(p.id), p]));
  const shown = offers.filter((o) => (o.kind === 'set' && o.kit) || o.kind === 'box' || o.kind === 'look');
  if (!shown.length) return null;
  return (
    <section aria-labelledby="offers-heading" className="mx-auto max-w-5xl px-4 pt-8">
      <h2 id="offers-heading" className="text-[22px] font-light tracking-[-0.02em]">Kits, boxes and looks</h2>
      <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {shown.map((o) => {
          const first = byId.get(groupOf(o)[0]?.productId || o.pool[0] || '');
          const photo = o.photoUrl || first?.imageUrls?.[0];
          let price = ''; let sub = ''; let tag = '';
          if (o.kind === 'set') {
            const pv = preview(o.items.map((it) => ({ product: byId.get(it.productId), qty: it.qty, selections: firstChoices(byId.get(it.productId)?.optionGroups) })), offers);
            price = money(pv.pay); sub = pv.save > 0 ? `Save ${money(pv.save)}` : ''; tag = 'Kit';
            if (o.groupsLeft !== null && o.groupsLeft <= 0) sub = 'Sold out';
            else if (o.groupsLeft !== null && o.groupsLeft <= 3) sub = `${sub ? `${sub} · ` : ''}Only ${o.groupsLeft} left`;
          } else if (o.kind === 'box') {
            const top = o.tiers[o.tiers.length - 1];
            price = `Pick ${o.tiers[0].count}+`; sub = `Save up to ${top.pct}%`; tag = 'Build your own';
          } else { price = `${o.items.length} ${o.items.length === 1 ? 'product' : 'products'}`; sub = o.save ? 'Save on the whole look' : 'Tap what you see'; tag = 'Shop the look'; }
          return (
            <Link key={o.id} href={`/shop/${tenantId}/offer/${o.id}`} className="group w-[15.5rem] shrink-0 snap-start overflow-hidden rounded-[1.5rem] border-2 bg-white">
              <span className="relative block aspect-[4/3]">
                <Photo src={photo} alt="" className="absolute inset-0 transition-transform duration-700 group-hover:scale-[1.03]" />
                <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold">{tag}</span>
              </span>
              <span className="block p-3.5">
                <span className="block truncate text-[15px] font-semibold">{o.name}</span>
                <span className="mt-0.5 flex items-baseline justify-between gap-2"><span className="text-[14px]">{price}</span>{sub && <span className="truncate text-[12px] font-semibold" style={{ color: sub === 'Sold out' ? '#6d7075' : SAVE }}>{sub}</span>}</span>
              </span>
            </Link>);
        })}
      </div>
    </section>);
}

// ─── The offer's own page: a kit, a box, or a look ────────────────────────────────────────────────────────────────

export function SetView({ tenantId, offer, byId, offers, onAdded }: { tenantId: string; offer: ShopOffer; byId: Map<string, P>; offers: Offer[]; onAdded: (n: number) => void }) {
  const [sel, setSel] = React.useState<Record<string, Record<string, string>>>({});
  const [sets, setSets] = React.useState(1);
  const [added, setAdded] = React.useState(false);
  const rows = offer.items.map((it) => ({ ...it, product: byId.get(it.productId) })).filter((r) => r.product);
  const choiceOf = (id: string, p: P) => sel[id] || firstChoices(p.optionGroups);
  const picks = rows.map((r) => ({ product: r.product, qty: r.qty * sets, selections: choiceOf(r.productId, r.product) }));
  const pv = preview(picks, offers);
  const soldOut = offer.groupsLeft !== null && offer.groupsLeft <= 0;
  // As many kits as the chosen choices can make (a variant has its own stock), up to 10.
  const maxSets = Math.max(1, Math.min(10, ...rows.map((r) => { const l = shopLine(r.product, choiceOf(r.productId, r.product)); return Math.floor((l.qtyAvailable || 0) / r.qty); })));
  const missing = rows.some((r) => { const l = shopLine(r.product, choiceOf(r.productId, r.product)); return !l.inStock || l.qtyAvailable < r.qty * sets; });
  return (
    <div className="space-y-5">
      <ul className="divide-y rounded-[1.5rem] border-2 bg-white px-4" style={{ borderColor: '#ececee' }}>
        {rows.map((r) => (
          <li key={r.productId} className="flex items-center gap-3 py-3">
            <Photo src={r.product.imageUrls?.[0]} alt="" className="h-16 w-16 shrink-0 rounded-xl" />
            <span className="min-w-0 flex-1">
              <Link href={`/shop/${tenantId}/product/${r.productId}`} className="block truncate py-2.5 text-[15px] hover:underline">{r.product.name}{r.qty > 1 ? ` × ${r.qty}` : ''}</Link>
              <span className="block text-[13px] text-neutral-500">{money(shopLine(r.product, choiceOf(r.productId, r.product)).unitCents * r.qty)}</span>
              <span className="mt-1 block"><ChoicePicks compact product={r.product} value={choiceOf(r.productId, r.product)} onChange={(v) => { setSel({ ...sel, [r.productId]: v }); setAdded(false); }} /></span>
            </span>
          </li>))}
      </ul>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="m-0 flex items-baseline gap-2"><span className="text-[30px] font-semibold tracking-[-0.02em]">{money(pv.pay)}</span>{pv.save > 0 && <span className="text-[16px] text-neutral-500 line-through">{money(pv.full)}</span>}</p>
          {pv.save > 0 && <p className="m-0 text-[14px] font-semibold" style={{ color: SAVE }}>You save {money(pv.save)}</p>}
          <p className="m-0 mt-1 text-[13px] text-neutral-500">{soldOut ? 'Sold out right now.' : offer.groupsLeft !== null && offer.groupsLeft <= 3 ? `Only ${offer.groupsLeft} left, based on the item there are fewest of.` : 'Each item ships or is picked up as itself, at its own price.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-12 items-center rounded-full border-2">
            <button type="button" aria-label="One fewer" onClick={() => { setSets(Math.max(1, sets - 1)); setAdded(false); }} className="h-11 w-11 text-[18px]">−</button>
            <span className="w-6 text-center font-mono" aria-live="polite">{sets}</span>
            <button type="button" aria-label="One more" disabled={sets >= maxSets} onClick={() => { setSets(Math.min(maxSets, sets + 1)); setAdded(false); }} className="h-11 w-11 text-[18px] disabled:opacity-30">+</button>
          </div>
          <button type="button" disabled={soldOut || missing || added} onClick={() => { if (added) return; onAdded(addPicks(tenantId, picks)); setAdded(true); }} className="h-12 rounded-full bg-neutral-900 px-6 text-[15px] font-semibold text-white disabled:opacity-40">
            {added ? 'Added to your bag' : missing ? 'Not enough of a choice left' : `Add ${offer.kit ? 'kit' : 'bundle'} · ${money(pv.pay)}`}
          </button>
        </div>
      </div>
    </div>);
}

export function BoxView({ tenantId, offer, byId, offers, onAdded }: { tenantId: string; offer: ShopOffer; byId: Map<string, P>; offers: Offer[]; onAdded: (n: number) => void }) {
  const top = offer.tiers[offer.tiers.length - 1];
  const [picks, setPicks] = React.useState<{ key: string; productId: string; selections: Record<string, string> }[]>([]);
  const [sel, setSel] = React.useState<Record<string, Record<string, string>>>({});
  const [added, setAdded] = React.useState(false);
  const pool = offer.pool.map((id) => byId.get(id)).filter((p) => p && p.inStock);
  const n = picks.length;
  const full = n >= top.count;
  const choiceOf = (p: P) => sel[p.id] || firstChoices(p.optionGroups);
  const countOf = (id: string) => picks.filter((x) => x.productId === id).length;
  const add1 = (p: P) => { const s = choiceOf(p); setPicks((cur) => cur.length >= top.count ? cur : [...cur, { key: `${p.id}|${JSON.stringify(s)}|${cur.length}`, productId: p.id, selections: s }]); setAdded(false); };
  const drop1 = (id: string) => { setPicks((cur) => { const i = cur.map((x) => x.productId).lastIndexOf(id); return i < 0 ? cur : cur.filter((_, j) => j !== i); }); setAdded(false); };
  const grouped = new Map<string, { product: P; qty: number; selections: Record<string, string> }>();
  for (const x of picks) { const k = `${x.productId}|${JSON.stringify(x.selections)}`; const cur = grouped.get(k); if (cur) cur.qty++; else grouped.set(k, { product: byId.get(x.productId), qty: 1, selections: x.selections }); }
  const pv = preview([...grouped.values()], offers);
  const pct = boxPct(offer, n); const next = boxNext(offer, n);
  // What actually applies (another offer can take some of these items when that saves more), named as it will be.
  const mineApplied = pv.applied.find((a) => a.offerId === offer.id);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {pool.map((p: P) => (
          <div key={p.id} className="flex flex-col gap-2">
            <span className="relative block">
              <Photo src={p.imageUrls?.[0]} alt="" className="aspect-square rounded-2xl" />
              {countOf(p.id) > 0 && <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-neutral-900 px-2 text-[13px] font-semibold text-white">{countOf(p.id)}</span>}
            </span>
            <span className="line-clamp-2 text-[14px] leading-snug">{p.name}</span>
            <span className="-mt-1 flex items-center justify-between gap-2">
              <span className="text-[13px] text-neutral-500">{money(shopLine(p, choiceOf(p)).unitCents)}</span>
              <span className="flex shrink-0 items-center rounded-full border">
                <button type="button" aria-label={`Remove one ${p.name}`} onClick={() => drop1(p.id)} disabled={!countOf(p.id)} className="h-11 w-11 text-[18px] disabled:opacity-30">−</button>
                <button type="button" aria-label={`Add one ${p.name}`} onClick={() => add1(p)} disabled={full} className="h-11 w-11 text-[18px] disabled:opacity-30">+</button>
              </span>
            </span>
            <ChoicePicks compact product={p} value={choiceOf(p)} onChange={(v) => setSel({ ...sel, [p.id]: v })} />
          </div>))}
      </div>
      <aside className="space-y-4 rounded-[1.5rem] border-2 bg-neutral-50 p-5 lg:sticky lg:top-24">
        <div className="flex items-baseline justify-between"><p className="m-0 text-[17px] font-semibold">Your box</p><p className="m-0 text-[13px] text-neutral-500">{n} of up to {top.count}</p></div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(top.count, 6)}, minmax(0, 1fr))` }}>
          {Array.from({ length: top.count }).map((_, i) => { const x = picks[i]; const p = x ? byId.get(x.productId) : null;
            return <span key={i} className="relative block aspect-square overflow-hidden rounded-lg" style={p ? { background: '#fff', boxShadow: 'inset 0 0 0 1px #e5e5e5' } : { border: '1px dashed #d4d4d4' }}>{p?.imageUrls?.[0] ? <Image src={p.imageUrls[0]} alt={p.name} fill sizes="60px" className="object-cover" /> : null}</span>; })}
        </div>
        <div>
          <div className="relative h-1.5 rounded-full bg-neutral-200"><span className="absolute inset-y-0 left-0 rounded-full bg-neutral-900 transition-[width] duration-500" style={{ width: `${Math.min(100, (n / top.count) * 100)}%` }} /></div>
          <div className="mt-2 flex justify-between text-[12px] text-neutral-500">{offer.tiers.map((t) => <span key={t.count} style={pct === t.pct ? { color: '#16171a', fontWeight: 600 } : undefined}>{t.count} · {t.pct}%</span>)}</div>
          <p className="m-0 mt-2 text-[14px]">{next ? (n === 0 ? `Pick ${next.more} to save ${next.pct}%.` : `Add ${next.more} more to save ${next.pct}%.`) : `Box full. You are saving ${pct}%.`}</p>
        </div>
        <div className="space-y-1 border-t pt-3 text-[14px]" style={{ borderColor: '#e5e5e5' }}>
          <div className="flex justify-between"><span>Items</span><span>{money(pv.full)}</span></div>
          <div className="flex justify-between" style={{ color: SAVE }}><span>{mineApplied && pv.applied.length === 1 ? `Box savings (${mineApplied.pct}%)` : 'Savings'}</span><span>{pv.save ? `−${money(pv.save)}` : money(0)}</span></div>
          <div className="flex justify-between text-[18px] font-semibold"><span>Total</span><span>{money(pv.pay)}</span></div>
        </div>
        <button type="button" disabled={!pct} onClick={() => { onAdded(addPicks(tenantId, [...grouped.values()])); setAdded(true); setPicks([]); }} className="h-12 w-full rounded-full bg-neutral-900 text-[15px] font-semibold text-white disabled:opacity-40">
          {added ? 'Box added to your bag' : pct ? 'Add box to bag' : `Pick at least ${offer.tiers[0].count}`}
        </button>
        <p className="m-0 text-[12px] text-neutral-500">Each item keeps its own price. Your savings show as one line at checkout.</p>
      </aside>
    </div>);
}

export function LookView({ tenantId, offer, byId, offers, onAdded }: { tenantId: string; offer: ShopOffer; byId: Map<string, P>; offers: Offer[]; onAdded: (n: number) => void }) {
  const [open, setOpen] = React.useState<string | null>(offer.hotspots[0]?.productId || null);
  const [sel, setSel] = React.useState<Record<string, Record<string, string>>>({});
  const [added, setAdded] = React.useState<Record<string, boolean>>({});
  const rows = offer.items.map((it) => byId.get(it.productId)).filter(Boolean);
  const choiceOf = (p: P) => sel[p.id] || firstChoices(p.optionGroups);
  const addOne = (p: P) => { if (added[p.id]) return; onAdded(addPicks(tenantId, [{ product: p, qty: 1, selections: choiceOf(p) }])); setAdded({ ...added, [p.id]: true }); };
  React.useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open]);
  const left = rows.filter((p: P) => !added[p.id] && p.inStock);
  const pvAll = preview(rows.filter((p: P) => p.inStock).map((p: P) => ({ product: p, qty: 1, selections: choiceOf(p) })), offers);
  const spot = offer.hotspots.find((h) => h.productId === open);
  const sp = spot ? byId.get(spot.productId) : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-start">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[1.5rem] bg-neutral-200">
        {offer.photoUrl ? <Image src={offer.photoUrl} alt={offer.name} fill sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" priority /> : null}
        {offer.hotspots.map((h, i) => { const p = byId.get(h.productId); if (!p) return null; const on = open === h.productId;
          return (
            <button key={h.productId} type="button" onClick={() => setOpen(on ? null : h.productId)} aria-label={`${on ? 'Hide' : 'Show'} ${p.name}`} aria-expanded={on}
              className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center" style={{ left: `${h.x}%`, top: `${h.y}%` }}>
              <span className="absolute h-[18px] w-[18px] animate-ping rounded-full bg-white/70 motion-reduce:animate-none" aria-hidden="true" />
              <span className="relative grid h-[26px] w-[26px] place-items-center rounded-full text-[12px] font-semibold shadow-md" style={on ? { background: '#16171a', color: '#fff' } : { background: '#fff', color: '#16171a' }}>{i + 1}</span>
            </button>); })}
        {spot && sp && (
          <div role="group" aria-label={sp.name} className="absolute rounded-2xl p-3 shadow-2xl" style={{ background: '#fff', width: 'min(15.5rem, calc(100% - 1rem))', left: `clamp(0.5rem, ${spot.x > 50 ? `calc(${spot.x}% - 16.5rem)` : `calc(${spot.x}% + 1.75rem)`}, calc(100% - min(15.5rem, calc(100% - 1rem)) - 0.5rem))`, top: `clamp(0.5rem, calc(${spot.y}% + 1.5rem), calc(100% - 9.5rem))` }}>
            <div className="flex items-center gap-3"><Photo src={sp.imageUrls?.[0]} alt="" className="h-14 w-14 shrink-0 rounded-xl" /><span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{sp.name}</span><span className="text-[13px] text-neutral-500">{money(shopLine(sp, choiceOf(sp)).unitCents)}</span></span></div>
            <button type="button" disabled={!sp.inStock || !!added[sp.id]} onClick={() => addOne(sp)} className="mt-2.5 h-11 w-full rounded-full bg-neutral-900 text-[14px] font-semibold text-white disabled:opacity-40">{!sp.inStock ? 'Sold out' : added[sp.id] ? 'In your bag' : needsChoice(sp) ? 'Add with these choices' : 'Add to bag'}</button>
          </div>)}
      </div>
      <div className="space-y-4">
        <ul className="divide-y rounded-[1.5rem] border-2 bg-white px-4" style={{ borderColor: '#ececee' }}>
          {rows.map((p: P, i: number) => (
            <li key={p.id} className="py-3">
              <button type="button" onClick={() => setOpen(p.id)} className="flex w-full items-center gap-3 text-left">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold">{i + 1}</span>
                <Photo src={p.imageUrls?.[0]} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{p.name}</span><span className="text-[13px] text-neutral-500">{p.inStock ? money(shopLine(p, choiceOf(p)).unitCents) : 'Sold out'}</span></span>
                <span className="text-[12px] text-neutral-500">{added[p.id] ? 'In bag' : ''}</span>
              </button>
              {needsChoice(p) && <span className="mt-2 block pl-10"><ChoicePicks compact product={p} value={choiceOf(p)} onChange={(v) => setSel({ ...sel, [p.id]: v })} /></span>}
            </li>))}
        </ul>
        {pvAll.save > 0 && <p className="m-0 text-[14px] font-semibold" style={{ color: SAVE }}>Buy the whole look and save {money(pvAll.save)}.</p>}
        <button type="button" disabled={!left.length} onClick={() => { onAdded(addPicks(tenantId, left.map((p: P) => ({ product: p, qty: 1, selections: choiceOf(p) })))); setAdded({ ...added, ...Object.fromEntries(left.map((p: P) => [p.id, true])) }); }}
          className="h-12 w-full rounded-full bg-neutral-900 text-[15px] font-semibold text-white disabled:opacity-40">
          {left.length ? (left.length === rows.length ? `Add the whole look · ${money(pvAll.pay)}` : `Add the rest (${left.length})`) : 'The whole look is in your bag'}
        </button>
      </div>
    </div>);
}
