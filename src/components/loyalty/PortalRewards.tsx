'use client';
// The client's rewards on their client page: points, what's ready, and their private rewards page (/rewards/…).
import * as React from 'react';

export function PortalRewards({ tenantId, clientId, k, onLoaded }: { tenantId: string; clientId: string; k: string; onLoaded?: (on: boolean) => void }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (!tenantId || !clientId || !k) return; fetch('/api/loyalty/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, k }) })
    .then((r) => r.json()).then((x) => { setD(x?.ok && x.on ? x : null); onLoaded?.(!!(x?.ok && x.on)); }).catch(() => onLoaded?.(false)); }, [tenantId, clientId, k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  return (
    <a href={d.url} className="block rounded-[24px] p-6 no-underline" style={{ background: '#16171a', color: '#fff' }}>
      <p className="text-[13px]" style={{ color: '#c9cace' }}>Your rewards</p>
      <p className="mt-1 text-[40px] font-light leading-none tracking-[-0.03em]">{d.balance} <span className="text-[16px]" style={{ color: '#c9cace' }}>{d.unit}</span></p>
      <p className="mt-3 text-[14px]">{d.ready?.length ? `Ready to use: ${d.ready[0]}${d.ready.length > 1 ? ` and ${d.ready.length - 1} more` : ''}.` : d.next ? `${d.next.toGo} more for ${String(d.next.name).charAt(0).toLowerCase()}${String(d.next.name).slice(1)}.` : 'Earning with every visit.'}</p>
      <p className="mt-3 text-[13.5px] font-semibold" style={{ color: '#7fd1a5' }}>See your rewards ›</p>
    </a>);
}
