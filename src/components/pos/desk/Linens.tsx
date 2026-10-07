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
import { moveLinen, linenOutlook, linensNeeded, linenTotal, LINEN_MOVE_LABEL, BUNDLE_LABEL, BUNDLE_NEXT, findBundle, newBundleCode, type Linen, type LinenMove, type LinenBundle } from '@/lib/linens';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { printCodeLabels, brandOf, LABEL_FORMATS, BUNDLE_STEPS, type LabelFormat } from '@/lib/print-labels';
import { useTenant } from '@/context/TenantContext';
import { useNfc } from '@/lib/use-nfc';

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function Linens({ tenantId, services, appts = [], inventory = [], manager, staff = [] }: { tenantId: string; services: any[]; appts?: any[]; inventory?: any[]; manager: boolean; staff?: any[] }) {
  const { selectedTenant } = useTenant() as any; const [fmt, setFmt] = React.useState<LabelFormat>('band');   // bundles default to a wrap band const [holderFor, setHolderFor] = React.useState<LinenBundle | null>(null);   // a bundle being taken out: who is it for?
  const { firestore } = useFirebase();
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'linens') : null), [firestore, tenantId]);
  const { data: linensRaw } = useCollection<any>(q);
  const linens: Linen[] = React.useMemo(() => [...(linensRaw || [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [linensRaw]);
  const bq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'linenBundles') : null), [firestore, tenantId]);
  const { data: bundlesRaw } = useCollection<any>(bq); const bundles: LinenBundle[] = bundlesRaw || [];
  const [typed, setTyped] = React.useState(''); const [cam, setCam] = React.useState(false);
  const [bundling, setBundling] = React.useState<string | null>(null); const [bSize, setBSize] = React.useState(6); const [bCount, setBCount] = React.useState(2); const [washMin, setWashMin] = React.useState(60);
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
  const codeRef = React.useRef<(v: string) => void>(() => undefined); const nfc = useNfc((id) => codeRef.current(id));   // NFC taps go to the same handler as scans
  if (!firestore) return null;

  const apply = async (l: Linen, move: LinenMove, n: number, quiet = false): Promise<boolean> => {
    const res = moveLinen(l, move, n); if (!res.moved && quiet) return true;   // a bundle whose linens were already counted (by finished visits): only its tag moves
    if (!res.moved) { setMsg({ ok: false, text: move === 'issue' ? `There aren’t ${n} clean ${l.name.toLowerCase()} to take.` : 'Nothing to move.' }); return false; }
    setBusy(l.id); let ok = false;
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), { clean: res.clean, dirty: res.dirty, washing: res.washing, inUse: res.inUse, by: who(), at: new Date().toISOString(), ...(move === 'wash' ? { washStartedAt: new Date().toISOString(), washById: getAuth().currentUser?.uid || null } : {}), ...(move === 'washed' && res.washing === 0 ? { washStartedAt: null } : {}) }); ok = true;
      void logAuditClient(firestore, tenantId, { action: `linen.${move}`, targetType: 'linen', targetId: l.id, actor: actor(), before: { clean: l.clean, dirty: l.dirty, washing: l.washing }, after: { clean: res.clean, dirty: res.dirty, washing: res.washing }, summary: `${l.name}: ${LINEN_MOVE_LABEL[move]} × ${res.moved}` });
      // Damaged linens come off inventory, with a stock movement.
      if ((move === 'damaged_clean' || move === 'damaged_dirty') && l.inventoryItemId) { try { await runTransaction(firestore, async (txn: any) => { const ref = doc(firestore, 'tenants', tenantId, 'inventory', l.inventoryItemId as string); const snap = await txn.get(ref); if (!snap.exists()) return;
          txn.update(ref, { totalStock: Math.max(0, (Number(snap.data()?.totalStock) || 0) - res.moved) });
          txn.set(doc(collection(firestore, 'tenants', tenantId, 'stockMovements')), { id: `mv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, productId: ref.id, productName: snap.data()?.name || l.name, qty: res.moved, from: 'linens', to: 'damaged', kind: 'adjust', actorId: getAuth().currentUser?.uid || null, actorName: who(), at: new Date().toISOString(), note: 'Linen damaged' }); }); } catch { /* counts are right; stock can be corrected in Inventory */ } }
      setMsg({ ok: true, text: `${l.name}: ${LINEN_MOVE_LABEL[move].toLowerCase()} × ${res.moved}` }); setOther(null); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); return ok; };
  // A bundle's tag was scanned (or its button tapped): the whole bundle moves on, and the type's counts with it.
  const moveBundle = async (b: LinenBundle, holder?: { id: string | null; name: string | null } | 'ask') => { if (b.status === 'clean' && holder === undefined && (staff || []).some((x: any) => x && x.active !== false && x.role !== 'renter')) { setHolderFor(b); return true; }
    const h = holder && holder !== 'ask' ? holder : null; const l = linens.find((x) => x.id === b.linenId); if (!l) { setMsg({ ok: false, text: 'That bundle’s linen type no longer exists.' }); return false; }
    const next = BUNDLE_NEXT[b.status]; if (!(await apply(l, next.move, b.qty, next.move !== 'issue'))) return false;
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'linenBundles', b.id), { status: next.to, at: new Date().toISOString(), by: who(), holderId: next.to === 'in_use' ? h?.id || null : null, holderName: next.to === 'in_use' ? h?.name || null : null }); } catch { /* counts moved; tap again to fix the tag */ }
    void logAuditClient(firestore, tenantId, { action: `bundle.${next.to}`, targetType: 'linenBundle', targetId: b.id, actor: actor(), before: { status: b.status }, after: { status: next.to, holderId: h?.id || null }, summary: `${b.name} bundle ${b.code} (${b.qty}): ${BUNDLE_LABEL[b.status]} → ${BUNDLE_LABEL[next.to]}${next.to === 'in_use' && h?.name ? ` with ${h.name}` : ''}` });
    setHolderFor(null); setMsg({ ok: true, text: `${b.name} ${b.code} (${b.qty}) — ${BUNDLE_LABEL[next.to].toLowerCase()}${next.to === 'in_use' && h?.name ? ` with ${String(h.name).split(' ')[0]}` : ''}` }); return true; };
  const handleCode = async (raw: string) => { const b = findBundle(bundles, raw); if (!b) { scanFeedback(false); setMsg({ ok: false, text: 'No bundle with that tag.' }); return; } scanFeedback(await moveBundle(b)); };
  codeRef.current = (v) => { void handleCode(v); };
  const makeBundles = async (l: Linen) => { const size = Math.max(1, Math.round(bSize) || 1), n = Math.max(1, Math.min(30, Math.round(bCount) || 1)); setBusy(l.id);
    const taken = bundles.map((b) => b.code); const at = new Date().toISOString();
    try { for (let i = 0; i < n; i++) { const code = newBundleCode(taken); taken.push(code); const ref = doc(collection(firestore, 'tenants', tenantId, 'linenBundles')); await setDoc(ref, { id: ref.id, linenId: l.id, name: l.name, qty: size, code, status: 'clean', at, by: who(), createdAt: at }); }
      // From here this type is counted by its bundle scans, so make the clean count match the tagged bundles.
      const tagged = bundles.filter((b) => b.linenId === l.id && b.status === 'clean').reduce((a, b) => a + b.qty, 0) + size * n;
      await updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), { byBundle: true, clean: Math.max(l.clean, tagged) });
      void logAuditClient(firestore, tenantId, { action: 'linen.bundles', targetType: 'linen', targetId: l.id, actor: actor(), summary: `${l.name}: made ${n} bundle${n === 1 ? '' : 's'} of ${size}` });
      setBundling(null); setMsg({ ok: true, text: `Made ${n} bundle${n === 1 ? '' : 's'} of ${size}. Print their tags.` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };
  const printTags = async (l: Linen) => { if (!(await printCodeLabels(bundles.filter((b) => b.linenId === l.id).map((b) => ({ title: b.name, sub: `Bundle of ${b.qty}`, code: b.code, steps: BUNDLE_STEPS })), 'Linen bundle tags', brandOf(selectedTenant), fmt))) setMsg({ ok: false, text: 'Allow pop-ups to print tags.' }); };
  const add = async () => { const nm = name.trim().slice(0, 60); if (!nm) return; setBusy('add'); const inv: any = supplies.find((i: any) => i.id === invId) || null;
    try { const ref = doc(collection(firestore, 'tenants', tenantId, 'linens')); const at = new Date().toISOString(); const c = Math.max(0, Math.round(count) || 0);
      await setDoc(ref, { id: ref.id, name: nm, clean: c, dirty: 0, washing: 0, par: Math.max(0, Math.round(par) || 0) || null, inUse: 0, washMinutes: Math.max(0, Math.round(washMin) || 0) || null, inventoryItemId: inv?.id || null, inventoryName: inv?.name || null, by: who(), at, createdAt: at });
      void logAuditClient(firestore, tenantId, { action: 'linen.added', targetType: 'linen', targetId: ref.id, actor: actor(), after: { clean: c }, summary: `Added linen type ${nm} × ${c}${inv ? ` (inventory: ${inv.name})` : ''}` });
      setAdding(false); setName(''); setCount(12); setPar(0); setInvId(''); setMsg({ ok: true, text: `Added ${nm}.` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };

  return (
    <div className="space-y-3">
      {bundles.length > 0 && (<>
        <form onSubmit={(e) => { e.preventDefault(); const v = typed; setTyped(''); if (v.trim()) void handleCode(v); }} className="flex gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 80))} placeholder="Scan or type a bundle’s tag" aria-label="Bundle tag" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px] uppercase tracking-wider" />
          <button type="submit" disabled={!typed.trim()} className="h-11 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40">Move it on</button>
        </form>
        <button type="button" onClick={() => setCam((c) => !c)} className="h-10 w-full rounded-xl border text-[13px] font-semibold">{cam ? 'Close the camera' : 'Scan with this device’s camera'}</button>
        {cam && <ScanGate onScan={(v) => { void handleCode(v); }} label="Point the camera at a bundle tag" />}
        {nfc.supported && <button type="button" onClick={() => (nfc.on ? nfc.end() : nfc.start())} className="h-10 w-full rounded-xl border text-[13px] font-semibold">{nfc.on ? 'Stop reading NFC — ready, hold a tag to the phone' : 'Tap NFC tags with this phone'}</button>}
      </>)}
      {holderFor && (
        <div className="space-y-2 rounded-2xl border-2 bg-card p-3" role="dialog" aria-label="Who is this bundle for?">
          <p className="text-[14px] font-semibold">Who is {holderFor.name} {holderFor.code} for?</p>
          <div className="flex flex-wrap gap-2">
            {(staff || []).filter((x: any) => x && x.id && x.active !== false && x.role !== 'renter').map((x: any) => <button key={x.id} type="button" onClick={() => moveBundle(holderFor, { id: x.id, name: x.name || null })} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background">{String(x.name || 'Team member').split(' ')[0]}</button>)}
            <button type="button" onClick={() => moveBundle(holderFor, { id: null, name: null })} className="h-10 rounded-full border px-4 text-[13px]">Shared / no one</button>
            <button type="button" onClick={() => setHolderFor(null)} className="h-10 rounded-full px-3 text-[13px]">Cancel</button>
          </div>
        </div>)}
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {!linens.length && <p className="text-[14px] text-muted-foreground">No linens yet. {manager ? 'Add towels, capes or robes and the desk will tell you if there are enough clean ones for the rest of the day.' : 'A manager can add them here.'}</p>}
      {linens.map((l) => { const o = outlook.find((x) => x.id === l.id); const own = l.inventoryItemId ? Number((inventory || []).find((i: any) => i.id === l.inventoryItemId)?.totalStock) : NaN; return (
        <div key={l.id} className="rounded-2xl border bg-card p-3">
          <p className="text-[15px] font-semibold">{l.name}</p>
          <p className="text-[13px] text-muted-foreground"><b className="text-foreground">{l.clean} clean</b>{l.inUse ? ` · ${l.inUse} out on the floor` : ''} · {l.dirty} dirty · {l.washing} in the wash</p>
          {l.washing > 0 && l.washStartedAt && <p className="text-[13px]">Wash load: <LiveTimer since={l.washStartedAt} minutes={l.washMinutes || 0} doneLabel="Load should be done" /></p>}
          {o && (o.short > 0
            ? <p className="text-[13px] font-semibold text-red-700">Short by {o.short} for the rest of today{o.runsOutAt ? ` — runs out at the ${clock(o.runsOutAt)} visit` : ''}{l.dirty + l.washing > 0 ? '. Wash a load before then.' : '.'}</p>
            : o.needed > 0 ? <p className="text-[13px] text-emerald-700">Enough for the rest of today (needs {o.needed}).</p> : null)}
          {o?.belowPar && !o.short && <p className="text-[13px] text-amber-800">Below your usual {l.par} clean.</p>}
          {Number.isFinite(own) && own !== linenTotal(l) && <p className="text-[13px] text-amber-800">Inventory says {own} owned; {linenTotal(l)} counted here.</p>}
          {(() => { const mine = bundles.filter((b) => b.linenId === l.id).sort((a, b) => a.code.localeCompare(b.code)); if (!mine.length) return null; return (
            <ul className="mt-2 space-y-1 border-t pt-2">{mine.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span><span className="font-mono font-semibold tracking-wider">{b.code}</span> · {b.qty} · {BUNDLE_LABEL[b.status]}{b.status === 'in_use' && (b as any).holderName ? ` with ${String((b as any).holderName).split(' ')[0]}` : ''}{b.status === 'washing' ? <> · <LiveTimer since={b.at} minutes={l.washMinutes || 0} doneLabel="should be done" /></> : b.status === 'in_use' ? <> · <LiveTimer since={b.at} /></> : null}</span>
                <button type="button" disabled={busy === l.id} onClick={() => moveBundle(b)} className="h-8 rounded-full border px-3 text-[12px] font-semibold disabled:opacity-40">{BUNDLE_NEXT[b.status].label}</button>
              </li>))}</ul>); })()}
          {bundling === l.id && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              <label>In each bundle <input type="number" min={1} value={bSize} onChange={(e) => setBSize(Number(e.target.value))} className="ml-1 h-9 w-16 rounded-lg border bg-background px-2" /></label>
              <label>How many bundles <input type="number" min={1} max={30} value={bCount} onChange={(e) => setBCount(Number(e.target.value))} className="ml-1 h-9 w-16 rounded-lg border bg-background px-2" /></label>
              <button type="button" disabled={busy === l.id} onClick={() => makeBundles(l)} className="h-9 rounded-lg bg-foreground px-3 font-semibold text-background disabled:opacity-40">Make</button>
              <button type="button" onClick={() => setBundling(null)} className="h-9 px-2">Cancel</button>
              <p className="w-full text-[12px] text-muted-foreground">Scan a tag when a bundle goes out, comes back, is washed and is clean again. Linens used on a finished visit are still counted on their own.</p>
            </div>)}
          {other === l.id ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={what} onChange={(e) => setWhat(e.target.value as LinenMove)} aria-label="What happened" className="h-10 rounded-xl border bg-background px-2 text-[13px]">
                <option value="use">Used (clean → dirty)</option><option value="unissue">Unused — back to clean</option><option value="damaged_clean">Damaged — was clean</option><option value="damaged_dirty">Damaged — was dirty</option>{manager && <option value="add">Bought more</option>}
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
              {manager && bundling !== l.id && <button type="button" onClick={() => setBundling(l.id)} className="h-9 rounded-full border px-3 text-[13px]">Make tagged bundles</button>}
              {bundles.some((b) => b.linenId === l.id) && <span className="flex items-center gap-1"><select value={fmt} onChange={(e) => setFmt(e.target.value as LabelFormat)} aria-label="Tag shape" title={LABEL_FORMATS.find((f) => f.id === fmt)?.hint} className="h-9 rounded-full border bg-background px-2 text-[13px]">{LABEL_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select><button type="button" onClick={() => printTags(l)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Print</button></span>}
            </div>)}
        </div>); })}
      {manager && (adding ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <input list="linen-types" value={name} onChange={(e) => setName(e.target.value)} placeholder="Linen type (e.g. Towel)" aria-label="Linen type" className="h-10 w-full rounded-xl border bg-background px-3 text-[14px]" />
          <datalist id="linen-types">{typeNames.map((n) => <option key={n} value={n} />)}</datalist>
          <p className="text-[12px] text-muted-foreground">Use the same name as the “Linens” line on the service, so used ones are counted when a visit finishes.</p>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <label>How many clean now <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /></label>
            <label>Wash + dry takes <input type="number" min={0} value={washMin} onChange={(e) => setWashMin(Number(e.target.value))} className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /> min</label>
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
