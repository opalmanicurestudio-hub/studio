'use client';
// src/components/gift/GiftBulkDrawer.tsx — COMPANY ORDERS on the Gift cards page (lib/gift-bulk): many cards for one buyer.
// Paste the list from a spreadsheet (or open a CSV), choose the design, note and send day, then send the invoice — or mark
// it paid when a check or transfer comes in. Cards are made only once it's paid.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { designsSync, inSeason } from '@/lib/gift-designs';
import { parseList, totals, checkRow, type BulkRow } from '@/lib/gift-bulk-list';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const field = 'h-11 w-full rounded-xl border px-3 text-[15px]';
const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const STATUS: Record<string, [string, string]> = { requested: ['Asked online', AMBER], draft: ['Draft', MUTED], invoiced: ['Invoice sent', AMBER], paid: ['Paid — some cards need a look', RED], issued: ['Paid · cards made', GREEN] };
const pad = (n: number) => String(n).padStart(2, '0');

export function GiftBulkDrawer({ tenantId, brand, onClose }: { tenantId: string; brand: { name: string; logo?: string | null; accent?: string | null }; onClose: () => void }) {
  const [orders, setOrders] = React.useState<any[] | null>(null); const [o, setO] = React.useState<any>(null);
  const [paste, setPaste] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [paidVia, setPaidVia] = React.useState<string | null>(null);
  const load = React.useCallback(() => payPost('/api/gift-cards', { tenantId, action: 'bulk-list' }).then((r) => setOrders(r.ok ? r.orders : [])), [tenantId]);
  React.useEffect(() => { load(); }, [load]);
  const designs = React.useMemo(() => designsSync().filter((d) => inSeason(d)), []);
  const set = (k: string, v: any) => setO((x: any) => ({ ...x, [k]: v }));
  const def = Math.round(Number(o?.defaultAmount) * 100) || 5000;
  const rows: BulkRow[] = o?.rows || []; const tt = totals(rows);
  const open = (x: any) => { const at = x.sendAt ? new Date(x.sendAt) : null; setMsg(null); setPaidVia(null); setPaste('');
    setO({ ...x, defaultAmount: (x.defaultCents || 5000) / 100, day: at ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` : '', time: at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '09:00' }); };
  const fresh = () => open({ company: '', contactName: '', contactEmail: '', design: 'frost', line: 'THANK YOU', message: '', rows: [], defaultCents: 5000, status: 'draft' });
  const addPasted = (text: string) => { const add = parseList(text, def); if (!add.length) { setMsg({ ok: false, t: 'Nothing to add — one person per line: name, email or mobile, amount (optional).' }); return; } set('rows', [...rows, ...add].slice(0, 500)); setPaste(''); setMsg(null); };
  const file = async (f: File | undefined) => { if (!f) return; if (!/\.(csv|txt|tsv)$/i.test(f.name)) { setMsg({ ok: false, t: 'Save the spreadsheet as CSV first, or copy the rows and paste them.' }); return; } addPasted(await f.text()); };
  const body = () => ({ ...o, rows: rows.map((r) => ({ name: r.name, contact: r.email || r.phone || r.raw || '', cents: r.cents })), sendAt: o.day ? new Date(`${o.day}T${o.time || '09:00'}:00`).toISOString() : null });
  const save = async () => { setBusy(true); setMsg(null); const r = await payPost('/api/gift-cards', { tenantId, action: 'bulk-save', order: body() }); setBusy(false);
    if (!r.ok) { setMsg({ ok: false, t: r.error || 'That didn’t save.' }); return null; } open(r.order); load(); setMsg({ ok: true, t: 'Saved.' }); return r.order; };
  const send = async () => { const saved = await save(); if (!saved) return; setBusy(true); const r = await payPost('/api/gift-cards', { tenantId, action: 'bulk-send', id: saved.id }); setBusy(false);
    setMsg({ ok: !!r.ok, t: r.ok ? `Invoice sent to ${saved.contactEmail}.` : r.error || 'It didn’t send.' }); load(); if (r.ok) setO((x: any) => ({ ...x, status: 'invoiced' })); };
  const markPaid = async (via: string) => { const saved = o.id && o.status !== 'requested' ? o : await save(); if (!saved?.id) return; setBusy(true); const r = await payPost('/api/gift-cards', { tenantId, action: 'bulk-paid', id: saved.id, via }); setBusy(false); setPaidVia(null);
    setMsg({ ok: !!r.ok, t: r.ok ? `Paid — ${r.made} card${r.made === 1 ? '' : 's'} made${r.failed ? `, ${r.failed} need a look` : ''}.` : r.error || 'That didn’t work.' }); load(); if (r.ok) setO(null); };
  const cancel = async () => { if (!o.id) { setO(null); return; } const r = await payPost('/api/gift-cards', { tenantId, action: 'bulk-cancel', id: o.id }); if (r.ok) { setO(null); load(); } else setMsg({ ok: false, t: r.error }); };
  const locked = o && ['paid', 'issued'].includes(o.status);
  const dz = designs.find((d) => d.id === o?.design) || designs[0];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Company orders">
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.2)' }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-white" style={{ color: INK }}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-6 py-4 backdrop-blur" style={{ borderColor: LINE }}>
          <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>gift cards</p><p className="text-[22px] font-normal tracking-[-0.02em]">{o ? (o.company || 'New company order') : 'Company orders'}</p></div>
          <button type="button" onClick={o ? () => setO(null) : onClose} className="text-[15px] font-semibold" style={{ color: MUTED }}>{o ? '‹ All orders' : '×'}</button></div>

        {!o ? <div className="space-y-4 p-6">
          <p className="text-[14px]" style={{ color: MUTED }}>A company buying cards for its team or clients: one list, one invoice, and each person gets their own card on the day you choose.</p>
          <button type="button" onClick={fresh} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-white" style={{ background: INK }}>New company order</button>
          {orders === null ? <p style={{ color: MUTED }}>Loading…</p> : orders.length === 0 ? <p className="rounded-2xl p-4 text-[14px]" style={{ background: SOFT, color: MUTED }}>No company orders yet. Companies can also ask from your gift card page (“Buying for a team?”).</p>
            : <div className="rounded-[18px]" style={{ border: `1px solid ${LINE}` }}>{orders.map((x, i) => (
              <button key={x.id} type="button" onClick={() => open(x)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{x.company}</span><span className="block text-[13px]" style={{ color: MUTED }}>{x.status === 'requested' ? `Asked for ${x.askedCount || '?'} · ${x.contactName || ''}` : `${x.count} card${x.count === 1 ? '' : 's'} · ${$(x.totalCents || 0)}${x.sendAt ? ` · sends ${new Date(x.sendAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`}</span></span>
                <span className="shrink-0 text-[12.5px] font-semibold" style={{ color: (STATUS[x.status] || STATUS.draft)[1] }}>{(STATUS[x.status] || STATUS.draft)[0]}</span></button>))}</div>}
        </div> : <div className="space-y-5 p-6">
          {o.status === 'requested' && <div className="rounded-2xl p-4 text-[14px]" style={{ background: '#fdf3e6' }}><b>Asked online</b> — about {o.askedCount} card{o.askedCount === 1 ? '' : 's'}{o.defaultCents ? ` at ${$(o.defaultCents)} each` : ''}.{o.note ? <> “{o.note}”</> : null} Add their list (ask them for it), then send the invoice.</div>}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input disabled={locked} value={o.company || ''} onChange={(e) => set('company', e.target.value)} placeholder="Company" aria-label="Company" className={field} style={{ borderColor: LINE }} />
            <input disabled={locked} value={o.contactName || ''} onChange={(e) => set('contactName', e.target.value)} placeholder="Contact name" aria-label="Contact name" className={field} style={{ borderColor: LINE }} />
            <input disabled={locked} value={o.contactEmail || ''} onChange={(e) => set('contactEmail', e.target.value)} inputMode="email" placeholder="Invoice email" aria-label="Invoice email" className={field} style={{ borderColor: LINE }} />
          </section>
          <section className="flex flex-col gap-4 sm:flex-row">
            <div className="shrink-0"><GiftCardFace design={dz} brand={brand} amount={$(rows[0]?.cents || def)} name={rows[0]?.name || 'Their name'} line={o.line || ''} width={240} /></div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{designs.slice(0, 30).map((d) => <button key={d.id} type="button" disabled={locked} aria-pressed={o.design === d.id} aria-label={d.name} onClick={() => set('design', d.id)} className="shrink-0 rounded-[8px] p-[2px]" style={{ outline: o.design === d.id ? `2px solid ${INK}` : 'none' }}><GiftCardFace design={d} brand={brand} amount="" name=" " width={74} /></button>)}</div>
              <input disabled={locked} value={o.line || ''} onChange={(e) => set('line', e.target.value.slice(0, 30))} placeholder="Line on the card (e.g. THANK YOU)" aria-label="Line on the card" className={field} style={{ borderColor: LINE }} />
              <textarea disabled={locked} value={o.message || ''} onChange={(e) => set('message', e.target.value.slice(0, 400))} rows={2} placeholder={`A note from ${o.company || 'the company'} (optional)`} className="w-full rounded-xl border px-3 py-2 text-[15px]" style={{ borderColor: LINE }} />
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                <label className="text-[12.5px] font-semibold" style={{ color: MUTED }}>Each, unless listed<input disabled={locked} value={o.defaultAmount ?? ''} onChange={(e) => set('defaultAmount', e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label>
                <label className="text-[12.5px] font-semibold" style={{ color: MUTED }}>Send on<input disabled={locked} type="date" value={o.day || ''} onChange={(e) => set('day', e.target.value)} className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label>
                <label className="text-[12.5px] font-semibold" style={{ color: MUTED }}>At<input disabled={locked} type="time" value={o.time || '09:00'} onChange={(e) => set('time', e.target.value)} className={`${field} mt-1`} style={{ borderColor: LINE, color: INK }} /></label>
              </div>
              <p className="text-[12.5px]" style={{ color: MUTED }}>{o.day ? 'Each card is emailed or texted that morning.' : 'No day chosen — the cards go out as soon as it’s paid.'}</p>
            </div>
          </section>

          <section className="rounded-[18px]" style={{ border: `1px solid ${LINE}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><b className="text-[15px]">{rows.length} {rows.length === 1 ? 'person' : 'people'}</b>
              {!locked && <label className="inline-flex h-9 cursor-pointer items-center rounded-full px-3.5 text-[13.5px] font-semibold" style={{ background: SOFT }}>Open a CSV<input type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={(e) => file(e.target.files?.[0])} /></label>}</div>
            {!locked && <div className="space-y-2 px-4 pb-3"><textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder={'Paste from a spreadsheet — one person per line:\nAna Ruiz, ana@acme.co, 75\nBen Ortiz, (713) 555-0142'} className="w-full rounded-xl border px-3 py-2 font-mono text-[13px]" style={{ borderColor: LINE }} />
              {paste.trim() && <button type="button" onClick={() => addPasted(paste)} className="h-9 rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>Add to the list</button>}</div>}
            {rows.length > 0 && <div className="max-h-[360px] overflow-y-auto">{rows.map((r, i) => (
              <div key={`${i}:${r.email || r.phone || r.raw || ''}:${r.cents}`} className="grid grid-cols-[1.2fr_1.6fr_80px_170px] items-center gap-2 px-4 py-2 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}>
                <input disabled={locked} value={r.name} onChange={(e) => set('rows', rows.map((x, j) => (j === i ? checkRow({ name: e.target.value, contact: x.email || x.phone || x.raw || '', amount: x.cents / 100 }, def) : x)))} aria-label="Name" className="h-9 min-w-0 rounded-lg border px-2" style={{ borderColor: r.problem === 'Add a name' ? RED : LINE }} />
                <input disabled={locked} defaultValue={r.email || r.phone || r.raw || ''} onBlur={(e) => set('rows', rows.map((x, j) => (j === i ? checkRow({ name: x.name, contact: e.target.value, amount: x.cents / 100 }, def) : x)))} aria-label="Email or mobile" className="h-9 min-w-0 rounded-lg border px-2" style={{ borderColor: r.problem && r.problem !== 'Add a name' ? RED : LINE }} />
                <input disabled={locked} defaultValue={String(r.cents / 100)} onBlur={(e) => set('rows', rows.map((x, j) => (j === i ? checkRow({ name: x.name, contact: x.email || x.phone || x.raw || '', amount: e.target.value }, def) : x)))} inputMode="decimal" aria-label="Amount" className="h-9 min-w-0 rounded-lg border px-2 text-right" style={{ borderColor: LINE }} />
                <span className="flex items-center justify-between gap-2 text-[12px] font-semibold" style={{ color: r.problem ? AMBER : GREEN }}>{r.cardId ? 'Made' : r.problem || '✓'}{!locked && <button type="button" onClick={() => set('rows', rows.filter((_, j) => j !== i))} aria-label="Remove" className="text-[15px]" style={{ color: MUTED }}>×</button>}</span>
              </div>))}</div>}
          </section>

          <section className="space-y-3 rounded-[18px] p-4" style={{ background: SOFT }}>
            <div className="flex items-baseline justify-between"><span className="text-[15px]">{tt.count} gift card{tt.count === 1 ? '' : 's'}{tt.problems ? <span style={{ color: AMBER }}> · {tt.problems} need a look</span> : null}</span><span className="text-[26px] font-normal tracking-[-0.02em]">{$(tt.totalCents)}</span></div>
            {msg && <p className="text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : RED }} role="status">{msg.t}</p>}
            {locked ? <p className="text-[14px]">Paid{o.paidVia ? ` (${o.paidVia})` : ''}. {o.status === 'issued' ? 'Every card was made.' : `${o.failed || 0} card${o.failed === 1 ? '' : 's'} couldn’t be made — make ${o.failed === 1 ? 'it' : 'them'} from the gift card list.`}</p>
              : <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !tt.count || !!tt.problems || !o.contactEmail} onClick={send} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{o.status === 'invoiced' ? 'Send the invoice again' : 'Send the invoice'}</button>
                <button type="button" disabled={busy} onClick={save} className="h-11 rounded-full px-5 text-[14.5px] font-semibold" style={{ background: '#fff', border: `1px solid ${LINE}` }}>Save</button>
                {paidVia === null ? <button type="button" disabled={busy || !tt.count || !!tt.problems} onClick={() => setPaidVia('')} className="h-11 rounded-full px-4 text-[14px] font-semibold underline underline-offset-4 disabled:opacity-40">They paid another way</button>
                  : <span className="flex flex-wrap items-center gap-1.5">{[['check', 'Check'], ['transfer', 'Bank transfer'], ['cash', 'Cash'], ['card', 'Card at the desk']].map(([k, l]) => <button key={k} type="button" disabled={busy} onClick={() => markPaid(k)} className="h-10 rounded-full px-3.5 text-[13.5px] font-semibold" style={{ background: '#fff', border: `1px solid ${LINE}` }}>{l}</button>)}</span>}
              </div>}
            {!locked && <p className="text-[12.5px]" style={{ color: MUTED }}>The cards are made only once it’s paid. “They paid another way” makes and sends them now and records the money.</p>}
          </section>
          {!locked && <button type="button" onClick={cancel} className="text-[13.5px] underline underline-offset-4" style={{ color: MUTED }}>{o.id ? 'Cancel this order' : 'Discard'}</button>}
        </div>}
      </div>
    </div>);
}
