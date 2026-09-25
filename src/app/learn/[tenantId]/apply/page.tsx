'use client';
// src/app/learn/[tenantId]/apply/page.tsx — apply to a school's program.
import { Suspense, use } from 'react';
import { Apply } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string }> }) { const { tenantId } = use(params); return <Suspense fallback={null}><Apply tenantId={tenantId} /></Suspense>; }
