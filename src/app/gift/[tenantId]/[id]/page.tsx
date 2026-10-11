'use client';
// src/app/gift/[tenantId]/[id]/page.tsx — THE GIFT CARD THE CLIENT RECEIVES (lib/gift-cards). Private link: the card in the
// chosen design (lib/gift-designs), who it's from and their note, the code, what's left, and "Book with it".
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';

const MUTED = '#6d7075', LINE = '#ececee';
export default function GiftCardPage() {
  const p = useParams<{ tenantId: string; id: string }>(); const sp = useSearchParams();
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { fetch(`/api/gift-cards?tenantId=${encodeURIComponent(String(p?.tenantId || ''))}&id=${encodeURIComponent(String(p?.id || ''))}&k=${encodeURIComponent(sp?.get('k') || '')}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')); }, [p, sp]);
  const A = d?.brand?.accent || '#16171a'; const c = d?.card; const $ = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
  return (
    <div className="min-h-dvh px-5 pb-12 pt-8" style={{ color: '#16171a', fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, Segoe UI, sans-serif", background: '#f7f7f8' }}>
      <div className="mx-auto w-full max-w-sm space-y-5">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !d ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <p className="text-center text-[13.5px]" style={{ color: MUTED }}>{d.brand.name}</p>
          <div className="flex justify-center"><GiftCardFace design={c.design} brand={d.brand} amount={$(c.initialCents)} name={c.recipientName} code={c.code} expires={c.expiresAt} line={c.line || ''} width={Math.min(360, (typeof window !== 'undefined' ? window.innerWidth : 400) - 40)} /></div>
          {c.purchaserName && !c.message ? <p className="text-center text-[14px]" style={{ color: MUTED }}>From {String(c.purchaserName).split(' ')[0]}</p> : null}
          {c.message && <div className="rounded-[18px] border p-4 text-[15.5px] leading-relaxed" style={{ borderColor: LINE }}>“{c.message}”{c.purchaserName && <p className="mt-1.5 text-[13px]" style={{ color: MUTED }}>— {String(c.purchaserName).split(' ')[0]}</p>}</div>}
          <div className="text-center"><p className="text-[12.5px]" style={{ color: MUTED }}>Your code</p><p className="mt-1 font-mono text-[24px] tracking-[0.08em]">{c.code}</p>
            <p className="mt-2 text-[14px]">{c.status === 'void' ? 'This card was cancelled.' : c.balanceCents > 0 ? <><b>{$(c.balanceCents)}</b> left to spend</> : 'This card has been used up.'}</p></div>
          {c.status !== 'void' && c.balanceCents > 0 && <a href={d.bookUrl} className="flex h-14 items-center justify-center rounded-[18px] text-[16px] font-bold text-white" style={{ background: A }}>Book with it</a>}
          <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Show this code when you pay. Keep this link — it always shows what’s left. <a href={`/gift/${encodeURIComponent(String(p?.tenantId || ''))}/find`} className="underline underline-offset-4">Have another card?</a>{d.brand.phone ? ` Questions? ${d.brand.phone}` : ''}</p>
        </>}
      </div>
    </div>);
}
