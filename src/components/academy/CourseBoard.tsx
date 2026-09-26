'use client';
// src/components/academy/CourseBoard.tsx
//
// THE COURSE BOARD — modules as cards, lessons as cards inside them.
//   • drag a lesson by its ⋮⋮ handle (touch or mouse) — it moves live, into a
//     new place or another module; let go to save
//   • ↑ ↓ move one step (past the top/bottom of a module → into the next one)
//   • modules move up/down as a whole · ＋ Add lesson in any module · ＋ New module
// The whole order is saved in one go (lessons-arrange).

import { useEffect, useRef, useState } from 'react';

type Item = { id: string; moduleTitle: string };
const group = (items: Item[]) => { const out: { title: string; ids: string[] }[] = []; for (const it of items) { const g = out.find((x) => x.title === it.moduleTitle); if (g) g.ids.push(it.id); else out.push({ title: it.moduleTitle, ids: [it.id] }); } return out; };
const flatten = (groups: { title: string; ids: string[] }[]) => groups.flatMap((g) => g.ids.map((id) => ({ id, moduleTitle: g.title })));

export function CourseBoard({ lessons, kindIcon, moduleHeader, lessonActions, lessonBadges, onArrange, onAddLesson, onNewModule }: {
  lessons: any[]; kindIcon: (kind: string) => any; moduleHeader: (title: string, first: boolean) => React.ReactNode; lessonActions: (l: any) => React.ReactNode; lessonBadges: (l: any) => React.ReactNode;
  onArrange: (items: Item[]) => Promise<void>; onAddLesson: (moduleTitle: string) => void; onNewModule: () => void;
}) {
  const initial = () => lessons.map((l) => ({ id: l.id, moduleTitle: l.moduleTitle || 'Module 1' }));
  const [items, setItems] = useState<Item[]>(initial);
  const [drag, setDrag] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const itemsRef = useRef(items); itemsRef.current = items;
  const startRef = useRef('');
  useEffect(() => { if (!drag) setItems(initial()); }, [lessons]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const save = async (next: Item[]) => { if (JSON.stringify(next) === JSON.stringify(initial())) return; setSaving(true); await onArrange(next); setSaving(false); };

  // Dragging: follow the pointer; drop before/after the card under it, or into a module's empty space.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const card = el?.closest('[data-lesson-id]') as HTMLElement | null; const zone = el?.closest('[data-module-drop]') as HTMLElement | null;
      const cur = itemsRef.current; const me = cur.find((x) => x.id === drag); if (!me) return;
      let next = cur.filter((x) => x.id !== drag);
      if (card && card.dataset.lessonId !== drag) {
        const r = card.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
        const idx = next.findIndex((x) => x.id === card.dataset.lessonId); const target = next[idx];
        next.splice(after ? idx + 1 : idx, 0, { id: drag, moduleTitle: target.moduleTitle });
      } else if (!card && zone) {
        const title = zone.dataset.moduleDrop!; const last = next.map((x) => x.moduleTitle).lastIndexOf(title);
        next.splice(last + 1, 0, { id: drag, moduleTitle: title });
      } else return;
      if (JSON.stringify(next) !== JSON.stringify(cur)) setItems(next);
    };
    const up = () => { setDrag(null); if (JSON.stringify(itemsRef.current) !== startRef.current) void save(itemsRef.current); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (id: string, dir: -1 | 1) => {
    const gs = group(items); const gi = gs.findIndex((g) => g.ids.includes(id)); const g = gs[gi]; const i = g.ids.indexOf(id);
    if ((dir === -1 && i > 0) || (dir === 1 && i < g.ids.length - 1)) { [g.ids[i], g.ids[i + dir]] = [g.ids[i + dir], g.ids[i]]; }
    else { const to = gs[gi + dir]; if (!to) return; g.ids.splice(i, 1); if (dir === -1) to.ids.push(id); else to.ids.unshift(id); }
    const next = flatten(gs.filter((x) => x.ids.length)); setItems(next); void save(next);
  };
  const moveModule = (title: string, dir: -1 | 1) => { const gs = group(items); const i = gs.findIndex((g) => g.title === title); const j = i + dir; if (j < 0 || j >= gs.length) return; [gs[i], gs[j]] = [gs[j], gs[i]]; const next = flatten(gs); setItems(next); void save(next); };
  const groups = group(items);

  return (
    <div className="space-y-4">
      {saving && <p className="text-[12px] font-bold text-muted-foreground">Saving the new order…</p>}
      {groups.map((g, gi) => (
        <section key={g.title} data-module-drop={g.title} className={`space-y-2 rounded-3xl border-2 p-3 transition ${drag ? 'border-dashed border-violet-300 bg-violet-50/30' : 'border-border/60 bg-muted/20'}`}>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1">{moduleHeader(g.title, gi === 0)}</div>
            <span className="flex shrink-0 gap-0.5"><button type="button" aria-label="Move module up" disabled={gi === 0} onClick={() => moveModule(g.title, -1)} className="h-8 w-8 rounded-lg text-sm disabled:opacity-30">↑</button><button type="button" aria-label="Move module down" disabled={gi === groups.length - 1} onClick={() => moveModule(g.title, 1)} className="h-8 w-8 rounded-lg text-sm disabled:opacity-30">↓</button></span></div>
          {g.ids.map((id) => { const l: any = byId.get(id); if (!l) return null; const I = kindIcon(l.kind); return (
            <div key={id} data-lesson-id={id} className={`flex items-center gap-2 rounded-2xl bg-background px-2 py-2 text-sm shadow-sm transition ${drag === id ? 'scale-[1.02] opacity-80 ring-2 ring-violet-400' : ''}`}>
              <button type="button" aria-label={`Drag ${l.title}`} onPointerDown={(e) => { e.preventDefault(); startRef.current = JSON.stringify(items); setDrag(id); }} className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground active:cursor-grabbing">⋮⋮</button>
              <I className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{l.title}{lessonBadges(l)}</span>
              <button type="button" aria-label="Move up" onClick={() => step(id, -1)} className="hidden h-8 w-7 rounded-lg sm:block">↑</button><button type="button" aria-label="Move down" onClick={() => step(id, 1)} className="hidden h-8 w-7 rounded-lg sm:block">↓</button>
              {lessonActions(l)}
            </div>
          ); })}
          <button type="button" onClick={() => onAddLesson(g.title)} className="h-10 w-full rounded-2xl border-2 border-dashed border-border/60 text-[13px] font-bold text-muted-foreground hover:bg-muted/40">＋ Add lesson</button>
        </section>
      ))}
      <button type="button" onClick={onNewModule} className="h-12 w-full rounded-3xl border-2 border-dashed border-foreground/30 text-sm font-black">＋ New module</button>
    </div>
  );
}
