// src/lib/doc-collections.ts — COLLECTIONS, OWNERS AND REVIEWS for the Documents library. A business groups its
// documents into collections (each with a color for its cover); the starting set suits most service businesses and
// they can add their own (tenant.docCollections). A document without one is placed by its type. Each document can have an
// owner and a review cycle ("every 6 months"): it's due for review that long after it was published or last confirmed.
// Pure — used by the library, the editor and the reminders run.

export type DocCollection = { id: string; name: string; color: string; soft: string };
export const DEFAULT_COLLECTIONS: DocCollection[] = [
  { id: 'safety', name: 'Safety & sanitation', color: '#2f6f6a', soft: '#e3efed' },
  { id: 'services', name: 'Services', color: '#7a4b8c', soft: '#efe6f3' },
  { id: 'open-close', name: 'Opening & closing', color: '#9a6a1f', soft: '#f6eedf' },
  { id: 'front-desk', name: 'Front desk', color: '#3d5a99', soft: '#e6ecf7' },
  { id: 'handbook', name: 'Handbook', color: '#4b5563', soft: '#eceef1' },
  { id: 'policies', name: 'Policies', color: '#8a3b3b', soft: '#f5e7e7' },
  { id: 'building', name: 'Building rules', color: '#a14d6b', soft: '#f6e6ec' },
  { id: 'aftercare', name: 'Client aftercare', color: '#2d6a3e', soft: '#e5f0e8' },
];
/** Client aftercare (lib/aftercare) always has its own collection, even when a business names its own. */
export const AFTERCARE_COLLECTION = DEFAULT_COLLECTIONS[DEFAULT_COLLECTIONS.length - 1];
/** Rules for everyone in the building — renters sign these in their portal (Part 6). */
export const BUILDING_COLLECTION = DEFAULT_COLLECTIONS.find((c) => c.id === 'building')!;
/** Colors a business can pick for its own collections (cover, soft background). */
export const COLLECTION_COLORS: Array<[string, string]> = [['#2f6f6a', '#e3efed'], ['#7a4b8c', '#efe6f3'], ['#9a6a1f', '#f6eedf'], ['#3d5a99', '#e6ecf7'], ['#4b5563', '#eceef1'], ['#8a3b3b', '#f5e7e7'], ['#2d6a3e', '#e5f0e8'], ['#a14d6b', '#f6e6ec']];

export function collectionsOf(tenant: any): DocCollection[] {
  const own = Array.isArray(tenant?.docCollections) ? tenant.docCollections.filter((c: any) => c && c.id && c.name) : [];
  return own.length ? (own.some((c: any) => c.id === 'aftercare') ? own : [...own, AFTERCARE_COLLECTION]) : DEFAULT_COLLECTIONS;
}
/** Which collection a document is in: its own choice, else by type (handbook, policy, checklists → opening & closing). */
export function collectionFor(d: any, cols: DocCollection[]): DocCollection {
  if (d?.category === 'aftercare') return cols.find((c) => c.id === 'aftercare') || AFTERCARE_COLLECTION;
  const byId = cols.find((c) => c.id === d?.collectionId && c.id !== 'aftercare'); if (byId) return byId;
  const pick = (id: string) => cols.find((c) => c.id === id);
  const guess = d?.category === 'handbook' ? pick('handbook') : d?.category === 'policy' ? pick('policies')
    : (d?.sections || []).some((s: any) => s?.type === 'checklist') ? pick('open-close') : pick('safety');
  return guess || cols[0] || DEFAULT_COLLECTIONS[0];
}

const addMonths = (iso: string, m: number) => { const d = new Date(iso); if (isNaN(+d)) return null; d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
/** When the document is next due for review ('YYYY-MM-DD'), or null if it has no review cycle. */
export function reviewDue(d: any): string | null {
  const m = Number(d?.reviewEveryMonths); if (!(m > 0) || d?.status !== 'published') return null;
  const from = String(d?.reviewedAt || d?.publishedAt || d?.updatedAt || d?.createdAt || ''); return from ? addMonths(from, m) : null;
}

/** Steps, checklist items and a reading time for the meta line. */
export function docStats(d: any) {
  const secs: any[] = Array.isArray(d?.sections) ? d.sections : [];
  const steps = secs.filter((s) => s?.type === 'step').length;
  const items = secs.filter((s) => s?.type === 'checklist').reduce((n, s) => n + String(s.body || '').split('\n').filter((x: string) => x.trim()).length, 0);
  const words = secs.reduce((n, s) => n + `${s?.heading || ''} ${s?.body || ''}`.split(/\s+/).filter(Boolean).length, 0);
  return { steps, items, minutes: Math.max(1, Math.round(words / 200)) };
}

/** Who a document is for, from the team list (everyone, their role, or by name; never archived people). */
export function assignedPeople(d: any, staff: any[]) {
  if (d?.category === 'aftercare') return [];   // for clients — nobody on the team signs it
  const roles: string[] = Array.isArray(d?.assignedRoles) ? d.assignedRoles : [];
  // "Everyone" is the team. Renters get a document only when it's sent to renters, or to them by name (building rules).
  const isRenter = (m: any) => m.role === 'renter' || m.isRenter === true;
  return (staff || []).filter((m: any) => !m.archived && ((isRenter(m) ? roles.includes('renter') : roles.includes('all') || (m.role && roles.includes(m.role))) || (Array.isArray(d?.assignedStaffIds) && d.assignedStaffIds.includes(m.id))));
}

/** Searching titles and what's inside. */
export function docMatches(d: any, q: string) {
  const s = q.trim().toLowerCase(); if (!s) return true;
  return `${d?.title || ''} ${(d?.sections || []).map((x: any) => `${x?.heading || ''} ${x?.body || ''}`).join(' ')}`.toLowerCase().includes(s);
}
