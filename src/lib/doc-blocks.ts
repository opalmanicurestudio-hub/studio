// src/lib/doc-blocks.ts — THE BLOCKS A DOCUMENT IS MADE OF (approved design, canvas rows 22–23). A document's `sections`
// are blocks, each { id, type, heading, body, ... }:
//   text      a heading and a paragraph
//   step      a numbered step; may carry photos (images[]) and a timer (timerMin) for "Do it with me"
//   checklist one item per line (ids in itemIds — lib/doc-items); lines can need a photo; ticked in runs
//   warning   something that must not go wrong
//   tip       a helpful extra
//   photo     a picture with a caption (images[0], body = caption)
//   video     a video link (YouTube, Vimeo, or a video file link) with a caption
//   normal    (client aftercare) what's normal afterwards — one per line, shown green with ticks
//   callus    (client aftercare) when to get in touch — one per line, shown red, with the Something's wrong button
// Signing can ask a quick check first (doc.quiz: [{ id, q, options[], answer }]) and a drawn signature
// (doc.requireSignature). Pure — the editor, readers and the print page share it.

export type BlockType = 'text' | 'step' | 'checklist' | 'warning' | 'tip' | 'photo' | 'video' | 'normal' | 'callus';
export const BLOCKS: Array<{ type: BlockType; label: string; hint: string; client?: boolean }> = [
  { type: 'step', label: 'Step', hint: 'A numbered step, with photos or a timer' },
  { type: 'checklist', label: 'Checklist', hint: 'One item per line — ticked off each time' },
  { type: 'warning', label: 'Warning', hint: 'Something that must not go wrong' },
  { type: 'tip', label: 'Tip', hint: 'A helpful extra' },
  { type: 'photo', label: 'Photo', hint: 'A picture with a caption' },
  { type: 'video', label: 'Video', hint: 'A YouTube, Vimeo or video link' },
  { type: 'text', label: 'Text', hint: 'A heading and a paragraph' },
  { type: 'normal', label: 'What’s normal', hint: 'What clients can expect afterwards — one per line', client: true },
  { type: 'callus', label: 'Contact us if', hint: 'When clients should get in touch — one per line', client: true },
];
/** The blocks a document of this kind offers (aftercare gets the client blocks; it has no checklists). */
export const blocksFor = (category?: string) => BLOCKS.filter((b) => (category === 'aftercare' ? b.type !== 'checklist' : !b.client));
/** One line per item, for the client blocks. */
export const lines = (b: any) => String(b?.body || '').split('\n').map((x) => x.trim()).filter(Boolean);
export const blockLabel = (t?: string) => BLOCKS.find((b) => b.type === t)?.label || 'Text';
export const MAX_BLOCKS = 40;
export const MAX_IMAGES = 4;

/** Clean one block for saving (lengths capped, unknown fields dropped). */
export function cleanBlock(x: any) {
  const type: BlockType = (BLOCKS.some((b) => b.type === x?.type) ? x.type : 'text') as BlockType;
  const out: any = { id: String(x?.id || ''), type, heading: String(x?.heading || '').trim().slice(0, 140), body: String(x?.body || '').trim().slice(0, 8000) };
  if (type === 'step' || type === 'photo') out.images = (Array.isArray(x?.images) ? x.images : []).filter((u: any) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, type === 'photo' ? 1 : MAX_IMAGES);
  if (type === 'step') { const m = Math.round(Number(x?.timerMin) || 0); if (m > 0) out.timerMin = Math.min(240, m); }
  if (type === 'video') out.url = /^https:\/\//.test(String(x?.url || '')) ? String(x.url).slice(0, 500) : '';
  if (type === 'checklist') out.photoLines = Array.isArray(x?.photoLines) ? x.photoLines : [];
  return out;
}
/** A block worth keeping: has words, a picture or a video. */
export const blockHasContent = (b: any) => !!(b.heading || b.body || (b.images && b.images.length) || b.url);

/** A video link → what to show: an embeddable player (YouTube, Vimeo) or a plain video file. */
export function videoEmbed(url: string): { kind: 'embed' | 'file' | 'link'; src: string } | null {
  const u = String(url || '').trim(); if (!/^https:\/\//.test(u)) return null;
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'embed', src: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) || /firebasestorage\.googleapis\.com/.test(u)) return { kind: 'file', src: u };
  return { kind: 'link', src: u };
}

/** Mostly a checklist (opening, closing): read it checklist-first on a phone. */
export function checklistFirst(sections: any[]) {
  const s = (sections || []).filter(Boolean); const lists = s.filter((x) => x.type === 'checklist').length;
  return lists > 0 && lists >= s.filter((x) => x.type === 'step').length && s.filter((x) => x.type === 'checklist').reduce((n, x) => n + String(x.body || '').split('\n').filter((l: string) => l.trim()).length, 0) >= 3;
}

/** The screens of "Do it with me": every step (and warnings, so they're seen at the right moment). */
export function walkthrough(sections: any[]) {
  const steps = (sections || []).filter((x) => x && (x.type === 'step' || x.type === 'warning'));
  return steps.length ? steps : (sections || []).filter((x) => x && blockHasContent(x) && x.type !== 'checklist');
}

/** The quick check: cleaned questions (2–4 options, a right answer). */
export function cleanQuiz(q: any): Array<{ id: string; q: string; options: string[]; answer: number }> {
  return (Array.isArray(q) ? q : []).map((x: any) => {
    const options = (Array.isArray(x?.options) ? x.options : []).map((o: any) => String(o || '').trim().slice(0, 160)).filter(Boolean).slice(0, 4);
    return { id: String(x?.id || Math.random().toString(36).slice(2, 8)), q: String(x?.q || '').trim().slice(0, 240), options, answer: Math.max(0, Math.min(options.length - 1, Number(x?.answer) || 0)) };
  }).filter((x) => x.q && x.options.length >= 2).slice(0, 6);
}
/** Grade answers; a wrong one sends them back to read that part again. */
export function gradeQuiz(quiz: ReturnType<typeof cleanQuiz>, picks: Record<string, number>) {
  const wrong = quiz.filter((x) => picks[x.id] !== x.answer).map((x) => x.id);
  return { right: quiz.length - wrong.length, total: quiz.length, passed: wrong.length === 0, wrong };
}
