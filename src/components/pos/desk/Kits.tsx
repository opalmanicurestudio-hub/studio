'use client';
// src/components/pos/desk/Kits.tsx — KITS at the desk (O5): how many of each kit are clean, in use, waiting to be cleaned
// or pulled out; type or scan a label to move one along; pull one out with a reason (a manager decides what happens next).
import * as React from 'react';
import { doc, updateDoc, setDoc, collection, arrayUnion, runTransaction } from 'firebase/firestore';
import { logAuditClient } from '@/lib/audit-client';
import { getAuth } from 'firebase/auth';
import { KIT_LABEL, KIT_NEXT, findKit, kitSupply, moveKit, newKitCode, kitsNeeded, kitCandidates, type Kit, type KitStatus } from '@/lib/kits';
import { stageOf } from '@/lib/visit';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';

const TONE: Record<KitStatus, string> = { ready: 'bg-emerald-100 text-emerald-800', in_use: 'bg-sky-100 text-sky-800', dirty: 'bg-amber-100 text-amber-900', cleaning: 'bg-violet-100 text-violet-900', out: 'bg-red-100 text-red-800', retired: 'bg-muted text-muted-foreground' };
const ORDER: KitStatus[] = ['out', 'dirty', 'cleaning', 'in_use', 'ready'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function Kits({ firestore, tenantId, kits, services, manager, appts = [], inventory = [] }: { firestore: any; tenantId: string; kits: Kit[]; services: any[]; manager: boolean; appts?: any[]; inventory?: any[] }) {
  const [invId, setInvId] = React.useState('');   // the inventory item the new kits are units of
  const equipment = React.useMemo(() => (inventory || []).filter((i: any) => i?.type === 'equipment' && i.archived !== true).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [inventory]);
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who().name, role: manager ? 'manager' : 'staff' });
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
    const res = moveKit(k, to, who(), { note, visitId: forVisit?.id, clientName: forVisit?.clientName });
    if ('error' in res) { setMsg({ ok: false, text: res.error }); return false; }
    setBusy(k.id);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), res.patch as any);
      // The visit remembers which kit was used on this client (for the record, and so they aren't offered a second one).
      if (to === 'in_use' && forVisit) { try { await updateDoc(doc(firestore, 'tenants', tenantId, 'appointments', forVisit.id), { kits: arrayUnion({ id: k.id, name: k.name, code: k.code, at: new Date().toISOString(), by: who().name }) }); } catch { /* the kit is still marked in use */ } }
      // Every move is on the business's audit log (who, when, from → to, why, for whom).
      void logAuditClient(firestore, tenantId, { action: `kit.${to}`, targetType: 'kit', targetId: k.id, actor: actor(), before: { status: k.status }, after: { status: to, visitId: forVisit?.id || null, inventoryItemId: (k as any).inventoryItemId || null },
        summary: `${k.name} ${k.code}: ${KIT_LABEL[k.status]} → ${KIT_LABEL[to]}${forVisit ? ` for ${forVisit.clientName}` : ''}${note ? ` — ${String(note).trim()}` : to === 'retired' && k.note ? ` — ${k.note}` : ''}` });
      // A retired kit leaves inventory: one fewer owned, with a stock movement saying why.
      if (to === 'retired' && (k as any).inventoryItemId) { try { await runTransaction(firestore, async (txn: any) => { const ref = doc(firestore, 'tenants', tenantId, 'inventory', (k as any).inventoryItemId); const snap = await txn.get(ref); if (!snap.exists()) return;
          const have = Number(snap.data()?.totalStock) || 0; txn.update(ref, { totalStock: Math.max(0, have - 1) });
          txn.set(doc(collection(firestore, 'tenants', tenantId, 'stockMovements')), { id: `mv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, productId: ref.id, productName: snap.data()?.name || k.name, qty: 1, from: `kit ${k.code}`, to: 'retired', kind: 'adjust', actorId: getAuth().currentUser?.uid || null, actorName: who().name, at: new Date().toISOString(), note: k.note || 'Kit retired' }); }); } catch { /* the kit is retired either way; stock can be corrected in Inventory */ } }
      setMsg({ ok: true, text: `${k.name} ${k.code} — ${KIT_LABEL[to].toLowerCase()}${to === 'in_use' ? (forVisit ? ` for ${forVisit.clientName}` : ' (not tied to a client)') : ''}` }); setAskFor(null); setBusy(null); return true; }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); setBusy(null); return false; }
  };
  const onScan = async (ev: React.FormEvent) => { ev.preventDefault();
    const k = findKit(live, typed); setTyped('');
    if (!k) { setMsg({ ok: false, text: 'No kit with that code.' }); return; }
    const next = KIT_NEXT[k.status]; if (!next) { setMsg({ ok: false, text: `${k.name} ${k.code} is pulled out — a manager decides what happens next.` }); return; }
    if (next.to === 'in_use') await take(k); else await move(k, next.to); };
  const add = async () => { const name = newName.trim().slice(0, 60); const n = Math.max(1, Math.min(30, Math.round(howMany) || 1)); if (!name) return;
    const inv: any = equipment.find((i: any) => i.id === invId) || null;
    setBusy('add'); const taken = (kits || []).map((k) => k.code); const at = new Date().toISOString();
    try { for (let i = 0; i < n; i++) { const code = newKitCode(taken); taken.push(code); const ref = doc(collection(firestore, 'tenants', tenantId, 'kits'));
        await setDoc(ref, { id: ref.id, name, code, status: 'ready', by: who().name, at, cycles: 0, history: [], createdAt: at, inventoryItemId: inv?.id || null, inventoryName: inv?.name || null });
        void logAuditClient(firestore, tenantId, { action: 'kit.added', targetType: 'kit', targetId: ref.id, actor: actor(), after: { status: 'ready', inventoryItemId: inv?.id || null }, summary: `Added ${name} ${code}${inv ? ` (inventory: ${inv.name})` : ' (not linked to inventory)'}` }); }
      setMsg({ ok: true, text: `Added ${n} × ${name}. Print their labels below.` }); setAdding(false); setNewName(''); setHowMany(1); setInvId(''); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(null); };
  const printLabels = async () => {
    const QRCode = (await import('qrcode')).default; const JsBarcode = (await import('jsbarcode')).default;
    // Each label carries both: a barcode (any handheld scanner) and a square code (a phone or tablet camera).
    const bar = (code: string) => { try { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); JsBarcode(svg, code, { format: 'CODE128', displayValue: false, height: 34, width: 1.6, margin: 0 }); return svg.outerHTML; } catch { return ''; } };
    const cells = await Promise.all(live.map(async (k) => `<div class="l"><img src="${await QRCode.toDataURL(k.code, { margin: 1, width: 160 })}" alt=""/><div><b>${esc(k.name)}</b>${bar(k.code)}<span>${esc(k.code)}</span></div></div>`));
    const w = window.open('', '_blank'); if (!w) { setMsg({ ok: false, text: 'Allow pop-ups to print labels.' }); return; }
    w.document.write(`<!doctype html><title>Kit labels</title><style>body{font-family:system-ui,sans-serif;margin:12px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.l{display:flex;align-items:center;gap:10px;border:1px solid #999;border-radius:8px;padding:8px;break-inside:avoid}.l img{width:64px;height:64px}.l b{display:block;font-size:13px;margin-bottom:4px}.l svg{display:block;max-width:100%}.l span{font:700 15px ui-monospace,monospace;letter-spacing:3px}</style><div class="g">${cells.join('')}</div><script>onload=()=>print()<\/script>`);
    w.document.close(); };

  return (
    <div className="space-y-3">
      <form onSubmit={onScan} className="flex gap-2">
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 80))} placeholder="Scan or type a kit’s code" aria-label="Kit code" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px] uppercase tracking-wider" />
        <button type="submit" disabled={!typed.trim()} className="h-11 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40">Move it on</button>
      </form>
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
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
      {supply.length > 0 && (
        <div className="space-y-1 rounded-2xl border bg-card p-3">
          {supply.map((s) => (
            <p key={s.name} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]"><span className="font-semibold">{s.name}</span>
              <span className={s.ready ? 'text-muted-foreground' : 'font-semibold text-red-700'}>{s.ready} clean of {s.total}{s.dirty ? ` · ${s.dirty} to clean` : ''}{s.cleaning ? ` · ${s.cleaning} being cleaned` : ''}{s.in_use ? ` · ${s.in_use} in use` : ''}{s.out ? ` · ${s.out} pulled out` : ''}</span></p>))}
        </div>)}
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
              <p className="truncate text-[15px] font-semibold">{k.name} <span className="font-mono text-[13px] font-normal tracking-wider text-muted-foreground">{k.code}</span></p>
              <p className="text-[12px] text-muted-foreground">{k.status === 'out' && k.note ? `${k.note} · ` : ''}{k.status === 'in_use' && k.clientName ? `With ${k.clientName} · ` : ''}{k.by ? `${k.by}` : ''}{k.at ? ` · ${new Date(k.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}{k.cycles ? ` · cleaned ${k.cycles}×` : ''}</p>
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
              {next && <button type="button" disabled={busy === k.id} onClick={() => (next.to === 'in_use' ? take(k) : move(k, next.to))} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">{next.label}</button>}
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
          {live.length > 0 && <button type="button" onClick={printLabels} className="h-10 rounded-full border px-4 text-[13px]">Print labels</button>}
        </div>))}
    </div>);
}

/** Kits on the Inventory page: the same screen, loading its own kits (set-up, labels, the check against stock). */
export function KitsManager({ tenantId, services, inventory, manager }: { tenantId: string; services: any[]; inventory: any[]; manager: boolean }) {
  const { firestore } = useFirebase();
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'kits') : null), [firestore, tenantId]);
  const { data: kits } = useCollection<any>(q);
  if (!firestore) return null;
  return <Kits firestore={firestore} tenantId={tenantId} kits={kits || []} services={services} inventory={inventory} manager={manager} />;
}
