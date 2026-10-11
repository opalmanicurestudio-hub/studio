'use client';
// src/app/gift/[tenantId]/order/[orderId]/page.tsx — THE BUYER'S GIFT (lib/gift-shop). From the receipt's private link:
// the card they bought, whether it has been sent, and — until it goes out — change the day, fix their email or number,
// or send it now. Once it's been used, they can see that too.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const field = 'h-12 w-full rounded-2xl border px-4 text-[15.5px] outline-none focus:ring-2 focus:ring-black/10';
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function GiftOrderPage() {
  const p = useParams<{ tenantId: string; orderId: string }>(); const k = useSearchParams()?.get('k') || '';
  const tenantId = String(p?.tenantId || ''); const orderId = String(p?.orderId || '');
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const load = React.useCallback(() => fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}&order=${encodeURIComponent(orderId)}&k=${encodeURIComponent(k)}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')), [tenantId, orderId, k]);
  React.useEffect(() => { load(); }, [load]);
  const [edit, setEdit] = React.useState<'' | 'when' | 'contact'>(''); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('09:00'); const [contact, setContact] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null);
  const change = async (body: any, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'change', tenantId, orderId, k, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection.' }));
    setBusy(false); setMsg({ ok: !!r.ok, t: r.ok ? ok : r.error || 'That didn’t work.' }); if (r.ok) { setEdit(''); load(); }
  };
  const o = d?.order; const A = d?.brand?.accent || INK;
  const pending = o && o.via !== 'me' && !o.sentAt && o.status === 'paid';
  return (
    <div className="min-h-dvh px-5 pb-16 pt-10" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: `radial-gradient(1000px 520px at 0% -10%, color-mix(in srgb, ${A} 9%, #fff) 0%, transparent 60%), #f7f7f8` }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
      <div className="mx-auto w-full max-w-md space-y-5">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !o ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <p className="text-center text-[13.5px]" style={{ color: MUTED }}>{d.brand.name}</p>
          <h1 className="text-center text-[28px] font-normal tracking-[-0.03em]">Your gift for {String(o.recipientName).split(' ')[0]}</h1>
          <div className="flex justify-center"><GiftCardFace design={o.design} brand={d.brand} amount={money(o.amountCents)} name={o.recipientName} code={o.via === 'me' ? o.code : null} line={o.line || ''} width={340} /></div>
          <div className="space-y-3 rounded-[18px] bg-white p-5" style={{ border: `1px solid ${LINE}` }}>
            {o.status !== 'paid' ? <p className="text-[15px]">We’re still confirming your payment. Check back in a minute.</p>
              : o.via === 'me' ? <p className="text-[15px] leading-relaxed">It’s yours to give. {o.cardPath ? <a href={o.cardPath} className="font-semibold underline underline-offset-4">Open the gift card</a> : null} to print it or forward the link.</p>
              : o.sentAt ? <p className="flex items-start gap-2 text-[15px] leading-relaxed"><span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: GREEN }} />{o.via === 'text' ? 'Texted' : 'Emailed'} to {String(o.recipientName).split(' ')[0]} on {fmt(o.sentAt)}.</p>
              : o.sendStatus === 'failed' ? <p className="text-[15px]" style={{ color: RED }}>It didn’t send — check their {o.via === 'text' ? 'number' : 'email'} below and send it again.</p>
              : o.sendAt ? <p className="text-[15px] leading-relaxed">Arrives <b>{fmt(o.sendAt)}</b> by {o.via === 'text' ? 'text' : 'email'}.</p>
              : <p className="text-[15px]">Sending now…</p>}
            {o.used ? <p className="text-[14px]" style={{ color: MUTED }}>{String(o.recipientName).split(' ')[0]} has started using it{o.balanceCents > 0 ? ` — ${money(o.balanceCents)} left.` : '.'}</p> : null}
            {o.via !== 'me' && <p className="text-[13.5px]" style={{ color: MUTED }}>To: {o.via === 'text' ? o.recipientPhone : o.recipientEmail}</p>}
            {o.message ? <p className="text-[14.5px] italic leading-relaxed" style={{ color: MUTED }}>“{o.message}”</p> : null}
          </div>
          {pending && <div className="space-y-3">
            {edit === 'when' ? <div className="space-y-2 rounded-[18px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}>
              <div className="grid grid-cols-[1.4fr_1fr] gap-2"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className={field} style={{ borderColor: LINE }} /><input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className={field} style={{ borderColor: LINE }} /></div>
              <button type="button" disabled={busy || !day} onClick={() => change({ sendAt: new Date(`${day}T${time || '09:00'}:00`).toISOString() }, 'Updated — it will arrive then.')} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Save the new time</button></div>
              : edit === 'contact' ? <div className="space-y-2 rounded-[18px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}>
                <input value={contact} onChange={(e) => setContact(e.target.value)} inputMode={o.via === 'text' ? 'tel' : 'email'} placeholder={o.via === 'text' ? 'Their mobile number' : 'Their email'} className={field} style={{ borderColor: LINE }} />
                <button type="button" disabled={busy || !contact.trim()} onClick={() => change(o.via === 'text' ? { recipientPhone: contact } : { recipientEmail: contact }, 'Saved.')} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Save</button></div>
              : <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { const t = o.sendAt ? new Date(o.sendAt) : new Date(Date.now() + 864e5); setDay(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`); setTime(`${pad(t.getHours())}:${pad(t.getMinutes())}`); setEdit('when'); }} className="h-12 rounded-full text-[14.5px] font-semibold" style={{ background: SOFT }}>Change the day</button>
                <button type="button" onClick={() => { setContact(''); setEdit('contact'); }} className="h-12 rounded-full text-[14.5px] font-semibold" style={{ background: SOFT }}>Fix their {o.via === 'text' ? 'number' : 'email'}</button>
                <button type="button" disabled={busy} onClick={() => change({ now: true }, 'Sent!')} className="col-span-2 h-12 rounded-full text-[15px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Send it now</button></div>}
          </div>}
          {msg && <p className="text-center text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : RED }} role="status">{msg.t}</p>}
          <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Keep this link — it always shows where your gift is.{d.brand.phone ? ` Questions? ${d.brand.phone}` : ''}</p>
        </>}
      </div>
    </div>);
}
