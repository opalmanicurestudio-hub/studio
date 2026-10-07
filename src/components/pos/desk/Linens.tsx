'use client';
// src/components/pos/desk/Linens.tsx — LINENS & LAUNDRY (O6): how many of each are clean, dirty and in the wash; whether
// there are enough clean ones for the rest of today; start and finish wash loads. Used linens move to dirty on their own
// when a visit finishes. Every change is on the audit log; damaged ones come off inventory when the type is linked.
import * as React from 'react';
import { doc, updateDoc, setDoc, collection, runTransaction } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { logAuditClient } from '@/lib/audit-client';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { stageOf } from '@/lib/visit';
import { moveLinen, linenOutlook, linensNeeded, linenTotal, LINEN_MOVE_LABEL, type Linen, type LinenMove } from '@/lib/linens';

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function Linens({ tenantId, services, appts = [], inventory = [], manager }: { tenantId: string; services: any[]; appts?: any[]; inventory?: any[]; manager: boolean }) {
  const { firestore } = useFirebase();
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'linens') : null), [firestore, tenantId]);
  const { data: linensRaw } = useCollection<any>(q);
  const linens: Linen[] = React.useMemo(() => [...(linensRaw || [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [linensRaw]);
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [other, setOther] = React.useState<string | null>(null); const [qty, setQty] = React.useState(1); const [what, setWhat] = React.useState<LinenMove>('use');
  const [adding, setAdding] = React.useState(false); const [name, setName] = React.useState(''); const [count, setCount] = React.useState(12); const [par, setPar] = React.useState(0); const [invId, setInvId] = React.useState('');
  // Visits still to come today or under way (their linens haven't been counted as used yet).
  const ahead = React.useMemo(() => (appts || []).filter((a: any) => ['booked', 'waiting', 'in_service'].includes(stageOf(a)) && !a.linensCounted).map((a: any) => ({ ...a, startTime: typeof a.startTime === 'string' ? a.startTime : a.startTime?.toDate ? a.startTime.toDate().toISOString() : new Date(a.startTime).toISOString() })), [appts]);
  const outlook = React.useMemo(() => linenOutlook(linens, ahead, services), [linens, ahead, services]);
  const typeNames = React.useMemo(() => Array.from(new Set((services || []).flatMap((s: any) => linensNeeded(s).map((n) => n.name)))).sort(), [services]);
  const supplies = React.useMemo(() => (inventory || []).filter((i: any) => i && i.archived !== true && (i.type === 'equipment' || i.type === 'overhead' || i.type === 'professional')).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [inventory]);
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who(), role: manager ? 'manager' : 'staff' });
  if (!firestore) return null;

  const apply = async (l: Linen, move: LinenMove, n: number) => {
    const res = moveLinen(l, move, n); if (!res.moved) { setMsg({ ok: false, text: 'Nothing to move.' }); return; }
    setBusy(l.id);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), { clean: res.clean, dirty: res.dirty, washing: res.washing, by: who(), at: new Date().toISOString() });
      void logAuditClient(firestore, tenantId, { action: `linen.${move}`, targetType: 'linen', targetId: l.id, actor: actor(), before: { clean: l.clean, dirty: l.dirty, washing: l.washing }, after: { clean: res.clean, dirty: res.dirty, washing: res.washing }, summary: `${l.name}: ${LINEN_MOVE_LABEL[move]} × ${res.moved}` });
      // Damaged linens come off inventory, with a stock movement.
      if ((move === 'damaged_clean' || move === 'damaged_dirty') && l.inventoryItemId) { try { await runTransaction(firestore, async (txn: any) => { const ref = doc(firestore, 'tenants', tenantId, 'inventory', l.inventoryItemId as string); const snap = await txn.get(ref); if (!snap.exists()) return;
          txn.update(ref, { totalStock: Math.max(0, (Number(snap.data()?.totalStock) || 0) - res.moved) });
          txn.set(doc(collection(firestore, 'tenants', tenantId, 'stockMovements')), { id: `mv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, productId: ref.id, productName: snap.data()?.name || l.name, qty: res.moved, from: 'linens', to: 'damaged', kind: 'adjust', actorId: getAuth().currentUser?.uid || null, actorName: who(), at: new Date().toISOString(), note: 'Linen damaged' }); }); } catch { /* counts are right; stock can be corrected in Inventory */ } }
      setMsg({ ok: true, text: `${l.name}: ${LINEN_MOVE_LABEL[move].toLowerCase()} × ${res.moved}` }); setOther(null); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };
  const add = async () => { const nm = name.trim().slice(0, 60); if (!nm) return; setBusy('add'); const inv: any = supplies.find((i: any) => i.id === invId) || null;
    try { const ref = doc(collection(firestore, 'tenants', tenantId, 'linens')); const at = new Date().toISOString(); const c = Math.max(0, Math.round(count) || 0);
      await setDoc(ref, { id: ref.id, name: nm, clean: c, dirty: 0, washing: 0, par: Math.max(0, Math.round(par) || 0) || null, inventoryItemId: inv?.id || null, inventoryName: inv?.name || null, by: who(), at, createdAt: at });
      void logAuditClient(firestore, tenantId, { action: 'linen.added', targetType: 'linen', targetId: ref.id, actor: actor(), after: { clean: c }, summary: `Added linen type ${nm} × ${c}${inv ? ` (inventory: ${inv.name})` : ''}` });
      setAdding(false); setName(''); setCount(12); setPar(0); setInvId(''); setMsg({ ok: true, text: `Added ${nm}.` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };

  return (
    <div className="space-y-3">
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {!linens.length && <p className="text-[14px] text-muted-foreground">No linens yet. {manager ? 'Add towels, capes or robes and the desk will tell you if there are enough clean ones for the rest of the day.' : 'A manager can add them here.'}</p>}
      {linens.map((l) => { const o = outlook.find((x) => x.id === l.id); const own = l.inventoryItemId ? Number((inventory || []).find((i: any) => i.id === l.inventoryItemId)?.totalStock) : NaN; return (
        <div key={l.id} className="rounded-2xl border bg-card p-3">
          <p className="text-[15px] font-semibold">{l.name}</p>
          <p className="text-[13px] text-muted-foreground"><b className="text-foreground">{l.clean} clean</b> · {l.dirty} dirty · {l.washing} in the wash</p>
          {o && (o.short > 0
            ? <p className="text-[13px] font-semibold text-red-700">Short by {o.short} for the rest of today{o.runsOutAt ? ` — runs out at the ${clock(o.runsOutAt)} visit` : ''}{l.dirty + l.washing > 0 ? '. Wash a load before then.' : '.'}</p>
            : o.needed > 0 ? <p className="text-[13px] text-emerald-700">Enough for the rest of today (needs {o.needed}).</p> : null)}
          {o?.belowPar && !o.short && <p className="text-[13px] text-amber-800">Below your usual {l.par} clean.</p>}
          {Number.isFinite(own) && own !== linenTotal(l) && <p className="text-[13px] text-amber-800">Inventory says {own} owned; {linenTotal(l)} counted here.</p>}
          {other === l.id ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={what} onChange={(e) => setWhat(e.target.value as LinenMove)} aria-label="What happened" className="h-10 rounded-xl border bg-background px-2 text-[13px]">
                <option value="use">Used (clean → dirty)</option><option value="damaged_clean">Damaged — was clean</option><option value="damaged_dirty">Damaged — was dirty</option>{manager && <option value="add">Bought more</option>}
              </select>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label="How many" className="h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" />
              <button type="button" disabled={busy === l.id} onClick={() => apply(l, what, qty)} className="h-10 rounded-xl bg-foreground px-3 text-[13px] font-semibold text-background disabled:opacity-40">Save</button>
              <button type="button" onClick={() => setOther(null)} className="h-10 rounded-xl px-2 text-[13px]">Cancel</button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {l.dirty > 0 && <button type="button" disabled={busy === l.id} onClick={() => apply(l, 'wash', l.dirty)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Start a wash load ({l.dirty})</button>}
              {l.washing > 0 && <button type="button" disabled={busy === l.id} onClick={() => apply(l, 'washed', l.washing)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Load finished ({l.washing})</button>}
              <button type="button" onClick={() => { setOther(l.id); setQty(1); setWhat('use'); }} className="h-9 rounded-full border px-3 text-[13px]">Something else</button>
            </div>)}
        </div>); })}
      {manager && (adding ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <input list="linen-types" value={name} onChange={(e) => setName(e.target.value)} placeholder="Linen type (e.g. Towel)" aria-label="Linen type" className="h-10 w-full rounded-xl border bg-background px-3 text-[14px]" />
          <datalist id="linen-types">{typeNames.map((n) => <option key={n} value={n} />)}</datalist>
          <p className="text-[12px] text-muted-foreground">Use the same name as the “Linens” line on the service, so used ones are counted when a visit finishes.</p>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <label>How many clean now <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /></label>
            <label>Keep at least <input type="number" min={0} value={par} onChange={(e) => setPar(Number(e.target.value))} className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /> clean</label>
          </div>
          <select value={invId} onChange={(e) => setInvId(e.target.value)} aria-label="Inventory item" className="h-10 w-full rounded-xl border bg-background px-2 text-[14px]">
            <option value="">Not linked to an inventory item</option>
            {supplies.map((i: any) => <option key={i.id} value={i.id}>{i.name} — {Number(i.totalStock) || 0} owned</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" disabled={busy === 'add' || !name.trim()} onClick={add} className="h-10 rounded-xl bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40">Add</button>
            <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-xl px-2 text-[13px]">Cancel</button>
          </div>
        </div>
      ) : <button type="button" onClick={() => setAdding(true)} className="h-10 rounded-full border px-4 text-[13px] font-semibold">+ Add a linen type</button>)}
    </div>);
}
