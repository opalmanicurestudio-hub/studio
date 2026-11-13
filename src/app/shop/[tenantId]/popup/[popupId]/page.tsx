'use client';
// ─── /shop/[tenantId]/popup/[popupId] ─────────────────────────────────────────
// ORDER FROM THE LINE: what the sign on a pop-up's table opens (lib/popup). The table's products with what's left, how
// many of each, a name and an email (and a mobile, to be texted the number when it's called), and pay with the shop's
// own checkout (api/retail/checkout with the pop-up: picked up at the table today). After paying, the order page shows
// the number the team calls. What's left is read again every half minute, and checked again as the order is placed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShopHeader } from '@/components/shop/ShopChrome';

type Item = { id: string; name: string; priceCents: number; imageUrl: string | null; number: number | null; prosOnly: boolean; left: number; cart: { productId: string; selections?: Record<string, string> } };
const ink = 'var(--shop-ink, #16171a)'; const mutedC = 'var(--shop-muted, #6d7075)'; const line = 'var(--shop-line, #ececee)';
const card = 'var(--shop-card, #fff)'; const brand = 'var(--shop-brand, #16171a)'; const onBrand = 'var(--shop-on-brand, #fff)'; const soft = 'var(--shop-brand-soft, #f5f5f7)';
const input = 'mt-1 block h-12 w-full rounded-2xl border px-3.5 text-[16px] font-normal outline-none';
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;

export default function PopupOrderPage({ params }: { params: Promise<{ tenantId: string; popupId: string }> }) {
  const { tenantId, popupId } = React.use(params);
  const [info, setInfo] = useState<{ shopName: string; name: string; place: string; open: boolean; over?: boolean; items: Item[] } | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [who, setWho] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const key = useRef('');
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/retail/popup-public?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(popupId)}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (d.ok) setInfo({ shopName: String(d.shopName || ''), name: String(d.name || ''), place: String(d.place || ''), open: d.open === true, over: d.over === true, items: d.items || [] });
      else setInfo((x) => x || { shopName: '', name: '', place: '', open: false, items: [] });
    } catch { /* the last list stands */ }
  }, [tenantId, popupId]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);
  // (No more than what's left, as it changes.)
  useEffect(() => { if (!info) return; setQty((q) => { const n: Record<string, number> = {}; for (const it of info.items) if (q[it.id]) n[it.id] = Math.min(q[it.id], it.left); return n; }); }, [info]);

  const items = info?.items || [];
  const picked = items.filter((it) => (qty[it.id] || 0) > 0);
  const count = picked.reduce((s, it) => s + qty[it.id], 0);
  const subtotal = picked.reduce((s, it) => s + it.priceCents * qty[it.id], 0);
  const emailOk = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]{2,}$/.test(who.email.trim());
  const ready = count > 0 && who.name.trim().length > 0 && emailOk;
  const set = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, n)) }));

  const pay = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    if (!key.current) { try { const b = new Uint8Array(18); crypto.getRandomValues(b); key.current = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); } catch { key.current = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; } }
    try {
      const r = await fetch('/api/retail/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        tenantId, popupId, method: 'counter', checkoutKey: key.current,
        items: picked.map((it) => ({ productId: it.cart.productId, qty: qty[it.id], ...(it.cart.selections ? { selections: it.cart.selections } : {}) })),
        customer: { name: who.name.trim(), email: who.email.trim(), ...(who.phone.trim() ? { phone: who.phone.trim() } : {}) },
      }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) { setErr(String(d.error || 'That didn’t go through. Try again.')); if (d.popupChanged || d.popupClosed) void load(); return; }
      window.location.href = d.url;
    } catch { setErr('That didn’t reach the shop. Check your connection and try again.'); } finally { setBusy(false); }
  };

  return (
    <div style={{ color: ink, fontFamily: 'var(--shop-font, inherit)' }}>
      <ShopHeader minimal />
      <main className="mx-auto max-w-md px-4 pb-40 pt-5">
        {!info ? <p className="m-0 text-[15px]" style={{ color: mutedC }}>Loading…</p> : !info.open ? (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">{info.name || 'This pop-up'}</h1>
            <p className="m-0 mt-2 text-[16px]">{info.over ? 'This pop-up is over. Thanks for coming by.' : 'Orders from the line are closed right now. Come to the table, and we’ll help you there.'}</p>
          </>
        ) : (
          <>
            <p className="m-0 text-[14px]" style={{ color: mutedC }}>{info.shopName}{info.place ? `, ${info.place}` : ''}</p>
            <h1 className="m-0 mt-0.5 text-[28px] font-light leading-tight tracking-[-0.02em]">Skip the line at {info.name}</h1>
            <p className="m-0 mt-1 text-[15px]" style={{ color: mutedC }}>Pick what you want and pay here. We’ll bag it and call your number.</p>
            <ul className="m-0 mt-5 list-none space-y-2 p-0">
              {items.map((it) => { const n = qty[it.id] || 0; const out = it.left <= 0;
                // (For licensed pros: the license is checked at the table, not from the line.)
                const atTable = it.prosOnly; return (
                <li key={it.id} className="flex items-center gap-3 rounded-[18px] border p-2.5" style={{ borderColor: line, background: card, opacity: out ? 0.6 : 1 }}>
                  {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-contain" style={{ background: soft }} /> : <span className="h-16 w-16 shrink-0 rounded-xl" style={{ background: soft }} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15.5px] font-semibold leading-snug">{it.number != null && <span className="mr-1.5 tabular-nums" style={{ color: mutedC }}>{it.number}</span>}{it.name}</span>
                    <span className="block text-[14px]" style={{ color: mutedC }}>{money(it.priceCents)}{out ? ', sold out' : it.left <= 3 ? `, ${it.left} left` : ''}{atTable ? '. For licensed pros: order it at the table' : ''}</span>
                  </span>
                  {!out && !atTable && (n ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button type="button" aria-label={`One less ${it.name}`} onClick={() => set(it.id, n - 1, it.left)} className="grid h-11 w-11 place-items-center rounded-full text-[20px]" style={{ background: soft }}>−</button>
                      <span aria-live="polite" className="w-6 text-center text-[16px] font-semibold tabular-nums">{n}</span>
                      <button type="button" aria-label={`One more ${it.name}`} disabled={n >= it.left} onClick={() => set(it.id, n + 1, it.left)} className="grid h-11 w-11 place-items-center rounded-full text-[20px] disabled:opacity-40" style={{ background: soft }}>+</button>
                    </span>
                  ) : <button type="button" onClick={() => set(it.id, 1, it.left)} aria-label={`Add ${it.name}`} className="h-11 shrink-0 rounded-full px-4 text-[15px] font-semibold" style={{ background: soft }}>Add</button>)}
                </li>); })}
            </ul>
            {count > 0 && (
              <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Your name<input required value={who.name} onChange={(e) => setWho((w) => ({ ...w, name: e.target.value.slice(0, 80) }))} autoComplete="name" className={input} style={{ borderColor: line, background: card, color: ink }} /></label>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Email, for your receipt<input required type="email" value={who.email} onChange={(e) => setWho((w) => ({ ...w, email: e.target.value.slice(0, 160) }))} autoComplete="email" className={input} style={{ borderColor: line, background: card, color: ink }} /></label>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Mobile, to get a text when we call your number<input value={who.phone} onChange={(e) => setWho((w) => ({ ...w, phone: e.target.value.slice(0, 30) }))} inputMode="tel" autoComplete="tel" placeholder="Optional" className={input} style={{ borderColor: line, background: card, color: ink }} /></label>
                {err && <p role="alert" className="m-0 text-[15px]" style={{ color: '#b45309' }}>{err}</p>}
                <div className="fixed inset-x-0 bottom-0 border-t px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3" style={{ borderColor: line, background: card }}>
                  <div className="mx-auto max-w-md">
                    <p className="m-0 mb-2 flex justify-between text-[15px]"><span>{count} item{count === 1 ? '' : 's'}</span><span className="font-semibold tabular-nums">{money(subtotal)}</span></p>
                    <button type="submit" disabled={!ready || busy} className="h-12 w-full rounded-full text-[16px] font-semibold disabled:opacity-50" style={{ background: brand, color: onBrand }}>{busy ? 'Opening payment…' : 'Go to payment'}</button>
                    <p className="m-0 mt-1.5 text-center text-[13px]" style={{ color: mutedC }}>{ready ? 'Any tax is added there. Pick it up at the table when we call your number.' : 'Add your name and email to pay.'}</p>
                  </div>
                </div>
              </form>)}
            <p className="m-0 mt-8 text-center text-[14px]" style={{ color: mutedC }}>Rather order in person? Come to the table.</p>
          </>
        )}
      </main>
    </div>);
}
