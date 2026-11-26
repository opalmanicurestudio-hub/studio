'use client';
// src/lib/public-business-client.ts — THE BUSINESS ON PUBLIC PAGES (lib/public-business, api/public/business). One
// request per business while a page is open (the booking page and its FAQ and gallery share it), tried again once if
// the first doesn't answer. Pages that stay open (check-in, the client portal) look again now and then (`follow`).
import { useEffect, useState } from 'react';
import type { PublicBusiness } from '@/lib/public-business';

const asked = new Map<string, Promise<PublicBusiness | null>>();

async function ask(tenantId: string, fresh = false): Promise<PublicBusiness | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(`/api/public/business?business=${encodeURIComponent(tenantId)}${fresh ? `&fresh=${Date.now()}` : ''}`, fresh ? { cache: 'no-store' } : undefined);
      if (r.status === 404) return null;
      const d = await r.json();
      if (d?.ok) return d.business as PublicBusiness;
    } catch { /* tried again below */ }
    if (i === 0) await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error('This page couldn’t load. Check the connection and try again.');
}

/** The business's public details, or null when there's no such business. `fresh` (the owner's own preview) skips what's
 *  kept, so a setting just saved shows at once. */
export function loadPublicBusiness(tenantId: string, o: { fresh?: boolean } = {}): Promise<PublicBusiness | null> {
  if (!tenantId) return Promise.resolve(null);
  const had = !o.fresh && asked.get(tenantId); if (had) return had;
  const p = ask(tenantId, !!o.fresh).catch((e) => { asked.delete(tenantId); throw e; });
  asked.set(tenantId, p);
  return p;
}

/** Looked at again: a page left open (the check-in screen, a client's portal) picks up a changed setting when it's
 *  looked at again after a while, and every few minutes while it's showing. */
const AGAIN_MS = 60000, EVERY_MS = 5 * 60000;

/** The same, for a component: `data` is undefined while loading, null when there's no such business. `follow`: a page
 *  that stays open (check-in, the client portal) asks again when it's looked at after a minute or more, and every few
 *  minutes while it's on screen, so a setting the business changes reaches it without a reload. */
export function usePublicBusiness(tenantId: string | null | undefined, o: { follow?: boolean } = {}): { data: PublicBusiness | null | undefined; isLoading: boolean; error: string } {
  const [data, setData] = useState<PublicBusiness | null | undefined>(undefined); const [error, setError] = useState('');
  useEffect(() => {
    let live = true; setData(undefined); setError('');
    if (!tenantId) { setData(null); return; }
    loadPublicBusiness(tenantId).then((b) => { if (live) setData(b); }).catch((e) => { if (live) { setData(null); setError(String(e?.message || e)); } });
    return () => { live = false; };
  }, [tenantId]);
  useEffect(() => {
    if (!o.follow || !tenantId || typeof document === 'undefined') return;
    let live = true; let last = Date.now();
    const again = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < AGAIN_MS) return;
      last = Date.now(); asked.delete(tenantId);
      // (A miss keeps what's showing: the page never goes blank because one look didn't answer.)
      loadPublicBusiness(tenantId).then((b) => { if (live && b) setData(b); }).catch(() => {});
    };
    document.addEventListener('visibilitychange', again); window.addEventListener('focus', again);
    const t = setInterval(again, EVERY_MS);
    return () => { live = false; document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); clearInterval(t); };
  }, [tenantId, o.follow]);
  return { data, isLoading: data === undefined, error };
}
