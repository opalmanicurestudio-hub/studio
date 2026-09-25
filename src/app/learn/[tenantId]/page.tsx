'use client';
// src/app/learn/[tenantId]/page.tsx — an academy's course catalog.
import { use } from 'react';
import { Catalog } from '@/components/academy/Learn';
export default function Page({ params }: { params: Promise<{ tenantId: string }> }) { const { tenantId } = use(params); return <Catalog tenantId={tenantId} />; }
