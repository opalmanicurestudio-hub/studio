// src/lib/settings-search.ts — FINDING ONE SETTING. Every row on every Settings page (lib/settings-rows, read from the
// pages themselves) searched by the words in it, limited to the tools the business uses, each result opening its page
// pointed at that row (?find=…). Loaded only when someone starts typing in a Settings search.
import { SETTINGS_ROWS, type SettingsRow } from '@/lib/settings-rows';
import { visibleGroups, withParam, settingsPageAt, type SettingsGroup, type SettingsPageEntry } from '@/lib/settings-registry';
import { moduleEnabled, type ModuleId } from '@/lib/modules';

export interface RowHit { group: SettingsGroup; page: SettingsPageEntry; label: string; href: string; needsOther: boolean }

/** Lowercase words, US and UK spellings alike (cancelling, colour, and part-typed: "cancelli"), punctuation as spaces. */
export const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/cancell(?=[ei])/g, 'cancel').replace(/colo(u)r/g, 'color').replace(/programme/g, 'program')
  .replace(/[^a-z0-9%$ ]+/g, ' ').replace(/\s+/g, ' ').trim();

type Prepared = { l: string; n: string; tight: string; words: string[]; m?: string; c?: 1; q?: string };
const prepared = new Map<string, Prepared[]>();
function rowsOf(key: string): Prepared[] {
  let p = prepared.get(key);
  if (!p) {
    p = (SETTINGS_ROWS[key] || []).map((r: SettingsRow) => {
      const e = typeof r === 'string' ? { l: r } : r; const n = norm(e.l);
      return { ...e, n, tight: n.replace(/ /g, ''), words: n.split(' ') };
    });
    prepared.set(key, p);
  }
  return p;
}

/** Every query word starts a word of the label, in the same order. */
function inOrder(words: string[], q: string[]): boolean {
  let at = 0;
  for (const w of q) { const i = words.findIndex((x, k) => k >= at && x.startsWith(w)); if (i < 0) return false; at = i + 1; }
  return true;
}

/** Every query word starts a different word of the label, in any order ("shared tips"); only for whole-ish words, so
 *  "wi fi" doesn't match "without finishing". */
function anyOrder(words: string[], q: string[]): boolean {
  const used = new Set<number>();
  for (const w of q) { const i = words.findIndex((x, k) => !used.has(k) && x.startsWith(w)); if (i < 0) return false; used.add(i); }
  return true;
}

export function searchRows(tenant: any, query: string, limit = 8): RowHit[] {
  const n = norm(query); if (n.length < 2) return [];
  const q = n.split(' '); const tightQ = n.replace(/ /g, '');
  const out: (RowHit & { score: number })[] = [];
  for (const g of visibleGroups(tenant)) for (const p of g.pages) {
    if (p.inShell === false) continue;
    for (const r of rowsOf(`${g.id}/${p.id}`)) {
      if (r.m && !moduleEnabled(tenant, r.m as ModuleId)) continue;
      const tight = tightQ.length >= 3 && r.tight.includes(tightQ);
      const ordered = tight || inOrder(r.words, q);
      if (!ordered && !(q.length > 1 && q.every((w) => w.length >= 3) && anyOrder(r.words, q))) continue;
      const score = (r.n.startsWith(n) ? 0 : r.n.includes(n) ? 1 : ordered ? 2 : 3) + r.n.length / 1000;
      let href = withParam(p.href, 'find', r.l);
      if (r.q) for (const [k, v] of new URLSearchParams(r.q)) href = withParam(href, k, v);
      out.push({ group: g, page: p, label: r.l, href, needsOther: !!r.c, score });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit).map(({ score, ...h }) => h);
}

/** Whether a row needs another setting turned on before it shows, on the page at this address (the same words can be
 *  a plain row on one page and a dependent one on another). */
export function rowNeedsOtherAt(label: string, pathname: string, tab: string | null, hash = ''): boolean {
  const at = settingsPageAt(pathname, tab, hash); if (!at) return false;
  const want = norm(label);
  return rowsOf(`${at.group.id}/${at.page.id}`).some((r) => r.n === want && !!r.c);
}
