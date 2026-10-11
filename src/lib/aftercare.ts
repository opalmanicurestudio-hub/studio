// src/lib/aftercare.ts — CLIENT AFTERCARE FROM THE SAME BLOCKS (approved design, canvas row 23 "the same blocks for
// clients"). An aftercare document is a document of category 'aftercare': written in the same editor (steps with photos,
// warnings, tips, video), never signed by the team, and linked to the services it's for — or marked as the aftercare
// for every service. After a visit the client gets a link to /aftercare/{tenant}/{visit} (signed like the "How was your
// visit?" page). A renter's visits use the renter's own aftercare (documents with renterId), never the business's.
// Older businesses wrote aftercare as plain text in Making it right settings; that still shows when there's no document.

export const AFTERCARE = 'aftercare';
export const isAftercare = (d: any) => d?.category === AFTERCARE;

/** The aftercare document for a visit's service: one linked to the service first, else the one for every service.
 *  `renterId` — the visit is a renter's: only their own aftercare counts. */
export function aftercareDocFor(docs: any[], serviceId: string | null | undefined, renterId?: string | null): any | null {
  const mine = (docs || []).filter((d) => d && d.status === 'published' && isAftercare(d) && (renterId ? d.renterId === renterId : !d.renterId));
  const sid = String(serviceId || '');
  const linked = sid ? mine.filter((d) => (Array.isArray(d.links) ? d.links : []).some((l: any) => l?.kind === 'service' && l.id === sid)) : [];
  const pick = (xs: any[]) => [...xs].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))[0] || null;
  return pick(linked) || pick(mine.filter((d) => d.aftercareDefault === true));
}

/** What a client may see of it: the title and the blocks — never who it's assigned to, sign-offs or checklist photo rules. */
export function clientView(d: any) {
  if (!d) return null;
  const sections = (Array.isArray(d.sections) ? d.sections : []).filter(Boolean).map((s: any) => {
    const { photoLines, photoIds, itemIds, ...rest } = s || {}; void photoLines; void photoIds; void itemIds; return rest;
  });
  return { id: String(d.id || ''), title: String(d.title || 'Aftercare'), sections, version: Number(d.version || 1) };
}
