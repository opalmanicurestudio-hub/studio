'use client';
// src/components/settings/SettingsHome.tsx — SETTINGS HOME.
// The eleven groups from lib/settings-registry, named for the decisions an owner makes, with only the tools the
// business uses. On a phone this is the list you start from (each group opens its pages); on a computer the same
// groups also sit in the list on the left (components/settings/SettingsShell). Above them: anything that needs the
// owner (a missing detail, an automation that can't run, something switched off in a way that stops another thing).
import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';
import { attentionItems } from '@/lib/settings-map';
import { visibleGroups, searchPages } from '@/lib/settings-registry';
import { useRowSearch, announceFind } from '@/components/settings/use-row-search';
import { C, LargeTitle } from '@/components/orders/ui';
import { GroupIcon, AwayArrow } from '@/components/settings/SettingsShell';

const T = (tab: string) => `/settings?tab=${tab}`;

async function automationsNeedingYou(tenantId: string) {
  try {
    const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
    const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ tenantId }) });
    const d = await r.json(); return d?.ok ? (d.items || []).filter((a: any) => a.status === 'needs_setup' || a.status === 'failing').length : null;
  } catch { return null; }
}

function Rows({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-2xl" style={{ background: C.soft }}>{children}</div>;
}

function LinkRow({ href, lead, title, note, away, last, prefetch, onClick }: { href: string; lead?: React.ReactNode; title: string; note?: string; away?: boolean; last?: boolean; prefetch?: boolean; onClick?: () => void }) {
  return (
    <Link href={href} prefetch={prefetch} onClick={onClick} className="flex min-h-[60px] items-center gap-3 pl-4 transition-colors hover:brightness-[0.98]">
      {lead}
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={last ? undefined : { borderBottom: `1px solid ${C.line}` }}>
        <span className="min-w-0 flex-1"><span className="block text-[17px] tracking-[-0.01em]" style={{ color: C.ink }}>{title}</span>{note && <span className="mt-0.5 block text-[13px] leading-snug" style={{ color: C.muted }}>{note}</span>}</span>
        {away ? <AwayArrow className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />}
      </span>
    </Link>
  );
}

export function SettingsHome({ tenant }: { tenant: any }) {
  const groups = React.useMemo(() => (tenant ? visibleGroups(tenant) : []), [tenant]);
  const [q, setQ] = React.useState(''); const [autoCount, setAutoCount] = React.useState<number | null>(null);
  React.useEffect(() => { if (tenant?.id) void automationsNeedingYou(tenant.id).then(setAutoCount); }, [tenant?.id]);
  const todo = [
    tenant && !tenant.logoUrl && { title: 'Add your logo', href: T('profile') },
    tenant && !(tenant.phone && tenant.address) && { title: 'Add your phone and address', href: T('profile') },
    tenant && !(tenant.stripeAccountId && tenant.stripeChargesEnabled !== false) && { title: 'Connect payments so clients can pay online', href: T('payments') },
    autoCount ? { title: `${autoCount} automation${autoCount === 1 ? ' needs' : 's need'} you`, href: '/settings/automations' } : null,
    // Anything switched off in a way that quietly stops something else (already limited to the business's tools).
    ...(tenant ? attentionItems(tenant) : []).map((a) => ({ title: a.warning || `${a.label} isn’t set up`, href: a.href })),
  ].filter(Boolean) as { title: string; href: string }[];
  const hits = React.useMemo(() => (tenant ? searchPages(tenant, q) : []), [tenant, q]);
  const { hits: rowHits, loading: rowsLoading } = useRowSearch(tenant, q, 10);

  return (
    <div className="cf-settings min-h-full"><div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5 md:px-10 md:pt-10" style={{ color: C.ink }}>
      <LargeTitle title="Settings" sub="Grouped by the decisions you make. Only what your tools use is here." />
      <label className="cf-search mt-5 flex h-11 items-center gap-2.5 rounded-xl px-3.5 lg:hidden" style={{ background: C.soft }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none" style={{ color: C.ink }} />
      </label>
      {q.trim().length >= 2 ? (
        <section aria-label="Search results" className="mt-6">
          {hits.length === 0 && rowHits.length === 0 ? (rowsLoading ? null : <p className="text-[15px]" style={{ color: C.muted }}>Nothing matches “{q}”. Try another word, like “deposit” or “delivery”.</p>) : (<>
            {hits.length > 0 && <Rows>{hits.map((h, i) => <LinkRow key={h.group.id + h.page.id} href={h.page.href} lead={<GroupIcon id={h.group.id} />} title={h.page.title} note={h.group.title} away={h.page.inShell === false} last={i === hits.length - 1} />)}</Rows>}
            {rowHits.length > 0 && <p className="px-4 pb-2 pt-6 text-[13px] font-semibold" style={{ color: C.muted }}>Settings on a page</p>}
            {rowHits.length > 0 && <Rows>{rowHits.map((r, i) => <LinkRow key={r.href} href={r.href} prefetch={false} onClick={() => announceFind(r.label)} lead={<GroupIcon id={r.group.id} />} title={r.label} note={r.page.title === r.group.title ? r.page.title : `${r.page.title} · ${r.group.title}`} last={i === rowHits.length - 1} />)}</Rows>}
          </>)}
        </section>
      ) : (
        <>
          {todo.length > 0 && (
            <section aria-label="Needs you" className="mt-7">
              <p className="px-4 pb-2 text-[13px] font-semibold" style={{ color: C.muted }}>Needs you</p>
              <Rows>{todo.map((t, i) => <LinkRow key={t.title} href={t.href} lead={<span className="h-2 w-2 shrink-0 rounded-full" style={{ background: C.warn }} aria-hidden />} title={t.title} last={i === todo.length - 1} />)}</Rows>
            </section>
          )}
          <section aria-label="Settings groups" className="mt-7">
            <Rows>{groups.map((g, i) => {
              const single = g.pages.length === 1 ? g.pages[0] : null;
              return <LinkRow key={g.id} href={single ? single.href : `/settings/group/${g.id}`} lead={<GroupIcon id={g.id} />} title={g.title} note={g.meaning} away={single?.inShell === false} last={i === groups.length - 1} />;
            })}</Rows>
          </section>
        </>
      )}
    </div></div>
  );
}
