'use client';
// src/components/pos/PosCatalog.tsx — WHAT YOU CAN SELL AT THE DESK, at a glance (Counter, and "Add to this sale" in checkout).
// Photo tiles with price and on-shelf stock, sizes / shades shown inline, members-only and "already in this sale" badges,
// search that also takes a scanned code (Enter adds it), departments for the tools you use, and category chips.
import * as React from 'react';
import { hasStockVariants } from '@/lib/retail-orders';
import { isSellable, onHand, variantsOf } from '@/lib/pos-scan';

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
type Dept = 'products' | 'services' | 'memberships' | 'packages';

export function PosCatalog({ inventory, services, memberships, packages, cart, onAdd, onScan, compact }: {
  inventory: any[]; services?: any[]; memberships?: any[]; packages?: any[]; cart?: any[];
  onAdd: (item: any) => void; onScan?: (code: string) => void; compact?: boolean;
}) {
  const products = React.useMemo(() => (inventory || []).filter(isSellable).filter((i) => !(inventory || []).some((p: any) => (p.optionGroups || []).some((g: any) => (g.choices || []).some((c: any) => c.variantProductId === i.id)))), [inventory]);   // variants appear under their parent
  const depts = ([['products', 'Products', products.length], ['services', 'Services', (services || []).length], ['memberships', 'Memberships', (memberships || []).filter((m: any) => !m.isPrivate).length], ['packages', 'Packages', (packages || []).filter((p: any) => !p.isPrivate).length]] as [Dept, string, number][]).filter(([, , n]) => n > 0);
  const [dept, setDept] = React.useState<Dept>('products'); const [cat, setCat] = React.useState('All'); const [q, setQ] = React.useState(''); const [openParent, setOpenParent] = React.useState<string | null>(null);
  const [limit, setLimit] = React.useState(compact ? 24 : 60);
  React.useEffect(() => { if (depts.length && !depts.some(([d]) => d === dept)) setDept(depts[0][0]); }, [depts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setCat('All'); setLimit(compact ? 24 : 60); }, [dept, compact]);
  const base: any[] = dept === 'products' ? products : dept === 'services' ? (services || []) : dept === 'memberships' ? (memberships || []).filter((m: any) => !m.isPrivate) : (packages || []).filter((p: any) => !p.isPrivate);
  const cats = React.useMemo(() => ['All', ...Array.from(new Set(base.map((i: any) => String(i.category || '').trim()).filter(Boolean))).sort()], [base]);
  const t = q.trim().toLowerCase();
  const shown = base.filter((i: any) => (cat === 'All' || String(i.category || '') === cat) && (!t || String(i.name || '').toLowerCase().includes(t) || String(i.sku || '').toLowerCase().includes(t) || String(i.barcode || '').toLowerCase().includes(t)))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const inCart = (id: string) => (cart || []).find((c: any) => c.id === id)?.quantity || 0;
  const priceOf = (i: any) => (dept === 'products' ? Number(i.msrp || i.costPerUnit || 0) : Number(i.price || 0));
  const stockPill = (i: any) => { const n = onHand(i); const low = Number(i.reorderPoint) > 0 ? n <= Number(i.reorderPoint) : n <= 2;
    return n <= 0 ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>Out of stock</span>
      : low ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', color: 'var(--warn)' }}>Only {n} left</span>
      : <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{n} in stock</span>; };
  const submit = () => { const v = q.trim(); if (!v) return;
    const exact = base.filter((i: any) => [i.sku, i.barcode].some((c) => c && String(c).toLowerCase() === v.toLowerCase()));
    if (onScan && (exact.length || /^[A-Za-z0-9:/._-]{6,}$/.test(v) && !shown.length)) { onScan(v); setQ(''); return; }
    if (shown.length === 1) { const only = shown[0]; if (dept === 'products' && hasStockVariants(only.optionGroups)) setOpenParent(only.id); else { onAdd(only); setQ(''); } } };
  const tile = 'relative flex flex-col overflow-hidden rounded-2xl text-left transition active:scale-[.98]';
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} data-scan-field
          placeholder={dept === 'products' ? 'Search, or scan a barcode' : 'Search'} aria-label="Search, or scan a barcode" inputMode="search" enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-xl px-3.5 text-[16px] outline-none" style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
      </div>
      {depts.length > 1 && <div role="tablist" aria-label="What to sell" className="flex gap-1 overflow-x-auto rounded-full p-1" style={{ background: 'var(--soft)' }}>
        {depts.map(([d, l, n]) => <button key={d} type="button" role="tab" aria-selected={dept === d} onClick={() => setDept(d)} className="h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold" style={dept === d ? { background: 'var(--card)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--muted)' }}>{l} <span className="font-normal" style={{ color: 'var(--muted)' }}>{n}</span></button>)}
      </div>}
      {cats.length > 2 && <div className="flex gap-1.5 overflow-x-auto pb-1">{cats.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className="h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium" style={cat === c ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}>{c}</button>)}</div>}
      {!shown.length ? <p className="py-6 text-center text-[14px]" style={{ color: 'var(--muted)' }}>{t ? `Nothing matches “${q}”.` : 'Nothing here yet.'}</p>
        : <div className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
          {shown.slice(0, limit).map((i: any) => {
            const parent = dept === 'products' && hasStockVariants(i.optionGroups); const vs = parent ? variantsOf(i, inventory) : [];
            const img = i.imageUrl || (Array.isArray(i.imageUrls) ? i.imageUrls[0] : null); const n = inCart(i.id) + vs.reduce((s: number, v: any) => s + inCart(v.id), 0);
            const opened = openParent === i.id;
            return <div key={i.id} className={opened ? 'col-span-full' : ''}>
              <button type="button" onClick={() => (parent ? setOpenParent(opened ? null : i.id) : onAdd(i))} className={`${tile} w-full`} style={{ background: 'var(--card)', border: `1px solid ${n ? 'var(--accent)' : 'var(--line)'}` }} aria-label={`${parent ? 'Choose a size of' : 'Add'} ${i.name}`}>
                {!compact && <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden" style={{ background: 'var(--soft)' }}>
                  {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="text-[28px] font-semibold" style={{ color: 'var(--muted)' }}>{String(i.name || '?').slice(0, 1).toUpperCase()}</span>}</div>}
                <div className="space-y-0.5 p-2.5">
                  <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{i.name}</p>
                  <p className="text-[14px] tabular-nums">{parent && vs.length ? `from ${money(Math.min(...vs.map((v: any) => Number(v.msrp || v.costPerUnit || 0))))}` : money(priceOf(i))}{dept === 'memberships' && i.interval ? <span style={{ color: 'var(--muted)' }}> / {i.interval === 'monthly' ? 'month' : 'year'}</span> : null}{dept === 'packages' && i.sessions ? <span style={{ color: 'var(--muted)' }}> · {i.sessions} visits</span> : null}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    {dept === 'products' && (parent ? <span className="text-[11px] font-semibold">{vs.length} {vs.length === 1 ? 'option' : 'options'}</span> : stockPill(i))}
                    {i.isMembersOnly && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'var(--soft)' }}>Members</span>}
                  </div>
                </div>
                {n > 0 && <span className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{n} in this sale</span>}
              </button>
              {opened && <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {vs.map((v: any) => <button key={v.id} type="button" onClick={() => onAdd(v)} className="rounded-2xl p-3 text-left" style={{ background: 'var(--soft)', border: inCart(v.id) ? '1px solid var(--accent)' : '1px solid transparent' }}>
                  <span className="block text-[14px] font-semibold">{String(v.name || '').replace(String(i.name || ''), '').replace(/^[\s—–-]+/, '') || v.name}</span>
                  <span className="block text-[13px] tabular-nums">{money(v.msrp || v.costPerUnit)}</span>{stockPill(v)}{inCart(v.id) ? <span className="block text-[12px] font-semibold">{inCart(v.id)} in this sale</span> : null}
                </button>)}
              </div>}
            </div>;
          })}
        </div>}
      {shown.length > limit && <button type="button" onClick={() => setLimit((n) => n + 60)} className="h-11 w-full rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Show more ({shown.length - limit})</button>}
    </div>
  );
}
