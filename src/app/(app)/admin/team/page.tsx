'use client';
// src/app/(app)/admin/team/page.tsx
//
// HQ · TEAM — who helps run ClarityFlow, and what each can do.
//   Owner      everything (set by PLATFORM_ADMIN_EMAILS in Vercel)
//   Support    help desk, businesses (fixes, notes, password resets), early access
//   Developer  help desk (escalated bugs), businesses, system
//   Analyst    insights and businesses, read-only
// People sign in with a normal ClarityFlow account using this email.

import { useCallback, useEffect, useState } from 'react';
import { HqShell, Glass, Label, Loading, hq, ago } from '@/components/hq/hq';

const ROLES: [string, string][] = [['support', 'Help desk, businesses, fixes, early access'], ['developer', 'Escalated bugs, businesses, system'], ['analyst', 'Insights and businesses — read-only']];

export default function TeamPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ email: '', name: '', role: 'support' });
  const [msg, setMsg] = useState('');
  const load = useCallback(() => hq({ action: 'team' }).then((r) => (r.ok ? setD(r) : setErr(r.error || 'Couldn’t load.'))), []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { const r = await hq({ action: 'team-save', ...f }); setMsg(r.ok ? `${f.email} added as ${f.role}. They sign in with a ClarityFlow account on that email, and HQ appears in their sidebar.` : r.error); if (r.ok) { setF({ email: '', name: '', role: 'support' }); void load(); } };
  return (
    <HqShell title="Team" sub="Who helps run ClarityFlow, and what each person can do.">
      {err && <p className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{err}</p>}
      {!d && !err && <Loading />}
      {d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Glass className="space-y-3">
            <Label>Add someone</Label>
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Their email" className="h-11 w-full rounded-2xl border border-white/80 bg-white/70 px-4" />
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name (optional)" className="h-11 w-full rounded-2xl border border-white/80 bg-white/70 px-4" />
            <div className="space-y-1.5">
              {ROLES.map(([r, desc]) => (
                <button key={r} type="button" onClick={() => setF({ ...f, role: r })} aria-pressed={f.role === r} className={`w-full rounded-2xl p-3 text-left ${f.role === r ? 'bg-stone-900 text-white' : 'bg-white/70'}`}><span className="block text-sm font-semibold capitalize">{r}</span><span className={`block text-[12px] ${f.role === r ? 'text-white/70' : 'text-stone-500'}`}>{desc}</span></button>
              ))}
            </div>
            <button type="button" disabled={!f.email.includes('@')} onClick={save} className="h-11 w-full rounded-full bg-stone-900 text-sm text-white disabled:opacity-40">Add to HQ</button>
            {msg && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
          </Glass>
          <Glass className="space-y-2">
            <Label>Owners</Label>
            {d.owners.map((e: string) => <p key={e} className="rounded-2xl bg-white/60 px-3 py-2 text-sm">{e} <span className="text-stone-500">· owner (from Vercel)</span></p>)}
            <div className="pt-2"><Label>Team</Label></div>
            {d.members.filter((m: any) => m.active !== false).length === 0 && <p className="text-sm text-stone-500">Nobody else yet.</p>}
            {d.members.filter((m: any) => m.active !== false).map((m: any) => (
              <div key={m.email} className="flex items-center justify-between gap-2 rounded-2xl bg-white/60 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{m.name} · {m.email} <span className="text-stone-500">· {m.role} · added {ago(m.addedAt)}</span></span>
                <button type="button" onClick={async () => { if (window.confirm(`Remove ${m.email} from HQ?`)) { await hq({ action: 'team-remove', email: m.email }); void load(); } }} className="shrink-0 text-[12px] text-red-600 underline">Remove</button>
              </div>
            ))}
          </Glass>
        </div>
      )}
    </HqShell>
  );
}
