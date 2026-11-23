// src/lib/print-picture.tsx — A SLIP DRAWN AS A PICTURE (server; design board "Stickers, labels, receipts and tickets in
// the app's look", A: quiet and bold). Each printed thing (lib/printing PrintDoc) is laid out in the app's typeface (lib/
// print-fonts) and turned into black and white dots at the printer's width, so it looks the same on every printer:
//   - the business at the top of what a guest takes home: its initial in a black tile, and its name;
//   - the number big and heavy (with the initial's tile before it on a sticker); items bold, their choices under them;
//   - thin black rules; the allergy in a black band; the total heavy; a code to scan beside the top of a label or
//     sticker, or under a receipt or check.
// Black and white only (no gray: thermal paper prints it as speckles). Cut to its height. An Epson printer gets the
// dots in ePOS-Print XML (lib/printing eposPicture); a Star printer on CloudPRNT, a PNG.
//   - Letters the typeface doesn't have: an accented one loses its accent, an emoji goes, anything else prints "?"
//     (as on a printer's own letters; an allergy line with one says to look at the screen).
//   - A code to scan is drawn in whole dots, each square of it the same size, with a quiet white border.
//   - A slip that runs off the bottom of its first drawing is drawn again taller; one that still does (far too long
//     for one picture) isn't drawn, and prints in the printer's own letters instead.
import * as React from 'react';
import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';
import { PJS_500, PJS_700, PJS_800 } from '@/lib/print-fonts';
import { initialOf, type Block, type PrintDoc } from '@/lib/printing';
// (A PNG reader and writer, plain JavaScript.)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require('pngjs') as { PNG: any };

export type Picture = { width: number; height: number; png: Buffer; bits: string };
/** A printer's width in dots: 576 for 80 mm paper, 384 for 58 mm. */
export const dotsFor = (cols: number) => (cols < 40 ? 384 : 576);

const FONTS = [500, 700, 800].map((w) => ({ name: 'PJS', data: Buffer.from(w === 500 ? PJS_500 : w === 700 ? PJS_700 : PJS_800, 'base64'), weight: w as 500 | 700 | 800, style: 'normal' as const }));
const BLACK = '#000', WHITE = '#fff';
/** The tallest picture drawn, in dots (about a meter of paper). */
const MAX_H = 8000;

// The letters the typeface has (its Latin set, the same in each weight).
const HAS = /[\x20-\x7e\u00a0-\u00ac\u00ae-\u00ff\u0102\u0131\u0152\u0153\u2013\u2014\u2018-\u201a\u201c-\u201e\u2022\u2026\u2032\u2033\u2039\u203a\u20ac\u2122\u2191\u2193\u2212]/;
const SAME: Record<string, string> = { '\u0142': 'l', '\u0141': 'L', '\u0111': 'd', '\u0110': 'D', '\u0127': 'h', '\u0126': 'H', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '\u2014', '\u201b': "'", '\u201f': '"' };
/** Text in letters the typeface can draw: an accented letter it lacks without its accent, emoji left out, and "?" for
 *  anything else (never just dropped, so a line can't look emptier than what was typed). */
export function drawable(v: unknown): string {
  let out = '';
  for (const ch of String(v ?? '').normalize('NFC').replace(/[\t\n\r\u2000-\u200a\u202f\u205f\u3000]/g, ' ')) {
    if (HAS.test(ch)) { out += ch; continue; }
    if (SAME[ch]) { out += SAME[ch]; continue; }
    if (/\p{Extended_Pictographic}|\p{Emoji_Component}|\p{M}|[\u00ad\u200b-\u200f\u2060\ufeff]/u.test(ch)) continue;
    const bare = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += bare && Array.from(bare).every((c) => HAS.test(c)) ? bare : '?';
  }
  return out;
}
const marks = (t: string) => (t.match(/\?/g) || []).length;
/** An allergy line with a letter that can't be drawn says to look at the screen, where it's written in full. */
const alertDrawn = (t: string) => { const d = drawable(t); return marks(d) > marks(String(t)) ? `${d} (see the screen)` : d; };

/** How tall it could be (more than it is: what's drawn below is cut off, what's left blank is cut away after). */
function tallest(doc: PrintDoc, W: number, s: number): number {
  const lines = (text: string, px: number, w = W) => Math.max(1, Math.ceil((String(text).length * px * 0.6) / Math.max(40, w)));
  let h = 40 * s;
  for (const b of doc.blocks) {
    if (b.k === 'brand') h += 70 * s;
    else if (b.k === 'head') h += lines(b.left, 80 * s, W - (b.mark ? 80 * s : 0) - (b.right ? W * 0.45 : 0)) * 92 * s + (b.right ? 30 : 10) * s;
    else if (b.k === 'text') h += lines(b.text, (b.bold ? 32 : 27) * s) * (b.bold ? 44 : 38) * s;
    else if (b.k === 'item') h += lines(b.name, 34 * s, W - 60 * s) * 48 * s + (b.sub || []).reduce((n, x) => n + lines(x, 26 * s, W - 60 * s) * 36 * s, 0) + 10 * s;
    else if (b.k === 'money') h += (b.bold ? 60 : 40) * s * lines(`${b.left} ${b.right}`, 27 * s);
    else if (b.k === 'alert') h += lines(b.text, 29 * s, W - 40 * s) * 42 * s + 40 * s;
    else if (b.k === 'rule') h += 34 * s;
    else if (b.k === 'qr') h += 260 * s;
  }
  return Math.min(MAX_H, Math.ceil(h * 1.35 + 80 * s));
}

/** A code to scan, made for its place: each square of it a whole number of dots (at least 4 on 80 mm paper, 3 on
 *  58 mm) and a quiet white border two squares wide, as near the size wanted as that allows. */
type Code = { src: string; size: number };
async function codeFor(data: string, s: number, beside: boolean): Promise<Code> {
  const n = QRCode.create(data, { errorCorrectionLevel: 'M' }).modules.size + 4;
  const dot = Math.max(s >= 1 ? 4 : 3, Math.floor(((beside ? 210 : 270) * s) / n));
  return { src: await QRCode.toDataURL(data, { margin: 2, scale: dot, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }), size: n * dot };
}

function Tile({ c, px }: { c: string; px: number }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: px, height: px, borderRadius: Math.round(px / 4), background: BLACK, color: WHITE, fontWeight: 800, fontSize: Math.round(px * 0.56), flexShrink: 0 }}>{c}</div>;
}

/** One block, drawn (`s`: the scale, 1 at 80 mm). */
function drawn(b: Block, s: number, qr: Map<string, Code>, key: number) {
  const px = (n: number) => Math.round(n * s);
  if (b.k === 'brand') return <div key={key} style={{ display: 'flex', alignItems: 'center', gap: px(14), marginBottom: px(10) }}>{initialOf(b.name) ? <Tile c={initialOf(b.name)} px={px(50)} /> : null}<div style={{ display: 'flex', fontWeight: 700, fontSize: px(30) }}>{drawable(b.name)}</div></div>;
  if (b.k === 'head') return (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: px(14) }}>
      {b.mark ? <Tile c={b.mark} px={px(64)} /> : null}
      <div style={{ display: 'flex', flex: 1, fontWeight: 800, fontSize: px(84), letterSpacing: px(-2), lineHeight: 1.05 }}>{drawable(b.left)}</div>
      {b.right ? <div style={{ display: 'flex', fontWeight: 700, fontSize: px(30), textAlign: 'right', maxWidth: '45%' }}>{drawable(b.right)}</div> : null}
    </div>);
  // (A line set in with spaces, under the one before it: a receipt line's choices, smaller and set in.)
  if (b.k === 'text' && /^\s{2,}\S/.test(b.text)) return <div key={key} style={{ display: 'flex', paddingLeft: px(36), fontWeight: 500, fontSize: px(24), lineHeight: 1.3 }}>{drawable(b.text.trim())}</div>;
  if (b.k === 'text') return <div key={key} style={{ display: 'flex', justifyContent: b.center ? 'center' : 'flex-start', textAlign: b.center ? 'center' : 'left', fontWeight: b.bold ? 700 : 500, fontSize: px(b.bold ? 32 : 27), lineHeight: 1.3 }}>{drawable(b.text)}</div>;
  if (b.k === 'item') return (
    <div key={key} style={{ display: 'flex', gap: px(14), marginTop: px(6), lineHeight: 1.25 }}>
      <div style={{ display: 'flex', fontWeight: 800, fontSize: px(34), minWidth: px(30) }}>{drawable(b.qty)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', fontWeight: 700, fontSize: px(34) }}>{drawable(b.name)}</div>
        {(b.sub || []).map((x, i) => <div key={i} style={{ display: 'flex', fontWeight: 500, fontSize: px(26) }}>{drawable(x)}</div>)}
      </div>
    </div>);
  if (b.k === 'money') return (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: px(16), fontWeight: b.bold ? 800 : 500, fontSize: px(b.bold ? 38 : 27), marginTop: b.bold ? px(8) : 0, lineHeight: 1.35 }}>
      <div style={{ display: 'flex', flex: 1 }}>{drawable(b.left)}</div><div style={{ display: 'flex' }}>{drawable(b.right)}</div>
    </div>);
  if (b.k === 'alert') return <div key={key} style={{ display: 'flex', background: BLACK, color: WHITE, borderRadius: px(16), padding: `${px(10)}px ${px(18)}px`, fontWeight: 700, fontSize: px(29), margin: `${px(8)}px 0`, lineHeight: 1.3 }}>{alertDrawn(b.text)}</div>;
  if (b.k === 'rule') return <div key={key} style={{ display: 'flex', height: Math.max(2, px(3)), background: BLACK, margin: `${px(14)}px 0` }} />;
  const c = qr.get(b.data);
  return c ? <div key={key} style={{ display: 'flex', justifyContent: 'center', margin: `${px(12)}px 0` }}><img src={c.src} width={c.size} height={c.size} alt="" /></div> : null;
}

/** The slip, laid out: the blocks in order; on a label or sticker, the code beside the top part (what's above the first
 *  rule) rather than under it all. Under it all, a bar edge to edge (nothing else reaches the edges): where it ends,
 *  found in the picture and cut away. */
function Slip({ doc, W, s, qr }: { doc: PrintDoc; W: number; s: number; qr: Map<string, Code> }) {
  const px = (n: number) => Math.round(n * s);
  const code = doc.qrBeside ? doc.blocks.find((b) => b.k === 'qr') as Extract<Block, { k: 'qr' }> | undefined : undefined;
  const rest = code ? doc.blocks.filter((b) => b !== code) : doc.blocks;
  const cut = code ? rest.findIndex((b) => b.k === 'rule') : -1;
  const top = code ? (cut < 0 ? rest : rest.slice(0, cut)) : [];
  const below = code ? (cut < 0 ? [] : rest.slice(cut)) : rest;
  const beside = code ? qr.get(code.data) : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: W, background: WHITE, color: BLACK, fontFamily: 'PJS' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: `${px(6)}px ${px(8)}px ${px(20)}px` }}>
        {code ? (
          <div style={{ display: 'flex', gap: px(16), alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{top.map((b, i) => drawn(b, s, qr, i))}</div>
            {beside ? <img src={beside.src} width={beside.size} height={beside.size} alt="" /> : null}
          </div>) : null}
        {below.map((b, i) => drawn(b, s, qr, 1000 + i))}
      </div>
      <div style={{ display: 'flex', width: W, height: 2, background: BLACK }} />
    </div>);
}

// Slips drawn lately, by what was asked for (a printer can ask for the same slip twice).
const made = new Map<string, Picture>();

/** The slip drawn `H` dots tall, as its pixels (what's below is cut off). */
async function drawnAt(doc: PrintDoc, W: number, s: number, qr: Map<string, Code>, H: number) {
  const res = new ImageResponse(<Slip doc={doc} W={W} s={s} qr={qr} />, { width: W, height: H, fonts: FONTS });
  return PNG.sync.read(Buffer.from(await res.arrayBuffer())) as { data: Buffer };
}

/** A slip as a picture `dots` wide; null when there's nothing on it to draw (only the cash drawer to open), or it's
 *  far too long for one picture (it prints in the printer's own letters). */
export async function slipPicture(doc: PrintDoc, dots: number, cacheKey?: string): Promise<Picture | null> {
  if (!doc?.blocks?.length) return null;
  const key = cacheKey ? `${cacheKey}|${dots}` : null;
  if (key && made.has(key)) return made.get(key)!;
  const W = dots; const s = dots / 576;
  const qr = new Map<string, Code>();
  for (const b of doc.blocks) if (b.k === 'qr' && !qr.has(b.data)) qr.set(b.data, await codeFor(b.data, s, !!doc.qrBeside));
  // Black where it's darker than half (no gray).
  const darkIn = (raw: { data: Buffer }) => (i: number) => raw.data[i + 3] > 127 && (raw.data[i] * 0.299 + raw.data[i + 1] * 0.587 + raw.data[i + 2] * 0.114) < 140;
  // Where it ends: the top of the bar edge to edge (-1: not in the picture, so it ran off the bottom).
  const endOf = (raw: { data: Buffer }, H: number) => { const dark = darkIn(raw); for (let y = H - 1; y >= 0; y--) if (dark(y * W * 4) && dark((y * W + W - 1) * 4) && dark((y * W + (W >> 1)) * 4)) { while (y > 0 && dark((y - 1) * W * 4)) y--; return y; } return -1; };
  let H = tallest(doc, W, s); let raw = await drawnAt(doc, W, s, qr, H); let end = endOf(raw, H);
  // Ran off the bottom: drawn again taller, and if it still does, not drawn at all.
  if (end < 0 && H < MAX_H) { H = Math.min(MAX_H, H * 2); raw = await drawnAt(doc, W, s, qr, H); end = endOf(raw, H); }
  if (end < 0) return null;
  const dark = darkIn(raw);
  // Cut just below the last black dot above it.
  let last = 0;
  for (let y = end - 1; y >= 0 && !last; y--) for (let x = 0; x < W; x++) if (dark((y * W + x) * 4)) { last = y; break; }
  const h = Math.min(end, last + 1 + Math.round(20 * s));
  const rowBytes = Math.ceil(W / 8); const bits = Buffer.alloc(rowBytes * h);
  const out = new PNG({ width: W, height: h, colorType: 0, inputColorType: 6 });
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const on = dark(i);
    if (on) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    const v = on ? 0 : 255; out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
  }
  const pic: Picture = { width: W, height: h, png: PNG.sync.write(out, { colorType: 0 }), bits: bits.toString('base64') };
  if (key) { made.set(key, pic); if (made.size > 60) made.delete(made.keys().next().value as string); }
  return pic;
}
