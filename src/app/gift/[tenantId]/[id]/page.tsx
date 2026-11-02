'use client';
// src/app/gift/[tenantId]/[id]/page.tsx — THE GIFT CARD THE CLIENT RECEIVES (lib/gift-cards; ClientManage "Gift"). Private
// link: the card in the chosen design (lib/gift-designs), who it's from and their note, the code, what's left, what it
// covers, and "Book with it" first. In the visit link's look (components/booking/VisitShell): the business's header,
// color and mood, so it feels like part of their booking page. A card a renter sold carries the renter's name.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { SpendSuggestions } from '@/components/gift/SpendSuggestions';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitSaid, VisitLabel, brandFromLook, useLook } from '@/components/booking/VisitShell';
import { withGift, rememberGiftCode } from '@/lib/gift-visit';
import { giftBrand } from '@/components/gift/gift-brand';
import { bonusWhen } from '@/lib/gift-offers';

const $ = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const firstOf = (n: any) => String(n || '').trim().split(' ')[0];

export default function GiftCardPage() {
  const p = useParams<{ tenantId: string; id: string }>(); const sp = useSearchParams();
  const tenantId = String(p?.tenantId || '');
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [copied, setCopied] = React.useState<{ text: string; ok: boolean } | null>(null);
  React.useEffect(() => { fetch(`/api/gift-cards?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(String(p?.id || ''))}&k=${encodeURIComponent(sp?.get('k') || '')}`).then((r) => r.json()).then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this. Please check your connection.')); }, [p, sp, tenantId]);
  // Booking from here: the deposit step can fill in this card's code (same tab only — never put in a link).
  React.useEffect(() => { const cd = d?.card; if (!cd?.code || cd.ownerRenterId || cd.kind === 'service' || cd.promo || !(cd.balanceCents > 0)) return; rememberGiftCode(tenantId, cd.code); }, [d, tenantId]);
  const { look, ready } = useLook(tenantId);
  const brand = giftBrand(d, brandFromLook(look, tenantId));
  const [w, setW] = React.useState(340); React.useEffect(() => { setW(Math.min(360, window.innerWidth - 32)); }, []);
  const findHref = `/gift/${encodeURIComponent(tenantId)}/find`;
  if (!ready && !d) return <div className="min-h-dvh" aria-busy="true" />;
  if (err) return (
    <VisitShell brand={brand} title={err} subtitle="Lost the text or email? We can send your gift cards again.">
      <VisitButton href={findHref}>Find my gift card</VisitButton>
    </VisitShell>
  );
  if (!d) return <VisitShell brand={brand} title={<>Your <b>gift card</b></>}><VisitMuted>Getting your gift card…</VisitMuted></VisitShell>;
  const c = d.card; const live = c.status !== 'void' && c.balanceCents > 0;
  const from = firstOf(c.purchaserName);
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(c.code)); setCopied({ text: 'Code copied.', ok: true }); } catch { setCopied({ text: 'Press and hold the code to copy it.', ok: false }); }
    window.setTimeout(() => setCopied(null), 4000);
  };
  return (
    <VisitShell brand={brand} chip="Gift card">
      <h1 className="sr-only">Your gift card from {brand.studioName || 'us'}</h1>
      <div className="pub-rise flex justify-center pb-4"><GiftCardFace design={c.design} brand={{ name: d.brand.name, logo: brand.logo, accent: d.brand.accent }} amount={c.kind === 'service' ? '1 visit' : $(c.initialCents)} name={c.recipientName} code={c.code} expires={c.expiresAt} line={c.line || ''} width={w} /></div>
      {c.givers ? <p className="text-center text-[18px]">From {c.purchaserName}</p> : null}
      {c.message && <VisitCard>
        {from && !c.givers && <VisitLabel>From {from}</VisitLabel>}
        <p className="text-[16px] leading-relaxed">“{c.message}”</p>
      </VisitCard>}
      {!c.message && from && !c.givers ? <p className="text-center text-[14px]" style={{ color: 'var(--muted)' }}>From {from}</p> : null}
      {(c.notes || []).map((n: any, i: number) => <VisitCard key={i}><VisitLabel>From {firstOf(n.name) || 'a friend'}</VisitLabel><p className="text-[15.5px] leading-relaxed">“{n.message}”</p></VisitCard>)}
      <VisitCard>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>Your code</p>
        <p className="select-all font-mono text-[24px] tracking-[0.08em]">{c.code}</p>
        <p className="text-[15px]">{c.status === 'void' ? 'This card was canceled.' : c.balanceCents > 0 ? (c.kind === 'service' ? <>Good for one <b>{c.serviceName}</b>, covered even if the price goes up.</> : <><b>{$(c.balanceCents)}</b> left to spend</>) : 'This card has been used up.'}</p>
      </VisitCard>
      {c.promo && live && <VisitCard tone="ok"><p className="text-[14.5px]">Your bonus{c.offerName ? ` from the ${c.offerName}` : ''}. {bonusWhen(c)}{bonusWhen(c) ? '. ' : ''}Use it on your visit. It’s a thank-you, so it can’t be swapped for cash.</p></VisitCard>}
      {live && !c.ownerRenterId && c.kind !== 'service' && <SpendSuggestions tenantId={tenantId} balanceCents={c.balanceCents} />}
      {live && <VisitButton href={c.kind === 'service' ? d.bookUrl : withGift(d.bookUrl, c.balanceCents)}>Book with it</VisitButton>}
      {c.status !== 'void' && <VisitButton quiet onClick={copy}>Copy the code</VisitButton>}
      <VisitSaid text={copied?.text} ok={copied?.ok} />
      <p className="px-1 text-center text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>Show this code when you pay, or book with it here. Keep this link: it always shows what’s left.{d.brand.phone ? ` Questions? ${d.brand.phone}` : ''}</p>
      <a href={findHref} className="mx-auto flex min-h-11 items-center justify-center px-3 text-[14px] underline underline-offset-4" style={{ color: 'var(--muted)' }}>Have another card?</a>
    </VisitShell>
  );
}
