'use client';
// src/app/cancel/[tenantId]/[appointmentId]/page.tsx — A CANCEL LINK from a confirmation (a renter's, say). Its ?k= key is
// the visit's own link key, so it opens the visit link on Cancel (components/visit/OldLinkForward): the same cancel as
// everywhere else, which says what happens to the money before anyone cancels, with keeping the booking the easy button.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { OldLinkForward } from '@/components/visit/OldLinkForward';

export default function SelfCancelPage() {
  const p = useParams() as { tenantId: string; appointmentId: string }; const q = useSearchParams();
  return <OldLinkForward kind="cancel" tenantId={String(p?.tenantId || '')} apptId={String(p?.appointmentId || '')} k={String(q?.get('k') || '')} />;
}
