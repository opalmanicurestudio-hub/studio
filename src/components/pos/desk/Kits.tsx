'use client';
// src/components/pos/desk/Kits.tsx — KITS at the desk (O5): how many of each kit are clean, in use, waiting to be cleaned
// or pulled out; type or scan a label to move one along; pull one out with a reason (a manager decides what happens next).
import * as React from 'react';
import { doc, updateDoc, setDoc, collection, arrayUnion, runTransaction } from 'firebase/firestore';
import { logAuditClient } from '@/lib/audit-client';
import { getAuth } from 'firebase/auth';
import { KIT_LABEL, KIT_NEXT, findKit, kitSupply, moveKit, newKitCode, kitsNeeded, kitCandidates, kitsLeftOut, kitHours, sameKitType, kitKey, typeOf, matchInventory, addKitItem, contentsCheck, type Kit, type KitStatus, type KitType, type KitItem } from '@/lib/kits';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';
import { TagPairing } from '@/components/pos/desk/TagPairing';
import { Sterilisation } from '@/components/pos/desk/Sterilisation';
import { sterilisedSinceUse } from '@/lib/sterilisation';
import { useNfc } from '@/lib/use-nfc';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { printCodeLabels, brandOf, LABEL_FORMATS, KIT_STEPS, type LabelFormat } from '@/lib/print-labels';
import { useTenant } from '@/context/TenantContext';
import { Linens } from '@/components/pos/desk/Linens';
import { stageOf } from '@/lib/visit';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';

const TONE: Record<KitStatus, string> = { ready: 'bg-emerald-100 text-emerald-800', in_use: 'bg-sky-100 text-sky-800', dirty: 'bg-amber-100 text-amber-900', cleaning: 'bg-violet-100 text-violet-900', out: 'bg-red-100 text-red-800', retired: 'bg-muted text-muted-foreground' };
const ORDER: KitStatus[] = ['out', 'dirty', 'cleaning', 'in_use', 'ready'];

export function Kits({ firestore, tenantId, kits, services, manager, appts = [], inventory = [], staff = [], resources = [] }: { firestore: any; tenantId: string; kits: Kit[]; services: any[]; manager: boolean; appts?: any[]; inventory?: any[]; staff?: any[]; resources?: any[] }) {
  const { selectedTenant } = useTenant() as any; const [fmt, setFmt] = React.useState<LabelFormat>('sticker');   // sticker, tie-on tag or wrap band
  const [invId, setInvId] = React.useState('');   // the inventory item the new kits are units of
  const equipment = React.useMemo(() => (inventory || []).filter((i: any) => i?.type === 'equipment' && i.archived !== true).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [inventory]);
  const syncNow = () => { fetch('/api/desk/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, only: 'kits' }) }).catch(() => undefined); };
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who().name, role: manager ? 'manager' : 'staff' });
  const typesQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'kitTypes') : null), [firestore, tenantId]);
  const { data: typesRaw } = useCollection<any>(typesQ); const types: KitType[] = typesRaw || [];
  const [cam, setCam] = React.useState(false);   // phone or tablet camera as the scanner
  const [editType, setEditType] = React.useState<{ name: string; items: KitItem[]; cleanMinutes: number } | null>(null);   // a kit type's contents being edited
  const [checking, setChecking] = React.useState<{ kit: Kit; items: KitItem[]; have: number[]; version: number } | null>(null);   // "is everything in it?"
  const [askFor, setAskFor] = React.useState<{ kit: Kit; who: { id: string; clientName: string; stage: string }[] } | null>(null);   // more than one guest it could be for
  const [typed, setTyped] = React.useState(''); const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); const [pulling, setPulling] = React.useState<string | null>(null); const [reason, setReason] = React.useState('');
  const [adding, setAdding] = React.useState(false); const [newName, setNewName] = React.useState(''); const [howMany, setHowMany] = React.useState(1);
  const live = React.useMemo(() => (kits || []).filter((k) => k.status !== 'retired'), [kits]);
  const supply = React.useMemo(() => kitSupply(live), [live]);
  // Kit types named on services but not tracked yet — offered when adding.
  const typeNames = React.useMemo(() => Array.from(new Set([...supply.map((s) => s.name), ...(services || []).flatMap((s: any) => kitsNeeded(s).map((n) => n.name))])).sort(), [supply, services]);
  const who = () => ({ name: (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0], manager });

  // Taking a clean kit ties it to the client it's for (one likely guest → tied straight away; several → ask; none → not tied).
  const take = async (k: Kit) => {
    const c = kitCandidates(k, (appts || []).map((a: any) => ({ id: a.id, clientName: a.clientName, serviceId: a.serviceId, stage: stageOf(a), kits: a.kits })), services);
    if (c.length > 1) { setAskFor({ kit: k, who: c }); return; }
    await move(k, 'in_use', undefined, c[0] || null); };
  const move = async (k: Kit, to: KitStatus, note?: string, forVisit?: { id: string; clientName: string } | null) => {
    // Who it's with: the visit's provider and station are kept on the kit while it's in use.
    const visit: any = forVisit ? (appts || []).find((a: any) => a.id === forVisit.id) : null;
    const prov: any = visit ? (staff || []).find((x: any) => x.id === visit.staffId) : null; const station: any = visit && Array.isArray(visit.requiredResourceIds) ? (resources || []).find((r: any) => visit.requiredResourceIds.includes(r.id)) : null;
    const held = to === 'in_use' ? { staffId: visit?.staffId || null, staffName: prov?.name || visit?.staffName || null } : { staffId: null, staffName: null };
    const res = moveKit(k, to, who(), { note, visitId: forVisit?.id, clientName: forVisit?.clientName, stationName: station?.name || null });
    if ('error' in res) { setMsg({ ok: false, text: res.error }); return false; }
    setBusy(k.id);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), { ...(res.patch as any), ...held, byId: getAuth().currentUser?.uid || null });
      if (to === 'out' || to === 'retired' || k.status === 'out') syncNow();   // usable kits changed → booking and stock follow straight away
      // The visit remembers which kit was used on this client (for the record, and so they aren't offered a second one).
      if (to === 'in_use' && forVisit) { try { await updateDoc(doc(firestore, 'tenants', tenantId, 'appointments', forVisit.id), { kits: arrayUnion({ id: k.id, name: k.name, code: k.code, at: new Date().toISOString(), by: who().name }) }); } catch { /* the kit is still marked in use */ } }
      // Every move is on the business's audit log (who, when, from → to, why, for whom).
      void logAuditClient(firestore, tenantId, { action: `kit.${to}`, targetType: 'kit', targetId: k.id, actor: actor(), before: { status: k.status }, after: { status: to, visitId: forVisit?.id || null, inventoryItemId: (k as any).inventoryItemId || null },
        summary: `${k.name} ${k.code}: ${KIT_LABEL[k.status]} → ${KIT_LABEL[to]}${forVisit ? ` for ${forVisit.clientName}` : ''}${held.staffName ? ` with ${held.staffName}` : ''}${to === 'in_use' && station?.name ? ` at ${station.name}` : ''}${note ? ` — ${String(note).trim()}` : to === 'retired' && k.note ? ` — ${k.note}` : ''}` });
      // A retired kit leaves inventory: one fewer owned, with a stock movement saying why.
      if (to === 'retired' && (k as any).inventoryItemId) { try { await runTransaction(firestore, async (txn: any) => { const ref = doc(firestore, 'tenants', tenantId, 'inventory', (k as any).inventoryItemId); const snap = await txn.get(ref); if (!snap.exists()) return;
          const have = Number(snap.data()?.totalStock) || 0; txn.update(ref, { totalStock: Math.max(0, have - 1) });
          txn.set(doc(collection(firestore, 'tenants', tenantId, 'stockMovements')), { id: `mv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, productId: ref.id, productName: snap.data()?.name || k.name, qty: 1, from: `kit ${k.code}`, to: 'retired', kind: 'adjust', actorId: getAuth().currentUser?.uid || null, actorName: who().name, at: new Date().toISOString(), note: k.note || 'Kit retired' }); }); } catch { /* the kit is retired either way; stock can be corrected in Inventory */ } }
      setMsg({ ok: true, text: `${k.name} ${k.code} — ${KIT_LABEL[to].toLowerCase()}${to === 'in_use' ? (forVisit ? ` for ${forVisit.clientName}` : ' (not tied to a client)') : ''}` }); setAskFor(null); setBusy(null); return true; }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); setBusy(null); return false; }
  };
  // "Clean — ready" for a kit type that has a contents list goes through the contents check first.
  const toReady = (k: Kit) => { if (selectedTenant?.ops?.requireSterilisation && !sterilisedSinceUse(k)) { scanFeedback(false); setMsg({ ok: false, text: `${k.name} ${k.code} hasn’t passed a recorded sterilisation cycle since it was used — run it through one first.` }); return; }
    const t = typeOf(types, k.name); if (t?.items?.length) { setChecking({ kit: k, items: t.items, have: t.items.map(() => 0), version: t.version || 1 }); return; } return move(k, 'ready'); };
  const finishCheck = async () => { if (!checking) return; const res = contentsCheck(checking.items, checking.have); const k = checking.kit; const at = new Date().toISOString();
    const lastCheck = { at, by: who().name, ok: res.complete, missing: res.missing, version: checking.version };
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), { lastCheck }); } catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); return; }
    void logAuditClient(firestore, tenantId, { action: res.complete ? 'kit.checked' : 'kit.incomplete', targetType: 'kit', targetId: k.id, actor: actor(), after: lastCheck, summary: `${k.name} ${k.code}: contents ${res.complete ? 'all there' : `missing ${res.missing.join(', ')}`}` });
    setChecking(null);
    if (res.complete) { if (k.status === 'cleaning') await move({ ...k, lastCheck } as Kit, 'ready'); else setMsg({ ok: true, text: `${k.name} ${k.code} — everything is there.` }); }
    else await move(k, 'out', `Missing: ${res.missing.join(', ')}`); };
  // One place for whatever was scanned or typed, by scanner, camera or keyboard.
  const handleCode = async (raw: string) => {
    if (editType) { const it = matchInventory(inventory, raw); if (!it) { scanFeedback(false); setMsg({ ok: false, text: `Nothing in inventory matches “${raw.trim().slice(0, 30)}”.` }); return; } scanFeedback(true); setEditType({ ...editType, items: addKitItem(editType.items, it) }); setMsg({ ok: true, text: `Added ${it.name}.` }); return; }
    if (checking) { const it = matchInventory(inventory, raw); const i = it ? checking.items.findIndex((x, j) => x.inventoryItemId === it.id && checking.have[j] < x.qty) : -1;
      if (i < 0) { scanFeedback(false); setMsg({ ok: false, text: it ? `${it.name} isn’t needed (or is already counted).` : 'That isn’t part of this kit.' }); return; }
      scanFeedback(true); setChecking({ ...checking, have: checking.have.map((n, j) => (j === i ? n + 1 : n)) }); setMsg(null); return; }
    const k = findKit(live, raw);
    if (!k) { scanFeedback(false); setMsg({ ok: false, text: 'No kit with that code.' }); return; }
    const next = KIT_NEXT[k.status]; if (!next) { scanFeedback(false); setMsg({ ok: false, text: `${k.name} ${k.code} is pulled out — a manager decides what happens next.` }); return; }
    scanFeedback(true);
    if (next.to === 'in_use') await take(k); else if (next.to === 'ready') await toReady(k); else await move(k, next.to); };
  const saveType = async () => { if (!editType) return; const key = kitKey(editType.name); const prev = typeOf(types, editType.name); const version = (prev?.version || 0) + 1;
    try { await setDoc(doc(firestore, 'tenants', tenantId, 'kitTypes', prev?.id || key), { id: prev?.id || key, name: editType.name, items: editType.items, cleanMinutes: Math.max(0, Math.round(editType.cleanMinutes) || 0), version, updatedAt: new Date().toISOString(), by: who().name });
      void logAuditClient(firestore, tenantId, { action: 'kit.contents', targetType: 'kitType', targetId: prev?.id || key, actor: actor(), before: { items: prev?.items || [], cleanMinutes: prev?.cleanMinutes || 0 }, after: { items: editType.items, cleanMinutes: editType.cleanMinutes }, summary: `${editType.name}: contents v${version} — ${editType.items.length} item${editType.items.length === 1 ? '' : 's'}, ${editType.cleanMinutes || 0} min to clean` });
      setMsg({ ok: true, text: `${editType.name} contents saved (version ${version}). The products inside the kits are now held as “in kits” in Inventory.` }); setEditType(null); syncNow(); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const nfc = useNfc((id) => { void handleCode(id); });
  const onScan = async (ev: React.FormEvent) => { ev.preventDefault(); const v = typed; setTyped(''); if (v.trim()) await handleCode(v); };
  const add = async () => { const name = newName.trim().slice(0, 60); const n = Math.max(1, Math.min(30, Math.round(howMany) || 1)); if (!name) return;
    const inv: any = equipment.find((i: any) => i.id === invId) || null;
    setBusy('add'); const taken = (kits || []).map((k) => k.code); const at = new Date().toISOString();
    try { for (let i = 0; i < n; i++) { const code = newKitCode(taken); taken.push(code); const ref = doc(collection(firestore, 'tenants', tenantId, 'kits'));
        await setDoc(ref, { id: ref.id, name, code, status: 'ready', by: who().name, at, cycles: 0, history: [], createdAt: at, inventoryItemId: inv?.id || null, inventoryName: inv?.name || null });
        void logAuditClient(firestore, tenantId, { action: 'kit.added', targetType: 'kit', targetId: ref.id, actor: actor(), after: { status: 'ready', inventoryItemId: inv?.id || null }, summary: `Added ${name} ${code}${inv ? ` (inventory: ${inv.name})` : ' (not linked to inventory)'}` }); }
      setMsg({ ok: true, text: `Added ${n} × ${name}. Print their labels below.` }); setAdding(false); setNewName(''); setHowMany(1); setInvId(''); syncNow(); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };
  const printLabels = async () => { if (!(await printCodeLabels(live.map((k) => ({ title: k.name, code: k.code, steps: KIT_STEPS })), 'Kit labels', brandOf(selectedTenant), fmt))) setMsg({ ok: false, text: 'Allow pop-ups to print labels.' }); };

  return (
    <div className="space-y-3">
      <form onSubmit={onScan} className="flex gap-2">
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 80))} placeholder={editType ? "Scan or type a product’s SKU" : checking ? "Scan or type an item" : "Scan or type a kit’s code"} aria-label="Code" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px] uppercase tracking-wider" />
        <button type="submit" disabled={!typed.trim()} className="h-11 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40">{editType ? "Add" : checking ? "Count it" : "Move it on"}</button>
      </form>
      <button type="button" onClick={() => setCam((c) => !c)} className="h-10 w-full rounded-xl border text-[13px] font-semibold">{cam ? 'Close the camera' : 'Scan with this device’s camera'}</button>
      {nfc.supported && <button type="button" onClick={() => (nfc.on ? nfc.end() : nfc.start())} className="h-10 w-full rounded-xl border text-[13px] font-semibold">{nfc.on ? 'Stop reading NFC — ready, hold a tag to the phone' : 'Tap NFC tags with this phone'}</button>}
      {nfc.error && <p className="text-[13px] text-red-700" role="alert">{nfc.error}</p>}
      {cam && <ScanGate onScan={(v) => { void handleCode(v); }} label={editType ? 'Scan each product that belongs in the kit' : checking ? 'Scan each item as you put it in' : 'Point the camera at a kit label'} />}
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {checking && (() => { const res = contentsCheck(checking.items, checking.have); return (
        <div className="space-y-2 rounded-2xl border-2 bg-card p-3" role="dialog" aria-label="Check the kit’s contents">
          <p className="text-[14px] font-semibold">Is everything in {checking.kit.name} {checking.kit.code}?</p>
          <p className="text-[12px] text-muted-foreground">Scan each item as it goes in, or tap it.</p>
          <ul className="space-y-1">{checking.items.map((it, i) => { const done = checking.have[i] >= it.qty; return (
            <li key={i}><button type="button" onClick={() => setChecking({ ...checking, have: checking.have.map((n, j) => (j === i ? (done ? 0 : it.qty) : n)) })} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[14px]">
              <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded border text-[12px] ${done ? 'border-emerald-600 bg-emerald-600 text-white' : ''}`}>{done ? '✓' : ''}</span>
              <span className={done ? 'text-muted-foreground' : 'font-medium'}>{it.name}</span><span className="text-muted-foreground">{checking.have[i]}/{it.qty}</span></button></li>); })}</ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!res.complete} onClick={finishCheck} className="h-10 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white disabled:opacity-40">All there{checking.kit.status === 'cleaning' ? ' — ready' : ''}</button>
            {!res.complete && <button type="button" onClick={finishCheck} className="h-10 rounded-full border px-4 text-[13px] text-red-700">Something’s missing — pull it out</button>}
            <button type="button" onClick={() => setChecking(null)} className="h-10 rounded-full px-3 text-[13px]">Cancel</button>
          </div>
        </div>); })()}
      {editType && (
        <div className="space-y-2 rounded-2xl border-2 bg-card p-3" role="dialog" aria-label="What’s in this kit">
          <p className="text-[14px] font-semibold">What’s in every {editType.name}?</p>
          <p className="text-[12px] text-muted-foreground">Scan each product’s barcode (scanner or camera), type its SKU in the box at the top, or pick it below.</p>
          {editType.items.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing added yet.</p>}
          <ul className="space-y-1">{editType.items.map((it, i) => { const n = live.filter((k) => sameKitType(k.name, editType.name)).length; const inv: any = (inventory || []).find((x: any) => x.id === it.inventoryItemId); const own = inv ? Number(inv.totalStock) || 0 : null; return (
            <li key={i} className="flex flex-wrap items-center gap-2 text-[14px]"><span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
              <input type="number" min={1} value={it.qty} aria-label={`How many ${it.name}`} onChange={(e) => setEditType({ ...editType, items: editType.items.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.round(Number(e.target.value)) || 1) } : x)) })} className="h-9 w-16 rounded-lg border bg-background px-2 text-[14px]" />
              <button type="button" aria-label={`Remove ${it.name}`} onClick={() => setEditType({ ...editType, items: editType.items.filter((_, j) => j !== i) })} className="h-9 rounded-lg px-2 text-[13px] text-red-700">Remove</button>
              {own !== null && n > 0 && <span className={`w-full text-[12px] ${own < n * it.qty ? 'font-semibold text-amber-800' : 'text-muted-foreground'}`}>{n} kit{n === 1 ? '' : 's'} × {it.qty} = {n * it.qty} held in kits · you own {own}{own < n * it.qty ? ` — ${n * it.qty - own} short` : ` · ${own - n * it.qty} spare`}</span>}
            </li>); })}</ul>
          <select value="" aria-label="Add from inventory" onChange={(e) => { const it: any = (inventory || []).find((x: any) => x.id === e.target.value); if (it) setEditType({ ...editType, items: addKitItem(editType.items, it) }); }} className="h-10 w-full rounded-xl border bg-background px-2 text-[14px]">
            <option value="">Pick from inventory…</option>
            {[...(inventory || [])].filter((x: any) => x && x.archived !== true).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))).map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.sku ? ` · ${x.sku}` : ''}</option>)}
          </select>
          <label className="block text-[13px]">Minutes to clean one <input type="number" min={0} value={editType.cleanMinutes} onChange={(e) => setEditType({ ...editType, cleanMinutes: Number(e.target.value) })} className="ml-1 h-9 w-20 rounded-lg border bg-background px-2 text-[14px]" /> <span className="text-muted-foreground">(sets the countdown, and how long a kit is held when booking)</span></label>
          <div className="flex gap-2">
            <button type="button" onClick={saveType} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background">Save contents</button>
            <button type="button" onClick={() => setEditType(null)} className="h-10 rounded-full px-3 text-[13px]">Cancel</button>
          </div>
        </div>)}
      {askFor && (
        <div className="space-y-2 rounded-2xl border-2 bg-card p-3" role="dialog" aria-label="Who is this kit for?">
          <p className="text-[14px] font-semibold">Who is {askFor.kit.name} {askFor.kit.code} for?</p>
          <div className="flex flex-wrap gap-2">
            {askFor.who.map((v) => <button key={v.id} type="button" disabled={busy === askFor.kit.id} onClick={() => move(askFor.kit, 'in_use', undefined, v)} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40">{v.clientName}{v.stage === 'in_service' ? ' · in service' : ' · waiting'}</button>)}
            <button type="button" onClick={() => move(askFor.kit, 'in_use')} className="h-10 rounded-full border px-4 text-[13px]">No client</button>
            <button type="button" onClick={() => setAskFor(null)} className="h-10 rounded-full px-3 text-[13px]">Cancel</button>
          </div>
        </div>)}
      {!live.length && <p className="text-[14px] text-muted-foreground">No kits yet. {manager ? 'Add the sets of tools you rotate between clients, and the desk will show when a clean one is waiting.' : 'A manager can add them here.'}</p>}
      {(() => { const out = live.filter((k) => k.status === 'in_use'); if (!out.length) return null;
        const by = new Map<string, Kit[]>(); for (const k of out) { const key = String((k as any).staffName || 'No provider recorded'); by.set(key, [...(by.get(key) || []), k]); }
        return (<div className="space-y-1 rounded-2xl border bg-card p-3 text-[13px]">
          <p className="font-semibold">Who has what</p>
          {[...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ks]) => <p key={name}><b>{name.split(' ')[0] === 'No' ? name : name.split(' ')[0]}</b> — {ks.map((k) => `${k.name} ${k.code}${k.clientName ? ` (${k.clientName}${k.stationName ? `, ${k.stationName}` : ''})` : ''}`).join(' · ')}</p>)}
        </div>); })()}
      {supply.length > 0 && (
        <div className="space-y-1 rounded-2xl border bg-card p-3">
          {supply.map((s) => (
            <p key={s.name} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]"><span className="font-semibold">{s.name}</span>
              <span className={s.ready ? 'text-muted-foreground' : 'font-semibold text-red-700'}>{s.ready} clean of {s.total}{s.dirty ? ` · ${s.dirty} to clean` : ''}{s.cleaning ? ` · ${s.cleaning} being cleaned` : ''}{s.in_use ? ` · ${s.in_use} in use` : ''}{s.out ? ` · ${s.out} pulled out` : ''}</span>
              {(() => { const t = typeOf(types, s.name); return <span className="flex w-full items-center justify-between gap-2 text-[12px] text-muted-foreground"><span>{t?.items?.length ? `${t.items.length} item${t.items.length === 1 ? '' : 's'} in each` : 'No contents list yet'}{t?.cleanMinutes ? ` · ${t.cleanMinutes} min to clean` : ''}</span>
                {manager && <button type="button" onClick={() => setEditType({ name: t?.name || s.name, items: t?.items || [], cleanMinutes: Number(t?.cleanMinutes) || 0 })} className="h-8 rounded-full border px-3 text-[12px] font-semibold text-foreground">{t?.items?.length ? 'Edit contents' : 'Set contents'}</button>}</span>; })()}</p>))}
        </div>)}
      {(() => { const left = kitsLeftOut(live, (id) => { const a = (appts || []).find((x: any) => x.id === id); return a ? (['cancelled', 'no_show'].includes(String(a.status)) ? 'cancelled' : stageOf(a)) : null; });
        if (!left.length) return null;
        return (<div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-[13px]">
          <p className="font-semibold text-amber-900">{left.length} kit{left.length === 1 ? ' is' : 's are'} still marked in use after the visit finished.</p>
          <button type="button" disabled={!!busy} onClick={async () => { for (const k of left) await move(k, 'dirty'); }} className="h-9 rounded-full bg-amber-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Send to cleaning</button>
        </div>); })()}
      {(() => { const rows = equipment.map((i: any) => ({ i, n: live.filter((k: any) => k.inventoryItemId === i.id).length })).filter((r) => r.n > 0); const loose = live.filter((k: any) => !k.inventoryItemId).length;
        if (!rows.length && !loose) return null;
        return (<div className="space-y-1 rounded-2xl border bg-card p-3 text-[13px]">
          <p className="font-semibold">Against inventory</p>
          {rows.map(({ i, n }) => { const own = Number(i.totalStock) || 0; return <p key={i.id} className={own === n ? 'text-muted-foreground' : 'font-semibold text-amber-800'}>{i.name}: {own} owned · {n} labelled{own > n ? ` — ${own - n} not labelled yet` : own < n ? ` — ${n - own} more labelled than owned` : ''}</p>; })}
          {loose > 0 && <p className="text-amber-800">{loose} kit{loose === 1 ? ' isn’t' : 's aren’t'} linked to an inventory item.</p>}
        </div>); })()}
      {[...live].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name) || a.code.localeCompare(b.code)).map((k) => { const next = KIT_NEXT[k.status]; return (
        <div key={k.id} className="rounded-2xl border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{k.name} <span className="font-mono text-[13px] font-normal tracking-wider text-muted-foreground">{k.code}</span>{k.tagIds?.length ? <span className="ml-2 rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">tag paired</span> : null}</p>
              <p className="text-[12px] text-muted-foreground">{k.status === 'out' && k.note ? `${k.note} · ` : ''}{k.status === 'in_use' ? `${[k.clientName ? `Client: ${k.clientName}` : null, (k as any).staffName ? `Provider: ${String((k as any).staffName).split(' ')[0]}` : null, k.stationName || null].filter(Boolean).join(' · ') || 'Not tied to a client'} · ` : ''}{k.by ? `${k.by}` : ''}{k.at ? ` · ${new Date(k.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}{k.cycles ? ` · cleaned ${k.cycles}×` : ''}</p>
              {k.status === 'cleaning' && <p className="text-[13px]">Cleaning: <LiveTimer since={k.at} minutes={typeOf(types, k.name)?.cleanMinutes || 0} doneLabel="Cleaning time is up" />{kitHours(k) >= 3 ? <span className="font-semibold text-amber-800"> — is it done?</span> : null}</p>}
              {k.status === 'in_use' && <p className="text-[12px] text-muted-foreground">In use <LiveTimer since={k.at} /></p>}
              {k.lastSterilised?.passed && <p className="text-[12px] text-muted-foreground">Sterilised {new Date(k.lastSterilised.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{k.lastSterilised.device ? ` · ${k.lastSterilised.device}` : ''} · {k.lastSterilised.by}</p>}
              {k.lastCheck && <p className="text-[12px] text-muted-foreground">Contents {k.lastCheck.ok ? 'checked' : 'incomplete'} · {new Date(k.lastCheck.at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {k.lastCheck.by}</p>}
              {(k as any).inventoryName && <p className="text-[12px] text-muted-foreground">Inventory: {(k as any).inventoryName}</p>}
              {manager && !(k as any).inventoryItemId && equipment.length > 0 && (
                <select value="" aria-label="Link to inventory" onChange={async (e) => { const it: any = equipment.find((i: any) => i.id === e.target.value); if (!it) return;
                  // Links every unlinked kit of this type in one go.
                  for (const x of live.filter((y: any) => !y.inventoryItemId && sameKitType(y.name, k.name))) { try { await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', x.id), { inventoryItemId: it.id, inventoryName: it.name }); } catch { /* try again from the list */ } }
                  void logAuditClient(firestore, tenantId, { action: 'kit.linked', targetType: 'kit', targetId: k.id, actor: actor(), after: { inventoryItemId: it.id }, summary: `Linked all ${k.name} kits to inventory item ${it.name}` });
                  setMsg({ ok: true, text: `All ${k.name} kits linked to ${it.name}.` }); }} className="mt-1 h-8 rounded-lg border bg-background px-2 text-[12px]">
                  <option value="">Link to an inventory item…</option>
                  {equipment.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>)}
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONE[k.status]}`}>{KIT_LABEL[k.status]}</span>
          </div>
          {pulling === k.id ? (
            <div className="mt-2 flex gap-2">
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} placeholder="What’s wrong? (e.g. nipper is blunt)" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px]" />
              <button type="button" disabled={busy === k.id || !reason.trim()} onClick={async () => { if (await move(k, 'out', reason)) { setPulling(null); setReason(''); } }} className="h-10 rounded-xl bg-red-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Pull out</button>
              <button type="button" onClick={() => setPulling(null)} className="h-10 rounded-xl px-2 text-[13px]">Cancel</button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {next && <button type="button" disabled={busy === k.id} onClick={() => (next.to === 'in_use' ? take(k) : next.to === 'ready' ? toReady(k) : move(k, next.to))} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">{next.label}</button>}
              {(() => { const t = typeOf(types, k.name); return t?.items?.length && k.status !== 'out' && k.status !== 'cleaning' ? <button type="button" onClick={() => setChecking({ kit: k, items: t.items, have: t.items.map(() => 0), version: t.version || 1 })} className="h-9 rounded-full border px-3 text-[13px]">Check contents</button> : null; })()}
              {k.status !== 'out' && <button type="button" onClick={() => { setPulling(k.id); setReason(''); }} className="h-9 rounded-full border px-3 text-[13px] text-red-700">Something’s wrong</button>}
              {k.status === 'out' && (manager ? <>
                <button type="button" disabled={busy === k.id} onClick={() => move(k, 'dirty')} className="h-9 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50">Fixed — clean it</button>
                <button type="button" disabled={busy === k.id} onClick={() => move(k, 'ready')} className="h-9 rounded-full border px-3 text-[13px] disabled:opacity-50">Back in service</button>
                <button type="button" disabled={busy === k.id} onClick={() => move(k, 'retired')} className="h-9 rounded-full border px-3 text-[13px] text-red-700 disabled:opacity-50">Retire it</button>
              </> : <span className="self-center text-[12px] text-muted-foreground">Waiting for a manager</span>)}
            </div>)}
        </div>); })}
      {manager && (adding ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <input list="kit-types" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Kit type (e.g. Manicure kit)" aria-label="Kit type" className="h-10 w-full rounded-xl border bg-background px-3 text-[14px]" />
          <datalist id="kit-types">{typeNames.map((n) => <option key={n} value={n} />)}</datalist>
          <select value={invId} onChange={(e) => { setInvId(e.target.value); const it: any = equipment.find((i: any) => i.id === e.target.value); if (it && !newName.trim()) setNewName(String(it.name)); }} aria-label="Inventory item" className="h-10 w-full rounded-xl border bg-background px-2 text-[14px]">
            <option value="">Not linked to an inventory item</option>
            {equipment.map((i: any) => <option key={i.id} value={i.id}>{i.name} — {Number(i.totalStock) || 0} owned</option>)}
          </select>
          <p className="text-[12px] text-muted-foreground">Link the kits to their equipment item in Inventory so what you own and what’s labelled can be checked against each other, and a retired kit comes off your stock.</p>
          <p className="text-[12px] text-muted-foreground">Use the same name as the “Tools / kit” line on the service, so the desk can warn when none is clean.</p>
          <div className="flex items-center gap-2">
            <label className="text-[13px]">How many <input type="number" min={1} max={30} value={howMany} onChange={(e) => setHowMany(Number(e.target.value))} className="ml-1 h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /></label>
            <button type="button" disabled={busy === 'add' || !newName.trim()} onClick={add} className="h-10 rounded-xl bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40">Add</button>
            <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-xl px-2 text-[13px]">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAdding(true)} className="h-10 rounded-full border px-4 text-[13px] font-semibold">+ Add kits</button>
          {live.length > 0 && <span className="flex items-center gap-1"><select value={fmt} onChange={(e) => setFmt(e.target.value as LabelFormat)} aria-label="Label shape" title={LABEL_FORMATS.find((f) => f.id === fmt)?.hint} className="h-10 rounded-full border bg-background px-3 text-[13px]">{LABEL_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select><button type="button" onClick={printLabels} className="h-10 rounded-full border px-4 text-[13px] font-semibold">Print</button></span>}
        </div>))}
    </div>);
}

/** Kits on the Inventory page: the same screen, loading its own kits (set-up, labels, the check against stock). */
export function KitsManager({ tenantId, services, inventory, manager }: { tenantId: string; services: any[]; inventory: any[]; manager: boolean }) {
  const { firestore } = useFirebase();
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'kits') : null), [firestore, tenantId]);
  const { data: kits } = useCollection<any>(q); const { selectedTenant: tenantForRecords } = useTenant() as any;
  if (!firestore) return null;
  return (<div className="space-y-8">
    <section><h3 className="mb-2 text-[15px] font-semibold">Kits</h3><Kits firestore={firestore} tenantId={tenantId} kits={kits || []} services={services} inventory={inventory} manager={manager} /></section>
    <section><h3 className="mb-2 text-[15px] font-semibold">Sterilisation records</h3><Sterilisation tenantId={tenantId} tenant={tenantForRecords} kits={kits || []} manager={manager} /></section>
    <section><h3 className="mb-2 text-[15px] font-semibold">Linens & laundry</h3><Linens tenantId={tenantId} services={services} inventory={inventory} manager={manager} /></section>
    {manager && <section><h3 className="mb-2 text-[15px] font-semibold">RFID & NFC tags</h3><TagPairing tenantId={tenantId} inventory={inventory} /></section>}
  </div>);
}
