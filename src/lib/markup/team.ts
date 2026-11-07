// src/lib/markup/team.ts — THE TEAM'S MARKS ON A CLIENT'S PHOTO (board 17C, and 17B "The team marks up too"). The team
// marks up the photos a client sent on layers of their own: the team's marks, which the client sees on their visit
// link once they're sent, and private team notes, which never leave the team. The client's own marks stay theirs (kept
// with the photo as they sent it) and are never changed here. When the photo before its marks was kept, the team works
// on that, with the client's marks on their own layer (each can be shown or hidden, here and on the visit link);
// without it, the team works on the photo as it was sent, the client's marks part of it. What the visit link is given:
// the photo without marks, each layer of marks as its own see-through image laid over it, the team's note and their
// marks in plain words. Never a private note. Pure: no browser, no database.
import { type MarkupDoc, type Mark, cleanDoc, packDoc, LIMITS } from './model';
import { photoLine } from './describe';

/** What the team marks up on: the photo before the client's marks, or the photo as it was sent. */
export type TeamBase = 'original' | 'photo';

/** A photo's key: the same for the same link, in the browser and on the server (two rounds of FNV-1a). A new photo from
 *  the client has a new key, so marks made on an earlier one never land on it. */
export function photoKey(url: string): string {
  const s = String(url || ''); let a = 0x811c9dc5, b = (0x01000193 ^ s.length) >>> 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13); }
  return `p${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

const parse = (raw: any): MarkupDoc | null => { if (typeof raw !== 'string' || !raw || raw.length > 16000) return null; try { return cleanDoc(JSON.parse(raw)); } catch { return null; } };
const theTeams = (m: Mark) => m.layer === 'team' || m.layer === 'private';

/** The team's part of the editor's doc, as it's kept: its size and view, and only the team's marks and private notes
 *  (the colors the team picked, not the client's). */
export function teamPart(doc: MarkupDoc, clientColors: string[] = []): MarkupDoc {
  return { ...doc, marks: doc.marks.filter(theTeams), colors: doc.colors.filter((c) => !clientColors.includes(c)) };
}

/** Server side: the team's marks as kept, checked and packed (anything on the client's layer is dropped), or null. */
export function keepTeamMarkup(raw: any): string | null {
  const d = parse(raw); if (!d) return null;
  d.marks = d.marks.filter(theTeams);
  return packDoc(d);
}

/** What the team's editor opens with. On the photo before its marks: the client's marks (on their own layer) under the
 *  team's, in the team's view once they've changed it. On the photo as sent: the team's marks alone. Marks the team
 *  made on the other kind of photo don't fit and are left out (`dropped` says so). */
export function teamDocFor(o: { client?: string | null; team?: string | null; base: TeamBase; teamBase?: TeamBase | null }): { doc: MarkupDoc | null; dropped: boolean; clientColors: string[]; clientMarks: Mark[]; cut: boolean } {
  const c = o.base === 'original' ? parse(o.client) : null;
  if (c) c.marks = c.marks.filter((m) => m.layer === 'client');
  let t = parse(o.team); let dropped = false;
  if (t) t.marks = t.marks.filter(theTeams);
  if (t && (o.teamBase || o.base) !== o.base) { dropped = t.marks.length > 0 || !!t.note; t = null; }
  if (t && c && (t.w !== c.w || t.h !== c.h)) { dropped = t.marks.length > 0 || !!t.note; t = null; }
  const clientColors = c ? c.colors : []; const clientMarks = c ? c.marks : [];
  if (c) {
    const colors = [...new Set([...c.colors, ...(t ? t.colors : [])])].slice(0, LIMITS.colors);
    // Over the most a photo holds: the team's own marks are all kept (they're what's saved from here); fewer of the
    // client's are shown (theirs are never changed here, and every one of them is still sent back with their layer:
    // `clientMarks`).
    const room = Math.max(0, LIMITS.marks - (t ? t.marks.length : 0));
    return { doc: { ...c, view: t ? t.view : c.view, marks: [...c.marks.slice(0, room), ...(t ? t.marks : [])], nextPin: Math.max(c.nextPin, t?.nextPin || 1), colors, note: t?.note || '' }, dropped, clientColors, clientMarks, cut: c.marks.length > room };
  }
  return { doc: t, dropped, clientColors, clientMarks, cut: false };
}

/** One photo as the visit link shows it once the team has sent their marks. */
export type ReplyPhoto = {
  key: string; n: number;
  /** The photo without marks (or as the client sent it, when that's all there was). */
  base: string;
  /** The client's own marks, see-through, laid over `base` (only when the team worked on the photo before its marks). */
  mine: string | null;
  /** The team's marks, see-through, laid over `base`. */
  theirs: string;
  w: number; h: number;
  note: string;
  /** The team's marks in plain words. */
  line: string;
};
export type PhotosReply = { by: string | null; at: string | null; photos: ReplyPhoto[]; answer: { kind: 'ok' | 'reply'; text: string | null; at: string | null } | null; now: string | null };

/** The team's marks in plain words, for the visit link and screen readers (their layer only: never a private note). */
export const teamLine = (packed: string | null, note: string) => { const d = parse(packed); return photoLine(d ? { ...d, marks: d.marks.filter((m) => m.layer === 'team') } : null, note, ['team']); };

/** What the visit link is given: the photos the client has now that the team has sent marks for, in the client's
 *  order. Null when there are none. */
export function replyFor(a: any): PhotosReply | null {
  const r = a?.inspoReply; if (!r || typeof r !== 'object' || !r.photos || typeof r.photos !== 'object') return null;
  const now: any[] = (Array.isArray(a?.inspirationPhotos) ? a.inspirationPhotos : []).filter((p: any) => p?.url);
  const photos: ReplyPhoto[] = [];
  now.forEach((p, i) => {
    const key = photoKey(String(p.url)); const x = r.photos[key];
    if (!x || typeof x.base !== 'string' || typeof x.theirs !== 'string') return;
    photos.push({ key, n: i + 1, base: x.base, mine: typeof x.mine === 'string' ? x.mine : null, theirs: x.theirs, w: Number(x.w) || 0, h: Number(x.h) || 0, note: String(x.note || '').slice(0, LIMITS.note), line: String(x.line || '').slice(0, 600) });
  });
  if (!photos.length) return null;
  const ans = r.answer && (r.answer.kind === 'ok' || r.answer.kind === 'reply') && String(r.answer.at || '') >= String(r.at || '')
    ? { kind: r.answer.kind as 'ok' | 'reply', text: r.answer.kind === 'reply' ? String(r.answer.text || '').slice(0, 500) : null, at: r.answer.at || null } : null;
  return { by: String(r.by || '').trim().split(/\s+/)[0] || null, at: r.at || null, photos, answer: ans, now: typeof a?.nowPhoto?.url === 'string' && !a.nowPhoto.url.startsWith('/api/files/view') ? a.nowPhoto.url : null };
}
