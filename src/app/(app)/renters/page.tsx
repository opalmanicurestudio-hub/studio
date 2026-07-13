'use client';

/**
 * v49 — DECOMMISSIONED. The standalone Renters page consolidated into the
 * Booths page hub (booths, applicants, renters, and leases in one place).
 * This redirects rather than 404s so old notification links ("booth
 * application" notifications pointed here) keep working.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DecommissionedRentersPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/booths'); }, [router]);
  return null;
}
