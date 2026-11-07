// src/lib/client-photos.ts — EVERY PHOTO OF A CLIENT, ON THEIR PAGE (board 18D). From each of their visits: the
// inspiration photos they sent (and earlier ones a newer set replaced), the photo of how it looks now, and after photos
// from the team; and photos brought over from another app. Grouped by visit, newest first, each with what it is, who
// sent or took it and when, so a photo's record can say where it came from. Pure: no browser, no database.
import { photoKey } from './markup/team';

export type PhotoKind = 'inspiration' | 'earlier' | 'now' | 'after' | 'imported';
/** What a photo is, in a word (its label on the page). */
export const KIND_LABEL: Record<PhotoKind, string> = { inspiration: 'Inspiration', earlier: 'Earlier inspiration', now: 'Now', after: 'After', imported: 'Brought over' };
/** The filters on the page, in order: each shows only when there's a photo for it. */
export const FILTERS: { key: 'all' | 'inspiration' | 'before' | 'after' | 'imported'; label: string; kinds: PhotoKind[] }[] = [
  { key: 'all', label: 'All', kinds: ['inspiration', 'earlier', 'now', 'after', 'imported'] },
  { key: 'inspiration', label: 'Inspiration', kinds: ['inspiration', 'earlier'] },
  { key: 'before', label: 'Before', kinds: ['now'] },
  { key: 'after', label: 'After', kinds: ['after'] },
  { key: 'imported', label: 'Brought over', kinds: ['imported'] },
];

export type ClientPhoto = {
  /** The same for the same photo everywhere (lib/markup/team photoKey). */
  id: string;
  kind: PhotoKind;
  url: string;
  /** The photo before the client's marks (kept privately), and their marks. */
  original: string | null; markup: string | null;
  note: string;
  apptId: string | null;
  /** Its number among the photos of its kind on the visit ("Inspiration photo 2"). */
  n: number;
  /** Who it came from, and how: the client when booking, from their visit link, or earlier; the team; another app. */
  source: 'booking' | 'visit_link' | 'earlier' | 'team' | 'imported';
  /** When it was sent or taken (ms; 0 when not known). */
  at: number;
  /** One of the photos on the visit now (the team can mark it up and send it back). */
  current: boolean;
  /** The app it was brought over from. */
  from?: string | null;
};
export type VisitPhotos = { apptId: string; at: number; service: string; provider: string; status: string; photos: ClientPhoto[] };

const ms = (v: any) => { const t = v?.toDate ? v.toDate().getTime() : typeof v === 'number' ? v : Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
const urlOf = (p: any) => (typeof p === 'string' ? p : String(p?.url || ''));

/** A client's photos: by visit (newest first), and those brought over from another app. */
export function clientPhotos(o: { client: any; appointments: any[]; services?: any[]; staff?: any[] }): { visits: VisitPhotos[]; imported: ClientPhoto[] } {
  const svcName = (a: any) => String(a?.serviceName || (o.services || []).find((s: any) => s?.id === a?.serviceId)?.name || 'Visit');
  const who = (a: any) => { const s = (o.staff || []).find((x: any) => x?.id === a?.staffId); return String(s?.name || a?.staffName || '').trim().split(/\s+/)[0] || ''; };
  const visits: VisitPhotos[] = [];
  for (const a of o.appointments || []) {
    if (!a?.id) continue;
    const seen = new Set<string>(); const photos: ClientPhoto[] = [];
    const add = (p: any, kind: PhotoKind, extra: Partial<ClientPhoto>) => {
      const url = urlOf(p); if (!url || seen.has(url)) return; seen.add(url);
      photos.push({ id: photoKey(url), kind, url, original: typeof p?.original === 'string' ? p.original : null, markup: typeof p?.markup === 'string' ? p.markup : null, note: String(p?.note || '').slice(0, 300),
        apptId: String(a.id), n: photos.filter((x) => x.kind === kind).length + 1, source: 'booking', at: 0, current: false, ...extra });
    };
    // The client's photos now: from the visit link (after the team asked for new ones), else from booking.
    const fromLink = !!a.inspoReview?.sentAt && Array.isArray(a.inspirationPhotosEarlier) && a.inspirationPhotosEarlier.length > 0;
    const now: any[] = Array.isArray(a.inspirationPhotos) && a.inspirationPhotos.length ? a.inspirationPhotos : a.inspirationPhotoUrl ? [{ url: a.inspirationPhotoUrl }] : [];
    now.forEach((p) => add(p, 'inspiration', { source: fromLink ? 'visit_link' : 'booking', at: fromLink ? ms(a.inspoReview.sentAt) : ms(a.createdAt), current: true }));
    if (a.nowPhoto?.url) add(a.nowPhoto, 'now', { source: 'booking', at: ms(a.createdAt) });
    (Array.isArray(a.afterPhotoUrls) ? a.afterPhotoUrls : []).forEach((u: any) => add(u, 'after', { source: 'team', at: ms(a.completedAt || a.endTime || a.startTime) }));
    (Array.isArray(a.inspirationPhotosEarlier) ? a.inspirationPhotosEarlier : []).forEach((p: any) => add(p, 'earlier', { source: 'earlier', at: ms(a.createdAt) }));
    if (photos.length) visits.push({ apptId: String(a.id), at: ms(a.startTime), service: svcName(a), provider: who(a), status: String(a.status || ''), photos });
  }
  visits.sort((x, y) => y.at - x.at);
  const files: any[] = Array.isArray(o.client?.importedFiles) ? o.client.importedFiles : [];
  const imported: ClientPhoto[] = files.filter((f, i) => f?.kind === 'photo' && f?.url && files.findIndex((g) => g?.kind === 'photo' && g?.url === f.url) === i).map((f, i) => ({ id: photoKey(String(f.url)), kind: 'imported' as const, url: String(f.url), original: null, markup: null, note: String(f.name || '').slice(0, 120),
    apptId: null, n: i + 1, source: 'imported' as const, at: ms(f.importedAt), current: false, from: f.importedFrom ? String(f.importedFrom) : null }));
  return { visits, imported };
}

/** How many photos each filter has. */
export function filterCounts(visits: VisitPhotos[], imported: ClientPhoto[]): Record<string, number> {
  const all = [...visits.flatMap((v) => v.photos), ...imported];
  return Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((p) => f.kinds.includes(p.kind)).length]));
}

/** Which of a client's photos can be removed from their page: only the photos they sent (after photos are part of the
 *  visit's record, and photos brought over stay as they came). */
export const removable = (p: Pick<ClientPhoto, 'kind'>) => p.kind === 'inspiration' || p.kind === 'earlier' || p.kind === 'now';
