'use client';
// src/components/opportunities/OpportunitiesBoard.tsx — OPPORTUNITIES (design canvas Op1, Op6, Op7, Op13). What the rules found, who
// has each one, and what came back. Finders run every morning on their own; a manager can run them now, hand tasks out,
// make one by hand, switch finders off, and see results — paid money kept apart from estimates, and the left-alone
// group beside the contacted one so "came back" isn't mistaken for "caused by". lib/opportunities(-server).
import * as React from 'react';
import { collection, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { payPost } from '@/components/pay/pay-client';
import { OppTask, EST, PAID, INK, MUTED, LINE, SOFT, GREEN, AMBER, RED } from '@/components/opportunities/OppTask';
import { PLAYBOOKS, FINDER_KINDS, modesFor, dollars, type OppKind } from '@/lib/opportunities';

const PRI: Record<string, string> = { high: RED, medium: AMBER, low: MUTED };
const pill = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` });
const short = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

export function OpportunitiesBoard({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<any>(null); const [kind, setKind] = React.useState<string>('all'); const [tab, setTab] = React.useState<'open' | 'auto' | 'done' | 'results'>('open');
  const [openId, setOpenId] = React.useState<string | null>(null); const [panel, setPanel] = React.useState<'' | 'settings' | 'add'>(''); const [busy, setBusy] = React.useState(false); const [note, setNote] = React.useState('');
  const load = React.useCallback(() => (tenantId ? payPost('/api/opportunities', { tenantId, action: 'list' }).then(setD) : null), [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  const items: any[] = d?.items || []; const open = items.filter((o) => o.status === 'open'); const AUTO_ST = ['scheduled', 'waiting', 'auto', 'not_sent']; const autos = items.filter((o) => AUTO_ST.includes(o.status)); const closed = items.filter((o) => o.status !== 'open' && !AUTO_ST.includes(o.status));
  const pool = tab === 'auto' ? autos.filter((o) => o.status !== 'not_sent') : open;
  const counts = (FINDER_KINDS as string[]).concat(['follow_up', 'manual']).map((k) => ({ k, n: pool.filter((o) => o.kind === k).length, v: pool.filter((o) => o.kind === k).reduce((s, o) => s + (o.valueCents || 0), 0) })).filter((x) => x.n);
  const list = (tab === 'open' ? open : tab === 'auto' ? autos : closed).filter((o) => kind === 'all' || o.kind === kind);
  const sel = items.find((o) => o.id === openId) || null;
  const run = async () => { setBusy(true); setNote(''); const r = await payPost('/api/opportunities', { tenantId, action: 'run' }); setBusy(false);
    setNote(r.ok ? (r.created ? `Found ${r.created} new.` : 'Nothing new — everyone who qualifies already has a task.') : r.error || 'That didn’t work.'); void load(); };
  return (
    <>
      <div className="mx-auto mt-4 max-w-[1180px] space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>opportunities</p>
            <h1 className="text-[30px] font-light tracking-[-0.02em]">{d ? `${open.length} to work on${open.length ? ` · est. ${dollars(open.reduce((s, o) => s + (o.valueCents || 0), 0))}` : ''}` : 'Opportunities'}</h1>
            <p className="text-[13.5px]" style={{ color: MUTED }}>Found every morning. Estimates are dashed — only paid visits count as money.</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={run} disabled={busy} className="h-10 rounded-full border bg-white px-4 text-[14px] font-semibold disabled:opacity-40" style={{ borderColor: LINE }}>{busy ? 'Looking…' : 'Look now'}</button>
            <button type="button" onClick={() => setPanel(panel === 'settings' ? '' : 'settings')} className="h-10 rounded-full border bg-white px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>Finders</button>
            <button type="button" onClick={() => setPanel(panel === 'add' ? '' : 'add')} className="h-10 rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>Add a task</button></div></div>
        {note && <p className="text-[13.5px] font-semibold" style={{ color: GREEN }}>{note}</p>}
        {panel === 'settings' && d && <Finders tenantId={tenantId} settings={d.settings} onSaved={() => { setPanel(''); void load(); }} />}
        {panel === 'add' && d && <AddTask tenantId={tenantId} people={d.people} onSaved={() => { setPanel(''); void load(); }} />}
        <div className="flex flex-wrap gap-2">{(['open', 'auto', 'done', 'results'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className="h-9 rounded-full px-4 text-[13.5px] font-semibold" style={pill(tab === t)}>{t === 'open' ? `With a person · ${open.length}` : t === 'auto' ? `Sent automatically · ${autos.filter((o) => o.status !== 'not_sent').length}` : t === 'done' ? 'Closed' : 'Results'}</button>)}</div>
        {tab !== 'results' && counts.length > 0 && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setKind('all')} className="rounded-[16px] px-3.5 py-2.5 text-left" style={pill(kind === 'all')}><span className="block text-[12px] opacity-75">Everything</span><span className="block text-[18px] font-bold">{pool.length}</span></button>
          {counts.map((c) => <button key={c.k} type="button" onClick={() => setKind(kind === c.k ? 'all' : c.k)} className="rounded-[16px] px-3.5 py-2.5 text-left" style={pill(kind === c.k)}>
            <span className="block text-[12px] opacity-75">{PLAYBOOKS[c.k as OppKind].label}</span><span className="block text-[18px] font-bold">{c.n}</span>{c.v > 0 && <span className="block text-[11.5px] opacity-75">est. {dollars(c.v)}</span>}</button>)}</div>}
        {tab === 'results' ? <Results tenantId={tenantId} /> : !d ? <p style={{ color: MUTED }}>Loading…</p> : list.length === 0 ? <p className="rounded-[18px] border bg-white p-6 text-[14px]" style={{ borderColor: LINE, color: MUTED }}>{tab === 'open' ? 'Nothing to work on right now. The finders look again every morning.' : tab === 'auto' ? 'No automatic texts waiting on an answer.' : 'Nothing closed yet.'}</p> :
          <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
            <div className="hidden grid-cols-[1.7fr_0.8fr_0.7fr_0.7fr_1fr] gap-3 px-4 py-2.5 text-[12px] font-bold md:grid" style={{ color: MUTED, background: '#fafafa' }}><span>Who · why</span><span>Worth</span><span>Priority</span><span>{tab === 'open' ? 'Ends' : tab === 'auto' ? 'To a person' : 'Closed'}</span><span>{tab === 'auto' ? 'Status' : 'With'}</span></div>
            {list.map((o) => <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="grid w-full grid-cols-1 gap-1 px-4 py-3 text-left md:grid-cols-[1.7fr_0.8fr_0.7fr_0.7fr_1fr] md:items-center md:gap-3" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="min-w-0"><span className="block truncate text-[14.5px] font-semibold">{o.title || o.clientName}</span><span className="block text-[12.5px] leading-snug" style={{ color: MUTED }}>{o.why} · <span style={{ color: '#3d5a99' }}>{PLAYBOOKS[o.kind as OppKind]?.label}</span></span></span>
              <span>{o.result?.status === 'paid' ? <PAID cents={o.result.paidCents || 0} /> : <EST cents={o.valueCents || 0} note={o.valueNote} />}</span>
              <span className="text-[13.5px]"><span style={{ color: PRI[o.priority] || MUTED }}>●</span> {String(o.priority || 'medium').replace(/^./, (x: string) => x.toUpperCase())}</span>
              <span className="text-[13.5px]" style={{ color: MUTED }}>{tab === 'open' ? short(o.expiresAt) : tab === 'auto' ? (o.status === 'waiting' ? short(o.escalateAt) : '—') : short(o.closedAt)}</span>
              {tab === 'auto' ? <span className="text-[13.5px]" style={{ color: o.status === 'not_sent' ? AMBER : MUTED }}>{o.status === 'not_sent' ? 'Not sent' : o.status === 'scheduled' ? `Goes out ${short(o.sendAt)}` : `Sent ${short(o.autoSentAt)} · ${o.status === 'auto' ? 'no task' : 'waiting'}`}</span>
                : <span className="text-[13.5px]" style={{ color: o.assigneeName ? INK : AMBER }}>{o.assigneeName || 'Nobody yet'}</span>}</button>)}
          </div>}
        <p className="text-[12.5px]" style={{ color: MUTED }}>Never more than your message rules allow: texting hours, the 30-day limit shared with campaigns and reminders, and anyone who said stop is left out. Nobody with an open Making it right case gets a task.</p>
      </div>
      {sel && <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Task">
        <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.18)' }} onClick={() => setOpenId(null)} />
        <div className="relative h-full w-full max-w-[560px] overflow-y-auto bg-white p-5 md:p-7" style={{ borderLeft: `1px solid ${LINE}` }}>
          <OppTask tenantId={tenantId} item={sel} manager people={d?.people || []} onClose={() => setOpenId(null)} onChanged={() => { void load(); }} /></div></div>}
    </>);
}

function Finders({ tenantId, settings, onSaved }: { tenantId: string; settings: any; onSaved: () => void }) {
  const [s, setS] = React.useState<any>(settings); const [busy, setBusy] = React.useState(false);
  const save = async () => { setBusy(true); const r = await payPost('/api/opportunities', { tenantId, action: 'settings', settings: s }); setBusy(false); if (r.ok) onSaved(); };
  const sw = (on: boolean, flip: () => void, label: string) => <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={flip} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: on ? INK : '#dcdde0' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: on ? 23 : 3 }} /></button>;
  return (
    <div className="space-y-3 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
      <div className="flex items-center justify-between gap-3"><div><p className="text-[15.5px] font-semibold">Finders</p><p className="text-[13px]" style={{ color: MUTED }}>Switch off what doesn’t fit your business.</p></div>{sw(s.on, () => setS({ ...s, on: !s.on }), 'Opportunities on')}</div>
      <div>{FINDER_KINDS.map((k) => <div key={k} className="grid items-center gap-2 py-2.5 md:grid-cols-[1fr_auto]" style={{ borderTop: `1px solid ${LINE}` }}>
        <span><span className="block text-[14px] font-semibold">{PLAYBOOKS[k].label}</span><span className="block text-[12px]" style={{ color: MUTED }}>A person means {PLAYBOOKS[k].who === 'provider' ? 'their provider' : PLAYBOOKS[k].who === 'desk' ? 'the desk' : 'the owner'}{PLAYBOOKS[k].marketing ? ' · texts need their yes to marketing' : ''}</span></span>
        <span className="flex flex-wrap gap-1.5">{modesFor(k).map((m) => <button key={m} type="button" onClick={() => setS({ ...s, modes: { ...s.modes, [k]: m } })} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={pill(s.modes[k] === m)}>{m === 'off' ? 'Off' : m === 'auto' ? 'Automatic' : m === 'person' ? 'A person' : 'Automatic, then a person'}</button>)}</span>
        {PLAYBOOKS[k].ask?.length && ['auto', 'auto_then_person'].includes(s.modes[k]) ? <span className="flex flex-wrap items-center gap-1.5 md:col-span-2"><span className="text-[12px]" style={{ color: MUTED }}>First text:</span>
          {[[false, 'Ask first (no link)'], [true, 'Include a booking link']].map(([v, l]) => <button key={String(v)} type="button" aria-pressed={!!s.linkFirst?.[k] === v} onClick={() => setS({ ...s, linkFirst: { ...(s.linkFirst || {}), [k]: v } })} className="h-7 rounded-full px-2.5 text-[12px] font-semibold" style={pill(!!s.linkFirst?.[k] === v)}>{l as string}</button>)}</span> : null}</div>)}</div>
      <p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}><b style={{ color: INK }}>Automatic</b> sends a friendly text — nobody has a task. <b style={{ color: INK }}>Ask first</b> asks without a link: a yes gets two real times back, and a reply of 1 or 2 books it; anything else goes to a person. Cancellations and gift cards include the link, since the client expects it. <b style={{ color: INK }}>Automatic, then a person</b> does the same, and if they don’t book or reply in the days below, it becomes a task. A reply makes it a task straight away. Every automatic text checks their consent, texting hours and the 30-day limit first.</p>
      <div className="grid gap-3 sm:grid-cols-2" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
        <label className="flex items-center justify-between gap-2 text-[14px]">Days to wait for a reply before a person takes it<input type="number" min={1} max={14} value={s.afterDays} onChange={(e) => setS({ ...s, afterDays: Number(e.target.value) })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></label>
        <label className="flex items-center justify-between gap-2 text-[14px]">Open tasks per person, at most<input type="number" min={1} max={30} value={s.perPersonPerDay} onChange={(e) => setS({ ...s, perPersonPerDay: Number(e.target.value) })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></label>
        <div className="space-y-2 sm:col-span-2" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
          <div className="flex items-center justify-between gap-3"><span><span className="block text-[14px] font-semibold">Bonus per paid result</span><span className="block text-[12px]" style={{ color: MUTED }}>For visits booked straight from someone’s task (not ones they booked on their own). Paid as its own line on their pay; taken back if the visit is refunded.</span></span>
            {sw(!!s.bonus?.on, () => setS({ ...s, bonus: { ...(s.bonus || {}), on: !s.bonus?.on } }), 'Bonus per paid result')}</div>
          {s.bonus?.on && <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-2 text-[14px]">Per paid visit ($)<input type="number" min={0} max={100} step={1} value={Math.round((s.bonus?.cents ?? 500) / 100)} onChange={(e) => setS({ ...s, bonus: { ...s.bonus, cents: Math.round(Number(e.target.value) * 100) } })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></label>
            <label className="flex items-center justify-between gap-2 text-[14px]"><span>Most per person a month ($)<span className="block text-[12px]" style={{ color: MUTED }}>0 = no limit</span></span><input type="number" min={0} max={5000} step={5} value={Math.round((s.bonus?.capCents ?? 0) / 100)} onChange={(e) => setS({ ...s, bonus: { ...s.bonus, capCents: Math.round(Number(e.target.value) * 100) } })} className="h-10 w-24 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></label></div>}
        </div>
        <label className="flex items-center justify-between gap-2 text-[14px]"><span>Left alone, to measure what works<span className="block text-[12px]" style={{ color: MUTED }}>% of win-back clients nobody contacts</span></span><input type="number" min={0} max={30} value={s.holdoutPct} onChange={(e) => setS({ ...s, holdoutPct: Number(e.target.value) })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></label></div>
      <button type="button" onClick={save} disabled={busy} className="h-10 rounded-full px-5 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : 'Save'}</button>
    </div>);
}

function AddTask({ tenantId, people, onSaved }: { tenantId: string; people: any[]; onSaved: () => void }) {
  const { firestore } = useFirebase() as any;
  const cq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/clients`) : null), [firestore, tenantId]);
  const { data: clients } = useCollection<any>(cq);
  const [f, setF] = React.useState<any>({ title: '', why: '', staffId: '', clientId: '', due: '', priority: 'medium', message: '' }); const [find, setFind] = React.useState(''); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const matches = find.trim().length > 1 ? (clients || []).filter((c: any) => String(c.name || `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6) : [];
  const picked = (clients || []).find((c: any) => c.id === f.clientId);
  const save = async () => { setBusy(true); setErr(''); const r = await payPost('/api/opportunities', { tenantId, action: 'create', title: f.title, why: f.why, staffId: f.staffId || null, clientId: f.clientId || null, dueAt: f.due ? `${f.due}T12:00:00` : null, priority: f.priority, message: f.message }); setBusy(false); if (r.ok) onSaved(); else setErr(r.error || 'That didn’t save.'); };
  const input = 'h-11 w-full rounded-[12px] border bg-white px-3 text-[14px]';
  return (
    <div className="grid gap-3 rounded-[18px] border bg-white p-4 md:grid-cols-2" style={{ borderColor: LINE }}>
      <div className="space-y-2 md:col-span-2"><p className="text-[15.5px] font-semibold">A task with a purpose</p><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What needs doing — e.g. Call Lee about the bridal quote" aria-label="Task" className={input} style={{ borderColor: LINE }} /></div>
      <div className="relative space-y-1"><p className="text-[12.5px]" style={{ color: MUTED }}>About a client (optional)</p>
        {picked ? <div className="flex h-11 items-center justify-between rounded-[12px] px-3 text-[14px]" style={{ background: SOFT }}>{picked.name || `${picked.firstName || ''} ${picked.lastName || ''}`}<button type="button" onClick={() => setF({ ...f, clientId: '' })} className="text-[13px] underline" style={{ color: MUTED }}>Change</button></div>
          : <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search clients" aria-label="Search clients" className={input} style={{ borderColor: LINE }} />}
        {!picked && matches.length > 0 && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[12px] border bg-white shadow-sm" style={{ borderColor: LINE }}>{matches.map((c: any) => <button key={c.id} type="button" onClick={() => { setF({ ...f, clientId: c.id }); setFind(''); }} className="block w-full px-3 py-2 text-left text-[14px] hover:bg-[#f7f7f8]">{c.name || `${c.firstName || ''} ${c.lastName || ''}`}<span className="text-[12px]" style={{ color: MUTED }}> {c.phone || ''}</span></button>)}</div>}</div>
      <div className="space-y-1"><p className="text-[12.5px]" style={{ color: MUTED }}>Who</p><select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })} aria-label="Who" className={input} style={{ borderColor: LINE }}><option value="">Nobody yet</option>{people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div className="space-y-1"><p className="text-[12.5px]" style={{ color: MUTED }}>By</p><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} aria-label="Due" className={input} style={{ borderColor: LINE }} /></div>
      <div className="space-y-1"><p className="text-[12.5px]" style={{ color: MUTED }}>Priority</p><div className="flex gap-1.5">{['high', 'medium', 'low'].map((p) => <button key={p} type="button" onClick={() => setF({ ...f, priority: p })} className="h-11 flex-1 rounded-full text-[13.5px] font-semibold" style={pill(f.priority === p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}</div></div>
      <textarea value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} rows={2} placeholder="Why — what you know, what a good result looks like" aria-label="Why" className="rounded-[12px] border p-3 text-[14px] md:col-span-2" style={{ borderColor: LINE }} />
      {f.clientId && <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={2} placeholder="Words to use (optional) — sent only if they tap Send" aria-label="Words to use" className="rounded-[12px] border p-3 text-[14px] md:col-span-2" style={{ borderColor: LINE }} />}
      {err && <p className="text-[13.5px] font-semibold md:col-span-2" style={{ color: RED }}>{err}</p>}
      <button type="button" onClick={save} disabled={busy || !f.title.trim()} className="h-11 rounded-full text-[14.5px] font-semibold text-white disabled:opacity-40 md:col-span-2" style={{ background: INK }}>{busy ? 'Saving…' : f.staffId ? 'Give it to them' : 'Add it'}</button>
    </div>);
}

const TOOL_LABEL: Record<string, string> = { appointments: 'Appointments', gift_cards: 'Gift cards', quotes: 'Quotes and events', memberships: 'Memberships', shop: 'Online shop', booths: 'Booth rentals', academy: 'Academy', hiring: 'Hiring', calls: 'Calls and texts', waitlist: 'Waitlist (cancelled times filled)', visit: 'Booked before they left (checkout and visit link)', campaigns: 'Campaigns', winback: 'Win-back reminders (before they moved here)' };
function Results({ tenantId }: { tenantId: string }) {
  const [r, setR] = React.useState<any>(null);
  React.useEffect(() => { payPost('/api/opportunities', { tenantId, action: 'results' }).then(setR); }, [tenantId]);
  if (!r) return <p style={{ color: MUTED }}>Adding it up…</p>; if (!r.ok) return <p style={{ color: RED }}>{r.error}</p>;
  const tile = (label: string, value: string, sub: string, color = INK, dashed = false) => <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE, borderStyle: dashed ? 'dashed' : 'solid' }}><p className="text-[12.5px]" style={{ color: MUTED }}>{label}</p><p className="text-[26px] font-light tracking-[-0.02em]" style={{ color }}>{value}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{sub}</p></div>;
  const c = r.compare; const bt = r.byType || { generated: 0, recovered: 0, influenced: 0 }; const added = c.heldOut >= 10 && c.contacted >= 10 ? Math.max(0, (c.contactedRate || 0) - (c.heldOutRate || 0)) : null;
  const money = (n: number) => (n ? dollars(n) : '—');
  const monthName = (() => { try { return new Date(`${r.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long' }); } catch { return 'This month'; } })();
  return (
    <div className="space-y-4">
      <p className="text-[13.5px]" style={{ color: MUTED }}>{monthName}: follow-up tasks, the waitlist and campaigns in one place. Only money actually collected counts, each visit is credited once, and refunds take it back.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile('Paid', dollars(r.paidCents), 'visits paid after someone reached out', GREEN)}
        {tile('Booked, not paid yet', r.bookedCents ? dollars(r.bookedCents) : String(r.bookedWaiting), `${r.bookedWaiting} visit${r.bookedWaiting === 1 ? '' : 's'} ahead · counts when paid`)}
        {tile('Still possible', `est. ${dollars(r.stillPossibleCents)}`, `${r.open} open tasks · an estimate, never added`, MUTED, true)}
        {tile('What reaching out added', added === null ? 'Too few yet' : `+${added} in 100`, added === null ? `needs 10+ reached and 10+ left alone (${c.contacted} · ${c.heldOut})` : `${c.contactedRate}% came back when reached vs ${c.heldOutRate}% left alone`)}</div>
      <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
        <div className="px-4 pt-3.5"><p className="text-[15px] font-semibold">Paid, by tool and kind of credit</p><p className="pb-2 text-[12.5px]" style={{ color: MUTED }}>Generated: booked through the task or its link. Recovered: replaced a cancellation or missed visit. Influenced: we reached out and they booked on their own soon after.</p></div>
        <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3 px-4 py-2.5 text-[12px] font-bold" style={{ color: MUTED, background: '#fafafa' }}><span>Tool</span><span>Generated</span><span>Recovered</span><span>Influenced</span><span>Still possible</span></div>
        {(r.byTool || []).length === 0 && <p className="px-4 py-4 text-[14px]" style={{ color: MUTED }}>Nothing yet this month.</p>}
        {(r.byTool || []).map((x: any) => <div key={x.tool} className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3 px-4 py-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><b className="font-semibold">{TOOL_LABEL[x.tool] || x.tool}</b><span>{money(x.generated)}</span><span>{money(x.recovered)}</span><span>{money(x.influenced)}</span><span style={{ color: MUTED }}>{x.possible ? `est. ${dollars(x.possible)}` : '—'}</span></div>)}
        <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3 px-4 py-3 text-[14px] font-semibold" style={{ borderTop: `1px solid ${LINE}` }}><span>Total</span><span>{money(bt.generated)}</span><span>{money(bt.recovered)}</span><span>{money(bt.influenced)}</span><span style={{ color: MUTED }}>{r.stillPossibleCents ? `est. ${dollars(r.stillPossibleCents)}` : '—'}</span></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">By person</p>
          {(r.byPerson || []).length === 0 ? <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Nobody’s results paid yet this month. Automatic texts count for the business, not a person.</p>
            : (r.byPerson || []).map((p: any) => <div key={p.staffId} className="mt-2 flex items-baseline justify-between text-[14px]"><span>{p.name}</span><span><b style={{ color: GREEN }}>{dollars(p.paidCents)}</b> <span style={{ color: MUTED }}>· {p.visits} visit{p.visits === 1 ? '' : 's'}</span></span></div>)}</div>
        <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">How it went out</p>
          <p className="mt-1 text-[13.5px] leading-[1.55]"><b>{r.autoSent}</b> sent automatically · <b style={{ color: GREEN }}>{r.autoBooked}</b> booked with nobody lifting a finger · <b>{r.toPerson}</b> went on to a person{r.notSent ? <span style={{ color: MUTED }}> · {r.notSent} couldn’t be sent</span> : null}</p>
          <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{r.optOuts} asked to stop · {r.complaints} bad experiences heard{r.refundedCents ? ` · ${dollars(r.refundedCents)} refunded and taken back` : ''}</p></div>
        <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">What’s holding it back</p>
          {r.holdingBack?.cantText ? <p className="mt-2 rounded-[14px] p-3 text-[13.5px] leading-[1.5]" style={{ background: '#fdf6ec' }}><b>{r.holdingBack.cantText} clients can’t get win-back texts</b> (no yes to marketing texts), so their tasks become calls. Ask at check-in, on the kiosk and on the client screen.</p> : null}
          {r.holdingBack?.expired ? <p className="mt-2 text-[13.5px] leading-[1.5]"><b>{r.holdingBack.expired} tasks expired</b> before anyone got to them in the last 30 days. Fewer a day per person, or more automatic?</p> : null}
          {!r.holdingBack?.cantText && !r.holdingBack?.expired && <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Nothing stands out right now.</p>}</div>
      </div>
      <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
        <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3 px-4 py-2.5 text-[12px] font-bold" style={{ color: MUTED, background: '#fafafa' }}><span>Kind of task (last 30 days)</span><span>Tasks</span><span>Reached</span><span>Booked</span><span>Paid</span></div>
        {r.byKind.length === 0 && <p className="px-4 py-4 text-[14px]" style={{ color: MUTED }}>Nothing in the last 30 days yet.</p>}
        {r.byKind.map((k: any) => <div key={k.kind} className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3 px-4 py-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><b className="font-semibold">{k.label}</b><span>{k.total}</span><span>{k.reached}</span><span>{k.booked}</span><span style={{ color: GREEN, fontWeight: 600 }}>{money(k.paidCents)}</span></div>)}</div>
    </div>);
}
