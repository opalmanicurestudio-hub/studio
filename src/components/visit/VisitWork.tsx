'use client';
// src/components/visit/VisitWork.tsx — THE WORK OF A VISIT, where it's needed.
//   LastFormula   — Now tab: what was actually used last time (the last finished visit's formula, else the client's
//                   newest saved formula), with "Use again" → becomes this visit's formula, so the hand-off review opens
//                   pre-filled
//   PartsPlan     — Now tab: each part of a multi-part visit, who does it, which is done, which is on now, who's next
//   AddAsYouGo    — Now tab: note a product as it's used (adds to this visit's formula; the review opens with it)
//   ThisVisit     — Service tab: this visit's formula so far / as recorded at the hand-off
// Everything writes to appointment.checkoutState.formula — the same field the hand-off review reads and saves.
import * as React from 'react';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const safe = (v: any) => new Date(v?.toDate ? v.toDate() : v);
export type FormulaItem = { id: string; name: string; quantity: number; unit: string; costPerUnit: number; note?: string };
const card = { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' } as React.CSSProperties;
const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
const qty = (i: FormulaItem) => `${Math.round(n(i.quantity) * 100) / 100} ${i.unit || ''}`.trim();

/** The service recipe as formula items (what the review starts from when nothing's recorded yet). */
export function recipeFormula(service: any, inventory: any[]): FormulaItem[] {
  return (service?.products || []).map((p: any) => { const it = inventory.find((x) => x.id === (p.id || p.productId)); let cpu = n(it?.costPerUnit);
    if (it?.costingMethod === 'size' && n(it.size) > 0) cpu = n(it.costPerUnit) / n(it.size); else if (it?.costingMethod === 'uses' && n(it.estimatedUses) > 0) cpu = n(it.costPerUnit) / n(it.estimatedUses);
    return { id: p.id || p.productId, name: p.name || it?.name || 'Product', quantity: n(p.quantityUsed) || 1, unit: it?.costingMethod === 'uses' ? (it.useUnit || 'uses') : (it?.useUnit || it?.unit || 'unit'), costPerUnit: cpu, note: '' }; });
}
export function lastFormulaFor(appointment: any, client: any, allAppointments: any[]): { items: FormulaItem[]; date: string | null; from: 'visit' | 'saved' } | null {
  const prev = (allAppointments || []).filter((a) => a.clientId === appointment.clientId && a.id !== appointment.id && a.status === 'completed' && Array.isArray(a.checkoutState?.formula) && a.checkoutState.formula.length)
    .sort((a, b) => safe(b.startTime).getTime() - safe(a.startTime).getTime())[0];
  if (prev) return { items: prev.checkoutState.formula, date: String(prev.startTime?.toDate ? prev.startTime.toDate().toISOString() : prev.startTime), from: 'visit' };
  const saved = [...(client?.customFormulas || [])].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))[0];
  return saved?.items?.length ? { items: saved.items, date: saved.date || null, from: 'saved' } : null;
}

export function LastFormula({ appointment, client, allAppointments, onUse }: { appointment: any; client: any; allAppointments: any[]; onUse: (items: FormulaItem[]) => void }) {
  const last = lastFormulaFor(appointment, client, allAppointments); if (!last) return null;
  const inUse = JSON.stringify((appointment.checkoutState?.formula || []).map((i: any) => [i.id, i.quantity])) === JSON.stringify(last.items.map((i) => [i.id, i.quantity]));
  return (
    <section className="space-y-2 rounded-2xl p-4" style={card} aria-label="Last formula">
      <div className="flex items-baseline justify-between gap-3"><p className="text-[14px] font-semibold">Last formula{last.date ? <span className="font-normal" style={muted}> · {new Date(last.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{last.from === 'saved' ? ' (saved)' : ''}</span> : null}</p>
        {inUse ? <span className="text-[13px] font-semibold" style={{ color: 'var(--ok, #15803d)' }}>Using it ✓</span> : <button type="button" onClick={() => onUse(last.items)} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>Use again</button>}</div>
      <p className="text-[14px]">{last.items.map((i) => `${i.name} ${qty(i)}${i.note ? ` (${i.note})` : ''}`).join(' · ')}</p>
    </section>);
}

export function PartsPlan({ appointment, service, allServices, staff }: { appointment: any; service: any; allServices: any[]; staff: any[] }) {
  const cs = appointment.checkoutState || {}; const addOns: any[] = cs.addOns || (appointment.addOnIds || []).map((id: string) => allServices.find((s) => s.id === id)).filter(Boolean);
  const parts = [service, ...addOns].filter(Boolean); if (parts.length < 2) return null;
  const over: Record<string, string> = cs.serviceStaffOverrides || {}; const done = new Set<string>(cs.completedServiceIds || []);
  const who = (p: any) => staff.find((s) => s.id === (over[p.id] || appointment.staffId))?.name || '—';
  const onNow = parts.find((p) => !done.has(p.id)); const after = onNow ? parts.slice(parts.indexOf(onNow) + 1).find((p) => !done.has(p.id)) : null;
  return (
    <section className="space-y-2 rounded-2xl p-4" style={card} aria-label="Parts of this visit">
      <p className="text-[14px] font-semibold">Parts · {done.size} of {parts.length} done{onNow && after && who(after) !== who(onNow) ? <span className="font-normal" style={muted}> · next: {who(after)} for {after.name}</span> : null}</p>
      {parts.map((p, i) => (<div key={p.id + i} className="flex items-center justify-between gap-3 border-t pt-2 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
        <span>{i + 1}. {p.name} <span style={muted}>· {who(p)}</span></span>
        <span className="text-[13px] font-semibold" style={{ color: done.has(p.id) ? 'var(--ok, #15803d)' : p === onNow ? 'var(--accent)' : 'var(--muted, #6b635c)' }}>{done.has(p.id) ? 'Done ✓' : p === onNow ? (appointment.status === 'servicing' ? 'On now' : 'First') : 'Waiting'}</span>
      </div>))}
    </section>);
}

export function AddAsYouGo({ inventory, onAdd }: { inventory: any[]; onAdd: (productId: string, quantity: number) => void }) {
  const [open, setOpen] = React.useState(false); const [q, setQ] = React.useState(''); const [pick, setPick] = React.useState<any>(null); const [amount, setAmount] = React.useState('1');
  const list = React.useMemo(() => inventory.filter((i) => i.type === 'professional' || i.type === 'retail').filter((i) => !q || String(i.name).toLowerCase().includes(q.toLowerCase())).slice(0, 8), [inventory, q]);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>+ Add a product used</button>;
  return (
    <section className="space-y-2 rounded-2xl p-4" style={card} aria-label="Add a product used">
      <p className="text-[14px] font-semibold">Add a product used <span className="font-normal" style={muted}>· goes into this visit's formula</span></p>
      {!pick ? <>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
        <div className="flex flex-wrap gap-2">{list.map((i) => <button key={i.id} type="button" onClick={() => setPick(i)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>{i.name}</button>)}{!list.length && <span className="text-[13px]" style={muted}>No match.</span>}</div>
      </> : <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <b>{pick.name}</b><input type="number" min={0} step={0.1} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" className="h-10 w-20 rounded-xl border px-2 text-right" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
        <span style={muted}>{pick.costingMethod === 'uses' ? (pick.useUnit || 'uses') : pick.useUnit || pick.unit || 'unit'}</span>
        <button type="button" onClick={() => { const v = n(amount); if (v > 0) { onAdd(pick.id, v); setPick(null); setQ(''); setAmount('1'); setOpen(false); } }} className="h-10 rounded-full px-4 font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>Add</button>
        <button type="button" onClick={() => setPick(null)} className="h-10 rounded-full px-3" style={muted}>Back</button></div>}
      <button type="button" onClick={() => { setOpen(false); setPick(null); }} className="text-[13px] underline underline-offset-2" style={muted}>Close</button>
    </section>);
}

export function ThisVisitFormula({ appointment, onClear }: { appointment: any; onClear?: () => void }) {
  const f: FormulaItem[] = appointment.checkoutState?.formula || []; const recorded = ['ready_for_checkout', 'completed'].includes(String(appointment.status));
  return (
    <section className="space-y-2 rounded-2xl p-4" style={card} aria-label="This visit's formula">
      <p className="text-[14px] font-semibold">This visit's formula <span className="font-normal" style={muted}>· {f.length ? (recorded ? 'as recorded at the hand-off' : 'so far — the hand-off review opens with this') : 'nothing recorded yet — the service recipe is used until it is'}</span></p>
      {f.map((i, k) => <div key={i.id + k} className="flex justify-between gap-3 border-t pt-2 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }}><span>{i.name}{i.note ? <span style={muted}> · {i.note}</span> : null}</span><span>{qty(i)}</span></div>)}
      {f.length > 0 && !recorded && onClear && <button type="button" onClick={onClear} className="text-[13px] underline underline-offset-2" style={muted}>Start again from the recipe</button>}
    </section>);
}

/** Add to a formula (same product → quantities add up). */
export function addToFormula(base: FormulaItem[], item: any, quantity: number): FormulaItem[] {
  const out = base.map((x) => ({ ...x })); const i = out.findIndex((x) => x.id === item.id);
  let cpu = n(item.costPerUnit); if (item.costingMethod === 'size' && n(item.size) > 0) cpu = n(item.costPerUnit) / n(item.size); else if (item.costingMethod === 'uses' && n(item.estimatedUses) > 0) cpu = n(item.costPerUnit) / n(item.estimatedUses);
  if (i >= 0) out[i].quantity = Math.round((n(out[i].quantity) + quantity) * 100) / 100;
  else out.push({ id: item.id, name: item.name || 'Product', quantity, unit: item.costingMethod === 'uses' ? (item.useUnit || 'uses') : (item.useUnit || item.unit || 'unit'), costPerUnit: cpu, note: 'added during the visit' });
  return out;
}

/** Money tab: this visit's charges and the agreement each rests on (fees, extra time, extra product, card on file). */
export function VisitCharges({ tenantId, appointmentId }: { tenantId: string; appointmentId: string }) {
  const [rows, setRows] = React.useState<any[] | null>(null);
  React.useEffect(() => { let on = true; (async () => { try { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    const r: any = await fetch('/api/desk/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'visit-charges', appointmentId }) }).then((x) => x.json()).catch(() => null);
    if (on) setRows(r?.ok ? r.charges : []); } catch { if (on) setRows([]); } })(); return () => { on = false; }; }, [tenantId, appointmentId]);
  if (!rows || !rows.length) return null;
  return (
    <section className="space-y-2 rounded-2xl p-4" style={card} aria-label="Charges on this visit">
      <p className="text-[14px] font-semibold">Charges on this visit <span className="font-normal" style={muted}>· and what each rests on</span></p>
      {rows.map((c) => (<div key={c.id} className="border-t pt-2 text-[13px]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
        <p><b>${(n(c.cents) / 100).toFixed(2)}</b> · {String(c.kind).replace(/_/g, ' ')} · {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{c.approvedBy ? ` · approved by ${c.approvedBy}` : ''}</p>
        <p style={muted}>{c.reason}{c.basis.length ? ` · agreed: ${c.basis.join('; ')}` : ''}{c.missing.length ? <span style={{ color: 'var(--warn, #b45309)' }}> · no record of agreeing to {c.missing.map((m: string) => m.replace(/_/g, ' ')).join(', ')}</span> : null}</p></div>))}
    </section>);
}

/** History tab: every hand-off — the parts finished, by whom, to whom (or the desk), when, and the note left. */
export function HandoffLog({ appointment, staff, allServices }: { appointment: any; staff: any[]; allServices: any[] }) {
  const rows: any[] = [...(appointment.handoffs || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))); if (!rows.length) return null;
  const nm = (id: string | null) => (id && staff.find((s) => s.id === id)?.name) || 'someone';
  const part = (id: string) => allServices.find((s) => s.id === id)?.name || 'a part';
  return (
    <section className="space-y-2 rounded-2xl p-4" style={card} aria-label="Hand-offs">
      <p className="text-[14px] font-semibold">Hand-offs</p>
      {rows.map((h, i) => (<div key={i} className="border-t pt-2 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
        <p><span style={muted}>{new Date(h.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · </span><b>{nm(h.fromStaffId)}</b>{h.partsDone?.length ? ` finished ${h.partsDone.map(part).join(', ')}` : ''} → {h.toDesk ? <b>the desk</b> : <b>{nm(h.toStaffId)}</b>}</p>
        {h.note && <p className="text-[13px]" style={muted}>“{h.note}”</p>}</div>))}
    </section>);
}
