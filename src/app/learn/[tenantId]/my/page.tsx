'use client';
// src/app/learn/[tenantId]/my/page.tsx — a student's courses (and email sign-in).
import { Suspense, use } from 'react';
import { MyCourses } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string }> }) { const { tenantId } = use(params); return <Suspense fallback={null}><MyCourses tenantId={tenantId} /></Suspense>; }
