// src/lib/markup/describe.ts — EVERY MARK IN PLAIN WORDS (board 17B, "What Mia will see"). Before a client sends their
// photos they see each photo's marks and note written out, and the same words go with the photo for anyone using a
// screen reader, and for any screen where the marks are hard to make out. Pure.
import type { MarkupDoc, Mark, Layer } from './model';
import { NAIL_LENGTHS } from './model';

const N = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number, one: string, many: string) => (n === 1 ? `${one.startsWith('a') || one.startsWith('e') || one.startsWith('i') || one.startsWith('o') || one.startsWith('u') ? 'an' : 'a'} ${one}` : `${N[n] || n} ${many}`);
const STAMP_WORDS: Record<string, [string, string]> = { heart: ['heart', 'hearts'], star: ['star', 'stars'], sparkle: ['sparkle', 'sparkles'], tick: ['check mark', 'check marks'], cross: ['cross', 'crosses'], warning: ['warning sign', 'warning signs'], target: ['target', 'targets'], arrow: ['arrow stamp', 'arrow stamps'] };
const KIND_WORDS: Record<string, [string, string]> = { pen: ['drawn line', 'drawn lines'], highlight: ['highlight', 'highlights'], line: ['straight line', 'straight lines'], arrow: ['arrow', 'arrows'], circle: ['circle', 'circles'], rect: ['box', 'boxes'], lens: ['close-up', 'close-ups'], blur: ['blurred area', 'blurred areas'] };

/** The marks on the layers given, as short phrases in a steady order: pins first, then shapes, guides, stamps, labels. */
export function markPhrases(doc: MarkupDoc, layers: Layer[] = ['client', 'team']): string[] {
  const ms = doc.marks.filter((m) => layers.includes(m.layer));
  const out: string[] = [];
  const pins = ms.filter((m) => m.kind === 'pin');
  if (pins.length) out.push(`${count(pins.length, 'pin', 'pins')}${pins.some((p) => p.pin?.note) ? (pins.length === 1 ? ' with a note' : pins.every((p) => p.pin?.note) ? ' with notes' : ', some with notes') : ''}`);
  for (const k of ['circle', 'rect', 'arrow', 'line', 'pen', 'highlight', 'lens', 'blur']) { const n = ms.filter((m) => m.kind === k).length; if (n) out.push(count(n, KIND_WORDS[k][0], KIND_WORDS[k][1])); }
  const nails = ms.filter((m) => m.kind === 'nail' && m.nail);
  if (nails.length) {
    const shapes = [...new Set(nails.map((m) => m.nail!.shape))]; const lens = [...new Set(nails.map((m) => m.nail!.length))];
    const len = (l: string) => (NAIL_LENGTHS.find((x) => x.key === l)?.label || l).toLowerCase();
    out.push(`${shapes.length === 1 ? shapes[0] : 'mixed'} nail guide${nails.length === 1 ? '' : 's'}, ${lens.length === 1 ? `${len(lens[0])} length` : 'mixed lengths'}`);
  }
  const stamps = ms.filter((m) => m.kind === 'stamp' && m.stamp);
  for (const k of Object.keys(STAMP_WORDS)) { const n = stamps.filter((m) => m.stamp === k).length; if (n) out.push(count(n, STAMP_WORDS[k][0], STAMP_WORDS[k][1])); }
  ms.filter((m) => m.kind === 'text' && m.text).forEach((m) => out.push(`the label “${m.text}”`));
  return out;
}

/** The parts of a photo's line, as they'd sit mid-sentence. */
function lineParts(doc: MarkupDoc | null, note?: string, layers?: Layer[]): string[] {
  const parts = doc ? markPhrases(doc, layers) : [];
  const cs = doc?.colors || [];
  if (cs.length) parts.push(`${cs.length === 1 ? 'picked color' : 'picked colors'} ${cs.map((c) => c.toUpperCase()).join(', ')}`);
  const n = String(note ?? doc?.note ?? '').replace(/\n?Colou?rs I picked:[\s\S]*$/, '').trim();
  if (n) parts.push(`“${n}”`);
  return parts;
}
/** One photo, in a line: its marks, colors picked and note ("3 pins with notes · a circle · “This shape, but shorter.”"). */
export function photoLine(doc: MarkupDoc | null, note?: string, layers?: Layer[]): string {
  const line = lineParts(doc, note, layers).join(' · ');
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : 'No marks or note';
}

/** Every pin and its note, in number order ("1. Keep the cuticle area clean"). */
export const pinLines = (doc: MarkupDoc, layers: Layer[] = ['client', 'team']): string[] =>
  doc.marks.filter((m): m is Mark & { pin: { n: number; note: string } } => m.kind === 'pin' && !!m.pin && layers.includes(m.layer)).sort((a, b) => a.pin.n - b.pin.n).map((m) => `${m.pin.n}. ${m.pin.note || 'No note'}`);

/** For screen readers: the photo's marks, then each pin's note. */
export function altText(doc: MarkupDoc | null, note?: string, layers?: Layer[]): string {
  const line = lineParts(doc, note, layers).join(' · ');
  const pins = doc ? pinLines(doc, layers).filter((l) => !/No note$/.test(l)) : [];
  return `Photo with ${line || 'no marks'}${pins.length ? `. Pins: ${pins.join('; ')}` : ''}`;
}

/** A photo's marks in a few words, for the corner of its card ("3 pins · 4 marks", "1 color", "No marks"). */
export function countChip(doc: MarkupDoc | null, colors: string[] = []): string {
  const ms = doc ? doc.marks.filter((m) => m.layer !== 'private') : [];
  const pins = ms.filter((m) => m.kind === 'pin').length; const rest = ms.length - pins;
  const parts = [pins ? `${pins} pin${pins === 1 ? '' : 's'}` : '', rest ? `${rest} mark${rest === 1 ? '' : 's'}` : ''].filter(Boolean);
  const cs = (doc?.colors.length ? doc.colors : colors).length;
  if (!parts.length && cs) return `${cs} color${cs === 1 ? '' : 's'}`;
  return parts.length ? parts.join(' · ') : 'No marks';
}
