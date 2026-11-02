'use client';
// src/components/gift/SpendSuggestions.tsx — "What your card covers" (the live menu, /api/public/menu). On the gift card
// page and the wallet: services the balance pays for in full (closest to it first), and one just above it with how
// much more it would be. Only shown — nothing is booked or added without them choosing it. In the page's mood colors
// (components/booking/VisitShell), so Soft, Crisp and Night all follow.
import * as React from 'react';

const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n.toFixed(0)}`;
export function SpendSuggestions({ tenantId, balanceCents, accent = 'var(--accent)' }: { tenantId: string; balanceCents: number; accent?: string }) {
  const [svcs, setSvcs] = React.useState<any[] | null>(null); const [base, setBase] = React.useState('');
  React.useEffect(() => { fetch(`/api/public/menu?business=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((x) => { if (x?.ok) { setSvcs((x.categories || []).flatMap((c: any) => c.services || [])); setBase(x.bookBase || `/book/${tenantId}`); } }).catch(() => {}); }, [tenantId]);
  if (!svcs || balanceCents <= 0) return null;
  const bal = balanceCents / 100;
  const fits = svcs.filter((s) => s.price > 0 && s.price <= bal).sort((a, b) => b.price - a.price).slice(0, 4);
  const stretch = svcs.filter((s) => s.price > bal && s.price - bal <= Math.max(15, bal * 0.25)).sort((a, b) => a.price - b.price)[0];
  if (!fits.length && !stretch) return null;
  const row = (s: any, extra?: number) => (
    <a key={s.id} href={`${base}?service=${encodeURIComponent(s.id)}&src=gift&gift=${balanceCents}`} className="flex min-h-[56px] items-center justify-between gap-3 py-2.5" style={{ borderTop: '1px solid var(--line)' }}>
      <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{s.name}</span><span className="block text-[13px]" style={{ color: 'var(--muted)' }}>{s.from ? 'from ' : ''}{money(s.price)}{s.duration ? ` · ${s.duration} min` : ''}{extra ? ` · ${money(extra)} more than your card` : ' · covered'}</span></span>
      <span className="shrink-0 rounded-full px-4 py-2 text-[13.5px] font-semibold text-white" style={{ background: accent }}>Book</span></a>);
  return (
    <section className="pub-card px-4 pb-1 pt-4" aria-label={`What your ${money(bal)} covers`}>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>What your {money(bal)} covers</p>
      <div className="mt-1">{fits.map((s) => row(s))}{stretch ? row(stretch, Math.round((stretch.price - bal) * 100) / 100) : null}</div>
    </section>);
}
