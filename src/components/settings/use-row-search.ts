'use client';
// src/components/settings/use-row-search.ts — single-setting results for a Settings search box. The list of every
// setting (lib/settings-search) loads the first time someone types, so it isn't part of every page of the app.
import * as React from 'react';
import type { RowHit } from '@/lib/settings-search';

type Mod = typeof import('@/lib/settings-search');
let loading: Promise<Mod> | null = null;
/** Loads the list once; a failed load (a dropped connection) is tried again next time rather than kept. */
export const loadRowSearch = () => (loading ||= import('@/lib/settings-search').catch((e) => { loading = null; throw e; }));

/** hits: the settings that match; loading: the list is still on its way, so "nothing matches" isn't true yet. */
export function useRowSearch(tenant: any, q: string, limit: number): { hits: RowHit[]; loading: boolean } {
  const [mod, setMod] = React.useState<Mod | null>(null);
  const [failed, setFailed] = React.useState(0);
  const wanted = q.trim().length >= 2;
  React.useEffect(() => {
    if (!wanted || mod) return;
    let alive = true;
    loadRowSearch().then((m) => { if (alive) setMod(m); }, () => { if (alive) setFailed((n) => n + 1); });
    return () => { alive = false; };
  }, [wanted, mod, q]);
  const hits = React.useMemo(() => (mod && tenant && wanted ? mod.searchRows(tenant, q, limit) : []), [mod, tenant, q, limit, wanted]);
  return { hits, loading: wanted && !mod && failed === 0 };
}

/** Tells the page's row finder to point at a setting again (a result for the page already open). */
export function announceFind(label: string) {
  try { window.dispatchEvent(new CustomEvent('cf-find', { detail: label })); } catch { /* nothing to point at */ }
}
