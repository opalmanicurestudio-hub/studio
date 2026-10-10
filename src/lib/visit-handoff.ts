// src/lib/visit-handoff.ts — THE LAST PROVIDER FINISHES A VISIT AND SENDS IT TO THE FRONT DESK. Done on the server so it
// works the same from the app and from a staff phone signed in with a PIN (the phone can't change other people's
// status or the stock count directly). In one go: the visit becomes ready to pay with the checkout details and the
// hand-off recorded, the check-in screen's copy follows, the formula and any amenities come off stock (with a stock
// correction for each), and everyone who worked on the visit is free again.
import { FieldValue } from 'firebase-admin/firestore';
import { handoffEntry } from '@/lib/handoff-log';
import type { RequestActor } from '@/lib/request-actor';

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = (v: any) => JSON.parse(JSON.stringify(v ?? null));

export async function finishVisit(db: any, tenantId: string, actor: RequestActor, b: any) {
  const T = `tenants/${tenantId}`; const aptId = String(b.appointmentId || '');
  if (!aptId) return { ok: false as const, error: 'Missing visit.' };
  const aRef = db.doc(`${T}/appointments/${aptId}`); const aSnap = await aRef.get();
  if (!aSnap.exists) return { ok: false as const, error: 'That visit no longer exists.' };
  const apt: any = { id: aSnap.id, ...aSnap.data() };
  const cs: any = clean(b.checkoutState || {});
  const overrides: Record<string, string> = cs.serviceStaffOverrides || {};
  const involved = new Set<string>([apt.staffId, ...(apt.assignedStaffIds || []), ...Object.values(overrides)].filter((x: any) => typeof x === 'string' && x));
  if (!actor.isManager && !involved.has(actor.staffId)) return { ok: false as const, error: 'Only someone working on this visit can finish it.' };
  if (['ready_for_checkout', 'completed', 'checked_out', 'paid'].includes(String(apt.status))) return { ok: true as const, already: true };

  const now = new Date().toISOString(); const batch = db.batch();
  const label = `${String(b.serviceName || apt.serviceName || 'Service')} for ${String(b.clientName || apt.clientName || 'client')}`;
  const formula: any[] = Array.isArray(cs.formula) ? cs.formula : [];
  const amenities: any[] = (Array.isArray(cs.refreshments) ? cs.refreshments : []).filter((r: any) => !r?.isAccountedFor);
  const ids = [...new Set([...formula, ...amenities].map((x: any) => String(x?.id || '')).filter(Boolean))];
  const inv = new Map<string, any>((await Promise.all(ids.map((id) => db.doc(`${T}/inventory/${id}`).get()))).filter((s: any) => s.exists).map((s: any) => [s.id, s.data() || {}]));
  const correction = (productId: string, change: number, unit: string, reason: string) => {
    const r = db.collection(`${T}/stockCorrections`).doc();
    batch.set(r, { id: r.id, productId, date: now, change, unit, reason, appointmentId: aptId, by: actor.staffId });
  };
  for (const item of formula) {
    const p = inv.get(String(item?.id)); const q = num(item?.quantity); if (!p || q <= 0) continue;
    const ref = db.doc(`${T}/inventory/${item.id}`); let unit = p.unit || 'units';
    if (p.costingMethod === 'uses') {
      unit = p.useUnit || 'uses'; let uses = num(p.partialContainerUses) - q, stock = num(p.totalStock); const per = num(p.estimatedUses) || 1;
      while (uses <= 0 && stock > 0) { stock -= 1; uses += per; }
      batch.update(ref, { totalStock: stock, partialContainerUses: uses });
    } else if (p.costingMethod === 'size' && p.size) {
      unit = p.unit || 'ml'; let size = num(p.partialContainerSize) - q, stock = num(p.totalStock); const per = num(p.size);
      while (size <= 0 && stock > 0) { stock -= 1; size += per; }
      batch.update(ref, { totalStock: stock, partialContainerSize: size });
    } else batch.update(ref, { totalStock: FieldValue.increment(-q) });
    correction(item.id, -q, unit, `Service Formula: ${label}`);
  }
  for (const a of amenities) {
    const p = inv.get(String(a?.id)); if (!p) continue;
    batch.update(db.doc(`${T}/inventory/${a.id}`), { totalStock: FieldValue.increment(-1) });
    correction(a.id, -1, p.unit || 'unit', `Manual Amenity: ${a.name || p.name || 'item'} during Review for ${b.clientName || apt.clientName || 'client'}`);
  }
  const note = typeof cs.reviewNotes === 'string' ? cs.reviewNotes.trim() : '';
  batch.update(aRef, {
    handoffs: FieldValue.arrayUnion(clean(handoffEntry(apt, cs))), status: 'ready_for_checkout', checkoutState: cs, actualEndTime: now,
    assignedStaffIds: [...involved], ...(note ? { serviceNotes: note, serviceNotesRecordedAt: now } : {}),
  });
  if (apt.checkInToken) batch.set(db.doc(`appointmentCheckIns/${apt.checkInToken}`), { status: 'ready_for_checkout', tenantId }, { merge: true });
  if (apt.checkInToken) batch.set(db.doc(`${T}/appointmentCheckIns/${apt.checkInToken}`), { status: 'ready_for_checkout', tenantId }, { merge: true });
  for (const sid of involved) {
    const s = await db.doc(`${T}/staff/${sid}`).get(); if (s.exists) batch.set(s.ref, { status: 'idle', currentAppointmentId: null }, { merge: true });
  }
  if (cs.saveAsCustomFormula && cs.customFormulaName && apt.clientId) {
    batch.set(db.doc(`${T}/clients/${apt.clientId}`), { customFormulas: FieldValue.arrayUnion(clean({ id: `f-${Date.now()}`, name: cs.customFormulaName, date: now, items: formula, notes: note || null })) }, { merge: true });
  }
  await batch.commit();
  return { ok: true as const };
}
