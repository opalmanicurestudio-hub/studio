'use client';
// src/app/gift/[tenantId]/wallet/page.tsx — EVERY GIFT CARD A CLIENT HAS HERE (lib/gift-shop walletView). Opened from the
// private link "Find my gift card" sends: the cards drawn as they were given, what's left on each, and one tap to book.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { SpendSuggestions } from '@/components/gift/SpendSuggestions';
import { withGift } from '@/lib/gift-visit';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
export default function GiftWalletPage() {
  const tenantId = String(useParams<{ tenantId: string }>()?.tenantId || ''); const sp = useSearchParams();
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}&wallet=${encodeURIComponent(sp?.get('c') || '')}&k=${encodeURIComponent(sp?.get('k') || '')}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')); }, [tenantId, sp]);
  const [w, setW] = React.useState(340); React.useEffect(() => { setW(Math.min(360, window.innerWidth - 40)); }, []);
  const left = (d?.cards || []).filter((c: any) => c.balanceCents > 0); const total = left.reduce((s: number, c: any) => s + c.balanceCents, 0);
  return (
    <div className="min-h-dvh px-5 pb-16 pt-10" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: '#f7f7f8' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
      <div className="mx-auto w-full max-w-sm space-y-6">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !d ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <div className="text-center"><p className="text-[13.5px]" style={{ color: MUTED }}>{d.brand.name}</p><h1 className="mt-1 text-[30px] font-normal tracking-[-0.03em]">Your gift cards</h1>
            <p className="mt-1 text-[15px]">{left.length ? <><b>{money(total)}</b> to spend</> : 'Nothing left to spend — thank you for visiting!'}</p></div>
          {d.cards.map((c: any) => (
            <a key={c.id} href={c.path} className="block space-y-2" style={{ opacity: c.balanceCents > 0 ? 1 : 0.55 }}>
              <div className="flex justify-center"><GiftCardFace design={c.design} brand={{ ...d.brand, name: c.ownerName || d.brand.name }} amount={c.kind === 'service' ? '1 visit' : money(c.initialCents)} name={c.recipientName} code={c.code} line={c.line || ''} expires={c.expiresAt} width={w} /></div>
              <p className="text-center text-[14px]">{c.balanceCents > 0 ? <><b>{money(c.balanceCents)}</b> left</> : 'All used'}{c.purchaserName ? <span style={{ color: MUTED }}> · from {String(c.purchaserName).split(' ')[0]}</span> : null}</p>
            </a>))}
          {left.length > 0 && <SpendSuggestions tenantId={tenantId} balanceCents={left.filter((c: any) => !c.ownerName).reduce((s: number, c: any) => s + c.balanceCents, 0)} accent={d.brand.accent || INK} />}
          {left.length > 0 && <a href={withGift(d.bookUrl, left.filter((c: any) => !c.ownerName && c.kind !== 'service').reduce((s: number, c: any) => s + c.balanceCents, 0))} className="flex h-14 items-center justify-center rounded-[18px] text-[16px] font-bold text-white" style={{ background: d.brand.accent || INK }}>Book with them</a>}
          <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Show a code when you pay. <span style={{ borderBottom: `1px solid ${LINE}` }}>Keep this link — it always shows what’s left.</span></p>
        </>}
      </div>
    </div>);
}
