// src/lib/renter-docs.ts — PART 6: A RENTER'S OWN DOCUMENTS (design canvas row 26, "my own documents"). A renter runs
// their own business inside the studio, so their SOPs and their clients' aftercare are theirs: written in their portal,
// kept in tenants/{t}/renterDocs (server only — the studio's app can't read them), and sent under their business name.
//   SOPs       — their own routines and checklists, for themselves.
//   Aftercare  — linked to their services (or "every other service"); sent to their clients after a visit, with a
//                check-in a few days later (lib/renter-aftercare). Their choices live in renterSettings/{staffId}.aftercare.
import { renterStaff } from '@/lib/renter-session';
import { aftercareSettingsOf, CHECKIN_CHOICES, type AftercareSettings } from '@/lib/aftercare';

const T = (t: string) => `tenants/${t}`;
export const RENTER_BLOCKS = ['text', 'step', 'checklist', 'tip', 'warning'] as const;
export type RenterDocKind = 'sop' | 'aftercare';
const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const rid = () => Math.random().toString(36).slice(2, 10);

/** Only the blocks the portal's editor makes; anything else is dropped. */
export function cleanBlocks(raw: any): Array<{ id: string; type: string; heading: string; body: string }> {
  return (Array.isArray(raw) ? raw : []).slice(0, 40).map((b: any) => ({ id: s(b?.id, 40) || rid(), type: (RENTER_BLOCKS as readonly string[]).includes(b?.type) ? b.type : 'text', heading: s(b?.heading, 120), body: s(b?.body, 4000) }))
    .filter((b) => b.heading || b.body);
}

/** The aftercare for one of their visits: one linked to the service, else their "every other service" one. */
export function renterAftercareFor(docs: any[], serviceId: string | null | undefined): any | null {
  const live = (docs || []).filter((d) => d && d.status === 'published' && d.category === 'aftercare');
  const sid = String(serviceId || ''); const newest = (xs: any[]) => [...xs].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))[0] || null;
  return newest(sid ? live.filter((d) => Array.isArray(d.serviceIds) && d.serviceIds.includes(sid)) : []) || newest(live.filter((d) => d.aftercareDefault === true));
}

export async function renterDocsOf(db: any, tenantId: string, staffId: string) {
  return (await db.collection(`${T(tenantId)}/renterDocs`).where('staffId', '==', staffId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
}

export function renterCareSettingsOf(raw: any): AftercareSettings { return aftercareSettingsOf({ aftercare: raw || {} }); }
export async function renterCareSettings(db: any, tenantId: string, staffId: string): Promise<AftercareSettings> {
  const snap = await db.doc(`${T(tenantId)}/renterSettings/${staffId}`).get(); return renterCareSettingsOf(snap.exists ? (snap.data() || {}).aftercare : null);
}

/** Their library, their services (to link aftercare to), and their aftercare choices. */
export async function renterLibrary(db: any, tenantId: string, renterId: string) {
  const me = await renterStaff(db, tenantId, renterId); if (!me) return { ok: false as const, error: 'Your provider profile isn’t set up yet — ask the studio.' };
  const [docs, svc, care] = await Promise.all([renterDocsOf(db, tenantId, me.id), db.collection(`${T(tenantId)}/renterServices`).where('staffId', '==', me.id).get().catch(() => ({ docs: [] })), renterCareSettings(db, tenantId, me.id)]);
  const services = svc.docs.filter((d: any) => (d.data() || {}).isActive !== false).map((d: any) => ({ id: d.id, name: String((d.data() || {}).name || 'Service') }));
  docs.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { ok: true as const, docs, services, care, staffId: me.id };
}

/** Save a draft, or publish (a published document that changed becomes the next version). */
export async function saveRenterDoc(db: any, tenantId: string, renterId: string, x: any) {
  const me = await renterStaff(db, tenantId, renterId); if (!me) return { ok: false, error: 'Your provider profile isn’t set up yet — ask the studio.' };
  const title = s(x.title, 120); if (!title) return { ok: false, error: 'Give it a title.' };
  const sections = cleanBlocks(x.sections); if (!sections.length) return { ok: false, error: 'Add at least one block.' };
  const category: RenterDocKind = x.category === 'aftercare' ? 'aftercare' : 'sop';
  const id = s(x.id, 60) || db.collection(`${T(tenantId)}/renterDocs`).doc().id; const ref = db.doc(`${T(tenantId)}/renterDocs/${id}`);
  const prev: any = (await ref.get()).data() || null; if (prev && prev.staffId !== me.id) return { ok: false, error: 'That isn’t your document.' };
  const now = new Date().toISOString(); const publish = x.publish === true;
  const days = Number(x.checkInDays); const checkInDays = x.checkInDays === null || x.checkInDays === '' || x.checkInDays === undefined ? null : (CHECKIN_CHOICES as readonly number[]).includes(days) ? days : null;
  const body: any = { id, staffId: me.id, renterId, title, category, sections, updatedAt: now,
    ...(category === 'aftercare' ? { serviceIds: (Array.isArray(x.serviceIds) ? x.serviceIds : []).map((v: any) => s(v, 120)).filter(Boolean).slice(0, 40), aftercareDefault: x.aftercareDefault === true, checkInDays } : { serviceIds: [], aftercareDefault: false, checkInDays: null }) };
  // A live document saved without publishing keeps the changes aside (draft) — clients go on getting the live copy.
  if (prev?.status === 'published' && !publish) { await ref.set({ draft: { title, sections, ...(category === 'aftercare' ? { serviceIds: body.serviceIds, aftercareDefault: body.aftercareDefault, checkInDays: body.checkInDays } : {}), savedAt: now }, updatedAt: now }, { merge: true }); return { ok: true, id, version: Number(prev.version || 1), draft: true }; }
  const changed = !prev || JSON.stringify([prev.title, prev.sections]) !== JSON.stringify([title, sections]);
  const version = !prev ? 1 : prev.status === 'published' && publish && changed ? Number(prev.version || 1) + 1 : Number(prev.version || 1);
  await ref.set({ ...body, draft: null, version, status: publish ? 'published' : 'draft', ...(publish ? { publishedAt: prev?.status === 'published' && !changed ? prev.publishedAt : now } : {}), createdAt: prev?.createdAt || now }, { merge: true });
  return { ok: true, id, version };
}

export async function removeRenterDoc(db: any, tenantId: string, renterId: string, id: string) {
  const me = await renterStaff(db, tenantId, renterId); if (!me) return { ok: false, error: 'Not found.' };
  const ref = db.doc(`${T(tenantId)}/renterDocs/${s(id, 60)}`); const d: any = (await ref.get()).data(); if (!d || d.staffId !== me.id) return { ok: false, error: 'That isn’t your document.' };
  await ref.delete(); return { ok: true };
}

export async function saveRenterCare(db: any, tenantId: string, renterId: string, raw: any) {
  const me = await renterStaff(db, tenantId, renterId); if (!me) return { ok: false, error: 'Not found.' };
  const d = Number(raw?.checkInDays);
  const care = { on: raw?.on !== false, when: raw?.when === 'next_day' ? 'next_day' : 'checkout', checkInDays: (CHECKIN_CHOICES as readonly number[]).includes(d) ? d : 0, showProducts: raw?.showProducts !== false, providerNote: raw?.providerNote !== false };
  await db.doc(`${T(tenantId)}/renterSettings/${me.id}`).set({ aftercare: care }, { merge: true });
  return { ok: true, care };
}

/** Starting points for a renter's own library. */
export const RENTER_STARTERS: Array<{ key: string; title: string; category: RenterDocKind; sections: Array<{ type: string; heading: string; body: string }> }> = [
  { key: 'care', title: 'Looking after it at home', category: 'aftercare', sections: [
    { type: 'text', heading: 'Thank you for coming in', body: 'A few simple things keep your results looking their best for longer.' },
    { type: 'step', heading: 'The first 24 hours', body: 'What to avoid right after the service, and why.' },
    { type: 'step', heading: 'Day to day', body: 'The small habits that make it last — and what I recommend using.' },
    { type: 'warning', heading: 'Something not right?', body: 'If anything changes in the first week, message me — I’ll look at it and make it right.' } ] },
  { key: 'clean', title: 'My cleaning and disinfection routine', category: 'sop', sections: [
    { type: 'checklist', heading: 'Between every client', body: 'Wipe down the chair and counter\nDisinfect tools for the full contact time\nFresh towel and disposables' },
    { type: 'checklist', heading: 'End of the day', body: 'Empty and clean bowls\nTools cleaned and stored dry\nStation wiped and clear' },
    { type: 'tip', heading: 'Keep a record', body: 'Note the date you change disinfectant so it’s never past its use-by.' } ] },
  { key: 'consult', title: 'My consultation', category: 'sop', sections: [
    { type: 'step', heading: 'Before we start', body: 'Allergies, sensitivities, medications and anything new since last time.' },
    { type: 'step', heading: 'Agree the plan', body: 'What we’re doing today, how long it takes and what it costs.' },
    { type: 'warning', heading: 'When to stop', body: 'Signs that mean we don’t go ahead today, and what we do instead.' } ] },
];
