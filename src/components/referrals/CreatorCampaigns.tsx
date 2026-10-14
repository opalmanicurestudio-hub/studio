'use client';
// src/components/referrals/CreatorCampaigns.tsx — A CREATOR'S CAMPAIGNS, in their own visit link (design canvas RF25,
// RF27): each brief as the business made it (the moodboard with what to copy and what to avoid, the idea, the shot
// list to tick off, specs), what they earn, a link for each piece (so its bookings count for it), and handing a piece
// in: the post's link, a screenshot of its views, the original clip if they like, and two plain confirmations — the
// post says it's a paid partnership, and whether the business may repost it. /api/referrals/public (campaigns, hand_in).
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const money = (c: number) => `$${(Math.round(Number(c) || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const call = (body: any) => fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t work. Please try again.' }));

function HandIn({ token, who, campaignId, piece, onDone }: { token: string; who: any; campaignId: string; piece: any; onDone: () => void }) {
  const [f, setF] = React.useState({ url: piece.hand?.url || '', views: piece.hand?.views ? String(piece.hand.views) : '', clip: '', ad: false, rights: !!piece.hand?.rights, shot: piece.hand?.shot || '' });
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const upload = async (file: File) => { setBusy('shot'); setErr(''); const fd = new FormData(); fd.append('file', file); fd.append('token', token);
    try { const r = await (await fetch('/api/creator-campaigns/upload', { method: 'POST', body: fd })).json(); if (r?.ok) setF((x) => ({ ...x, shot: r.url })); else setErr(r?.error || 'That didn’t upload.'); } catch { setErr('That didn’t upload.'); } setBusy(''); };
  const send = async () => { setBusy('send'); setErr(''); const r = await call({ action: 'hand_in', ...who, campaignId, pieceId: piece.id, url: f.url, views: f.views, clip: f.clip, shot: f.shot, ad: f.ad, rights: f.rights }); setBusy('');
    if (r?.ok) onDone(); else setErr(r?.error || 'That didn’t send.'); };
  const inp = 'h-11 w-full rounded-[12px] border bg-white px-3 text-[14px]';
  return <div className="space-y-2.5 rounded-[14px] p-3" style={{ background: SOFT }}>
    <label className="block text-[12.5px] font-semibold">Link to your post<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://instagram.com/…" inputMode="url" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
    <div className="grid grid-cols-2 gap-2"><label className="block text-[12.5px] font-semibold">Views so far<input value={f.views} onChange={(e) => setF({ ...f, views: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="3100" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
      <label className="block text-[12.5px] font-semibold">A screenshot of its views<span className="mt-1 flex h-11 cursor-pointer items-center justify-center rounded-[12px] border border-dashed bg-white text-[12.5px]" style={{ borderColor: '#c9cace', color: f.shot ? GREEN : MUTED }}>{busy === 'shot' ? 'Uploading…' : f.shot ? 'Added ✓' : '+ Add'}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void upload(x); }} /></span></label></div>
    <label className="block text-[12.5px] font-semibold">The original clip (optional)<input value={f.clip} onChange={(e) => setF({ ...f, clip: e.target.value })} placeholder="A Google Drive or Dropbox link" className={`${inp} mt-1`} style={{ borderColor: LINE }} /></label>
    <label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" checked={f.ad} onChange={(e) => setF({ ...f, ad: e.target.checked })} className="mt-0.5 h-4 w-4" />It says it’s a paid partnership (#ad, or the paid-partnership label)</label>
    <label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" checked={f.rights} onChange={(e) => setF({ ...f, rights: e.target.checked })} className="mt-0.5 h-4 w-4" />They may repost it and use it on their pages, crediting me</label>
    {err && <p className="text-[13px] font-semibold" style={{ color: RED }}>{err}</p>}
    <button type="button" disabled={!!busy} onClick={send} className="h-11 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: INK }}>{busy === 'send' ? 'Sending…' : 'Hand it in'}</button>
  </div>;
}

export function CreatorCampaigns({ token, preview, tenantId }: { token: string; preview?: string; tenantId?: string }) {
  const who = preview && tenantId ? { preview, tenantId } : { token };
  const [d, setD] = React.useState<any>(null); const [open, setOpen] = React.useState<string | null>(null); const [hand, setHand] = React.useState<string | null>(null);
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({}); const [copied, setCopied] = React.useState('');
  const load = React.useCallback(() => call({ action: 'campaigns', ...who }).then((r) => { setD(r); if (r?.ok && r.campaigns?.length && !open) setOpen(r.campaigns[0].id); }), [token]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { try { setTicks(JSON.parse(localStorage.getItem('cf-brief-ticks') || '{}')); } catch { /* fine */ } }, []);
  const tick = (k: string) => setTicks((x) => { const n = { ...x, [k]: !x[k] }; try { localStorage.setItem('cf-brief-ticks', JSON.stringify(n)); } catch { /* fine */ } return n; });
  if (!d?.ok || !(d.campaigns || []).length) return null;
  return (
    <div className="space-y-3" style={{ color: INK }}>
      <p className="text-[22px] font-light tracking-[-0.02em]">Your campaigns</p>
      {d.campaigns.map((c: any) => { const isOpen = open === c.id; const due = c.pieces.filter((p: any) => !p.hand || p.hand.status === 'changes');
        return <section key={c.id} className="overflow-hidden rounded-[20px] bg-white" aria-label={c.name}>
          <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <span><span className="block text-[11px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>{c.status === 'done' ? 'Ended' : due.length ? `${due.length} to hand in` : 'All handed in'}{c.end ? ` · ends ${day(c.end)}` : ''}</span><span className="block text-[18px] font-semibold">{c.name}</span></span>
            <span className="text-[18px]" style={{ color: MUTED }}>{isOpen ? '–' : '+'}</span></button>
          {isOpen && <div className="space-y-4 px-4 pb-4">
            {c.brief.refs.length > 0 && <div className="grid grid-cols-2 gap-2">{c.brief.refs.map((r: any) => <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-[14px]" style={{ aspectRatio: '4 / 5', background: SOFT }}>
              {r.kind === 'image' ? <img src={r.url} alt={r.label || 'Reference'} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center p-3 text-center text-[12.5px] underline" style={{ color: MUTED }}>▶ Watch the reference</span>}
              {(r.tag || r.label) && <span className="absolute bottom-2 left-2 right-2 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: r.tag === 'dont' ? RED : r.tag === 'do' ? GREEN : 'rgba(22,23,26,.6)' }}>{r.tag === 'do' ? 'Do: ' : r.tag === 'dont' ? 'Don’t: ' : ''}{r.label}</span>}</a>)}</div>}
            {c.brief.text && <p className="text-[14px] leading-[1.55]">{c.brief.text}</p>}
            {c.brief.shots.length > 0 && <div><p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>Shot list</p>
              {c.brief.shots.map((s: any) => { const k = `${c.id}.${s.id}`; return <label key={s.id} className="flex items-start gap-2.5 border-b py-2.5 text-[14px]" style={{ borderColor: LINE }}><input type="checkbox" checked={!!ticks[k]} onChange={() => tick(k)} className="mt-0.5 h-4 w-4" />
                <span className="flex-1">{s.text}{s.when ? <span style={{ color: MUTED }}> · {s.when}</span> : null}</span><span className="text-[10.5px] font-bold" style={{ color: s.must ? INK : MUTED }}>{s.must ? 'MUST' : 'NICE'}</span></label>; })}</div>}
            {(c.brief.format || c.brief.post || c.brief.say || c.days) && <div className="grid grid-cols-2 gap-2">{[['Format', c.brief.format], ['When to post', c.brief.post], ['Say', c.brief.say || `Code ${c.code} · #ad`], ['Your code works', c.days || 'every day']].filter(([, v]) => v).map(([k, v]) =>
              <div key={k} className="rounded-[12px] p-2.5" style={{ background: SOFT }}><p className="text-[11px] font-semibold" style={{ color: MUTED }}>{k}</p><p className="text-[13px]">{v}</p></div>)}</div>}
            {c.brief.draft && <p className="text-[12.5px]" style={{ color: MUTED }}>Please send your draft for a quick OK before you post.</p>}
            {c.brief.brand && <p className="text-[12.5px] leading-[1.5]" style={{ color: MUTED }}>{c.brief.brand}</p>}
            <p className="rounded-[12px] p-3 text-[13px]" style={{ background: '#e8f3ec' }}>You earn {[c.earn.contentVisit ? 'a free content visit' : null, c.earn.feeCents ? `${money(c.earn.feeCents)} for each approved piece` : null, c.earn.rewardCents ? `${money(c.earn.rewardCents)} credit` : null, c.earn.cashCents ? `${money(c.earn.cashCents)} cash` : null].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')}{c.earn.rewardCents || c.earn.cashCents ? ' for every new client who pays for a first visit with your code' : ''}.</p>
            <div className="space-y-2">{c.pieces.map((p: any) => { const h = p.hand; const k = `${c.id}.${p.id}`;
              return <div key={p.id} className="space-y-2 border-t pt-2.5" style={{ borderColor: LINE }}>
                <div className="flex items-center justify-between gap-2"><div><p className="text-[14.5px] font-semibold">{p.label}</p>
                  <p className="text-[12.5px]" style={{ color: h?.status === 'approved' ? GREEN : h?.status === 'changes' ? AMBER : MUTED }}>{!h ? (p.due ? `Due ${day(p.due)}` : 'Not handed in yet') : h.status === 'approved' ? 'Approved. Thank you!' : h.status === 'changes' ? `A change, please: ${h.note}` : 'Handed in · waiting for review'}</p></div>
                  {p.link && <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(p.link); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch { /* fine */ } }} className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: LINE }}>{copied === k ? 'Copied' : 'Copy its link'}</button>}</div>
                {(!h || h.status === 'changes') && c.status !== 'done' && (hand === k ? <HandIn token={token} who={who} campaignId={c.id} piece={p} onDone={() => { setHand(null); void load(); }} />
                  : <button type="button" onClick={() => setHand(k)} className="h-10 w-full rounded-full border text-[13.5px] font-semibold" style={{ borderColor: INK }}>{h ? 'Hand it in again' : 'Hand it in'}</button>)}
              </div>; })}</div>
            <p className="text-[11.5px]" style={{ color: MUTED }}>Use each piece’s own link in that post, so the bookings it brings count for it.</p>
          </div>}
        </section>; })}
    </div>);
}
