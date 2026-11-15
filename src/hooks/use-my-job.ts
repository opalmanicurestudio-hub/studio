'use client';
// src/hooks/use-my-job.ts — THE SIGNED-IN PERSON'S JOB at a food business (lib/jobs), from their own team record, with
// where they open and the station they work at. The owner has no job here: they see everything. Null until it's read,
// and for anyone without a job (or at a business that isn't food).
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { doc } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useTenant } from '@/context/TenantContext';
import { homeOf, jobOfStaff, keptStation, type JobDef } from '@/lib/jobs';
import { isFoodBusiness } from '@/lib/food-setup';
import { stationsOf } from '@/lib/table-service';

export type MyJob = { job: JobDef; station: string | null; home: string | null };

export function useMyJob(): { myJob: MyJob | null; loading: boolean } {
  const { selectedTenant, role, staffId } = useTenant();
  const { firestore } = useFirebase();
  const tenantId = selectedTenant?.id || null;
  const asks = !!tenantId && !!staffId && role !== 'owner' && isFoodBusiness(selectedTenant);
  const ref = useMemoFirebase(() => (asks && firestore ? doc(firestore, 'tenants', tenantId!, 'staff', staffId!) : null), [asks, firestore, tenantId, staffId]);
  const { data, isLoading } = useDoc<any>(ref);
  if (!asks) return { myJob: null, loading: false };
  const job = jobOfStaff(data);
  if (!job) return { myJob: null, loading: isLoading };
  const station = keptStation(data?.station, stationsOf(selectedTenant));
  return { myJob: { job, station, home: homeOf(job, tenantId!, station) }, loading: isLoading };
}

const MOVED = 'cf.moved';
const ss = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return '1'; } }, set: (k: string) => { try { sessionStorage.setItem(k, '1'); } catch { /* */ } } };

/** Kept by the menu: once someone has gone from one page to another, the dashboard is somewhere they chose to go. */
export function useNoteMoves(pathname: string | null) {
  const first = useRef<string | null>(null);
  useEffect(() => { if (!pathname) return; if (first.current === null) first.current = pathname; else if (pathname !== first.current) ss.set(MOVED); }, [pathname]);
}

/** On the dashboard: someone with a job who has just signed in goes to the screen they work from, once a visit. A
 *  dashboard they went to themselves stays put. */
export function useOpenJobHome() {
  const { myJob } = useMyJob();
  const { selectedTenant } = useTenant();
  const router = useRouter();
  const home = myJob?.home || null; const tenantId = selectedTenant?.id || null;
  useEffect(() => {
    if (!home || !tenantId || home === '/dashboard') return;
    const k = `cf.home.${tenantId}`;
    if (ss.get(k) || ss.get(MOVED)) return;
    ss.set(k); router.replace(home);
  }, [home, tenantId, router]);
}
