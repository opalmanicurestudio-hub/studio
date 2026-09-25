'use client';
// src/app/learn/[tenantId]/attend/page.tsx — clock in / out (opened by scanning the academy screen).
import { Suspense, use } from 'react';
import { Attend } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string }> }) { const { tenantId } = use(params); return <Suspense fallback={null}><Attend tenantId={tenantId} /></Suspense>; }
