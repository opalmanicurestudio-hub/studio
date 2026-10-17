'use client';
// src/components/shop/OrderNow.tsx — THE TOP OF A CUSTOMER'S ORDER PAGE: what's happening and what to do now
// (lib/order-now). When the shop is asking about a swap, the answer is right here: two buttons, no forms.
import * as React from 'react';
import { orderNow } from '@/lib/order-now';


export function OrderNow({ order, help, tenantId, orderId, token, onChanged }: { order: any; help: any; tenantId: string; orderId: string; token: string | null; onChanged: () => void }) {
  const now = orderNow(order, help);
  const [busy, setBusy] = React.useState<'' | 'yes' | 'no'>(''); const [said, setSaid] = React.useState('');
  if (!now && !said) return null;
  const decide = async (accept: boolean) => {
    if (!token) return; setBusy(accept ? 'yes' : 'no');
    try {
      const r = await fetch('/api/retail/swap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'decide', tenantId, orderId, qrToken: token, accept }) });
      const d = await r.json().catch(() => ({})); setSaid(d.message || (r.ok ? 'Thanks, got it.' : 'That didn’t go through. Please try again.')); if (r.ok) onChanged();
    } finally { setBusy(''); }
  };
  const go = () => {
    const a = now?.action; if (!a) return;
    if (a.kind === 'link' && a.target) window.open(a.target, '_blank', 'noopener');
    if (a.kind === 'scroll' && a.target) document.getElementById(a.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const act = now?.tone === 'act';
  return (
    <section aria-live="polite" className="cf-anim-rise rounded-[2rem] border-2 bg-white p-6" style={{ borderColor: act ? '#16171a' : '#ececee' }}>
      {said ? <p className="m-0 text-[22px] font-light leading-snug text-[#16171a]">{said}</p> : now && (
        <>
          <p className="m-0 text-[26px] font-light leading-tight tracking-[-0.02em] text-[#16171a]">{now.title}</p>
          <p className="m-0 mt-1.5 text-[15px] leading-relaxed text-[#6d7075]">{now.body}</p>
          {now.extra ? <p className="m-0 mt-2 text-[15px] font-semibold text-[#1f7a4d]">{now.extra}</p> : null}
          {now.action?.kind === 'swap' && order.swapOffer ? (
            <div className="mt-4">
              <div className="flex items-center gap-3 rounded-2xl bg-[#f5f5f7] p-3">
                {order.swapOffer.sub?.imageUrl ? <img src={order.swapOffer.sub.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <span className="h-14 w-14 rounded-xl bg-white" />}
                <span className="min-w-0"><span className="block truncate text-[17px] font-semibold text-[#16171a]">{order.swapOffer.sub?.name}</span><span className="block text-[14px] text-[#6d7075]">Instead of {order.swapOffer.lineName}</span></span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={!!busy || !token} onClick={() => void decide(true)} className="cf-press h-12 rounded-full bg-[#16171a] text-[15px] font-semibold text-white disabled:opacity-50">{busy === 'yes' ? 'Saving…' : 'Yes, swap it'}</button>
                <button type="button" disabled={!!busy || !token} onClick={() => void decide(false)} className="cf-press h-12 rounded-full bg-[#f5f5f7] text-[15px] font-semibold text-[#16171a] disabled:opacity-50">{busy === 'no' ? 'Saving…' : 'No, refund it'}</button>
              </div>
            </div>
          ) : now.action ? (
            <button type="button" onClick={go} className="cf-press mt-4 h-12 w-full rounded-full bg-[#16171a] text-[15px] font-semibold text-white">{now.action.label}</button>
          ) : null}
        </>)}
    </section>);
}
