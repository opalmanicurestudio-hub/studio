'use client';
// The client's points on the public booking page — only when they arrived from their own rewards link (?c=…&rk=…), which
// this device then remembers for this business. Rewards are used at the visit, not online.
import * as React from 'react';

const KEY = (t: string) => `cf_rewards_${t}`;
export function BookingRewards({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<any>(null); const [hide, setHide] = React.useState(false);
  React.useEffect(() => {
    let who: { c: string; k: string } | null = null;
    try { const q = new URLSearchParams(window.location.search); const c = q.get('c') || '', k = q.get('rk') || '';
      if (c && k) { who = { c, k }; localStorage.setItem(KEY(tenantId), JSON.stringify(who)); } else { const s = localStorage.getItem(KEY(tenantId)); who = s ? JSON.parse(s) : null; } } catch { who = null; }
    if (!who) return;
    fetch('/api/loyalty/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId: who.c, k: who.k }) })
      .then((r) => r.json()).then((x) => { if (x?.ok && x.on) setD(x); else if (x && x.ok === false) { try { localStorage.removeItem(KEY(tenantId)); } catch { /* ignore */ } } }).catch(() => {});
  }, [tenantId]);
  if (!d || hide) return null;
  const line = d.ready?.length ? `${d.ready[d.ready.length - 1]} is ready. Just mention it at your visit.` : d.next ? `${d.next.toGo} more for ${String(d.next.name).charAt(0).toLowerCase()}${String(d.next.name).slice(1)}.` : 'You earn with every visit.';
  return (
    <div role="status" className="fixed inset-x-0 top-3 z-30 mx-auto flex w-[min(92vw,460px)] items-center gap-3 rounded-full px-4 py-2.5 shadow-lg" style={{ background: '#16171a', color: '#fff', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <span className="shrink-0 text-[15px] font-semibold">{d.balance} {d.unit}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: '#c9cace' }}>{d.first ? `Hi ${d.first}. ` : ''}{line}</span>
      <button type="button" aria-label="Hide" onClick={() => setHide(true)} className="h-8 w-8 shrink-0 rounded-full text-[16px]" style={{ color: '#c9cace' }}>×</button>
    </div>);
}
