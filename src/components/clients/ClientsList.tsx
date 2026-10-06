'use client';
// src/components/clients/ClientsList.tsx — THE CLIENTS LIST, PEOPLE FIRST.
// Figures about people (due back this week · new this month · have their next visit booked · gone quiet · owe), segments
// with counts (everyone · due back · gone quiet · new · regulars · members · owe money · birthdays · not to be booked ·
// archived), sort, rich rows (who they are, next / last visit, what they usually have and how often, value, what needs
// attention, one fitting action), and a bulk bar (message · invite back · tag · export · archive). Everything is worked
// out from appointments already on the device — one pass, indexed by client. Money only for people who may see it;
// contact details only for people who may see them.
import * as React from 'react';
import { format, differenceInDays, differenceInYears } from 'date-fns';

const safe = (v: any) => new Date(v?.toDate ? v.toDate() : v);
const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
const card = { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' } as React.CSSProperties;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const AV = ['#b98a6a', '#6a8ab9', '#8a6ab9', '#6ab98a', '#b96a8a', '#8ab96a', '#2e6f6a'];
const pill = (l: string, tone: 'warn' | 'ok' | 'soft' = 'soft') => <span key={l} className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={tone === 'warn' ? { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' } : tone === 'ok' ? { background: 'color-mix(in srgb, var(--ok, #15803d) 12%, transparent)', color: 'var(--ok, #15803d)' } : { background: 'var(--soft, #efebe6)' }}>{l}</span>;
const last10 = (v: any) => String(v || '').replace(/\D/g, '').slice(-10);

export type Row = { c: any; visits: number; first: Date | null; last: Date | null; next: any | null; everyDays: number | null; usual: string | null; spent: number; dueBack: Date | null; dueThisWeek: boolean; quiet: boolean; isNew: boolean; regular: boolean; member: boolean; birthday: boolean; formDue: boolean; owes: number; age: number | null; dup: boolean };
type Seg = 'all' | 'due' | 'quiet' | 'new' | 'regulars' | 'members' | 'owe' | 'birthdays' | 'banned' | 'archived';

export function buildRows(clients: any[], appointments: any[], services: any[], staff: any[], now = new Date()): Row[] {
  const byClient = new Map<string, any[]>(); for (const a of appointments) { if (!a?.clientId) continue; (byClient.get(a.clientId) || byClient.set(a.clientId, []).get(a.clientId)!).push(a); }
  const svcName = new Map(services.map((s) => [s.id, s.name])); const staffName = new Map(staff.map((s) => [s.id, String(s.name || '').split(' ')[0]]));
  const phones = new Map<string, number>(), emails = new Map<string, number>();
  for (const c of clients) { const p = last10(c.phone), e = String(c.email || '').trim().toLowerCase(); if (p.length === 10) phones.set(p, (phones.get(p) || 0) + 1); if (e) emails.set(e, (emails.get(e) || 0) + 1); }
  return clients.map((c) => {
    const mine = byClient.get(c.id) || []; const done = mine.filter((a) => a.status === 'completed').sort((x, y) => safe(y.startTime).getTime() - safe(x.startTime).getTime());
    const next = mine.filter((a) => !['cancelled', 'declined', 'no_show', 'completed'].includes(String(a.status)) && safe(a.startTime) > now).sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime())[0] || null;
    const last = done[0] ? safe(done[0].startTime) : null; const first = done.length ? safe(done[done.length - 1].startTime) : null;
    const gaps = done.slice(0, 7).map((a, i, arr) => (i < arr.length - 1 ? differenceInDays(safe(a.startTime), safe(arr[i + 1].startTime)) : 0)).filter((g) => g > 0);
    const everyDays = gaps.length >= 2 ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;
    const mode = (xs: string[]) => { const m = new Map<string, number>(); xs.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); let b = '', n = 0; m.forEach((v, k) => { if (v > n) { b = k; n = v; } }); return n >= 2 ? b : ''; };
    const us = mode(done.slice(0, 8).map((a) => a.serviceId)), up = mode(done.slice(0, 8).map((a) => a.staffId));
    const usual = us ? `${svcName.get(us) || 'Service'}${up && staffName.get(up) ? ` · ${staffName.get(up)}` : ''}` : null;
    const dueBack = last && everyDays ? new Date(last.getTime() + everyDays * 86400000) : null;
    const dueThisWeek = !!dueBack && !next && differenceInDays(dueBack, now) <= 7 && differenceInDays(now, dueBack) <= 14;
    const quiet = !next && !!last && done.length >= 2 && differenceInDays(now, last) > Math.max(42, (everyDays || 28) * 1.5);
    const isNew = !!first && differenceInDays(now, first) <= 30;
    const regular = done.filter((a) => differenceInDays(now, safe(a.startTime)) <= 365).length >= 6;
    const member = !!(c.activeMembershipId || c.membershipStatus === 'active' || c.isMember);
    let age: number | null = null, birthday = false; try { const dob = c.dob || c.birthday || c.dateOfBirth; if (dob) { const d = safe(dob); age = differenceInYears(now, d); birthday = d.getMonth() === now.getMonth(); } } catch { /* fine */ }
    const formDue = !!next && (() => { const svc = services.find((s) => s.id === next.serviceId); const need: string[] = [...(svc?.requiredFormIds || []), ...(next.requiredFormIds || [])]; const signed = new Set((next.signedForms || []).map((f: any) => f.formId)); return need.some((id) => !signed.has(id)); })();
    const p = last10(c.phone), e = String(c.email || '').trim().toLowerCase();
    return { c, visits: done.length, first, last, next, everyDays, usual, spent: Number(c.lifetimeValue) || 0, dueBack, dueThisWeek, quiet, isNew, regular, member, birthday, formDue, owes: Number(c.outstandingBalance) || 0, age, dup: (p.length === 10 && (phones.get(p) || 0) > 1) || (!!e && (emails.get(e) || 0) > 1) };
  });
}

export function ClientsList({ tenantId, clients, appointments, services, staff, showMoney, showContact, canManage, onOpen, onBook, onAdd, onFindDuplicates, onArchive, onUnarchive, onDelete, onTag }: {
  tenantId: string; clients: any[]; appointments: any[]; services: any[]; staff: any[]; showMoney: boolean; showContact: boolean; canManage: boolean;
  onOpen: (id: string) => void; onBook: (id: string) => void; onAdd: () => void; onFindDuplicates: () => void;
  onArchive: (ids: string[]) => void; onUnarchive: (ids: string[]) => void; onDelete?: (ids: string[]) => void; onTag: (ids: string[], tag: string) => void;
}) {
  const now = React.useMemo(() => new Date(), []);
  const all = React.useMemo(() => buildRows(clients, appointments, services, staff, now), [clients, appointments, services, staff, now]);
  const [seg, setSeg] = React.useState<Seg>('all'); const [q, setQ] = React.useState(''); const [sort, setSort] = React.useState<'last' | 'next' | 'name' | 'spent' | 'visits'>('last');
  const [sel, setSel] = React.useState<Set<string>>(new Set()); const [limit, setLimit] = React.useState(50); const [compose, setCompose] = React.useState<null | 'message' | 'invite'>(null);
  const [selecting, setSelecting] = React.useState(false); const [menu, setMenu] = React.useState(false);   // phones: selecting is a mode; extras live in ⋯
  const live = all.filter((r) => !r.c.isArchived && r.c.status !== 'archived');
  const segs: { k: Seg; l: string; f: (r: Row) => boolean; money?: boolean }[] = [
    { k: 'all', l: 'Everyone', f: (r) => r.c.status !== 'banned' }, { k: 'due', l: 'Due back', f: (r) => r.dueThisWeek }, { k: 'quiet', l: 'Gone quiet', f: (r) => r.quiet }, { k: 'new', l: 'New', f: (r) => r.isNew },
    { k: 'regulars', l: 'Regulars', f: (r) => r.regular }, { k: 'members', l: 'Members', f: (r) => r.member }, { k: 'owe', l: 'Owe money', f: (r) => r.owes > 0, money: true },
    { k: 'birthdays', l: 'Birthdays', f: (r) => r.birthday }, { k: 'banned', l: 'Not to be booked', f: (r) => r.c.status === 'banned' }];
  const segRows = (k: Seg) => k === 'archived' ? all.filter((r) => r.c.isArchived || r.c.status === 'archived') : live.filter(segs.find((s) => s.k === k)!.f);
  const term = q.trim().toLowerCase(); const qd = term.replace(/\D/g, '');
  const rows = segRows(seg).filter((r) => !term || String(r.c.name || '').toLowerCase().includes(term) || (showContact && ((qd.length >= 3 && last10(r.c.phone).includes(qd)) || String(r.c.email || '').toLowerCase().includes(term))))
    .sort((a, b) => sort === 'name' ? String(a.c.name || '').localeCompare(String(b.c.name || '')) : sort === 'spent' ? b.spent - a.spent : sort === 'visits' ? b.visits - a.visits
      : sort === 'next' ? (a.next ? safe(a.next.startTime).getTime() : Infinity) - (b.next ? safe(b.next.startTime).getTime() : Infinity) : (b.last?.getTime() || 0) - (a.last?.getTime() || 0));
  const maxSpent = Math.max(1, ...live.map((r) => r.spent));
  const seen90 = live.filter((r) => r.last && differenceInDays(now, r.last) <= 90).length;
  const dueWeek = live.filter((r) => r.dueThisWeek); const newMonth = live.filter((r) => r.isNew);   // same meaning as the New segment: first visit in the last 30 days
  const recent = live.filter((r) => r.last && differenceInDays(now, r.last) <= 30); const bookedAhead = recent.filter((r) => r.next).length;
  const owing = live.filter((r) => r.owes > 0); const dupCount = live.filter((r) => r.dup).length;
  const stat = (l: string, n: React.ReactNode, sub: React.ReactNode, warn?: boolean, go?: Seg) => (
    <button type="button" onClick={go ? () => { setSeg(go); setSel(new Set()); } : undefined} disabled={!go} className="w-[160px] shrink-0 snap-start rounded-3xl p-4 text-left disabled:cursor-default md:w-auto md:min-w-0 md:shrink" style={card}>
      <span className="block text-[12px]" style={muted}>{l}</span><span className="block text-[28px] font-light leading-tight" style={warn ? { color: 'var(--warn, #b45309)' } : undefined}>{n}</span><span className="block truncate text-[12px]" style={muted}>{sub}</span></button>);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...sel];
  const exportCsv = () => { const pick = rows.filter((r) => sel.size === 0 || sel.has(r.c.id)); const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Name', ...(showContact ? ['Phone', 'Email'] : []), 'Visits', 'Last visit', 'Next visit', 'Usually', ...(showMoney ? ['Spent', 'Owes'] : [])];
    const lines = pick.map((r) => [r.c.name, ...(showContact ? [r.c.phone, r.c.email] : []), r.visits, r.last ? format(r.last, 'yyyy-MM-dd') : '', r.next ? format(safe(r.next.startTime), 'yyyy-MM-dd HH:mm') : '', r.usual || '', ...(showMoney ? [r.spent.toFixed(2), r.owes.toFixed(2)] : [])].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clients-${format(now, 'yyyy-MM-dd')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const attention = (r: Row) => [r.c.status === 'banned' ? pill('Not to be booked', 'warn') : null, r.formDue ? pill('Form due', 'warn') : null, showMoney && r.owes > 0 ? pill(money(r.owes), 'warn') : !showMoney && r.owes > 0 ? pill('Balance', 'warn') : null,
    r.dueThisWeek ? pill('Not rebooked') : null, r.quiet ? pill('Gone quiet', 'warn') : null, r.birthday ? pill(`Birthday ${format(safe(r.c.dob || r.c.birthday || r.c.dateOfBirth), 'd MMM')}`) : null, r.dup ? pill('Possible duplicate') : null, r.isNew && r.visits === 1 ? pill('New', 'ok') : null].filter(Boolean);
  const identity = (r: Row) => [r.age !== null && r.age < 18 ? `${r.age}` : null, r.member ? 'Member' : null, r.first ? `since ${format(r.first, 'yyyy')}` : 'no visits yet', r.c.preferredContact ? String(r.c.preferredContact).toLowerCase() : null].filter(Boolean).join(' · ');
  const initials = (n: string) => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><h1 className="text-[28px] font-light leading-tight md:text-[32px]">Clients</h1>
          <p className="hidden text-[14px] md:block" style={muted}>{live.length} {live.length === 1 ? 'person' : 'people'} · {seen90} seen in the last 90 days</p>
          <p className="truncate text-[13px] md:hidden" style={muted}>{[`${live.filter((r) => r.c.status !== 'banned').length} people`, dueWeek.length ? `${dueWeek.length} due back` : null, live.some((r) => r.quiet) ? `${live.filter((r) => r.quiet).length} gone quiet` : null, showMoney && owing.length ? `${money(owing.reduce((x, r) => x + r.owes, 0))} owed` : null].filter(Boolean).join(' · ')}</p></div>
        {dupCount > 0 && canManage && <button type="button" onClick={onFindDuplicates} className="hidden h-10 rounded-full px-4 text-[14px] font-semibold md:inline-flex md:items-center" style={{ background: 'var(--soft, #efebe6)' }}>Possible duplicates · {dupCount}</button>}
        <button type="button" onClick={exportCsv} className="hidden h-10 rounded-full px-4 text-[14px] font-semibold md:inline-flex md:items-center" style={{ background: 'var(--soft, #efebe6)' }}>Export</button>
        <button type="button" onClick={onAdd} aria-label="Add client" className="h-11 w-11 rounded-full text-[22px] font-light md:h-10 md:w-auto md:px-5 md:text-[14px] md:font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}><span className="md:hidden">+</span><span className="hidden md:inline">+ Add client</span></button>
        <span className="relative md:hidden"><button type="button" onClick={() => setMenu((v) => !v)} aria-label="More" aria-expanded={menu} className="h-11 w-11 rounded-full text-[18px]" style={{ background: 'var(--soft, #efebe6)' }}>⋯</button>
          {menu && <div role="menu" className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl text-[15px]" style={{ ...card, boxShadow: '0 12px 30px rgba(0,0,0,.14)' }}>
            <button type="button" role="menuitem" onClick={() => { setSelecting((v) => !v); setSel(new Set()); setMenu(false); }} className="block w-full px-4 py-3.5 text-left">{selecting ? 'Done selecting' : 'Select'}</button>
            {dupCount > 0 && canManage && <button type="button" role="menuitem" onClick={() => { setMenu(false); onFindDuplicates(); }} className="block w-full border-t px-4 py-3.5 text-left" style={{ borderColor: 'var(--line, #efebe6)' }}>Possible duplicates · {dupCount}</button>}
            <button type="button" role="menuitem" onClick={() => { setMenu(false); exportCsv(); }} className="block w-full border-t px-4 py-3.5 text-left" style={{ borderColor: 'var(--line, #efebe6)' }}>Export</button>
            <p className="border-t px-4 pb-1 pt-3 text-[12px] font-semibold" style={{ ...muted, borderColor: 'var(--line, #efebe6)' }}>SORT BY</p>
            {([['last', 'Last visit'], ['next', 'Next visit'], ['name', 'Name'], ['visits', 'Most visits'], ...(showMoney ? [['spent', 'Most spent']] : [])] as [any, string][]).map(([k, l]) => <button key={k} type="button" role="menuitemradio" aria-checked={sort === k} onClick={() => { setSort(k); setMenu(false); }} className="block w-full px-4 py-2.5 text-left" style={sort === k ? { fontWeight: 600 } : undefined}>{sort === k ? '✓ ' : ''}{l}</button>)}
          </div>}</span>
      </div>
      <div className="hidden gap-2.5 md:grid md:grid-cols-5">
        {stat('Due back this week', dueWeek.length, `${dueWeek.length ? 'none rebooked yet' : 'all caught up'}`, false, 'due')}
        {stat('New in 30 days', newMonth.length, `${newMonth.filter((r) => r.next || r.visits > 1).length} coming back`, false, 'new')}
        {stat('Next visit booked', recent.length ? `${Math.round((bookedAhead / recent.length) * 100)}%` : '—', 'of those seen in 30 days')}
        {stat('Gone quiet', live.filter((r) => r.quiet).length, 'past their usual gap', live.some((r) => r.quiet), 'quiet')}
        {showMoney ? stat('Owe the business', money(owing.reduce((s, r) => s + r.owes, 0)), `${owing.length} ${owing.length === 1 ? 'person' : 'people'}`, owing.length > 0, 'owe') : stat('Regulars', live.filter((r) => r.regular).length, '6+ visits this year', false, 'regulars')}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} placeholder={showContact ? 'Search name, phone or email' : 'Search by name'} aria-label="Search clients" className="h-10 w-full rounded-full border px-4 text-[15px] sm:w-72" style={{ borderColor: 'var(--line, #e7e2dc)', background: 'var(--card, #fff)' }} />
        <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1" role="tablist" aria-label="Show">
          {[...segs.filter((s) => !s.money || showMoney), { k: 'archived' as Seg, l: 'Archived', f: () => true }].map((s) => { const n = segRows(s.k).length; if (n === 0 && !['all', seg].includes(s.k)) return null;
            return <button key={s.k} type="button" role="tab" aria-selected={seg === s.k} onClick={() => { setSeg(s.k); setSel(new Set()); setLimit(50); }} className="h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold" style={seg === s.k ? { background: 'var(--ink, #1c1917)', color: '#fff', borderColor: 'var(--ink, #1c1917)' } : { background: 'var(--card, #fff)', borderColor: 'var(--line, #e7e2dc)' }}>{s.l} <span style={seg === s.k ? { color: '#d6d3d1' } : muted}>{n}</span></button>; })}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort" className="ml-auto hidden h-9 rounded-full border px-3 text-[13px] md:block" style={{ borderColor: 'var(--line, #e7e2dc)', background: 'var(--card, #fff)' }}>
          <option value="last">Last visit</option><option value="next">Next visit</option><option value="name">Name</option><option value="visits">Most visits</option>{showMoney && <option value="spent">Most spent</option>}</select>
      </div>
      <div className="overflow-hidden rounded-3xl" style={card}>
        <div className="hidden grid-cols-[28px_44px_1.6fr_1.2fr_1.2fr_0.9fr_1.3fr_120px] items-center gap-3 px-4 py-2.5 text-[12px] font-semibold md:grid" style={muted}>
          <input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.slice(0, limit).every((r) => sel.has(r.c.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.slice(0, limit).map((r) => r.c.id)) : new Set())} />
          <span /><span>Client</span><span>Next / last visit</span><span>Usually</span><span>{showMoney ? 'Spent' : 'Visits'}</span><span>Needs attention</span><span /></div>
        {rows.length === 0 && <p className="border-t p-6 text-[14px]" style={{ ...muted, borderColor: 'var(--line, #efebe6)' }}>{term ? 'No one matches that search.' : 'No one here right now.'}</p>}
        {rows.slice(0, limit).map((r, i) => { const pills = attention(r); const action = r.c.status === 'banned' ? null : r.quiet || r.dueThisWeek ? 'invite' : 'book';
          const status = r.next ? <>{format(safe(r.next.startTime), 'EEE d MMM · h:mm a')}</> : r.dueBack && !r.quiet ? <span style={{ color: 'var(--warn, #b45309)' }}>Due {format(r.dueBack, 'd MMM')}</span> : r.last ? <>Last seen {format(r.last, 'd MMM yyyy')}</> : <>No visits yet</>;
          const avatar = (size: number) => r.c.avatarUrl ? <img src={r.c.avatarUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} /> : <span className="flex shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ width: size, height: size, background: AV[i % AV.length] }} aria-hidden="true">{initials(r.c.name)}</span>;
          return (<React.Fragment key={r.c.id}>
            <button type="button" onClick={() => (selecting ? toggle(r.c.id) : onOpen(r.c.id))} aria-pressed={selecting ? sel.has(r.c.id) : undefined}
              className="flex w-full items-center gap-3 border-t px-4 py-3.5 text-left md:hidden" style={{ borderColor: 'var(--line, #efebe6)', background: selecting && sel.has(r.c.id) ? 'color-mix(in srgb, var(--accent, #2e6f6a) 8%, transparent)' : undefined }}>
              {selecting && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px]" style={sel.has(r.c.id) ? { background: 'var(--ink, #1c1917)', borderColor: 'var(--ink, #1c1917)', color: '#fff' } : { borderColor: 'var(--line, #d6d3d1)' }} aria-hidden="true">{sel.has(r.c.id) ? '✓' : ''}</span>}
              {avatar(44)}
              <span className="min-w-0 flex-1"><b className="block truncate text-[16px]">{r.c.name || 'Client'}</b><span className="block truncate text-[13px]" style={muted}>{status}</span></span>
              {pills[0] || null}
              {!selecting && <span className="text-[20px] leading-none" style={muted} aria-hidden="true">›</span>}
            </button>
            <div className="hidden grid-cols-[28px_40px_1fr_auto] items-center gap-3 border-t px-4 py-3 text-[14px] md:grid md:grid-cols-[28px_44px_1.6fr_1.2fr_1.2fr_0.9fr_1.3fr_120px]" style={{ borderColor: 'var(--line, #efebe6)', background: sel.has(r.c.id) ? 'color-mix(in srgb, var(--accent, #2e6f6a) 6%, transparent)' : undefined }}>
              <input type="checkbox" aria-label={`Select ${r.c.name}`} checked={sel.has(r.c.id)} onChange={() => toggle(r.c.id)} />
              {avatar(40)}
              <button type="button" onClick={() => onOpen(r.c.id)} className="min-w-0 text-left"><b className="block truncate">{r.c.name || 'Client'}</b><span className="block truncate text-[12px]" style={muted}>{identity(r)}</span>
</button>
              <span className="hidden min-w-0 md:block">{r.next ? <b className="block truncate">{format(safe(r.next.startTime), 'EEE d MMM, h:mm a')}</b> : r.dueBack && !r.quiet ? <span className="block" style={{ color: 'var(--warn, #b45309)' }}>Due {format(r.dueBack, 'd MMM')}</span> : <span className="block" style={muted}>—</span>}
                <span className="block text-[12px]" style={muted}>{r.last ? `last ${format(r.last, 'd MMM yyyy')}` : 'never visited'}</span></span>
              <span className="hidden min-w-0 md:block"><span className="block truncate">{r.usual || '—'}</span>{r.everyDays && <span className="block text-[12px]" style={muted}>every {Math.max(1, Math.round(r.everyDays / 7))} weeks</span>}</span>
              <span className="hidden md:block">{showMoney ? <>{money(r.spent)}<span className="mt-1 block h-[5px] w-20 overflow-hidden rounded-full" style={{ background: 'var(--soft, #efebe6)' }}><i className="block h-full rounded-full" style={{ width: `${Math.round((r.spent / maxSpent) * 100)}%`, background: 'var(--accent, #2e6f6a)' }} /></span></> : r.visits}</span>
              <span className="hidden flex-wrap gap-1 md:flex">{pills.length ? pills : <span style={muted}>—</span>}</span>
              <span className="text-right">{action === 'invite' && showContact ? <button type="button" onClick={() => { setSel(new Set([r.c.id])); setCompose('invite'); }} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>Invite back</button>
                : action ? <button type="button" onClick={() => onBook(r.c.id)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>Book</button> : null}</span>
            </div></React.Fragment>); })}
        {rows.length > limit && <button type="button" onClick={() => setLimit(limit + 100)} className="w-full border-t py-3 text-[14px] font-semibold" style={{ borderColor: 'var(--line, #efebe6)' }}>Show more ({rows.length - limit})</button>}
      </div>
      {sel.size > 0 && <div className="fixed inset-x-3 bottom-3 z-40 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2 text-[14px] shadow-lg md:sticky md:inset-x-auto md:z-30 md:mx-auto md:w-fit md:rounded-full" style={{ background: 'var(--ink, #1c1917)', color: '#fff', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }} role="toolbar" aria-label="With the selected clients">
        <span className="px-1">{sel.size} selected</span>
        {showContact && <button type="button" onClick={() => setCompose('message')} className="h-9 rounded-full px-3 font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>Message</button>}
        {showContact && <button type="button" onClick={() => setCompose('invite')} className="h-9 rounded-full px-3 font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>Invite back</button>}
        <button type="button" onClick={() => { const t = window.prompt('Tag to add (for example “bridal 2026”)'); if (t && t.trim()) { onTag(ids, t.trim().slice(0, 40)); setSel(new Set()); } }} className="h-9 rounded-full px-3 font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>Add a tag</button>
        <button type="button" onClick={exportCsv} className="h-9 rounded-full px-3 font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>Export</button>
        {canManage && (seg === 'archived' ? <button type="button" onClick={() => { onUnarchive(ids); setSel(new Set()); }} className="h-9 rounded-full px-3 font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>Restore</button>
          : <button type="button" onClick={() => { onArchive(ids); setSel(new Set()); }} className="h-9 rounded-full px-3 font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>Archive</button>)}
        {canManage && onDelete && seg === 'archived' && <button type="button" onClick={() => onDelete(ids)} className="h-9 rounded-full px-3 font-semibold" style={{ color: '#fca5a5' }}>Delete</button>}
        <button type="button" onClick={() => setSel(new Set())} className="h-9 rounded-full px-2" aria-label="Clear selection">✕</button>
      </div>}
      {compose && <BulkMessage tenantId={tenantId} kind={compose} people={all.filter((r) => sel.has(r.c.id)).map((r) => r.c)} onClose={(done) => { setCompose(null); if (done) setSel(new Set()); }} />}
    </div>);
}

/** Message (or invite back) everyone selected — each through the shared sender, so consent and message settings apply per person. */
function BulkMessage({ tenantId, kind, people, onClose }: { tenantId: string; kind: 'message' | 'invite'; people: any[]; onClose: (done: boolean) => void }) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/book/${tenantId}` : '';
  const [text, setText] = React.useState(kind === 'invite' ? `Hi {first}! It’s been a little while — we’d love to see you again. Book any time: ${link}` : 'Hi {first}, ');
  const [busy, setBusy] = React.useState(false); const [result, setResult] = React.useState<{ sent: number; skipped: string[] } | null>(null);
  const capped = people.slice(0, 100);
  const send = async () => { setBusy(true); const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || ''; let sent = 0; const skipped: string[] = [];
    for (const c of capped) { const body = text.replace(/\{first\}/g, String(c.name || '').split(' ')[0] || 'there');
      const r: any = await fetch('/api/clients/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, clientId: c.id, action: 'send', text: body }) }).then((x) => x.json()).catch(() => null);
      if (r?.ok) sent++; else skipped.push(`${c.name || 'Someone'} (${String(r?.error || 'not sent').replace(/[.!]+$/, '')})`); }
    setBusy(false); setResult({ sent, skipped }); };
  return (
    <div role="dialog" aria-label={kind === 'invite' ? 'Invite back' : 'Message clients'} className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(28,25,23,.38)' }} onClick={() => !busy && onClose(!!result)}>
      <div className="w-full max-w-lg space-y-3 rounded-t-[28px] p-5 sm:rounded-[26px]" style={{ background: 'var(--card, #fff)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[20px] font-light">{kind === 'invite' ? 'Invite back' : 'Message'} {capped.length} {capped.length === 1 ? 'person' : 'people'}</h2>
        {result ? <>
          <p className="text-[15px]"><b>{result.sent}</b> sent.{result.skipped.length ? ` ${result.skipped.length} not sent:` : ''}</p>
          {result.skipped.length > 0 && <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-[13px]" style={muted}>{result.skipped.map((s) => <li key={s}>{s}</li>)}</ul>}
          <button type="button" onClick={() => onClose(true)} className="h-10 rounded-full px-5 text-[14px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Done</button>
        </> : <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Message" className="w-full rounded-2xl border p-3 text-[15px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
          <p className="text-[12px]" style={muted}>{'{first}'} becomes each person’s first name. Each goes by text where they allow texts, otherwise email; anyone who can’t be reached is listed afterwards.{people.length > 100 ? ' The first 100 are sent now.' : ''}</p>
          <div className="flex gap-2"><button type="button" disabled={busy || !text.trim()} onClick={send} className="h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>{busy ? 'Sending…' : `Send to ${capped.length}`}</button><button type="button" disabled={busy} onClick={() => onClose(false)} className="h-10 rounded-full px-4 text-[14px]" style={muted}>Cancel</button></div>
        </>}
      </div>
    </div>);
}
