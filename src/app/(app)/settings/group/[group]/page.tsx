'use client';
// src/app/(app)/settings/group/[group]/page.tsx — ONE SETTINGS GROUP AND ITS PAGES. On a phone this is the step
// between Settings and a page; on a computer it's what a group shows before a page is picked. lib/settings-registry.
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { C, LargeTitle, Empty } from '@/components/orders/ui';
import { visibleGroups } from '@/lib/settings-registry';
import { AppHeader } from '@/components/shared/AppHeader';
import { AwayArrow } from '@/components/settings/SettingsShell';

export default function SettingsGroupPage() {
  const { group } = useParams() as { group: string };
  const { selectedTenant } = useTenant() as any;
  const g = React.useMemo(() => (selectedTenant ? visibleGroups(selectedTenant).find((x) => x.id === group) || null : null), [selectedTenant, group]);
  return (
    <div className="cf-settings min-h-full">
    <AppHeader title="Settings" />
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5 md:px-10 md:pt-10" style={{ color: C.ink }}>
      <Link href="/settings" className="mb-3 inline-flex h-11 items-center gap-1 text-[17px] lg:hidden" style={{ color: C.ink }}><ChevronLeft className="h-5 w-5" aria-hidden />Settings</Link>
      {!selectedTenant ? null : !g ? <Empty title="Nothing here" sub="This group isn’t part of the tools you use." /> : (
        <>
          <LargeTitle title={g.title} sub={g.meaning} />
          <div className="mt-6 overflow-hidden rounded-2xl" style={{ background: C.soft }}>
            {g.pages.map((p, i) => (
              <Link key={p.id} href={p.href} className="flex min-h-[64px] items-center gap-3 pl-4 transition-colors hover:brightness-[0.98]">
                <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={i < g.pages.length - 1 ? { borderBottom: `1px solid ${C.line}` } : undefined}>
                  <span className="min-w-0 flex-1"><span className="block text-[17px] tracking-[-0.01em]">{p.title}</span><span className="mt-0.5 block text-[13px] leading-snug" style={{ color: C.muted }}>{p.meaning}</span></span>
                  {p.inShell === false ? <AwayArrow className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />}
                </span>
              </Link>))}
          </div>
        </>
      )}
    </div>
    </div>
  );
}
