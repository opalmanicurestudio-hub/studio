'use client';
// src/components/waitlist/WaitlistDesk.tsx — the Waitlist page's body (app/(app)/waitlist): openings as they're filled,
// who fits next and why, who's waiting, and the demand you're turning away. /api/waitlist (lib/waitlist-server).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#3d5a99';
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODE: Record<string, [string, string, string]> = { one: ['One at a time · 30 min each', BLUE, '#e6ecf7'], wave: ['Later today · best fit first, then a few', AMBER, '#fdf3e6'], first: ['Soon · top 3 at once, first to tap', AMBER, '#fdf3e6'], desk: ['Under an hour · the desk', RED, '#fdecec'] };
const chip = (t: string, c = INK, bg = SOFT) => <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold" style={{ color: c, background: bg }}>{t}</span>;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function WaitlistDesk({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [copied, setCopied] = React.useState(false);
  const load = React.useCallback(() => (tenantId ? payPost('/api/waitlist', { tenantId, action: 'desk' }).then(setD) : null), [tenantId]);
  React.useEffect(() => { void load(); const t = setInterval(() => void load(), 60000); return () => clearInterval(t); }, [load]);
  const act = async (body: any, ok: string) => { setBusy(JSON.stringify(body)); setMsg(null); const r = await payPost('/api/waitlist', { tenantId, ...body }); setBusy(''); setMsg(r.ok ? { ok: true, t: ok } : { ok: false, t: r.error || 'That didn’t work.' }); void load(); };
  if (!d) return <p className="mt-6" style={{ color: MUTED }}>Loading…</p>;
  if (!d.ok) return <p className="mt-6" style={{ color: RED }}>{d.error}</p>;
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/w/${tenantId}` : '';
  return (
    <div className="mx-auto mt-4 max-w-[1180px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>waitlist</p><h1 className="text-[30px] font-light tracking-[-0.02em]">{d.live.length ? `${d.live.length} opening${d.live.length === 1 ? '' : 's'} being filled` : 'Every opening fills itself'}</h1>
          <p className="text-[13.5px]" style={{ color: MUTED }}>A cancelled time is offered to whoever it really fits — the desk steps in only under an hour away.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(joinUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Your waitlist link', joinUrl); } }} className="h-10 rounded-full border bg-card px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>{copied ? 'Copied' : 'Copy the join link'}</button>
          <button type="button" role="switch" aria-checked={d.auto} onClick={() => act({ action: 'auto', on: !d.auto }, d.auto ? 'Paused — openings wait for the desk.' : 'On — openings fill themselves.')} className="flex h-10 items-center gap-2 rounded-full border bg-card px-3 text-[14px] font-semibold" style={{ borderColor: LINE }}>
            <span className="relative h-6 w-10 rounded-full" style={{ background: d.auto ? GREEN : '#dcdde0' }}><span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-card" style={{ left: d.auto ? 19 : 3 }} /></span>Fill automatically</button></div></div>
      {msg && <p className="text-[13.5px] font-semibold" style={{ color: msg.ok ? GREEN : RED }}>{msg.t}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {d.live.length === 0 && <div className="rounded-[18px] border bg-card p-6 text-[14px]" style={{ borderColor: LINE, color: MUTED }}>No openings right now. When a visit is cancelled, it shows here within a few minutes — and the offers go out on their own.</div>}
          {d.live.map((o: any) => { const [ml, mc, mb] = MODE[o.mode] || MODE.one; return (
            <div key={o.id} className="overflow-hidden rounded-[18px] border bg-card" style={{ borderColor: LINE }}>
              <div className="flex flex-wrap items-start justify-between gap-2 p-4">
                <div><p className="text-[17px] font-semibold">{o.when} · {String(o.staffName || '').split(' ')[0]}</p><p className="text-[13px]" style={{ color: MUTED }}>{o.minutes} min free · {o.source === 'moveup' ? 'freed by a move-up' : o.source === 'freed' ? 'freed when a visit changed' : o.source === 'fell_through' ? 'a waitlist booking that fell through' : 'a cancellation'}{o.chainDepth ? ` · move ${o.chainDepth} of 2` : ''}{o.backups ? ` · ${o.backups} backup${o.backups === 1 ? '' : 's'} first` : ''}</p></div>
                <div className="flex items-center gap-2">{chip(ml, mc, mb)}<button type="button" onClick={() => act({ action: 'close_opening', openingId: o.id }, 'Closed — no more offers for it.')} className="text-[12.5px] underline" style={{ color: MUTED }}>Close</button></div></div>
              {o.partyHeld && <p className="px-4 pb-2 text-[13.5px]" style={{ color: BLUE }}><b>Held with other times for a party</b></p>}
              {o.party && <p className="px-4 pb-2 text-[13.5px]">{o.party.name}’s party of {o.party.size} · {o.party.status === 'sent' ? <b style={{ color: BLUE }}>held for them until {hhmm(o.party.holdUntil)}</b> : o.party.status === 'taken' ? <b style={{ color: GREEN }}>booked for everyone</b> : o.party.status === 'declined' ? <span style={{ color: MUTED }}>not these times</span> : <span style={{ color: MUTED }}>no answer</span>}</p>}
              {(o.calls || []).length > 0 && <div className="px-4 pb-2"><p className="pb-1 text-[12px] font-bold" style={{ color: MUTED }}>CALLED</p>{o.calls.map((c: any, i: number) => <p key={i} className="text-[13.5px]">{c.name} · {c.status === 'calling' ? <b style={{ color: BLUE }}>on the phone now</b> : c.status === 'booked' ? <b style={{ color: GREEN }}>booked on the call</b> : c.status === 'no_answer' ? <span style={{ color: MUTED }}>no answer, texted instead</span> : c.status === 'declined' ? <span style={{ color: MUTED }}>said not this one</span> : <span style={{ color: MUTED }}>call didn’t go through</span>}</p>)}</div>}
              {o.offers.length > 0 && <div className="px-4 pb-3"><p className="pb-1 text-[12px] font-bold" style={{ color: MUTED }}>OFFERED</p>{o.offers.map((f: any, i: number) => <p key={i} className="text-[13.5px]">{f.name} · {f.kind === 'sooner' ? 'move up · ' : ''}{f.status === 'sent' ? <b style={{ color: BLUE }}>{f.mode === 'first' ? `texted — first to tap (round ends ${hhmm(f.holdUntil)})` : `has it until ${hhmm(f.holdUntil)} · held for them`}</b> : f.status === 'lapsed' ? <span style={{ color: MUTED }}>no answer</span> : f.status === 'declined' ? <span style={{ color: MUTED }}>not this one</span> : f.status === 'taken' ? <b style={{ color: GREEN }}>took it</b> : f.status === 'lost' ? <span style={{ color: MUTED }}>too late</span> : f.status}</p>)}</div>}
              <div style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="grid grid-cols-[1.3fr_2fr_auto] gap-3 px-4 py-2 text-[12px] font-bold" style={{ color: MUTED, background: 'hsl(var(--secondary))' }}><span>Who fits next</span><span>Why</span><span /></div>
                {o.fits.length === 0 && <p className="px-4 py-3 text-[13.5px]" style={{ color: AMBER }}>Nobody on the list fits this one{o.mode !== 'desk' ? ' — it’ll go to the desk an hour before if it’s still open.' : '.'}</p>}
                {o.fits.map((f: any, i: number) => <div key={f.id} className="grid grid-cols-[1.3fr_2fr_auto] items-center gap-3 px-4 py-2.5 text-[13.5px]" style={{ borderTop: `1px solid ${LINE}` }}>
                  <span><b>{f.name || 'Client'}</b> <span className="ml-1">{chip(f.kind === 'sooner' ? 'move up' : 'waitlist', f.kind === 'sooner' ? BLUE : INK, f.kind === 'sooner' ? '#e6ecf7' : SOFT)}</span>{f.autoBook && <span className="ml-1">{chip('books automatically', BLUE, '#e6ecf7')}</span>}{f.owed && <span className="ml-1">{chip(f.owed === 'backup' ? 'backup' : 'missed out last time', GREEN, '#e7f3ec')}</span>}</span>
                  <span style={{ color: MUTED }}>{f.kind === 'sooner' ? (f.alreadyBooked ? `already booked for this ${f.freed} — would move that visit up` : `booked ${f.freed} — tapped “come in sooner”`) : `${f.wanted} · waiting ${f.waitedDays} day${f.waitedDays === 1 ? '' : 's'}`}{f.leftover ? ` · leaves ${f.leftover} min` : ''}</span>
                  <button type="button" disabled={!!busy} onClick={() => act({ action: 'offer_now', openingId: o.id, entryId: f.id }, `Sent to ${f.name}.`)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold disabled:opacity-40" style={i === 0 ? { background: INK, color: 'hsl(var(--background))' } : { border: `1px solid ${LINE}` }}>Offer now</button></div>)}
                {o.not.length > 0 && <details className="px-4 py-2.5 text-[13px]" style={{ borderTop: `1px solid ${LINE}` }}><summary className="cursor-pointer font-semibold" style={{ color: MUTED }}>Not offered ({o.not.length}) — and why</summary>
                  {o.not.map((x: any) => <p key={x.id} className="pt-1"><b>{x.name || 'Client'}</b> <span style={{ color: MUTED }}>— {x.why}</span></p>)}</details>}
              </div>
            </div>); })}
          {d.recent.length > 0 && <div className="rounded-[18px] border bg-card p-4" style={{ borderColor: LINE }}><p className="pb-1 text-[15px] font-semibold">Lately</p>
            {d.recent.map((r: any) => <p key={r.id} className="py-1 text-[13.5px]" style={{ borderTop: `1px solid ${LINE}` }}>{r.when} · {String(r.staffName || '').split(' ')[0]} — {r.status === 'filled' ? <b style={{ color: GREEN }}>filled by {r.filledBy}{r.kind === 'sooner' ? ' (moved up)' : ''}</b> : <span style={{ color: MUTED }}>{r.status}</span>}</p>)}</div>}
        </div>

        <div className="space-y-3">
          <div className="rounded-[18px] border bg-card p-4" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">Last 30 days</p>
            <div className="mt-2 grid grid-cols-3 gap-2">{[[`${d.stats.filled} of ${d.stats.openings}`, 'openings filled', INK], [d.stats.moveUps, 'came in sooner', BLUE], [d.stats.avgMinutes === null ? '—' : d.stats.avgMinutes < 90 ? `${d.stats.avgMinutes} min` : `${Math.round(d.stats.avgMinutes / 60)} h`, 'to fill', INK]].map(([v, l, c]) => <div key={String(l)}><p className="text-[20px] font-bold" style={{ color: c as string }}>{v}</p><p className="text-[11.5px]" style={{ color: MUTED }}>{l}</p></div>)}</div></div>
          {d.calls && <CallsCard c={d.calls} busy={!!busy} save={(on: boolean, capDollars: number) => act({ action: 'calls', on, capDollars }, on ? 'Calls on for openings under 3 hours away.' : 'Calls off.')} />}
          {d.demand.length > 0 && <div className="rounded-[18px] border bg-card p-4" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">Most wanted</p><p className="text-[12.5px]" style={{ color: MUTED }}>Asked for, and how many never got in</p>
            {d.demand.map((x: any) => <div key={`${x.weekday}${x.part}`} className="flex justify-between py-1.5 text-[13.5px]" style={{ borderTop: `1px solid ${LINE}` }}><span>{DAY[x.weekday]} {x.part}s</span><span><b>{x.asked}</b> asked · <span style={{ color: x.asked - x.served ? AMBER : MUTED }}>{x.asked - x.served} waiting</span></span></div>)}
            <p className="pt-2 text-[12px]" style={{ color: MUTED }}>Lots waiting for one time? A shift there, or someone with the same skills, fills it.</p></div>}
          <div className="rounded-[18px] border bg-card p-4" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">Waiting · {d.entries.length}</p>
            {d.entries.length === 0 && <p className="pt-1 text-[13.5px]" style={{ color: MUTED }}>Nobody yet. Share the join link, or it’s offered on your booking page when nothing fits.</p>}
            {d.entries.slice(0, 30).map((e: any) => <div key={e.id} className="flex items-start justify-between gap-2 py-2 text-[13.5px]" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="min-w-0"><b>{e.name || e.clientName || 'Client'}</b>{e.kind === 'sooner' ? <span className="ml-1">{chip('come in sooner', BLUE, '#e6ecf7')}</span> : null}
                <span className="block text-[12px]" style={{ color: MUTED }}>{e.serviceName || 'Any service'}{e.windows ? ` · ${Object.keys(e.windows).map((k) => DAY[Number(k)]).join(', ')}` : ' · any time'}{e.until ? ` · until ${new Date(`${e.until}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}{e.status === 'offered' ? ' · has an offer' : ''}{e.status === 'paused' ? ' · paused — didn’t answer “still hoping?”' : e.stillAskedAt ? ' · asked if still hoping' : ''}{e.autoBook ? ' · books automatically' : ''}{Number(e.party) > 1 ? ` · party of ${e.party}` : ''}</span></span>
              <button type="button" onClick={() => act({ action: 'remove', entryId: e.id }, 'Taken off the list.')} className="shrink-0 text-[12px] underline" style={{ color: MUTED }}>Remove</button></div>)}</div>
        </div>
      </div>
    </div>);
}

function CallsCard({ c, busy, save }: { c: any; busy: boolean; save: (on: boolean, cap: number) => void }) {
  const [cap, setCap] = React.useState(String(c.capDollars));
  const capN = Math.round(Number(cap)) || c.capDollars;
  return (
    <div className="rounded-[18px] border bg-card p-4" style={{ borderColor: LINE }}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-semibold">Call about same-day openings</p>
        <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>Under 3 hours away, the voice assistant calls up to 3 people who fit, one at a time, between 9am and 7pm. Only people who said yes to calls. No answer means a text instead, never a voicemail.</p></div>
        <button type="button" role="switch" aria-checked={c.on} aria-label="Call about same-day openings" disabled={busy || (!c.on && !c.hasNumber)} onClick={() => save(!c.on, capN)} className="relative mt-1 h-6 w-10 shrink-0 rounded-full disabled:opacity-40" style={{ background: c.on ? GREEN : '#dcdde0' }}><span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-card" style={{ left: c.on ? 19 : 3 }} /></button></div>
      {!c.hasNumber && <p className="mt-2 text-[12.5px]" style={{ color: AMBER }}>Set up the voice assistant’s phone number first.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]"><span>Monthly limit $</span>
        <input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} aria-label="Monthly limit in dollars" className="h-9 w-16 rounded-full border px-3 text-[14px]" style={{ borderColor: LINE }} />
        {capN !== c.capDollars && <button type="button" disabled={busy} onClick={() => save(c.on, capN)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: INK, color: 'hsl(var(--background))' }}>Save</button>}</div>
      <p className="mt-2 text-[12.5px]" style={{ color: MUTED }}>{c.used} of about {c.allowed} calls used this month · {c.willing} on the list said yes to calls</p>
    </div>);
}
