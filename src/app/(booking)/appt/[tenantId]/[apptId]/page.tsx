'use client';
// src/app/(booking)/appt/[tenantId]/[apptId]/page.tsx — "MANAGE MY APPOINTMENT", from messages sent before every button
// pointed at the visit's own link. It now opens that link (components/visit/OldLinkForward), which changes, cancels,
// says "running late" and adds the visit to a calendar, in the business's look. The ?k= key in the old link is checked
// by the server first.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { OldLinkForward } from '@/components/visit/OldLinkForward';

export default function ApptManagePage() {
  const p = useParams() as { tenantId: string; apptId: string }; const q = useSearchParams();
  return <OldLinkForward kind="manage" tenantId={String(p?.tenantId || '')} apptId={String(p?.apptId || '')} k={String(q?.get('k') || '')} />;
}
