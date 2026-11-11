'use client';
// src/components/shared/ToolGate.tsx — A PAGE OF A TOOL THAT ISN'T PART OF THE PLAN IS LOCKED, NOT JUST LEFT OUT OF THE
// MENU. A saved link or a bookmark to it shows what the tool does, what it costs, and where the owner adds it (Your
// ClarityFlow), instead of the page. The server refuses the tool's own new use too (lib/tool-lock), so this is the
// friendly half, not the only half. A page two tools share is open while either is on (lib/modules lockedModule).
// Tools that leave something owed to customers (event tickets, members, shop orders, renters) can still be opened by
// the owner or a manager to finish what's there (refunds, cancellations, orders already paid for), under a banner that
// says new sign-ups, sales and bookings are off.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenantOptional } from '@/context/TenantContext';
import { hrefModule, lockedModule, type ModuleId } from '@/lib/modules';
import { TOOLS } from '@/lib/module-catalog';
import { TOOL_PRICES } from '@/lib/billing-plans';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const LINK = 'inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
/** Tools whose pages hold what's owed to customers, and what that is. */
const SETTLE: Partial<Record<ModuleId, string>> = {
  classes_events: 'refunds for tickets already sold and guests already on a list',
  memberships: 'members who already joined, and canceling them',
  retail: 'shop orders already paid for, returns and refunds',
  booth_rental: 'renters, leases and rent already due',
};
const settleKey = (m: string) => `cf.settle.${m}`;
const opened = new Set<string>();   // the same, for this page load, where the browser keeps nothing (a private window)

export function ToolGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const ctx = useTenantOptional();
  const t: any = ctx?.selectedTenant || null;
  const locked = t ? lockedModule(t, pathname) : null;
  // Read as the page draws (no frame of the lock card for an owner who already chose to finish what's there).
  const [, redraw] = useState(0);
  const settling = !!locked && (opened.has(locked) || (() => { try { return typeof window !== 'undefined' && sessionStorage.getItem(settleKey(locked)) === '1'; } catch { return false; } })());
  // The business isn't known yet: a tool's page waits (so a locked one never flashes and starts loading).
  if (!t && hrefModule(pathname)) return <div className="min-h-[50dvh]" aria-busy="true" />;
  if (!locked) return <>{children}</>;
  const tool = TOOLS.find((x) => x.gates[0] === locked) || TOOLS.find((x) => x.gates.includes(locked)) || null;
  const price = tool ? TOOL_PRICES[tool.id] : undefined;
  const owner = ctx?.role === 'owner';
  const lead = owner || ctx?.role === 'admin' || ctx?.role === 'manager';
  const owed = lead ? SETTLE[locked] : undefined;
  const name = tool?.name || 'This tool';

  if (owed && settling) return (
    <>
      <div role="status" className="mx-4 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 sm:mx-6" style={{ background: AMBER_TINT, color: AMBER }}>
        <p className="min-w-0 flex-1 text-[14.5px] font-medium">{name} isn’t part of your plan. You can finish what’s already here ({owed}); new sign-ups, sales and bookings are off.</p>
        {owner && <Link href="/subscriptions" className={`${LINK} px-3 text-[14px]`} style={{ color: AMBER, textDecoration: 'underline' }}>Add it back</Link>}
      </div>
      {children}
    </>
  );

  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4 py-10" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <section aria-labelledby="locked-title" className="w-full max-w-lg space-y-5 rounded-3xl border p-6 sm:p-8" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="space-y-2">
          <p className="text-[14px] font-medium" style={{ color: MUTED }}>Not part of your plan right now</p>
          <h1 id="locked-title" className="text-[26px] font-semibold tracking-tight">{name}</h1>
          {tool && <p className="text-[16px] leading-relaxed" style={{ color: '#3d4046' }}>{tool.line}</p>}
        </div>
        {tool && <ul className="space-y-2">
          {tool.includes.map((x) => (
            <li key={x} className="flex items-start gap-3 text-[15px]"><span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: INK }} />{x}</li>
          ))}
        </ul>}
        {price && <p className="text-[15px]"><b className="font-semibold">${price.amount}</b><span style={{ color: MUTED }}> a month, added to your plan. Turn it off any time.</span></p>}
        <p className="text-[14px]" style={{ color: MUTED }}>Anything already made with it is kept, and comes back when it’s turned on.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {owner
            ? <Link href="/subscriptions" className={`${LINK} flex-1`} style={{ background: INK, color: '#fff' }}>Add it in Your ClarityFlow</Link>
            : <p className="w-full text-[15px]">Only the owner can add it, in Your ClarityFlow.</p>}
          <Link href="/dashboard" className={`${LINK} border`} style={{ borderColor: LINE, color: INK }}>Back to the dashboard</Link>
        </div>
        {owed && <div className="space-y-2 border-t pt-4" style={{ borderColor: LINE }}>
          <p className="text-[14px]" style={{ color: MUTED }}>Something still to finish? You can open it to handle {owed}. New sign-ups, sales and bookings stay off.</p>
          <button type="button" onClick={() => { opened.add(locked); try { sessionStorage.setItem(settleKey(locked), '1'); } catch { /* private window */ } redraw((n) => n + 1); }}
            className={`${LINK} w-full border`} style={{ borderColor: LINE, color: INK, background: '#fff' }}>Open it to finish what’s there</button>
        </div>}
      </section>
    </div>
  );
}
