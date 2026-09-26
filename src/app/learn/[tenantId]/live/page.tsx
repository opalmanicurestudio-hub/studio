'use client';
// src/app/learn/[tenantId]/live/page.tsx — join a live class with a code (or by scanning the classroom QR).
import { Suspense, use } from 'react';
import { LiveJoin } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string }> }) { const { tenantId } = use(params); return <Suspense fallback={null}><LiveJoin tenantId={tenantId} /></Suspense>; }
