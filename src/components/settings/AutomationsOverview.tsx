'use client';
// src/components/settings/AutomationsOverview.tsx — EVERYTHING THE APP DOES ON ITS OWN, one row each.
// The rule owners see everywhere: Settings = your rules and details · Automations = what the app does by itself
// (whether it runs, and when) · Messages = the words. Each row has ONE switch (or "Always on" and why), an honest
// status only when something needs attention, what it did this week, and its timing. Rows come from two places,
// merged so nothing appears twice: the job switches (lib/automation-switches) and the message catalogue with live
// health (lib/automations) — a switch's own messages show inside its row, not as rows of their own.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { deviceId } from '@/lib/device';
import { Toggle, cfInput, cfInputStyle } from '@/components/settings/settings-ui';

const GROUPS = ['Clients', 'Visitors & renters', 'Students & applicants', 'You & your team'] as const;
const GROUP_HELP: Record<string, string> = { Clients: 'What clients receive without you lifting a finger.', 'Visitors & renters': 'Rent, tours and paperwork, kept moving.', 'Students & applicants': 'Admissions and courses.', 'You & your team': 'Keeping you and your team on schedule.' };
const SW_GROUP: Record<string, string> = { clients: 'Clients', renters: 'Visitors & renters', team: 'You & your team', you: 'You & your team' };
const RANK: Record<string, number> = { working: 0, off: 0, needs_setup: 1, failing: 2 };

async function load(tenantId: string) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ tenantId }) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

type Row = { key: string; group: string; title: string; does: string; always?: string | null; on: boolean; canSwitch: boolean; status: string; reason: string | null;
  sent: number; failed: number; countable: boolean; channels: { kind: string; email?: boolean; sms?: boolean } | null; wordsHref?: string | null; timing?: any[]; values?: any; switchField?: string; details?: string | null; msgKinds?: string[] };

export function AutomationsOverview({ tenantId, firestore }: { tenantId: string; firestore: Firestore | null }) {
  const [d, setD] = useState<any>(null); const [q, setQ] = useState(''); const [only, setOnly] = useState<'all' | 'attention'>('all'); const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => { if (tenantId) setD(await load(tenantId)); }, [tenantId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const rows: Row[] = useMemo(() => {
    if (!d?.ok) return [];
    const byKind = new Map<string, any>(); for (const a of d.items || []) if (a.id.startsWith('msg:') && a.kinds.length === 1) byKind.set(a.kinds[0], a);
    const absorbed = new Set<string>();
    const out: Row[] = (d.switches || []).map((sw: any) => {
      const msgs = (sw.kinds || []).map((k: string) => byKind.get(k)).filter(Boolean); msgs.forEach((m: any) => absorbed.add(m.id));
      const worst = msgs.reduce((w: any, m: any) => (RANK[m.status] > RANK[w?.status || 'working'] ? m : w), null);
      const on = !!sw.on;
      const status = !on && !sw.always ? 'off' : sw.missing ? 'needs_setup' : worst?.status && worst.status !== 'off' ? worst.status : 'working';
      const one = msgs.length === 1 && msgs[0].canDisable ? msgs[0] : null;
      return { key: `sw:${sw.id}`, group: SW_GROUP[sw.who], title: sw.title, does: sw.does, always: sw.always ? sw.alwaysWhy : null, on: on || sw.always, canSwitch: !sw.always && !!sw.field, status,
        reason: !on && !sw.always ? null : sw.missing || (status !== 'working' ? worst?.reason : null), countable: msgs.length > 0 || !!sw.thisWeek || !sw.always,
        sent: msgs.reduce((n: number, m: any) => n + (m.sent7 || 0), 0) + (msgs.length ? 0 : sw.thisWeek || 0), failed: msgs.reduce((n: number, m: any) => n + (m.failed7 || 0), 0),
        channels: one && one.channels.length > 1 ? { kind: one.kinds[0], email: one.emailOn, sms: one.smsOn } : null,
        wordsHref: sw.words && sw.kinds?.[0] ? `/settings/messages#${sw.kinds[0]}` : null, timing: sw.timing, values: sw.values, switchField: sw.field, details: sw.details || null, msgKinds: sw.kinds };
    });
    for (const a of d.items || []) {
      if (absorbed.has(a.id)) continue;
      const on = !!(a.emailOn || a.smsOn);
      out.push({ key: a.id, group: a.who, title: a.when, does: a.then.charAt(0).toUpperCase() + a.then.slice(1) + '.', always: a.canDisable ? null : 'Clients rely on this one.', on: on || !a.canDisable, canSwitch: !!a.canDisable && a.kinds.length > 0, status: a.status,
        reason: a.status === 'off' ? null : a.reason, sent: a.sent7 || 0, failed: a.failed7 || 0, countable: a.kinds.length > 0,
        channels: a.canDisable && a.kinds.length === 1 && a.channels.length > 1 ? { kind: a.kinds[0], email: a.emailOn, sms: a.smsOn } : null,
        wordsHref: a.kinds.length ? a.settingsHref : null, msgKinds: a.kinds });
    }
    return out;
  }, [d]);

  const shown = rows.filter((r) => (only === 'all' || ['needs_setup', 'failing'].includes(r.status)) && (!q || `${r.title} ${r.does}`.toLowerCase().includes(q.toLowerCase())));
  const attention = rows.filter((r) => ['needs_setup', 'failing'].includes(r.status)).length;

  const write = async (key: string, patch: Record<string, any>) => { if (!firestore) return; setBusy(key); try { await updateDoc(doc(firestore, 'tenants', tenantId), patch); await refresh(); } finally { setBusy(''); } };
  const flip = (r: Row, v: boolean) => {
    if (r.switchField) return write(r.key, { [r.switchField]: v });
    const k = r.msgKinds?.[0]; if (!k) return; return write(r.key, { [`messagePolicy.${k}.emailEnabled`]: v, [`messagePolicy.${k}.smsEnabled`]: v });
  };

  if (!d) return <p className="text-[14px] cf-muted">Checking your automations…</p>;
  if (!d.ok) return <p className="text-[14px] cf-muted">{d.error || 'Couldn’t load automations.'}</p>;
  const notReady = [!d.ready.email && 'Email sending isn’t set up', !d.ready.sms && 'Texting isn’t set up yet', !d.ready.stripe && 'Payments aren’t connected'].filter(Boolean) as string[];
  const late = (d.jobs || []).filter((j: any) => j.late);
  return (
    <div className="space-y-8">
      {(notReady.length > 0 || late.length > 0) && (
        <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fffbeb', color: '#92400e' }}>
          {[...notReady, ...late.map((j: any) => `${j.label} hasn’t run lately`)].join(' · ')} — some automations below can’t run until this is sorted.
        </div>)}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — reminder, deposit, rent…" aria-label="Search automations" className={`${cfInput} min-w-0 flex-1`} style={cfInputStyle} />
        <div className="inline-flex rounded-full p-1" style={{ background: 'var(--soft)' }}>{([['all', 'All'], ['attention', `Needs you${attention ? ` (${attention})` : ''}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setOnly(k)} aria-pressed={only === k} className="h-9 rounded-full px-4 text-[14px]" style={only === k ? { background: 'var(--card)', fontWeight: 600 } : { color: 'var(--muted)' }}>{l}</button>))}</div>
      </div>
      {GROUPS.map((g) => { const list = shown.filter((r) => r.group === g); if (!list.length) return null; return (
        <section key={g} aria-label={g} className="space-y-3">
          <div className="space-y-1"><h2 className="text-[19px] font-semibold tracking-tight">{g}</h2><p className="text-[14.5px] cf-muted">{GROUP_HELP[g]}</p></div>
          <div className="cf-sheet">{list.map((r) => (
            <div key={r.key} id={r.key} className="space-y-2 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1"><p className="text-[15px] font-medium">{r.title}</p><p className="mt-0.5 text-[13.5px] leading-snug cf-muted">{r.does}</p></div>
                {r.always ? <span className="shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium" style={{ background: 'var(--soft)' }} title={r.always}>Always on</span>
                  : r.canSwitch ? <Toggle checked={r.on} disabled={busy === r.key} onChange={(v) => void flip(r, v)} label={r.title} />
                  : <span className="shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium" style={{ background: 'var(--soft)' }}>{r.on ? 'On' : 'Off'}</span>}
              </div>
              {r.always && <p className="text-[12.5px] cf-muted">{r.always}</p>}
              {!r.on && r.details === 'appointment-followups' && <a href="#followups" className="text-[13px] font-medium underline underline-offset-4">Choose the reminders ↓</a>}
              {r.on && (<>
                {r.reason && <p className="text-[13.5px]" style={{ color: r.status === 'failing' ? '#991b1b' : '#92400e' }}>{r.reason}</p>}
                {(r.timing || []).map((t: any) => (
                  <div key={t.field} className="flex flex-wrap items-center gap-2 text-[14px]"><span className="cf-muted">{t.label}</span>
                    {t.input === 'phone'
                      ? <input type="tel" inputMode="tel" defaultValue={r.values?.[t.field] || ''} placeholder="Your mobile number" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.values?.[t.field] || '')) void write(r.key, { [t.field]: v }); }} className="h-10 rounded-xl border px-3 text-[14px]" style={cfInputStyle} aria-label={t.label} />
                      : <select value={String(r.values?.[t.field] ?? t.options?.[1]?.value ?? '')} onChange={(e) => void write(r.key, { [t.field]: Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} className="h-10 rounded-xl border px-3 text-[14px]" style={cfInputStyle} aria-label={t.label}>
                          {t.options.map((o: any) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}</select>}
                  </div>))}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] cf-muted">
                  {r.countable && <span>{r.sent ? `${r.sent} this week` : 'Nothing this week'}{r.failed ? ` · ${r.failed} didn’t go through` : ''}</span>}
                  {r.channels && (['email', 'sms'] as const).map((c) => (
                    <label key={c} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!r.channels![c]} disabled={!!busy}
                      onChange={(e) => void write(r.key, { [`messagePolicy.${r.channels!.kind}.${c}Enabled`]: e.target.checked })} />{c === 'email' ? 'By email' : 'By text'}</label>))}
                  {r.details === 'appointment-followups' && <a href="#followups" className="font-medium underline underline-offset-4" style={{ color: 'var(--ink)' }}>Choose the reminders ↓</a>}
                  {r.details === 'win-back' && <Link href="/settings/messages#winback" className="font-medium underline underline-offset-4" style={{ color: 'var(--ink)' }}>Who and when →</Link>}
                  {r.wordsHref && <Link href={r.wordsHref} className="font-medium underline underline-offset-4" style={{ color: 'var(--ink)' }}>Change the words →</Link>}
                </div>
              </>)}
            </div>))}</div>
        </section>); })}
      {shown.length === 0 && <p className="text-[14px] cf-muted">{only === 'attention' ? 'Nothing needs you — everything is working.' : 'Nothing matches that search.'}</p>}
    </div>
  );
}
