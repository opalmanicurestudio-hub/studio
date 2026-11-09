// src/lib/studio-page.ts — THE BOOKING PAGE'S OWN SETTINGS (Settings › Bookings › Booking page), kept on the business
// at bookingPageSettings.studio, and read the same way everywhere: the public page, its preview, the splash, the
// visit link, emails and the app's own color. One design for every business; the owner chooses the color, the cover
// photo, the mood (Soft, Crisp or Night), the headline, which sections show and in what order, and the words and photos
// in a few of them. Anything a business already wrote in the old page builder (its color, hero words and photo,
// gallery, about text, questions) is read from there until they change it here, so nothing is lost. Pure: no React,
// no Firebase, safe on the server.

import { hasTimeZone, tenantTimeZone, todayIn } from './tenant-time';
import type { SpacesSettings } from './spaces-section';

export type Mood = 'soft' | 'crisp' | 'night';
/** Visit us, in the business's own words: getting here (parking, the entrance, a short video of the way in), hours in
 *  their own words (instead of the team's schedules), social links and a quote request link. Links are https only. */
export interface VisitNotes { parking?: string; entrance?: string; video?: string; hours?: string; social?: { label: string; url: string }[]; quote?: string }
export type SectionId = 'services' | 'offers' | 'events' | 'team' | 'work' | 'reviews' | 'about' | 'policies' | 'faqs' | 'gifts' | 'spaces' | 'visit' | 'waitlist';
export interface Photo { url: string; path?: string; caption?: string }
export interface Faq { q: string; a: string }
export interface StudioSettings {
  color?: string; mood?: Mood; cover?: Photo | null; headline?: string; description?: string;
  soonest?: boolean; bookAgain?: boolean; showRating?: boolean;
  splash?: boolean;   // the opening splash: the color, the logo and the name for under a second, the first time a visitor opens the page
  visit?: VisitNotes;   // Getting here: parking, the entrance and a short video of the way in
  spaces?: SpacesSettings;   // Spaces to rent: what's listed, the terms, what applicants are asked (lib/spaces-section)
  oldPageNoted?: boolean;    // the owner has read what their old page showed that this design doesn't
  order?: SectionId[]; off?: Partial<Record<SectionId, boolean>>;
  work?: Photo[]; about?: { text?: string; photo?: Photo | null }; faqs?: Faq[];
}

/** The sections, in the order a new page shows them, with what each is called in Settings. */
/** optIn: off until the owner switches it on (selling memberships and packages online takes payments, so it's never
 *  started for them). Saved as off.<id> = false when on. */
export const SECTIONS: { id: SectionId; title: string; always?: true; module?: string; optIn?: true }[] = [
  { id: 'services', title: 'Services', always: true },
  { id: 'offers', title: 'Memberships and packages', optIn: true },
  { id: 'events', title: 'Classes and events' },
  { id: 'team', title: 'The team' },
  { id: 'work', title: 'Our work' },
  { id: 'reviews', title: 'Kind words' },
  { id: 'about', title: 'About us' },
  { id: 'policies', title: 'Before you book' },
  { id: 'faqs', title: 'Questions' },
  { id: 'gifts', title: 'Gift cards' },
  { id: 'spaces', title: 'Spaces to rent', module: 'booth_rental' },
  { id: 'visit', title: 'Visit us' },
  { id: 'waitlist', title: 'Waitlist' },
];

/** Colors offered by name; any other can be picked. All keep white text on them readable. */
export const COLORS: { name: string; hex: string }[] = [
  { name: 'Rose clay', hex: '#8b5e57' }, { name: 'Terracotta', hex: '#9c4a2f' }, { name: 'Berry', hex: '#8e3b5a' },
  { name: 'Plum', hex: '#6b5b95' }, { name: 'Ocean', hex: '#1f5f8b' }, { name: 'Forest', hex: '#2f5d50' },
  { name: 'Olive', hex: '#5b6531' }, { name: 'Charcoal', hex: '#16171a' },
];

export const MOODS: { id: Mood; title: string; meaning: string }[] = [
  { id: 'soft', title: 'Soft', meaning: 'Warm paper and round corners' },
  { id: 'crisp', title: 'Crisp', meaning: 'White paper and tighter corners' },
  { id: 'night', title: 'Night', meaning: 'A dark page, lights down' },
];

const hexOf = (c: unknown): string | null => {
  const s = typeof c === 'string' ? c.trim() : '';
  if (/^#?[0-9a-f]{6}$/i.test(s)) return (s.startsWith('#') ? s : `#${s}`).toLowerCase();
  if (/^#?[0-9a-f]{3}$/i.test(s)) { const h = s.replace('#', ''); return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase(); }
  return null;
};

/** The business's color as they chose it (Booking page settings, else the old page builder, else older fields), or null. */
export function pageColor(t: any): string | null {
  const b = t?.bookingPageSettings || {};
  return hexOf(b.studio?.color) || hexOf(b.cfPageConfig?.accentColor) || hexOf(b.theme?.primaryColor) || hexOf(t?.brandColor) || null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16); const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
/** How readable white text is on a color (WCAG contrast ratio). */
export const whiteContrast = (hex: string) => 1.05 / (luminance(hex) + 0.05);


/** The color deepened just enough that white text on it stays readable (4.5:1): mixed toward ink a little at a time,
 *  so a pastel becomes a deeper version of itself rather than a louder one. */
export function readable(hex: string): string {
  const h0 = hexOf(hex); if (!h0) return '#16171a';
  if (whiteContrast(h0) >= 4.5) return h0;
  const n = parseInt(h0.slice(1), 16); const from = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; const ink = [0x16, 0x17, 0x1a];
  for (let k = 0.04; k <= 1; k += 0.04) {
    const c = '#' + from.map((v, i) => Math.round(v * (1 - k) + ink[i] * k).toString(16).padStart(2, '0')).join('');
    if (whiteContrast(c) >= 4.5) return c;
  }
  return '#16171a';
}

/** On the black look: the color lightened just enough that dark text on it, and the color itself on black, read clearly
 *  (4.5:1 against ink, or against `on`, the darkest-but-one surface it sits on, such as a card on a dark page). */
export function lifted(hex: string, on = '#16171a'): string {
  const h0 = hexOf(hex); if (!h0) return '#f5f5f7';
  const lum = (h: string) => 1.05 / whiteContrast(h) - 0.05; const inkLum = lum(hexOf(on) || '#16171a');
  const ok = (h: string) => (lum(h) + 0.05) / (inkLum + 0.05) >= 4.5;
  if (ok(h0)) return h0;
  const n = parseInt(h0.slice(1), 16); const from = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let k = 0.04; k <= 1; k += 0.04) {
    const c = '#' + from.map((v) => Math.round(v * (1 - k) + 255 * k).toString(16).padStart(2, '0')).join('');
    if (ok(c)) return c;
  }
  return '#f5f5f7';
}

/** The color every screen paints with: the business's, made readable, or ink when there's none. */
export function brandColor(t: any): string {
  const c = pageColor(t); return c ? readable(c) : '#16171a';
}

/** The business's color made readable for white text, or null when they haven't chosen one (so a screen keeps its own
 *  default). What every screen that paints buttons or highlights with it uses. */
export function pageAccent(t: any): string | null {
  const c = pageColor(t); return c ? readable(c) : null;
}

/** The name of a color, when it's one of the named ones. */
export const colorName = (hex: string | null) => (hex && COLORS.find((c) => c.hex === hex.toLowerCase())?.name) || null;

/** A headline's plain part and the part after the first comma, which stands out in bold. */
export function headlineParts(h: string): [string, string] {
  const i = h.indexOf(','); if (i < 0 || i === h.length - 1) return [h, ''];
  return [h.slice(0, i + 1), h.slice(i + 1).trim()];
}

// What the old page builder left behind, read once so nothing a business wrote there is lost. Only sections that were
// switched on and shown, and never the builder's own sample words (it filled every new section with them).
const SAMPLE = new Set([
  'Need Something Bigger?', 'Planning a wedding, bridal party, or corporate event?',
  'Book Your Experience', 'A sanctuary of craft, curated for those who appreciate the details.',
  'Opal was born from a belief that nail care is more than maintenance.',
  'How do I book an appointment?', 'Use the Book Now button above or select any service.', 'What is your cancellation policy?',
  'We require 24 hours notice to avoid a cancellation fee.', 'Do you accept walk-ins?', 'Yes! Walk-ins welcome based on availability.',
  'Do you offer gift cards?', 'Absolutely — gift cards available in any amount.',
  'Sarah M.', 'Jessica T.', 'Priya K.', 'Absolutely incredible experience.', 'Every visit exceeds my expectations.', 'Luxurious yet so welcoming.',
  'Monday – Saturday: 9am – 7pm\nSunday: 10am – 5pm', '@opalmanicure',
].map((x) => x.toLowerCase()));
const text = (v: any) => (typeof v === 'string' ? v.trim() : '');
const sample = (s: string) => SAMPLE.has(s.toLowerCase());
const own = (v: any) => { const s = text(v); return s && !sample(s) ? s : ''; };
/** A question and answer (or a name and review) are kept when the answer (or the review) is the business's own: one that
 *  kept a sample question but wrote its own answer meant it, while a sample answer is never shown under any question
 *  or anyone's name. */
const pair = (a: any, b: any): [string, string] | null => { const x = text(a), y = text(b); return x && y && !sample(y) ? [x, y] : null; };
/** A photo with only the fields it has (the database can't keep an empty field inside a list). */
const photo = (url: string, caption?: string): Photo => (caption ? { url, caption } : { url });
function classic(t: any) {
  const sections: any[] = Array.isArray(t?.bookingPageSettings?.cfPageConfig?.sections) ? t.bookingPageSettings.cfPageConfig.sections : [];
  const cfg = (type: string) => { const s = sections.find((x) => x?.type === type); return s && s.enabled !== false && s.visible !== false ? s.config || {} : null; };
  const hero = cfg('hero') || {}; const gallery = cfg('gallery') || {}; const ba = cfg('beforeAfter') || cfg('beforeafter') || {}; const story = cfg('story') || {}; const faq = cfg('faq') || {}; const rv = cfg('reviews') || {};
  const work: Photo[] = [
    ...(Array.isArray(gallery.images) ? gallery.images : []).filter((i: any) => typeof i?.url === 'string' && i.url).map((i: any) => photo(i.url, own(i.caption) || undefined)),
    ...(Array.isArray(ba.pairs) ? ba.pairs : []).flatMap((p: any) => ([['afterUrl', 'After'], ['beforeUrl', 'Before']] as const)
      .filter(([k]) => typeof p?.[k] === 'string' && p[k]).map(([k, label]) => photo(p[k], own(p.caption) ? `${label} · ${own(p.caption)}` : label))),
  ];
  const faqs: Faq[] = [1, 2, 3, 4, 5, 6].map((i) => pair(faq[`q${i}`], faq[`a${i}`])).filter((f): f is [string, string] => !!f).map(([q, a]) => ({ q, a }));
  const img = own(hero.heroImage) || own(hero.bgImage);
  return {
    headline: own(hero.headline), description: own(hero.subheadline),
    cover: img ? { url: img } : null,
    work, faqs,
    about: { text: [own(story.body), own(story.body2)].filter(Boolean).join('\n\n'), photo: own(story.image) ? { url: own(story.image) } : null },
    reviews: [1, 2, 3].flatMap((i) => { const p = pair(rv[`rev${i}Name`], rv[`rev${i}Text`]); return p ? [{ name: p[0], text: p[1], rating: Math.max(1, Math.min(5, Number(rv[`rev${i}Rating`]) || 5)) }] : []; }),
  };
}

/** Other things the old page showed that the new one keeps: hours typed in by hand (shown instead of the team's
 *  schedules), social links (and the Instagram handle), and a quote button that went to the business's own form.
 *  Plus, for Settings, the old sections the new design doesn't have, so the owner knows what's no longer shown. */
export interface OldPageExtras { hours: string; social: { label: string; url: string }[]; quoteUrl: string; gone: string[] }
export function oldPageExtras(t: any): OldPageExtras {
  // A business that already used this design never showed its old page's leftovers, so none of it is brought back.
  if (t?.bookingPageSettings?.design === 'studio') return { hours: '', social: [], quoteUrl: '', gone: [] };
  const sections: any[] = Array.isArray(t?.bookingPageSettings?.cfPageConfig?.sections) ? t.bookingPageSettings.cfPageConfig.sections : [];
  const live = sections.filter((x) => x && !!x.enabled && x.visible !== false);
  const cfg = (type: string) => live.find((x) => x.type === type)?.config || null;
  const contact = cfg('contact'); const nav = cfg('nav'); const ig = cfg('instagram'); const quote = cfg('quote');
  const hours = contact && contact.showHours !== false ? own(contact.customHours).slice(0, 400) : '';
  const https = (u: any) => { const x = text(u); return /^https:\/\/[^\s]+$/i.test(x) && x.length <= 300 ? x : ''; };
  const NAMES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', x: 'X', twitter: 'X', linkedin: 'LinkedIn', yelp: 'Yelp', threads: 'Threads' };
  const social: { label: string; url: string }[] = [];
  const add = (label: string, url: string) => { if (url && !social.some((x) => x.url === url) && social.length < 6) social.push({ label, url }); };
  for (const l of [...(contact && contact.showSocial !== false && Array.isArray(contact.socialLinks) ? contact.socialLinks : []), ...(Array.isArray(nav?.socialLinks) ? nav.socialLinks : [])]) {
    const p = text(l?.platform).toLowerCase(); add(NAMES[p] || (p ? p[0].toUpperCase() + p.slice(1) : 'Link'), https(l?.url));
  }
  const handle = own(ig?.handle).replace(/^@/, '');
  if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) add('Instagram', `https://www.instagram.com/${handle}/`);
  const link = text(quote?.ctaLink);
  const quoteUrl = https(link) || (link === 'url' ? https(quote?.ctaUrl) : '');
  const GONE: Record<string, string> = { trust: 'the trust strip', newclient: 'the new client offer', referral: 'the referral panel', instagram: 'the Instagram photos', quote: 'the quote request panel', memberships: 'memberships', packages: 'packages' };
  // The quote panel every old page started with counts only when the owner made it theirs.
  const gone = [...new Set(live.filter((x) => x.type !== 'quote' || own(x.config?.heading) || own(x.config?.subheading)).map((x) => GONE[x.type]).filter(Boolean))];
  return { hours, social, quoteUrl, gone };
}

export interface ResolvedPage {
  color: string | null; paint: string; mood: Mood; cover: Photo | null; headline: string; description: string;
  soonest: boolean; bookAgain: boolean; showRating: boolean; splash: boolean; visit: VisitNotes;
  order: SectionId[]; on: Record<SectionId, boolean>;
  work: Photo[]; about: { text: string; photo: Photo | null }; faqs: Faq[];
  /** Reviews typed into the old page builder, shown only until clients' own reviews are chosen to show. */
  typedReviews: { name: string; text: string; rating: number }[];
}

/** Everything the page needs, with the business's choices, what it wrote in the old builder, then good defaults. */
export function studioPage(t: any): ResolvedPage {
  const s: StudioSettings = t?.bookingPageSettings?.studio || {};
  const c = classic(t);
  const known = new Set(SECTIONS.map((x) => x.id));
  const saved = (Array.isArray(s.order) ? s.order : []).filter((id) => known.has(id));
  const order = [...new Set([...saved, ...SECTIONS.map((x) => x.id)])].filter((id) => id !== 'services');
  const on = Object.fromEntries(SECTIONS.map((x) => [x.id, x.always ? true : x.optIn ? s.off?.[x.id] === false : s.off?.[x.id] !== true])) as Record<SectionId, boolean>;
  const color = pageColor(t);
  return {
    color, paint: color ? readable(color) : '#16171a',
    mood: s.mood === 'crisp' || s.mood === 'night' ? s.mood : 'soft',
    cover: s.cover === null ? null : s.cover?.url ? s.cover : c.cover,
    headline: typeof s.headline === 'string' ? s.headline.trim() : c.headline,
    description: typeof s.description === 'string' ? s.description.trim() : c.description || String(t?.description || '').trim(),
    soonest: s.soonest !== false, bookAgain: s.bookAgain !== false, showRating: s.showRating !== false, splash: s.splash !== false,
    visit: visitWithOld(t, s.visit),
    order: ['services', ...order] as SectionId[], on,
    work: Array.isArray(s.work) ? s.work.filter((p) => p?.url) : c.work,
    about: s.about ? { text: String(s.about.text || '').trim(), photo: s.about.photo === null ? null : s.about.photo?.url ? s.about.photo : null } : { text: c.about.text, photo: c.about.photo },
    faqs: Array.isArray(s.faqs) ? s.faqs.filter((f) => f?.q && f?.a) : c.faqs,
    typedReviews: c.reviews,
  };
}

/** Getting here notes, cleaned: short text, and a video only as an https link. */
const httpsOnly = (x: any) => { const u = typeof x === 'string' ? x.trim().slice(0, 300) : ''; return /^https:\/\/[^\s]+$/i.test(u) ? u : ''; };   // a link with a space in it is refused, never rewritten
export function visitNotes(v: any): VisitNotes {
  const txt = (x: any, n: number) => (typeof x === 'string' ? x.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');   // line breaks kept
  const social = Array.isArray(v?.social) ? v.social.map((x: any) => ({ label: txt(x?.label, 30) || 'Link', url: httpsOnly(x?.url) })).filter((x: any) => x.url).slice(0, 6) : [];
  return { parking: txt(v?.parking, 300), entrance: txt(v?.entrance, 300), video: httpsOnly(v?.video), hours: txt(v?.hours, 400), social, quote: httpsOnly(v?.quote) };
}
/** Visit us as the page shows it: what the owner saved here, or what their old page showed until they change it. */
function visitWithOld(t: any, saved: any): VisitNotes {
  const v = visitNotes(saved); const old = oldPageExtras(t);
  return { ...v, hours: typeof saved?.hours === 'string' ? v.hours : old.hours, social: Array.isArray(saved?.social) ? v.social : old.social, quote: typeof saved?.quote === 'string' ? v.quote : old.quoteUrl };
}

/** What to save for a section's switch: off.<id> = true to hide one that shows by default, false to show an opt-in one,
 *  and nothing (removed) for the default. */
export const sectionSwitch = (id: SectionId, show: boolean): boolean | undefined => (SECTIONS.find((x) => x.id === id)?.optIn ? (show ? false : undefined) : (show ? undefined : true));

/** An event clients may see and reserve on the booking page: the owner switched on "Show on your booking page", it has
 *  no access PIN (private), isn't invite-only or paid (paid tickets aren't sold there yet), and is still on (upcoming
 *  or under way; never a draft, finished, called off or closed). A quote turned into an event, or a private party, never shows by itself. */
export function publicEvent(e: any): boolean {
  return listedEvent(e) && !(Number(e.ticketingConfig?.price) > 0);
}
/** An event the booking page lists: a free one (reserved right there) or a paid one (its tickets are bought on the
 *  event's own page, lib/event-tickets). Never a private one or one by invitation only. */
export function listedEvent(e: any): boolean {
  return !!e && e.showOnBookingPage === true && !e.accessPin && e.ticketingConfig?.type !== 'comp_only'
    && ['upcoming', 'active'].includes(String(e.status || 'upcoming')) && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''));
}
/** A listed event's price per ticket in dollars, or 0 when it's free. */
export const listedTicketPrice = (e: any) => (e?.ticketingConfig?.type !== 'comp_only' && Number(e?.ticketingConfig?.price) > 0 ? Number(e.ticketingConfig.price) : 0);
/** Seats an event has, if it has a limit. */
export const eventCapacity = (e: any) => Math.max(0, Math.floor(Number(e?.ticketingConfig?.capacity || e?.capacity) || 0));
/** The public classes and events still to come, soonest first (today's stays up all day). `today` is the business's
 *  own date (YYYY-MM-DD). */
export function comingEvents(events: any[], today: string, max = 6): any[] {
  return (events || []).filter((e: any) => listedEvent(e) && String(e.date) >= today)
    .sort((a: any, b: any) => `${a.date} ${a.time || '99:99'}`.localeCompare(`${b.date} ${b.time || '99:99'}`)).slice(0, max);
}
/** The business's date for "still to come": their own zone, or, before they've set one, the latest US zone, so
 *  tonight's class never disappears early. */
export const eventToday = (tenant: any, now = new Date()) => todayIn(hasTimeZone(tenant) ? tenantTimeZone(tenant) : 'Pacific/Honolulu', now);

/** A section shows when it's switched on, the business uses its tool, and it has something in it, so a new page never
 *  looks empty. counts: how many things each section would show (services, packages, events, people, reviews…). */
export function sectionShows(p: ResolvedPage, id: SectionId, counts: Partial<Record<SectionId, number>>, modules: (m: string) => boolean = () => true): boolean {
  const def = SECTIONS.find((x) => x.id === id); if (!def || !p.on[id]) return false;
  if (def.module && !modules(def.module)) return false;
  if (id === 'work') return p.work.length > 0;
  if (id === 'about') return !!p.about.text;
  if (id === 'faqs') return p.faqs.length > 0;
  if (id === 'policies' || id === 'waitlist') return counts[id] === undefined || counts[id]! > 0;
  return (counts[id] ?? 0) > 0;
}
