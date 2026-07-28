/**
 * src/lib/scan-codes.ts
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Two features need real, scannable codes: the printable appointment ticket and
 * the front-desk scanner. Before this file there was exactly one QR generator in
 * the app, at QuickBookForm.tsx:917 — and it is a *dynamic import* of the
 * `qrcode` npm package wrapped in a silent try/catch:
 *
 *     const QRCode = (await import('qrcode')).default;   // throws if absent
 *     ...
 *     } catch { }                                        // renders NOTHING
 *
 * So if `qrcode` is not in package.json, that component prints a blank space and
 * says nothing about it. A ticket whose QR is silently missing is worse than no
 * ticket: the front desk finds out at the counter, with a client standing there.
 *
 * Everything here is therefore hand-written and dependency-free. Nothing to add
 * to package.json, nothing to install, nothing that can go missing at build time
 * and fail quietly at run time.
 *
 * ── What it produces ─────────────────────────────────────────────────────────
 *   qrSvg(text)        a complete <svg> string — a real QR, byte mode, error
 *                      correction level M (recovers ~15% damage, which is the
 *                      right level for a paper ticket that gets handled).
 *   code128Svg(text)   a complete <svg> string — a real Code 128-B barcode.
 *
 * Why both. A phone camera reads the QR; that is what a client scans to open
 * their check-in page. But the cheap handheld wedge scanners most salons own are
 * 1D laser units that CANNOT read a QR at all — they read the barcode. Printing
 * only one of the two guarantees that half the possible hardware fails.
 *
 *   parseScan(raw)     turns whatever a scanner typed into something lookupable.
 *   codeVariants(code) the case-tolerant candidate list for a Firestore lookup.
 *
 * Both SVG builders return plain strings with no external CSS, because the print
 * window they land in has no stylesheet at all.
 */

/* ════════════════════════════════════════════════════════════════════════════
 * GF(256) arithmetic — shared by Reed-Solomon below.
 * Primitive polynomial 0x11D, the one QR specifies.
 * ══════════════════════════════════════════════════════════════════════════ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gmul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `n` error-correction codewords. Index 0 = highest degree. */
function rsGenerator(n: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];                      // multiply by x
      next[j + 1] ^= gmul(g[j], EXP[i]);    // multiply by alpha^i
    }
    g = next;
  }
  return g;
}

/** The `ecLen` Reed-Solomon codewords for `data`. */
function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const g = rsGenerator(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = buf[i];
    if (c === 0) continue;
    // g[0] is always 1, so this zeroes buf[i] as it goes.
    for (let j = 0; j < g.length; j++) buf[i + j] ^= gmul(g[j], c);
  }
  return buf.slice(data.length);
}

/* ════════════════════════════════════════════════════════════════════════════
 * BCH codes for the format and version information areas.
 * Computed rather than pulled from a memorised lookup table — a single mistyped
 * hex constant would produce a QR that looks perfect and scans as garbage.
 * ══════════════════════════════════════════════════════════════════════════ */

function bitLength(v: number): number {
  let n = 0;
  while (v) { n++; v >>>= 1; }
  return n;
}

function bch(data: number, generator: number, totalBits: number, dataBits: number): number {
  const shifted = data << (totalBits - dataBits);
  let rem = shifted;
  const gLen = bitLength(generator);
  while (bitLength(rem) >= gLen) rem ^= generator << (bitLength(rem) - gLen);
  return shifted | rem;
}

/** 15-bit format information. `ecBits` is 0b00 for level M. */
function formatBits(ecBits: number, mask: number): number {
  return bch((ecBits << 3) | mask, 0x537, 15, 5) ^ 0x5412;
}

/** 18-bit version information, versions 7 and up only. */
function versionBits(version: number): number {
  return bch(version, 0x1f25, 18, 6);
}

/* ════════════════════════════════════════════════════════════════════════════
 * QR code, byte mode, error correction level M, versions 1 through 10.
 *
 * Version 10-M holds 213 bytes. A check-in URL is roughly sixty characters, so
 * ten versions is a wide margin; anything longer than 213 bytes is refused
 * loudly rather than truncated into an unscannable code.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Total codewords (data + EC) for versions 1..10. */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/**
 * Level-M block structure per version:
 *   [ecCodewordsPerBlock, blocksInGroup1, dataPerBlockGroup1, blocksInGroup2]
 * Group 2 blocks always hold exactly one more data codeword than group 1.
 */
const M_BLOCKS: Array<[number, number, number, number]> = [
  [0, 0, 0, 0],
  [10, 1, 16, 0],   // v1  : 16 data + 10 EC  = 26
  [16, 1, 28, 0],   // v2  : 28 + 16          = 44
  [26, 1, 44, 0],   // v3  : 44 + 26          = 70
  [18, 2, 32, 0],   // v4  : 64 + 36          = 100
  [24, 2, 43, 0],   // v5  : 86 + 48          = 134
  [16, 4, 27, 0],   // v6  : 108 + 64         = 172
  [18, 4, 31, 0],   // v7  : 124 + 72         = 196
  [22, 2, 38, 2],   // v8  : 2x38 + 2x39 + 88 = 242
  [22, 3, 36, 2],   // v9  : 3x36 + 2x37 +110 = 292
  [26, 4, 43, 1],   // v10 : 4x43 + 1x44 +130 = 346
];

/** Alignment pattern centre coordinates per version. */
const ALIGN_CENTERS: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MAX_QR_BYTES = 213;

function dataCodewordsFor(version: number): number {
  // [ecPerBlock, group1Blocks, group1DataCodewords, group2Blocks]; group 2
  // blocks always hold exactly one more data codeword than group 1.
  const [, n1, d1, n2] = M_BLOCKS[version];
  return n1 * d1 + n2 * (d1 + 1);
}

/**
 * Cross-checks M_BLOCKS against the independently-known total codeword count
 * for every version, at module load, once.
 *
 * This is not defensive padding. A single mistyped digit in M_BLOCKS would
 * still produce a QR that looks completely normal to the eye and decodes to
 * garbage or not at all — the worst possible failure, because it passes visual
 * review. Data + EC must equal the version's total; if it does not, the table
 * is wrong and `qrMatrix` refuses that version rather than emitting a square
 * that cannot be scanned.
 */
const VERSION_OK: boolean[] = (() => {
  const ok = [false];
  for (let v = 1; v <= 10; v++) {
    const [ecPerBlock, n1, , n2] = M_BLOCKS[v];
    ok.push(dataCodewordsFor(v) + ecPerBlock * (n1 + n2) === TOTAL_CODEWORDS[v]);
  }
  return ok;
})();

function capacityBytes(version: number): number {
  const countBits = version >= 10 ? 16 : 8;
  return Math.floor((dataCodewordsFor(version) * 8 - 4 - countBits) / 8);
}

/** UTF-8 bytes, so an accented client name or a curly apostrophe survives. */
function utf8Bytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  // Extremely old runtime fallback.
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0) || 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/**
 * Encodes `text` into a QR module matrix. `true` is a dark module.
 * Returns null when the text will not fit, so callers can fall back to printing
 * the code as plain text instead of rendering a broken square.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = utf8Bytes(text);
  if (bytes.length === 0 || bytes.length > MAX_QR_BYTES) return null;

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (VERSION_OK[v] && capacityBytes(v) >= bytes.length) { version = v; break; }
  }
  if (!version) return null;

  // ── Bit stream: mode indicator, character count, payload, terminator ──
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);                                  // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);

  const totalDataBits = dataCodewordsFor(version) * 8;
  push(0, Math.min(4, totalDataBits - bits.length));   // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }
  // Pad bytes alternate 0xEC / 0x11, per spec.
  const padCycle = [0xec, 0x11];
  let p = 0;
  while (dataCodewords.length < dataCodewordsFor(version)) {
    dataCodewords.push(padCycle[p++ % 2]);
  }

  // ── Split into blocks, error-correct each, then interleave ──
  const [ecPerBlock, n1, d1, n2] = M_BLOCKS[version];
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;
  for (let i = 0; i < n1 + n2; i++) {
    const len = i < n1 ? d1 : d1 + 1;
    const data = new Uint8Array(dataCodewords.slice(offset, offset + len));
    offset += len;
    blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
  }

  const interleaved: number[] = [];
  const maxData = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) interleaved.push(b.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of blocks) interleaved.push(b.ec[i]);
  }

  const finalBits: number[] = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) finalBits.push((byte >>> i) & 1);
  }

  // ── Matrix: function patterns first, then data, then the best mask ──
  const size = version * 4 + 17;
  const grid: (0 | 1)[][] = Array.from({ length: size }, () => new Array<0 | 1>(size).fill(0));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFn = (r: number, c: number, v: 0 | 1) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    grid[r][c] = v;
    isFunction[r][c] = true;
  };

  // Finder patterns, drawn together with their one-module light separators.
  //
  // `d` is the Chebyshev ring index measured from the pattern centre. Rings
  // 0..3 are the 7x7 pattern itself and ring 4 is the separator around it:
  //
  //     d: 3333333        # # # # # # #      ring 0  dark   (centre module)
  //        3222223        #         #        ring 1  dark   (3x3 core edge)
  //        3211123        #   # # #   #      ring 2  LIGHT  (the light ring)
  //        3210123   ->   #   # # #   #      ring 3  dark   (7x7 outer ring)
  //        3211123        #   # # #   #      ring 4  light  (separator)
  //        3222223        #         #
  //        3333333        # # # # # # #
  //
  // The light ring is ring 2, not ring 1 — the 3x3 dark core spans rings 0 AND
  // 1. Getting this backwards produces a square that looks like a QR code to
  // the eye but that no decoder can even locate, so it passes visual review and
  // fails in the client's hand. Verified by decoding, not by inspection.
  const finder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr, c = left + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        setFn(r, c, (d === 2 || d === 4) ? 0 : (d <= 3 ? 1 : 0));
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const v: 0 | 1 = i % 2 === 0 ? 1 : 0;
    setFn(6, i, v);
    setFn(i, 6, v);
  }

  // Alignment patterns, skipping the three finder corners.
  const centers = ALIGN_CENTERS[version];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r === 6 && c === 6) ||
        (r === 6 && c === size - 7) ||
        (r === size - 7 && c === 6);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const d = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(r + dr, c + dc, d === 1 ? 0 : 1);
        }
      }
    }
  }

  // Reserve the format areas (real values written after masking).
  //
  // `i === 6` is skipped on purpose and must stay skipped: (8,6) belongs to the
  // vertical timing column and (6,8) to the horizontal timing row. Format info
  // is 15 bits and steps over both. Writing them here would blank two timing
  // modules, which breaks the decoder's grid alignment while leaving the code
  // looking entirely correct.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) { setFn(8, i, 0); setFn(i, 8, 0); }
  }
  for (let i = 0; i < 8; i++) {
    setFn(8, size - 1 - i, 0);
    setFn(size - 1 - i, 8, 0);
  }
  setFn(size - 8, 8, 1);   // the permanently dark module

  // Reserve the version areas.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      setFn(Math.floor(i / 3), size - 11 + (i % 3), 0);
      setFn(size - 11 + (i % 3), Math.floor(i / 3), 0);
    }
  }

  // Data placement: two-module-wide columns, right to left, boustrophedon,
  // skipping the vertical timing column entirely.
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunction[r][c] && bitIdx < finalBits.length) {
          grid[r][c] = finalBits[bitIdx++] as 0 | 1;
        }
      }
    }
  }

  const maskFns: Array<(r: number, c: number) => boolean> = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  const applyMask = (target: (0 | 1)[][], mask: number) => {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFunction[r][c]) continue;
        if (maskFns[mask](r, c)) target[r][c] = (target[r][c] ^ 1) as 0 | 1;
      }
    }
  };

  const writeFormat = (target: (0 | 1)[][], mask: number) => {
    const fmt = formatBits(0b00, mask);   // level M
    //
    // Indices below are [row][column], and the orientation matters: the two
    // copies were verified bit-by-bit against a reference encoder's output, not
    // recalled. Transposing them yields a code whose finder patterns, timing
    // patterns and data are all perfectly correct and which no reader can
    // decode, because the reader looks here first to learn the mask.
    //
    // Copy 1 runs DOWN column 8 (bits 0..8, stepping over the timing row at
    // row 6) and then LEFT along row 8 (bits 9..14, stepping over column 6).
    for (let i = 0; i <= 5; i++) target[i][8] = ((fmt >>> i) & 1) as 0 | 1;
    target[7][8] = ((fmt >>> 6) & 1) as 0 | 1;
    target[8][8] = ((fmt >>> 7) & 1) as 0 | 1;
    target[8][7] = ((fmt >>> 8) & 1) as 0 | 1;
    for (let i = 9; i <= 14; i++) target[8][14 - i] = ((fmt >>> i) & 1) as 0 | 1;

    // Copy 2 runs LEFT along row 8 from the right edge (bits 0..7) and then
    // DOWN column 8 from the bottom-left finder (bits 8..14).
    for (let i = 0; i <= 7; i++) target[8][size - 1 - i] = ((fmt >>> i) & 1) as 0 | 1;
    for (let i = 8; i <= 14; i++) target[size - 15 + i][8] = ((fmt >>> i) & 1) as 0 | 1;

    target[size - 8][8] = 1;   // the permanently dark module
  };

  const writeVersion = (target: (0 | 1)[][]) => {
    if (version < 7) return;
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >>> i) & 1) as 0 | 1;
      target[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
      target[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  };

  // ── Penalty scoring, so the chosen mask is the one the spec would choose ──
  const penalty = (m: (0 | 1)[][]): number => {
    let score = 0;

    // Rule 1: runs of five or more same-colour modules in a line.
    const runScore = (line: (0 | 1)[]) => {
      let total = 0, run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) total += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) total += 3 + (run - 5);
      return total;
    };
    for (let r = 0; r < size; r++) score += runScore(m[r]);
    for (let c = 0; c < size; c++) score += runScore(m.map(row => row[c]));

    // Rule 2: every 2x2 block of one colour.
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3: the 1:1:3:1:1 finder-lookalike with four light modules either side.
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matches = (line: (0 | 1)[], at: number, pat: number[]) => {
      for (let i = 0; i < pat.length; i++) if (line[at + i] !== pat[i]) return false;
      return true;
    };
    const patScore = (line: (0 | 1)[]) => {
      let total = 0;
      for (let i = 0; i + 11 <= line.length; i++) {
        if (matches(line, i, A) || matches(line, i, B)) total += 40;
      }
      return total;
    };
    for (let r = 0; r < size; r++) score += patScore(m[r]);
    for (let c = 0; c < size; c++) score += patScore(m.map(row => row[c]));

    // Rule 4: deviation from a fifty-fifty light/dark balance.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  };

  let best: (0 | 1)[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map(row => row.slice()) as (0 | 1)[][];
    applyMask(candidate, mask);
    writeFormat(candidate, mask);
    writeVersion(candidate);
    const s = penalty(candidate);
    if (s < bestScore) { bestScore = s; best = candidate; }
  }

  return (best as (0 | 1)[][]).map(row => row.map(v => v === 1));
}

/**
 * A complete, self-contained `<svg>` string for a QR of `text`.
 * Returns '' when the text cannot be encoded, so a caller can test truthiness
 * and print the code as plain text instead.
 *
 * `size` is the finished edge length in CSS pixels. The quiet zone is included,
 * because a QR printed flush to a border is a QR that does not scan.
 */
export function qrSvg(text: string, size = 132, dark = '#0f172a'): string {
  const matrix = qrMatrix(text);
  if (!matrix) return '';
  const modules = matrix.length;
  const quiet = 4;
  const span = modules + quiet * 2;

  // One path for every dark module. Rectangles are merged along each row so the
  // markup stays small enough to inline into an email or a print document.
  let d = '';
  for (let r = 0; r < modules; r++) {
    let c = 0;
    while (c < modules) {
      if (!matrix[r][c]) { c++; continue; }
      let run = 1;
      while (c + run < modules && matrix[r][c + run]) run++;
      d += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
      c += run;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Scan to check in">` +
    `<rect width="${span}" height="${span}" fill="#ffffff"/>` +
    `<path d="${d}" fill="${dark}"/>` +
    `</svg>`
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Code 128-B — for the 1D laser wedge scanners a salon is most likely to own.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bar/space widths for values 0..106. Each entry alternates bar, space, bar…
 * starting with a bar, and sums to 11 modules (the stop pattern sums to 13).
 */
const C128_WIDTHS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const C128_START_B = 104;
const C128_STOP = 106;

/**
 * A complete, self-contained `<svg>` string for a Code 128-B barcode of `text`.
 * Returns '' if any character is outside the printable ASCII range Code 128-B
 * covers, rather than emitting a barcode that scans as the wrong string.
 *
 * `moduleWidth` is the width of one narrow bar. Two device pixels is the
 * smallest that survives a 300dpi receipt printer reliably.
 */
export function code128Svg(text: string, height = 54, moduleWidth = 2, dark = '#0f172a'): string {
  if (!text) return '';
  const values: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return '';
    values.push(code - 32);
  }

  // Weighted modulo-103 check character.
  let sum = C128_START_B;
  values.forEach((v, i) => { sum += v * (i + 1); });
  const check = sum % 103;

  const sequence = [C128_START_B, ...values, check, C128_STOP];

  let x = 0;
  let bars = '';
  for (const value of sequence) {
    const widths = C128_WIDTHS[value];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]) * moduleWidth;
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${dark}"/>`;
      x += w;
    }
  }

  // A Code 128 symbol needs a quiet zone of at least ten modules each side.
  const quiet = 10 * moduleWidth;
  const total = x + quiet * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}" ` +
    `viewBox="0 0 ${total} ${height}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Barcode ${text}">` +
    `<rect width="${total}" height="${height}" fill="#ffffff"/>` +
    `<g transform="translate(${quiet} 0)">${bars}</g>` +
    `</svg>`
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Reading a scan back in.
 * ══════════════════════════════════════════════════════════════════════════ */

export type ParsedScan =
  | { kind: 'token'; value: string; raw: string }
  | { kind: 'code'; value: string; raw: string }
  | { kind: 'empty'; value: ''; raw: string };

/**
 * Works out what a scanner (or a typing receptionist) just handed us.
 *
 *  - A full check-in URL, or anything containing `/check-in/<token>`, yields the
 *    long token. That is what the QR on the ticket encodes.
 *  - A bare 12-or-more-character string of URL-safe characters is also treated
 *    as a token: nanoid(16) check-in tokens are 16 characters, and short codes
 *    are far shorter, so the length is a clean divider.
 *  - Anything else is treated as a short code, with separators and the leading
 *    apostrophe some wedge scanners prepend stripped out.
 *
 * This never throws and never returns null — an unusable scan comes back as
 * `empty` so the caller can say so plainly.
 */
export function parseScan(raw: string): ParsedScan {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { kind: 'empty', value: '', raw: trimmed };

  // A URL, whether or not the scheme survived the scanner.
  const urlMatch = trimmed.match(/\/check-in\/([A-Za-z0-9_-]{6,})/);
  if (urlMatch) return { kind: 'token', value: urlMatch[1], raw: trimmed };

  // Some scanners emit a leading apostrophe or a trailing tab/newline.
  const cleaned = trimmed.replace(/^['"\s]+|['"\s]+$/g, '');
  if (!cleaned) return { kind: 'empty', value: '', raw: trimmed };

  if (/^[A-Za-z0-9_-]{12,}$/.test(cleaned)) {
    return { kind: 'token', value: cleaned, raw: trimmed };
  }

  const code = cleaned.replace(/[^A-Za-z0-9]/g, '');
  if (!code) return { kind: 'empty', value: '', raw: trimmed };
  return { kind: 'code', value: code, raw: trimmed };
}

/**
 * The candidate strings to try when looking a short code up.
 *
 * This exists because of a real ambiguity: `lib/short-code.ts` generates codes
 * from an alphabet that excludes the visually confusable characters (no 0/O, no
 * 1/I/L), but every place that DISPLAYS a code calls `.toUpperCase()` on it
 * defensively — which strongly suggests nobody was certain what case the
 * generator returns. Firestore equality is case-sensitive and there is no
 * lowercase mirror field, so a lookup that guessed wrong would report "not
 * found" for a perfectly valid booking. Trying all three spellings costs two
 * extra indexed reads and removes the guess.
 *
 * Ordered most-likely-first and de-duplicated, so a code that is already
 * uppercase produces exactly two candidates rather than three.
 */
export function codeVariants(code: string): string[] {
  const c = String(code ?? '').trim();
  if (!c) return [];
  const out: string[] = [];
  for (const v of [c.toUpperCase(), c, c.toLowerCase()]) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
