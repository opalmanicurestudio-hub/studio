'use client';
// src/components/money/RestockingFundCard.tsx — the Restocking fund on the Money overview: what's been set aside this
// month (product cost + markup on every finished service), what was spent on stock, and the running balance.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import Link from 'next/link';
const money = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function RestockingFundCard({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (!tenantId) return; let on = true; (async () => { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    const r = await fetch('/api/funds/restocking', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId }) }).then((x) => x.json()).catch(() => null); if (on) setD(r?.ok ? r : null); })(); return () => { on = false; }; }, [tenantId]);
  if (!d) return null;
  const muted = { color: 'var(--muted, #78716c)' };
  return (
    <section className="space-y-2 rounded-3xl p-5" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="Restocking fund">
      <div className="flex items-baseline justify-between gap-3"><h2 className="text-[15px] font-semibold">Restocking fund</h2><Link href="/settings?tab=policies" className="text-[13px] font-semibold underline underline-offset-2">Settings</Link></div>
      {!d.enabled ? <p className="text-[14px]" style={muted}>Off. Switch it on in Settings → Fees & credit, and every finished service will set aside its product cost plus a markup, so stock never eats into profit.</p> : (<>
        <p className="text-[28px] font-light leading-none">{d.balanceCents < 0 ? '−' : ''}{money(d.balanceCents)} <span className="text-[14px]" style={muted}>{d.balanceCents < 0 ? 'short — stock spend has outrun the fund' : 'in the fund'}</span></p>
        <p className="text-[14px]" style={muted}>This month: {money(d.setAsideMonthCents)} set aside from {d.visitsMonth} visits · {money(d.spentMonthCents)} spent on stock · markup {d.markupPct}%{d.usedWithoutSaleMonthCents > 0 ? ` · ${money(d.usedWithoutSaleMonthCents)} of product used without a sale (testers, redos, classes)` : ''}</p>
        <p className="text-[12px]" style={muted}>Set aside = product used (or the recipe) × (1 + markup). Stock spend = {d.spendBasis === 'deliveries' ? `deliveries of your ${d.coveredCount} back-bar and recipe items, from the stock ledger` : 'expenses in your supplies / inventory categories (record deliveries in Inventory for exact figures)'}.</p>
        {(d.missingCost || []).length > 0 && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn, #b45309)' }}>{d.missingCost.length === 1 ? `${d.missingCost[0].name} has ${d.missingCost[0].why} — its visits set nothing aside.` : `${d.missingCost.length} products in your recipes can't be counted yet (${d.missingCost.slice(0, 3).map((x: any) => `${x.name}: ${x.why}`).join('; ')}${d.missingCost.length > 3 ? '…' : ''}).`} <Link href="/inventory" className="underline underline-offset-2">Fix in Inventory</Link></p>}
      </>)}
    </section>);
}
