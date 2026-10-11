'use client';
// src/components/gift/SpendSuggestions.tsx — "WHAT YOUR CARD COVERS" (the live menu, /api/public/menu). On the gift card
// page and the wallet: services the balance pays for in full (closest to it first), and one just above it with how
// much more it would be. Only shown — nothing is booked or added without them choosing it.
import * as React from 'react';

const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n.toFixed(0)}`;
export function SpendSuggestions({ tenantId, balanceCents, accent = '#16171a' }: { tenantId: string; balanceCents: number; accent?: string }) {
  const [svcs, setSvcs] = React.useState<any[] | null>(null); const [base, setBase] = React.useState('');
  React.useEffect(() => { fetch(`/api/public/menu?business=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((x) => { if (x?.ok) { setSvcs((x.categories || []).flatMap((c: any) => c.services || [])); setBase(x.bookBase || `/book/${tenantId}`); } }).catch(() => {}); }, [tenantId]);
  if (!svcs || balanceCents <= 0) return null;
  const bal = balanceCents / 100;
  const fits = svcs.filter((s) => s.price > 0 && s.price <= bal).sort((a, b) => b.price - a.price).slice(0, 4);
  const stretch = svcs.filter((s) => s.price > bal && s.price - bal <= Math.max(15, bal * 0.25)).sort((a, b) => a.price - b.price)[0];
  if (!fits.length && !stretch) return null;
  const row = (s: any, extra?: number) => (
    <a key={s.id} href={`${base}?service=${encodeURIComponent(s.id)}&src=gift`} className="flex items-center justify-between gap-3 py-3" style={{ borderTop: '1px solid #ececee' }}>
      <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{s.name}</span><span className="block text-[12.5px]" style={{ color: '#6d7075' }}>{s.from ? 'from ' : ''}{money(s.price)}{s.duration ? ` · ${s.duration} min` : ''}{extra ? ` · ${money(extra)} more than your card` : ' · covered'}</span></span>
      <span className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white" style={{ background: accent }}>Book</span></a>);
  return (
    <div className="rounded-[18px] bg-white px-4 pb-1 pt-4" style={{ border: '1px solid #ececee' }}>
      <p className="text-[12px] tracking-[0.1em]" style={{ color: '#6d7075' }}>WHAT YOUR {money(bal)} COVERS</p>
      <div className="mt-1">{fits.map((s) => row(s))}{stretch ? row(stretch, Math.round((stretch.price - bal) * 100) / 100) : null}</div>
    </div>);
}
