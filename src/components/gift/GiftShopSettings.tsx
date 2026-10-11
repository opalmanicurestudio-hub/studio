'use client';
// src/components/gift/GiftShopSettings.tsx — THE ONLINE GIFT CARD SHOP, for managers (lib/gift-designs, /api/gift-cards
// action 'settings'). Turn selling online on, share the link, set the amounts and the rules, and choose which designs from
// the library buyers can pick (all of them until you turn some off). Occasion cards show only in their season by default.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { COLLECTIONS, COLLECTION_NOTE, designsSync, inSeason, rulesFrom, deskScript } from '@/lib/gift-designs';
import { GiftCardShowcase, DEFAULT_SHOWCASE } from '@/components/gift/GiftCardShowcase';
import { GiftOffersEditor } from '@/components/gift/GiftOffersEditor';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const field = 'h-11 w-full rounded-xl border px-3 text-[15px]';

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
    <span><span className="block text-[15px] font-semibold">{label}</span>{hint && <span className="block text-[13px]" style={{ color: MUTED }}>{hint}</span>}</span>
    <span className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? GREEN : '#d5d6da' }}><span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 24 : 4 }} /></span></button>;
}

export function GiftShopSettings({ tenantId, brand, onClose, services = [] }: { tenantId: string; brand: { name: string; logo?: string | null; accent?: string | null }; onClose: () => void; services?: any[] }) {
  const all = React.useMemo(() => designsSync(), []);
  const [s, setS] = React.useState<any>(null); const [ready, setReady] = React.useState(true);
  const [amounts, setAmounts] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null);
  const [col, setCol] = React.useState<string>('Occasions'); const [copied, setCopied] = React.useState(false);
  // The three cards on the booking page — design, amount and label each; one slot's design picker open at a time.
  const [slot, setSlot] = React.useState<number | null>(null); const [slotCol, setSlotCol] = React.useState<string>('Finishes');
  const show = (s?.showcase && s.showcase.length ? s.showcase : DEFAULT_SHOWCASE) as { design: string; amount: number; label: string | null }[];
  const setShow = (i: number, patch: any) => set('showcase', show.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  React.useEffect(() => { payPost('/api/gift-cards', { tenantId, action: 'settings' }).then((r) => { if (r.ok) { setS({ ...r.settings, designs: r.settings.designs || all.map((d) => d.id) }); setAmounts(r.settings.amounts.join(', ')); setReady(r.paymentsReady); } }); }, [tenantId, all]);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/gift/${tenantId}` : `/gift/${tenantId}`;
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  const toggleDesign = (id: string) => set('designs', s.designs.includes(id) ? s.designs.filter((x: string) => x !== id) : [...s.designs, id]);
  const save = async () => {
    setBusy(true); setMsg(null);
    const nums = amounts.split(/[,\s]+/).map((x) => Number(x.replace(/[^0-9.]/g, ''))).filter((n) => n >= 1);
    const r = await payPost('/api/gift-cards', { tenantId, action: 'settings', save: { ...s, amounts: nums, designs: s.designs.length === all.length ? null : s.designs, rules: s.customRules ? s.rules : '' } });
    setBusy(false); setMsg({ ok: !!r.ok, t: r.ok ? 'Saved.' : r.error || 'That didn’t save.' });
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Online gift card shop">
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.2)' }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white" style={{ color: INK }}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-6 py-4 backdrop-blur" style={{ borderColor: LINE }}>
          <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>gift cards</p><p className="text-[22px] font-normal tracking-[-0.02em]">Online shop and designs</p></div>
          <button type="button" onClick={onClose} className="text-[24px]" style={{ color: MUTED }} aria-label="Close">×</button></div>
        {!s ? <p className="p-6" style={{ color: MUTED }}>Loading…</p> : <div className="space-y-6 p-6">
          <section className="space-y-2 rounded-[18px] p-4" style={{ border: `1px solid ${LINE}` }}>
            <Toggle on={s.online} onChange={(v) => set('online', v)} label="Sell gift cards online" hint="A page where anyone can buy one — linked from your booking page." />
            {!ready && <p className="text-[13.5px] font-semibold" style={{ color: RED }}>Connect card payments in Settings first — the page stays closed until then.</p>}
            {s.online && <div className="flex gap-2 pt-1"><input readOnly value={link} aria-label="Your gift card page" className={`${field} font-mono text-[13px]`} style={{ borderColor: LINE, background: SOFT }} />
              <button type="button" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>{copied ? 'Copied' : 'Copy'}</button>
              <a href={`/gift/${tenantId}`} target="_blank" rel="noreferrer" className="inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>Open</a></div>}
          </section>
          <section className="space-y-3">
            <p className="text-[15px] font-semibold">Amounts</p>
            <label className="block text-[13px]" style={{ color: MUTED }}>Quick picks (up to 6)<input value={amounts} onChange={(e) => setAmounts(e.target.value)} placeholder="25, 50, 100, 150" className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label>
            <Toggle on={s.serviceCards !== false} onChange={(v) => set('serviceCards', v)} label="Sell services as gifts" hint="“A gel manicure” instead of dollars — priced at today’s price, and still covered if the price goes up." />
            <Toggle on={s.custom} onChange={(v) => set('custom', v)} label="Let buyers type their own amount" />
            {s.custom && <div className="grid grid-cols-2 gap-2"><label className="text-[13px]" style={{ color: MUTED }}>Least<input value={s.min} onChange={(e) => set('min', e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label>
              <label className="text-[13px]" style={{ color: MUTED }}>Most<input value={s.max} onChange={(e) => set('max', e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label></div>}
          </section>
          <section className="space-y-3">
            <Toggle on={s.onBooking} onChange={(v) => set('onBooking', v)} label="Show gift cards on your booking page" hint="Three cards you choose, with a “Gift cards” link in the header." />
            {s.onBooking && <>
              <div className="overflow-hidden rounded-[18px] px-3 py-8" style={{ background: '#faf8f5', border: `1px solid ${LINE}` }}>
                <p className="mb-1 text-center text-[11px] tracking-[0.14em]" style={{ color: MUTED }}>PREVIEW · HOW IT LOOKS ON YOUR PAGE</p>
                <GiftCardShowcase tenantId={tenantId} brand={brand} items={show} services={services} offered={s.designs} preview />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">{show.map((x, i) => <div key={i} className="space-y-2 rounded-2xl p-3" style={{ border: `1px solid ${slot === i ? INK : LINE}` }}>
                <button type="button" onClick={() => setSlot(slot === i ? null : i)} className="block w-full text-left" aria-label={`Change the design of card ${i + 1}`}><GiftCardFace design={x.design} brand={brand} amount={`$${x.amount}`} name=" " width={170} /></button>
                <button type="button" onClick={() => setSlot(slot === i ? null : i)} className="text-[13px] font-semibold underline underline-offset-4">{slot === i ? 'Done choosing' : 'Change design'}</button>
                <div className="space-y-2"><input value={x.amount} onChange={(e) => setShow(i, { amount: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} inputMode="decimal" aria-label={`Card ${i + 1} amount`} className={field} style={{ borderColor: LINE }} />
                  <input value={x.label || ''} onChange={(e) => setShow(i, { label: e.target.value.slice(0, 40) })} placeholder="Label" aria-label={`Card ${i + 1} label`} className={field} style={{ borderColor: LINE }} /></div>
              </div>)}</div>
              {slot !== null && <div className="space-y-3 rounded-2xl p-3" style={{ background: SOFT }}>
                <p className="text-[13.5px] font-semibold">Choose a design for card {slot + 1}</p>
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">{COLLECTIONS.map((c) => <button key={c} type="button" aria-pressed={slotCol === c} onClick={() => setSlotCol(c)} className="h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold" style={slotCol === c ? { background: INK, color: '#fff' } : { background: '#fff' }}>{c}</button>)}</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{all.filter((d) => d.collection === slotCol).map((d) => <button key={d.id} type="button" aria-pressed={show[slot]?.design === d.id} onClick={() => setShow(slot, { design: d.id })} className="rounded-[10px] p-[2px] text-left" style={{ outline: show[slot]?.design === d.id ? `2px solid ${INK}` : 'none', outlineOffset: 1 }}>
                  <GiftCardFace design={d} brand={brand} amount={`$${show[slot]?.amount || 50}`} name=" " width={128} /><span className="mt-1 block text-[11.5px] font-semibold">{d.name}</span></button>)}</div>
                <p className="text-[12.5px]" style={{ color: MUTED }}>Tip: pick designs that match your page — one light, one bold and one rich works well. The middle card is raised; most people choose it.</p>
              </div>}
            </>}
          </section>
          <GiftOffersEditor offers={s.offers || []} onChange={(v) => set('offers', v)} />
          <section className="space-y-1 rounded-[18px] p-4" style={{ border: `1px solid ${LINE}` }}>
            <p className="text-[15px] font-semibold">Messages</p>
            <Toggle on={s.balanceReminders !== false} onChange={(v) => set('balanceReminders', v)} label="Remind people about money left on their card" hint="A gentle note after 60 days unused — at most every 90 days, 3 times in all, never to anyone who turned messages off." />
            <Toggle on={s.buyerThanks !== false} onChange={(v) => set('buyerThanks', v)} label="Tell the buyer when their gift is used" hint="One short email the first time — a thank-you that brings them back too." />
          </section>
          <section className="space-y-1 rounded-[18px] p-4" style={{ border: `1px solid ${LINE}` }}>
            <p className="text-[15px] font-semibold">Renters</p>
            <p className="text-[13px]" style={{ color: MUTED }}>For booth renters who run their own business here.</p>
            <Toggle on={s.renters?.salonCards !== false} onChange={(v) => set('renters', { ...(s.renters || {}), salonCards: v })} label="Renters take your gift cards"
              hint="A client can pay a renter with your gift card. You hold the money, so it’s credited against the renter’s next rent automatically." />
            <Toggle on={s.renters?.ownCards === true} onChange={(v) => set('renters', { ...(s.renters || {}), ownCards: v })} label="Renters sell their own gift cards"
              hint="Paid to the renter’s own account and used only with them — it’s their money, not yours. They can sell in person and on their booking page." />
          </section>
          <section className="space-y-3 rounded-[18px] p-4" style={{ border: `1px solid ${LINE}` }}>
            <p className="text-[15px] font-semibold">Your gift card rules</p>
            {([['Expires', 'expiryYears', [[0, 'Never'], [5, '5 years'], [7, '7 years'], [10, '10 years']]], ['Cash back for small balances', 'cashBackUnderCents', [[0, 'No'], [500, 'Under $5'], [1000, 'Under $10']]], ['Buyer can get a refund if unused', 'refundDays', [[0, 'No'], [7, '7 days'], [14, '14 days'], [30, '30 days']]]] as [string, string, [number, string][]][]).map(([label, key, opts]) => (
              <div key={key}><p className="mb-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>{label}</p><div className="flex flex-wrap gap-1.5">{opts.map(([v, l]) => <button key={v} type="button" aria-pressed={s[key] === v} onClick={() => set(key, v)} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={s[key] === v ? { background: INK, color: '#fff' } : { background: SOFT }}>{l}</button>)}</div></div>))}
            <div><p className="mb-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>Works for</p><div className="flex flex-wrap gap-1.5">{(['services', 'products', 'tips'] as const).map((k) => <button key={k} type="button" aria-pressed={s.paysFor?.[k] !== false} onClick={() => set('paysFor', { ...(s.paysFor || {}), [k]: s.paysFor?.[k] === false })} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold capitalize" style={s.paysFor?.[k] !== false ? { background: INK, color: '#fff' } : { background: SOFT }}>{k}</button>)}</div></div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: MUTED }}>Federal law requires at least five years before a card can expire. Some states don’t allow expiry at all, and California requires cash back for balances under $10. Check your state’s rules with your accountant.</p>
            <div className="rounded-2xl p-3" style={{ background: SOFT }}><p className="text-[12px] font-semibold" style={{ color: MUTED }}>WHAT BUYERS SEE</p>
              {s.customRules ? <textarea value={s.rules} onChange={(e) => set('rules', e.target.value.slice(0, 600))} rows={3} className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-[14.5px] leading-relaxed" style={{ borderColor: LINE }} />
                : <p className="mt-1 text-[14px] leading-relaxed">{rulesFrom(s)}</p>}
              <button type="button" onClick={() => setS((x: any) => ({ ...x, customRules: !x.customRules, rules: x.customRules ? x.rules : rulesFrom(x) }))} className="mt-2 text-[13px] font-semibold underline underline-offset-4">{s.customRules ? 'Use the rules from my choices' : 'Write my own wording'}</button>
              <p className="mt-3 text-[12px] font-semibold" style={{ color: MUTED }}>WHAT THE DESK SAYS</p><p className="mt-1 text-[14px]">“{deskScript(s)}”</p></div>
          </section>
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3"><div><p className="text-[15px] font-semibold">Designs buyers can choose</p><p className="text-[13px]" style={{ color: MUTED }}>{s.designs.length} of {all.length} on</p></div>
              <button type="button" onClick={() => set('designs', s.designs.length === all.length ? [all[0].id] : all.map((d) => d.id))} className="text-[13.5px] font-semibold underline underline-offset-4">{s.designs.length === all.length ? 'Turn all off' : 'Turn all on'}</button></div>
            <Toggle on={s.seasonalOnly} onChange={(v) => set('seasonalOnly', v)} label="Show holiday cards only in season" hint="Holidays from mid-November, Valentine’s from late January, and so on." />
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">{COLLECTIONS.map((c) => <button key={c} type="button" aria-pressed={col === c} onClick={() => setCol(c)} className="h-9 shrink-0 rounded-full px-3.5 text-[13.5px] font-semibold" style={col === c ? { background: INK, color: '#fff' } : { background: SOFT }}>{c} <span style={{ opacity: 0.6 }}>{all.filter((d) => d.collection === c && s.designs.includes(d.id)).length}</span></button>)}</div>
            <p className="text-[13px]" style={{ color: MUTED }}>{COLLECTION_NOTE[col]}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{all.filter((d) => d.collection === col).map((d) => { const on = s.designs.includes(d.id); return (
              <button key={d.id} type="button" aria-pressed={on} onClick={() => toggleDesign(d.id)} className="flex flex-col gap-1.5 text-left">
                <span className="relative block" style={{ opacity: on ? 1 : 0.4, filter: on ? 'none' : 'grayscale(.6)' }}><GiftCardFace design={d} brand={brand} amount="$100" name=" " line={d.line || ''} width={180} />
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold" style={on ? { background: GREEN, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{on ? '✓' : ''}</span></span>
                <span className="text-[13.5px] font-semibold">{d.name}</span>
                <span className="text-[12px]" style={{ color: MUTED }}>{d.season ? `${d.note.replace('Shown ', '')}${inSeason(d) ? ' · in season now' : ''}` : d.collection === 'Occasions' ? 'Year-round' : d.note}</span></button>); })}</div>
          </section>
        </div>}
        {s && <div className="sticky bottom-0 mt-auto flex items-center gap-3 border-t bg-white px-6 py-4" style={{ borderColor: LINE }}>
          {msg && <p className="flex-1 text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : RED }} role="status">{msg.t}</p>}
          <button type="button" disabled={busy} onClick={save} className="ml-auto h-11 rounded-full px-6 text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : 'Save'}</button></div>}
      </div>
    </div>);
}
