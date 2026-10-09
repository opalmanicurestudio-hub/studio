'use client';
// src/components/pos/desk/Linens.tsx — LINENS & LAUNDRY (O6): how many of each are clean, dirty and in the wash; whether
// there are enough clean ones for the rest of today; start and finish wash loads. Used linens move to dirty on their own
// when a visit finishes. Every change is on the audit log; damaged ones come off inventory when the type is linked.
import * as React from 'react';
import { doc, updateDoc, setDoc, collection, runTransaction, arrayUnion } from 'firebase/firestore';
import { planSetAside } from '@/lib/setaside';
import { linensForVisit } from '@/lib/linens';
import { getAuth } from 'firebase/auth';
import { logAuditClient } from '@/lib/audit-client';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { stageOf } from '@/lib/visit';
import { moveLinen, linenOutlook, linensNeeded, linenTotal, linenUpdate, afterWash, loadDecision, bundleNext, LINEN_MOVE_LABEL, BUNDLE_LABEL, findBundle, newBundleCode, type Linen, type LinenMove, type LinenBundle } from '@/lib/linens';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { LabelSizes } from '@/components/pos/desk/LabelSizes';
import { useDeferred } from '@/components/pos/desk/Undo';
import { settle } from '@/lib/offline';
import { printCodeLabels, brandOf, LABEL_FORMATS, BUNDLE_STEPS, type LabelFormat } from '@/lib/print-labels';
import { useTenant } from '@/context/TenantContext';
import { useNfc } from '@/lib/use-nfc';

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function Linens({ tenantId, services, appts = [], inventory = [], manager, staff = [], incoming = null, focusLinenId = null, hideScan = false }: { tenantId: string; services: any[]; appts?: any[]; inventory?: any[]; manager: boolean; staff?: any[]; incoming?: { code: string; n: number } | null; focusLinenId?: string | null; hideScan?: boolean }) {
  const { selectedTenant } = useTenant() as any; const [fmt, setFmt] = React.useState<LabelFormat>('band');   // bundles default to a wrap band
  const [holderFor, setHolderFor] = React.useState<LinenBundle | null>(null);   // a bundle being taken out: who is it for?
  const { firestore } = useFirebase();
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'linens') : null), [firestore, tenantId]);
  const { data: linensRaw } = useCollection<any>(q);
  const linens: Linen[] = React.useMemo(() => [...(linensRaw || [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [linensRaw]);
  const bq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'linenBundles') : null), [firestore, tenantId]);
  const { data: bundlesRaw } = useCollection<any>(bq); const bundles: LinenBundle[] = bundlesRaw || [];
  const [typed, setTyped] = React.useState(''); const [cam, setCam] = React.useState(false);
  const [bundling, setBundling] = React.useState<string | null>(null); const [bSize, setBSize] = React.useState(6); const [bCount, setBCount] = React.useState(2); const [washMin, setWashMin] = React.useState(''); const [dryMin, setDryMin] = React.useState(''); const [loadSz, setLoadSz] = React.useState('');
  const [settingsFor, setSettingsFor] = React.useState<string | null>(null); const [tagCheck, setTagCheck] = React.useState<LinenBundle | null>(null);   // laundry settings being edited; a bundle being folded back
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [other, setOther] = React.useState<string | null>(null); const [qty, setQty] = React.useState(1); const [what, setWhat] = React.useState<LinenMove>('use');
  const [adding, setAdding] = React.useState(false); const [name, setName] = React.useState(''); const [count, setCount] = React.useState(12); const [par, setPar] = React.useState(0); const [invId, setInvId] = React.useState('');
  // Visits still to come today or under way (their linens haven't been counted as used yet).
  const ahead = React.useMemo(() => (appts || []).filter((a: any) => ['booked', 'waiting', 'in_service'].includes(stageOf(a)) && !a.linensCounted).map((a: any) => ({ ...a, startTime: typeof a.startTime === 'string' ? a.startTime : a.startTime?.toDate ? a.startTime.toDate().toISOString() : new Date(a.startTime).toISOString() })), [appts]);
  const outlook = React.useMemo(() => linenOutlook(linens, ahead, services), [linens, ahead, services]);
  // Which visit each clean bundle is set aside for (service needs + room needs), so taking it out ties it to that client.
  const rq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null), [firestore, tenantId]);
  const { data: resources } = useCollection<any>(rq);
  const bundleFor = React.useMemo(() => planSetAside({ visits: appts || [], services: services || [], kits: [], kitTypes: [], bundles, linens, resources: resources || [] }).byBundle, [appts, services, bundles, linens, resources]);
  const visitsFor = (b: LinenBundle) => (appts || []).filter((a: any) => ['waiting', 'in_service', 'booked'].includes(stageOf(a)) && linensForVisit(a, services || [], resources || []).some((n) => String(n.name).trim().toLowerCase() === String(b.name).trim().toLowerCase()))
    .sort((x: any, y: any) => String(x.startTime).localeCompare(String(y.startTime))).slice(0, 6);
  const typeNames = React.useMemo(() => Array.from(new Set((services || []).flatMap((s: any) => linensNeeded(s).map((n) => n.name)))).sort(), [services]);
  const supplies = React.useMemo(() => (inventory || []).filter((i: any) => i && i.archived !== true && (i.type === 'equipment' || i.type === 'overhead' || i.type === 'professional')).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [inventory]);
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who(), role: manager ? 'manager' : 'staff' });
  const codeRef = React.useRef<(v: string) => void>(() => undefined); const nfc = useNfc((id) => codeRef.current(id));   // NFC taps go to the same handler as scans
  const later = useDeferred(5000);   // bulk laundry taps wait 5 seconds with Undo
  React.useEffect(() => { if (incoming?.code) codeRef.current(incoming.code); }, [incoming?.n]); // eslint-disable-line react-hooks/exhaustive-deps   // a scan from the one-scanner sheet
  if (!firestore) return null;

  const apply = async (l: Linen, move: LinenMove, n: number, quiet = false): Promise<boolean> => {
    const res = moveLinen(l, move, n); if (!res.moved && quiet) return true;   // a bundle whose linens were already counted (by finished visits): only its tag moves
    if (!res.moved) { setMsg({ ok: false, text: move === 'issue' ? `There aren’t ${n} clean ${l.name.toLowerCase()} to take.` : 'Nothing to move.' }); return false; }
    setBusy(l.id); let ok = false;
    try { await settle(updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), linenUpdate(l, move, res, { name: who(), uid: getAuth().currentUser?.uid || null }))); ok = true;
      void logAuditClient(firestore, tenantId, { action: `linen.${move}`, targetType: 'linen', targetId: l.id, actor: actor(), before: { clean: l.clean, dirty: l.dirty, washing: l.washing, drying: l.drying || 0, folding: l.folding || 0 }, after: { clean: res.clean, dirty: res.dirty, washing: res.washing, drying: res.drying, folding: res.folding }, summary: `${l.name}: ${LINEN_MOVE_LABEL[move]} × ${res.moved}` });
      // Damaged linens come off inventory, with a stock movement.
      if ((move === 'damaged_clean' || move === 'damaged_dirty') && l.inventoryItemId) { try { await runTransaction(firestore, async (txn: any) => { const ref = doc(firestore, 'tenants', tenantId, 'inventory', l.inventoryItemId as string); const snap = await txn.get(ref); if (!snap.exists()) return;
          txn.update(ref, { totalStock: Math.max(0, (Number(snap.data()?.totalStock) || 0) - res.moved) });
          txn.set(doc(collection(firestore, 'tenants', tenantId, 'stockMovements')), { id: `mv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, productId: ref.id, productName: snap.data()?.name || l.name, qty: res.moved, from: 'linens', to: 'damaged', kind: 'adjust', actorId: getAuth().currentUser?.uid || null, actorName: who(), at: new Date().toISOString(), note: 'Linen damaged' }); }); } catch { /* counts are right; stock can be corrected in Inventory */ } }
      setMsg({ ok: true, text: `${l.name}: ${LINEN_MOVE_LABEL[move].toLowerCase()} × ${res.moved}` }); setOther(null); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); return ok; };
  // A bundle's tag was scanned (or its button tapped): the whole bundle moves on, and the type's counts with it.
  const moveBundle = async (b: LinenBundle, holder?: { id: string | null; name: string | null; visit?: { id: string; clientName: string } | null } | 'ask', tagOk = false) => {
    // Folding a bundle back onto the shelf: count it and check its tag first (a worn tag is reprinted).
    if (b.status === 'folding' && !tagOk) { setTagCheck(b); return true; }
    if (b.status === 'clean' && holder === undefined && (bundleFor[b.id] || visitsFor(b).length || (staff || []).some((x: any) => x && x.active !== false && x.role !== 'renter'))) { setHolderFor(b); return true; }
    const h = holder && holder !== 'ask' ? holder : null; const l = linens.find((x) => x.id === b.linenId); if (!l) { setMsg({ ok: false, text: 'That bundle’s linen type no longer exists.' }); return false; }
    const next = bundleNext(b, l); if (!(await apply(l, next.move, b.qty, next.move !== 'issue'))) return false;
    const v = next.to === 'in_use' ? h?.visit || null : null;
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'linenBundles', b.id), { status: next.to, at: new Date().toISOString(), by: who(), holderId: next.to === 'in_use' ? h?.id || null : null, holderName: next.to === 'in_use' ? h?.name || null : null, visitId: v?.id || null, clientName: v?.clientName || null, setFor: null, setForName: null, setOutAt: null, setOutStation: null }); } catch { /* counts moved; tap again to fix the tag */ }
    // The visit remembers which bundle was used on this client (rentals have no visit record to write to).
    if (v && !String(v.id).startsWith('res:')) { try { await updateDoc(doc(firestore, 'tenants', tenantId, 'appointments', v.id), { bundles: arrayUnion({ id: b.id, code: b.code, name: b.name, qty: b.qty, at: new Date().toISOString(), by: who() }) }); } catch { /* the bundle is still marked out */ } }
    void logAuditClient(firestore, tenantId, { action: `bundle.${next.to}`, targetType: 'linenBundle', targetId: b.id, actor: actor(), before: { status: b.status }, after: { status: next.to, holderId: h?.id || null, visitId: v?.id || null }, summary: `${b.name} bundle ${b.code} (${b.qty}): ${BUNDLE_LABEL[b.status]} → ${BUNDLE_LABEL[next.to]}${v ? ` for ${v.clientName}` : ''}${next.to === 'in_use' && h?.name ? ` with ${h.name}` : ''}` });
    setHolderFor(null); setTagCheck(null); setMsg({ ok: true, text: `${b.name} ${b.code} (${b.qty}) — ${BUNDLE_LABEL[next.to].toLowerCase()}${v ? ` for ${String(v.clientName).split(' ')[0]}` : ''}${next.to === 'in_use' && h?.name ? ` with ${String(h.name).split(' ')[0]}` : ''}` }); return true; };
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
      await setDoc(ref, { id: ref.id, name: nm, clean: c, dirty: 0, washing: 0, par: Math.max(0, Math.round(par) || 0) || null, inUse: 0, washMinutes: Math.max(0, Math.round(Number(washMin)) || 0) || null, dryMinutes: Math.max(0, Math.round(Number(dryMin)) || 0) || null, loadSize: Math.max(0, Math.round(Number(loadSz)) || 0) || null, drying: 0, folding: 0, inventoryItemId: inv?.id || null, inventoryName: inv?.name || null, by: who(), at, createdAt: at });
      void logAuditClient(firestore, tenantId, { action: 'linen.added', targetType: 'linen', targetId: ref.id, actor: actor(), after: { clean: c }, summary: `Added linen type ${nm} × ${c}${inv ? ` (inventory: ${inv.name})` : ''}` });
      setAdding(false); setName(''); setCount(12); setPar(0); setInvId(''); setWashMin(''); setDryMin(''); setLoadSz(''); setMsg({ ok: true, text: `Added ${nm}.` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };

  return (
    <div className="space-y-3">
      {bundles.length > 0 && !hideScan && (<>
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
          {(() => { const plannedId = (holderFor as any).setFor || bundleFor[holderFor.id]?.visitId; const vs = visitsFor(holderFor); const planned = plannedId ? (vs.find((a: any) => a.id === plannedId) || (appts || []).find((a: any) => a.id === plannedId) || (String(plannedId).startsWith('res:') ? { id: plannedId, clientName: bundleFor[holderFor.id].clientName, staffId: null } : null)) : null;
            const list = [...(planned ? [planned] : []), ...vs.filter((a: any) => a.id !== plannedId)];
            const t = (a: any) => { const d = new Date(String(a.startTime || '')); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };
            return list.length ? <div className="flex flex-wrap gap-2">{list.map((a: any, i: number) => { const p: any = (staff || []).find((x: any) => x.id === a.staffId);
              return <button key={a.id} type="button" onClick={() => moveBundle(holderFor, { id: a.staffId || null, name: p?.name || null, visit: { id: a.id, clientName: String(a.clientName || 'Client') } })} className={`h-11 rounded-full px-4 text-[13px] font-semibold ${i === 0 && planned ? 'bg-foreground text-background' : 'border'}`}>{String(a.clientName || 'Client').split(' ')[0]}{t(a) ? ` · ${t(a)}` : ''}{p?.name ? ` with ${String(p.name).split(' ')[0]}` : ''}{i === 0 && planned ? ' — set aside' : ''}</button>; })}</div> : null; })()}
          <p className="text-[12px] text-muted-foreground">Or just the person taking it:</p>
          <div className="flex flex-wrap gap-2">
            {(staff || []).filter((x: any) => x && x.id && x.active !== false && x.role !== 'renter').map((x: any) => <button key={x.id} type="button" onClick={() => moveBundle(holderFor, { id: x.id, name: x.name || null })} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background">{String(x.name || 'Team member').split(' ')[0]}</button>)}
            <button type="button" onClick={() => moveBundle(holderFor, { id: null, name: null })} className="h-10 rounded-full border px-4 text-[13px]">Shared / no one</button>
            <button type="button" onClick={() => setHolderFor(null)} className="h-10 rounded-full px-3 text-[13px]">Cancel</button>
          </div>
        </div>)}
      {later.bar}
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {!linens.length && <p className="text-[14px] text-muted-foreground">No linens yet. {manager ? 'Add towels, capes or robes and the desk will tell you if there are enough clean ones for the rest of the day.' : 'A manager can add them here.'}</p>}
      {linens.filter((l) => !focusLinenId || l.id === focusLinenId).map((l) => { const o = outlook.find((x) => x.id === l.id); const own = l.inventoryItemId ? Number((inventory || []).find((i: any) => i.id === l.inventoryItemId)?.totalStock) : NaN; return (
        <div key={l.id} className="rounded-2xl border bg-card p-3">
          <p className="text-[15px] font-semibold">{l.name}</p>
          {/* The loop at a glance: bin → wash → dryer → fold → clean */}
          <div className="mt-1.5 grid grid-cols-5 gap-1 text-center text-[12px]" aria-label={`${l.name} laundry`}>
            {([['In the bin', l.dirty], ['Washing', l.washing], ['Drying', l.drying || 0], ['To fold', l.folding || 0], ['Clean', l.clean]] as [string, number][]).map(([lab, n], i) => (
              <div key={lab} className="rounded-xl py-1.5" style={{ background: i === 4 ? '#e3f3e7' : n ? '#f6f1ea' : '#faf8f5', color: i === 4 ? '#1f6b3a' : n ? '#17181a' : '#a39d93' }}><div className="text-[17px] font-[800] tabular-nums">{n}</div><div>{lab}</div></div>))}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{l.inUse ? `${l.inUse} out on the floor · ` : ''}{(() => { const d = loadDecision(l, outlook.find((x) => x.id === l.id)?.short || 0); return d.needsSetup ? (manager ? 'Set the load size and wash time below' : 'Load size and wash time not set yet') : d.reason; })()}</p>
          {l.washing > 0 && l.washStartedAt && <p className="text-[13px]">Wash: <LiveTimer since={l.washStartedAt} minutes={l.washMinutes || 0} doneLabel={Number(l.dryMinutes) > 0 ? 'Done — into the dryer' : 'Done — to fold'} /></p>}
          {(l.drying || 0) > 0 && l.dryStartedAt && <p className="text-[13px]">Dryer: <LiveTimer since={l.dryStartedAt} minutes={l.dryMinutes || 0} doneLabel="Dry — to fold" /></p>}
          {o && (o.short > 0
            ? <p className="text-[13px] font-semibold text-red-700">Short by {o.short} for the rest of today{o.runsOutAt ? ` — runs out at the ${clock(o.runsOutAt)} visit` : ''}{l.dirty + l.washing > 0 ? '. Wash a load before then.' : '.'}</p>
            : o.needed > 0 ? <p className="text-[13px] text-emerald-700">Enough for the rest of today (needs {o.needed}).</p> : null)}
          {o?.belowPar && !o.short && <p className="text-[13px] text-amber-800">Below your usual {l.par} clean.</p>}
          {Number.isFinite(own) && own !== linenTotal(l) && <p className="text-[13px] text-amber-800">Inventory says {own} owned; {linenTotal(l)} counted here.</p>}
          {(() => { const mine = bundles.filter((b) => b.linenId === l.id).sort((a, b) => a.code.localeCompare(b.code)); if (!mine.length) return null; return (
            <ul className="mt-2 space-y-1 border-t pt-2">{mine.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span><span className="font-mono font-semibold tracking-wider">{b.code}</span> · {b.qty} · {BUNDLE_LABEL[b.status]}{b.status === 'in_use' && (b as any).clientName ? ` for ${String((b as any).clientName).split(' ')[0]}` : ''}{b.status === 'in_use' && (b as any).holderName ? ` with ${String((b as any).holderName).split(' ')[0]}` : ''}{b.status === 'clean' && bundleFor[b.id] ? <b className="font-semibold" style={{ color: '#7A5C3A' }}> · set aside for {bundleFor[b.id].clientName.split(' ')[0]} {new Date(bundleFor[b.id].startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b> : null}{b.status === 'washing' ? <> · <LiveTimer since={b.at} minutes={l.washMinutes || 0} doneLabel="should be done" /></> : b.status === 'in_use' ? <> · <LiveTimer since={b.at} /></> : null}</span>
                <button type="button" disabled={busy === l.id} onClick={() => moveBundle(b)} className="h-8 rounded-full border px-3 text-[12px] font-semibold disabled:opacity-40">{bundleNext(b, l).label}</button>
              </li>))}</ul>); })()}
          {settingsFor === l.id && (
            <form className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-muted/40 p-2.5 text-[13px]" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const num = (k: string) => Math.max(0, Math.round(Number(f.get(k))) || 0) || null;
              const patch = { loadSize: num('load'), washMinutes: num('wash'), dryMinutes: num('dry'), par: num('par') };
              try { await updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), patch); void logAuditClient(firestore, tenantId, { action: 'linen.settings', targetType: 'linen', targetId: l.id, actor: actor(), before: { loadSize: l.loadSize || null, washMinutes: l.washMinutes || null, dryMinutes: l.dryMinutes || null, par: l.par || null }, after: patch, summary: `${l.name}: laundry settings changed` }); setSettingsFor(null); setMsg({ ok: true, text: `${l.name}: laundry settings saved.` }); }
              catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } }}>
              <label className="flex flex-col">A load is<input name="load" type="number" min={1} defaultValue={l.loadSize || ''} placeholder="?" className="h-9 w-20 rounded-lg border bg-background px-2" /></label>
              <label className="flex flex-col">Wash (min)<input name="wash" type="number" min={0} defaultValue={l.washMinutes || ''} placeholder="?" className="h-9 w-20 rounded-lg border bg-background px-2" /></label>
              <label className="flex flex-col">Dry (min)<input name="dry" type="number" min={0} defaultValue={l.dryMinutes || ''} placeholder="none" className="h-9 w-20 rounded-lg border bg-background px-2" /></label>
              <label className="flex flex-col">Keep clean<input name="par" type="number" min={0} defaultValue={l.par || ''} className="h-9 w-20 rounded-lg border bg-background px-2" /></label>
              <button type="submit" className="h-9 rounded-lg bg-foreground px-3 font-semibold text-background">Save</button>
            </form>)}
          {tagCheck && tagCheck.linenId === l.id && (
            <div className="mt-2 space-y-2 rounded-xl border p-2.5 text-[13px]" role="dialog" aria-label="Fold and check the bundle">
              <p className="font-semibold">{tagCheck.name} {tagCheck.code}: fold {tagCheck.qty} and check the tag</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => moveBundle(tagCheck, undefined, true)} className="h-9 rounded-full bg-emerald-600 px-3 font-semibold text-white">All {tagCheck.qty} there — tag is good</button>
                <button type="button" onClick={async () => { await printCodeLabels([{ title: tagCheck.name, sub: `Bundle of ${tagCheck.qty}`, code: tagCheck.code, steps: BUNDLE_STEPS }], 'Replacement tag', brandOf(selectedTenant), fmt); void logAuditClient(firestore, tenantId, { action: 'bundle.retagged', targetType: 'linenBundle', targetId: tagCheck.id, actor: actor(), summary: `${tagCheck.name} bundle ${tagCheck.code}: new tag printed` }); await moveBundle(tagCheck, undefined, true); }} className="h-9 rounded-full border px-3 font-semibold">Tag is worn — print a new one</button>
                <button type="button" onClick={() => setTagCheck(null)} className="h-9 rounded-full px-2">Cancel</button>
              </div>
            </div>)}
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
              {l.dirty > 0 && (() => { const d = loadDecision(l, outlook.find((x) => x.id === l.id)?.short || 0); const n = d.due ? d.qty : l.dirty; return <button type="button" disabled={busy === l.id} onClick={() => later.defer(`Start a load of ${n} ${l.name.toLowerCase()}`, () => apply(l, 'wash', n))} className={`h-9 rounded-full px-3 text-[13px] font-semibold disabled:opacity-40 ${d.due ? 'bg-emerald-600 text-white' : 'border'}`}>Start a load ({n})</button>; })()}
              {l.washing > 0 && !l.byBundle && <button type="button" disabled={busy === l.id} onClick={() => later.defer(`${Number(l.dryMinutes) > 0 ? 'Into the dryer' : 'To fold'} — ${l.washing} ${l.name.toLowerCase()}`, () => apply(l, afterWash(l), l.washing))} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">{Number(l.dryMinutes) > 0 ? 'Into the dryer' : 'Washed — to fold'} ({l.washing})</button>}
              {(l.drying || 0) > 0 && !l.byBundle && <button type="button" disabled={busy === l.id} onClick={() => later.defer(`Dry — to fold: ${l.drying} ${l.name.toLowerCase()}`, () => apply(l, 'dried', l.drying || 0))} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Dry — to fold ({l.drying})</button>}
              {(l.folding || 0) > 0 && !l.byBundle && <button type="button" disabled={busy === l.id} onClick={() => later.defer(`Folded — ${l.folding} ${l.name.toLowerCase()} back as clean`, () => apply(l, 'folded', l.folding || 0))} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Folded — put away ({l.folding})</button>}
              {manager && <button type="button" onClick={() => setSettingsFor(settingsFor === l.id ? null : l.id)} className="h-9 rounded-full border px-3 text-[13px]">Laundry settings</button>}
              <button type="button" onClick={() => { setOther(l.id); setQty(1); setWhat('use'); }} className="h-9 rounded-full border px-3 text-[13px]">Something else</button>
              {manager && bundling !== l.id && <button type="button" onClick={() => setBundling(l.id)} className="h-9 rounded-full border px-3 text-[13px]">Make tagged bundles</button>}
              {bundles.some((b) => b.linenId === l.id) && <span className="flex items-center gap-1"><select value={fmt} onChange={(e) => setFmt(e.target.value as LabelFormat)} aria-label="Tag shape" title={LABEL_FORMATS.find((f) => f.id === fmt)?.hint} className="h-9 rounded-full border bg-background px-2 text-[13px]">{LABEL_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select><button type="button" onClick={() => printTags(l)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Print</button></span>}
              {bundles.some((b) => b.linenId === l.id) && <LabelSizes tenantId={tenantId} tenant={selectedTenant} format={fmt} manager={manager} />}
            </div>)}
        </div>); })}
      {manager && !focusLinenId && (adding ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <input list="linen-types" value={name} onChange={(e) => setName(e.target.value)} placeholder="Linen type (e.g. Towel)" aria-label="Linen type" className="h-10 w-full rounded-xl border bg-background px-3 text-[14px]" />
          <datalist id="linen-types">{typeNames.map((n) => <option key={n} value={n} />)}</datalist>
          <p className="text-[12px] text-muted-foreground">Use the same name as the “Linens” line on the service, so used ones are counted when a visit finishes. Enter your own load size and machine times (leave dry blank if they air-dry or go straight to folding) — the queue uses them to say when a load is due and done.</p>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <label>How many clean now <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /></label>
            <label>A load is <input type="number" min={1} value={loadSz} onChange={(e) => setLoadSz(e.target.value)} placeholder="?" className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /> of these</label>
            <label>Wash takes <input type="number" min={0} value={washMin} onChange={(e) => setWashMin(e.target.value)} placeholder="?" className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /> min</label>
            <label>Dry takes <input type="number" min={0} value={dryMin} onChange={(e) => setDryMin(e.target.value)} placeholder="none" className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /> min</label>
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
