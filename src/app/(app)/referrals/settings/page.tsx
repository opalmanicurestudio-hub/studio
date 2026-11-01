'use client';
// src/app/(app)/referrals/settings/page.tsx — REFERRALS → SETTINGS for managers (components/referrals/ReferralsSettings).
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ReferralsSettings } from '@/components/referrals/ReferralsSettings';
import { useSettingsBack } from '@/components/settings/settings-place';

export default function ReferralsSettingsPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const back = useSettingsBack({ href: '/referrals', label: 'Referrals' });
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  if (!manager) return <div className="p-8"><AppHeader title="Referrals" /><p className="mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>Only managers can change referral settings.</p></div>;
  return (
    <div className="min-h-full p-4 md:p-8"><AppHeader title="Referrals" />
      <Link href={back.href} className={`mt-3 inline-flex h-11 items-center gap-1 text-[17px]${back.inSettings ? ' lg:hidden' : ''}`}><ChevronLeft className="h-5 w-5" aria-hidden />{back.label}</Link>
      <ReferralsSettings tenantId={tenantId} />
    </div>);
}
