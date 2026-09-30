// src/lib/visit-sync.ts — keep the client's copies of a visit in step with the visit itself (server).
// The visit link reads appointmentCheckIns/{token} (and a per-business copy). Those used to be hand-written in 45 places;
// anything that moves a visit through the visit ticket calls this, and the (optional) functions trigger calls the same
// projection on every write — so the link can't drift from the desk.
import { visitProjection } from '@/lib/visit';

export async function syncVisitCopies(db: any, tenantId: string, appt: any, tenant?: any) {
  const token = appt?.checkInToken; if (!token) return;
  const t = tenant || (((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {});
  const proj = visitProjection(appt, t);
  await Promise.all([
    db.doc(`appointmentCheckIns/${token}`).set(proj, { merge: true }),
    db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).set(proj, { merge: true }),
  ]).catch((e: any) => console.error('[visit-sync]', e));
}
