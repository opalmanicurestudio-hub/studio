'use client';
// src/components/gift/GiftShopSettings.tsx — THE ONLINE GIFT CARD SHOP, for managers (lib/gift-designs, /api/gift-cards
// action 'settings'). Turn selling online on, share the link, set the amounts and the rules, and choose which designs from
// the library buyers can pick (all of them until you turn some off). Occasion cards show only in their season by default.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { COLLECTIONS, COLLECTION_NOTE, designsSync, inSeason, DEFAULT_RULES } from '@/lib/gift-designs';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const field = 'h-11 w-full rounded-xl border px-3 text-[15px]';

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
    <span><span className="block text-[15px] font-semibold">{label}</span>{hint && <span className="block text-[13px]" style={{ color: MUTED }}>{hint}</span>}</span>
    <span className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? GREEN : '#d5d6da' }}><span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 24 : 4 }} /></span></button>;
}

export function GiftShopSettings({ tenantId, brand, onClose }: { tenantId: string; brand: { name: string; logo?: string | null; accent?: string | null }; onClose: () => void }) {
  const all = React.useMemo(() => designsSync(), []);
  const [s, setS] = React.useState<any>(null); const [ready, setReady] = React.useState(true);
  const [amounts, setAmounts] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null);
  const [col, setCol] = React.useState<string>('Occasions'); const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { payPost('/api/gift-cards', { tenantId, action: 'settings' }).then((r) => { if (r.ok) { setS({ ...r.settings, designs: r.settings.designs || all.map((d) => d.id) }); setAmounts(r.settings.amounts.join(', ')); setReady(r.paymentsReady); } }); }, [tenantId, all]);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/gift/${tenantId}` : `/gift/${tenantId}`;
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  const toggleDesign = (id: string) => set('designs', s.designs.includes(id) ? s.designs.filter((x: string) => x !== id) : [...s.designs, id]);
  const save = async () => {
    setBusy(true); setMsg(null);
    const nums = amounts.split(/[,\s]+/).map((x) => Number(x.replace(/[^0-9.]/g, ''))).filter((n) => n >= 1);
    const r = await payPost('/api/gift-cards', { tenantId, action: 'settings', save: { ...s, amounts: nums, designs: s.designs.length === all.length ? null : s.designs, rules: s.rules === DEFAULT_RULES ? '' : s.rules } });
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
            <Toggle on={s.custom} onChange={(v) => set('custom', v)} label="Let buyers type their own amount" />
            {s.custom && <div className="grid grid-cols-2 gap-2"><label className="text-[13px]" style={{ color: MUTED }}>Least<input value={s.min} onChange={(e) => set('min', e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label>
              <label className="text-[13px]" style={{ color: MUTED }}>Most<input value={s.max} onChange={(e) => set('max', e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label></div>}
          </section>
          <section className="space-y-2">
            <p className="text-[15px] font-semibold">Rules buyers see</p>
            <textarea value={s.rules} onChange={(e) => set('rules', e.target.value.slice(0, 600))} rows={3} className="w-full rounded-xl border px-3 py-2.5 text-[14.5px] leading-relaxed" style={{ borderColor: LINE }} />
            <p className="text-[12.5px]" style={{ color: MUTED }}>Federal law requires at least five years before a card can expire, and some states (California among them) don’t allow expiry at all. Check with your accountant before changing “Never expires.”</p>
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
