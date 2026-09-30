'use client';
// src/components/host/TableTab.tsx — THE TAB for a seated table (Host Stand). Add from your catalog (with a seat and a
// note — food and drink go to the kitchen screen), take off what the kitchen hasn't started, and "Check out" fills the
// normal checkout with the tab: split by seat or item, cash / card / the iPad / their phone, tip on the whole meal.
import * as React from 'react';
import { collection, doc, getDocs, onSnapshot, type Firestore } from 'firebase/firestore';
import { addToTab, ensureTableVisit, removeFromTab, tabTotal, type TabLine } from '@/lib/table-tab';

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export function TableTab({ firestore, tenantId, party, tableName, by }: { firestore: Firestore; tenantId: string; party: any; tableName: string; by: string }) {
  const [visitId, setVisitId] = React.useState<string | null>(null); const [tab, setTab] = React.useState<TabLine[]>([]);
  const [catalog, setCatalog] = React.useState<any[]>([]); const [q, setQ] = React.useState(''); const [seat, setSeat] = React.useState(''); const [note, setNote] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { let un: any = null; ensureTableVisit(firestore, tenantId, party, tableName, by).then((id) => { setVisitId(id);
    un = onSnapshot(doc(firestore, 'tenants', tenantId, 'appointments', id), (s) => setTab(((s.data() as any)?.tab || []) as TabLine[]), () => {}); }).catch(() => setMsg('The table’s visit couldn’t be opened.'));
    return () => { if (un) un(); }; }, [firestore, tenantId, party.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { Promise.all([getDocs(collection(firestore, `tenants/${tenantId}/inventory`)), getDocs(collection(firestore, `tenants/${tenantId}/services`))]).then(([inv, sv]) => {
    const prods = inv.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => !x.isBackbar && !x.backbar && x.isArchived !== true && !x.hasVariants);
    const svcs = sv.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => x.isActive !== false && !x.archived);
    setCatalog([...prods.map((x: any) => ({ id: x.id, type: 'product', name: x.name || 'Item', price: Number(x.msrp ?? x.price) || 0, category: x.category || x.department || '' })),
      ...svcs.map((x: any) => ({ id: x.id, type: 'service', name: x.name || 'Service', price: Number(x.price) || 0, category: x.category || '' }))]); }).catch(() => {}); }, [firestore, tenantId]);
  const add = async (it: any) => { if (!visitId) return; setBusy(true); setMsg(null);
    try { await addToTab(firestore, tenantId, visitId, { tableName, guestName: party.name || 'Table' }, it, { seat: seat || null, note: note.trim() || null, by }); setNote(''); setMsg(`${it.name} added${it.type === 'product' ? ' — sent to the kitchen' : ''}.`); } catch { setMsg('That didn’t save.'); }
    setBusy(false); };
  const remove = async (l: TabLine) => { if (!visitId) return; const r = await removeFromTab(firestore, tenantId, visitId, l); setMsg(r.ok ? `${l.name} taken off.` : r.message || 'That didn’t work.'); };
  const t = q.trim().toLowerCase(); const shown = t ? catalog.filter((x) => x.name.toLowerCase().includes(t) || String(x.category).toLowerCase().includes(t)).slice(0, 24) : catalog.slice(0, 12);
  const seats = Array.from({ length: Math.max(1, Math.min(20, Number(party.size) || 1)) }, (_, i) => String(i + 1));
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const on = { background: 'var(--accent)', color: 'var(--accent-ink)' } as React.CSSProperties;
  const bySeat = tab.reduce((m: Record<string, TabLine[]>, l) => { const k = l.seat ? `Seat ${l.seat}` : 'Table'; (m[k] = m[k] || []).push(l); return m; }, {});
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-3xl p-4" style={box}>
        <div className="flex items-baseline justify-between"><p className="text-[18px] font-semibold">{tableName} · {party.name}</p><p className="text-[18px] font-semibold tabular-nums">{money(tabTotal(tab))}</p></div>
        {!tab.length ? <p className="text-[14px]" style={muted}>Nothing on the tab yet.</p> : Object.entries(bySeat).map(([k, ls]) => <div key={k} className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide" style={muted}>{k}</p>
          {ls.map((l) => <div key={l.lineId} className="flex items-center justify-between gap-2 text-[15px]"><span>{l.name}{l.note ? <span style={muted}> · {l.note}</span> : null}</span>
            <span className="flex items-center gap-2"><span className="tabular-nums">{money(l.price)}</span><button type="button" onClick={() => remove(l)} aria-label={`Take ${l.name} off`} className="h-8 rounded-full px-2 text-[12px]" style={soft}>Remove</button></span></div>)}
        </div>)}
      </section>
      <section className="space-y-2 rounded-3xl p-4" style={box}>
        <div className="flex flex-wrap gap-1.5"><button type="button" aria-pressed={!seat} onClick={() => setSeat('')} className="h-8 rounded-full px-3 text-[12px]" style={!seat ? on : soft}>Table</button>
          {seats.map((s) => <button key={s} type="button" aria-pressed={seat === s} onClick={() => setSeat(s)} className="h-8 rounded-full px-2 text-[12px]" style={seat === s ? on : soft}>Seat {s}</button>)}</div>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 80))} placeholder="Note for the kitchen (optional) — e.g. no onions" aria-label="Note" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
        <div className="grid grid-cols-2 gap-2">{shown.map((it) => <button key={`${it.type}:${it.id}`} type="button" disabled={busy || !visitId} onClick={() => add(it)} className="rounded-2xl p-3 text-left disabled:opacity-40" style={soft}>
          <span className="block text-[14px] font-semibold">{it.name}</span><span className="block text-[12px] tabular-nums" style={muted}>{money(it.price)}</span></button>)}</div>
      </section>
      {msg && <p className="text-[14px] font-semibold" role="status">{msg}</p>}
      <a href={visitId ? `/pos?checkout=${encodeURIComponent(visitId)}&tab=1` : '#'} aria-disabled={!visitId || !tab.length}
        className={`flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold ${!visitId || !tab.length ? 'pointer-events-none opacity-40' : ''}`} style={on}>Check out {tableName} — {money(tabTotal(tab))}</a>
    </div>
  );
}
