'use client';
// src/components/referrals/ReferralsSettings.tsx — Referrals → SETTINGS, on their own page (design canvas RF15):
// Program (amounts, when credit is given, how long it lasts, limits, bring a friend), Welcome page (photos, arriving,
// layout, sections, who first, motion, live preview), Rules (always on), and Try it yourself. One Save for all of it.
// /api/referrals (lib/referrals-server).
import * as React from 'react';
import Link from 'next/link';
import { payPost } from '@/components/pay/pay-client';
import { uploadImage } from '@/lib/upload-image';
import { WelcomeSettings } from '@/components/referrals/WelcomeSettings';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', RED = '#b42318';
const MENU = [['program', 'Program'], ['circle', 'The Circle'], ['welcome', 'Welcome page'], ['rules', 'Rules'], ['try', 'Try it yourself']] as const;

const Switch = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: on ? INK : '#dcdde0' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-card transition-all" style={{ left: on ? 23 : 3 }} /></button>;
const Card = ({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) =>
  <section id={id} className="scroll-mt-24 space-y-1 rounded-[20px] border bg-card p-5" style={{ borderColor: LINE }} aria-label={title}><p className="text-[18px] font-light tracking-[-0.01em]">{title}</p>{sub && <p className="pb-2 text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>{sub}</p>}{children}</section>;

export function ReferralsSettings({ tenantId }: { tenantId: string }) {
  const [s, setS] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [note, setNote] = React.useState<{ ok: boolean; t: string } | null>(null); const [dirty, setDirty] = React.useState(false);
  const [at, setAt] = React.useState('program');
  React.useEffect(() => { if (tenantId) void payPost('/api/referrals', { tenantId, action: 'get_settings' }).then((r) => setS(r?.ok ? r.settings : { error: r?.error || 'Settings couldn’t load.' })); }, [tenantId]);
  React.useEffect(() => { const h = window.location.hash.slice(1); if (h) { setAt(h); setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: 'smooth' }), 300); } }, [s?.on === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = React.useCallback((fn: any) => { setDirty(true); setS((x: any) => (typeof fn === 'function' ? fn(x) : fn)); }, []);
  if (!s) return <p className="mt-6" style={{ color: MUTED }}>Loading…</p>;
  if (s.error) return <p className="mt-6" style={{ color: RED }}>{s.error}</p>;
  const save = async () => { setBusy('settings'); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'settings', referrals: s }); setBusy('');
    if (r?.ok) { setDirty(false); setS(r.settings); } setNote(r?.ok ? { ok: true, t: s.on ? 'Saved. Clients now see “Share with a friend” on their visit link.' : 'Saved. Referrals are off.' } : { ok: false, t: r?.error || 'That didn’t save.' }); };
  const row = (k: string, label: string, el: React.ReactNode, sub?: string) => <label key={k} className="flex items-center justify-between gap-3 py-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><span>{label}{sub && <span className="block text-[12px]" style={{ color: MUTED }}>{sub}</span>}</span>{el}</label>;
  const cents = (k: string) => <span className="flex items-center gap-1">$<input type="number" min={0} max={500} value={Math.round((s?.[k] || 0) / 100)} onChange={(e) => set({ ...s, [k]: Math.max(0, Number(e.target.value) || 0) * 100 })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></span>;
  const go = (id: string) => { setAt(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', `#${id}`); };
  return (
    <div className="mx-auto mt-4 max-w-[1180px] pb-28" style={{ color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-5"><div><p className="text-[12px]" style={{ color: MUTED }}><Link href="/referrals" className="underline-offset-2 hover:underline">Referrals</Link> › Settings</p>
        <h1 className="text-[30px] font-light tracking-[-0.02em]">Settings</h1></div>
        <div className="flex items-center gap-3 rounded-full border bg-card py-1.5 pl-4 pr-1.5" style={{ borderColor: LINE }}><span className="text-[14px] font-semibold">{s.on ? 'Referrals are on' : 'Referrals are off'}</span><Switch on={!!s.on} label="Referrals on" onClick={() => set({ ...s, on: !s.on })} /></div></div>
      <div className="grid items-start gap-5 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col" aria-label="Settings sections">{MENU.map(([id, t]) => <button key={id} type="button" onClick={() => go(id)} className="whitespace-nowrap rounded-[12px] px-3 py-2 text-left text-[14px]" style={at === id ? { background: 'hsl(var(--card))', fontWeight: 700, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: MUTED }}>{t}</button>)}</nav>
        <div className="min-w-0 space-y-5">
          <Card id="program" title="Program" sub="Clients read the terms page made from these. The friend’s offer is a discount you approve by saving; prices on a service never change.">
            {row('r', 'Credit for the person who referred', cents('rewardCents'))}
            {row('f', 'Off the friend’s first visit', cents('friendCents'))}
            {row('u', 'Credit is given', <select value={s.unlock} onChange={(e) => set({ ...s, unlock: e.target.value })} className="h-10 rounded-[12px] border bg-card px-2 text-[14px]" style={{ borderColor: LINE }}><option value="paid">After the friend’s first paid visit</option><option value="booked">When the friend books (easier to abuse)</option></select>)}
            {row('m', 'Credit lasts', <select value={s.months} onChange={(e) => set({ ...s, months: Number(e.target.value) })} className="h-10 rounded-[12px] border bg-card px-2 text-[14px]" style={{ borderColor: LINE }}>{[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} months</option>)}</select>)}
            {row('g', 'Bring a friend', <Switch on={s.group !== false} label="New guests booked together count as referrals" onClick={() => set({ ...s, group: s.group === false })} />, 'New guests booked together count as a referral')}
            {row('h', 'Same saved card, same address', <select value={s.household || 'review'} onChange={(e) => set({ ...s, household: e.target.value })} className="h-10 rounded-[12px] border bg-card px-2 text-[14px]" style={{ borderColor: LINE }}><option value="review">Ask me first</option><option value="give">Give credit (one household)</option></select>, 'A parent paying for a teen, partners sharing a card')}
            {row('c', 'Most rewards a month, per client', <input type="number" min={1} max={50} value={s.cap} onChange={(e) => set({ ...s, cap: Number(e.target.value) })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} />)}
            <div className="pt-2"><a href={`/ref/${encodeURIComponent(tenantId)}/terms`} target="_blank" rel="noreferrer" className="text-[13.5px] underline underline-offset-2">Preview terms</a></div>
          </Card>
          <CircleSettings s={s} set={set} />
          <Card id="welcome" title="Welcome page" sub="What a friend sees when they open a client’s link.">
            <div className="space-y-2 pb-1">
              <p className="text-[14px] font-semibold">Your photos</p>
              <p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>{(s.photos || []).length ? 'Your photos fill the top of the page (or each Stories screen); the others show further down.' : 'Add up to 3 photos to make your welcome page shine: your space, your work, a happy moment. Without photos it still looks finished: choose Simple, or let the app choose for you.'}</p>
              <div className="flex flex-wrap gap-2">{(s.photos || []).map((u: string, i: number) => <div key={u} className="relative h-24 w-24 overflow-hidden rounded-[14px] bg-cover bg-center" style={{ backgroundImage: `url(${u})` }}>
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-card/90 px-2 py-0.5 text-[10.5px] font-semibold">{i === 0 ? 'Opening' : `Photo ${i + 1}`}</span>
                  <button type="button" aria-label="Remove photo" onClick={() => set({ ...s, photos: s.photos.filter((x: string) => x !== u) })} className="absolute bottom-1.5 right-1.5 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-semibold">Remove</button></div>)}
                {(s.photos || []).length < 3 && <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-[14px] border border-dashed text-center text-[12px] font-semibold" style={{ borderColor: '#c9cace', color: MUTED }}>
                  {busy === 'photo' ? 'Adding…' : '+ Add a photo'}<input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy('photo');
                    try { const url = await uploadImage(`tenants/${tenantId}/referrals/${Date.now().toString(36)}.jpg`, f, 1600); set((x: any) => ({ ...x, photos: [...(x.photos || []), url].slice(0, 3) })); setNote({ ok: true, t: 'Photo added. Save to put it on your welcome page.' }); }
                    catch { setNote({ ok: false, t: 'That photo didn’t upload. Please try again.' }); } setBusy(''); }} /></label>}</div>
              <label className="block pt-2 text-[14px]">Arriving (optional)<input value={s.arrival || ''} maxLength={200} onChange={(e) => set({ ...s, arrival: e.target.value })} placeholder="e.g. Free parking behind the building; we’re on the second floor." className="mt-1 h-10 w-full rounded-[12px] border px-3 text-[14px]" style={{ borderColor: LINE }} /></label>
            </div>
            <WelcomeSettings tenantId={tenantId} s={s} setS={set} />
          </Card>
          <Card id="rules" title="Rules" sub="These are always on, so the program can’t be gamed.">
            <ul className="space-y-2 text-[13.5px] leading-[1.5]">{['The friend must be new to you.', 'The same phone or email as the person who referred isn’t eligible.', 'The same saved card waits for you to look at it, with the evidence (households at the same address can be given automatically).', 'Reviews are never rewarded.', 'A refunded visit takes back credit that hasn’t been used.', 'Each friend gets one welcome offer.'].map((t) =>
              <li key={t} className="flex gap-2.5"><span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: GREEN }} aria-hidden="true">✓</span>{t}</li>)}</ul>
          </Card>
          <TryIt tenantId={tenantId} />
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 pt-3" style={{ background: 'linear-gradient(180deg, rgba(247,247,248,0), #f7f7f8 45%)', pointerEvents: 'none' }}>
        <div className="flex items-center gap-3 rounded-full border bg-card py-1.5 pl-4 pr-1.5 shadow-lg" style={{ borderColor: LINE, pointerEvents: 'auto' }}>
          <span className="text-[13px] font-semibold" style={{ color: note ? (note.ok ? GREEN : RED) : MUTED }}>{note ? note.t : dirty ? 'Changes not saved yet' : 'All saved'}</span>
          <button type="button" onClick={save} disabled={busy === 'settings'} className="h-10 rounded-full px-5 text-[14px] font-semibold text-background" style={{ background: INK }}>{busy === 'settings' ? 'Saving…' : 'Save'}</button></div></div>
    </div>);
}

/** Try it yourself: open any client's wallet as they see it (a private link for 2 hours) and their welcome link. */
function TryIt({ tenantId }: { tenantId: string }) {
  const [q, setQ] = React.useState(''); const [list, setList] = React.useState<any[]>([]); const [sel, setSel] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { const t = setTimeout(() => { if (q.trim().length < 2) { setList([]); return; } void payPost('/api/referrals', { tenantId, action: 'find', q }).then((r) => setList(r?.ok ? r.clients || [] : [])); }, 250); return () => clearTimeout(t); }, [q, tenantId]);
  const pick = async (c: any) => { setBusy(true); setErr(''); const r = await payPost('/api/referrals', { tenantId, action: 'preview', clientId: c.id }); setBusy(false); if (r?.ok) { setSel(r); setList([]); setQ(''); } else setErr(r?.error || 'That didn’t work.'); };
  return (
    <Card id="try" title="Try it yourself" sub="See any client’s wallet exactly as they do, and open their welcome link like a friend would. Wallet links are private and last 2 hours.">
      <div className="space-y-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A client’s name, or the last 4 digits of their phone" aria-label="Find a client" className="h-11 w-full rounded-[12px] border px-3 text-[14px]" style={{ borderColor: LINE }} />
        {list.length > 0 && <div className="divide-y rounded-[12px] border" style={{ borderColor: LINE }}>{list.map((c) => <button key={c.id} type="button" disabled={busy} onClick={() => pick(c)} className="flex w-full justify-between px-3 py-2.5 text-left text-[14px]"><span>{c.name}</span><span style={{ color: MUTED }}>{c.phoneLast4 ? `···${c.phoneLast4}` : ''}</span></button>)}</div>}
        {err && <p className="text-[13px] font-semibold" style={{ color: RED }}>{err}</p>}
        {sel && <div className="space-y-2 rounded-[14px] p-3" style={{ background: SOFT }}>
          <p className="text-[14px] font-semibold">{sel.name}</p>
          <div className="flex flex-wrap gap-2"><a href={sel.walletUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-background" style={{ background: INK }}>Open their wallet</a>
            <a href={sel.welcomeUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border bg-card px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Open their welcome link</a>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(sel.welcomeUrl); }} className="inline-flex h-10 items-center rounded-full border bg-card px-4 text-[13.5px]" style={{ borderColor: LINE }}>Copy welcome link</button></div></div>}
        <details className="text-[13px] leading-[1.6]" style={{ color: MUTED }}><summary className="cursor-pointer font-semibold" style={{ color: INK }}>A full test, start to finish</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Switch Referrals on and save.</li>
            <li>Find a test client above (it can be you) and open their welcome link on another phone.</li>
            <li>Book as a new client, with a different phone number and email.</li>
            <li>On the Referrals page, they show under “Waiting”. The visit has the welcome offer on it.</li>
            <li>Check the friend out at the POS: the welcome offer comes off the bill.</li>
            <li>Press “Give credit now” (or wait a day): the credit lands in the first client’s wallet.</li>
            <li>Open their wallet again, then check them out: the credit comes off by itself.</li>
          </ol></details>
      </div>
    </Card>);
}

/** The Circle (design canvas RF16, RF17): tiers clients earn by bringing friends, the season, and the public page. */
function CircleSettings({ s, set }: { s: any; set: (fn: any) => void }) {
  const c = s.circle || { on: false, name: 'Circle', tiers: [], season: {}, show: {} };
  const put = (patch: any) => set((x: any) => ({ ...x, circle: { ...(x.circle || {}), ...patch } }));
  const tier = (id: string, patch: any) => put({ tiers: (c.tiers || []).map((t: any) => (t.id === id ? { ...t, ...patch } : t)) });
  const inp = 'h-10 rounded-[12px] border px-2 text-[14px]';
  return (
    <section id="circle" className="scroll-mt-24 space-y-3 rounded-[20px] border bg-card p-5" style={{ borderColor: LINE }} aria-label="The Circle">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[18px] font-light tracking-[-0.01em]">The {c.name || 'Circle'}</p>
        <p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>Tiers clients earn by bringing friends who have a paid first visit (last 12 months). Each tier pays more per friend and gives the friend more. Creators join by invitation from the Circle tab.</p></div>
        <Switch on={!!c.on} label="The Circle on" onClick={() => put({ on: !c.on })} /></div>
      <label className="flex items-center justify-between gap-3 border-t py-3 text-[14px]" style={{ borderColor: LINE }}><span>Program name<span className="block text-[12px]" style={{ color: MUTED }}>Shown as “{s.businessName || 'Your business'} {c.name || 'Circle'}”</span></span>
        <input value={c.name || ''} maxLength={30} onChange={(e) => put({ name: e.target.value })} placeholder="Circle" className={`${inp} w-44 px-3`} style={{ borderColor: LINE }} /></label>
      <div className="grid gap-3 border-t pt-3 md:grid-cols-3" style={{ borderColor: LINE }}>{(c.tiers || []).map((t: any) => <div key={t.id} className="space-y-2 rounded-[16px] p-3" style={{ background: SOFT }}>
        <input value={t.name} maxLength={24} onChange={(e) => tier(t.id, { name: e.target.value })} aria-label="Tier name" className={`${inp} w-full bg-card px-3 font-semibold`} style={{ borderColor: LINE }} />
        <label className="flex items-center justify-between text-[13px]">Friends<input type="number" min={1} value={t.friends} onChange={(e) => tier(t.id, { friends: Number(e.target.value) || 1 })} className={`${inp} w-20 bg-card`} style={{ borderColor: LINE }} /></label>
        <label className="flex items-center justify-between text-[13px]">Credit per friend<span className="flex items-center gap-1">$<input type="number" min={0} value={Math.round((t.rewardCents || 0) / 100)} onChange={(e) => tier(t.id, { rewardCents: Math.max(0, Number(e.target.value) || 0) * 100 })} className={`${inp} w-20 bg-card`} style={{ borderColor: LINE }} /></span></label>
        <label className="flex items-center justify-between text-[13px]">Off for the friend<span className="flex items-center gap-1">$<input type="number" min={0} value={Math.round((t.friendCents || 0) / 100)} onChange={(e) => tier(t.id, { friendCents: Math.max(0, Number(e.target.value) || 0) * 100 })} className={`${inp} w-20 bg-card`} style={{ borderColor: LINE }} /></span></label>
        <textarea value={(t.perks || []).join('\n')} onChange={(e) => tier(t.id, { perks: e.target.value.split('\n').slice(0, 5) })} rows={3} aria-label={`${t.name} perks, one per line`} className="w-full rounded-[12px] border bg-card p-2 text-[12.5px]" style={{ borderColor: LINE }} />
        <p className="text-[11px]" style={{ color: MUTED }}>Perks, one per line. Only promise what you’ll do.</p></div>)}</div>
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-3" style={{ borderColor: LINE }}>
        <label className="text-[13px]">Season name<input value={c.season?.name || ''} maxLength={30} onChange={(e) => put({ season: { ...(c.season || {}), name: e.target.value } })} placeholder="Fall" className={`${inp} mt-1 w-full px-3`} style={{ borderColor: LINE }} /></label>
        <label className="text-[13px]">Places this season (optional)<input type="number" min={1} value={c.season?.places ?? ''} onChange={(e) => put({ season: { ...(c.season || {}), places: e.target.value === '' ? null : Number(e.target.value) } })} placeholder="No limit" className={`${inp} mt-1 w-full px-3`} style={{ borderColor: LINE }} /></label>
        <label className="text-[13px]">Season ends (optional)<input type="date" value={c.season?.end ? String(c.season.end).slice(0, 10) : ''} onChange={(e) => put({ season: { ...(c.season || {}), end: e.target.value ? new Date(`${e.target.value}T23:59:00`).toISOString() : null } })} className={`${inp} mt-1 w-full px-3`} style={{ borderColor: LINE }} /></label>
      </div>
      {c.season?.end && <label className="flex items-center justify-between gap-3 text-[13.5px]"><span>When the season ends, members drop at most one level<span className="block text-[12px]" style={{ color: MUTED }}>Everyone starts the new season at the level their last 12 months earned. Levels you gave by hand stay. Each member gets one short text.</span></span><Switch on={c.season?.soft !== false} label="Drop at most one level" onClick={() => put({ season: { ...(c.season || {}), soft: c.season?.soft === false } })} /></label>}
      <div className="space-y-1 border-t pt-3" style={{ borderColor: LINE }}><p className="text-[14px] font-semibold">The public page</p>
        {[['count', 'Show how many members there are'], ['members', 'Show members who said yes (first name, last initial)'], ['totals', 'Show credit earned and friends brought this year (once there are 5+)']].map(([k, label]) =>
          <label key={k} className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]"><span>{label}</span><Switch on={c.show?.[k] !== false} label={label} onClick={() => put({ show: { ...(c.show || {}), [k]: c.show?.[k] === false } })} /></label>)}
        <p className="text-[12px]" style={{ color: MUTED }}>Every number on the page is real. Places left only shows if you set places for the season.</p></div>
    </section>);
}
