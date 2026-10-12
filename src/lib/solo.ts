// src/lib/solo.ts — IS THIS A ONE-PERSON BUSINESS? (client and server safe)
// One provider (the owner, usually) who is also the front desk. Flows that hand work between a provider and a desk
// collapse into one queue for them: no "send to the desk", no second copy of the same alert, no "another provider".
// Renters don't count — they run their own books inside the studio.
export const providersOf = (staff: any[]) => (staff || []).filter((m: any) => m && m.isActive !== false && m.status !== 'inactive' && m.status !== 'archived' && m.role !== 'renter' && !m.isRenter);
export const isSoloTeam = (staff: any[]) => providersOf(staff).length <= 1;

/** Server: read the team once. */
export async function soloBusiness(db: any, tenantId: string): Promise<boolean> {
  try { const snap = await db.collection(`tenants/${tenantId}/staff`).get(); return isSoloTeam(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))); } catch { return false; }
}
