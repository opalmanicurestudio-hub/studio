'use client';
// /gift/[tenantId]/chip/[groupId]?k=… (anyone with the share link) or ?o=… (the organizer) — CHIP IN (lib/gift-groups).
// Friends see the card, who's in (names, never amounts), add what they like and sign it. The organizer also sees each
// share and can copy the link, send it now, change the day, or cancel (everyone is refunded).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { GiftCardFace } from '@/components/gift/GiftCardFace';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const field = 'h-12 w-full rounded-2xl border px-4 text-[15.5px] outline-none focus:ring-2 focus:ring-black/10';
const fs = { borderColor: LINE, background: '#fff' } as const;
const $ = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const COLORS = ['#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#16a34a', '#64748b'];

export default function ChipInPage() {
  const p = useParams() as { tenantId: string; groupId: string }; const tenantId = String(p?.tenantId || ''), groupId = String(p?.groupId || '');
  const [keys] = React.useState(() => { if (typeof window === 'undefined') return { k: '', o: '' }; const q = new URLSearchParams(window.location.search); return { k: q.get('k') || '', o: q.get('o') || '' }; });
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const load = React.useCallback(() => fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}&group=${encodeURIComponent(groupId)}&k=${encodeURIComponent(keys.k)}&o=${encodeURIComponent(keys.o)}`)
    .then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')), [tenantId, groupId, keys]);
  React.useEffect(() => { load(); }, [load]);

  // Chip in
  const [amt, setAmt] = React.useState(30); const [other, setOther] = React.useState(''); const [name, setName] = React.useState(''); const [email, setEmail] = React.useState(''); const [note, setNote] = React.useState('');
  const [pay, setPay] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [thanks, setThanks] = React.useState(false); const [open, setOpen] = React.useState(false);
  const amount = other ? Number(other) : amt;
  const stripePromise = React.useMemo(() => (pay?.publishableKey ? loadStripe(pay.publishableKey, { stripeAccount: pay.stripeAccountId }) : null), [pay]);
  const post = (body: any) => fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, groupId, ...keys, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
  const start = async () => { setBusy(true); setMsg(''); const r = await post({ action: 'chip', amount, name, email, message: note }); setBusy(false); if (!r.ok) { setMsg(r.error || 'That didn’t work.'); return; } setPay(r); };
  const confirm = React.useCallback(async () => { if (!pay) return;
    for (let i = 0; i < 8; i++) { const r = await post({ action: 'confirm', orderId: pay.orderId }); if (r?.paid) { setPay(null); setThanks(true); setOpen(false); load(); return; } await new Promise((res) => setTimeout(res, 1500)); }
    setMsg('Your payment is still being confirmed — refresh in a minute.'); }, [pay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Organizer
  const [copied, setCopied] = React.useState(false); const [ask, setAsk] = React.useState<'' | 'send' | 'cancel' | 'move'>(''); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('10:00');
  const act = async (action: string, extra: any = {}) => { setBusy(true); setMsg(''); const r = await post({ action, ...extra }); setBusy(false); setAsk('');
    if (!r.ok) { setMsg(r.error || 'That didn’t work.'); return; } setMsg(action === 'group-send' ? 'Sent!' : action === 'group-cancel' ? `Cancelled — ${$(r.refundedCents || 0)} is going back to everyone’s cards.` : 'Saved.'); load(); };

  const g = d?.group; const A = d?.brand?.accent || INK; const isOrg = g?.role === 'org';
  const sendDay = g ? new Date(g.sendAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const shareUrl = typeof window !== 'undefined' && g?.sharePath ? `${window.location.origin}${g.sharePath}` : '';
  const pct = g?.goalCents ? Math.min(100, Math.round((g.totalCents / g.goalCents) * 100)) : 0;
  const first = (s: string) => String(s || '').split(' ')[0];
  const namesLine = (n: string[]) => (n.length <= 3 ? n.join(n.length === 3 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1') : `${n.slice(0, 3).join(', ')} and ${n.length - 3} other${n.length - 3 === 1 ? '' : 's'}`);

  return (
    <div className="min-h-dvh px-5 pb-14 pt-8" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: `radial-gradient(1000px 500px at 10% -10%, color-mix(in srgb, ${A} 10%, #fff) 0%, transparent 60%), #f7f7f8` }}>
      <div className="mx-auto w-full max-w-md space-y-5">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !g ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <div><p className="text-[13.5px]" style={{ color: MUTED }}>{d.brand.name}</p>
            <h1 className="mt-1 text-[30px] font-normal leading-tight tracking-[-0.03em]">{isOrg ? `${first(g.recipientName)}’s gift` : `Chip in for ${first(g.recipientName)}`}</h1>
            <p className="mt-1 text-[14.5px]" style={{ color: MUTED }}>{g.status === 'sent' ? `Sent ${new Date(g.sentAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : g.status === 'cancelled' ? 'This gift was cancelled' : isOrg ? `You’re collecting · sends ${sendDay}` : `${first(g.organizerName)} is collecting · sends ${sendDay}`}</p></div>
          <div className="flex justify-center"><GiftCardFace design={g.design} brand={d.brand} amount={g.totalCents ? $(g.totalCents) : '$—'} name={g.recipientName} line={g.line || ''} width={Math.min(380, (typeof window !== 'undefined' ? window.innerWidth : 420) - 40)} /></div>

          <div className="space-y-3 rounded-[18px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}>
            <div className="flex items-baseline justify-between"><span className="text-[30px] font-normal tracking-[-0.03em]">{$(g.totalCents)}</span><span className="text-[13px]" style={{ color: MUTED }}>{g.goalCents ? `of ${$(g.goalCents)} hoped for` : 'so far'}</span></div>
            {g.goalCents ? <div className="h-2.5 overflow-hidden rounded-full" style={{ background: SOFT }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: GREEN }} /></div> : null}
            {g.names.length > 0 && <div className="flex items-center gap-3"><span className="flex">{g.names.slice(0, 6).map((n: string, i: number) => <span key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[12px] font-bold text-white" style={{ background: COLORS[i % COLORS.length], marginLeft: i ? -8 : 0 }}>{n.slice(0, 1).toUpperCase()}</span>)}</span>
              <span className="text-[13.5px]" style={{ color: MUTED }}>{namesLine(g.names)} {g.names.length === 1 ? 'is' : 'are'} in</span></div>}
          </div>

          {thanks && <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: '#e9f3ed', color: GREEN }}><b>Thank you!</b> You’re on the card. A receipt is on its way to your email.</p>}
          {msg && <p className="text-[14px] font-semibold" style={{ color: msg === 'Sent!' || msg === 'Saved.' || msg.startsWith('Cancelled') ? GREEN : RED }} role="status">{msg}</p>}

          {/* Organizer controls */}
          {isOrg && g.status === 'collecting' && <>
            <div className="flex items-center gap-2 rounded-[18px] bg-white p-3.5" style={{ border: `1px solid ${LINE}` }}>
              <div className="min-w-0 flex-1"><p className="text-[12.5px]" style={{ color: MUTED }}>Share this link</p><p className="truncate text-[14.5px]">{shareUrl}</p></div>
              <button type="button" onClick={async () => { try { if ((navigator as any).share) await (navigator as any).share({ title: `Chip in for ${first(g.recipientName)}`, url: shareUrl }); else { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } } catch { /* closed */ } }} className="h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>{copied ? 'Copied' : 'Share'}</button></div>
            {ask === '' && <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAsk('send')} disabled={!g.totalCents} className="h-12 rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ border: `1px solid ${LINE}`, background: '#fff' }}>Send it now</button>
              <button type="button" onClick={() => { const at = new Date(g.sendAt); setDay(localDay(at)); setTime(`${pad(at.getHours())}:${pad(at.getMinutes())}`); setAsk('move'); }} className="h-12 rounded-full text-[15px] font-semibold" style={{ border: `1px solid ${LINE}`, background: '#fff' }}>Change the day</button></div>}
            {ask === 'send' && <div className="space-y-2 rounded-2xl p-4" style={{ background: SOFT }}><p className="text-[14.5px]">Send {first(g.recipientName)} {$(g.totalCents)} from {g.count} {g.count === 1 ? 'person' : 'people'} now? Nobody else can chip in after.</p>
              <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => act('group-send')} className="h-11 flex-1 rounded-full text-[14.5px] font-semibold text-white" style={{ background: INK }}>{busy ? 'Sending…' : 'Send it'}</button><button type="button" onClick={() => setAsk('')} className="h-11 rounded-full px-4 text-[14.5px] font-semibold">Not yet</button></div></div>}
            {ask === 'move' && <div className="space-y-2 rounded-2xl p-4" style={{ background: SOFT }}><div className="grid grid-cols-[1.4fr_1fr] gap-2"><input type="date" value={day} min={localDay(new Date())} onChange={(e) => setDay(e.target.value)} aria-label="Day" className={field} style={fs} /><input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className={field} style={fs} /></div>
              <div className="flex gap-2"><button type="button" disabled={busy || !day} onClick={() => act('group-move', { sendAt: new Date(`${day}T${time || '10:00'}:00`).toISOString() })} className="h-11 flex-1 rounded-full text-[14.5px] font-semibold text-white" style={{ background: INK }}>Save</button><button type="button" onClick={() => setAsk('')} className="h-11 rounded-full px-4 text-[14.5px] font-semibold">Back</button></div></div>}
            {ask === 'cancel' && <div className="space-y-2 rounded-2xl p-4" style={{ background: '#fdecea' }}><p className="text-[14.5px]">Cancel the gift? Everyone who chipped in gets their money back on their card.</p>
              <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => act('group-cancel')} className="h-11 flex-1 rounded-full text-[14.5px] font-semibold text-white" style={{ background: RED }}>{busy ? 'Cancelling…' : 'Cancel and refund'}</button><button type="button" onClick={() => setAsk('')} className="h-11 rounded-full px-4 text-[14.5px] font-semibold">Keep it</button></div></div>}
            {(g.chips || []).length > 0 && <div className="rounded-[18px] bg-white" style={{ border: `1px solid ${LINE}` }}>
              <p className="px-4 pb-1 pt-3.5 text-[13px] font-semibold" style={{ color: MUTED }}>Who’s in (only you see the amounts)</p>
              {g.chips.map((c: any, i: number) => <div key={i} className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                <span className="min-w-0"><span className="block text-[15px] font-semibold">{c.name}{c.organizer ? ' (you)' : ''}</span>{c.message && <span className="block text-[13.5px]" style={{ color: MUTED }}>“{c.message}”</span>}</span>
                <span className="shrink-0 text-[15px]">{$(c.cents)}</span></div>)}</div>}
          </>}
          {isOrg && g.status === 'sent' && g.cardPath && <a href={g.cardPath} className="flex h-12 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ background: INK }}>See the gift card</a>}

          {/* Chip in (friends — and the organizer can add more) */}
          {g.status === 'collecting' && (pay ? (stripePromise ? <div className="overflow-hidden rounded-2xl"><EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: pay.clientSecret, onComplete: confirm }}><EmbeddedCheckout /></EmbeddedCheckoutProvider></div> : <p style={{ color: RED }}>Card payments aren’t set up here yet.</p>)
            : (!isOrg || open) && !thanks ? <div className="space-y-3">
              <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{isOrg ? 'Add more yourself' : 'How much would you like to add?'}</p>
              <div className="grid grid-cols-4 gap-2">{[20, 30, 50, 100].map((v) => <button key={v} type="button" aria-pressed={!other && amt === v} onClick={() => { setAmt(v); setOther(''); }} className="h-12 rounded-2xl text-[17px]" style={!other && amt === v ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>${v}</button>)}</div>
              <input value={other} onChange={(e) => setOther(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))} inputMode="decimal" placeholder={`Another amount ($5–$${d.max || 500})`} aria-label="Another amount" className={field} style={fs} />
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoComplete="name" placeholder="Your name (goes on the card)" aria-label="Your name" className={field} style={fs} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" placeholder="Your email (for the receipt)" aria-label="Your email" className={field} style={fs} />
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={3} placeholder={`A note to ${first(g.recipientName)} (optional)`} className="w-full rounded-2xl border px-4 py-3 text-[15.5px] outline-none focus:ring-2 focus:ring-black/10" style={fs} />
              <button type="button" disabled={busy || !(amount >= 5) || !name.trim() || !/\S+@\S+\.\S+/.test(email)} onClick={start} className="h-13 w-full rounded-full py-3.5 text-[15.5px] font-semibold text-white disabled:opacity-35" style={{ background: INK }}>{busy ? 'Opening payment…' : `Add ${amount >= 5 ? `$${amount}` : ''} and sign the card`}</button>
              <p className="text-center text-[12.5px]" style={{ color: MUTED }}>{isOrg ? 'Your share is private.' : `Your amount stays private. ${first(g.recipientName)} sees your name${note ? ' and note' : ''} when it’s sent.`}</p>
            </div> : isOrg && !thanks ? <button type="button" onClick={() => setOpen(true)} className="w-full text-[14px] font-semibold underline underline-offset-4">Add more yourself</button> : null)}
          {isOrg && g.status === 'collecting' && ask === '' && <button type="button" onClick={() => setAsk('cancel')} className="w-full text-[13.5px] underline underline-offset-4" style={{ color: MUTED }}>Cancel the gift and refund everyone</button>}
          {!isOrg && g.status !== 'collecting' && <p className="text-center text-[15px]" style={{ color: MUTED }}>{g.status === 'sent' ? `This gift has been sent — thank you to everyone who chipped in.` : 'This gift was cancelled, and everyone was refunded.'}</p>}
        </>}
      </div>
    </div>);
}
