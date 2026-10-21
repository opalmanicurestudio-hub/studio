'use client';
// src/hooks/use-history-stats.ts — the all-time numbers (lib/history-stats) for screens that show them. Asked of the server
// once and shared while the app is open (refreshed after ten minutes), so moving between Clients, Services and Discounts
// costs nothing extra.
import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import type { ClientHist, ServiceHist } from '@/lib/history-stats';

export interface HistoryStats { computedAt: number; clients: Record<string, ClientHist>; services: Record<string, ServiceHist>; money: boolean }
const cache = new Map<string, { at: number; data?: HistoryStats; wait?: Promise<HistoryStats | null> }>();
const KEEP_MS = 10 * 60 * 1000;

async function load(tenantId: string, refresh = false): Promise<HistoryStats | null> {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  const r = await fetch('/api/stats/history', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, refresh }) }).catch(() => null);
  const j: any = r ? await r.json().catch(() => null) : null;
  return j?.ok ? { computedAt: Number(j.computedAt) || 0, clients: j.clients || {}, services: j.services || {}, money: !!j.money } : null;
}

export function useHistoryStats(enabled = true): { stats: HistoryStats | null; isLoading: boolean; refresh: () => void } {
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const [stats, setStats] = useState<HistoryStats | null>(() => (tenantId ? cache.get(tenantId)?.data || null : null));
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !tenantId) return;
    let live = true;
    const c = cache.get(tenantId);
    if (c?.data && Date.now() - c.at < KEEP_MS && tick === 0) { setStats(c.data); return; }
    const wait = c?.wait && tick === 0 ? c.wait : load(tenantId, tick > 0);
    cache.set(tenantId, { at: c?.at || 0, data: c?.data, wait });
    setLoading(true);
    void wait.then((d) => { if (d) cache.set(tenantId, { at: Date.now(), data: d }); else cache.delete(tenantId); if (live) { setStats(d || c?.data || null); setLoading(false); } });
    return () => { live = false; };
  }, [enabled, tenantId, tick]);
  return { stats, isLoading: loading && !stats, refresh: () => setTick((t) => t + 1) };
}
