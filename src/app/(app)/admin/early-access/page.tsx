'use client';
// src/app/(app)/admin/early-access/page.tsx
//
// EARLY ACCESS — for you, not for businesses. Every request from
// /request-access lands here; one tap creates an invite and emails the
// sign-up link. Track each one: new → contacted → invited → onboarded.
// Only PLATFORM_ADMIN_EMAILS can open it (checked on the server).

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader } from 'lucide-react';
import { AppHeader } from '@/components/shared/AppHeader';
import { TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';

const STATUSES = ['new', 'contacted', 'invited', 'onboarded', 'declined'] as const;
const tone: Record<string, string> = { new: 'bg-amber-100 text-amber-800', contacted: 'bg-sky-100 text-sky-800', invited: 'bg-violet-100 text-violet-800', onboarded: 'bg-emerald-100 text-emerald-800', declined: 'bg-stone-200 text-stone-600', active: 'bg-emerald-100 text-emerald-800', used: 'bg-stone-200 text-stone-600', revoked: 'bg-red-100 text-red-700' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

async function call(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export default function EarlyAccessPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [manual, setManual] = useState({ email: '', business: '', uses: '1' });
  const load = useCallback(async () => { const d = await call({ action: 'list' }); if (d.ok) setData(d); else setErr(d.error || 'Couldn’t load.'); }, []);
  useEffect(() => { void load(); }, [load]);

  const invite = async (body: any, key: string) => {
    setBusy(key); setNote('');
    const d = await call({ action: 'create', ...body });
    setBusy('');
    if (!d.ok) { setNote(d.error || 'Couldn’t create the invite.'); return; }
    try { await navigator.clipboard.writeText(d.link); } catch { /* not allowed */ }
    setNote(`${d.code} created${d.emailed ? ' and emailed' : ''}. Sign-up link copied: ${d.link}`);
    void load();
  };

  if (err) return (<div><AppHeader title="Early access" /><p className="m-6 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p></div>);
  if (!data) return (<div><AppHeader title="Early access" /><div className="flex justify-center p-16"><Loader className="h-6 w-6 animate-spin text-stone-400" /></div></div>);

  const counts = STATUSES.map((s) => [s, data.leads.filter((l: any) => (l.status || 'new') === s).length] as const);
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader title="Early access" />
      <main className="mx-auto max-w-4xl space-y-5 px-4 pb-24 pt-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Early access</h1>
          <p className="text-sm text-slate-500">Sign-up is <span className="font-bold">{data.signupOpen ? 'open to everyone' : 'by invite only'}</span>. Requests from the website land here.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">{counts.map(([s, n]) => <span key={s} className={`rounded-full px-3 py-1 text-xs font-bold ${tone[s]}`}>{n} {s}</span>)}</div>
        {note && <p className="break-all rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{note}</p>}

        <section className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Requests</p>
          {data.leads.length === 0 && <p className="rounded-3xl border-2 border-dashed p-6 text-center text-sm text-slate-500">No requests yet. They’ll appear here from /request-access.</p>}
          {data.leads.map((l: any) => (
            <article key={l.id} className="space-y-2 rounded-3xl border-2 border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black">{l.business} <span className="font-medium text-slate-500">· {l.type}{l.size ? ` · ${l.size}` : ''}</span></p>
                  <p className="text-sm text-slate-600">{l.name} · <a href={`mailto:${l.email}`} className="underline">{l.email}</a>{l.phone ? ` · ${l.phone}` : ''}</p>
                  <p className="text-xs text-slate-400">{when(l.createdAt)}{l.currently ? ` · uses ${l.currently}` : ''}{l.inviteCode ? ` · invite ${l.inviteCode}` : ''}</p>
                </div>
                <select value={l.status || 'new'} onChange={async (e) => { await call({ action: 'status', leadId: l.id, status: e.target.value }); void load(); }} className={`h-8 shrink-0 rounded-full px-2 text-xs font-bold ${tone[l.status || 'new']}`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {Array.isArray(l.tools) && l.tools.length > 0 && <p className="flex flex-wrap gap-1">{l.tools.map((t: string) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{TOOL_BY_ID[t as ToolId]?.emoji} {TOOL_BY_ID[t as ToolId]?.name || t}</span>)}</p>}
              {l.note && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">“{l.note}”</p>}
              {(l.status || 'new') !== 'onboarded' && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!!busy} onClick={() => invite({ leadId: l.id, send: true }, l.id)} className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-50">{busy === l.id ? '…' : l.inviteCode ? 'Send a new invite' : 'Invite & email'}</button>
                  <button type="button" disabled={!!busy} onClick={() => invite({ leadId: l.id, send: false }, l.id + 'c')} className="h-9 rounded-xl border-2 px-4 text-xs font-bold disabled:opacity-50">Create link only</button>
                </div>
              )}
            </article>
          ))}
        </section>

        <section className="space-y-2 rounded-3xl border-2 border-slate-200 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Invite someone directly</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} placeholder="Email (optional)" className="h-10 rounded-xl border-2 px-3 text-sm" />
            <input value={manual.business} onChange={(e) => setManual({ ...manual, business: e.target.value })} placeholder="Business (optional)" className="h-10 rounded-xl border-2 px-3 text-sm" />
            <input value={manual.uses} onChange={(e) => setManual({ ...manual, uses: e.target.value })} type="number" min={1} max={50} placeholder="Uses" className="h-10 rounded-xl border-2 px-3 text-sm" />
          </div>
          <button type="button" disabled={!!busy} onClick={() => invite({ email: manual.email, business: manual.business, maxUses: Number(manual.uses) || 1, send: !!manual.email }, 'manual')} className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-50">{busy === 'manual' ? '…' : manual.email ? 'Create & email' : 'Create code'}</button>
          <p className="text-[11px] text-slate-500">A code with more than one use is handy for an academy class or a suite building.</p>
        </section>

        <section className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Invites</p>
          {data.invites.map((i: any) => (
            <div key={i.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-slate-100 bg-white px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><span className="font-mono font-black">{i.code}</span> · {i.business || i.email || 'open code'} · {i.uses || 0}/{i.maxUses || 1} used · {when(i.createdAt)}</span>
              <span className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone[i.status] || ''}`}>{i.status}</span>
                {i.status === 'active' && <button type="button" onClick={async () => { await call({ action: 'revoke', code: i.code }); void load(); }} className="text-[11px] font-bold text-red-600 underline">Revoke</button>}</span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
