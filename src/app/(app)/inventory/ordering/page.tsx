'use client';
// src/app/(app)/inventory/ordering/page.tsx — ORDERING (design canvas "Ordering"; lib/ordering, api/ordering). For
// managers: what to order from each supplier so the shelf lasts until the next order (from the last two weeks of the
// stock history, what's on the shelf and what's on its way), a set amount kept of anything the business says, and who
// it buys each thing from, put in right here. An order is copied into a text or an email the way the business already
// orders; when it comes in, one tap puts it all on the shelf at its costs, or "Edit first" for what came in different.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { moduleEnabled } from '@/lib/modules';
import { lineWords, orderText, orderTotal, remainingOf, type SupplyOrder, type Suggestion, type SupplierPlan } from '@/lib/ordering';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const FIELD = 'min-h-[44px] w-full rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
type Plan = { coverDays: number; lookback: number; plan: SupplierPlan[]; uncounted: { id: string; name: string }[]; orders: SupplyOrder[]; suppliers: string[]; business: string };

/** What's still to come of an order, one row per product (the same product on two lines is one row). */
const stillToCome = (o: SupplyOrder) => {
  const by = new Map<string, SupplyOrder['items'][number] & { remaining: number }>();
  for (const l of o.items || []) { const r = remainingOf(l); if (!(r > 0)) continue; const cur = by.get(l.productId); if (cur) cur.remaining += r; else by.set(l.productId, { ...l, remaining: r }); }
  return Array.from(by.values());
};
const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayWords = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/ordering', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-xl border bg-[#fff]" style={{ borderColor: LINE }}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label={`One less ${label}`} className={`flex h-11 w-11 items-center justify-center rounded-xl text-[18px] disabled:opacity-40 ${RING}`} style={{ color: MUTED }}>−</button>
      <span className="min-w-[28px] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(10000, value + 1))} aria-label={`One more ${label}`} className={`flex h-11 w-11 items-center justify-center rounded-xl text-[18px] ${RING}`} style={{ color: MUTED }}>+</button>
    </span>
  );
}

export default function OrderingPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [p, setP] = useState<Plan | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Record<string, SupplyOrder>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [got, setGot] = useState<Record<string, { qty: number; cost: string }>>({});
  const [who, setWho] = useState<Record<string, string>>({});
  const [parOpen, setParOpen] = useState<string | null>(null); const [parTyped, setParTyped] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    const d = await post({ tenantId, action: 'plan' });
    if (d.ok) { setP(d); setErr(''); setQty({}); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  const q = (s: Suggestion) => (qty[s.id] ?? s.suggest);
  const run = async (key: string, body: any, after?: (d: any) => void) => {
    if (!tenantId) return null; setBusy(key); setErr(''); setNote('');
    const d = await post({ tenantId, ...body }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t go through. Try again.'); return null; }
    after?.(d); return d;
  };
  const order = async (sp: SupplierPlan) => {
    const lines = sp.lines.map((s) => ({ itemId: s.id, qty: q(s) })).filter((l) => l.qty > 0);
    await run(`order-${sp.key}`, { action: 'order', supplier: sp.name, lines }, (d) => { setSent((m) => ({ ...m, [sp.key]: d.order })); void load(); });
  };
  const receive = async (o: SupplyOrder, edited: boolean) => {
    const lines = edited ? stillToCome(o).map((l) => { const g = got[l.productId]; return { itemId: l.productId, qty: g ? g.qty : l.remaining, ...(g && g.cost.trim() !== '' ? { cost: Number(g.cost.replace(/[$,\s]/g, '')) } : {}) }; }) : undefined;
    // What this screen showed as still to come, so an order put away meanwhile from another screen isn't put away twice.
    const expect: Record<string, number> = {}; for (const l of o.items) expect[l.productId] = (expect[l.productId] || 0) + remainingOf(l);
    await run(`recv-${o.id}`, { action: 'receive', orderId: o.id, expect, ...(lines ? { lines } : {}) }, async (d) => {
      setEditing(null); setGot({});
      setNote(d.already ? `Order #${o.number} was already put away.` : `${d.status === 'Partially Received' ? `What came of order #${o.number} is on the shelf. The rest is still to come.` : `Order #${o.number} from ${o.supplier} is on the shelf.`}${d.missing?.length ? ` ${d.missing.join(', ')} ${d.missing.length === 1 ? 'isn’t' : 'aren’t'} in Inventory any more, so ${d.missing.length === 1 ? 'it wasn’t' : 'they weren’t'} put away.` : ''}`);
      // A delivery can let a shop order that was waiting for it go out (lib/retail-fulfill), as a quick receive does.
      if (!d.already && moduleEnabled(selectedTenant, 'retail')) {
        try { const { releaseCoverableBackorders } = await import('@/lib/fulfil-client'); await releaseCoverableBackorders(null, tenantId!, (d.received || []).map((x: any) => ({ productId: x.itemId, qty: x.qty })), { id: 'ordering', name: 'Ordering' } as any); } catch { /* the order's own Release still covers it */ }
      }
      void load();
    });
  };
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 2500); } catch { setErr('Couldn’t copy. Select the order and copy it yourself.'); }
  };

  const named = useMemo(() => (p?.plan || []).filter((x) => x.key !== ''), [p]);
  const none = useMemo(() => (p?.plan || []).find((x) => x.key === '') || null, [p]);
  const today = dayWords(new Date().toISOString());

  const row = (s: Suggestion, sp: SupplierPlan) => (
    <li key={s.id} className="border-t py-2" style={{ borderColor: LINE }}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { setParOpen(parOpen === s.id ? null : s.id); setParTyped(s.par ? String(s.par) : ''); }} aria-expanded={parOpen === s.id} className={`min-h-[44px] min-w-0 flex-1 rounded-lg text-left ${RING}`}>
          <span className="block text-[14.5px]">{s.name}</span>
          <span className="block text-[13px]" style={{ color: MUTED }}>{s.why}{s.typical ? ' At a typical price.' : ''}{s.container ? <span className="sm:hidden"> Each: {s.container}.</span> : null}</span>
        </button>
        {sp.key !== '' && <>
          <Stepper value={q(s)} onChange={(n) => setQty((m) => ({ ...m, [s.id]: n }))} label={s.name} />
          <span className="hidden w-20 shrink-0 text-[12.5px] sm:block" style={{ color: MUTED }}>{s.container || 'units'}</span>
        </>}
      </div>
      {parOpen === s.id && (
        <div className="mt-2 rounded-2xl p-3" style={{ background: SOFT }}>
          <label htmlFor={`par-${s.id}`} className="block text-[13.5px] font-medium">Keep a set number on hand{s.container ? ` (${s.container})` : ''}</label>
          <span className="block text-[12.5px]" style={{ color: MUTED }}>It’s ordered back up to that, instead of from what’s used.</span>
          <span className="mt-2 flex gap-2">
            <input id={`par-${s.id}`} inputMode="decimal" value={parTyped} onChange={(e) => setParTyped(e.target.value)} placeholder="2" className={FIELD} style={{ borderColor: LINE }} />
            <button type="button" disabled={busy === `par-${s.id}` || !parTyped.trim()} onClick={() => void run(`par-${s.id}`, { action: 'par', itemId: s.id, par: Number(parTyped) }, () => { setParOpen(null); void load(); })} className={BTN} style={{ background: INK, color: '#fff' }}>Save</button>
          </span>
          {s.par !== null && <button type="button" onClick={() => void run(`par-${s.id}`, { action: 'par', itemId: s.id, par: null }, () => { setParOpen(null); void load(); })} className={`mt-1 min-h-[44px] text-[13.5px] font-semibold underline underline-offset-4 ${RING}`}>Go by what’s used instead</button>}
        </div>
      )}
    </li>
  );

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Ordering</h1>
            <p className="text-[15px]" style={{ color: MUTED }}>What to order from each supplier, from what you use and what’s on the shelf.</p>
          </div>
          {p && (
            <label className="flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Order enough for
              <select value={p.coverDays} disabled={busy === 'cover'} onChange={(e) => void run('cover', { action: 'cover', days: Number(e.target.value) }, () => void load())} className="min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[15px]" style={{ borderColor: LINE, color: INK }}>
                {Array.from(new Set([3, 5, 7, 10, 14, 21, 30, p.coverDays])).sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} days</option>)}
              </select>
            </label>
          )}
        </header>
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {note && <p role="status" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: GREEN_TINT, color: GREEN }}>{note}</p>}
        {!p ? <div className="h-48 rounded-3xl bg-[#fff]" aria-busy="true" /> : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <section aria-labelledby="way-title" className="space-y-3">
                <h2 id="way-title" className="text-[15px] font-semibold" style={{ color: MUTED }}>On its way</h2>
                {p.orders.length === 0 ? <p className="rounded-3xl bg-[#fff] px-5 py-4 text-[14px]" style={{ color: MUTED }}>Nothing ordered right now. When you order, it shows here until it comes in.</p>
                  : p.orders.map((o) => { const open = editing === o.id; const left = stillToCome(o); const total = orderTotal(left.map((l) => ({ qty: l.remaining, cost: l.costPerUnit }))); return (
                    <article key={o.id} className="rounded-3xl bg-[#fff] px-5 py-4">
                      <p className="text-[15px] font-semibold">{o.supplier}</p>
                      <p className="text-[13.5px]" style={{ color: MUTED }}>Order #{o.number}, {dayWords(o.orderDate)}{o.orderedBy ? ` by ${o.orderedBy}` : ''}. {left.length} {left.length === 1 ? 'item' : 'items'}{o.status === 'Partially Received' ? ' still to come' : ''}, {money(total)}.</p>
                      {!open && <p className="mt-1.5 text-[13.5px]" style={{ color: MUTED }}>{left.map((l) => lineWords(l, l.remaining)).join(', ')}.</p>}
                      {open && (
                        <ul className="mt-2">
                          {left.map((l) => { const g = got[l.productId] || { qty: l.remaining, cost: '' }; return (
                            <li key={l.productId} className="flex flex-wrap items-center justify-end gap-2 border-t py-2" style={{ borderColor: LINE }}>
                              <span className="min-w-[9rem] flex-1 text-[14px]">{l.productName}{l.container ? <span className="block text-[12.5px]" style={{ color: MUTED }}>{l.container}</span> : null}</span>
                              <Stepper value={g.qty} onChange={(n) => setGot((m) => ({ ...m, [l.productId]: { ...g, qty: n } }))} label={l.productName} />
                              <span className="flex min-h-[44px] w-24 shrink-0 items-center rounded-xl border bg-[#fff] px-2" style={{ borderColor: LINE }}>
                                <span aria-hidden style={{ color: MUTED }}>$</span>
                                <input inputMode="decimal" value={g.cost} onChange={(e) => setGot((m) => ({ ...m, [l.productId]: { ...g, cost: e.target.value } }))} placeholder={Number(l.costPerUnit || 0).toFixed(2)} aria-label={`What one cost: ${l.productName}`} className="min-w-0 flex-1 bg-transparent pl-0.5 text-[15px] outline-none" />
                              </span>
                            </li>); })}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {open
                          ? <button type="button" disabled={busy === `recv-${o.id}`} onClick={() => void receive(o, true)} className={`${BTN} flex-1`} style={{ background: INK, color: '#fff' }}>{busy === `recv-${o.id}` ? 'Putting it away…' : 'Receive these'}</button>
                          : <button type="button" disabled={busy === `recv-${o.id}`} onClick={() => void receive(o, false)} className={`${BTN} flex-1`} style={{ background: INK, color: '#fff' }}>{busy === `recv-${o.id}` ? 'Putting it away…' : 'Received'}</button>}
                        <button type="button" onClick={() => { setEditing(open ? null : o.id); setGot({}); }} className={`${BTN} flex-1`} style={{ border: `1px solid ${LINE}` }}>{open ? 'Back' : 'Edit first'}</button>
                      </div>
                      {!open && <p className="mt-2 text-[13px]" style={{ color: MUTED }}>One tap puts it all on the shelf at these costs.</p>}
                      {open && <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Fewer than ordered: the rest stays on its way. A cost typed here is what you pay from now on.</p>}
                      {open && <button type="button" disabled={busy === `cancel-${o.id}`} onClick={() => void run(`cancel-${o.id}`, { action: 'cancel', orderId: o.id }, () => { setEditing(null); void load(); })} className={`mt-1 min-h-[44px] text-[13.5px] font-semibold underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>{o.status === 'Partially Received' ? 'The rest isn’t coming: close this order' : 'It’s not coming: cancel this order'}</button>}
                    </article>); })}
              </section>
            </div>

            <section aria-labelledby="order-title" className="space-y-4">
              <h2 id="order-title" className="text-[15px] font-semibold" style={{ color: MUTED }}>To order</h2>
              {named.length === 0 && <p className="rounded-3xl bg-[#fff] px-5 py-4 text-[14px]" style={{ color: MUTED }}>Say who you buy things from (on the right), and what to order from each shows here.</p>}
              {named.map((sp) => {
                const lines = sp.lines; const toOrder = lines.filter((s) => q(s) > 0 || s.suggest > 0); const rest = lines.filter((s) => !(q(s) > 0 || s.suggest > 0));
                const total = orderTotal(lines.map((s) => ({ qty: q(s), cost: s.cost }))); const any = lines.some((s) => q(s) > 0); const done = sent[sp.key];
                return (
                  <article key={sp.key} className="rounded-3xl bg-[#fff] px-5 py-4">
                    <p className="flex items-baseline justify-between gap-3"><span className="text-[15px] font-semibold">{sp.name}</span><span className="text-[15px] font-semibold tabular-nums">{any ? money(total) : ''}</span></p>
                    <p className="text-[13.5px]" style={{ color: MUTED }}>{toOrder.length ? `Enough for ${p.coverDays} days, from the last ${p.lookback >= 14 ? 'two weeks' : `${p.lookback} ${p.lookback === 1 ? 'day' : 'days'}`}.` : 'Nothing to order right now.'}{lines.some((s) => s.typical && q(s) > 0) ? ' Some prices are typical, not what you pay.' : ''}</p>
                    <ul className="mt-2">{toOrder.map((s) => row(s, sp))}{more[sp.key] && rest.map((s) => row(s, sp))}</ul>
                    {rest.length > 0 && <button type="button" onClick={() => setMore((m) => ({ ...m, [sp.key]: !m[sp.key] }))} aria-expanded={!!more[sp.key]} className={`min-h-[44px] text-[13.5px] font-semibold underline underline-offset-4 ${RING}`}>{more[sp.key] ? 'Show less' : `${rest.length} more ${rest.length === 1 ? 'has' : 'have'} enough`}</button>}
                    <button type="button" disabled={!any || busy === `order-${sp.key}`} onClick={() => void order(sp)} className={`${BTN} mt-2 w-full`} style={{ background: INK, color: '#fff' }}>{busy === `order-${sp.key}` ? 'Ordering…' : 'Order these'}</button>
                    {done && (
                      <div className="mt-3 rounded-2xl p-3" style={{ background: SOFT }}>
                        <p className="text-[14px] font-semibold">Ordered from {done.supplier}</p>
                        <p className="text-[13px]" style={{ color: MUTED }}>Send it the way you usually do. Copy it into a text or an email:</p>
                        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-[#fff] p-3 text-[13.5px] leading-relaxed" style={{ fontFamily: 'inherit' }}>{orderText(p.business, done, today)}</pre>
                        <button type="button" onClick={() => void copy(sp.key, orderText(p.business, done, today))} className={`${BTN} mt-2`} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>{copied === sp.key ? 'Copied' : 'Copy the order'}</button>
                      </div>
                    )}
                  </article>);
              })}
            </section>

            <div className="space-y-4">
              {none && none.lines.length > 0 && (
                <section aria-labelledby="none-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                  <h2 id="none-title" className="text-[15px] font-semibold">No supplier yet</h2>
                  <p className="text-[13.5px]" style={{ color: MUTED }}>Say who you buy these from, and they’re ordered with the rest.</p>
                  <datalist id="known-suppliers">{p.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
                  <ul className="mt-2">
                    {none.lines.slice(0, more.__none ? 200 : 8).map((s) => (
                      <li key={s.id} className="border-t py-2.5" style={{ borderColor: LINE }}>
                        <label htmlFor={`who-${s.id}`} className="block text-[14.5px]">{s.name}</label>
                        <span className="block text-[13px]" style={{ color: MUTED }}>{s.why}</span>
                        <span className="mt-1.5 flex gap-2">
                          <input id={`who-${s.id}`} list="known-suppliers" value={who[s.id] || ''} onChange={(e) => setWho((m) => ({ ...m, [s.id]: e.target.value }))} placeholder="Supplier’s name" aria-label={`Who you buy ${s.name} from`} className={FIELD} style={{ borderColor: LINE }} />
                          <button type="button" disabled={!String(who[s.id] || '').trim() || busy === `who-${s.id}`} onClick={() => void run(`who-${s.id}`, { action: 'supplier', itemId: s.id, supplier: who[s.id] }, () => { setWho((m) => { const n = { ...m }; delete n[s.id]; return n; }); void load(); })} className={BTN} style={{ background: INK, color: '#fff' }}>Save</button>
                        </span>
                      </li>))}
                  </ul>
                  {none.lines.length > 8 && <button type="button" onClick={() => setMore((m) => ({ ...m, __none: !m.__none }))} className={`min-h-[44px] text-[13.5px] font-semibold underline underline-offset-4 ${RING}`}>{more.__none ? 'Show less' : `${none.lines.length - 8} more`}</button>}
                </section>
              )}
              {p.uncounted.length > 0 && (
                <section aria-labelledby="uncounted-title" className="rounded-3xl bg-[#fff] px-5 py-4">
                  <h2 id="uncounted-title" className="text-[15px] font-semibold">Not counted yet</h2>
                  <p className="text-[13.5px]" style={{ color: MUTED }}>{p.uncounted.slice(0, 3).map((x) => x.name).join(', ')}{p.uncounted.length > 3 ? ` and ${p.uncounted.length - 3} more` : ''}. Count {p.uncounted.length === 1 ? 'it' : 'them'} in <Link href="/inventory" className="underline underline-offset-4">Inventory</Link>, or receive a delivery, and what to order shows here.</p>
                </section>
              )}
              <section className="rounded-3xl bg-[#fff] px-5 py-4">
                <h2 className="text-[15px] font-semibold">Keep a set amount</h2>
                <p className="text-[13.5px]" style={{ color: MUTED }}>Tap an item to keep a set number on hand instead (2 bags of lemons, say). It’s ordered back up to that.</p>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
