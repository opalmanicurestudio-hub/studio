'use client';
// src/app/learn/[tenantId]/application/[token]/page.tsx — an applicant's private application.
import { Suspense, use } from 'react';
import { Application } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string; token: string }> }) { const p = use(params); return <Suspense fallback={null}><Application tenantId={p.tenantId} appToken={p.token} /></Suspense>; }
