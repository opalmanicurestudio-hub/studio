'use client';
// src/hooks/use-clients.ts — CLIENTS ONE AT A TIME, A FEW AT A TIME, OR BY SEARCH, rather than every client the business
// has. Every record goes through the same view as the shared list (renters' own clients hidden, contact privacy
// applied), so a screen can't tell the difference.
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { matchesSearch, searchTermKey } from '@/lib/client-search';
import type { Client } from '@/lib/data';

const NONE: any[] = [];

function useTenantDb() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const inv: any = useInventory();
  return { firestore, tenantId: selectedTenant?.id as string | undefined, view: inv._clientView as (c: any) => any };
}

/** One client, live. */
export function useClient(id: string | null | undefined): { client: Client | null; isLoading: boolean } {
  const { firestore, tenantId, view } = useTenantDb();
  const ref = useMemoFirebase(() => (firestore && tenantId && id ? doc(firestore, 'tenants', tenantId, 'clients', String(id)) : null), [firestore, tenantId, id]);
  const r = useDoc<any>(ref);
  const client = useMemo(() => (r.data ? view({ ...r.data, id: r.data.id || id }) : null), [r.data, view, id]);
  return { client, isLoading: !!ref && r.isLoading };
}

/** A handful of clients by id (the people on today's schedule, in a queue, on a list), live. */
export function useClientsByIds(ids: (string | null | undefined)[]): { clients: Client[]; byId: Map<string, Client>; isLoading: boolean } {
  const { firestore, tenantId, view } = useTenantDb();
  const key = [...new Set(ids.filter((x): x is string => !!x && !String(x).includes('/')))].sort().join(',');
  const [state, setState] = useState<{ key: string; list: any[] }>({ key: '', list: NONE });
  useEffect(() => {
    if (!firestore || !tenantId || !key) { setState({ key, list: NONE }); return; }
    const list = key.split(','); const parts: Record<number, any[]> = {}; let answered = 0; const chunks = Math.ceil(list.length / 30);
    const publish = () => { if (answered >= chunks) setState({ key, list: Object.values(parts).flat() }); };
    const unsubs = [] as (() => void)[];
    for (let i = 0; i < list.length; i += 30) {
      const n = i; let first = true;
      unsubs.push(onSnapshot(query(collection(firestore, 'tenants', tenantId, 'clients'), where(documentId(), 'in', list.slice(i, i + 30))),
        (s) => { parts[n] = s.docs.map((d) => ({ ...(d.data() as any), id: d.id })); if (first) { first = false; answered++; } publish(); },
        () => { parts[n] = []; if (first) { first = false; answered++; } publish(); }));
    }
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId, key]);
  const clients = useMemo(() => (state.key === key ? state.list.map(view).filter(Boolean) : NONE), [state, key, view]);
  const byId = useMemo(() => new Map<string, Client>(clients.map((c: any) => [c.id, c])), [clients]);
  return { clients, byId, isLoading: !!key && state.key !== key };
}

/**
 * Clients matching what was typed: start of a first or last name, of an email, or digits of a phone number
 * (lib/client-search). Debounce the term before passing it in. Up to `max` results, best first by name.
 */
export function useClientSearch(term: string, max = 25): { clients: Client[]; isLoading: boolean } {
  const { firestore, tenantId, view } = useTenantDb();
  const k = searchTermKey(term);
  const q = useMemoFirebase(() => (firestore && tenantId && k ? query(collection(firestore, 'tenants', tenantId, 'clients'), where('searchKeys', 'array-contains', k), limit(Math.max(max * 3, 60))) : null), [firestore, tenantId, k, max]);
  const r = useCollection<any>(q);
  const clients = useMemo(() => {
    if (!r.data) return NONE;
    return r.data.map(view).filter((c: any) => c && matchesSearch(c, term))   // matched on what this person may see
      .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''))).slice(0, max);
  }, [r.data, view, term, max]);
  return { clients, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** A typed value that settles once typing pauses. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Clients who owe the business money (a balance above zero), live — usually a short list. */
export function useClientsOwing(): { clients: Client[]; isLoading: boolean } {
  const { firestore, tenantId, view } = useTenantDb();
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'clients'), where('outstandingBalance', '>', 0)) : null), [firestore, tenantId]);
  const r = useCollection<any>(q);
  const clients = useMemo(() => (r.data ? r.data.map(view).filter(Boolean) : NONE), [r.data, view]);
  return { clients, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** The business's biggest spenders (lifetime value), for a picker before anything is typed. */
export function useTopClients(n = 6, enabled = true): { clients: Client[]; isLoading: boolean } {
  const { firestore, tenantId, view } = useTenantDb();
  const q = useMemoFirebase(() => (enabled && firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'clients'), orderBy('lifetimeValue', 'desc'), limit(n + 10)) : null), [enabled, firestore, tenantId, n]);
  const r = useCollection<any>(q);
  const clients = useMemo(() => (r.data ? r.data.map(view).filter(Boolean).slice(0, n) : NONE), [r.data, view, n]);
  return { clients, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** Clients holding store credit (the business owes them), live. */
export function useClientsWithCredit(): { clients: Client[]; isLoading: boolean } {
  const { firestore, tenantId, view } = useTenantDb();
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'clients'), where('totalStoreCredit', '>', 0)) : null), [firestore, tenantId]);
  const r = useCollection<any>(q);
  const clients = useMemo(() => (r.data ? r.data.map(view).filter(Boolean) : NONE), [r.data, view]);
  return { clients, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/**
 * Existing clients with exactly this phone number or email, for a few people at once (is this walk-in already a
 * client?). Read once per number or email. Returns a map from what was looked up to the clients found.
 */
export function useClientLookups(values: (string | null | undefined)[]): Map<string, Client[]> {
  const { firestore, tenantId, view } = useTenantDb();
  const keys = [...new Set(values.map((v) => (v ? searchTermKey(String(v)) : null)).filter((k): k is string => !!k && (/^\d{10}$/.test(k) || k.includes('@'))))].sort();
  const key = keys.join('|');
  const [found, setFound] = useState<Record<string, any[]>>({});
  useEffect(() => {
    if (!firestore || !tenantId || !key) return;
    let live = true;
    const todo = key.split('|').filter((k) => !(k in found));
    void Promise.all(todo.map(async (k) => {
      try { const s = await getDocs(query(collection(firestore, 'tenants', tenantId, 'clients'), where('searchKeys', 'array-contains', k), limit(5))); return [k, s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))] as const; }
      catch { return [k, []] as const; }
    })).then((pairs) => { if (live && pairs.length) setFound((f) => ({ ...f, ...Object.fromEntries(pairs) })); });
    return () => { live = false; };
  }, [firestore, tenantId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const m = new Map<string, Client[]>();
    for (const v of values) { if (!v) continue; const k = searchTermKey(String(v)); if (k && found[k]) m.set(String(v), found[k].map(view).filter(Boolean)); }
    return m;
  }, [found, view, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
