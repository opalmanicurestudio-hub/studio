'use client';
// src/components/orders/TagsSheet.tsx — THE SHOP'S OWN TAGS ON AN ORDER ("Fragile", "VIP", "Call first"), and THE TEAM'S
// NOTE on it. Tags are the team's words for sorting and finding orders (the list filters and searches by them, and the
// packing slip prints them); the note is for whoever touches the order next. Both go on the order's record with who
// changed them. The tags offered are the ones the shop already uses, so the same tag is spelled the same way.
import * as React from 'react';
import { collection, doc, writeBatch, type Firestore } from 'firebase/firestore';
import { customTags } from '@/lib/order-tags';
import { Btn, C, Sheet, feel, muted } from './ui';

type Actor = { id: string; name: string };
const field = 'h-12 w-full rounded-2xl border px-4 text-[17px] font-normal';

async function record(fs: Firestore, tenantId: string, orderId: string, patch: Record<string, any>, actor: Actor, kind: string, text: string) {
  const oRef = doc(fs, `tenants/${tenantId}/retailOrders`, orderId);
  const b = writeBatch(fs);
  b.update(oRef, patch);
  const ev = doc(collection(oRef, 'events'));
  b.set(ev, { id: ev.id, type: 'note', at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, meta: { kind, text } });
  await b.commit();
}

export function TagsSheet({ fs, tenantId, order, all, rs, actor, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; all: any[]; rs: any; actor: Actor; onClose: () => void; onDone: (m: string) => void }) {
  const mine = customTags(order);
  const known = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of [...(Array.isArray(rs?.orderTags) ? rs.orderTags : []), ...all.flatMap((o) => customTags(o)), ...mine]) { const k = String(t).toLowerCase(); if (!seen.has(k)) seen.set(k, String(t)); }
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 40);
  }, [all, rs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [on, setOn] = React.useState<string[]>(mine);
  const [typed, setTyped] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const has = (t: string) => on.some((x) => x.toLowerCase() === t.toLowerCase());
  const flip = (t: string) => setOn(has(t) ? on.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...on, t]);
  const addTyped = () => { const t = typed.trim().replace(/\s+/g, ' ').slice(0, 30); if (!t) return; if (!has(t)) setOn([...on, t]); setTyped(''); };
  const list = [...known, ...on.filter((t) => !known.some((k) => k.toLowerCase() === t.toLowerCase()))];
  const save = async () => {
    const next = customTags({ tags: typed.trim() ? [...on, typed.trim()] : on });
    const added = next.filter((t) => !mine.some((m) => m.toLowerCase() === t.toLowerCase()));
    const removed = mine.filter((m) => !next.some((t) => t.toLowerCase() === m.toLowerCase()));
    if (!added.length && !removed.length) { onClose(); return; }
    setBusy(true); setErr('');
    try {
      await record(fs, tenantId, order.id, { tags: next }, actor, 'tags', [added.length ? `Tagged ${added.join(', ')}` : '', removed.length ? `took off ${removed.join(', ')}` : ''].filter(Boolean).join('; '));
      feel(true); onDone(next.length ? `Tags: ${next.join(', ')}.` : 'Tags taken off.');
    } catch { setErr('That didn’t save. Try again.'); feel(false); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Tags" sub="Your own words for sorting and finding orders. They print on the packing slip." onClose={onClose}>
      {list.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
        {list.map((t) => { const sel = has(t); return <button key={t.toLowerCase()} type="button" aria-pressed={sel} onClick={() => flip(t)} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={sel ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{t}</button>; })}
      </div>}
      <div className="mt-4 flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} placeholder="A new tag, like Fragile" aria-label="A new tag" className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
        <Btn kind="soft" onClick={addTyped}>Add</Btn>
      </div>
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
    </Sheet>);
}

export function NoteSheet({ fs, tenantId, order, actor, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; actor: Actor; onClose: () => void; onDone: (m: string) => void }) {
  const [text, setText] = React.useState(String(order.staffNote?.text || ''));
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const save = async (clear = false) => {
    const t = clear ? '' : text.trim().slice(0, 500);
    if (!clear && !t) { setErr('Write the note first.'); return; }
    setBusy(true); setErr('');
    try {
      await record(fs, tenantId, order.id, { staffNote: t ? { text: t, by: actor.name, at: new Date().toISOString() } : null }, actor, 'staff_note', t ? `Note: ${t}` : 'Note taken off');
      feel(true); onDone(t ? 'Note saved on the order.' : 'Note taken off.');
    } catch { setErr('That didn’t save. Try again.'); feel(false); } finally { setBusy(false); }
  };
  return (
    <Sheet title="A note for the team" sub="Whoever opens this order next sees it at the top, and it prints on the pickup slip. The customer never sees it." onClose={onClose}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Note" placeholder="For example: she’ll send her sister to collect it" className="mt-2 w-full rounded-2xl border px-4 py-3 text-[17px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
      <p className="m-0 mt-1 text-[13px]" style={muted}>{text.length}/500</p>
      <Btn kind="primary" className="mt-3 w-full text-[17px]" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save the note'}</Btn>
      {order.staffNote?.text && <Btn kind="soft" className="mt-2 w-full" disabled={busy} onClick={() => void save(true)}>Take the note off</Btn>}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
    </Sheet>);
}
