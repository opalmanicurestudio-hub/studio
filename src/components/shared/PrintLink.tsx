'use client';
// src/components/shared/PrintLink.tsx — OPENS A PRINTABLE PAGE (receipt, statement, renter document, interruption
// packet) in a new tab. The page needs a short-lived signed link (lib/print-link), so the tab opens first (browsers
// only allow a new tab straight from a tap) and then goes to the link /api/print-link hands back for this person.
// In the renter portal, pass the portal session as `token`; in the app, the sign-in travels with the request.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export type PrintParams = Record<string, string | number | null | undefined>;

export async function openPrint(path: string, params: PrintParams, token?: string): Promise<void> {
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    if (tab) {
      try { tab.opener = null; } catch { /* some browsers don't allow it; the page is ours either way */ }
      tab.document.title = 'Opening…';
      tab.document.body.innerHTML = '<p style="font-family:system-ui,sans-serif;color:#6d7075;padding:32px 20px;font-size:15px">Opening…</p>';
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (v != null && String(v) !== '') clean[k] = String(v);
    const r = await fetch('/api/print-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? {} : await staffAuthHeader()) },
      body: JSON.stringify({ tenantId: clean.tenantId, path, params: clean, ...(token ? { token } : {}) }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j?.url) throw new Error(j?.error || 'That page didn’t open. Try again.');
    if (tab) { if (!tab.closed) tab.location.replace(j.url); return; }   // closed while it loaded: they changed their mind
    window.location.assign(j.url);   // no new tab allowed here (some in-app browsers): open it in this one
  } catch (e) {
    try { tab?.close(); } catch { /* already gone */ }
    throw e;
  }
}

/** A control that opens a printable page, styled by the className it's given. */
export function PrintLink({ path, params, token, className, title, children }: {
  path: string; params: PrintParams; token?: string; className?: string; title?: string; children: React.ReactNode;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  return (
    <button type="button" title={title} aria-busy={busy || undefined} className={cn('text-left', className)}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation(); if (busy) return;
        setBusy(true);
        openPrint(path, params, token)
          .catch((err: any) => toast({ title: 'Didn’t open', description: String(err?.message || 'Try again.') }))
          .finally(() => setBusy(false));
      }}>
      {children}
    </button>
  );
}
