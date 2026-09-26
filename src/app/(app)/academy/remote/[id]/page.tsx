'use client';
// src/app/(app)/academy/remote/[id]/page.tsx — the phone remote for Present mode (signed-in staff).
import { useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { PresentRemote } from '@/components/academy/PresentMode';

export default function RemotePage() {
  const { id } = useParams<{ id: string }>();
  const { selectedTenant } = useTenant();
  const tenantId = String(selectedTenant?.id || '');
  if (!tenantId) return <p className="p-6 text-center text-muted-foreground">Sign in to ClarityFlow to use the remote.</p>;
  return <PresentRemote tenantId={tenantId} id={String(id)} />;
}
