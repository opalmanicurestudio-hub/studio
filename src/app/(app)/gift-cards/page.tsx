'use client';
// src/app/(app)/gift-cards/page.tsx — GIFT CARDS (lib/gift-cards). Managers: what's owed on cards, sold and used this month,
// cards unused for two years; every card with what's left, who it's for and where it came from. Open one to see its
// history, resend it, correct the balance (with a reason) or cancel it. Selling happens at checkout; old cards come in
// through Moving in.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { GiftShopSettings } from '@/components/gift/GiftShopSettings';
import { brandAccent } from '@/lib/brand-accent';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const card = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '—');
const HIST: Record<string, string> = { issue: 'Sold', import: 'Brought in', spend: 'Used', adjust: 'Balance changed', void: 'Cancelled', transfer: 'Given to someone else' };

export default function GiftCardsPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || ''; const { services } = useInventory() as any;
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [cards, setCards] = React.useState<any[] | null>(null); const [q, setQ] = React.useState(''); const [show, setShow] = React.useState<'left' | 'all'>('left');
  const [open, setOpen] = React.useState<any>(null); const [msg, setMsg] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [adj, setAdj] = React.useState(''); const [note, setNote] = React.useState('');
  const [tf, setTf] = React.useState<{ name: string; phone: string; email: string; send: '' | 'text' | 'email' } | null>(null); const [shop, setShop] = React.useState(false);
  const brand = { name: selectedTenant?.name || 'Gift card', logo: selectedTenant?.logoUrl || null, accent: brandAccent(selectedTenant) };
  const load = React.useCallback(() => { if (tenantId && isManager) payPost('/api/gift-cards', { tenantId, action: 'list' }).then((r) => setCards(r.ok ? r.cards : [])); }, [tenantId, isManager]);
  React.useEffect(() => { load(); }, [load]);
  if (!isManager) return <div className="p-6"><AppHeader title="Gift cards" /><p className="mt-6" style={{ color: MUTED }}>Gift cards are for managers. Sell one at checkout.</p></div>;
  const all = cards || []; const ym = new Date().toISOString().slice(0, 7); const twoYears = Date.now() - 730 * 86400000;
  const mineOnly = all.filter((c) => !c.ownerRenterId);   // renters' own cards are their money, not the studio's
  const owed = mineOnly.filter((c) => c.status === 'active').reduce((s, c) => s + c.balanceCents, 0); const owedN = mineOnly.filter((c) => c.status === 'active' && c.balanceCents > 0).length;
  const soldMonth = mineOnly.filter((c) => c.source !== 'import' && String(c.createdAt).startsWith(ym)).reduce((s, c) => s + c.initialCents, 0);
  const usedMonth = all.reduce((s, c) => s + (c.history || []).filter((h: any) => h.type === 'spend' && String(h.at).startsWith(ym)).reduce((a: number, h: any) => a - h.cents, 0), 0);
  const stale = all.filter((c) => c.status === 'active' && c.balanceCents > 0 && Date.parse(c.lastUsedAt || c.createdAt) < twoYears).reduce((s, c) => s + c.balanceCents, 0);
  const list = all.filter((c) => (show === 'all' || (c.status === 'active' && c.balanceCents > 0)) && (!q.trim() || `${c.code} ${c.recipientName || ''} ${c.purchaserName || ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const act = async (body: any, done: string) => { setBusy(true); setMsg(''); const r = await payPost('/api/gift-cards', { tenantId, ...body }); setBusy(false); if (r.ok) { setMsg(done); setAdj(''); setNote(''); load(); } else setMsg(r.error || 'That didn’t work.'); };
  const cur = open ? all.find((c) => c.id === open.id) || open : null;
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: '#f7f7f8' }}>
      <AppHeader title="Gift cards" />
      <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>money</p><h1 className="text-[34px] font-normal tracking-[-0.03em]">Gift cards</h1></div>
          <div className="flex flex-wrap gap-2"><a href="/gift-cards/report" className="inline-flex h-11 items-center rounded-full border bg-white px-5 text-[14px] font-medium" style={{ borderColor: LINE }}>Money report</a><button type="button" onClick={() => setShop(true)} className="inline-flex h-11 items-center rounded-full border bg-white px-5 text-[14px] font-medium" style={{ borderColor: LINE }}>Online shop &amp; designs</button><a href="/import?kind=giftcards" className="inline-flex h-11 items-center rounded-full border bg-white px-5 text-[14px]" style={{ borderColor: LINE }}>Bring in from old app</a><a href="/pos" className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-medium text-white" style={{ background: INK }}>Sell a gift card</a></div></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[[$(owed), `owed on ${owedN} card${owedN === 1 ? '' : 's'}`], [$(soldMonth), 'sold this month'], [$(usedMonth), 'used this month'], [$(stale), 'unused over 2 years']].map(([n, l]) => <div key={l} className="p-4" style={card}><p className="text-[26px] font-normal tracking-[-0.03em]">{n}</p><p className="text-[13px]" style={{ color: MUTED }}>{l}</p></div>)}</div>
        <div className="flex flex-wrap items-center gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a code or a name" aria-label="Find a gift card" className="h-11 min-w-0 flex-1 rounded-full border bg-white px-4 text-[15px]" style={{ borderColor: LINE }} />
          {(['left', 'all'] as const).map((k) => <button key={k} type="button" onClick={() => setShow(k)} className="h-11 rounded-full px-4 text-[14px] font-medium" style={show === k ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{k === 'left' ? 'With money left' : 'All cards'}</button>)}</div>
        <div className="overflow-hidden" style={card}>
          <div className="hidden grid-cols-[1.1fr_1.4fr_.8fr_.8fr_.9fr] px-5 py-2.5 text-[12px] md:grid" style={{ color: MUTED }}><span>Code</span><span>For</span><span className="text-right">Left</span><span className="text-right">Was</span><span className="text-right">Last used</span></div>
          {cards === null ? <p className="px-5 py-6 text-[14px]" style={{ color: MUTED }}>Loading…</p> : !list.length ? <p className="px-5 py-6 text-[14px]" style={{ color: MUTED }}>{all.length ? 'No cards match.' : 'No gift cards yet. Sell one at checkout, or bring in balances from your old app.'}</p>
            : list.map((c) => <button key={c.id} type="button" onClick={() => { setOpen(c); setMsg(''); }} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-5 py-3 text-left md:grid-cols-[1.1fr_1.4fr_.8fr_.8fr_.9fr]" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="font-mono text-[13px]">{c.code}</span>
              <span className="order-3 text-[14px] md:order-none">{c.recipientName || c.purchaserName || 'Not linked yet'}<span className="block text-[11.5px]" style={{ color: MUTED }}>{c.ownerRenterId ? `${c.ownerName || 'a renter'}’s own card · ` : ''}{c.source === 'import' ? `brought in${c.importedFrom ? ` from ${c.importedFrom}` : ''}` : c.purchaserName && c.recipientName && c.purchaserName !== c.recipientName ? `from ${c.purchaserName}` : c.source === 'recovery' ? 'given as a gift' : 'sold here'}{c.status === 'void' ? ' · cancelled' : ''}{c.sendAt ? ` · sends ${day(c.sendAt)}` : c.sendStatus === 'failed' ? ' · didn’t send' : ''}</span></span>
              <span className="text-right text-[14.5px] font-bold">{$(c.balanceCents)}</span>
              <span className="hidden text-right text-[14px] md:block" style={{ color: MUTED }}>{$(c.initialCents)}</span>
              <span className="hidden text-right text-[13.5px] md:block" style={{ color: MUTED }}>{c.lastUsedAt ? day(c.lastUsedAt) : 'Never'}</span></button>)}
        </div>
        <p className="text-[12.5px]" style={{ color: MUTED }}>Money on gift cards counts as owed to clients until it’s spent; then it becomes a sale — so it’s never counted twice.</p>
      </main>
      {cur && <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label={`Gift card ${cur.code}`}><button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.2)' }} onClick={() => setOpen(null)} />
        <div className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-6">
          <div className="flex items-start justify-between"><div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>gift card</p><p className="font-mono text-[22px]">{cur.code}</p></div><button type="button" onClick={() => setOpen(null)} className="text-[22px]" style={{ color: MUTED }} aria-label="Close">×</button></div>
          <div className="flex justify-center"><GiftCardFace design={cur.design} brand={brand} amount={$(cur.initialCents).replace('.00', '')} name={cur.recipientName} code={cur.code} expires={cur.expiresAt} line={cur.line || ''} width={340} /></div>
          <div className="rounded-2xl p-4" style={{ background: SOFT }}><p className="text-[30px] font-normal tracking-[-0.03em]">{$(cur.balanceCents)} <span className="text-[15px]" style={{ color: MUTED }}>of {$(cur.initialCents)}</span></p><p className="text-[13.5px]" style={{ color: MUTED }}>{cur.recipientName ? `For ${cur.recipientName}` : 'Not linked to a client yet — it works by code'}{cur.purchaserName ? ` · from ${cur.purchaserName}` : ''}</p>{cur.message && <p className="mt-2 text-[14px]">“{cur.message}”</p>}</div>
          <div><p className="pb-1 text-[13px] font-semibold" style={{ color: MUTED }}>HISTORY</p>{(cur.history || []).slice().reverse().map((h: any, i: number) => <div key={i} className="flex justify-between gap-2 py-2 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><span>{HIST[h.type] || h.type}{h.note ? <span style={{ color: MUTED }}> — {h.note}</span> : null}<span className="block text-[12px]" style={{ color: MUTED }}>{day(h.at)} · {h.by}</span></span><span className="text-right font-semibold" style={{ color: h.cents < 0 ? INK : GREEN }}>{h.cents > 0 ? '+' : h.cents < 0 ? '−' : ''}{$(Math.abs(h.cents))}<span className="block text-[12px] font-normal" style={{ color: MUTED }}>{$(h.balanceAfter)} left</span></span></div>)}</div>
          {cur.status !== 'void' && <>
            {(cur.recipientPhone || cur.recipientEmail) && <button type="button" disabled={busy} onClick={() => act({ action: 'resend', id: cur.id, via: cur.recipientPhone ? 'text' : 'email' }, 'Sent.')} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: SOFT }}>Send it again to {cur.recipientPhone || cur.recipientEmail}</button>}
            {!tf ? <button type="button" onClick={() => setTf({ name: '', phone: '', email: '', send: '' })} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: SOFT }}>Give it to someone else</button>
              : <div className="space-y-2 rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}><p className="text-[14px] font-semibold">Give it to someone else</p><p className="text-[12.5px]" style={{ color: MUTED }}>The balance moves with the card; who had it before stays in the history.</p>
                <input value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} placeholder="Their name" aria-label="Their name" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
                <input value={tf.phone} onChange={(e) => setTf({ ...tf, phone: e.target.value })} inputMode="tel" placeholder="Mobile (optional)" aria-label="Their mobile" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
                <input value={tf.email} onChange={(e) => setTf({ ...tf, email: e.target.value })} inputMode="email" placeholder="Email (optional)" aria-label="Their email" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
                <div className="flex flex-wrap gap-1.5">{([['', 'Don’t send'], ['text', 'Text it to them'], ['email', 'Email it to them']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTf({ ...tf, send: k })} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={tf.send === k ? { background: INK, color: '#fff' } : { background: SOFT }}>{l}</button>)}</div>
                <div className="flex gap-2"><button type="button" onClick={() => setTf(null)} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Cancel</button>
                  <button type="button" disabled={busy || !tf.name.trim() || (tf.send === 'text' && tf.phone.replace(/\D/g, '').length < 10) || (tf.send === 'email' && !/\S+@\S+\.\S+/.test(tf.email))} onClick={async () => { await act({ action: 'transfer', id: cur.id, name: tf.name, phone: tf.phone || null, email: tf.email || null, send: tf.send || null }, 'Given to ' + tf.name + '.'); setTf(null); }} className="h-11 flex-1 rounded-full text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Move the card</button></div></div>}
            <div className="space-y-2 rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}><p className="text-[14px] font-semibold">Correct the balance</p>
              <div className="flex gap-2"><input value={adj} onChange={(e) => setAdj(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="New balance, e.g. 40.00" aria-label="New balance" className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /></div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (required)" aria-label="Why the balance is changing" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
              <button type="button" disabled={busy || adj === '' || !note.trim()} onClick={() => act({ action: 'adjust', id: cur.id, kind: 'set', cents: Math.round(Number(adj) * 100), note }, 'Balance saved.')} className="h-11 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Save balance</button></div>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Cancel gift card ${cur.code}? The ${$(cur.balanceCents)} left on it can’t be spent after this.`)) act({ action: 'adjust', id: cur.id, kind: 'void' }, 'Cancelled.'); }} className="text-[14px] font-semibold underline underline-offset-4" style={{ color: RED }}>Cancel this card</button></>}
          {msg && <p className="text-[14px] font-semibold">{msg}</p>}
        </div></div>}
      {shop && <GiftShopSettings tenantId={tenantId} brand={brand} services={services || []} onClose={() => setShop(false)} />}
    </div>);
}
