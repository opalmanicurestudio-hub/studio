'use client';
// src/app/learn/[tenantId]/[slug]/[lessonId]/page.tsx — the lesson player.
import { use } from 'react';
import { Lesson } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string; slug: string; lessonId: string }> }) { const p = use(params); return <Lesson tenantId={p.tenantId} slug={p.slug} lessonId={p.lessonId} />; }
