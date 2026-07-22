// src/lib/booth-contacts.ts
//
// The persisted CONTACT record — the durable home for a person's journey
// through the booth business. Until now the booth "CRM" (the guestBook memo in
// booths-page) was recomputed each render and stored nothing, so there was
// nowhere to attach a decision, a follow-up date, or a note. This gives every
// person a real record you can MANAGE over time.
//
// Identity/value (visits, lifetime, stage ladder) is still derived live from
// reservations/applications/leases — that stays. This record adds the layer the
// owner actively drives:
//   • pipelineStage   — where the lead is in YOUR funnel (new→…→won/lost)
//   • nextFollowUpAt   — a date to be reminded to reach back out
//   • lostReason       — why they didn't convert (kept, never just deleted)
//   • ownerNotes       — freeform
//   • convertedRenterId— set the moment they become a renter (the missing link)
//
// The doc id is derived deterministically from the contact key (normalized
// phone, else email) so writes are idempotent and a person is never duplicated.
// The stored `key` matches the guestBook memo's key exactly, so the persisted
// state overlays cleanly onto the live-derived contact.

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

export type PipelineStage = 'new' | 'contacted' | 'nurturing' | 'won' | 'lost';

export interface BoothContact {
  id: string;
  key: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;              // first-touch kind: tour | application | reservation | manual
  pipelineStage: PipelineStage;
  nextFollowUpAt?: string | null;   // YYYY-MM-DD
  followUpNotifiedFor?: string | null;
  lostReason?: string | null;
  lostAt?: string | null;
  ownerNotes?: string | null;
  convertedRenterId?: string | null;
  firstSeenAt?: string;
  lastActivityAt?: string;
  tags?: string[];
}

export const PIPELINE_STAGES: { value: PipelineStage; label: string; color: string; tone: string }[] = [
  { value: 'new',        label: 'New',        color: 'text-sky-600',     tone: 'bg-sky-100 text-sky-700' },
  { value: 'contacted',  label: 'Contacted',  color: 'text-indigo-600',  tone: 'bg-indigo-100 text-indigo-700' },
  { value: 'nurturing',  label: 'Nurturing',  color: 'text-amber-600',   tone: 'bg-amber-100 text-amber-700' },
  { value: 'won',        label: 'Won',        color: 'text-emerald-700', tone: 'bg-emerald-100 text-emerald-700' },
  { value: 'lost',       label: 'Lost',       color: 'text-slate-500',   tone: 'bg-slate-200 text-slate-600' },
];

export const stageLabel = (s?: string) => PIPELINE_STAGES.find(x => x.value === s)?.label || 'New';
export const stageTone = (s?: string) => PIPELINE_STAGES.find(x => x.value === s)?.tone || 'bg-sky-100 text-sky-700';

// The contact key — MUST match the guestBook memo: normalized phone, else email.
export function contactKey(phone?: any, email?: any): string {
  const norm = (v: any) => String(v ?? '').trim().toLowerCase();
  return norm(phone) || norm(email);
}

// Firestore doc ids can't contain '/', so derive a safe, stable id from the key.
export function contactDocId(key: string): string {
  return String(key || '').replace(/[^a-z0-9@._-]/gi, '_').slice(0, 200) || 'unknown';
}

const nowIso = () => new Date().toISOString();

interface EnsureInput { name?: any; phone?: any; email?: any; source?: string }

// Ensure a contact record exists for this person and return it. Creates on first
// touch with sensible defaults; on later calls just refreshes identity/activity
// without ever downgrading pipeline state. Idempotent by construction.
export async function ensureBoothContact(firestore: any, tenantId: string, input: EnsureInput): Promise<BoothContact | null> {
  const key = contactKey(input.phone, input.email);
  if (!key) return null;
  const id = contactDocId(key);
  const ref = doc(firestore, 'tenants', tenantId, 'contacts', id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as any;
    // Light refresh — fill blanks, bump activity; never touch pipeline here.
    const patch: any = { lastActivityAt: nowIso() };
    if (input.name && (!data.name || data.name === 'Guest')) patch.name = String(input.name);
    if (input.phone && !data.phone) patch.phone = String(input.phone);
    if (input.email && !data.email) patch.email = String(input.email);
    try { await updateDoc(ref, patch); } catch { /* non-fatal */ }
    return { id, ...(data as any), ...patch };
  }
  const created: BoothContact = {
    id, key,
    name: input.name ? String(input.name) : 'Guest',
    phone: input.phone ? String(input.phone) : '',
    email: input.email ? String(input.email) : '',
    source: input.source || 'manual',
    pipelineStage: 'new',
    nextFollowUpAt: null, followUpNotifiedFor: null,
    lostReason: null, lostAt: null, ownerNotes: null, convertedRenterId: null,
    firstSeenAt: nowIso(), lastActivityAt: nowIso(), tags: [],
  };
  await setDoc(ref, created, { merge: true });
  return created;
}

async function patchContact(firestore: any, tenantId: string, input: EnsureInput, patch: any) {
  const c = await ensureBoothContact(firestore, tenantId, input);
  if (!c) return null;
  const ref = doc(firestore, 'tenants', tenantId, 'contacts', c.id);
  await updateDoc(ref, { ...patch, lastActivityAt: nowIso() });
  return { ...c, ...patch };
}

export const setContactPipeline = (firestore: any, tenantId: string, person: EnsureInput, stage: PipelineStage) =>
  patchContact(firestore, tenantId, person, {
    pipelineStage: stage,
    ...(stage === 'lost' ? {} : { lostReason: null, lostAt: null }),
  });

export const scheduleContactFollowUp = (firestore: any, tenantId: string, person: EnsureInput, dateStr: string | null) =>
  patchContact(firestore, tenantId, person, {
    nextFollowUpAt: dateStr || null,
    followUpNotifiedFor: null, // re-arm the reminder for the new date
    ...(dateStr ? { pipelineStage: 'nurturing' } : {}),
  });

export const markContactLost = (firestore: any, tenantId: string, person: EnsureInput, reason: string) =>
  patchContact(firestore, tenantId, person, {
    pipelineStage: 'lost', lostReason: reason || 'Not a fit', lostAt: nowIso(), nextFollowUpAt: null,
  });

export const reengageContact = (firestore: any, tenantId: string, person: EnsureInput) =>
  patchContact(firestore, tenantId, person, {
    pipelineStage: 'nurturing', lostReason: null, lostAt: null,
  });

export const setContactNote = (firestore: any, tenantId: string, person: EnsureInput, note: string) =>
  patchContact(firestore, tenantId, person, { ownerNotes: note });

export const linkContactRenter = (firestore: any, tenantId: string, person: EnsureInput, renterId: string) =>
  patchContact(firestore, tenantId, person, {
    convertedRenterId: renterId, pipelineStage: 'won', lostReason: null, lostAt: null, nextFollowUpAt: null,
  });
