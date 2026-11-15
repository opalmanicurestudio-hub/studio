'use client';
// src/components/portal/FloorLinks.tsx — THE FLOOR, FROM THE TEAM APP (design canvas "The floor's phones"). At a food
// business, someone signed in with their PIN opens My tables, Clear tables and the host stand from here: the same
// pages as the app, as themselves, on any phone (components/shared/PortalScope keeps them to these). Their job's own
// page comes first (lib/jobs).
import * as React from 'react';
import { jobDef } from '@/lib/jobs';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const PAGES = [
  { href: '/tables', label: 'My tables', line: 'Your tables, what’s at the pass, guests asking' },
  { href: '/clear', label: 'Clear tables', line: 'Which tables just left, and resetting them' },
  { href: '/host', label: 'Host stand', line: 'Who’s waiting, who’s booked, which tables are free' },
];

export function FloorLinks({ job }: { job?: string | null }) {
  const home = jobDef(job)?.home || null;
  const pages = [...PAGES].sort((a, b) => (a.href === home ? -1 : b.href === home ? 1 : 0));
  return (
    <section aria-labelledby="floor-links" className="space-y-2">
      <h2 id="floor-links" className="px-1 text-[13px] font-semibold" style={{ color: MUTED }}>The floor</h2>
      <div className="grid gap-2">
        {pages.map((p) => (
          <a key={p.href} href={p.href} className="flex min-h-[64px] items-center gap-3 rounded-2xl bg-[#fff] px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ border: `1px solid ${LINE}`, color: INK }}>
            <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">{p.label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{p.line}</span></span>
            <span aria-hidden className="text-[20px]" style={{ color: MUTED }}>›</span>
          </a>
        ))}
      </div>
    </section>
  );
}
