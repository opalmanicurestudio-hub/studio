'use client';
// src/app/gift/[tenantId]/wallet/page.tsx — EVERY GIFT CARD A CLIENT HAS HERE (lib/gift-shop walletView). Opened from the
// private link "Find my gift card" sends: the cards drawn as they were given, what's left on each, what the balance
// covers, and one tap to book. In the visit link's look (components/booking/VisitShell), the business's color and mood.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { SpendSuggestions } from '@/components/gift/SpendSuggestions';
import { giftBrand } from '@/components/gift/gift-brand';
import { VisitShell, VisitButton, VisitMuted, brandFromLook, useLook } from '@/components/booking/VisitShell';
import { withGift } from '@/lib/gift-visit';

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
export default function GiftWalletPage() {
  const tenantId = String(useParams<{ tenantId: string }>()?.tenantId || ''); const sp = useSearchParams();
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}&wallet=${encodeURIComponent(sp?.get('c') || '')}&k=${encodeURIComponent(sp?.get('k') || '')}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this. Please check your connection.')); }, [tenantId, sp]);
  const [w, setW] = React.useState(340); React.useEffect(() => { setW(Math.min(360, window.innerWidth - 32)); }, []);
  const { look, ready } = useLook(tenantId);
  const brand = giftBrand(d, brandFromLook(look, tenantId));
  const findHref = `/gift/${encodeURIComponent(tenantId)}/find`;
  if (!ready && !d) return <div className="min-h-dvh" aria-busy="true" />;
  if (err) return <VisitShell brand={brand} title={err} subtitle="Lost the text or email? We can send your gift cards again."><VisitButton href={findHref}>Find my gift card</VisitButton></VisitShell>;
  if (!d) return <VisitShell brand={brand} title={<>Your <b>gift cards</b></>}><VisitMuted>Getting your gift cards…</VisitMuted></VisitShell>;
  const left = (d.cards || []).filter((c: any) => c.balanceCents > 0); const total = left.reduce((s: number, c: any) => s + c.balanceCents, 0);
  const ours = left.filter((c: any) => !c.ownerName);
  return (
    <VisitShell brand={brand} chip="Gift cards" title={<>Your <b>gift cards</b></>} subtitle={left.length ? `${money(total)} to spend.` : 'Nothing left to spend. Thank you for visiting!'}>
      {d.cards.map((c: any) => (
        <a key={c.id} href={c.path} className="block space-y-2" style={{ opacity: c.balanceCents > 0 ? 1 : 0.55 }}>
          <div className="flex justify-center"><GiftCardFace design={c.design} brand={{ ...d.brand, logo: brand.logo, name: c.ownerName || d.brand.name }} amount={c.kind === 'service' ? '1 visit' : money(c.initialCents)} name={c.recipientName} code={c.code} line={c.line || ''} expires={c.expiresAt} width={w} /></div>
          <p className="text-center text-[14.5px]">{c.balanceCents > 0 ? <><b>{money(c.balanceCents)}</b> left</> : 'All used'}{c.purchaserName ? <span style={{ color: 'var(--muted)' }}> · from {String(c.purchaserName).split(' ')[0]}</span> : null}</p>
        </a>))}
      {ours.length > 0 && <SpendSuggestions tenantId={tenantId} balanceCents={ours.reduce((s: number, c: any) => s + c.balanceCents, 0)} />}
      {left.length > 0 && <VisitButton href={withGift(d.bookUrl, ours.filter((c: any) => c.kind !== 'service').reduce((s: number, c: any) => s + c.balanceCents, 0))}>Book with them</VisitButton>}
      <p className="px-1 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Show a code when you pay. Keep this link: it always shows what’s left.</p>
    </VisitShell>
  );
}
