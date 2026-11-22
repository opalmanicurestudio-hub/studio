'use client';
// src/components/menu/TilesCard.tsx — THE REGISTER'S TILES, ARRANGED ON THE MENU PAGE'S SETTINGS (design board "Arrange
// tiles", A: a list on the Menu page; lib/register-tiles TileSetup; api/menu 'laneSettings' tiles). A manager picks photo
// tiles or names only, drags each section's items into the order the crew reaches for them (or moves one with the arrow
// keys), pins favorites so they lead Most sold now and their section, and hides what the counter never sells (still on
// the menu, the kiosk and online, and still found by Find or a scan). It saves as it goes, for every counter and lane.
import * as React from 'react';
import { PIN_MAX, type TileSetup } from '@/lib/register-tiles';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-3 text-[13.5px] font-semibold disabled:opacity-50 ${RING}`;

type Item = { id: string; name: string; section: string; imageUrl: string | null; onMenu?: boolean };

/** A section's items as they'll show: pinned first (in pin order), then the order set, then as on the menu; hidden ones
 *  too, in their place, to bring back. */
function rowsOf(items: Item[], s: TileSetup, section: string) {
  const pin = new Map(s.pinned.map((id, i) => [id, i])); const at = new Map(s.order.map((id, i) => [id, i]));
  return items.map((m, i) => ({ m, i })).filter((x) => x.m.section === section)
    .sort((a, b) => (pin.has(a.m.id) ? 0 : 1) - (pin.has(b.m.id) ? 0 : 1) || (pin.get(a.m.id) ?? at.get(a.m.id) ?? 1e6) - (pin.get(b.m.id) ?? at.get(b.m.id) ?? 1e6) || a.i - b.i).map((x) => x.m);
}

export function TilesCard({ start, items, call }: { start: TileSetup; items: Item[]; call: (body: any) => Promise<any> }) {
  const menu = React.useMemo(() => items.filter((m) => m.onMenu !== false), [items]);
  const [open, setOpen] = React.useState(false);
  const [setup, setSetup] = React.useState<TileSetup>(start);
  const sections = React.useMemo(() => Array.from(new Set(menu.map((m) => m.section))), [menu]);
  const [section, setSection] = React.useState<string>('');
  const shown = sections.includes(section) ? section : sections[0] || '';
  const [msg, setMsg] = React.useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const photos = menu.some((m) => !!m.imageUrl);

  // Each change shows at once and is saved; one the server refuses goes back as it was, and says why.
  const save = async (change: Partial<TileSetup>, words: string) => {
    const was = setup; setSetup({ ...setup, ...change }); setSaving(true); setMsg(null);
    const d = await call({ action: 'laneSettings', tiles: change }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    setSaving(false);
    if (d.ok && d.lane?.tiles) { setSetup(d.lane.tiles); setMsg({ text: words, tone: 'good' }); }
    else { setSetup(was); setMsg({ text: d.error || 'That didn’t save. Try again.', tone: 'warn' }); }
  };

  const rows = rowsOf(menu, setup, shown);
  const pinned = new Set(setup.pinned); const hidden = new Set(setup.hidden);
  // Moved within its own group (pinned ones among themselves, the rest among themselves): the new order is saved.
  const move = (id: string, to: number) => {
    const group = rows.filter((m) => pinned.has(m.id) === pinned.has(id)).map((m) => m.id);
    const from = group.indexOf(id); const j = Math.max(0, Math.min(group.length - 1, to)); if (from < 0 || from === j) return;
    const next = [...group]; next.splice(from, 1); next.splice(j, 0, id);
    const name = menu.find((m) => m.id === id)?.name || 'It';
    // (A pinned one keeps its place among every section's pins: it goes just before the pin now after it, or after the
    // one now before it.)
    if (pinned.has(id)) { const all = setup.pinned.filter((x) => x !== id); const after = next[j + 1], before = next[j - 1];
      const at = after !== undefined && all.includes(after) ? all.indexOf(after) : before !== undefined && all.includes(before) ? all.indexOf(before) + 1 : all.length;
      all.splice(at, 0, id); void save({ pinned: all }, `${name} moved.`); }
    else { const rest = new Set(next); void save({ order: [...setup.order.filter((x) => !rest.has(x)), ...next] }, `${name} moved.`); }
  };
  const pin = (m: Item) => {
    if (pinned.has(m.id)) { void save({ pinned: setup.pinned.filter((x) => x !== m.id) }, `${m.name} unpinned.`); return; }
    if (setup.pinned.length >= PIN_MAX) { setMsg({ text: `Up to ${PIN_MAX} pinned. Unpin one first.`, tone: 'warn' }); return; }
    void save({ pinned: [...setup.pinned, m.id], hidden: setup.hidden.filter((x) => x !== m.id) }, `${m.name} pinned: it leads Most sold now and ${m.section}.`);
  };
  const hide = (m: Item) => {
    if (hidden.has(m.id)) { void save({ hidden: setup.hidden.filter((x) => x !== m.id) }, `${m.name} is back on the tiles.`); return; }
    void save({ hidden: [...setup.hidden, m.id], pinned: setup.pinned.filter((x) => x !== m.id) }, `${m.name} hidden from the tiles. Find or a scan still adds it.`);
  };

  // Dragging a row by its handle: it follows the finger, the others make room, and it's saved where it's let go.
  const [drag, setDragState] = React.useState<{ id: string; from: number; dy: number; h: number } | null>(null);
  // (Kept beside the state too, so letting go is handled once however many events report it.)
  const dragRef = React.useRef<typeof drag>(null);
  const setDrag = (d: typeof drag) => { dragRef.current = d; setDragState(d); };
  const handleRefs = React.useRef(new Map<string, HTMLButtonElement | null>());
  const groupOf = (id: string) => rows.filter((m) => pinned.has(m.id) === pinned.has(id)).map((m) => m.id);
  const target = drag ? Math.max(0, Math.min(groupOf(drag.id).length - 1, drag.from + Math.round(drag.dy / drag.h))) : -1;
  // (While dragging, nothing moves in the page itself: the row follows the finger and the others slide to make room, so
  // the handle keeps hold of the pointer in every browser.)
  const shiftOf = (id: string): number => {
    if (!drag) return 0; if (id === drag.id) return drag.dy;
    const g = groupOf(drag.id); const i = g.indexOf(id); if (i < 0) return 0;
    if (drag.from < target && i > drag.from && i <= target) return -drag.h;
    if (drag.from > target && i >= target && i < drag.from) return drag.h;
    return 0;
  };
  const startY = React.useRef(0);
  const onDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (saving || dragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = (e.currentTarget.closest('li') as HTMLElement | null); const h = (row?.getBoundingClientRect().height || 56) + 8;
    e.currentTarget.setPointerCapture(e.pointerId); startY.current = e.clientY; setDrag({ id, from: groupOf(id).indexOf(id), dy: 0, h });
  };
  const onMove = (e: React.PointerEvent) => { const d = dragRef.current; if (d) setDrag({ ...d, dy: e.clientY - startY.current }); };
  const onUp = () => { const d = dragRef.current; if (!d) return; const to = Math.max(0, Math.min(groupOf(d.id).length - 1, d.from + Math.round(d.dy / d.h))); setDrag(null); if (to !== d.from) move(d.id, to); };
  // (The handle stays put while a move saves, so focus stays on it; one more move waits for the save.)
  const onKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); if (saving) return;
    const g = groupOf(id); move(id, g.indexOf(id) + (e.key === 'ArrowUp' ? -1 : 1));
    requestAnimationFrame(() => handleRefs.current.get(id)?.focus());
  };

  const summary = [setup.look === 'names' ? 'Names only' : photos ? 'Photo tiles' : 'Names (no photos yet)', setup.pinned.length ? `${setup.pinned.length} pinned` : '', setup.hidden.length ? `${setup.hidden.length} hidden` : ''].filter(Boolean).join(', ');
  return (
    <section aria-labelledby="tiles-title" className="rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-3xl px-5 text-left ${RING}`}>
        <span><span id="tiles-title" className="block text-[16px] font-semibold">Register tiles</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{summary}</span></span>
        <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{open ? 'Close' : 'Change'}</span>
      </button>
      {open && <div className="space-y-4 border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
        <p className="text-[14px]" style={{ color: MUTED }}>How the menu’s tiles look and sit at the counter and the drive-thru. Pinned items lead Most sold now and their section. Hidden ones stay on the menu, the kiosk and online, and Find or a scan still adds them.</p>
        <div role="radiogroup" aria-label="Tiles" className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: SOFT }}>
          {(['photos', 'names'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={setup.look === k} tabIndex={setup.look === k ? 0 : -1} disabled={saving} onClick={() => setup.look !== k && void save({ look: k }, k === 'photos' ? 'Photo tiles, with each item’s photo.' : 'Names only on the tiles.')}
            onKeyDown={(e) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); const o = k === 'photos' ? 'names' : 'photos'; void save({ look: o }, o === 'photos' ? 'Photo tiles, with each item’s photo.' : 'Names only on the tiles.'); (e.currentTarget.parentElement?.querySelectorAll('button')[o === 'photos' ? 0 : 1] as HTMLElement | undefined)?.focus(); }}
            className={`min-h-[44px] rounded-lg text-[14px] font-semibold ${RING}`} style={setup.look === k ? { background: '#fff', color: INK, boxShadow: `0 0 0 1px ${LINE}` } : { color: INK }}>{k === 'photos' ? 'Photo tiles' : 'Names only'}</button>)}
        </div>
        {setup.look === 'photos' && !photos && <p className="text-[13.5px]" style={{ color: MUTED }}>No item has a photo yet, so the tiles show names until one does. Add photos on the Items tab.</p>}
        {sections.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Menu sections">
          {sections.map((s) => <button key={s} type="button" role="tab" aria-selected={s === shown} onClick={() => setSection(s)} className={`min-h-[44px] shrink-0 rounded-full px-4 text-[14px] font-semibold ${RING}`} style={s === shown ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{s}</button>)}
        </div>}
        <ul className="space-y-2" aria-label={`${shown}, in the order the tiles show`} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
          {rows.map((m) => { const isPin = pinned.has(m.id), isHid = hidden.has(m.id), dragging = drag?.id === m.id, dy = shiftOf(m.id);
            return (
              <li key={m.id} className="flex items-center gap-2.5 rounded-2xl border py-1.5 pl-1 pr-2" style={{ borderColor: dragging ? INK : LINE, background: isHid ? SOFT : '#fff', boxShadow: dragging ? '0 6px 18px rgba(22,23,26,0.14)' : undefined, position: 'relative', zIndex: dragging ? 2 : undefined,
                transform: dy ? `translateY(${dy}px)` : undefined, transition: drag && !dragging ? 'transform 150ms ease' : undefined }}>
                <button type="button" ref={(el) => { handleRefs.current.set(m.id, el); }} aria-label={`Move ${m.name}: drag, or use the up and down arrow keys`}
                  onPointerDown={(e) => onDown(e, m.id)} onLostPointerCapture={onUp} onKeyDown={(e) => onKey(e, m.id)} className={`flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-lg ${RING}`} style={{ touchAction: 'none', color: MUTED }}>
                  <svg aria-hidden viewBox="0 0 12 18" className="h-[18px] w-3" fill="currentColor">{[0, 1, 2].flatMap((r) => [0, 1].map((c) => <circle key={`${r}${c}`} cx={3 + c * 6} cy={3 + r * 6} r="1.6" />))}</svg>
                </button>
                {photos && <span className="h-9 w-12 shrink-0 overflow-hidden rounded-lg" style={{ background: SOFT }} aria-hidden>{m.imageUrl && <img src={m.imageUrl} alt="" className="h-full w-full object-cover" style={{ opacity: isHid ? 0.45 : 1 }} />}</span>}
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium" style={{ color: isHid ? MUTED : INK }}>{m.name}</span>
                <button type="button" aria-pressed={isPin} disabled={saving} onClick={() => pin(m)} className={btn} style={isPin ? { background: INK, color: '#fff' } : { background: isHid ? '#fff' : SOFT, color: INK }}>{isPin ? 'Pinned' : 'Pin'}</button>
                <button type="button" aria-pressed={isHid} disabled={saving} onClick={() => hide(m)} className={btn} style={isHid ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{isHid ? 'Hidden' : 'Hide'}</button>
              </li>); })}
        </ul>
        <p className="text-[13px]" style={{ color: MUTED }}>Drag a row by its handle, or focus the handle and use the arrow keys. Pinned items stay at the top, up to {PIN_MAX}.</p>
        <p role={msg?.tone === 'warn' ? 'alert' : 'status'} className={msg ? 'text-[14px]' : 'sr-only'} style={{ color: msg?.tone === 'warn' ? AMBER : GREEN }}>{saving ? 'Saving…' : msg?.text || ''}</p>
      </div>}
    </section>
  );
}
