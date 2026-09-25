'use client';
// src/app/learn/[tenantId]/[slug]/page.tsx — one course: curriculum, price, enrol.
import { use } from 'react';
import { Course } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string; slug: string }> }) { const { tenantId, slug } = use(params); return <Course tenantId={tenantId} slug={slug} />; }
