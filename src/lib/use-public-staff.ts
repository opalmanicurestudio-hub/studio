'use client';
// src/lib/use-public-staff.ts — public pages read the team's public cards (name, photo, title) through the server.
import * as React from 'react';
export interface PublicStaff { id: string; name: string; avatarUrl: string | null; title: string | null; bio: string | null }
export function usePublicStaff(tenantId?: string | null, staffId?: string | null): { one: PublicStaff | null; all: PublicStaff[] } {
  const [one, setOne] = React.useState<PublicStaff | null>(null); const [all, setAll] = React.useState<PublicStaff[]>([]);
  React.useEffect(() => { if (!tenantId) return; let off = false;
    fetch(`/api/public/staff?tenantId=${encodeURIComponent(tenantId)}${staffId ? `&staffId=${encodeURIComponent(staffId)}` : ''}`).then((r) => r.json()).then((d) => { if (off || !d?.ok) return; if (staffId) setOne(d.staff); else setAll(d.staff || []); }).catch(() => {});
    return () => { off = true; }; }, [tenantId, staffId]);
  return { one, all };
}
