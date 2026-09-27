// src/app/school/[tenantId]/data.ts — one load per request, shared by the
// layout and the page (React cache de-duplicates it).
import { cache } from 'react';
import { loadSchoolSite } from '@/lib/school-site';
export const getSite = cache(async (tenantId: string) => loadSchoolSite(tenantId));
