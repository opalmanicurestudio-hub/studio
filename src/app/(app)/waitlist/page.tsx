'use client';
// src/app/(app)/waitlist/page.tsx — THE WAITLIST, for the desk and managers (design canvas Op12, Op15–Op17). Openings
// as they happen: how each is being offered (one at a time / first to tap / the desk), who has it now, who fits next
// and who doesn't (and why); who's waiting; and the demand you're turning away. Everything fills on its own — the desk
// steps in only for openings under an hour away, or to offer one to someone by hand. /api/waitlist (lib/waitlist-server).
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { WaitlistDesk } from '@/components/waitlist/WaitlistDesk';

export default function WaitlistPage() {
  const { selectedTenant } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  return <div className="min-h-full p-4 md:p-8" style={{ color: '#16171a' }}><AppHeader title="Waitlist" /><WaitlistDesk tenantId={tenantId} /></div>;
}
