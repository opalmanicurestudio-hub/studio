// src/lib/doc-items.ts — CHECKLIST ITEMS THAT KEEP THEIR IDENTITY. A checklist section is typed as lines of text, and runs
// used to save each tick (and its photo) by line POSITION — so adding a line at the top of a live checklist moved every
// past tick and photo onto the wrong item. Now each line carries an id (itemIds, parallel to the lines), reused when the
// same line is still there after an edit, and photo-required lines are saved by id (photoIds). Older runs, saved by
// position, are still read for checklists that don't have ids yet.

export const checklistLines = (sec: any): string[] => String(sec?.body || '').split('\n').map((x) => x.trim()).filter(Boolean);
const newId = () => Math.random().toString(36).slice(2, 8);

/** Give each checklist line an id, reusing the old ids for lines that are still there (same text). */
export function withItemIds(sections: any[], oldSections: any[] = []) {
  return (sections || []).map((s) => {
    if ((s.type || 'text') !== 'checklist') { const { itemIds, photoIds, ...rest } = s; void itemIds; void photoIds; return rest; }
    const lines = checklistLines(s); const old = (oldSections || []).find((o) => o.id === s.id);
    const pool = new Map<string, string[]>();
    if (old) { const ol = checklistLines(old); ol.forEach((t, i) => { const id = old.itemIds?.[i]; if (id) pool.set(t, [...(pool.get(t) || []), id]); }); }
    const used = new Set<string>();
    const itemIds = lines.map((t) => { const q = pool.get(t) || []; let id = q.shift(); while (id && used.has(id)) id = q.shift(); if (!id) { do id = newId(); while (used.has(id)); } used.add(id); return id; });
    const photoIds = (Array.isArray(s.photoLines) ? s.photoLines : []).filter((n: number) => Number.isInteger(n) && n >= 0 && n < lines.length).map((n: number) => itemIds[n]);
    return { ...s, itemIds, photoIds };
  });
}

/** The key a run saves a line's tick and photo under. */
export const itemKey = (sec: any, i: number) => `${sec.id}:${Array.isArray(sec.itemIds) && sec.itemIds[i] ? sec.itemIds[i] : i}`;
export const needsPhoto = (sec: any, i: number) => (Array.isArray(sec.photoIds) && Array.isArray(sec.itemIds) ? sec.photoIds.includes(sec.itemIds[i]) : Array.isArray(sec.photoLines) && sec.photoLines.includes(i));

/** Every line key in the document as it is now (ticks for removed lines don't count). */
export function liveKeys(sections: any[]) {
  const out: string[] = []; for (const s of sections || []) if (s?.type === 'checklist') checklistLines(s).forEach((_, i) => out.push(itemKey(s, i))); return out;
}
