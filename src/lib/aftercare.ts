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

// ── The business's choices (Settings → Aftercare, tenant.aftercare) ─────────────────────────────────────────────────
export type CareWhen = 'checkout' | 'next_day';
export interface AftercareSettings { on: boolean; when: CareWhen; checkInDays: number; showProducts: boolean; providerNote: boolean }
export const CHECKIN_CHOICES = [0, 2, 3, 7] as const;
export function aftercareSettingsOf(tenant: any): AftercareSettings {
  const a = tenant?.aftercare || {}; const d = Number(a.checkInDays);
  return { on: a.on !== false, when: a.when === 'next_day' ? 'next_day' : 'checkout', checkInDays: (CHECKIN_CHOICES as readonly number[]).includes(d) ? d : 0,
    showProducts: a.showProducts !== false, providerNote: a.providerNote !== false };
}
/** Days after the visit to check in: the aftercare document's own choice (null = the business's), 0 = none. */
export function checkInDaysFor(S: AftercareSettings, doc: any): number {
  const own = doc?.checkInDays; if (own === null || own === undefined || own === '') return S.checkInDays;
  const n = Number(own); return (CHECKIN_CHOICES as readonly number[]).includes(n) ? n : S.checkInDays;
}
/** What was used on the client, from checkout (name, and batch when recorded) — for "What we used today". */
export function productsUsed(a: any): string[] {
  const f: any[] = Array.isArray(a?.checkoutState?.formula) ? a.checkoutState.formula : [];
  return [...new Set(f.map((x: any) => [String(x?.name || '').trim(), x?.shade ? String(x.shade) : '', x?.batch || x?.lot ? `batch ${x.batch || x.lot}` : ''].filter(Boolean).join(' · ')).filter(Boolean))].slice(0, 8);
}
/** The provider's note for this client (saved on the visit from the staff app), trimmed for the page. */
export const providerNoteOf = (a: any) => String(a?.aftercareNote?.text || '').trim().slice(0, 400) || null;
/** The "Book again in…" weeks: the service's own rebook time. */
export const rebookWeeksOf = (service: any) => { const w = Math.round(Number(service?.rebookWeeks) || 0); return w > 0 && w <= 52 ? w : 0; };
