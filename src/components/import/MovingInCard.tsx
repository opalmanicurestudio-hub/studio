'use client';
// src/components/import/MovingInCard.tsx — "MOVING FROM ANOTHER APP?" on the dashboard, for an owner or manager of a
// business that hasn't brought anything over yet. Opens Moving in; "I'm starting fresh" hides it for good.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
export function MovingInCard({ tenantId, tenant, role }: { tenantId: string; tenant: any; role: string }) {
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!tenantId || !isManager || tenant?.movingIn?.dismissed) return;
    payPost('/api/import', { tenantId, action: 'status' }).then((r) => { if (r.ok && !r.imports && !r.moving?.dismissed) setShow(true); });
  }, [tenantId, isManager, tenant?.movingIn?.dismissed]);
  // Starting fresh: a short "finish setting up" card until all six steps are done (Getting started).
  const [fresh, setFresh] = React.useState<{ done: number } | null>(null);
  React.useEffect(() => { if (!tenantId || !isManager || !tenant?.movingIn?.fresh) return;
    payPost('/api/getting-started', { tenantId, action: 'status' }).then((r) => { if (r.ok && r.done < 6) setFresh({ done: r.done }); }); }, [tenantId, isManager, tenant?.movingIn?.fresh]);
  if (fresh) return (
    <a href="/getting-started" className="flex items-center justify-between gap-4 rounded-[22px] bg-white p-5" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <span><span className="block text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>getting started</span><span className="block text-[20px] font-normal tracking-[-0.02em]">Finish setting up — {fresh.done} of 6 done</span></span>
      <span className="h-2 w-40 shrink-0 rounded-full bg-[#f3f3f5]"><span className="block h-2 rounded-full" style={{ width: `${(fresh.done / 6) * 100}%`, background: INK }} /></span></a>);
  if (!show) return null;
  const items = ['Clients and their notes', 'Services and prices', 'Upcoming appointments', 'Gift cards and packages', 'Products'];
  return (
    <section className="grid gap-6 rounded-[22px] bg-white p-6 md:grid-cols-[1.3fr_1fr] md:p-7" style={{ border: `1px solid ${LINE}`, color: INK }} aria-label="Moving from another app">
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>just getting started?</p>
        <h2 className="mt-1 text-[26px] font-normal tracking-[-0.02em]">Moving from another app?</h2>
        <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: MUTED }}>Bring your clients, services, appointments, gift card balances and packages over in a few minutes. Nothing changes in your old app.</p>
        <div className="mt-4 flex flex-wrap gap-2"><a href="/import" className="inline-flex h-11 items-center rounded-full px-5 text-[14.5px] font-semibold text-white" style={{ background: INK }}>Start moving in</a>
          <button type="button" onClick={async () => { setShow(false); await payPost('/api/getting-started', { tenantId, action: 'fresh' }); window.location.href = '/getting-started'; }} className="h-11 rounded-full border px-5 text-[14.5px]" style={{ borderColor: LINE }}>I’m starting fresh</button></div></div>
      <ul className="flex flex-col justify-center gap-2.5">{items.map((t) => <li key={t} className="flex items-center gap-2.5 text-[14px]"><span className="h-5 w-5 shrink-0 rounded-full" style={{ border: '1.5px dashed #c9cacd' }} />{t}</li>)}</ul>
    </section>);
}
