'use client';
// The staff Pay tab: this period and pay stubs (PayHome), and "What my time is worth" (PayClarity) — two views, one tab.
import * as React from 'react';
import { PayHome } from '@/components/pay/PayHome';
import { PayClarity } from '@/components/pay/PayClarity';

export function PayTabs({ tenantId, staffId, firestore, accent }: { tenantId: string; staffId: string; firestore: any; accent?: string }) {
  const [view, setView] = React.useState<'pay' | 'worth'>(() => { try { return (localStorage.getItem('cf.pay.view') as any) === 'worth' ? 'worth' : 'pay'; } catch { return 'pay'; } });
  const pick = (v: 'pay' | 'worth') => { setView(v); try { localStorage.setItem('cf.pay.view', v); } catch { /* fine */ } };
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full border p-1" role="tablist" aria-label="Pay" style={{ borderColor: 'hsl(var(--border))' }}>
        {([['pay', 'My pay'], ['worth', 'What my time is worth']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => pick(k)} className="h-9 rounded-full px-4 text-[13.5px] font-semibold" style={view === k ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : undefined}>{l}</button>)}
      </div>
      {view === 'pay' ? <PayHome tenantId={tenantId} staffId={staffId} firestore={firestore} accent={accent} /> : <PayClarity tenantId={tenantId} />}
    </div>);
}
