'use client';
// src/app/(app)/window/page.tsx — THE PICKUP WINDOW: the shop's everyday products picked to show at the window and on
// its board (drive-thru/[tenantId]/menu), each with the number customers order by (lib/pickup-window). Managers add,
// take off and order them (the numbers follow the order, category by category), show one big on the board, and tag
// New or Limited time; the best sellers of the last 30 days are offered first. Reads and saves through
// api/retail/window. Products themselves (stock, price, colors) are made in Inventory.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { ArrowDown, ArrowUp, X } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', GREEN = '#1f7a4d';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const field = 'w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

type Swatch = { label: string; color: string | null; soldOut: boolean };
type OnWindow = { id: string; name: string; section: string; price: number; from: boolean; imageUrl: string | null; onHand: number; soldOut: boolean;
  featured: boolean; badge: 'new' | 'limited' | null; prosOnly: boolean; size: string | null; swatches: Swatch[]; number: number | null };
type Pick = { id: string; name: string; category: string; price: number; from: boolean; imageUrl: string | null; onHand: number; prosOnly: boolean; onWindow: boolean; soldLast30: number };

function Thumb({ src, name }: { src: string | null; name: string }) {
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: SOFT }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span aria-hidden className="text-[18px] font-bold" style={{ color: '#c4c6ca' }}>{name.trim().charAt(0).toUpperCase()}</span>}
    </span>
  );
}

function Switch({ on, label, onClick, busy }: { on: boolean; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={busy}
      className={`flex h-11 w-16 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${RING}`}>
      <span aria-hidden className="relative h-8 w-14 rounded-full transition-colors" style={{ background: on ? INK : '#d4d6da' }}>
        <span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] shadow transition-all" style={{ left: on ? 28 : 4 }} />
      </span>
    </button>
  );
}

export default function PickupWindowPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [items, setItems] = useState<OnWindow[] | null>(null);
  const [catalog, setCatalog] = useState<Pick[]>([]);
  const [max, setMax] = useState(60);
  const [menuCount, setMenuCount] = useState(0);
  const [board, setBoard] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [capped, setCapped] = useState(false);
  const [stored, setStored] = useState<string[]>([]);

  const call = useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/retail/window', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const load = useCallback(async () => {
    const d = await call({ action: 'list' });
    if (d.ok) { setItems(d.items); setCatalog(d.catalog || []); setMax(d.max || 60); setMenuCount(d.menuCount || 0); setBoard(d.board || ''); setCanEdit(!!d.canEdit); setCapped(!!d.capped); setStored(Array.isArray(d.stored) ? d.stored : []); }
    else setErr(d.error || 'The window couldn’t be read. Try again.');
  }, [call]);
  useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);

  // Saving the list in its new order (the numbers follow it), then reading it back for the new numbers.
  // (With the list it started from, so a change someone else made meanwhile is never undone: then it reloads.)
  const save = async (ids: string[], key: string) => {
    setBusy(key); setErr('');
    const d = await call({ action: 'save', items: ids, was: stored });
    if (!d.ok) { if (d.error && /changed since/.test(d.error)) await load(); setBusy(null); setErr(d.error || 'That didn’t save.'); return; }
    await load(); setBusy(null);
  };
  const ids = (items || []).map((x) => x.id);
  const add = (id: string) => save([...ids, id], `add-${id}`);
  const remove = (id: string) => save(ids.filter((x) => x !== id), `rm-${id}`);
  const move = (id: string, by: -1 | 1) => {
    const k = ids.indexOf(id); const j = k + by; if (k < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids]; [next[k], next[j]] = [next[j], next[k]]; void save(next, `mv-${id}`);
  };
  // (A failed change puts back that product's own settings only.)
  const tag = async (it: OnWindow, patch: { featured?: boolean; badge?: 'new' | 'limited' | null }) => {
    const back = { featured: it.featured, badge: it.badge };
    setItems((l) => (l ? l.map((x) => (x.id === it.id ? { ...x, ...patch } : x)) : l)); setBusy(`tag-${it.id}`); setErr('');
    const d = await call({ action: 'tag', itemId: it.id, ...patch });
    setBusy(null); if (!d.ok) { setItems((l) => (l ? l.map((x) => (x.id === it.id ? { ...x, ...back } : x)) : l)); setErr(d.error || 'That didn’t save.'); }
  };

  const offer = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter((c) => !ids.includes(c.id) && (!s || `${c.name} ${c.category}`.toLowerCase().includes(s))).slice(0, 40);
  }, [catalog, ids.join(','), q]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = ids.length >= max;

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Pickup window</h1>
            <p className="mt-1 max-w-2xl text-[15px]" style={{ color: MUTED }}>The products people buy most at your window or register. They show on the window board with a number each, so customers can order by number or by name. Products, prices and colors are set in <Link href="/inventory" className="underline">Inventory</Link>.</p>
          </div>
          {board && <a href={board} target="_blank" rel="noopener" className={`${BTN} inline-flex items-center border bg-[#fff]`} style={{ borderColor: LINE }}>Open the window board</a>}
        </header>

        {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14.5px] font-medium" style={{ background: '#fff7ed', color: AMBER }}>{err}</p>}

        <section aria-labelledby="on-window" className="rounded-[24px] border bg-[#fff] p-4 sm:p-5" style={{ borderColor: LINE }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="on-window" className="text-[18px] font-semibold">On the window</h2>
            <p className="text-[13.5px]" style={{ color: MUTED }}>{ids.length} of {max}{menuCount ? `. Numbers start after your ${menuCount} menu items; window products are rung up at the register.` : ''}</p>
          </div>
          {!items ? <p className="mt-3 text-[14.5px]" style={{ color: MUTED }}>Loading…</p>
            : !items.length ? <p className="mt-3 text-[14.5px]" style={{ color: MUTED }}>Nothing on the window yet. Add your everyday products below; your best sellers are listed first.</p>
            : (
              <ul className="mt-3 divide-y" style={{ borderColor: LINE }}>
                {items.map((it, k) => (
                  <li key={it.id} className="flex flex-wrap items-center gap-3 py-3" style={{ borderColor: LINE }}>
                    <span className="flex h-8 min-w-[32px] items-center justify-center rounded-full px-2 text-[14px] font-bold tabular-nums" style={{ background: INK, color: '#fff' }} role="img" aria-label={`Number ${it.number ?? ''}`}>{it.number ?? ''}</span>
                    <Thumb src={it.imageUrl} name={it.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15.5px] font-semibold">{it.name}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[13.5px]" style={{ color: MUTED }}>
                        <span>{it.section}</span>
                        <span className="tabular-nums" style={{ color: INK }}>{it.from ? 'from ' : ''}{money(it.price)}</span>
                        {it.size && <span>{it.size}</span>}
                        <span style={{ color: it.soldOut ? AMBER : MUTED }}>{it.soldOut ? 'Sold out' : `${it.onHand} on the shelf`}</span>
                        {it.prosOnly && <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: INK, color: '#fff' }}>Pros only</span>}
                      </p>
                      {it.swatches.some((s) => s.color) && (
                        <span className="mt-1 flex flex-wrap gap-1" role="img" aria-label={`Colors: ${it.swatches.map((s) => s.label).join(', ')}`}>
                          {it.swatches.slice(0, 14).map((s, i) => <span key={i} title={s.label} className="h-3.5 w-3.5 rounded-full" style={{ background: s.color || '#d4d6da', opacity: s.soldOut ? 0.35 : 1, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />)}
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto">
                        <div className="flex min-w-[220px] flex-1 items-center gap-1.5 sm:flex-none">
                        <label className="flex items-center gap-1 text-[13px] font-medium" style={{ color: MUTED }}>Big<Switch on={it.featured} label={`Show ${it.name} big on the board`} busy={!!busy} onClick={() => void tag(it, { featured: !it.featured })} /></label>
                        <select aria-label={`Tag for ${it.name}`} value={it.badge || ''} disabled={!!busy} onChange={(e) => void tag(it, { badge: (e.target.value || null) as any })}
                          className={`min-h-[44px] min-w-0 flex-1 rounded-xl border bg-[#fff] px-2 text-[14px] sm:flex-none ${RING}`} style={{ borderColor: LINE }}>
                          <option value="">No tag</option><option value="new">New</option><option value="limited">Limited time</option>
                        </select>
                        </div>
                        <div className="flex gap-1.5">
                        <button type="button" aria-label={`Move ${it.name} up`} disabled={k === 0 || !!busy} onClick={() => move(it.id, -1)} className={`flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-40 ${RING}`} style={{ borderColor: LINE }}><ArrowUp className="h-4 w-4" aria-hidden /></button>
                        <button type="button" aria-label={`Move ${it.name} down`} disabled={k === items.length - 1 || !!busy} onClick={() => move(it.id, 1)} className={`flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-40 ${RING}`} style={{ borderColor: LINE }}><ArrowDown className="h-4 w-4" aria-hidden /></button>
                        <button type="button" aria-label={`Take ${it.name} off the window`} disabled={!!busy} onClick={() => void remove(it.id)} className={`flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-40 ${RING}`} style={{ borderColor: LINE }}><X className="h-4 w-4" aria-hidden /></button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          {items && items.length > 0 && <p className="mt-3 text-[13px]" style={{ color: MUTED }}>The numbers follow this order, kept together by category. Move a product to change its number.</p>}
        </section>

        {canEdit && (
          <section aria-labelledby="add-products" className="rounded-[24px] border bg-[#fff] p-4 sm:p-5" style={{ borderColor: LINE }}>
            <h2 id="add-products" className="text-[18px] font-semibold">Add products</h2>
            <p className="mt-0.5 text-[13.5px]" style={{ color: MUTED }}>Best sellers of the last 30 days first.</p>
            <label className="mt-3 block"><span className="sr-only">Find a product</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product" className={field} style={{ borderColor: LINE }} />
            </label>
            {capped && <p className="mt-3 text-[13.5px]" style={{ color: MUTED }}>Only your first 600 products are listed here.</p>}
            {full && <p className="mt-3 text-[14px]" style={{ color: AMBER }}>The window holds {max} products. Take one off to add another.</p>}
            {!catalog.length ? <p className="mt-3 text-[14.5px]" style={{ color: MUTED }}>No shop products yet. Add them in <Link href="/inventory" className="underline">Inventory</Link> as retail products with a price.</p>
              : !offer.length ? <p className="mt-3 text-[14.5px]" style={{ color: MUTED }}>{q ? 'Nothing matches that.' : 'Every product is on the window.'}</p>
              : (
                <ul className="mt-2 divide-y" style={{ borderColor: LINE }}>
                  {offer.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2.5" style={{ borderColor: LINE }}>
                      <Thumb src={c.imageUrl} name={c.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{c.name}</p>
                        <p className="flex flex-wrap gap-x-2 text-[13.5px]" style={{ color: MUTED }}>
                          <span>{c.category}</span><span className="tabular-nums" style={{ color: INK }}>{c.from ? 'from ' : ''}{money(c.price)}</span>
                          {c.soldLast30 > 0 && <span style={{ color: GREEN }}>{c.soldLast30} sold in 30 days</span>}
                          {c.onHand <= 0 && <span style={{ color: AMBER }}>None on the shelf</span>}
                        </p>
                      </div>
                      <button type="button" disabled={full || !!busy} onClick={() => void add(c.id)} className={`${BTN} border bg-[#fff]`} style={{ borderColor: LINE }} aria-label={`Add ${c.name} to the window`}>{busy === `add-${c.id}` ? 'Adding…' : 'Add'}</button>
                    </li>
                  ))}
                </ul>
              )}
          </section>
        )}
      </div>
    </div>
  );
}
