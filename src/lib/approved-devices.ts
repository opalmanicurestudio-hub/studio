// src/lib/approved-devices.ts
//
// "Student records only on approved devices" — NC 21 NCAC 14T .0502(l):
// "Personal devices may not be used to access student records." When the
// school switches this on, record screens (student file, admissions,
// reports, attendance, transcripts) answer only requests from a device the
// owner has approved. The owner can always approve the device in hand, so
// nobody is locked out.
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function deviceAllowed(tenantId: string, req: NextRequest): Promise<{ ok: boolean; error?: string }> {
  const db = getAdminDb();
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  if (!t.academy?.approvedDevicesOnly) return { ok: true };
  const id = String(req.headers.get('x-cf-device') || '').slice(0, 80);
  if (id) { const d = ((await db.doc(`tenants/${tenantId}/approvedDevices/${id}`).get()).data() as any) || null; if (d?.status === 'approved') return { ok: true }; }
  return { ok: false, error: 'This device isn’t approved for student records. Ask the owner to approve it in Academy → Settings.' };
}
