'use client';
// src/components/menu/SpanishMenu.tsx — THE SPANISH COLUMN on the Menu page (lib/guest-lang; design board "The boards and
// the assistant in Spanish"): beside each item's name, its name in Spanish (and its description, when it has one); beside
// each section's name, the section's; and the menus by time of day. Each saves when the field is left. Guest screens set
// to Español show these, and the voice assistant knows them; one left blank shows the English. Above the menu, how many
// items still have none.
import { useState } from 'react';
import { money } from '@/lib/menu-choices';
import { ES_DAYPART_MAX, ES_NAME_MAX, ES_SECTION_MAX, ES_WORDS_MAX, spanishLeft } from '@/lib/guest-lang';
import type { MenuItem } from '@/lib/menu-server';
import type { Daypart } from '@/lib/menu-time';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const input = 'w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] outline-none focus:border-[#16171a]';
export type Spanish = { sections: Record<string, string>; dayparts: Record<string, string> };
type Call = (body: any) => Promise<any>;
type Mark = 'saving' | 'saved' | string;

/** The line above the menu: how many items still need a Spanish name, and the button that shows the column. */
export function SpanishBar({ items, on, onToggle }: { items: MenuItem[]; on: boolean; onToggle: () => void }) {
  const total = items.filter((m) => m.onMenu !== false).length; const left = spanishLeft(items);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-3xl border bg-[#fff] px-4 py-3 sm:px-5" style={{ borderColor: LINE }}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">Spanish for guest screens</span>
        <span className="block text-[13px]" style={{ color: MUTED }}>{!total ? 'Nothing on the menu yet.' : left ? `${left} of ${total} ${total === 1 ? 'item still needs' : 'items still need'} a Spanish name.` : 'Every item has a Spanish name.'} Screens set to Español show them; one left blank shows the English.</span>
      </span>
      <button type="button" aria-pressed={on} onClick={onToggle} className={`min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold ${RING}`}
        style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>{on ? 'Done' : left ? 'Add Spanish names' : 'Change Spanish names'}</button>
    </div>
  );
}

/** One field that saves itself when it's left (only when it changed). */
function Field({ id, value, label, placeholder, max, mark, onSave }: { id: string; value: string; label: string; placeholder: string; max: number; mark?: Mark; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const status = mark === 'saving' ? 'Saving…' : mark === 'saved' ? 'Saved' : mark || '';
  return (
    <span className="block">
      <input id={id} value={v} onChange={(e) => setV(e.target.value.slice(0, max))} onBlur={() => { if (v.trim() !== value.trim()) onSave(v.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label={label} aria-describedby={status ? `${id}-s` : undefined}
        placeholder={placeholder} lang="es" className={input} style={{ borderColor: mark && mark !== 'saving' && mark !== 'saved' ? AMBER : LINE }} />
      <span id={`${id}-s`} role="status" className={status ? 'mt-1 block text-[12.5px]' : 'sr-only'} style={{ color: mark === 'saved' ? GREEN : mark === 'saving' ? MUTED : AMBER }}>{status}</span>
    </span>
  );
}

/** The menu with its Spanish column: the menus by time of day first, then each section and its items. */
export function SpanishMenu({ sections, dayparts, spanish, call, onItem, onSpanish }: {
  sections: [string, MenuItem[]][]; dayparts: Daypart[]; spanish: Spanish; call: Call;
  onItem: (itemId: string, patch: { nameEs?: string | null; wordsEs?: string | null }) => void; onSpanish: (s: Spanish) => void;
}) {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const save = async (k: string, body: any, done: (d: any) => void) => {
    setMarks((m) => ({ ...m, [k]: 'saving' }));
    const d = await call({ action: 'spanish', ...body });
    if (d.ok) { done(d); setMarks((m) => ({ ...m, [k]: 'saved' })); } else setMarks((m) => ({ ...m, [k]: d.error || 'That didn’t save. Try again.' }));
  };
  return (
    <div className="space-y-5">
      {dayparts.length > 0 && (
        <section aria-labelledby="es-dayparts" className="space-y-2">
          <h2 id="es-dayparts" className="text-[15px] font-semibold" style={{ color: MUTED }}>Menus by time of day</h2>
          <p className="text-[13px]" style={{ color: MUTED }}>Boards say “Desayuno hasta las 11 AM” and “Desayuno vuelve a las 7 AM”, so a name in the singular reads best.</p>
          <ul className="divide-y rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
            {dayparts.map((d) => (
              <li key={d.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:px-5" style={{ borderColor: LINE }}>
                <span className="text-[16px] font-semibold">{d.name}</span>
                <Field id={`es-d-${d.id}`} value={spanish.dayparts[d.id] || ''} label={`${d.name} in Spanish`} placeholder="Name in Spanish" max={ES_DAYPART_MAX} mark={marks[`d:${d.id}`]}
                  onSave={(v) => void save(`d:${d.id}`, { daypart: d.id, name: v }, (r) => onSpanish(r.spanish))} />
              </li>))}
          </ul>
        </section>)}
      {sections.map(([section, items], si) => (
        <section key={section} aria-labelledby={`es-s-${si}`} className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:px-5">
            <h2 id={`es-s-${si}`} className="text-[15px] font-semibold" style={{ color: MUTED }}>{section}</h2>
            <Field id={`es-sec-${si}`} value={spanish.sections[section] || ''} label={`Section ${section} in Spanish`} placeholder="Section name in Spanish" max={ES_SECTION_MAX} mark={marks[`s:${section}`]}
              onSave={(v) => void save(`s:${section}`, { section, name: v }, (r) => onSpanish(r.spanish))} />
          </div>
          <ul className="divide-y rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
            {items.map((m) => (
              <li key={m.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-start sm:px-5" style={{ borderColor: LINE }}>
                <span className="min-w-0 sm:pt-2.5">
                  <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-[16px] font-semibold">{m.name}</span><span className="text-[14.5px] tabular-nums" style={{ color: MUTED }}>{m.from ? `from ${money(m.startPrice)}` : money(m.price)}</span></span>
                  {m.words && <span className="mt-0.5 line-clamp-2 block text-[13.5px]" style={{ color: MUTED }}>{m.words}</span>}
                </span>
                <span className="block space-y-2">
                  <Field id={`es-n-${m.id}`} value={m.nameEs || ''} label={`${m.name} in Spanish`} placeholder="Name in Spanish" max={ES_NAME_MAX} mark={marks[`n:${m.id}`]}
                    onSave={(v) => void save(`n:${m.id}`, { itemId: m.id, name: v }, (r) => onItem(m.id, { nameEs: r.nameEs ?? null }))} />
                  {m.words && <Field id={`es-w-${m.id}`} value={m.wordsEs || ''} label={`${m.name}’s description in Spanish`} placeholder="Description in Spanish" max={ES_WORDS_MAX} mark={marks[`w:${m.id}`]}
                    onSave={(v) => void save(`w:${m.id}`, { itemId: m.id, words: v }, (r) => onItem(m.id, { wordsEs: r.wordsEs ?? null }))} />}
                </span>
              </li>))}
          </ul>
        </section>))}
    </div>
  );
}
