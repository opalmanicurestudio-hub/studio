'use client';
// src/components/clients/ClientPeople.tsx — PEOPLE LINKED TO THIS CLIENT, and what each may do for the other.
// "Guardian of Mia · may book, pay, sign forms…" — add a link (search a client, choose how they're connected; the
// permissions start from that kind and can be changed), change permissions or an end date, or end it (kept on record).
import * as React from 'react';
import { KINDS, PERMISSIONS, type RelKind, type RelPermission } from '@/lib/relationships';

async function call(body: any) { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/clients/relationships', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null); }

export function ClientPeople({ tenantId, client, clients, onCount, onOpenClient }: { tenantId: string; client: any; clients: any[]; onCount?: (n: number) => void; onOpenClient?: (id: string) => void }) {
  const [rows, setRows] = React.useState<any[] | null>(null); const [err, setErr] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false); const [q, setQ] = React.useState(''); const [other, setOther] = React.useState<any>(null);
  const [kind, setKind] = React.useState<RelKind>('household'); const [dir, setDir] = React.useState<'me' | 'them'>('me'); const [perms, setPerms] = React.useState<RelPermission[]>(KINDS.household.defaults);
  const [editing, setEditing] = React.useState<string | null>(null); const [editPerms, setEditPerms] = React.useState<RelPermission[]>([]); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const r: any = await call({ tenantId, action: 'list', clientId: client.id }); if (r?.ok) { setRows(r.rows); onCount?.(r.rows.filter((x: any) => x.active).length); } else { setRows([]); setErr(r?.error || 'Couldn’t load linked people.'); } }, [tenantId, client.id, onCount]);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { setPerms(KINDS[kind].defaults); }, [kind]);
  const matches = q.trim().length < 2 ? [] : clients.filter((c) => c.id !== client.id && String(c.name || '').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties; const line = { borderColor: 'var(--line, #e7e2dc)' } as React.CSSProperties;
  const label = (p: RelPermission) => PERMISSIONS.find((x) => x.key === p)?.label || p;
  const save = async () => { if (!other) return; setBusy(true); setErr(null);
    const r: any = await call({ tenantId, action: 'add', fromId: dir === 'me' ? client.id : other.id, toId: dir === 'me' ? other.id : client.id, kind, permissions: perms });
    setBusy(false); if (!r?.ok) { setErr(r?.error || 'Couldn’t save that.'); return; } setAdding(false); setOther(null); setQ(''); void load(); };
  const first = String(client.name || 'This client').split(' ')[0];
  return (
    <section className="space-y-3 rounded-3xl border p-4 sm:p-5" style={{ ...line, background: 'var(--card, #fff)' }} aria-label="Linked people">
      <div className="flex items-center justify-between gap-2"><h3 className="text-[17px] font-semibold">People</h3>{!adding && <button type="button" onClick={() => setAdding(true)} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>+ Link someone</button>}</div>
      {err && <p className="text-[13px]" style={{ color: 'var(--warn, #b45309)' }}>{err}</p>}
      {rows === null ? <p className="text-[14px]" style={muted}>Loading…</p> : rows.length === 0 && !adding ? <p className="text-[14px]" style={muted}>No one linked — guardians, households, people who book or pay for {first}.</p> : null}
      {(rows || []).map((r) => (
        <div key={r.id} className="space-y-1.5 border-t pt-3" style={{ ...line, opacity: r.active ? 1 : 0.55 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[15px]">{first} is <b>{r.words.toLowerCase()}</b> {onOpenClient ? <button type="button" onClick={() => onOpenClient(r.otherId)} className="font-semibold underline underline-offset-2">{r.otherName}</button> : <b>{r.otherName}</b>}{!r.active && <span style={muted}> · ended</span>}{r.derived && <span style={muted}> · from their booking</span>}</p>
            {r.active && !r.derived && <span className="flex gap-3 text-[13px]"><button type="button" onClick={() => { setEditing(editing === r.id ? null : r.id); setEditPerms(r.permissions || []); }} className="font-semibold underline underline-offset-2">Permissions</button>
              <button type="button" onClick={async () => { if (!window.confirm(`End this link with ${r.otherName}? It stays on record.`)) return; await call({ tenantId, action: 'end', id: r.id }); void load(); }} style={muted}>End</button></span>}
          </div>
          {(r.permissions || []).length > 0 && <p className="text-[13px]" style={muted}>{r.mayDoForOther.length ? `${first} may: ` : `${r.otherName.split(' ')[0]} may: `}{(r.permissions || []).map(label).join(' · ')}</p>}
          {editing === r.id && <div className="space-y-2 rounded-2xl p-3" style={{ background: 'var(--soft, #efebe6)' }}>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{PERMISSIONS.map((p) => <label key={p.key} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={editPerms.includes(p.key)} onChange={(e) => setEditPerms(e.target.checked ? [...editPerms, p.key] : editPerms.filter((x) => x !== p.key))} className="h-4 w-4" />{p.label}</label>)}</div>
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); await call({ tenantId, action: 'update', id: r.id, permissions: editPerms }); setBusy(false); setEditing(null); void load(); }} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Save permissions</button>
          </div>}
        </div>))}
      {adding && <div className="space-y-3 rounded-2xl border p-3" style={line}>
        {!other ? <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a client by name" aria-label="Search a client" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={line} />
          <div className="flex flex-wrap gap-2">{matches.map((c) => <button key={c.id} type="button" onClick={() => setOther(c)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>{c.name}</button>)}{q.trim().length >= 2 && !matches.length && <span className="text-[13px]" style={muted}>No client by that name — add them as a client first.</span>}</div>
        </> : <>
          <div className="flex flex-wrap items-center gap-2 text-[15px]">
            <select value={dir} onChange={(e) => setDir(e.target.value as any)} aria-label="Who" className="h-10 rounded-xl border px-2" style={line}><option value="me">{first}</option><option value="them">{other.name}</option></select>
            <span>is</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as RelKind)} aria-label="How they’re connected" className="h-10 rounded-xl border px-2" style={line}>{(Object.keys(KINDS) as RelKind[]).map((k) => <option key={k} value={k}>{KINDS[k].label.toLowerCase()}</option>)}</select>
            <b>{dir === 'me' ? other.name : first}</b>
          </div>
          <p className="text-[13px]" style={muted}>{KINDS[kind].hint}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{PERMISSIONS.map((p) => <label key={p.key} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={perms.includes(p.key)} onChange={(e) => setPerms(e.target.checked ? [...perms, p.key] : perms.filter((x) => x !== p.key))} className="h-4 w-4" />{p.label}</label>)}</div>
          <p className="text-[12px]" style={muted}>A link never shares another person’s private forms, photos, health notes or money.</p>
          <div className="flex gap-2"><button type="button" disabled={busy} onClick={save} className="h-10 rounded-full px-5 text-[14px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Save link</button><button type="button" onClick={() => setOther(null)} className="h-10 rounded-full px-4 text-[14px]" style={muted}>Back</button></div>
        </>}
        <button type="button" onClick={() => { setAdding(false); setOther(null); setQ(''); }} className="text-[13px] underline underline-offset-2" style={muted}>Cancel</button>
      </div>}
    </section>);
}
