'use client';
// src/components/referrals/CircleMember.tsx — A MEMBER'S CIRCLE, inside their wallet on the visit link (design canvas
// RF19). Their card (by tier), a ring filling toward the next tier, a boost while it runs, this month's numbers, the
// members who chose to be shown (first names), and a share kit: their code, a QR to show in person, a story image with
// their code, and the Circle page. Sharing says plainly that they get credit (honest, and what the rules expect).
import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { MetalCard } from '@/components/referrals/MetalCard';
import { qrSvg } from '@/lib/scan-codes';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', MINT = '#7fd1a5';
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d}`; };
const endsIn = (iso: string) => { const h = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3600e3)); return h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`; };

/** A 1080×1920 story image with their code, drawn on the phone (nothing is uploaded). */
async function storyImage(o: { business: string; offer: string; code: string; link: string }): Promise<Blob | null> {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d'); if (!x) return null;
  const g = x.createLinearGradient(0, 0, 0, 1920); g.addColorStop(0, '#3a3d44'); g.addColorStop(0.55, '#1b1d21'); g.addColorStop(1, '#0d0e10'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  const r = x.createRadialGradient(860, 200, 10, 860, 200, 700); r.addColorStop(0, 'rgba(127,209,165,.25)'); r.addColorStop(1, 'rgba(127,209,165,0)'); x.fillStyle = r; x.fillRect(0, 0, 1080, 1920);
  try { await (document as any).fonts?.load?.('300 120px "Plus Jakarta Sans"'); } catch { /* system font */ }
  const F = (w: number, s: number) => `${w} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`;
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = F(500, 40); (x as any).letterSpacing = '12px'; x.fillText(o.business.toUpperCase().slice(0, 22), 540, 220); (x as any).letterSpacing = '0px';
  x.font = F(300, 150); x.fillText(o.offer, 540, 1000); x.font = F(400, 52); x.globalAlpha = 0.8; x.fillText('your first visit', 540, 1080); x.globalAlpha = 1;
  x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 3; x.setLineDash([16, 12]); const bw = 640, bx = 540 - bw / 2; x.strokeRect(bx, 1200, bw, 170); x.setLineDash([]);
  x.font = F(500, 34); x.globalAlpha = 0.7; x.fillText('USE MY CODE', 540, 1262); x.globalAlpha = 1; x.font = F(400, 84); x.fillText(o.code, 540, 1345);
  x.font = F(400, 38); x.globalAlpha = 0.65; x.fillText(o.link.replace(/^https?:\/\//, '').slice(0, 44), 540, 1700); x.fillText('I get credit if you book', 540, 1760); x.globalAlpha = 1;
  return await new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export function CircleMember({ m, link, friendCents, business, token, preview, onShareText }: { m: any; link: string | null; friendCents: number; business: string; token?: string; preview?: boolean; onShareText: (t: string) => void }) {
  const still = !!useReducedMotion();
  const [optIn, setOptIn] = React.useState(!!m.optIn); const [msg, setMsg] = React.useState(''); const [qr, setQr] = React.useState(false);
  const look = m.creator ? 'creator' : (m.tier?.id || 'none');
  const toNext = m.next ? Math.min(1, m.friends / Math.max(1, m.next.at)) : 1;
  const R = 46, Cc = 2 * Math.PI * R;
  const shareText = `I love ${business} and thought you would too. Use my code ${m.code} for ${money(friendCents)} off your first visit (I get credit if you book):`;
  const qrHtml = React.useMemo(() => (link ? qrSvg(link, 200, INK) : ''), [link]);
  const flip = async (on: boolean) => { setOptIn(on); if (preview || !token) return; try { await fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'optin', token, on }) }); } catch { /* fine */ } };
  const story = async () => { setMsg(''); const b = await storyImage({ business, offer: `${money(friendCents)} off`, code: m.code, link: link || '' }); if (!b) { setMsg('Your phone couldn’t make the image.'); return; }
    const file = new File([b], `${m.code}.png`, { type: 'image/png' });
    try { if ((navigator as any).canShare?.({ files: [file] })) { await (navigator as any).share({ files: [file], text: shareText }); return; } } catch { return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${m.code}.png`; a.click(); setMsg('Saved. Post it to your story.'); };
  const row = (label: string, right: React.ReactNode, onClick?: () => void, href?: string | null) => { const cls = 'flex w-full items-center justify-between gap-3 border-b py-3 text-left text-[14px]'; const st = { borderColor: LINE };
    return href ? <a href={href} target="_blank" rel="noreferrer" className={cls} style={st}><span>{label}</span><span className="text-[12.5px]" style={{ color: MUTED }}>{right}</span></a>
      : <button type="button" onClick={onClick} className={cls} style={st}><span>{label}</span><span className="text-[12.5px]" style={{ color: MUTED }}>{right}</span></button>; };
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex items-baseline justify-between"><p className="text-[22px] font-light tracking-[-0.02em]">{m.name}</p>{m.circleUrl && <a href={m.circleUrl} className="text-[12.5px] underline underline-offset-2" style={{ color: MUTED }}>See the {m.program}</a>}</div>
      <MetalCard look={look} program={m.name} tier={m.creator ? 'Creator' : m.tier?.name || 'Member to be'} name={m.memberName || 'You'} sub={m.creator ? `Code ${m.code}` : `${m.friends} friend${m.friends === 1 ? '' : 's'}${m.since ? ` · since ${new Date(m.since).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` : ''}`} />
      {m.next && <div className="flex items-center gap-4 rounded-[18px] bg-white p-4">
        <div className="relative h-[108px] w-[108px] shrink-0"><svg width="108" height="108" viewBox="0 0 108 108" aria-hidden="true"><circle cx="54" cy="54" r={R} stroke={SOFT} strokeWidth="8" fill="none" />
          <motion.circle cx="54" cy="54" r={R} stroke={GREEN} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={Cc} transform="rotate(-90 54 54)" initial={still ? false : { strokeDashoffset: Cc }} animate={{ strokeDashoffset: Cc * (1 - toNext) }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} /></svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[26px] font-light">{m.friends}</span><span className="text-[10.5px]" style={{ color: MUTED }}>of {m.next.at}</span></div></div>
        <div><p className="text-[17px] font-light">{m.next.need} more friend{m.next.need === 1 ? '' : 's'} to <b className="font-semibold">{m.next.name}</b></p>
          <p className="mt-1 text-[12.5px] leading-[1.45]" style={{ color: MUTED }}>{money(m.next.rewardCents)} for every friend{m.next.perks?.[1] ? `, ${String(m.next.perks[1]).charAt(0).toLowerCase()}${String(m.next.perks[1]).slice(1)}` : ''}.</p></div></div>}
      {m.boost && <div className="rounded-[16px] p-3.5" style={{ background: 'rgba(127,209,165,.14)', border: '1px solid rgba(31,122,77,.25)' }}><p className="text-[14px] font-semibold" style={{ color: GREEN }}>{m.boost.name}</p>
        <p className="text-[12.5px]" style={{ color: MUTED }}>Friends who visit while it’s on earn you {m.boost.multiplier}× credit. Ends in {endsIn(m.boost.end)}.</p></div>}
      <div className="grid grid-cols-3 gap-2">{[[m.month.opens, 'link opens'], [m.month.booked, 'booked'], [money(m.month.earnedCents), 'earned']].map(([v, l]: any) => <div key={l} className="rounded-[14px] bg-white p-3"><p className="text-[22px] font-light">{v}</p><p className="text-[11px]" style={{ color: MUTED }}>{l} this month</p></div>)}</div>
      <div className="rounded-[18px] bg-white px-4 pb-1 pt-3">
        <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>Share kit</p>
        {row(`Your code: ${m.code}`, 'Copy', async () => { try { await navigator.clipboard.writeText(m.code); setMsg('Code copied.'); } catch { setMsg(m.code); } })}
        {link && row('Share my link', 'Message', () => onShareText(shareText))}
        {link && row('Save a story image', '9:16', story)}
        {link && row('Show a QR code', 'In person', () => setQr(!qr))}
        {m.creator?.page && row('My page', '↗', undefined, m.creator.page)}
        {qr && qrHtml && <div className="flex justify-center py-3"><div className="rounded-[14px] p-2" style={{ border: `1px solid ${LINE}` }} dangerouslySetInnerHTML={{ __html: qrHtml }} /></div>}
        {msg && <p className="py-2 text-[13px] font-semibold" style={{ color: GREEN }}>{msg}</p>}
      </div>
      {(m.board || []).length > 0 && <div className="rounded-[18px] bg-white p-4"><p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>The {m.program} this season</p>
        <ol className="mt-2">{m.board.slice(0, 6).map((x: any) => <li key={x.rank} className="flex items-center gap-3 border-b py-2 text-[14px]" style={{ borderColor: LINE, fontWeight: x.me ? 700 : 400 }}>
          <span className="w-4 text-[12px]" style={{ color: MUTED }}>{x.rank}</span><span className="flex-1">{x.name}{x.me ? ' (you)' : ''}</span><span className="text-[12px]" style={{ color: MUTED }}>{x.tier ? `${x.tier} · ` : ''}{x.friends} friend{x.friends === 1 ? '' : 's'}</span></li>)}</ol></div>}
      {(m.tier || m.creator) && <label className="flex items-center justify-between gap-3 px-1 text-[13.5px]"><span>Show me on the {m.program} page<span className="block text-[12px]" style={{ color: MUTED }}>Your first name and last initial</span></span>
        <button type="button" role="switch" aria-checked={optIn} aria-label={`Show me on the ${m.program} page`} onClick={() => flip(!optIn)} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: optIn ? GREEN : '#d4d5d9' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: optIn ? 23 : 3 }} /></button></label>}
    </div>);
}
