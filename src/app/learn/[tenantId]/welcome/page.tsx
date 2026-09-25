'use client';
// src/app/learn/[tenantId]/welcome/page.tsx — after paying for a course.
import { Suspense, use } from 'react';
import { Welcome } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string }> }) { const { tenantId } = use(params); return <Suspense fallback={null}><Welcome tenantId={tenantId} /></Suspense>; }
