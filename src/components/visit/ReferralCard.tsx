'use client';
// src/components/visit/ReferralCard.tsx — SHARE WITH A FRIEND, on the client's visit link (design canvas RF2). Their own
// link (share or copy), Gift a friend (first name + mobile, sent from THEIR phone — the business never texts the
// friend), their referral credit and their friends by first name. Only when the business has referrals on.
// /api/referrals/public.
import * as React from 'react';
import { VisitCard, VisitButton, VisitMuted, VisitLabel, VisitInput } from '@/components/booking/VisitShell';

const call = (body: any) => fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t work. Please try again.' }));
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d}`; };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function ReferralCard({ token }: { token: string }) {
  const [d, setD] = React.useState<any>(null); const [gift, setGift] = React.useState(false); const [first, setFirst] = React.useState(''); const [phone, setPhone] = React.useState('');
  const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => call({ action: 'mine', token }).then(setD), [token]);
  React.useEffect(() => { void load(); }, [load]);
  if (!d?.ok || !d.on) return null;
  const share = async () => { const text = `I love ${d.business} and thought you would too. Here is ${money(d.friendCents)} off your first visit:`;
    try { if ((navigator as any).share) { await (navigator as any).share({ title: d.business, text, url: d.link }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(`${text} ${d.link}`); setMsg({ ok: true, t: 'Copied. Paste it in a message to your friend.' }); } catch { setMsg({ ok: false, t: d.link }); } };
  const copy = async () => { try { await navigator.clipboard.writeText(d.link); setMsg({ ok: true, t: 'Link copied.' }); } catch { setMsg({ ok: false, t: d.link }); } };
  const sendGift = async () => { setBusy(true); setMsg(null); const r = await call({ action: 'gift', token, firstName: first, phone }); setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, t: r?.error || 'That didn’t work.' }); return; }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent); window.location.href = `sms:${r.to}${ios ? '&' : '?'}body=${encodeURIComponent(r.text)}`;
    setGift(false); setFirst(''); setPhone(''); setMsg({ ok: true, t: `Your message to ${first} is ready to send.` }); void load(); };
  return (
    <VisitCard>
      <p className="text-[17px] font-semibold">Share with a friend</p>
      <VisitMuted>Give a friend {money(d.friendCents)} off their first visit. {d.unlock === 'paid' ? 'When they’ve been in' : 'When they book'}, you get {money(d.rewardCents)} toward your next one.</VisitMuted>
      {d.link && <div className="grid grid-cols-2 gap-2"><VisitButton onClick={share}>Share my link</VisitButton><VisitButton quiet onClick={copy}>Copy link</VisitButton></div>}
      {!gift ? <button type="button" onClick={() => setGift(true)} className="text-left text-[14px] underline underline-offset-2">Gift a friend instead</button> : <div className="space-y-2">
        <VisitLabel>Gift a friend</VisitLabel>
        <VisitInput label="Their first name" value={first} onChange={setFirst} placeholder="Their first name" />
        <VisitInput label="Their mobile" value={phone} onChange={setPhone} placeholder="Their mobile" />
        <VisitButton onClick={sendGift} disabled={busy}>{busy ? 'One moment…' : 'Send from my phone'}</VisitButton>
        <VisitMuted>Opens your messages with a note from you. We never text your friend.</VisitMuted></div>}
      {msg && <p className="text-[13.5px] font-semibold" style={{ color: msg.ok ? '#1f7a4d' : '#b42318' }}>{msg.t}</p>}
      {d.creditCents > 0 && <div className="rounded-2xl p-3" style={{ background: '#f2f8f4' }}><p className="text-[13px] font-semibold">Your credit: {money(d.creditCents)}</p><p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>For your next visits{d.creditEndsAt ? `. The first ends ${day(d.creditEndsAt)}` : ''}.</p></div>}
      {(d.friends || []).length > 0 && <div className="space-y-1.5">{d.friends.map((f: any, i: number) => <div key={i} className="flex items-center justify-between text-[14px]"><span>{f.first}</span><span style={{ color: f.status === 'rewarded' ? '#1f7a4d' : 'var(--muted)' }}>{f.line}</span></div>)}</div>}
      <a href={d.link ? d.link.replace(/\/ref\/([^/]+)\/.*/, '/ref/$1/terms') : '#'} className="text-[12.5px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Terms · credit lasts {d.months} months</a>
    </VisitCard>);
}
