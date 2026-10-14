'use client';
// src/components/referrals/ReferralsBoard.tsx — REFERRALS for the business (design canvas RF1, RF4). What referrals
// bring in (paid money only), what the rewards cost, what referred clients are worth over a year beside everyone
// else, who brings them, who is waiting for a first visit, and the few that need a manager. Settings below.
// /api/referrals (lib/referrals-server).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { uploadImage } from '@/lib/upload-image';
import { WelcomeSettings } from '@/components/referrals/WelcomeSettings';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const HOLD: Record<string, string> = { same_card: 'Same saved card as the person who referred', cap: 'Monthly limit reached (given next month on its own)' };
const VIA: Record<string, string> = { link: 'their link', gift: 'a gift', named: 'named at booking' };

function Tile({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return <div className="min-w-0 flex-1 rounded-[18px] border bg-white px-4 py-3.5" style={{ borderColor: LINE }}><p className="text-[12px] font-semibold" style={{ color: MUTED }}>{label}</p>
    <p className="text-[28px] font-light tracking-[-0.02em]" style={{ color: ok ? GREEN : INK }}>{value}</p>{sub && <p className="text-[12px]" style={{ color: MUTED }}>{sub}</p>}</div>;
}

export function ReferralsBoard({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<any>(null); const [s, setS] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [note, setNote] = React.useState<{ ok: boolean; t: string } | null>(null);
  const [phones, setPhones] = React.useState<Record<string, string>>({});
  const load = React.useCallback(() => payPost('/api/referrals', { tenantId, action: 'overview' }).then((r) => { setD(r); if (r?.ok) setS(r.settings); }), [tenantId]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);
  if (!d) return <p className="mt-6" style={{ color: MUTED }}>Loading…</p>;
  if (!d.ok) return <p className="mt-6" style={{ color: RED }}>{d.error || 'Referrals couldn’t load.'}</p>;
  const tl = d.tiles || {};
  const decide = async (id: string, decision: string) => { setBusy(id); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'decide', id, decision, referrerPhone: phones[id] || '' }); setBusy('');
    setNote(r?.ok ? { ok: true, t: decision === 'approve' ? 'Credit given.' : decision === 'confirm' ? (r.declined ? 'Matched, but it isn’t eligible.' : 'Matched. Their credit follows the friend’s first paid visit.') : 'Marked: no reward.' } : { ok: false, t: r?.error || 'That didn’t work.' }); void load(); };
  const save = async () => { setBusy('settings'); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'settings', referrals: s }); setBusy('');
    setNote(r?.ok ? { ok: true, t: s.on ? 'Saved. Clients now see “Share with a friend” on their visit link.' : 'Saved. Referrals are off.' } : { ok: false, t: r?.error || 'That didn’t save.' }); void load(); };
  const row = (k: string, label: string, el: React.ReactNode) => <label key={k} className="flex items-center justify-between gap-3 py-2.5 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><span>{label}</span>{el}</label>;
  const cents = (k: string) => <span className="flex items-center gap-1">$<input type="number" min={0} max={500} value={Math.round((s?.[k] || 0) / 100)} onChange={(e) => setS({ ...s, [k]: Math.max(0, Number(e.target.value) || 0) * 100 })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} /></span>;
  return (
    <div className="mx-auto mt-4 max-w-[1180px] space-y-5" style={{ color: INK }}>
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>referrals</p>
        <h1 className="text-[30px] font-light tracking-[-0.02em]">{s?.on ? 'What referrals bring in' : 'Referrals are off'}</h1>
        <p className="text-[13.5px]" style={{ color: MUTED }}>Paid visits only. A friend’s credit is given after their first paid visit, so nothing is counted twice.</p></div>
      {note && <p className="text-[13.5px] font-semibold" style={{ color: note.ok ? GREEN : RED }}>{note.t}</p>}
      <div className="flex flex-wrap gap-3">
        <Tile label="Referral revenue" value={money(tl.paidCents)} sub="paid · this month" ok />
        <Tile label="Rewards given" value={money(tl.rewardCents)} sub={`${tl.rewards || 0} credit${tl.rewards === 1 ? '' : 's'} · this month`} />
        <Tile label="Return" value={tl.returnX ? `${tl.returnX}×` : '—'} sub="revenue per reward dollar" ok={!!tl.returnX} />
        <Tile label="Worth over 12 months" value={tl.referredCount ? money(tl.referredWorthCents) : '—'} sub={tl.referredCount ? `referred clients · others ${money(tl.othersWorthCents)}` : 'once referred clients have visited'} /></div>
      <div className="grid gap-4 md:grid-cols-3">
        <section className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[16px] font-semibold">Top people who refer</p>
          {(d.top || []).length ? d.top.map((p: any) => <div key={p.clientId} className="flex items-center justify-between gap-2 rounded-[14px] border p-3" style={{ borderColor: LINE }}>
            <span><span className="block text-[14px] font-semibold">{p.name}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{p.friends} friend{p.friends === 1 ? '' : 's'} · {p.visited} visited{p.broughtCents ? ` · ${money(p.broughtCents)} brought in` : ''}</span></span>
            {p.earnedCents > 0 && <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: '#e8f3ec', color: GREEN }}>{money(p.earnedCents)} earned</span>}</div>) : <p className="text-[13px]" style={{ color: MUTED }}>Nobody yet.</p>}</section>
        <section className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[16px] font-semibold">Waiting for a visit</p><p className="text-[12.5px]" style={{ color: MUTED }}>{s?.unlock === 'paid' ? 'Credit is given a day after their first paid visit.' : 'Credit is given once they’ve booked.'}</p>
          {(d.waiting || []).length ? d.waiting.map((w: any) => <div key={w.id} className="rounded-[14px] border p-3" style={{ borderColor: LINE }}><p className="text-[14px] font-semibold">{w.friend} ← {w.referrer}</p><p className="text-[12.5px]" style={{ color: MUTED }}>Booked {day(w.bookedAt)} · by {VIA[w.via] || w.via}</p>
            <button type="button" disabled={busy === w.id} onClick={async () => { setBusy(w.id); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'give_now', id: w.id }); setBusy(''); setNote(r?.ok ? { ok: true, t: 'Credit given.' } : { ok: false, t: r?.error || 'That didn’t work.' }); void load(); }}
              className="mt-2 h-8 rounded-full border px-3 text-[12.5px] font-semibold" style={{ borderColor: LINE }}>Give credit now</button></div>) : <p className="text-[13px]" style={{ color: MUTED }}>Nobody waiting.</p>}</section>
        <section className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[16px] font-semibold">Needs a look</p>
          {(d.review || []).length ? d.review.map((r: any) => <div key={r.id} className="space-y-2 rounded-[14px] border p-3" style={{ borderColor: '#f3dfc4' }}>
            <p className="text-[14px] font-semibold">{r.status === 'unmatched' ? `${r.friend}: said “${r.named}”` : `${r.friend} ← ${r.referrer}`}</p>
            <p className="text-[12.5px]" style={{ color: AMBER }}>{r.status === 'unmatched' ? 'No single client matched. Ask at check-in and enter their number, or leave it.' : HOLD[r.holdReason] || 'Held'}</p>
            {r.status === 'unmatched' ? <div className="flex flex-wrap gap-1.5"><input value={phones[r.id] || ''} onChange={(e) => setPhones({ ...phones, [r.id]: e.target.value })} placeholder="Their mobile" aria-label="Mobile of the person who referred" className="h-9 min-w-0 flex-1 rounded-full border px-3 text-[13px]" style={{ borderColor: LINE }} />
              <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'confirm')} className="h-9 rounded-full px-3.5 text-[13px] font-semibold text-white" style={{ background: INK }}>Match</button>
              <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'decline')} className="h-9 rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }}>Leave it</button></div>
              : r.holdReason !== 'cap' && <div className="flex gap-1.5"><button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'approve')} className="h-9 rounded-full px-3.5 text-[13px] font-semibold text-white" style={{ background: INK }}>Approve</button>
                <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'decline')} className="h-9 rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }}>No reward</button></div>}</div>) : <p className="text-[13px]" style={{ color: MUTED }}>Nothing needs you.</p>}</section></div>
      <TryIt tenantId={tenantId} />
      {s && <section className="space-y-1 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
        <div className="flex items-center justify-between gap-3 pb-2"><div><p className="text-[16px] font-semibold">Settings</p><p className="text-[12.5px]" style={{ color: MUTED }}>Clients read the terms page made from these. The friend’s offer is a discount you approve by saving; prices on a service never change.</p></div>
          <button type="button" role="switch" aria-checked={!!s.on} aria-label="Referrals on" onClick={() => setS({ ...s, on: !s.on })} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: s.on ? INK : '#dcdde0' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: s.on ? 23 : 3 }} /></button></div>
        {row('r', 'Credit for the person who referred', cents('rewardCents'))}
        {row('f', 'Off the friend’s first visit', cents('friendCents'))}
        {row('u', 'Credit is given', <select value={s.unlock} onChange={(e) => setS({ ...s, unlock: e.target.value })} className="h-10 rounded-[12px] border bg-white px-2 text-[14px]" style={{ borderColor: LINE }}><option value="paid">After the friend’s first paid visit</option><option value="booked">When the friend books (easier to abuse)</option></select>)}
        {row('m', 'Credit lasts', <select value={s.months} onChange={(e) => setS({ ...s, months: Number(e.target.value) })} className="h-10 rounded-[12px] border bg-white px-2 text-[14px]" style={{ borderColor: LINE }}>{[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} months</option>)}</select>)}
        {row('c', 'Most rewards a month, per client', <input type="number" min={1} max={50} value={s.cap} onChange={(e) => setS({ ...s, cap: Number(e.target.value) })} className="h-10 w-20 rounded-[12px] border px-2 text-[14px]" style={{ borderColor: LINE }} />)}
        <div className="space-y-2 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <p className="text-[14px] font-semibold">Your welcome page</p>
          <p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>{(s.photos || []).length ? 'Your photos fill the top of the page (or each Stories screen); the others show further down.' : 'Add up to 3 photos to make your welcome page shine: your space, your work, a happy moment. Without photos it still looks finished: choose Simple, or let the app choose for you.'}</p>
          <div className="flex flex-wrap gap-2">{(s.photos || []).map((u: string, i: number) => <div key={u} className="relative h-24 w-24 overflow-hidden rounded-[14px] bg-cover bg-center" style={{ backgroundImage: `url(${u})` }}>
              <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold">{i === 0 ? 'Opening' : `Photo ${i + 1}`}</span>
              <button type="button" aria-label="Remove photo" onClick={() => setS({ ...s, photos: s.photos.filter((x: string) => x !== u) })} className="absolute bottom-1.5 right-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold">Remove</button></div>)}
            {(s.photos || []).length < 3 && <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-[14px] border border-dashed text-center text-[12px] font-semibold" style={{ borderColor: '#c9cace', color: MUTED }}>
              {busy === 'photo' ? 'Adding…' : '+ Add a photo'}<input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy('photo');
                try { const url = await uploadImage(`tenants/${tenantId}/referrals/${Date.now().toString(36)}.jpg`, f, 1600); setS((x: any) => ({ ...x, photos: [...(x.photos || []), url].slice(0, 3) })); setNote({ ok: true, t: 'Photo added. Save to put it on your welcome page.' }); }
                catch { setNote({ ok: false, t: 'That photo didn’t upload. Please try again.' }); } setBusy(''); }} /></label>}</div>
          <label className="block text-[14px]">Arriving (optional)<input value={s.arrival || ''} maxLength={200} onChange={(e) => setS({ ...s, arrival: e.target.value })} placeholder="e.g. Free parking behind the building; we’re on the second floor." className="mt-1 h-10 w-full rounded-[12px] border px-3 text-[14px]" style={{ borderColor: LINE }} /></label>
          <WelcomeSettings tenantId={tenantId} s={s} setS={setS} />
        </div>
        <div className="rounded-[14px] p-3 text-[12.5px] leading-[1.5]" style={{ background: SOFT, color: MUTED }}>Always: the friend must be new to you · the same phone or email as the person who referred isn’t eligible · the same saved card waits for you here · households (same address) are fine · reviews are never rewarded · a refunded visit takes back unused credit.</div>
        <div className="flex flex-wrap items-center gap-3 pt-2"><button type="button" onClick={save} disabled={busy === 'settings'} className="h-10 rounded-full px-5 text-[14px] font-semibold text-white" style={{ background: INK }}>{busy === 'settings' ? 'Saving…' : 'Save'}</button>
          <a href={`/ref/${encodeURIComponent(tenantId)}/terms`} target="_blank" rel="noreferrer" className="text-[13.5px] underline underline-offset-2">Preview terms</a></div>
      </section>}
    </div>);
}

/** Try it yourself: open any client's wallet as they see it (a private link for 2 hours) and their welcome link. */
function TryIt({ tenantId }: { tenantId: string }) {
  const [q, setQ] = React.useState(''); const [list, setList] = React.useState<any[]>([]); const [sel, setSel] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { const t = setTimeout(() => { if (q.trim().length < 2) { setList([]); return; } void payPost('/api/referrals', { tenantId, action: 'find', q }).then((r) => setList(r?.ok ? r.clients || [] : [])); }, 250); return () => clearTimeout(t); }, [q, tenantId]);
  const pick = async (c: any) => { setBusy(true); setErr(''); const r = await payPost('/api/referrals', { tenantId, action: 'preview', clientId: c.id }); setBusy(false); if (r?.ok) { setSel(r); setList([]); setQ(''); } else setErr(r?.error || 'That didn’t work.'); };
  return (
    <section className="space-y-3 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }} aria-label="Try it yourself">
      <div><p className="text-[16px] font-semibold">Try it yourself</p><p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>See any client’s wallet exactly as they do, and open their welcome link like a friend would. Wallet links are private and last 2 hours.</p></div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A client’s name, or the last 4 digits of their phone" aria-label="Find a client" className="h-11 w-full rounded-[12px] border px-3 text-[14px]" style={{ borderColor: LINE }} />
      {list.length > 0 && <div className="divide-y rounded-[12px] border" style={{ borderColor: LINE }}>{list.map((c) => <button key={c.id} type="button" disabled={busy} onClick={() => pick(c)} className="flex w-full justify-between px-3 py-2.5 text-left text-[14px]"><span>{c.name}</span><span style={{ color: MUTED }}>{c.phoneLast4 ? `···${c.phoneLast4}` : ''}</span></button>)}</div>}
      {err && <p className="text-[13px] font-semibold" style={{ color: RED }}>{err}</p>}
      {sel && <div className="space-y-2 rounded-[14px] p-3" style={{ background: SOFT }}>
        <p className="text-[14px] font-semibold">{sel.name}</p>
        <div className="flex flex-wrap gap-2"><a href={sel.walletUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>Open their wallet</a>
          <a href={sel.welcomeUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border bg-white px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Open their welcome link</a>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(sel.welcomeUrl); }} className="inline-flex h-10 items-center rounded-full border bg-white px-4 text-[13.5px]" style={{ borderColor: LINE }}>Copy welcome link</button></div></div>}
      <details className="text-[13px] leading-[1.6]" style={{ color: MUTED }}><summary className="cursor-pointer font-semibold" style={{ color: INK }}>A full test, start to finish</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Switch Referrals on and save.</li>
          <li>Find a test client above (it can be you) and open their welcome link on another phone.</li>
          <li>Open your gift and book as a new client, with a different phone number and email.</li>
          <li>Here, they show under “Waiting for a visit”. The visit has the $15 welcome offer on it.</li>
          <li>Check the friend out at the POS: the welcome offer comes off the bill.</li>
          <li>Press “Give credit now” (or wait a day): the credit lands in the first client’s wallet.</li>
          <li>Open their wallet again, then check them out: the credit comes off by itself.</li>
        </ol></details>
    </section>);
}
