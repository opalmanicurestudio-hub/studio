'use client';
// src/components/products/ProductsList.tsx — EVERY PRODUCT, WITH ITS STOCK AND ITS PLACE IN THE SHOP ON ONE ROW. What's on
// the shelf, what's held for paid orders, the price and the wholesale price (a variant's own, or its listing's), and
// whether it's in the shop, or what it needs before it can be. A table on a computer, a list on a phone. Filters are
// chips with their counts, so a filter says what you'd get before you tap it; a code typed or scanned into the search
// finds its product. Opening a row goes to the product's own page (stock, the shop, variants, codes and history).
import * as React from 'react';
import Link from 'next/link';
import { isStorefrontVisible } from '@/lib/retail-orders';
import { priceCentsOf, variantIdsOf } from '@/lib/variants';
import { codeForm, codesOf } from '@/lib/code-form';
import { collectImages } from '@/lib/product-public';
import { C, muted } from '@/components/orders/ui';

export type ProductSort = 'attention' | 'name' | 'least' | 'recent' | 'worth';
export type ProductFilter = 'all' | 'shop' | 'notshop' | 'low' | 'services' | 'equipment' | 'archived';

const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const free = (i: any) => Math.max(0, (Number(i.totalStock) || 0) - (Number(i.stockReserved) || 0));

/** Where a product stands in the shop, in a few words, with the color it's shown in. */
export function shopStatus(i: any, listings: Map<string, any>): { label: string; tone: 'ok' | 'warn' | 'off' } | null {
  if (i.type !== 'retail') return null;
  const listing = listings.get(String(i.id));
  if (listing) return isStorefrontVisible(listing) && listing.status !== 'archived' ? { label: `In the shop in ${listing.name || 'a listing'}`, tone: 'ok' } : { label: 'Its listing isn’t in the shop', tone: 'off' };
  if (!(priceCentsOf(i, listings) > 0)) return { label: 'Needs a price', tone: 'warn' };
  if (i.showOnline !== true) return { label: 'Not in the shop', tone: 'off' };
  if (!collectImages(i).length) return { label: 'Needs a photo', tone: 'warn' };
  return isStorefrontVisible(i) ? { label: 'In the shop', tone: 'ok' } : { label: 'Not in the shop', tone: 'off' };
}

const TONE: Record<'ok' | 'warn' | 'off', React.CSSProperties> = {
  ok: { background: C.okSoft, color: C.ok }, warn: { background: C.warnSoft, color: C.warn }, off: { background: C.soft, color: C.muted },
};

export function ProductsList({ inventory, listings, orderedIds, search, onSearch, filter, onFilter, selected, onSelect, onClearSelection, onScan, bulk, menuFor }: {
  inventory: any[]; listings: Map<string, any>;
  /** Products on a purchase order that's placed or on its way. */
  orderedIds?: Set<string>;
  search: string; onSearch: (v: string) => void;
  filter: ProductFilter; onFilter: (f: ProductFilter) => void;
  selected: Set<string>; onSelect: (id: string) => void; onClearSelection: () => void;
  onScan: () => void;
  bulk: { archive: () => void; unarchive: () => void; remove: () => void; labelsHref: string };
  /** The extra things a row can do (log a use, write off, edit), as the page offers them. */
  menuFor: (item: any) => { label: string; run: () => void; danger?: boolean }[];
}) {
  const [shown, setShown] = React.useState(60);
  // The row menu sits over the page (not inside the table, which would clip it), above its button when near the bottom.
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number; up: boolean } | null>(null);
  const [sort, setSort] = React.useState<ProductSort>('attention');
  const [picking, setPicking] = React.useState(false);
  const openMenu = (id: string, el: HTMLElement) => {
    if (menu?.id === id) { setMenu(null); return; }
    const r = el.getBoundingClientRect();
    setMenu({ id, x: Math.max(8, r.right - 220), y: r.bottom + 6 > window.innerHeight - 260 ? window.innerHeight - r.top + 6 : r.bottom + 6, up: r.bottom + 6 > window.innerHeight - 260 });
  };
  React.useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const gone = () => setMenu(null);
    window.addEventListener('keydown', close); window.addEventListener('scroll', gone, true); window.addEventListener('resize', gone);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('scroll', gone, true); window.removeEventListener('resize', gone); };
  }, [menu]);
  const byId = React.useMemo(() => new Map(inventory.map((i: any) => [String(i.id), i])), [inventory]);
  const live = React.useMemo(() => inventory.filter((i: any) => i.status !== 'archived'), [inventory]);
  const stockOf = (i: any) => { const vs = variantIdsOf(i); return vs.length ? vs.reduce((n, v) => n + Math.max(0, Number(byId.get(v)?.totalStock) || 0), 0) : Math.max(0, Number(i.totalStock) || 0); };
  const heldOf = (i: any) => { const vs = variantIdsOf(i); return vs.length ? vs.reduce((n, v) => n + Math.max(0, Number(byId.get(v)?.stockReserved) || 0), 0) : Math.max(0, Number(i.stockReserved) || 0); };
  const low = (i: any) => !['equipment', 'overhead'].includes(String(i.type)) && !variantIdsOf(i).length && free(i) <= (Number(i.lowStockThreshold) || 0) && (Number(i.lowStockThreshold) || 0) > 0;
  // Variants are shown inside their listing (one row each listing), never on their own row.
  const isVariantRow = (i: any) => listings.has(String(i.id));
  const tests: Record<ProductFilter, (i: any) => boolean> = {
    all: (i) => !['equipment', 'overhead'].includes(String(i.type)),
    shop: (i) => shopStatus(i, listings)?.tone === 'ok',
    notshop: (i) => i.type === 'retail' && shopStatus(i, listings)?.tone !== 'ok',
    low,
    services: (i) => i.type === 'professional',
    equipment: (i) => ['equipment', 'overhead'].includes(String(i.type)),
    archived: () => true,
  };
  // Archived shows every archived product, variants too, so one archived on its own can be found and brought back.
  const pool = (f: ProductFilter) => (f === 'archived' ? inventory.filter((i: any) => i.status === 'archived') : live).filter((i: any) => !isVariantRow(i) || f === 'low' || f === 'archived');
  const worthOf = (i: any) => { const vs = variantIdsOf(i); return vs.length ? vs.reduce((n, v) => { const x = byId.get(v); return n + Math.max(0, Number(x?.totalStock) || 0) * (Number(x?.costPerUnit) || 0); }, 0) : Math.max(0, Number(i.totalStock) || 0) * (Number(i.costPerUnit) || 0); };
  const changedAt = (i: any) => String(i.updatedAt?.toDate ? i.updatedAt.toDate().toISOString() : i.updatedAt || i.lastCountedAt || i.createdAt || '');
  const counts = Object.fromEntries((Object.keys(tests) as ProductFilter[]).map((f) => [f, pool(f).filter(tests[f]).length])) as Record<ProductFilter, number>;
  const almost = live.filter((i: any) => !isVariantRow(i) && i.type === 'retail' && i.showOnline === true && shopStatus(i, listings)?.tone === 'warn');

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase(); const asCode = codeForm(search);
    return pool(filter).filter(tests[filter]).filter((i: any) => !q
      || (!!asCode && codesOf({ ...i, type: 'retail' }).some((c: any) => c.code === asCode))
      || String(i.name || '').toLowerCase().includes(q) || String(i.sku || '').toLowerCase().includes(q) || String(i.id) === search.trim())
      .sort((a: any, b: any) => {
        const byName = String(a.name || '').localeCompare(String(b.name || ''));
        if (sort === 'name') return byName;
        if (sort === 'least') return stockOf(a) - stockOf(b) || byName;
        if (sort === 'recent') return changedAt(b).localeCompare(changedAt(a)) || byName;
        if (sort === 'worth') return worthOf(b) - worthOf(a) || byName;
        return (low(b) ? 1 : 0) - (low(a) ? 1 : 0) || byName;
      });
  }, [inventory, listings, filter, search, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips: { id: ProductFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'shop', label: 'In the shop' }, { id: 'notshop', label: 'Not in the shop' }, { id: 'low', label: 'Running low' },
    { id: 'services', label: 'Used in services' }, { id: 'equipment', label: 'Equipment and costs' }, { id: 'archived', label: 'Archived' },
  ];
  const chip = (on: boolean): React.CSSProperties => (on ? { background: C.ink, color: C.paper, borderColor: C.ink } : { background: C.paper, color: C.ink, borderColor: C.line });
  const sub = (i: any) => {
    const vs = variantIdsOf(i); const bits: string[] = [];
    if (vs.length) bits.push(`${vs.length} variant${vs.length === 1 ? '' : 's'}`);
    if (i.sku) bits.push(String(i.sku));
    if (i.type === 'professional') bits.push('used in services');
    if (i.type === 'equipment') bits.push('equipment');
    if (i.type === 'overhead') bits.push('running cost');
    if (orderedIds?.has(String(i.id))) bits.push('on order');
    return bits.join(' · ');
  };
  const stockCell = (i: any) => {
    if (['equipment', 'overhead'].includes(String(i.type))) return <span style={muted}>—</span>;
    const n = stockOf(i);
    if (low(i)) return <span><span className="font-semibold" style={{ color: C.warn }}>{n}</span> <span className="text-[13px]" style={{ color: C.warn }}>· reorder at {Number(i.lowStockThreshold) || 0}</span></span>;
    if (n === 0 && i.preorder === true) return <span><span className="font-semibold" style={{ color: C.warn }}>0</span> <span className="text-[13px]" style={{ color: C.warn }}>· pre-order open</span></span>;
    return <span className="tabular-nums">{n}</span>;
  };
  const price = (i: any, tier: 'retail' | 'wholesale') => { const c = priceCentsOf(i, listings, tier as any); return c > 0 ? money(c) : tier === 'retail' && i.type === 'retail' ? 'No price' : '—'; };
  const thumb = (i: any, size: number) => { const img = collectImages(i)[0];
    return img ? <img src={img} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size, background: C.soft }} /> : <span className="shrink-0 rounded-xl" style={{ width: size, height: size, background: C.soft }} aria-hidden="true" />; };

  const moreBtn = (i: any) => (
    <button type="button" aria-label={`More for ${i.name}`} aria-haspopup="menu" aria-expanded={menu?.id === i.id} onClick={(e) => openMenu(String(i.id), e.currentTarget)} className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ color: C.ink }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
    </button>
  );
  const menuItem = menu ? byId.get(menu.id) : null;
  return (
    <div className="flex flex-col gap-4">
      {menu && menuItem && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenu(null)} />
          <div role="menu" aria-label={`More for ${menuItem.name}`} className="fixed z-50 w-[220px] overflow-hidden rounded-2xl text-left shadow-lg" style={{ left: menu.x, ...(menu.up ? { bottom: menu.y } : { top: menu.y }), background: C.paper, border: `1px solid ${C.line}` }}>
            {menuFor(menuItem).map((m) => <button key={m.label} type="button" role="menuitem" onClick={() => { setMenu(null); m.run(); }} className="block h-11 w-full px-4 text-left text-[15px]" style={{ color: m.danger ? C.bad : C.ink }}>{m.label}</button>)}
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor="products-find" className="sr-only">Find a product</label>
        <input id="products-find" value={search} onChange={(e) => { onSearch(e.target.value); setShown(60); if (selected.size) onClearSelection(); }} placeholder="Find by name, SKU or barcode" data-scan-field
          className="h-11 min-w-0 flex-1 rounded-xl px-4 text-[15px] outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }} />
        <button type="button" onClick={onScan} aria-label="Scan a code" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ border: `1px solid ${C.line}`, background: C.paper }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" /></svg>
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[14px]" style={muted}>Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as ProductSort)} className="h-11 rounded-xl px-3 text-[15px] outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }}>
            <option value="attention">Running low first</option><option value="name">Name</option><option value="least">Least on the shelf</option><option value="recent">Recently changed</option><option value="worth">Most worth on the shelf</option>
          </select>
        </label>
        <button type="button" aria-pressed={picking} onClick={() => { if (picking) onClearSelection(); setPicking(!picking); }} className="h-11 rounded-full border px-4 text-[15px] font-medium md:hidden" style={chip(picking)}>{picking ? 'Done' : 'Select'}</button>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Show">
        {chips.filter((c) => c.id === 'all' || c.id === filter || counts[c.id] > 0).map((c) => (
          <button key={c.id} type="button" aria-pressed={filter === c.id} onClick={() => { onFilter(c.id); setShown(60); onClearSelection(); }}
            className="h-11 shrink-0 rounded-full border px-4 text-[14px] font-medium" style={chip(filter === c.id)}>{c.label} <span className="tabular-nums" style={{ opacity: 0.7 }}>{counts[c.id]}</span></button>
        ))}
      </div>

      {filter === 'all' && almost.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: C.warnSoft }}>
          <p className="m-0 text-[15px]" style={{ color: C.warn }}><span className="font-semibold">{almost.length === 1 ? '1 product is' : `${almost.length} products are`} almost ready for the shop.</span> {almost.slice(0, 3).map((i: any) => `${i.name}: ${shopStatus(i, listings)?.label.toLowerCase()}`).join('; ')}.</p>
          <button type="button" onClick={() => onFilter('notshop')} className="h-11 rounded-full border px-4 text-[14px] font-medium" style={{ borderColor: C.line, background: C.paper }}>Show them</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: C.soft }}>
          <p className="m-0 text-[15px] font-semibold">{selected.size} selected</p>
          <div className="flex flex-wrap gap-2">
            {filter === 'archived'
              ? <button type="button" onClick={bulk.unarchive} className="h-11 rounded-full border px-4 text-[14px]" style={{ borderColor: C.line, background: C.paper }}>Bring back</button>
              : <><Link href={bulk.labelsHref} className="inline-flex h-11 items-center rounded-full border px-4 text-[14px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }}>Print labels</Link>
                <button type="button" onClick={bulk.archive} className="h-11 rounded-full border px-4 text-[14px]" style={{ borderColor: C.line, background: C.paper }}>Archive</button></>}
            <button type="button" onClick={bulk.remove} className="h-11 rounded-full px-4 text-[14px] font-medium" style={{ background: C.badSoft, color: C.bad }}>Delete</button>
            <button type="button" onClick={onClearSelection} className="h-11 rounded-full px-3 text-[14px]" style={muted}>Clear</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="m-0 rounded-2xl px-4 py-10 text-center text-[15px]" style={{ background: C.soft, color: C.muted }}>{search ? 'Nothing matches that. Try the name, the SKU, or scan its code.' : 'Nothing here yet.'}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl md:block" style={{ border: `1px solid ${C.line}` }}>
            <table className="w-full border-collapse" style={{ minWidth: 880 }}>
              <thead><tr>
                <th className="w-10 py-2.5 pl-4" style={{ borderBottom: `1px solid ${C.line}` }}><span className="sr-only">Select</span></th>
                {['Product', 'On the shelf', 'Held for orders', 'Price', 'Wholesale', 'Shop'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-[13px] font-semibold" style={{ ...muted, borderBottom: `1px solid ${C.line}` }}>{h}</th>)}
                <th style={{ borderBottom: `1px solid ${C.line}` }}><span className="sr-only">More</span></th>
              </tr></thead>
              <tbody>
                {rows.slice(0, shown).map((i: any) => { const st = shopStatus(i, listings); const items = menuFor(i); return (
                  <tr key={i.id} className="align-middle" style={{ borderBottom: `1px solid ${C.line}` }}>
                    <td className="py-1 pl-2"><label className="grid h-11 w-11 cursor-pointer place-items-center"><input type="checkbox" aria-label={`Select ${i.name}`} checked={selected.has(i.id)} onChange={() => onSelect(i.id)} className="h-5 w-5" /></label></td>
                    <td className="px-3 py-3"><Link href={`/inventory/product/${i.id}`} className="flex items-center gap-3" style={{ color: C.ink }}>{thumb(i, 44)}<span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{i.name || 'Untitled'}</span><span className="block truncate text-[13px]" style={muted}>{sub(i)}</span></span></Link></td>
                    <td className="px-3 py-3 text-[15px]">{stockCell(i)}</td>
                    <td className="px-3 py-3 text-[15px] tabular-nums" style={muted}>{['equipment', 'overhead'].includes(String(i.type)) ? '—' : heldOf(i)}</td>
                    <td className="px-3 py-3 text-[15px] tabular-nums" style={priceCentsOf(i, listings) > 0 ? undefined : muted}>{price(i, 'retail')}</td>
                    <td className="px-3 py-3 text-[15px] tabular-nums" style={muted}>{i.type === 'retail' && priceCentsOf(i, listings, 'wholesale' as any) !== priceCentsOf(i, listings) ? price(i, 'wholesale') : '—'}</td>
                    <td className="px-3 py-3">{st ? <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold" style={TONE[st.tone]}>{st.label}</span> : <span className="text-[13px]" style={muted}>{i.type === 'professional' ? 'For services' : ''}</span>}</td>
                    <td className="px-3 py-3 text-right">{items.length > 0 && moreBtn(i)}</td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
          <ul className="m-0 list-none p-0 md:hidden">
            {rows.slice(0, shown).map((i: any) => { const st = shopStatus(i, listings); return (
              <li key={i.id} className="flex items-center gap-1" style={{ borderBottom: `1px solid ${C.line}` }}>
                {picking && <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center"><input type="checkbox" aria-label={`Select ${i.name}`} checked={selected.has(i.id)} onChange={() => onSelect(i.id)} className="h-5 w-5" /></label>}
                <Link href={`/inventory/product/${i.id}`} onClick={(e) => { if (picking) { e.preventDefault(); onSelect(i.id); } }} className="flex min-w-0 flex-1 items-center gap-3 py-3" style={{ color: C.ink }}>
                  {thumb(i, 48)}
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{i.name || 'Untitled'}</span>
                    <span className="block truncate text-[13px]" style={low(i) ? { color: C.warn } : muted}>{['equipment', 'overhead'].includes(String(i.type)) ? sub(i) : `${stockOf(i)} on the shelf${low(i) ? ` · reorder at ${Number(i.lowStockThreshold) || 0}` : ''}${priceCentsOf(i, listings) > 0 ? ` · ${price(i, 'retail')}` : ''}`}</span></span>
                  {st && <span className="shrink-0 text-[13px] font-semibold" style={{ color: TONE[st.tone].color as string }}>{st.tone === 'ok' ? 'In shop' : st.label}</span>}
                </Link>
                {!picking && menuFor(i).length > 0 && moreBtn(i)}
              </li>); })}
          </ul>
          {rows.length > shown && <button type="button" onClick={() => setShown(shown + 60)} className="h-11 self-center rounded-full border px-5 text-[15px] font-medium" style={{ borderColor: C.line, background: C.paper, color: C.ink }}>Show {Math.min(60, rows.length - shown)} more</button>}
        </>
      )}
      <p className="m-0 hidden text-[13px] md:block" style={muted}>A dash under Wholesale means wholesale buyers pay the shop price.</p>
    </div>
  );
}
