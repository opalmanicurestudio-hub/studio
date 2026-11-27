'use client';
// src/components/money/OwnerTaxes.tsx — THE OWNER'S TAXES TAB on the Money page (api/owner-taxes): the tax set-aside
// (components/money/TaxSetAside) from the books' profit, for a business that files on Schedule C. The owner's alone.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { TaxSetAside } from '@/components/money/TaxSetAside';

export function OwnerTaxes({ tenantId, onWriteOffs }: { tenantId: string; onWriteOffs?: () => void }) {
  const post = React.useCallback(async (body: any) => {
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    try { const r = await fetch('/api/owner-taxes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, ...body }) }); return await r.json(); }
    catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  return <div className="mx-auto w-full max-w-[600px] px-4 pb-12 pt-5" style={{ color: '#16171a' }}>
    <h1 className="text-[26px] font-bold tracking-[-0.02em]">Taxes to set aside</h1>
    <p className="mb-4 mt-1 text-[15px]" style={{ color: '#6d7075' }}>Nothing takes tax out of the business’s profit for you, so here’s how much to keep back, and what’s due on each of the year’s four dates. Only you see this.</p>
    <TaxSetAside key={tenantId} who="owner" post={post} onWriteOffs={onWriteOffs || null} />
  </div>;
}

/** On the Money page's overview, for the owner alone: the next estimated tax date when it's a week away or less, unless
 *  they've switched reminders off or recorded paying toward it (api/owner-taxes 'status'). */
export function OwnerTaxDueCard({ tenantId, onOpen }: { tenantId: string; onOpen: () => void }) {
  const [soon, setSoon] = React.useState<{ due: string; inDays: number } | null>(null);
  React.useEffect(() => {
    let on = true;
    (async () => {
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r = await fetch('/api/owner-taxes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'status' }) }).then((x) => x.json()).catch(() => null);
      if (on && r?.ok) setSoon(r.soon || null);
    })();
    return () => { on = false; };
  }, [tenantId]);
  if (!soon) return null;
  const when = new Date(`${soon.due}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return <section aria-label="Estimated taxes" className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#fff] p-5" style={{ color: '#16171a' }}>
    <div className="min-w-0"><h2 className="text-[18px] font-bold" style={soon.inDays <= 2 ? { color: '#b45309' } : undefined}>{soon.inDays === 0 ? 'Estimated taxes are due today' : `Estimated taxes are due ${when}`}</h2>
      <p className="mt-1 text-[14px]" style={{ color: '#6d7075' }}>See what to send the IRS and your state, then mark it paid.</p></div>
    <button type="button" onClick={onOpen} className="inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2" style={{ background: '#16171a', color: '#fff' }}>Open Taxes</button>
  </section>;
}
