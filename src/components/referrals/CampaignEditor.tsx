'use client';
// src/components/referrals/CampaignEditor.tsx — ONE CREATOR CAMPAIGN (design canvas RF27, RF28, RF25): the brief shown,
// not just told (a moodboard of photos and post links marked do / don't, the shot list, specs, the brand kit), the pieces
// each creator owes, what they're paid, and guard rails on their offer — beside the profit planner, which says before
// anything is sent what it costs, what a new client is worth to you, where it breaks even, and a forecast from your own
// history. Once live: each creator's hand-ins to approve or send back, with opens and bookings per piece.
// /api/creator-campaigns (lib/creator-campaigns-server).
import * as React from 'react';
import Link from 'next/link';
import { payPost } from '@/components/pay/pay-client';
import { uploadImage } from '@/lib/upload-image';
import { plan, daysLabel, KINDS, KIND_LABEL, DAY_NAMES } from '@/lib/creator-campaigns';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', MINT = '#7fd1a5', AMBER = '#b45309', RED = '#b42318';
const money = (c: number) => { const v = Math.round((Number(c) || 0) / 100); return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`; };
const rid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
const box = 'h-10 rounded-[12px] border bg-white px-3 text-[14px]'; const inp = `${box} w-full`;
const btn = (dark: boolean) => `h-10 rounded-full px-4 text-[13.5px] font-semibold ${dark ? 'text-white' : 'border bg-white'}`;
const dateIn = (v: string | null) => (v ? String(v).slice(0, 10) : '');
const dateOut = (v: string, end = false) => (v ? new Date(`${v}T${end ? '23:59' : '09:00'}:00`).toISOString() : null);

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-[20px] border bg-white p-5" style={{ borderColor: LINE }} aria-label={title}><div><p className="text-[18px] font-light tracking-[-0.01em]">{title}</p>{sub && <p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>{sub}</p>}</div>{children}</section>;
}

export function CampaignEditor({ tenantId, id }: { tenantId: string; id: string }) {
  const [d, setD] = React.useState<any>(null); const [c, setC] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [note, setNote] = React.useState<{ ok: boolean; t: string } | null>(null);
  const [link, setLink] = React.useState({ url: '', label: '' }); const [margin, setMargin] = React.useState<number | null>(null); const [perCreator, setPerCreator] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const load = React.useCallback(() => payPost('/api/creator-campaigns', { tenantId, action: 'get', id }).then((r) => { setD(r); if (r?.ok) setC(r.campaign); }), [tenantId, id]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);
  if (!d) return <p className="mt-6" style={{ color: MUTED }}>Loading…</p>;
  if (!d.ok) return <p className="mt-6" style={{ color: RED }}>{d.error || 'This campaign couldn’t load.'}</p>;
  const set = (patch: any) => setC((x: any) => ({ ...x, ...patch }));
  const brief = (patch: any) => setC((x: any) => ({ ...x, brief: { ...x.brief, ...patch } }));
  const save = async (status?: string, extra: any = {}) => { setBusy(status || 'save'); setNote(null);
    const r = await payPost('/api/creator-campaigns', { tenantId, action: 'save', campaign: { ...c, ...(status ? { status } : {}), ...extra } }); setBusy('');
    if (r?.ok) { setNote({ ok: true, t: status === 'live' ? 'Sent. Each creator has the brief in their visit link, and a text to say so.' : status === 'done' ? 'Campaign ended.' : 'Saved.' });
      if (id === 'new') { window.location.replace(`/referrals/campaigns/${r.id}`); return; } void load(); } else setNote({ ok: false, t: r?.error || 'That didn’t save.' }); };
  const review = async (creatorId: string, pieceId: string, decision: string) => { const k = `${creatorId}.${pieceId}`; setBusy(k); setNote(null);
    const r = await payPost('/api/creator-campaigns', { tenantId, action: 'review', campaignId: c.id, creatorId, pieceId, decision, note: notes[k] || '' }); setBusy('');
    setNote(r?.ok ? { ok: true, t: decision === 'approve' ? 'Approved. They’ve been told.' : 'Sent back with your note.' } : { ok: false, t: r?.error || 'That didn’t work.' }); if (r?.ok) void load(); };
  const creators: any[] = d.creators || []; const chosen = creators.filter((x) => c.creators.includes(x.id));
  const inputs = d.inputs || {}; const m = margin ?? inputs.margin ?? 0.6; const per = perCreator ?? inputs.expectedPerCreator ?? 3;
  const svc = (d.services || []).find((s: any) => s.id === c.pay.contentServiceId);
  const avgOffer = chosen.length ? chosen.reduce((n, x) => n + (x.creator?.friendCents || 0), 0) / chosen.length : (inputs.friendCents || 2000);
  const avgCredit = chosen.length ? chosen.reduce((n, x) => n + (x.creator?.rewardCents || 0), 0) / chosen.length : 1500;
  const avgCash = chosen.length ? chosen.reduce((n, x) => n + (x.creator?.pay === 'cash' ? x.creator.cashCents : 0), 0) / chosen.length : 0;
  const P = plan({ creators: Math.max(1, chosen.length), pieces: Math.max(1, c.pieces.length), feeCents: c.pay.feeCents, contentVisits: c.pay.contentVisit ? Math.max(1, chosen.length) : 0, contentCostCents: Math.round((svc?.price || 0) * 100 * (1 - m)),
    offerCents: avgOffer, creditCents: avgCredit, cashCents: avgCash, expectedPerCreator: per, firstVisitCents: inputs.firstVisitCents || 5000, yearValueCents: inputs.yearValueCents || 30000, margin: m, rebook: inputs.rebook || 0, historyKnown: !!inputs.historyKnown });
  const vColor = P.verdict === 'good' ? MINT : P.verdict === 'thin' ? '#f0c27a' : '#f2a7a0';
  const live = c.status === 'live';
  return (
    <div className="mx-auto mt-4 max-w-[1240px] pb-28" style={{ color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-5"><div><p className="text-[12px]" style={{ color: MUTED }}><Link href="/referrals#campaigns" className="hover:underline">Referrals</Link> › Campaigns</p>
        <input value={c.name} onChange={(e) => set({ name: e.target.value })} aria-label="Campaign name" className="w-full max-w-[520px] bg-transparent text-[30px] font-light tracking-[-0.02em] outline-none" />
        <p className="text-[13px]" style={{ color: MUTED }}>{live ? (c.paused ? `Paused: ${c.paused.why}` : 'Live') : c.status === 'done' ? 'Ended' : 'Draft · nothing is sent until you press Send'}</p></div>
        <div className="flex flex-wrap gap-2">{c.status !== 'done' && <button type="button" disabled={!!busy} onClick={() => save()} className={btn(false)} style={{ borderColor: LINE }}>{busy === 'save' ? 'Saving…' : live ? 'Save changes' : 'Save draft'}</button>}
          {!live && c.status !== 'done' && <button type="button" disabled={!!busy} onClick={() => save('live')} className={btn(true)} style={{ background: INK }}>{busy === 'live' ? 'Sending…' : `Send to ${chosen.length || ''} creator${chosen.length === 1 ? '' : 's'}`}</button>}
          {live && c.paused && <button type="button" disabled={!!busy} onClick={() => save('live', { resume: true })} className={btn(true)} style={{ background: INK }}>Resume</button>}
          {live && <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('End this campaign? Offers stop; hand-ins already approved stay.')) void save('done'); }} className={btn(false)} style={{ borderColor: LINE }}>End campaign</button>}</div></div>
      {note && <p className="pb-3 text-[13.5px] font-semibold" style={{ color: note.ok ? GREEN : RED }}>{note.t}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <Section title="Who and when" sub="Creators come from the Circle tab (Make creator). Each keeps their own code and offer.">
            {creators.length ? <div className="flex flex-wrap gap-2">{creators.map((x) => { const on = c.creators.includes(x.id); return <button key={x.id} type="button" aria-pressed={on} onClick={() => set({ creators: on ? c.creators.filter((y: string) => y !== x.id) : [...c.creators, x.id] })}
              className="rounded-full border px-3.5 py-2 text-[13px]" style={on ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{x.name} <span style={{ opacity: 0.6 }}>{x.creator?.code}</span></button>; })}</div>
              : <p className="text-[13px]" style={{ color: MUTED }}>No creators yet. <Link href="/referrals#circle" className="underline">Make one from the Circle tab</Link>.</p>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-[12.5px] font-semibold">Starts<input type="date" value={dateIn(c.start)} onChange={(e) => set({ start: dateOut(e.target.value) })} className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
              <label className="text-[12.5px] font-semibold">Ends<input type="date" value={dateIn(c.end)} onChange={(e) => set({ end: dateOut(e.target.value, true) })} className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label></div>
          </Section>

          <Section title="The moodboard" sub="Show them exactly what you want: photos, videos you’ve uploaded, or links to posts you love. Mark the ones to copy and the ones to avoid.">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{c.brief.refs.map((r: any) => <div key={r.id} className="space-y-1.5">
              <div className="relative overflow-hidden rounded-[14px]" style={{ aspectRatio: '4 / 5', background: SOFT }}>
                {r.kind === 'image' ? <img src={r.url} alt={r.label || 'Reference'} className="h-full w-full object-cover" /> : <a href={r.url} target="_blank" rel="noreferrer" className="flex h-full items-center justify-center p-3 text-center text-[12.5px] underline" style={{ color: MUTED }}>▶ {r.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 40)}</a>}
                {r.tag && <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: r.tag === 'do' ? GREEN : RED }}>{r.tag === 'do' ? 'Do' : 'Don’t'}</span>}
                <button type="button" aria-label="Remove" onClick={() => brief({ refs: c.brief.refs.filter((x: any) => x.id !== r.id) })} className="absolute right-2 top-2 rounded-full bg-white/90 px-2 text-[12px]">×</button></div>
              <input value={r.label} onChange={(e) => brief({ refs: c.brief.refs.map((x: any) => (x.id === r.id ? { ...x, label: e.target.value } : x)) })} placeholder="What to notice" aria-label="Label" className="h-8 w-full rounded-[10px] border px-2 text-[12.5px]" style={{ borderColor: LINE }} />
              <div className="flex gap-1">{[['do', 'Do'], ['dont', 'Don’t'], [null, '—']].map(([v, l]: any) => <button key={l} type="button" aria-pressed={r.tag === v} onClick={() => brief({ refs: c.brief.refs.map((x: any) => (x.id === r.id ? { ...x, tag: v } : x)) })} className="flex-1 rounded-full border py-1 text-[11.5px]" style={r.tag === v ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{l}</button>)}</div>
            </div>)}
              {c.brief.refs.length < 24 && <label className="flex cursor-pointer flex-col items-center justify-center rounded-[14px] border border-dashed text-center text-[12.5px]" style={{ ...(c.brief.refs.length ? { height: 96 } : { aspectRatio: '4 / 5' }), borderColor: '#c9cace', color: MUTED }}>{busy === 'photo' ? 'Adding…' : '+ Add photos'}
                <input type="file" accept="image/*" multiple className="sr-only" onChange={async (e) => { const files = Array.from(e.target.files || []).slice(0, 8); e.target.value = ''; if (!files.length) return; setBusy('photo');
                  for (const f of files) { try { const url = await uploadImage(`tenants/${tenantId}/creator-campaigns/${c.id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.jpg`, f, 1600); setC((x: any) => ({ ...x, brief: { ...x.brief, refs: [...x.brief.refs, { id: rid('r'), url, kind: 'image', label: '', tag: null }].slice(0, 24) } })); } catch { setNote({ ok: false, t: 'A photo didn’t upload.' }); } }
                  setBusy(''); }} /></label>}</div>
            <div className="flex flex-wrap gap-2"><input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="Or paste a link to a post or video you love" aria-label="Reference link" className={`${box} min-w-[220px] flex-1`} style={{ borderColor: LINE }} />
              <button type="button" onClick={() => { const u = link.url.trim(); if (!/^https:\/\/\S+\.\S+/.test(u)) { setNote({ ok: false, t: 'Links need to start with https://' }); return; } brief({ refs: [...c.brief.refs, { id: rid('r'), url: u, kind: 'link', label: link.label, tag: null }] }); setLink({ url: '', label: '' }); }} className={btn(false)} style={{ borderColor: LINE }}>Add link</button></div>
            <textarea value={c.brief.text} onChange={(e) => brief({ text: e.target.value })} rows={3} maxLength={2000} placeholder="The idea in a few lines: what to show, the feeling, the moment that matters." className="w-full rounded-[12px] border p-3 text-[14px]" style={{ borderColor: LINE }} />
          </Section>

          <Section title="Shot list" sub="Must-haves are the shots you need. Nice-to-haves are welcome.">
            {c.brief.shots.map((s: any) => <div key={s.id} className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => brief({ shots: c.brief.shots.map((x: any) => (x.id === s.id ? { ...x, must: !x.must } : x)) })} className="w-16 rounded-full border py-1.5 text-[11.5px] font-bold" style={s.must ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE, color: MUTED }}>{s.must ? 'MUST' : 'NICE'}</button>
              <input value={s.text} onChange={(e) => brief({ shots: c.brief.shots.map((x: any) => (x.id === s.id ? { ...x, text: e.target.value } : x)) })} aria-label="Shot" className={`${box} min-w-[200px] flex-1`} style={{ borderColor: LINE }} />
              <input value={s.when} onChange={(e) => brief({ shots: c.brief.shots.map((x: any) => (x.id === s.id ? { ...x, when: e.target.value } : x)) })} placeholder="0–2s" aria-label="When" className={`${box} w-24`} style={{ borderColor: LINE }} />
              <button type="button" aria-label="Remove shot" onClick={() => brief({ shots: c.brief.shots.filter((x: any) => x.id !== s.id) })} className="px-2 text-[16px]" style={{ color: MUTED }}>×</button></div>)}
            <button type="button" onClick={() => brief({ shots: [...c.brief.shots, { id: rid('s'), text: '', must: true, when: '' }] })} className="text-[13px] font-semibold underline underline-offset-2">+ Add a shot</button>
          </Section>

          <Section title="What they’ll post" sub="Each creator owes each piece. Reminders go out 3 days and 1 day before it’s due.">
            {c.pieces.map((p: any, i: number) => <div key={p.id} className="flex flex-wrap items-center gap-2">
              <select value={p.kind} onChange={(e) => set({ pieces: c.pieces.map((x: any) => (x.id === p.id ? { ...x, kind: e.target.value } : x)) })} aria-label="Kind" className={`${box} w-32`} style={{ borderColor: LINE }}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
              <input value={p.label} onChange={(e) => set({ pieces: c.pieces.map((x: any) => (x.id === p.id ? { ...x, label: e.target.value } : x)) })} placeholder={`${KIND_LABEL[p.kind as keyof typeof KIND_LABEL]} ${i + 1}`} aria-label="Name" className={`${box} min-w-[160px] flex-1`} style={{ borderColor: LINE }} />
              <label className="flex items-center gap-1.5 text-[12.5px]">Due<input type="date" value={dateIn(p.due)} onChange={(e) => set({ pieces: c.pieces.map((x: any) => (x.id === p.id ? { ...x, due: dateOut(e.target.value, true) } : x)) })} className={`${box} w-40`} style={{ borderColor: LINE }} /></label>
              <button type="button" aria-label="Remove piece" onClick={() => set({ pieces: c.pieces.filter((x: any) => x.id !== p.id) })} className="px-2 text-[16px]" style={{ color: MUTED }}>×</button></div>)}
            <button type="button" onClick={() => set({ pieces: [...c.pieces, { id: rid('p'), kind: 'reel', label: '', due: c.end || null }] })} className="text-[13px] font-semibold underline underline-offset-2">+ Add a piece</button>
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-3" style={{ borderColor: LINE }}>
              <label className="text-[12.5px] font-semibold">Format<input value={c.brief.format} onChange={(e) => brief({ format: e.target.value })} placeholder="Reel 9:16 · 15–30s · captions on" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
              <label className="text-[12.5px] font-semibold">When to post<input value={c.brief.post} onChange={(e) => brief({ post: e.target.value })} placeholder="Tue–Thu, 6–8pm" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
              <label className="text-[12.5px] font-semibold">What to say<input value={c.brief.say} onChange={(e) => brief({ say: e.target.value })} placeholder="Their code · tag @you · #ad" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label></div>
            <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={c.brief.draft} onChange={(e) => brief({ draft: e.target.checked })} /> Send me the draft for a quick OK before posting</label>
            <textarea value={c.brief.brand} onChange={(e) => brief({ brand: e.target.value })} rows={2} maxLength={600} placeholder="Brand kit: handles, hashtags, colors, words you never use (cheap, discount)…" className="w-full rounded-[12px] border p-3 text-[14px]" style={{ borderColor: LINE }} />
          </Section>

          <Section title="Pay and guard rails" sub="Each creator’s per-result pay (credit, and cash if you set it) comes from their Circle details. Here: a fee per approved piece, a free content visit, and limits on their offer during the campaign.">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-[12.5px] font-semibold">Fee per approved piece<span className="mt-1 flex items-center gap-1">$<input type="number" min={0} value={Math.round(c.pay.feeCents / 100)} onChange={(e) => set({ pay: { ...c.pay, feeCents: Math.max(0, Number(e.target.value) || 0) * 100 } })} className={inp} style={{ borderColor: LINE }} /></span></label>
              <label className="flex items-center gap-2 pt-5 text-[13.5px]"><input type="checkbox" checked={c.pay.contentVisit} onChange={(e) => set({ pay: { ...c.pay, contentVisit: e.target.checked } })} /> A free content visit</label>
              {c.pay.contentVisit && <label className="text-[12.5px] font-semibold">For<select value={c.pay.contentServiceId || ''} onChange={(e) => set({ pay: { ...c.pay, contentServiceId: e.target.value || null } })} className={`${inp} mt-1`} style={{ borderColor: LINE }}><option value="">Choose a service</option>{(d.services || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            </div>
            <div><p className="text-[12.5px] font-semibold">Their offer works on</p><div className="mt-1.5 flex flex-wrap gap-1.5">{DAY_NAMES.map((n, i) => { const on = c.guard.days.includes(i); return <button key={n} type="button" aria-pressed={on} onClick={() => set({ guard: { ...c.guard, days: on ? c.guard.days.filter((x: number) => x !== i) : [...c.guard.days, i].sort() } })} className="w-12 rounded-full border py-1.5 text-[12.5px]" style={on ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{n}</button>; })}</div>
              <p className="mt-1 text-[12px]" style={{ color: MUTED }}>{daysLabel(c.guard.days) ? `Only ${daysLabel(c.guard.days)}: new clients fill your quieter days, not your busiest.` : 'Every day. Pick your quieter days to fill empty chairs instead of your busiest.'}</p></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-[12.5px] font-semibold">Most uses<input type="number" min={1} value={c.guard.maxUses ?? ''} onChange={(e) => set({ guard: { ...c.guard, maxUses: e.target.value === '' ? null : Number(e.target.value) } })} placeholder="No limit" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
              <label className="text-[12.5px] font-semibold">Pause past this per new client<span className="mt-1 flex items-center gap-1">$<input type="number" min={1} value={c.guard.capCents == null ? '' : Math.round(c.guard.capCents / 100)} onChange={(e) => set({ guard: { ...c.guard, capCents: e.target.value === '' ? null : Number(e.target.value) * 100 } })} placeholder="No limit" className={inp} style={{ borderColor: LINE }} /></span></label>
              <label className="text-[12.5px] font-semibold">Total budget<span className="mt-1 flex items-center gap-1">$<input type="number" min={1} value={c.guard.budgetCents == null ? '' : Math.round(c.guard.budgetCents / 100)} onChange={(e) => set({ guard: { ...c.guard, budgetCents: e.target.value === '' ? null : Number(e.target.value) * 100 } })} placeholder="No limit" className={inp} style={{ borderColor: LINE }} /></span></label></div>
          </Section>

          {c.status !== 'draft' && (d.per || []).length > 0 && <Section title="Hand-ins" sub="Approve each piece, or send it back with a note they’ll see. Fees for approved pieces show as owed until you mark them paid on the Circle tab.">
            {d.per.map((x: any) => <div key={x.id} className="space-y-2 border-b pb-3" style={{ borderColor: LINE }}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[15px] font-semibold">{x.name} <span className="text-[12.5px] font-normal" style={{ color: MUTED }}>{x.code} · {x.booked} booked · {x.paidFirst} paid first visit{x.paidFirst === 1 ? '' : 's'}</span></p>
                {c.pay.contentVisit && (x.contentVisit ? <span className="text-[12.5px]" style={{ color: GREEN }}>Content visit {new Date(x.contentVisit.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ✓</span>
                  : <button type="button" disabled={!!busy} onClick={async () => { setBusy(`cv${x.id}`); const r = await payPost('/api/creator-campaigns', { tenantId, action: 'content_visit', campaignId: c.id, creatorId: x.id }); setBusy(''); setNote(r?.ok ? { ok: true, t: `Their visit on ${new Date(r.at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} is now their free content visit, with the brief on it.` } : { ok: false, t: r?.error || 'That didn’t work.' }); if (r?.ok) void load(); }}
                    className="h-8 rounded-full border px-3 text-[12.5px] font-semibold" style={{ borderColor: LINE }}>Make their next visit the content visit</button>)}</div>
              {x.pieces.map((p: any) => { const h = p.hand; const k = `${x.id}.${p.id}`; const late = !h && p.due && Date.parse(p.due) < Date.now();
                return <div key={p.id} className="flex flex-wrap items-start gap-3 rounded-[14px] p-3" style={{ background: SOFT }}>
                  {h?.shot ? <a href={h.shot} target="_blank" rel="noreferrer"><img src={h.shot} alt="Screenshot of views" className="h-16 w-12 rounded-[8px] object-cover" /></a> : <span className="flex h-16 w-12 items-center justify-center rounded-[8px] bg-white text-[11px]" style={{ color: MUTED }}>{h ? 'link' : '—'}</span>}
                  <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">{p.label}{p.due ? <span className="font-normal" style={{ color: late ? RED : MUTED }}> · due {new Date(p.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : null}</p>
                    <p className="text-[12.5px]" style={{ color: h?.status === 'approved' ? GREEN : h?.status === 'changes' ? AMBER : MUTED }}>{!h ? (late ? 'Late, nothing handed in' : 'Not handed in yet') : h.status === 'approved' ? `Approved${h.paidAt ? ' · paid' : h.feeCents ? ` · ${money(h.feeCents)} owed` : ''}` : h.status === 'changes' ? `Sent back: ${h.note}` : `Handed in ${new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${h.late ? ' (late)' : ''}`}</p>
                    {h && <p className="text-[12.5px]" style={{ color: MUTED }}><a href={h.url} target="_blank" rel="noreferrer" className="underline">See the post</a>{h.views ? ` · ${h.views.toLocaleString('en-US')} views` : ''} · #ad ✓{h.rights ? ' · may repost ✓' : ''}{h.clip ? <> · <a href={h.clip} target="_blank" rel="noreferrer" className="underline">original clip</a></> : null}</p>}
                    <p className="text-[12px]" style={{ color: MUTED }}>{p.opens} link opens · {p.booked} booked from it</p>
                    {h?.status === 'submitted' && <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy === k} onClick={() => review(x.id, p.id, 'approve')} className={btn(true)} style={{ background: INK }}>Approve</button>
                      <input value={notes[k] || ''} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} placeholder="What to change" aria-label="What to change" className={`${box} min-w-[180px] flex-1`} style={{ borderColor: LINE }} />
                      <button type="button" disabled={busy === k} onClick={() => review(x.id, p.id, 'changes')} className={btn(false)} style={{ borderColor: LINE }}>Ask for a change</button></div>}</div></div>; })}
            </div>)}
          </Section>}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20">
          <section className="space-y-4 rounded-[22px] p-5 text-white" style={{ background: 'linear-gradient(150deg,#2c2f35,#16171a 65%)' }} aria-label="The profit planner">
            <p className="text-[11px] uppercase tracking-[0.16em] opacity-70">Before you spend</p>
            <div className="grid grid-cols-2 gap-4"><div><p className="text-[11px] opacity-60">BREAK-EVEN</p><p className="text-[30px] font-light leading-tight">{P.breakEven ? `${P.breakEven} client${P.breakEven === 1 ? '' : 's'}` : '—'}</p><p className="text-[11.5px] opacity-60">who pay for a first visit</p></div>
              <div><p className="text-[11px] opacity-60">12-MONTH PROFIT</p><p className="text-[30px] font-light leading-tight" style={{ color: vColor }}>{P.profit12 >= 0 ? '+' : ''}{money(P.profit12)}</p><p className="text-[11.5px] opacity-60">{money(P.profitLow)} to {money(P.profitHigh)}</p></div></div>
            <p className="text-[13px] leading-[1.5] opacity-85">{P.verdict === 'good' ? `Pays back even at the low end. About ${P.expected} new client${P.expected === 1 ? '' : 's'} expected (${P.low}–${P.high}).` : P.verdict === 'thin' ? `Only pays back if it goes well. Lower the fee, pay more per result, or pick quieter days.` : 'At these numbers it loses money. Pay per result instead of fees, or lower the offer.'}</p>
            <div className="space-y-1 border-t pt-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
              {[['Fees', P.cost.fees], ['Content visits (your cost)', P.cost.content], ['Friends’ offers', P.cost.offers], ['Credit (your cost)', P.cost.credit], ['Cash per result', P.cost.cash]].filter(([, v]) => (v as number) > 0).map(([k, v]) => <div key={k as string} className="flex justify-between opacity-85"><span>{k}</span><span>{money(v as number)}</span></div>)}
              <div className="flex justify-between font-semibold"><span>If it goes as planned</span><span>{money(P.cost.total)}</span></div></div>
            <div className="space-y-1 border-t pt-3 text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
              <div className="flex justify-between opacity-85"><span>A new client over 12 months</span><span>{money(inputs.yearValueCents || 0)}</span></div>
              {inputs.rebook != null && <div className="flex justify-between opacity-85"><span>New clients who come back</span><span>{Math.round(inputs.rebook * 100)}%</span></div>}
              <div className="flex justify-between font-semibold" style={{ color: MINT }}><span>Profit per new client</span><span>{money(P.profitPerClient)}</span></div></div>
            <div className="grid grid-cols-2 gap-2 border-t pt-3 text-[12px]" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
              <label className="opacity-85">Your margin<span className="mt-1 flex items-center gap-1"><input type="number" min={1} max={99} value={Math.round(m * 100)} onChange={(e) => setMargin(Math.max(1, Math.min(99, Number(e.target.value) || 60)) / 100)} onBlur={() => { if (margin != null) void payPost('/api/creator-campaigns', { tenantId, action: 'margin', margin }); }} className="h-9 w-16 rounded-[10px] bg-white/10 px-2 text-white" />%</span></label>
              <label className="opacity-85">New clients per creator<input type="number" min={0} step={0.5} value={per} onChange={(e) => setPerCreator(Math.max(0, Number(e.target.value) || 0))} className="mt-1 h-9 w-20 rounded-[10px] bg-white/10 px-2 text-white" /></label></div>
            <p className="text-[11.5px] leading-[1.45] opacity-55">{inputs.historyKnown ? 'From your past campaigns, your prices and how often new clients come back.' : 'No past campaigns yet, so it starts from a safe guess of 3 new clients per creator. Change it if you know better.'}{inputs.marginSet ? '' : ' Margin is a guess until you set it.'}</p>
          </section>
          {c.status !== 'draft' && d.stats && <section className="grid grid-cols-2 gap-2" aria-label="So far">{[['Pieces approved', `${d.stats.approved} of ${d.stats.pieces}`], ['Link opens', d.stats.opens], ['Booked', d.stats.booked], ['Paid first visits', d.stats.paidFirst]].map(([k, v]) =>
            <div key={k as string} className="rounded-[16px] border bg-white p-3" style={{ borderColor: LINE }}><p className="text-[11.5px] font-semibold" style={{ color: MUTED }}>{k}</p><p className="text-[22px] font-light">{v}</p></div>)}</section>}
        </aside>
      </div>
    </div>);
}
