// src/lib/spaces-section.ts — SPACES TO RENT on the booking page: what it lists, and what applicants are asked.
//
// The owner sets it in Settings › Booking page › Spaces to rent (kept at bookingPageSettings.studio.spaces). Anything
// set before in the old page builder's booth sections (at bookingPageSettings.cfPageConfig) still applies, section by
// section, until it's changed here, so a business that already listed booths for lease, asked for documents or wrote
// its own application terms keeps all of it.
//
// TWO KINDS OF TERMS, never mixed: an APPLICATION to lease shows the business's own application terms as the box to
// tick (no box when they wrote none). Anyone RENTING BY THE HOUR OR DAY reads and signs the built-in rental agreement
// (care of the space, payment, the incidentals the business may charge), the same text on the page, online and at
// the kiosk, because it's the one with those protections in it.
// Pure: no React, no Firebase, safe on the server.

import { resolveIncidentalPolicy } from './incidentals';
import { tenantTimeZone, todayIn } from './tenant-time';

export interface SpacesSettings {
  showLeases?: boolean;          // booths and spaces to lease by the month
  showDayUse?: boolean;          // by the hour or the day
  terms?: string;                // the business's own application terms ('' = none)
  requiredDocs?: string[];       // documents an applicant uploads (a license, insurance)
  docsAfterApproval?: boolean;   // ask for those documents only once an application is approved
  qualifiers?: boolean;          // ask applicants a few qualifying questions
  niches?: string[];             // the specialties an applicant chooses from ([] = the usual list)
}

export const SPACES_LIMITS = { terms: 6000, docs: 8, niches: 16, item: 60 } as const;

const own = (x: any, n: number) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
const list = (x: any, max: number) => (Array.isArray(x) ? [...new Set(x.map((v) => own(v, SPACES_LIMITS.item)).filter(Boolean))].slice(0, max) : undefined);

/** The old page builder's booth sections that were showing (each one was listed on the old page). A business that
 *  already used this design never showed them, so nothing of theirs is brought back. */
export function oldBoothSections(t: any): any[] {
  if (t?.bookingPageSettings?.design === 'studio') return [];
  const sections: any[] = Array.isArray(t?.bookingPageSettings?.cfPageConfig?.sections) ? t.bookingPageSettings.cfPageConfig.sections : [];
  return sections.filter((s) => s?.type === 'booths' && !!s.enabled && s.visible !== false).map((s) => s.config || {});
}

/** The owner's settings as they stand (what Settings shows): their own where saved, else the old page's. */
export function spacesSettings(t: any): Required<Pick<SpacesSettings, 'showLeases' | 'showDayUse' | 'docsAfterApproval' | 'qualifiers'>> & { terms: string; requiredDocs: string[]; niches: string[] } {
  const s: SpacesSettings = t?.bookingPageSettings?.studio?.spaces || {};
  const old = oldBoothSections(t);
  const first = old[0] || {};
  const pick = (mine: any, was: any, fallback: boolean) => (typeof mine === 'boolean' ? mine : typeof was === 'boolean' ? was : fallback);
  // With nothing saved and no old booth section: a page that already used this design keeps listing spaces by the
  // hour or day, as it did; any other business lists nothing until the owner chooses (never switched on for them).
  const wasStudio = t?.bookingPageSettings?.design === 'studio';
  return {
    showLeases: pick(s.showLeases, old.length ? old.some((c) => c.showMonthly !== false) : undefined, false),
    showDayUse: pick(s.showDayUse, old.length ? old.some((c) => c.showDaily !== false) : undefined, wasStudio),
    terms: typeof s.terms === 'string' ? own(s.terms, SPACES_LIMITS.terms) : oldTerms(t),
    requiredDocs: list(s.requiredDocs, SPACES_LIMITS.docs) ?? list(first.requiredDocs, SPACES_LIMITS.docs) ?? [],
    docsAfterApproval: pick(s.docsAfterApproval, first.collectDocsAfterApproval, false),
    qualifiers: pick(s.qualifiers, first.applicationQualifiers, false),
    niches: list(s.niches, SPACES_LIMITS.niches) ?? list(first.nicheOptions, SPACES_LIMITS.niches) ?? [],
  };
}

/** Application terms written in the old page builder, wherever it kept them. */
function oldTerms(t: any): string {
  for (const c of oldBoothSections(t)) { const x = own(c.applicationAgreement, SPACES_LIMITS.terms); if (x) return x; }
  const b = t?.bookingPageSettings || {};
  return own(b.cfPageConfig?.applicationAgreement, SPACES_LIMITS.terms) || own(b.applicationAgreement, SPACES_LIMITS.terms);
}

/** What the page lists. Each old booth section is listed as it was (its own words, layout and choices), with only the
 *  settings the owner has since saved here laid over it; with no old section, one listing from the settings. Nothing
 *  when the owner shows neither leases nor rentals. */
export function spacesListings(t: any): any[] {
  const r = spacesSettings(t);
  if (!r.showLeases && !r.showDayUse) return [];
  const s: SpacesSettings = t?.bookingPageSettings?.studio?.spaces || {};
  const saved: Record<string, any> = {};
  if (typeof s.showLeases === 'boolean') saved.showMonthly = s.showLeases;
  if (typeof s.showDayUse === 'boolean') saved.showDaily = s.showDayUse;
  if (typeof s.terms === 'string') saved.applicationAgreement = r.terms;
  if (Array.isArray(s.requiredDocs)) saved.requiredDocs = r.requiredDocs;
  if (typeof s.docsAfterApproval === 'boolean') saved.collectDocsAfterApproval = s.docsAfterApproval;
  if (typeof s.qualifiers === 'boolean') saved.applicationQualifiers = s.qualifiers;
  if (Array.isArray(s.niches)) saved.nicheOptions = r.niches.length ? r.niches : undefined;   // none saved: the usual list
  // What the listing needs to show the rental agreement filled in, exactly as it's signed: the business's name, the
  // incidentals a guest authorizes, and the business's own date.
  const sign = { studioName: t?.name || t?.businessName || 'The Studio', incidentals: resolveIncidentalPolicy(t), today: todayIn(tenantTimeZone(t)) };
  const old = oldBoothSections(t);
  if (old.length) return old.map((c) => ({ ...c, ...saved, ...sign }));
  return [{ ...sign,
    // Leases bring booths; rentals alone are the rooms and spaces kept for renting by the hour or day.
    ...(r.showLeases ? {} : { kind: 'spaces' }),
    title: r.showLeases && r.showDayUse ? 'Spaces to rent' : r.showLeases ? 'Space to lease' : 'Book a space',
    subtitle: r.showLeases && r.showDayUse ? 'By the month, or by the hour or the day.' : r.showLeases ? 'Private stations for independent professionals, by the month.' : 'By the hour or the day, no appointment needed.',
    hideWhenEmpty: true,
    showMonthly: r.showLeases, showDaily: r.showDayUse, applicationAgreement: r.terms, requiredDocs: r.requiredDocs,
    collectDocsAfterApproval: r.docsAfterApproval, applicationQualifiers: r.qualifiers, ...(r.niches.length ? { nicheOptions: r.niches } : {}),
  }];
}
