// src/lib/part-handoff.ts — ONE PERSON FINISHES THEIR PART OF A VISIT and hands it on (to the next provider, or to the
// desk when every part is done). Used by the planner, the desk and the staff portal, so all three record the same
// thing: the hand-off in the visit's log, the review note kept on the visit, who is busy or free afterwards, and only
// when every part is done does the visit go to "ready to pay". (The last provider's finish goes through the server:
// lib/visit-handoff finishVisit.)
import { doc, arrayUnion, collection } from 'firebase/firestore';
import { handoffEntry } from '@/lib/handoff-log';

const clean = (x: any) => JSON.parse(JSON.stringify(x ?? null));

/** Adds the writes to `batch`. Returns whether the whole visit is now done, and who is up next. */
export function writePartHandoff(batch: any, firestore: any, tenantId: string, apt: any, checkoutState: any, opts: { freeStatus?: 'idle' | 'available' } = {}) {
  const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  const addOns: string[] = Array.isArray(checkoutState?.addOnServices) ? checkoutState.addOnServices.map((a: any) => a?.id).filter(Boolean) : (apt.addOnIds || []);
  const partIds: string[] = [apt.serviceId, ...addOns].filter(Boolean);
  const done: string[] = checkoutState?.completedServiceIds || []; const overrides: Record<string, string> = checkoutState?.serviceStaffOverrides || {};
  const allDone = partIds.every((id) => done.includes(id));
  const note = typeof checkoutState?.reviewNotes === 'string' ? checkoutState.reviewNotes.trim() : '';
  const notePatch = note ? { serviceNotes: note, serviceNotesRecordedAt: now } : {};
  const providerOf = (pid: string) => overrides[pid] || (pid === apt.serviceId ? apt.staffId : null);
  const involved = new Set<string>([apt.staffId, ...Object.values(overrides)].filter((x): x is string => typeof x === 'string' && !!x));
  const free = opts.freeStatus || 'idle';
  if (allDone) {
    batch.update(doc(firestore, `${T}/appointments`, apt.id), { ...clean({ status: 'ready_for_checkout', checkoutState, actualEndTime: now, ...notePatch }), handoffs: arrayUnion(clean(handoffEntry(apt, checkoutState))) });
    if (apt.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout', tenantId }, { merge: true });
    involved.forEach((sid) => batch.set(doc(firestore, `${T}/staff`, sid), { status: free }, { merge: true }));
    return { allDone, nextStaffId: null as string | null };
  }
  batch.update(doc(firestore, `${T}/appointments`, apt.id), { ...clean({ checkoutState, ...notePatch }), handoffs: arrayUnion(clean(handoffEntry(apt, checkoutState))) });
  involved.forEach((sid) => { const left = partIds.some((pid) => !done.includes(pid) && providerOf(pid) === sid); if (!left) batch.set(doc(firestore, `${T}/staff`, sid), { status: free }, { merge: true }); });
  const nextPart = partIds.find((id) => !done.includes(id) && !(checkoutState?.concurrentServiceIds || []).includes(id));
  const nextStaffId = nextPart ? providerOf(nextPart) : null;
  if (nextStaffId) {
    batch.set(doc(firestore, `${T}/staff`, nextStaffId), { status: 'busy' }, { merge: true });
    // Tell them it's their turn, with the note that was left for them.
    const partName = (Array.isArray(checkoutState?.addOnServices) ? checkoutState.addOnServices.find((x: any) => x?.id === nextPart)?.name : null) || (nextPart === apt.serviceId ? apt.serviceName : null) || 'the next part';
    const nRef = doc(collection(firestore, `${T}/notifications`));
    batch.set(nRef, clean({ id: nRef.id, userId: nextStaffId, type: 'handoff', priority: 'high', message: `Your turn: ${apt.clientName || 'your client'}, ${String(partName).toLowerCase()}.${note ? ` Note: ${note}` : ''}`, link: `/planner?visit=${apt.id}`, appointmentId: apt.id, createdAt: now, read: false }));
  }
  return { allDone, nextStaffId };
}
