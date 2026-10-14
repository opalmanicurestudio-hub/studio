'use client';
// src/components/referrals/CircleBoard.tsx — the business's CIRCLE tab on the Referrals page (design canvas RF20):
// requests to join (accept, make a creator, waitlist, decline), boosts (start one, end one), members by tier with their
// friends and link opens, creators with their codes and what's owed in cash (mark paid), and a creator editor.
// /api/referrals (circle, circle_do → lib/circle-server).
import * as React from 'react';
import Link from 'next/link';
import { payPost } from '@/components/pay/pay-client';
import { uploadImage } from '@/lib/upload-image';
import { MetalCard } from '@/components/referrals/MetalCard';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };
const btn = (dark: boolean) => `h-9 rounded-full px-3.5 text-[13px] font-semibold ${dark ? 'text-white' : 'border bg-card'}`;
const card = 'rounded-[20px] border bg-card p-4';

function CreatorEditor({ tenantId, m, onDone }: { tenantId: string; m: any; onDone: (msg: string) => void }) {
  const cr = m.creator || {};
  const [f, setF] = React.useState<any>({ code: cr.code || `${String(m.name).split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '')}20`, handle: cr.handle || '', displayName: cr.displayName || m.name, line: cr.line || '',
    friend: Math.round((cr.friendCents ?? 2000) / 100), reward: Math.round((cr.rewardCents ?? 1500) / 100), pay: cr.pay || 'credit', cash: Math.round((cr.cashCents ?? 0) / 100), looks: cr.looks || [], picks: cr.picks || [] });
  const [services, setServices] = React.useState<any[]>([]); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  React.useEffect(() => { void payPost('/api/referrals', { tenantId, action: 'services' }).then((r) => setServices(r?.ok ? r.services || [] : [])); }, [tenantId]);
  const save = async (end = false) => { setBusy(end ? 'end' : 'save'); setErr('');
    const r = await payPost('/api/referrals', { tenantId, action: 'circle_do', do: 'creator', clientId: m.clientId, end, creator: { code: f.code, handle: f.handle, displayName: f.displayName, line: f.line, friendCents: Number(f.friend) * 100, rewardCents: Number(f.reward) * 100, pay: f.pay, cashCents: Number(f.cash) * 100, picks: f.picks, looks: f.looks } });
    setBusy(''); if (r?.ok) onDone(end ? `${m.name} is no longer a creator.` : `${m.name} is a creator. Their code is ${r.creator?.code}.`); else setErr(r?.error || 'That didn’t save.'); };
  const inp = 'h-10 w-full rounded-[12px] border px-3 text-[14px]';
  return <div className="space-y-3 rounded-[16px] p-4" style={{ background: SOFT }}>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-[12.5px] font-semibold">Their code<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) })} className={`${inp} mt-1 tracking-[0.08em]`} style={{ borderColor: LINE }} /></label>
      <label className="text-[12.5px] font-semibold">Instagram or TikTok<input value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="@handle" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
      <label className="text-[12.5px] font-semibold">Name on their page<input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
    </div>
    <label className="block text-[12.5px] font-semibold">A line in their words (you approve it)<input value={f.line} maxLength={200} onChange={(e) => setF({ ...f, line: e.target.value })} placeholder="I’ve trusted them with my nails for two years." className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
    <div className="grid gap-3 sm:grid-cols-4">
      <label className="text-[12.5px] font-semibold">Off for followers<span className="mt-1 flex items-center gap-1">$<input type="number" min={0} value={f.friend} onChange={(e) => setF({ ...f, friend: e.target.value })} className={inp} style={{ borderColor: LINE }} /></span></label>
      <label className="text-[12.5px] font-semibold">Credit per paid first visit<span className="mt-1 flex items-center gap-1">$<input type="number" min={0} value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} className={inp} style={{ borderColor: LINE }} /></span></label>
      <label className="text-[12.5px] font-semibold">Also pay cash?<select value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} className={`${inp} mt-1 bg-card`} style={{ borderColor: LINE }}><option value="credit">No, credit only</option><option value="cash">Yes, per paid first visit</option></select></label>
      {f.pay === 'cash' && <label className="text-[12.5px] font-semibold">Cash per paid first visit<span className="mt-1 flex items-center gap-1">$<input type="number" min={0} value={f.cash} onChange={(e) => setF({ ...f, cash: e.target.value })} className={inp} style={{ borderColor: LINE }} /></span></label>}
    </div>
    {f.pay === 'cash' && <p className="text-[12px] leading-[1.5]" style={{ color: MUTED }}>Cash is tracked here as owed until you pay them yourself and mark it paid. Get their W-9 before the first payment; in the US, $600 or more in a year usually means a 1099. Check with your accountant.</p>}
    {services.length > 0 && <div><p className="text-[12.5px] font-semibold">Their picks (up to 4, shown on their page)</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{services.map((s) => { const on = f.picks.includes(s.id); return <button key={s.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, picks: on ? f.picks.filter((x: string) => x !== s.id) : [...f.picks, s.id].slice(0, 4) })} className="rounded-full border px-3 py-1.5 text-[12.5px]" style={on ? { background: INK, color: 'hsl(var(--background))', borderColor: INK } : { borderColor: LINE, background: 'hsl(var(--card))' }}>{s.name}</button>; })}</div></div>}
    <div><p className="text-[12.5px] font-semibold">Looks done here (photos they’ve said you can share)</p>
      <div className="mt-1.5 flex flex-wrap gap-2">{f.looks.map((u: string) => <div key={u} className="relative h-20 w-16 overflow-hidden rounded-[10px] bg-cover bg-center" style={{ backgroundImage: `url(${u})` }}><button type="button" aria-label="Remove photo" onClick={() => setF({ ...f, looks: f.looks.filter((x: string) => x !== u) })} className="absolute right-1 top-1 rounded-full bg-card/90 px-1.5 text-[11px]">×</button></div>)}
        {f.looks.length < 6 && <label className="flex h-20 w-16 cursor-pointer items-center justify-center rounded-[10px] border border-dashed text-center text-[11px]" style={{ borderColor: '#c9cace', color: MUTED }}>{busy === 'photo' ? '…' : '+ Add'}
          <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy('photo'); try { const url = await uploadImage(`tenants/${tenantId}/circle/${m.clientId}-${Date.now().toString(36)}.jpg`, file, 1400); setF((x: any) => ({ ...x, looks: [...x.looks, url].slice(0, 6) })); } catch { setErr('That photo didn’t upload.'); } setBusy(''); }} /></label>}</div></div>
    {err && <p className="text-[13px] font-semibold" style={{ color: RED }}>{err}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={() => save()} className={btn(true)} style={{ background: INK }}>{busy === 'save' ? 'Saving…' : m.creator ? 'Save' : 'Make them a creator'}</button>
      {m.creator && <button type="button" disabled={!!busy} onClick={() => save(true)} className={btn(false)} style={{ borderColor: LINE }}>No longer a creator</button>}</div>
  </div>;
}

export function CircleBoard({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [note, setNote] = React.useState<{ ok: boolean; t: string } | null>(null);
  const [edit, setEdit] = React.useState<string | null>(null); const [boost, setBoost] = React.useState({ name: 'Double credit weekend', multiplier: 2, days: 3 }); const [showBoost, setShowBoost] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const load = React.useCallback(() => payPost('/api/referrals', { tenantId, action: 'circle' }).then(setD), [tenantId]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);
  if (!d) return <p className="mt-4" style={{ color: MUTED }}>Loading…</p>;
  if (!d.ok) return <p className="mt-4" style={{ color: RED }}>{d.error || 'The Circle couldn’t load.'}</p>;
  const act = async (key: string, body: any, ok: string) => { setBusy(key); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'circle_do', ...body }); setBusy(''); setNote(r?.ok ? { ok: true, t: typeof ok === 'function' ? (ok as any)(r) : ok } : { ok: false, t: r?.error || 'That didn’t work.' }); if (r?.ok) void load(); return r; };
  const C = d.circle; const tiers: any[] = C.tiers;
  const members: any[] = (d.members || []).filter((m: any) => filter === 'all' || (filter === 'creators' ? !!m.creator : m.tierId === filter));
  const live = (d.boosts || []).find((b: any) => b.live);
  if (!C.on) return <div className={`${card} space-y-3`} style={{ borderColor: LINE }}><p className="text-[20px] font-light">The {C.name} is off</p>
    <p className="text-[13.5px] leading-[1.55]" style={{ color: MUTED }}>Turn it on to give clients tiers they earn by bringing friends ({tiers.map((t) => `${t.name} at ${t.friends}`).join(', ')}), their own codes and cards, a public page that makes people want in, and creators with their own pages.</p>
    <Link href="/referrals/settings#circle" className={`${btn(true)} inline-flex items-center`} style={{ background: INK }}>Set up the {C.name}</Link></div>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[26px] font-light tracking-[-0.02em]">The {d.name}</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>{[C.season?.name ? `${C.season.name} season` : null, d.placesLeft != null ? `${d.placesLeft} place${d.placesLeft === 1 ? '' : 's'} left` : null, `${d.members.length} member${d.members.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p></div>
        <div className="flex gap-2"><a href={`/circle/${encodeURIComponent(tenantId)}`} target="_blank" rel="noreferrer" className={`${btn(false)} inline-flex items-center`} style={{ borderColor: LINE }}>See the public page ↗</a>
          <Link href="/referrals/settings#circle" className={`${btn(false)} inline-flex items-center`} style={{ borderColor: LINE }}>Circle settings</Link></div></div>
      {d.seasonEnded && <div className="flex flex-wrap items-center gap-3 rounded-[18px] border p-4" style={{ borderColor: '#f3dfc4', background: '#fdf8f1' }}>
        <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{C.season?.name ? `The ${C.season.name} season` : 'This season'} has ended</p>
          <p className="text-[13px]" style={{ color: MUTED }}>{d.lastSeason && d.lastSeason.end === C.season?.end && d.lastSeason.same != null ? `${(d.lastSeason.same || 0) + (d.lastSeason.kept || 0)} kept their level, ${d.lastSeason.down || 0} moved down one${d.lastSeason.left ? `, ${d.lastSeason.left} left` : ''}${d.lastSeason.up ? `, ${d.lastSeason.up} moved up` : ''}. ` : 'Levels are rechecked within the hour. '}Set when the next season ends.</p></div>
        <Link href="/referrals/settings#circle" className={`${btn(true)} inline-flex items-center`} style={{ background: INK }}>Set the next season</Link></div>}
      {note && <p className="text-[13.5px] font-semibold" style={{ color: note.ok ? GREEN : RED }}>{note.t}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className={`${card} space-y-2`} style={{ borderColor: LINE }} aria-label="Asking to join">
          <p className="text-[16px] font-semibold">Asking to join{(d.requests || []).length ? ` · ${d.requests.length}` : ''}</p>
          {(d.requests || []).length ? d.requests.map((r: any) => <div key={r.id} className="space-y-2 border-b py-3" style={{ borderColor: LINE }}>
            <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold" style={{ background: SOFT }}>{String(r.name)[0]}</span>
              <div className="min-w-0 flex-1"><p className="text-[14.5px] font-semibold">{r.name} {r.handle && <span className="text-[12.5px] font-normal" style={{ color: MUTED }}>{r.handle}{r.followers ? ` · ${r.followers}` : ''}</span>}{r.status === 'waitlist' && <span className="ml-2 rounded-full px-2 py-0.5 text-[11px]" style={{ background: SOFT }}>waitlist</span>}</p>
                {r.why && <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>“{r.why}”</p>}<p className="text-[12px]" style={{ color: MUTED }}>Mobile ···{String(r.phone).slice(-4)} · {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p></div></div>
            <div className="flex flex-wrap gap-1.5 pl-12">
              <button type="button" disabled={!!busy} onClick={() => act(r.id, { do: 'request', id: r.id, decision: 'accept' }, `${r.name} is in, as an Insider.`)} className={btn(true)} style={{ background: INK }}>Accept</button>
              <button type="button" disabled={!!busy} onClick={async () => { const x = await act(r.id, { do: 'request', id: r.id, decision: 'creator' }, `${r.name} is in. Set up their creator code below.`); if (x?.clientId) setEdit(x.clientId); }} className={btn(false)} style={{ borderColor: LINE }}>As a creator</button>
              {r.status !== 'waitlist' && <button type="button" disabled={!!busy} onClick={() => act(r.id, { do: 'request', id: r.id, decision: 'waitlist' }, 'On the waitlist for next season.')} className={btn(false)} style={{ borderColor: LINE }}>Waitlist</button>}
              <button type="button" disabled={!!busy} onClick={() => act(r.id, { do: 'request', id: r.id, decision: 'decline' }, 'Declined.')} className="h-9 px-2 text-[13px] underline underline-offset-2" style={{ color: MUTED }}>Decline</button></div>
          </div>) : <p className="text-[13px]" style={{ color: MUTED }}>Nobody right now. Share your public page to bring requests in.</p>}
        </section>
        <div className="space-y-4">
          <section className={`${card} space-y-2`} style={{ borderColor: LINE }} aria-label="Boosts">
            <div className="flex items-center justify-between"><p className="text-[16px] font-semibold">Boosts</p>{!live && <button type="button" onClick={() => setShowBoost(!showBoost)} className="text-[13px] font-semibold underline underline-offset-2">+ New boost</button>}</div>
            {live ? <div className="flex items-center justify-between gap-3 rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)' }}><div><p className="text-[14px] font-semibold">{live.name}</p><p className="text-[12px]" style={{ color: MUTED }}>{live.multiplier}× credit · ends {new Date(live.end).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })}</p></div>
              <button type="button" disabled={!!busy} onClick={() => act('endb', { do: 'end_boost', id: live.id }, 'Boost ended.')} className={btn(false)} style={{ borderColor: LINE }}>End now</button></div>
              : <p className="text-[13px]" style={{ color: MUTED }}>A short window of extra credit, like a double-credit weekend. Members see it in their wallet, with when it ends.</p>}
            {showBoost && !live && <div className="space-y-2 rounded-[14px] p-3" style={{ background: SOFT }}>
              <input value={boost.name} onChange={(e) => setBoost({ ...boost, name: e.target.value })} aria-label="Boost name" className="h-10 w-full rounded-[12px] border bg-card px-3 text-[14px]" style={{ borderColor: LINE }} />
              <div className="flex flex-wrap items-center gap-2 text-[13px]"><select value={boost.multiplier} onChange={(e) => setBoost({ ...boost, multiplier: Number(e.target.value) })} aria-label="How much credit" className="h-10 rounded-[12px] border bg-card px-2" style={{ borderColor: LINE }}><option value={2}>Double credit</option><option value={3}>Triple credit</option></select>
                for <select value={boost.days} onChange={(e) => setBoost({ ...boost, days: Number(e.target.value) })} aria-label="How long" className="h-10 rounded-[12px] border bg-card px-2" style={{ borderColor: LINE }}>{[1, 2, 3, 7, 14].map((x) => <option key={x} value={x}>{x} day{x === 1 ? '' : 's'}</option>)}</select>
                <button type="button" disabled={!!busy} onClick={async () => { const r = await act('boost', { do: 'boost', name: boost.name, multiplier: boost.multiplier, end: new Date(Date.now() + boost.days * 864e5).toISOString() }, 'Boost started.'); if (r?.ok) setShowBoost(false); }} className={btn(true)} style={{ background: INK }}>Start now</button></div></div>}
          </section>
          {d.owedCents > 0 && <section className={`${card} space-y-2`} style={{ borderColor: '#f3dfc4' }} aria-label="Owed to creators"><p className="text-[16px] font-semibold">Owed to creators · {money(d.owedCents)}</p>
            {d.members.filter((m: any) => m.owedCents > 0).map((m: any) => <div key={m.clientId} className="flex items-center justify-between gap-2 border-b py-2" style={{ borderColor: LINE }}><span className="text-[14px]">{m.name}<span className="block text-[12px]" style={{ color: MUTED }}>{money(m.owedCents)} in cash, for paid first visits</span></span>
              <button type="button" disabled={!!busy} onClick={() => { const how = window.prompt(`How did you pay ${m.name}? (Zelle, Venmo, check…)`, 'Zelle'); if (how != null) void act(`p${m.clientId}`, { do: 'cash_paid', clientId: m.clientId, method: how }, `Marked paid to ${m.name}.`); }} className={btn(false)} style={{ borderColor: LINE }}>Mark paid</button></div>)}</section>}
        </div>
      </div>

      <section className={`${card} space-y-3`} style={{ borderColor: LINE }} aria-label="Members">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[...tiers.slice().reverse().map((t: any) => [t.id, `${t.name}s`, d.counts?.[t.id] || 0, `${t.friends}+ friends`]), ['creators', 'Creators', d.creatorsCount || 0, 'by invitation']].map(([id, label, n, sub]: any) =>
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(filter === id ? 'all' : id)} className="rounded-[16px] border p-3 text-left" style={{ borderColor: filter === id ? INK : LINE }}><p className="text-[12px] font-semibold" style={{ color: MUTED }}>{label}</p><p className="text-[26px] font-light">{n}</p><p className="text-[11.5px]" style={{ color: MUTED }}>{sub}</p></button>)}</div>
        {members.length ? members.map((m: any) => <div key={m.clientId} className="border-b py-3" style={{ borderColor: LINE }}>
          <div className="flex flex-wrap items-center gap-3"><div className="w-[150px] shrink-0"><MetalCard look={m.creator ? 'creator' : m.tierId || 'none'} program={d.name} tier={m.creator ? 'Creator' : m.tier || '—'} name={String(m.name).split(' ')[0]} compact /></div>
            <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{m.name}{m.creator && <span className="ml-2 text-[12.5px] font-normal tracking-[0.06em]" style={{ color: MUTED }}>{m.creator.code}{m.creator.handle ? ` · ${m.creator.handle}` : ''}</span>}</p>
              <p className="text-[12.5px]" style={{ color: MUTED }}>{m.friends} friend{m.friends === 1 ? '' : 's'} (12 months) · {m.opens} opens this month{m.toNext ? ` · ${m.toNext}` : ''}{m.optIn ? ' · shown on the page' : ''}</p></div>
            {m.earnedCents > 0 && <span className="text-[13px] font-semibold" style={{ color: GREEN }}>{money(m.earnedCents)} earned</span>}
            <select value={m.tierId || ''} onChange={(e) => act(`t${m.clientId}`, { do: 'tier', clientId: m.clientId, tier: e.target.value || null }, 'Tier updated.')} aria-label={`${m.name}’s tier`} className="h-9 rounded-full border bg-card px-2 text-[13px]" style={{ borderColor: LINE }}>
              <option value="">Not a member</option>{tiers.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <button type="button" onClick={() => setEdit(edit === m.clientId ? null : m.clientId)} className={btn(false)} style={{ borderColor: LINE }}>{m.creator ? 'Creator details' : 'Make creator'}</button></div>
          {edit === m.clientId && <div className="mt-3"><CreatorEditor tenantId={tenantId} m={m} onDone={(t) => { setNote({ ok: true, t }); setEdit(null); void load(); }} /></div>}
        </div>) : <p className="text-[13px]" style={{ color: MUTED }}>{filter === 'all' ? `Nobody yet. Clients join on their own once ${tiers[0].friends} friends have visited, or you accept their request.` : 'Nobody here yet.'}</p>}
      </section>
    </div>);
}
