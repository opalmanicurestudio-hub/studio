'use client';
// /gift/[tenantId]/company/[orderId]?k=… — A COMPANY'S GIFT CARD ORDER (lib/gift-bulk), the private page in their invoice email:
// the design, the list (contacts partly hidden), the total and the day they're sent — and paying for it online.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', RED = '#b42318';
const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export default function CompanyOrderPage() {
  const p = useParams() as { tenantId: string; orderId: string }; const tenantId = String(p?.tenantId || ''), id = String(p?.orderId || '');
  const [q] = React.useState(() => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)));
  const k = q.get('k') || ''; const paidSession = q.get('paid') || '';
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(() => fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}&bulk=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`).then((r) => r.json())
    .then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')), [tenantId, id, k]);
  const post = (body: any) => fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, bulkId: id, k, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
  React.useEffect(() => { (async () => { if (paidSession) { for (let i = 0; i < 6; i++) { const r = await post({ action: 'bulk-confirm', sessionId: paidSession }); if (r?.paid) break; await new Promise((res) => setTimeout(res, 1500)); } } load(); })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = async () => { setBusy(true); setMsg(''); const r = await post({ action: 'bulk-pay' }); if (r.ok && r.url) { window.location.href = r.url; return; } setBusy(false); setMsg(r.error || 'That didn’t work.'); };
  const o = d?.order; const paid = o && (o.status === 'paid' || o.status === 'issued');
  const sendDay = o?.sendAt ? new Date(o.sendAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : null;
  return (
    <div className="min-h-dvh px-5 pb-14 pt-8" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: '#f7f7f8' }}>
      <div className="mx-auto w-full max-w-xl space-y-5">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !o ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <div><p className="text-[13.5px]" style={{ color: MUTED }}>{d.brand.name}</p><h1 className="mt-1 text-[30px] font-normal leading-tight tracking-[-0.03em]">Gift cards for {o.company}</h1></div>
          <div className="flex justify-center"><GiftCardFace design={o.design} brand={d.brand} amount={o.rows[0] ? $(o.rows[0].cents) : ''} name={o.rows[0]?.name || ''} line={o.line || ''} width={Math.min(380, (typeof window !== 'undefined' ? window.innerWidth : 420) - 40)} /></div>
          {o.message && <p className="rounded-[18px] border bg-white p-4 text-[15px] leading-relaxed" style={{ borderColor: LINE }}>“{o.message}”<span className="mt-1 block text-[13px]" style={{ color: MUTED }}>— {o.company}</span></p>}
          <div className="space-y-2 rounded-[18px] bg-white p-5" style={{ border: `1px solid ${LINE}` }}>
            <div className="flex items-baseline justify-between"><span className="text-[15px]">{o.count} gift card{o.count === 1 ? '' : 's'}</span><span className="text-[30px] font-normal tracking-[-0.03em]">{$(o.totalCents)}</span></div>
            <p className="text-[14px]" style={{ color: MUTED }}>Each person gets their own card by email or text{sendDay ? ` on ${sendDay}` : paid ? '' : ' as soon as it’s paid'}.</p>
            {paid ? <p className="rounded-xl px-3.5 py-2.5 text-[14.5px]" style={{ background: '#e9f3ed', color: GREEN }}><b>Paid — thank you.</b> {sendDay ? `The cards go out ${sendDay}.` : 'The cards are on their way.'}</p>
              : o.status === 'cancelled' ? <p style={{ color: MUTED }}>This order was cancelled.</p>
              : <><button type="button" disabled={busy} onClick={pay} className="mt-2 h-13 w-full rounded-full py-3.5 text-[15.5px] font-semibold text-white disabled:opacity-50" style={{ background: INK }}>{busy ? 'Opening payment…' : `Pay ${$(o.totalCents)}`}</button>
                <p className="text-center text-[13px]" style={{ color: MUTED }}>Paying by check or bank transfer? Reply to the email — the cards are made once it arrives.</p></>}
            {msg && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{msg}</p>}
          </div>
          <div className="rounded-[18px] bg-white" style={{ border: `1px solid ${LINE}` }}>
            <p className="px-4 pb-1 pt-3.5 text-[13px] font-semibold" style={{ color: MUTED }}>Who gets one</p>
            {o.rows.map((r: any, i: number) => <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14.5px]" style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
              <span className="min-w-0"><span className="block truncate">{r.name}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{r.to}</span></span>
              <span className="shrink-0">{$(r.cents)}{r.sent ? <span className="ml-2 text-[12px] font-semibold" style={{ color: GREEN }}>made</span> : null}</span></div>)}
          </div>
          <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Need a change to the list? Reply to the email and {d.brand.name} will update it before you pay.</p>
        </>}
      </div>
    </div>);
}
