'use client';
// Settings → Card reader. Starts its own reader connection here (the front desk starts its own),
// so a reader added or connected here is remembered on this device and reconnects at the desk.

import { StripeTerminalProvider, useTerminalOptional } from './StripeTerminalProvider';
import { ReaderPanel } from './ReaderPanel';
import { DESK_CSS } from '@/components/pos/desk/kit';
import { useTenant } from '@/context/TenantContext';

function Inner({ tenantId, manager }: { tenantId: string; manager: boolean }) {
  return <ReaderPanel tenantId={tenantId} manager={manager} />;
}

export function TerminalSettings() {
  const { selectedTenant, role } = useTenant();
  const outer = useTerminalOptional();
  const tenantId = (selectedTenant as any)?.id || '';
  const manager = role === 'owner' || role === 'admin' || role === 'manager';
  const body = !tenantId ? null
    : !(selectedTenant as any)?.stripeAccountId ? <p className="text-[14px]" style={{ color: 'var(--muted)' }}>Connect your Stripe account under Payments first. The card reader takes payments through it.</p>
    : outer ? <Inner tenantId={tenantId} manager={manager} />
    : <StripeTerminalProvider tenantId={tenantId}><Inner tenantId={tenantId} manager={manager} /></StripeTerminalProvider>;
  return <div className="desk" style={{ background: 'transparent' }}><style>{DESK_CSS}</style>{body}</div>;
}
