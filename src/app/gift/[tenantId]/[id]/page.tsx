'use client';
// src/app/gift/[tenantId]/[id]/page.tsx — THE GIFT CARD THE CLIENT RECEIVES (lib/gift-cards). Private link: the card in the
// business's color, who it's from and their note, the code, what's left, and "Book with it".
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const MUTED = '#6d7075', LINE = '#ececee';
export default function GiftCardPage() {
  const p = useParams<{ tenantId: string; id: string }>(); const sp = useSearchParams();
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { fetch(`/api/gift-cards?tenantId=${encodeURIComponent(String(p?.tenantId || ''))}&id=${encodeURIComponent(String(p?.id || ''))}&k=${encodeURIComponent(sp?.get('k') || '')}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')); }, [p, sp]);
  const A = d?.brand?.accent || '#16171a'; const c = d?.card; const $ = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
  return (
    <div className="min-h-dvh bg-white px-5 pb-12 pt-8" style={{ color: '#16171a', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div className="mx-auto w-full max-w-sm space-y-5">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !d ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <p className="text-center text-[13.5px]" style={{ color: MUTED }}>{d.brand.name}</p>
          <div className="flex aspect-[1.586] flex-col justify-between rounded-[24px] p-6 text-white" style={{ background: A, boxShadow: `0 14px 34px color-mix(in srgb, ${A} 35%, transparent)` }}>
            <div className="flex items-center justify-between">{d.brand.logo ? <img src={d.brand.logo} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <span className="text-[13px] font-bold">{d.brand.name}</span>}<span className="text-[12px] opacity-80">Gift card</span></div>
            <div><p className="text-[46px] font-normal leading-none tracking-[-0.03em]">{$(c.initialCents)}</p>
              <p className="mt-1.5 text-[13.5px] opacity-90">{c.recipientName ? `For ${String(c.recipientName).split(' ')[0]}` : ''}{c.recipientName && c.purchaserName ? ', ' : ''}{c.purchaserName ? `from ${String(c.purchaserName).split(' ')[0]}` : ''}</p></div>
          </div>
          {c.message && <div className="rounded-[18px] border p-4 text-[15.5px] leading-relaxed" style={{ borderColor: LINE }}>“{c.message}”{c.purchaserName && <p className="mt-1.5 text-[13px]" style={{ color: MUTED }}>— {String(c.purchaserName).split(' ')[0]}</p>}</div>}
          <div className="text-center"><p className="text-[12.5px]" style={{ color: MUTED }}>Your code</p><p className="mt-1 font-mono text-[24px] tracking-[0.08em]">{c.code}</p>
            <p className="mt-2 text-[14px]">{c.status === 'void' ? 'This card was cancelled.' : c.balanceCents > 0 ? <><b>{$(c.balanceCents)}</b> left to spend</> : 'This card has been used up.'}</p></div>
          {c.status !== 'void' && c.balanceCents > 0 && <a href={d.bookUrl} className="flex h-14 items-center justify-center rounded-[18px] text-[16px] font-bold text-white" style={{ background: A }}>Book with it</a>}
          <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Show this code when you pay. Keep this link — it always shows what’s left.{d.brand.phone ? ` Questions? ${d.brand.phone}` : ''}</p>
        </>}
      </div>
    </div>);
}
