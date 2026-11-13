'use client';
// src/components/shop/IfOutSection.tsx — IF SOMETHING'S OUT, AT CHECKOUT (lib/retail-swap). For each item the customer
// says what they want if it's out when their order is packed: the best match the packer finds, a backup they pick now
// (the same product's other colors first, never dearer than the item), or a refund. Or one choice for every item. A
// backup they pick can be kept for next time on this device. Everything is decided here, so nobody is asked later.
import * as React from 'react';
import { SWAP_HOWS, type SwapHow } from '@/lib/retail-swap';

export type IfOutChoice = { how: SwapHow; backupId?: string; backupName?: string; backupPriceCents?: number; backupImage?: string };
export type IfOutItem = { key: string; productId: string; selections?: Record<string, string>; name: string; label?: string; imageUrl?: string; unitCents: number };

const C = { ink: '#16171a', muted: '#6d7075', line: '#ececee', soft: '#f5f5f7', ok: '#1f7a4d', okSoft: '#eaf6ef', warn: '#b45309', warnSoft: '#fff7ed' };
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const memoKey = (t: string) => `cfshop-backups-${t}`;

/** The backups kept on this device for next time, by product (and its chosen options). */
export function rememberedBackups(tenantId: string): Record<string, IfOutChoice> {
  try { const v = JSON.parse(localStorage.getItem(memoKey(tenantId)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function remember(tenantId: string, key: string, c: IfOutChoice | null) {
  try { const all = rememberedBackups(tenantId); if (c) all[key] = c; else delete all[key]; localStorage.setItem(memoKey(tenantId), JSON.stringify(all)); } catch { /* this device keeps nothing */ }
}

export function IfOutSection({ tenantId, items, perItem, shopDefault, choices, onChoose, orderWide, onOrderWide }: {
  tenantId: string; items: IfOutItem[]; perItem: boolean; shopDefault: 'match' | 'refund';
  choices: Record<string, IfOutChoice>; onChoose: (key: string, c: IfOutChoice | null) => void;
  orderWide: 'match' | 'refund'; onOrderWide: (v: 'match' | 'refund') => void;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!items.length) return null;
  const words = (c: IfOutChoice | undefined) => !c ? `${shopDefault === 'refund' ? 'Refund it' : 'Best match'}` : c.how === 'backup' ? `${c.backupName || 'Your backup'} instead` : c.how === 'match' ? 'Best match' : 'Refund it';
  const setAll = (how: 'match' | 'refund') => { onOrderWide(how); for (const it of items) onChoose(it.key, { how }); setOpen(null); };

  return (
    <section aria-labelledby="ifout-h" className="rounded-[20px] bg-[#fff] p-4" style={{ border: `1px solid ${C.line}`, color: C.ink }}>
      <h2 id="ifout-h" className="m-0 text-[17px] font-semibold tracking-[-0.01em]">If something’s out</h2>
      <p className="m-0 mt-0.5 text-[13.5px]" style={{ color: C.muted }}>A swap never costs more than you paid. Anything owed back comes in one refund once we’ve packed.</p>
      {perItem ? (
        <>
          <ul className="m-0 mt-2 list-none p-0">
            {items.map((it) => (
              <li key={it.key} className="border-b last:border-b-0" style={{ borderColor: C.line }}>
                <div className="flex min-h-[56px] items-center gap-3 py-1.5">
                  {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-[10px] object-cover" /> : <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-[10px]" style={{ background: C.soft }} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{it.name}{it.label ? `, ${it.label}` : ''}</span>
                    <span className="block truncate text-[13px]" style={{ color: C.muted }}>{words(choices[it.key])}</span>
                  </span>
                  <button type="button" aria-expanded={open === it.key} onClick={() => setOpen(open === it.key ? null : it.key)} className="h-11 shrink-0 px-2 text-[14px] font-semibold underline underline-offset-4">{open === it.key ? 'Done' : 'Change'}</button>
                </div>
                {open === it.key && <Picker tenantId={tenantId} item={it} value={choices[it.key]} shopDefault={shopDefault} onChoose={(c, keep) => { onChoose(it.key, c); remember(tenantId, it.key, keep && c?.how === 'backup' ? c : null); }} />}
              </li>))}
          </ul>
          <p className="m-0 mb-2 mt-3 text-[13px] font-semibold" style={{ color: C.muted }}>Or the same for every item</p>
          <div className="flex flex-wrap gap-2">
            {(['match', 'refund'] as const).map((h) => (
              <button key={h} type="button" onClick={() => setAll(h)} className="h-11 rounded-full bg-[#fff] px-4 text-[14px] font-semibold" style={{ border: `1px solid ${C.line}` }}>{h === 'match' ? 'Best match' : 'Refund it'}</button>))}
          </div>
        </>
      ) : (
        <div role="radiogroup" aria-label="If something’s out" className="mt-2 flex flex-col gap-2">
          {(['match', 'refund'] as const).map((h) => {
            const o = SWAP_HOWS.find((x) => x.id === h)!; const on = orderWide === h;
            return (
              <button key={h} type="button" role="radio" aria-checked={on} onClick={() => onOrderWide(h)} className="flex min-h-[52px] items-start gap-3 rounded-2xl bg-[#fff] p-3 text-left" style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}` }}>
                <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full" style={{ border: on ? `6px solid ${C.ink}` : '2px solid #c7c8cc', boxSizing: 'border-box' }} />
                <span><span className="block text-[15px] font-semibold">{o.label}</span><span className="block text-[13px]" style={{ color: C.muted }}>{h === 'match' ? 'We pick one at the same price or less.' : o.note}</span></span>
              </button>);
          })}
        </div>)}
    </section>);
}

function Picker({ tenantId, item, value, shopDefault, onChoose }: { tenantId: string; item: IfOutItem; value?: IfOutChoice; shopDefault: 'match' | 'refund'; onChoose: (c: IfOutChoice | null, keep: boolean) => void }) {
  const how: SwapHow = value?.how || shopDefault;
  const [opts, setOpts] = React.useState<any[] | null>(null);
  const [err, setErr] = React.useState('');
  const [keep, setKeep] = React.useState(true);
  React.useEffect(() => {
    if (how !== 'backup' || opts) return;
    let live = true;
    fetch('/api/retail/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, productId: item.productId, selections: item.selections }) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d }))).then(({ ok, d }) => { if (!live) return; if (!ok) { setErr(d?.error || 'Backups couldn’t be loaded.'); setOpts([]); } else setOpts(Array.isArray(d.options) ? d.options : []); })
      .catch(() => { if (live) { setErr('Backups couldn’t be loaded.'); setOpts([]); } });
    return () => { live = false; };
  }, [how, opts, tenantId, item.productId, item.selections]);
  const pick = (o: any) => onChoose({ how: 'backup', backupId: o.productId, backupName: o.name, backupPriceCents: o.unitPriceCents, ...(o.imageUrl ? { backupImage: o.imageUrl } : {}) }, keep);
  const same = (opts || []).filter((o) => o.sameProduct); const like = (opts || []).filter((o) => !o.sameProduct);
  const tile = (o: any) => {
    const on = value?.backupId === o.productId; const less = item.unitCents - o.unitPriceCents;
    return (
      <button key={o.productId} type="button" aria-pressed={on} onClick={() => pick(o)} className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] bg-[#fff] px-2.5 py-1.5 text-left" style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}` }}>
        {o.imageUrl ? <img src={o.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-[10px] object-cover" /> : <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-[10px]" style={{ background: C.soft }} />}
        <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{o.name}</span>
          <span className="block text-[12.5px]" style={{ color: C.muted }}>{money(o.unitPriceCents)}{less > 0 ? ` · ${money(less)} less each, back to you if we swap` : ''}</span></span>
      </button>);
  };
  return (
    <div className="mb-3 flex flex-col gap-2 pl-12">
      <div role="radiogroup" aria-label={`If ${item.name} is out`} className="flex flex-col gap-2">
        {SWAP_HOWS.map((o) => {
          const on = how === o.id;
          return (
            <div key={o.id} className="rounded-2xl" style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: on ? 11 : 12 }}>
              <button type="button" role="radio" aria-checked={on} onClick={() => { if (o.id !== 'backup') onChoose({ how: o.id }, false); else onChoose({ how: 'backup' }, false); }} className="flex min-h-[44px] w-full items-start gap-3 text-left">
                <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full" style={{ border: on ? `6px solid ${C.ink}` : '2px solid #c7c8cc', boxSizing: 'border-box' }} />
                <span><span className="block text-[15px] font-semibold">{o.label}</span><span className="block text-[13px]" style={{ color: C.muted }}>{o.note}</span></span>
              </button>
              {on && o.id === 'backup' && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {opts === null ? <p className="m-0 text-[13px]" style={{ color: C.muted }}>Finding backups…</p>
                    : !opts.length ? <p className="m-0 text-[13px]" style={{ color: err ? C.warn : C.muted }}>{err || 'Nothing in stock at the same price or less right now. Best match or a refund still works.'}</p>
                    : <>
                      {same.length > 0 && <p className="m-0 text-[13px] font-semibold" style={{ color: C.muted }}>Other colors of this one</p>}
                      {same.map(tile)}
                      {like.length > 0 && <p className="m-0 mt-1 text-[13px] font-semibold" style={{ color: C.muted }}>Similar</p>}
                      {like.map(tile)}
                      <label className="mt-1 flex min-h-[44px] items-center gap-3 text-[14px]">
                        <input type="checkbox" checked={keep} onChange={(e) => { setKeep(e.target.checked); if (value?.backupId) onChoose(value, e.target.checked); }} className="h-5 w-5" style={{ accentColor: C.ink }} />
                        Use this backup next time too
                      </label>
                    </>}
                  {value?.how === 'backup' && !value.backupId && opts && opts.length > 0 && <p role="status" className="m-0 text-[13px]" style={{ color: C.warn }}>Pick one, or choose Best match.</p>}
                </div>)}
            </div>);
        })}
      </div>
    </div>);
}
