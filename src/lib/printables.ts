// src/lib/printables.ts
//
// PRINTABLE TESTS AND WORKSHEETS — built in the browser, printed in the
// ClarityFlow document look (doc-theme).
//   Tests       versions A/B/C… — questions AND answer choices shuffled per
//               version; cover line (name, date, score); grading scale;
//               a separate answer key per version
//   Word search words across, down and diagonal (some backwards), filled grid
//   Crossword   intersecting layout, numbered, Across/Down clues, key
//   Matching · fill in the blanks · short answer · label the diagram
// Seeded: the same seed rebuilds the same version, so a reprint matches its key.

import { esc } from '@/lib/doc-theme';

/** Small seeded random generator (mulberry32). */
export function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function shuffle<T>(xs: T[], r: () => number) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const L = 'ABCDEFGHIJ';

// ── Tests ─────────────────────────────────────────────────────────────────
export interface BankQ { q: string; options: string[]; answer: number; topic?: string | null }
export function testVersions(questions: BankQ[], versions: number, seed: number) {
  return Array.from({ length: versions }, (_, v) => {
    const r = rng(seed * 31 + v * 7919);
    const items = shuffle(questions, r).map((q) => { const order = shuffle(q.options.map((_, i) => i), r); return { q: q.q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer), topic: q.topic || null }; });
    return { label: L[v], items };
  });
}
export const GRADE_SCALE = 'A 90–100 · B 80–89 · C 70–79 · F below 70';
export function testHtml(t: { title: string; course: string; version: string; items: any[]; minutes?: number | null; scale?: string }) {
  return `<div class="grid grid3" style="margin-bottom:10px"><div class="panel">Name<div class="answer-line"></div></div><div class="panel">Date<div class="answer-line"></div></div><div class="panel">Score<div class="answer-line"></div></div></div>
    <h1>${esc(t.title)} <b>· Version ${esc(t.version)}</b></h1><p class="sub">${esc(t.course)} · ${t.items.length} questions${t.minutes ? ` · ${t.minutes} minutes` : ''} · Circle the best answer. · Passing: ${esc(t.scale || GRADE_SCALE)}</p>
    ${t.items.map((it, i) => `<div style="break-inside:avoid;margin:10px 0"><b>${i + 1}.</b> ${esc(it.q)}<div style="margin:4px 0 0 18px">${it.options.map((o: string, j: number) => `<div>${L[j]}. ${esc(o)}</div>`).join('')}</div></div>`).join('')}`;
}
export function keyHtml(t: { title: string; version: string; items: any[] }) {
  return `<h1>Answer key <b>· Version ${esc(t.version)}</b></h1><p class="sub">${esc(t.title)} — for instructors</p>
    <table><thead><tr><th>#</th><th>Answer</th><th>Topic</th></tr></thead>${t.items.map((it, i) => `<tr><td>${i + 1}</td><td><b>${L[it.answer]}</b> — ${esc(it.options[it.answer])}</td><td class="muted">${esc(it.topic || '')}</td></tr>`).join('')}</table>`;
}

// ── Word search ───────────────────────────────────────────────────────────
const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [1, -1]];   // right, down, diagonals, some backwards
export function wordSearch(words: string[], size: number, seed: number) {
  const r = rng(seed);
  const clean = [...new Set(words.map((w) => w.toUpperCase().replace(/[^A-Z]/g, '')).filter((w) => w.length >= 3 && w.length <= size))].sort((a, b) => b.length - a.length).slice(0, 18);
  const g: string[][] = Array.from({ length: size }, () => Array(size).fill(''));
  const placed: { word: string; cells: [number, number][] }[] = [];
  for (const w of clean) {
    let ok = false;
    for (let tries = 0; tries < 400 && !ok; tries++) {
      const [dr, dc] = DIRS[Math.floor(r() * DIRS.length)];
      const row = Math.floor(r() * size), col = Math.floor(r() * size);
      const cells: [number, number][] = [];
      for (let i = 0; i < w.length; i++) { const rr = row + dr * i, cc = col + dc * i; if (rr < 0 || cc < 0 || rr >= size || cc >= size || (g[rr][cc] && g[rr][cc] !== w[i])) { cells.length = 0; break; } cells.push([rr, cc]); }
      if (cells.length === w.length) { cells.forEach(([rr, cc], i) => { g[rr][cc] = w[i]; }); placed.push({ word: w, cells }); ok = true; }
    }
  }
  const A = 'ABCDEFGHIJKLMNOPRSTUVWY';
  const filled = g.map((row) => row.map((c) => c || A[Math.floor(r() * A.length)]));
  return { grid: filled, placed, missed: clean.filter((w) => !placed.find((p) => p.word === w)) };
}
export function wordSearchHtml(title: string, ws: ReturnType<typeof wordSearch>, key = false) {
  const inWord = new Set(ws.placed.flatMap((p) => p.cells.map(([a, b]) => `${a},${b}`)));
  return `<h1>${esc(title)} <b>${key ? '· Answer key' : '· Word search'}</b></h1><p class="sub">Find these ${ws.placed.length} words — across, down, diagonal, and some backwards.</p>
    <table style="width:auto;margin:0 auto;font-size:15px;letter-spacing:.08em">${ws.grid.map((row, i) => `<tr>${row.map((c, j) => `<td style="width:28px;height:28px;text-align:center;border:none;${key && inWord.has(`${i},${j}`) ? 'background:#ede9fe;font-weight:700' : key ? 'color:#d6d3d1' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>
    <div class="grid" style="margin-top:14px">${ws.placed.map((p) => `<div class="pill" style="text-align:center">${esc(p.word)}</div>`).join('')}</div>`;
}

// ── Crossword ─────────────────────────────────────────────────────────────
export function crossword(entries: { answer: string; clue: string }[], seed: number) {
  const r = rng(seed);
  const words = [...new Map(entries.map((e) => [e.answer.toUpperCase().replace(/[^A-Z]/g, ''), e.clue] as const)).entries()].filter(([w]) => w.length >= 3 && w.length <= 15)
    .sort((a, b) => b[0].length - a[0].length || r() - 0.5).slice(0, 16);
  const cells = new Map<string, string>();
  const placed: { word: string; clue: string; row: number; col: number; down: boolean }[] = [];
  const fits = (w: string, row: number, col: number, down: boolean) => {
    let crosses = 0;
    for (let i = 0; i < w.length; i++) {
      const rr = row + (down ? i : 0), cc = col + (down ? 0 : i), k = `${rr},${cc}`, cur = cells.get(k);
      if (cur && cur !== w[i]) return -1; if (cur) { crosses++; continue; }
      // no side-by-side touching of a new letter
      const n1 = down ? `${rr},${cc - 1}` : `${rr - 1},${cc}`, n2 = down ? `${rr},${cc + 1}` : `${rr + 1},${cc}`;
      if (cells.has(n1) || cells.has(n2)) return -1;
    }
    const before = down ? `${row - 1},${col}` : `${row},${col - 1}`, after = down ? `${row + w.length},${col}` : `${row},${col + w.length}`;
    if (cells.has(before) || cells.has(after)) return -1;
    return crosses;
  };
  const put = (w: string, clue: string, row: number, col: number, down: boolean) => { for (let i = 0; i < w.length; i++) cells.set(`${row + (down ? i : 0)},${col + (down ? 0 : i)}`, w[i]); placed.push({ word: w, clue, row, col, down }); };
  if (!words.length) return { placed, rows: 0, cols: 0, grid: [] as string[][], numbers: new Map<string, number>(), missed: [] as string[] };
  put(words[0][0], words[0][1], 0, 0, false);
  const missed: string[] = [];
  for (const [w, clue] of words.slice(1)) {
    let best: any = null;
    for (const p of placed) for (let i = 0; i < p.word.length; i++) for (let j = 0; j < w.length; j++) {
      if (p.word[i] !== w[j]) continue;
      const down = !p.down; const row = p.down ? p.row + i : p.row - j, col = p.down ? p.col - j : p.col + i;
      const c = fits(w, row, col, down); if (c > 0 && (!best || c > best.c || (c === best.c && r() < 0.3))) best = { row, col, down, c };
    }
    if (best) put(w, clue, best.row, best.col, best.down); else missed.push(w);
  }
  const rs = [...cells.keys()].map((k) => Number(k.split(',')[0])), cs = [...cells.keys()].map((k) => Number(k.split(',')[1]));
  const r0 = Math.min(...rs), c0 = Math.min(...cs), rows = Math.max(...rs) - r0 + 1, cols = Math.max(...cs) - c0 + 1;
  const grid = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => cells.get(`${i + r0},${j + c0}`) || ''));
  placed.forEach((p) => { p.row -= r0; p.col -= c0; });
  const starts = [...new Set(placed.map((p) => `${p.row},${p.col}`))].sort((a, b) => { const [ar, ac] = a.split(',').map(Number), [br, bc] = b.split(',').map(Number); return ar - br || ac - bc; });
  const numbers = new Map(starts.map((s, i) => [s, i + 1]));
  return { placed, rows, cols, grid, numbers, missed };
}
export function crosswordHtml(title: string, cw: ReturnType<typeof crossword>, key = false) {
  const clues = (down: boolean) => cw.placed.filter((p) => p.down === down).map((p) => ({ n: cw.numbers.get(`${p.row},${p.col}`)!, ...p })).sort((a, b) => a.n - b.n);
  const cell = 26;
  return `<h1>${esc(title)} <b>${key ? '· Answer key' : '· Crossword'}</b></h1>
    <table style="width:auto;margin:6px auto 14px;border-collapse:collapse">${cw.grid.map((row, i) => `<tr>${row.map((c, j) => c ? `<td style="width:${cell}px;height:${cell}px;border:1.5px solid #1c1917;position:relative;padding:0;text-align:center;vertical-align:middle;font-weight:600">${cw.numbers.has(`${i},${j}`) ? `<span style="position:absolute;top:1px;left:2px;font-size:8px;font-weight:600">${cw.numbers.get(`${i},${j}`)}</span>` : ''}${key ? c : ''}</td>` : `<td style="width:${cell}px;height:${cell}px;border:none;padding:0"></td>`).join('')}</tr>`).join('')}</table>
    <div class="grid grid2"><div><h2>Across</h2>${clues(false).map((c) => `<p><b>${c.n}.</b> ${esc(c.clue)}${key ? ` <span class="accent">(${c.word})</span>` : ` <span class="muted">(${c.word.length})</span>`}</p>`).join('')}</div>
    <div><h2>Down</h2>${clues(true).map((c) => `<p><b>${c.n}.</b> ${esc(c.clue)}${key ? ` <span class="accent">(${c.word})</span>` : ` <span class="muted">(${c.word.length})</span>`}</p>`).join('')}</div></div>`;
}

// ── Other worksheets ──────────────────────────────────────────────────────
export function matchingHtml(title: string, pairs: { term: string; definition: string }[], seed: number, key = false) {
  const defs = shuffle(pairs.map((p, i) => ({ ...p, i })), rng(seed));
  return `<h1>${esc(title)} <b>${key ? '· Answer key' : '· Matching'}</b></h1><p class="sub">Write the letter of the matching definition next to each term.</p>
    <div class="grid grid2"><table><thead><tr><th>Term</th><th style="width:60px">Letter</th></tr></thead>${pairs.map((p, i) => `<tr><td>${i + 1}. ${esc(p.term)}</td><td>${key ? `<b class="accent">${L[defs.findIndex((d) => d.i === i)] || ''}</b>` : ''}</td></tr>`).join('')}</table>
    <table><thead><tr><th>Definition</th></tr></thead>${defs.map((d, j) => `<tr><td><b>${L[j] || j + 1}.</b> ${esc(d.definition)}</td></tr>`).join('')}</table></div>`;
}
export function clozeHtml(title: string, items: { sentence: string; answer: string }[], key = false) {
  return `<h1>${esc(title)} <b>${key ? '· Answer key' : '· Fill in the blanks'}</b></h1>${!key ? `<div class="panel"><b>Word bank:</b> ${shuffle(items.map((x) => x.answer), rng(items.length * 97)).map(esc).join(' · ')}</div>` : ''}
    ${items.map((x, i) => `<p style="margin:10px 0"><b>${i + 1}.</b> ${esc(x.sentence).replace('____', key ? `<b class="accent"><u>${esc(x.answer)}</u></b>` : '<span style="display:inline-block;min-width:140px;border-bottom:1px solid #1c1917">&nbsp;</span>')}</p>`).join('')}`;
}
export function shortAnswerHtml(title: string, items: { question: string; answer: string }[], key = false) {
  return `<h1>${esc(title)} <b>${key ? '· Model answers' : '· Short answer'}</b></h1>
    ${items.map((x, i) => `<div style="break-inside:avoid;margin:12px 0"><b>${i + 1}.</b> ${esc(x.question)}${key ? `<p class="accent">${esc(x.answer)}</p>` : '<div class="answer-line"></div><div class="answer-line"></div><div class="answer-line"></div>'}</div>`).join('')}`;
}
export function labelHtml(title: string, a: { imageUrl: string; points: { x: number; y: number; label: string }[] }, key = false) {
  return `<h1>${esc(title)} <b>${key ? '· Answer key' : '· Label the diagram'}</b></h1><p class="sub">Write the correct name for each numbered part.</p>
    <div style="position:relative;display:inline-block;max-width:100%"><img src="${esc(a.imageUrl)}" style="max-width:100%;max-height:420px;border-radius:14px">${a.points.map((p, i) => `<span style="position:absolute;left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%);background:#1c1917;color:#fff;border-radius:999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</span>`).join('')}</div>
    <div class="grid grid2" style="margin-top:12px">${a.points.map((p, i) => `<div><b>${i + 1}.</b> ${key ? `<span class="accent">${esc(p.label)}</span>` : '<span style="display:inline-block;width:80%;border-bottom:1px solid #1c1917">&nbsp;</span>'}</div>`).join('')}</div>`;
}
