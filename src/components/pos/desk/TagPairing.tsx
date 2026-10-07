'use client';
// src/components/pos/desk/TagPairing.tsx — PAIR AN RFID / NFC TAG to a kit, a linen bundle or a product. Two steps:
// say which item (scan its printed label or SKU, or pick it), then read the tag (RFID reader, or tap with the phone).
// After that the tag works in every scan box exactly like the printed code. One tag can only ever mean one item.
import * as React from 'react';
import { doc, updateDoc, collection, arrayUnion } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { findKit, matchInventory } from '@/lib/kits';
import { findBundle } from '@/lib/linens';
import { normTag, tagOwner, looksLikeTag, type TagOwner } from '@/lib/tags';
import { useNfc } from '@/lib/use-nfc';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';

const COLL: Record<TagOwner['kind'], string> = { kit: 'kits', bundle: 'linenBundles', product: 'inventory' };

export function TagPairing({ tenantId, inventory }: { tenantId: string; inventory: any[] }) {
  const { firestore } = useFirebase();
  const kq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'kits') : null), [firestore, tenantId]);
  const bq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'linenBundles') : null), [firestore, tenantId]);
  const { data: kits } = useCollection<any>(kq); const { data: bundles } = useCollection<any>(bq);
  const [target, setTarget] = React.useState<{ kind: TagOwner['kind']; id: string } | null>(null);
  const [typed, setTyped] = React.useState(''); const [cam, setCam] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const all = { kits: kits || [], bundles: bundles || [], inventory: inventory || [] };
  // The item being paired, read live so its tag list updates as tags are added.
  const item: TagOwner | null = React.useMemo(() => { if (!target) return null;
    if (target.kind === 'kit') { const k = all.kits.find((x: any) => x.id === target.id); return k ? { kind: 'kit', id: k.id, name: `${k.name} ${k.code}`, item: k } : null; }
    if (target.kind === 'bundle') { const b = all.bundles.find((x: any) => x.id === target.id); return b ? { kind: 'bundle', id: b.id, name: `${b.name} bundle ${b.code}`, item: b } : null; }
    const p = all.inventory.find((x: any) => x.id === target.id); return p ? { kind: 'product', id: p.id, name: String(p.name), item: p } : null; }, [target, kits, bundles, inventory]);   // eslint-disable-line react-hooks/exhaustive-deps
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];

  const handle = async (raw: string) => { if (!firestore) return;
    if (!item) {   // step 1: which item?
      const k = findKit(all.kits, raw); const b = k ? null : findBundle(all.bundles, raw); const p = k || b ? null : matchInventory(all.inventory, raw);
      if (k) setTarget({ kind: 'kit', id: k.id }); else if (b) setTarget({ kind: 'bundle', id: b.id }); else if (p) setTarget({ kind: 'product', id: p.id });
      else { scanFeedback(false); setMsg({ ok: false, text: 'Nothing matches that. Scan the item’s printed label or SKU, or pick it from the list.' }); return; }
      scanFeedback(true); setMsg(null); return; }
    // step 2: the tag
    const tag = normTag(raw);
    if (!looksLikeTag(raw)) { scanFeedback(false); setMsg({ ok: false, text: 'That doesn’t look like a tag ID.' }); return; }
    if (tag === normTag(item.item.code) || tag === normTag(item.item.sku)) { scanFeedback(false); setMsg({ ok: false, text: 'That’s this item’s printed code — now read the tag itself.' }); return; }
    const owner = tagOwner(tag, all);
    if (owner) { scanFeedback(owner.id === item.id); setMsg({ ok: owner.id === item.id, text: owner.id === item.id ? 'That tag is already paired to this item.' : `That tag already belongs to ${owner.name}. Remove it there first.` }); return; }
    try { await updateDoc(doc(firestore, 'tenants', tenantId, COLL[item.kind], item.id), { tagIds: arrayUnion(tag) });
      void logAuditClient(firestore, tenantId, { action: 'tag.paired', targetType: item.kind, targetId: item.id, actor: { type: 'user', id: getAuth().currentUser?.uid, name: who() }, after: { tag }, summary: `Paired tag ${tag} to ${item.name}` });
      scanFeedback(true); setMsg({ ok: true, text: `Paired to ${item.name}. Read another tag for it, or choose a different item.` }); }
    catch { scanFeedback(false); setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const remove = async (tag: string) => { if (!firestore || !item) return;
    try { await updateDoc(doc(firestore, 'tenants', tenantId, COLL[item.kind], item.id), { tagIds: (item.item.tagIds || []).filter((x: string) => normTag(x) !== normTag(tag)) });
      void logAuditClient(firestore, tenantId, { action: 'tag.removed', targetType: item.kind, targetId: item.id, actor: { type: 'user', id: getAuth().currentUser?.uid, name: who() }, before: { tag }, summary: `Removed tag ${tag} from ${item.name}` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const nfc = useNfc((id) => { void handle(id); });
  if (!firestore) return null;

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">{item ? <>Now read the tag for <b className="text-foreground">{item.name}</b> — with your RFID reader, or tap it with the phone.</> : 'First, which item? Scan its printed label or SKU, or pick it below.'}</p>
      <form onSubmit={(e) => { e.preventDefault(); const v = typed; setTyped(''); if (v.trim()) void handle(v); }} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 80))} placeholder={item ? 'Read or type the tag’s ID' : 'Scan or type a label, tag or SKU'} aria-label={item ? 'Tag ID' : 'Item code'} autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px] uppercase tracking-wider" />
        <button type="submit" disabled={!typed.trim()} className="h-11 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40">{item ? 'Pair' : 'Find'}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {!item && <button type="button" onClick={() => setCam((c) => !c)} className="h-10 flex-1 rounded-xl border text-[13px] font-semibold">{cam ? 'Close the camera' : 'Scan the label with the camera'}</button>}
        {nfc.supported && <button type="button" onClick={() => (nfc.on ? nfc.end() : nfc.start())} className="h-10 flex-1 rounded-xl border text-[13px] font-semibold">{nfc.on ? 'Stop reading NFC' : 'Tap NFC tags with this phone'}</button>}
      </div>
      {cam && !item && <ScanGate onScan={(v) => { void handle(v); }} label="Point the camera at the item’s label" />}
      {nfc.on && <p className="text-[13px] text-emerald-700" role="status">Ready — hold a tag against the back of the phone.</p>}
      {nfc.error && <p className="text-[13px] text-red-700" role="alert">{nfc.error}</p>}
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {!item && (
        <select value="" aria-label="Pick an item" onChange={(e) => { const [kind, id] = e.target.value.split('|'); if (id) { setTarget({ kind: kind as TagOwner['kind'], id }); setMsg(null); } }} className="h-10 w-full rounded-xl border bg-background px-2 text-[14px]">
          <option value="">Pick an item…</option>
          <optgroup label="Kits">{all.kits.filter((k: any) => k.status !== 'retired').map((k: any) => <option key={k.id} value={`kit|${k.id}`}>{k.name} {k.code}</option>)}</optgroup>
          <optgroup label="Linen bundles">{all.bundles.map((b: any) => <option key={b.id} value={`bundle|${b.id}`}>{b.name} bundle {b.code}</option>)}</optgroup>
          <optgroup label="Products">{[...all.inventory].filter((p: any) => p && p.archived !== true).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))).map((p: any) => <option key={p.id} value={`product|${p.id}`}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}</optgroup>
        </select>)}
      {item && (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <p className="text-[14px] font-semibold">{item.name}</p>
          {(item.item.tagIds || []).length === 0 ? <p className="text-[13px] text-muted-foreground">No tags paired yet.</p>
            : <ul className="space-y-1">{(item.item.tagIds || []).map((t: string) => <li key={t} className="flex items-center justify-between gap-2 text-[13px]"><span className="font-mono tracking-wider">{t}</span><button type="button" onClick={() => remove(t)} className="h-8 rounded-lg px-2 text-red-700">Remove</button></li>)}</ul>}
          <button type="button" onClick={() => { setTarget(null); setMsg(null); }} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Choose a different item</button>
        </div>)}
    </div>);
}
