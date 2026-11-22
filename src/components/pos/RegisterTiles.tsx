'use client';
// src/components/pos/RegisterTiles.tsx — THE REGISTER'S MENU TILES (design board "Tiles at the register", look B: the
// case, on the screen; lib/register-tiles). On the counter and the drive-thru lane screen alike:
// - With photos on the menu, each item is its own photo with its name and price under it; one without a photo is its
//   name alone. With none, tiles are names and prices, the most to a screen.
// - Most sold now first (what sells at this hour), then the menu's sections.
// - Find from any section, by a few letters or the number guests order by; a scanner still scans.
// - Tap to add, tap again for one more; the count on the tile. Press and hold (or Shift and Enter) for every choice and
//   a note. Sold out, outside its hours, and "3 left" on the tile.
// - Bigger tiles, or more to a screen, kept on this device.
// - Arrange tiles (design board "Arrange tiles", B: right on the register), for a manager: tiles loosen, drag one where it
//   goes, pin or hide it, Done. The same arrangement as the Menu page's Register tiles card (lib/register-tiles).
import * as React from 'react';
import { HOLD_MS, MOST_ID, MOST_MIN, MOST_TAB, TILE_SIZE_KEY, arranged, findTiles, fullOf, groupOf, hideChange, leftOf, moveChange, mostWithPinned, pinChange, priceOf, sectionRows, sizeOf, type TileItem, type TileSetup, type TileSize } from '@/lib/register-tiles';
import { outWords } from '@/lib/menu-stock';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
// (A long press on a phone neither selects the name nor opens the browser's own menu.)
const noCallout = { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties;

type Props<T extends TileItem> = {
  items: T[]; most: string[] | null; counts: Record<string, number>;
  /** The tab picked (null: the first, Most sold now when there is one). */
  section: string | null; onSection: (s: string | null) => void;
  /** The item being added right now; `locked`: nothing can be added (the guest is paying). */
  busyId: string | null; locked?: boolean;
  onTap: (m: T) => void;
  /** Pressed and held: its choices and a note, before it goes on the order. */
  onHold?: (m: T) => void;
  /** How the business arranges them (lib/register-tiles TileSetup): the look, the order, pinned and hidden. */
  setup?: TileSetup | null;
  /** A manager's: Arrange tiles here, each change saved (the arrangement as kept) or refused (why). */
  onArrange?: (change: Partial<TileSetup>) => Promise<TileSetup | string>;
  /** The lane screen, read at arm's length: bigger type and tabs. */
  place: 'counter' | 'lane';
};

export function RegisterTiles<T extends TileItem>({ items, most, counts, section, onSection, busyId, locked, onTap, onHold, setup, onArrange, place }: Props<T>) {
  const [arranging, setArranging] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [size, setSize] = React.useState<TileSize>('big');
  React.useEffect(() => { try { setSize(sizeOf(localStorage.getItem(TILE_SIZE_KEY))); } catch { /* private window */ } }, []);
  const pickSize = (s: TileSize) => { setSize(s); try { localStorage.setItem(TILE_SIZE_KEY, s); } catch { /* private window */ } };
  const lane = place === 'lane'; const big = size === 'big';

  const byId = React.useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  // (In the business's order, pinned first, hidden ones left out: Find and a scan still reach those.)
  const shownItems = React.useMemo(() => arranged(items, setup), [items, setup]);
  const mostItems = React.useMemo(() => mostWithPinned(most, setup).map((id) => byId.get(id)).filter((m): m is T => !!m), [most, setup, byId]);
  const sections = React.useMemo(() => Array.from(new Set(shownItems.map((m) => m.section))), [shownItems]);
  const tabs = mostItems.length >= MOST_MIN ? [MOST_ID, ...sections] : sections;
  const shown = section && tabs.includes(section) ? section : tabs[0] || null;
  const finding = q.trim().length > 0;
  const list = finding ? findTiles(items, q) : shown === MOST_ID ? mostItems : shownItems.filter((m) => m.section === shown);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  // (Arrow keys move along the tabs, as tabs do.)
  const tabKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to === null) return; e.preventDefault(); const j = (to + tabs.length) % tabs.length; onSection(tabs[j]); tabRefs.current[j]?.focus();
  };
  // Enter in Find: the one item found goes on the order, and the box clears for the next (a scan into the box is the
  // scanner's, and clears it too).
  const findKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setQ(''); return; }
    if (e.key !== 'Enter') return;
    const scanned = e.nativeEvent.defaultPrevented; e.preventDefault();
    if (scanned) { setQ(''); return; }
    const hits = findTiles(items, q); const one = hits.length === 1 ? hits[0] : null;
    if (one && !(one.off || outWords(one)) && !locked && busyId !== one.id) { onTap(one); setQ(''); }
  };
  const withPhotos = setup?.look !== 'names' && items.some((m) => !!m.imageUrl);

  const cols = withPhotos
    ? big ? (lane ? 'grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3') : (lane ? 'grid-cols-3 sm:grid-cols-4 2xl:grid-cols-5' : 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-5')
    : big ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-5';
  const tabH = lane ? 'min-h-[48px] px-5 text-[15px]' : 'min-h-[44px] px-4 text-[14px]';

  // Arranging: the menu's sections only (Most sold now follows what's pinned), every tile in its section, hidden ones too.
  if (arranging && onArrange) {
    const secs = Array.from(new Set(items.map((m) => m.section)));
    const sec = shown && shown !== MOST_ID && secs.includes(shown) ? shown : secs[0] || '';
    return <ArrangeTiles items={items} setup={setup || { look: 'photos', order: [], pinned: [], hidden: [] }} sections={secs} section={sec} onSection={onSection} photos={withPhotos} cols={cols} big={big} lane={lane} tabH={tabH} save={onArrange} onDone={() => setArranging(false)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`find-${place}`} className="sr-only">Find on the menu</label>
          <input id={`find-${place}`} type="text" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={findKey} placeholder="Find, or scan" autoComplete="off" enterKeyHint="search" data-scan-field
            className={`h-11 w-full rounded-full pl-10 pr-11 text-[15px] ${RING}`} style={{ background: lane ? '#fff' : SOFT, color: INK, border: `1px solid ${lane ? LINE : SOFT}` }} />
          <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2" fill="none" stroke={MUTED} strokeWidth="1.8" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" /></svg>
          {finding && <button type="button" onClick={() => setQ('')} aria-label="Clear" className={`absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full text-[19px] ${RING}`} style={{ color: MUTED }}>×</button>}
        </div>
        <button type="button" onClick={() => pickSize(big ? 'compact' : 'big')} aria-label={big ? 'More tiles to a screen' : 'Bigger tiles'} title={big ? 'More tiles to a screen' : 'Bigger tiles'}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${RING}`} style={{ background: lane ? '#fff' : SOFT, color: INK, border: lane ? `1px solid ${LINE}` : undefined }}>
          {big
            ? <svg aria-hidden viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill={INK}>{[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={2 + c * 6} y={2 + r * 6} width="4.4" height="4.4" rx="1.2" />))}</svg>
            : <svg aria-hidden viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill={INK}>{[0, 1].flatMap((r) => [0, 1].map((c) => <rect key={`${r}${c}`} x={2 + c * 9} y={2 + r * 9} width="7" height="7" rx="1.8" />))}</svg>}
        </button>
        {onArrange && items.length > 0 && <button type="button" onClick={() => { setQ(''); setArranging(true); }} className={`h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold ${RING}`} style={{ background: lane ? '#fff' : SOFT, color: INK, border: lane ? `1px solid ${LINE}` : undefined }}>Arrange</button>}
      </div>

      {finding
        ? <p className="text-[13.5px]" style={{ color: MUTED }} role="status">{list.length ? `${list.length} found` : 'Nothing on the menu matches. Try fewer letters.'}</p>
        : tabs.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Menu sections">
          {tabs.map((s, i) => <button key={s} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`tab-${place}-${i}`} aria-selected={s === shown} aria-controls={`tiles-${place}`} tabIndex={s === shown ? 0 : -1} onClick={() => onSection(s)} onKeyDown={(e) => tabKey(e, i)}
            className={`${tabH} shrink-0 rounded-full font-semibold ${RING}`} style={s === shown ? { background: INK, color: '#fff' } : { background: lane ? '#fff' : SOFT, color: INK, border: lane ? `1px solid ${LINE}` : undefined }}>{s === MOST_ID ? MOST_TAB : s}</button>)}
        </div>}

      <div className={`grid gap-2.5 ${lane ? 'sm:gap-3' : ''} ${cols}`} id={`tiles-${place}`} role="tabpanel" aria-label={finding ? 'Found' : shown === MOST_ID ? MOST_TAB : shown || 'Menu'}>
        {list.map((m) => <Tile key={m.id} m={m} n={counts[m.id] || 0} busy={busyId === m.id} locked={!!locked} photos={withPhotos} big={big} lane={lane} onTap={() => onTap(m)} onHold={onHold ? () => onHold(m) : undefined} hint={`hold-${place}`} />)}
      </div>
      {!finding && !list.length && items.length > 0 && <p className="rounded-2xl px-4 py-8 text-center text-[14.5px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>Everything here is hidden from the tiles. Find still adds any item, and a manager can bring tiles back on the Menu page.</p>}
      {onHold && list.length > 0 && <p id={`hold-${place}`} className="text-[13px]" style={{ color: MUTED }}>Press and hold a tile for its choices and a note (or Shift and Enter).</p>}
    </div>
  );
}

function Tile<T extends TileItem>({ m, n, busy, locked, photos, big, lane, onTap, onHold, hint }: { m: T; n: number; busy: boolean; locked: boolean; photos: boolean; big: boolean; lane: boolean; onTap: () => void; onHold?: () => void; hint: string }) {
  // Press and hold: its choices and a note (a press that becomes a scroll is neither). Held long enough, the tile shows
  // it, and the sheet opens as the finger lifts (with no click after it, so the lift can't land on the sheet). Where the browser
  // takes a long press as its own (its menu, or a right-click), the sheet opens then instead, once.
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null); const armed = React.useRef(false); const done = React.useRef(false);
  const from = React.useRef<[number, number]>([0, 0]); const [ready, setReady] = React.useState(false);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const disarm = () => { stop(); armed.current = false; setReady(false); };
  React.useEffect(() => stop, []);
  // (Opened outright: the click that may follow is swallowed, for a moment only, so the next tap or key still adds.)
  const opened = () => { disarm(); done.current = true; setTimeout(() => { done.current = false; }, 800); onHold?.(); };
  const press = onHold ? {
    onPointerDown: (e: React.PointerEvent) => { disarm(); done.current = false; if (e.pointerType === 'mouse' && e.button !== 0) return; from.current = [e.clientX, e.clientY]; timer.current = setTimeout(() => { timer.current = null; armed.current = true; setReady(true); }, HOLD_MS); },
    onPointerMove: (e: React.PointerEvent) => { if ((timer.current || armed.current) && Math.hypot(e.clientX - from.current[0], e.clientY - from.current[1]) > 10) disarm(); },
    onPointerUp: stop,
    // (A finger lifted on a tile held long enough: the sheet opens now, and no click follows it, so nothing lands on the
    // sheet as it opens and a phone that sends no click after a long press still opens it.)
    onTouchEnd: (e: React.TouchEvent) => { if (!armed.current) return; e.preventDefault(); opened(); },
    // (A finger's pointer leaves as it lifts, before the click: only a mouse moved off the tile lets go of it.)
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') disarm(); else stop(); },
    onPointerCancel: disarm,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!done.current) opened(); },
    // (Shift and Enter, or the menu key; never the Enter that ends a scan, which the scanner has taken.)
    onKeyDown: (e: React.KeyboardEvent) => { if (e.nativeEvent.defaultPrevented) return; if (e.key === 'ContextMenu' || (e.key === 'Enter' && e.shiftKey)) { e.preventDefault(); if (!done.current) opened(); } else { done.current = false; disarm(); } },
    'aria-describedby': hint,
  } : {};
  const tap = () => { if (done.current) { done.current = false; return; } if (armed.current) { disarm(); onHold?.(); return; } onTap(); };
  // Switched to sold out, an ingredient run out, none left of it (lib/menu-stock), or outside its hours ("Breakfast, from
  // 7 AM"), said as such; a few left, said too.
  const why = m.off || outWords(m); const out = !!why; const left = out ? null : leftOf(m);
  const price = <>{m.from ? 'from ' : ''}{m.happy ? <><s>{usd(fullOf(m))}</s> <span style={{ color: AMBER }}>{usd(priceOf(m))}</span></> : usd(priceOf(m))}{m.byWeight ? `/${m.byWeight}` : ''}</>;
  const label = `${m.number ? `Number ${m.number}, ` : ''}${m.name}, ${m.from ? 'from ' : ''}${usd(priceOf(m))}${m.byWeight ? ` a ${m.byWeight}, weighed` : ''}${m.happy ? ', happy hour' : ''}${why ? `, ${why.toLowerCase()}` : ''}${left ? `, ${left} left` : ''}${n ? `, ${n} on the order` : ''}`;
  const num = m.number ? <span className="mr-1.5 inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 align-[2px] text-[12.5px] font-semibold tabular-nums" style={{ background: LINE, color: INK }} aria-hidden>{m.number}</span> : null;
  const nameSize = big ? (lane ? 'text-[16px]' : 'text-[15px]') : 'text-[14px]';
  const small = big ? 'text-[14px]' : 'text-[13px]';
  const count = n > 0 && <span className={`absolute right-2 top-2 flex items-center justify-center rounded-full px-1.5 font-semibold tabular-nums ${big ? 'h-8 min-w-[32px] text-[15px]' : 'h-7 min-w-[28px] text-[13.5px]'}`} style={{ background: INK, color: '#fff', boxShadow: '0 0 0 2px #fff' }}>{n}</span>;
  const leftTag = left !== null && <span className="rounded-full px-2 py-0.5 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{left} left</span>;
  const edge = { border: `${n ? 2 : 1}px solid ${n ? INK : LINE}`, ...(ready ? { boxShadow: `0 0 0 3px ${INK}`, transform: 'scale(0.98)' } : {}) };
  const cls = `relative flex h-full flex-col overflow-hidden rounded-2xl text-left transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${RING}`;

  // A photo: the item as it looks, its name and price under it (on the lane screen, its price under its name, as every
  // tile there is narrow; at the counter beside it, and under it when there isn't room).
  if (photos && m.imageUrl) return (
    <button type="button" disabled={out || busy || locked} onClick={tap} {...press} aria-label={label} className={cls} style={{ ...edge, ...noCallout, background: '#fff', padding: n ? 4 : 5 }}>
      <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-xl" style={{ background: SOFT }}>
        <img src={m.imageUrl} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" style={out ? { filter: 'grayscale(1)', opacity: 0.45 } : undefined} />
        {leftTag && <span className="absolute left-2 top-2">{leftTag}</span>}
      </span>
      <span className={`flex flex-1 content-start gap-x-2 gap-y-0.5 px-2 ${lane ? 'flex-col' : 'flex-wrap items-baseline justify-between'} ${big ? 'pb-2 pt-2.5' : 'pb-1.5 pt-2'}`}>
        <span className={`${nameSize} font-semibold leading-snug`} style={{ color: out ? MUTED : INK }}>{num}{m.name}</span>
        <span className={`${small} tabular-nums`} style={{ color: MUTED }}>{out ? why : price}</span>
      </span>
      {count}
    </button>
  );
  // Its name alone: no photo (beside photos, as tall as the row), or a menu without photos (the most to a screen).
  return (
    <button type="button" disabled={out || busy || locked} onClick={tap} {...press} aria-label={label} className={cls}
      style={{ ...edge, ...noCallout, background: out ? SOFT : '#fff', padding: big ? (n ? 13 : 14) : (n ? 10 : 11), minHeight: big ? (lane ? 96 : 84) : 72 }}>
      <span className={`pr-8 ${nameSize} font-semibold leading-snug`} style={{ color: out ? MUTED : INK }}>{num}{m.name}</span>
      <span className={`mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2 ${small} tabular-nums`} style={{ color: MUTED }}>
        <span>{out ? why : price}</span>{leftTag}
      </span>
      {count}
    </button>
  );
}

/** Arrange tiles, on the register (a manager's): every tile of a section, loosened. Drag one onto the place it goes (or
 *  move it with the arrow keys), pin it so it leads Most sold now and its section, hide it from the tiles (Find and a
 *  scan still reach it) or show it again. Each change is saved as it's made, for every counter and lane screen. */
function ArrangeTiles<T extends TileItem>({ items, setup, sections, section, onSection, photos, cols, big, lane, tabH, save, onDone }: {
  items: T[]; setup: TileSetup; sections: string[]; section: string; onSection: (s: string | null) => void; photos: boolean; cols: string; big: boolean; lane: boolean; tabH: string;
  save: (change: Partial<TileSetup>) => Promise<TileSetup | string>; onDone: () => void;
}) {
  const [s, setS] = React.useState<TileSetup>(setup);
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ text: string; warn: boolean } | null>(null);
  const rows = sectionRows(items, s, section);
  const pinned = new Set(s.pinned), hidden = new Set(s.hidden);
  // (Shown at once and saved; then as kept (another manager's change taken in too); one refused goes back as it was, and
  // says why.)
  const apply = async (change: Partial<TileSetup> | { error: string } | null, words: string) => {
    if (!change) return; if ('error' in change) { setMsg({ text: change.error, warn: true }); return; }
    const was = s; setS({ ...s, ...change }); setBusy(true); setMsg(null);
    const r = await save(change).catch(() => 'No connection. Try again.'); setBusy(false);
    if (typeof r === 'string') { setS(was); setMsg({ text: r, warn: true }); } else { setS(r); setMsg({ text: words, warn: false }); }
  };
  const nameOf = (id: string) => items.find((m) => m.id === id)?.name || 'It';
  const move = (id: string, to: number) => void apply(moveChange(s, rows, id, to), `${nameOf(id)} moved.`);

  // Dragging a tile: it follows the pointer; the tile it's over (in its own group) is where it goes when let go. A mouse
  // drags at once; a finger after a short hold, so a swipe across the tiles still scrolls the page.
  const refs = React.useRef(new Map<string, HTMLDivElement | null>()); const grid = React.useRef<HTMLDivElement>(null);
  const [drag, setDragS] = React.useState<{ id: string; x: number; y: number; dx: number; dy: number; over: string | null } | null>(null);
  const dragRef = React.useRef<typeof drag>(null); const setDrag = (d: typeof drag) => { dragRef.current = d; setDragS(d); };
  const pending = React.useRef<{ id: string; x: number; y: number; t: ReturnType<typeof setTimeout> } | null>(null);
  const forget = () => { if (pending.current) { clearTimeout(pending.current.t); pending.current = null; } };
  React.useEffect(() => forget, []);
  // (While a finger drags, the page doesn't scroll under it.)
  React.useEffect(() => { const el = grid.current; if (!el) return; const stopScroll = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', stopScroll, { passive: false }); return () => el.removeEventListener('touchmove', stopScroll); }, []);
  const start = (el: HTMLDivElement, pointerId: number, id: string, x: number, y: number) => { try { el.setPointerCapture(pointerId); } catch { /* the pointer is gone */ } setDrag({ id, x, y, dx: 0, dy: 0, over: null }); };
  const down = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (busy || dragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse') { start(e.currentTarget, e.pointerId, id, e.clientX, e.clientY); return; }
    const el = e.currentTarget, pid = e.pointerId, x = e.clientX, y = e.clientY; forget();
    pending.current = { id, x, y, t: setTimeout(() => { pending.current = null; start(el, pid, id, x, y); }, 250) };
  };
  const moveP = (e: React.PointerEvent) => {
    const p = pending.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) forget();
    const d = dragRef.current; if (!d) return;
    // (Where each tile is now, measured as it moves: a scroll mid-drag never throws it off.)
    const g = new Set(groupOf(rows, s, d.id)); let over: string | null = null; let best = Infinity;
    for (const id of Array.from(g)) { if (id === d.id) continue; const r = refs.current.get(id)?.getBoundingClientRect(); if (!r) continue; const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); if (dist < best && dist < Math.max(r.width, r.height) * 0.6) { best = dist; over = id; } }
    setDrag({ ...d, dx: e.clientX - d.x, dy: e.clientY - d.y, over });
  };
  const up = () => { forget(); const d = dragRef.current; if (!d) return; setDrag(null); if (d.over) move(d.id, groupOf(rows, s, d.id).indexOf(d.over)); };
  const key = (e: React.KeyboardEvent, id: string) => {
    // (Only keys on the tile itself: an arrow on its Pin or Hide button stays there.)
    if (e.target !== e.currentTarget) return;
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!step) return; e.preventDefault(); if (busy) return;
    move(id, groupOf(rows, s, id).indexOf(id) + step); requestAnimationFrame(() => refs.current.get(id)?.focus());
  };
  const corner = 'absolute top-0 z-[1] flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-50';
  const dot = 'flex h-7 w-7 items-center justify-center rounded-full';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: SOFT }}>
        <p className="min-w-0 flex-1 text-[14px]"><b className="font-semibold">Arranging {section}.</b> <span style={{ color: MUTED }}>Drag a tile where it goes. Pin it to lead Most sold now; hide it from the tiles.</span></p>
        <button type="button" onClick={onDone} className={`h-11 shrink-0 rounded-full px-5 text-[14.5px] font-semibold ${RING}`} style={{ background: INK, color: '#fff' }}>Done</button>
      </div>
      {sections.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Menu sections">
        {sections.map((x) => <button key={x} type="button" role="tab" aria-selected={x === section} onClick={() => onSection(x)} className={`${tabH} shrink-0 rounded-full font-semibold ${RING}`} style={x === section ? { background: INK, color: '#fff' } : { background: lane ? '#fff' : SOFT, color: INK, border: lane ? `1px solid ${LINE}` : undefined }}>{x}</button>)}
      </div>}
      <span id="arrange-how" className="sr-only">Use the arrow keys to move it, or drag it.</span>
      <div ref={grid} className={`grid gap-2.5 ${lane ? 'sm:gap-3' : ''} ${cols}`} role="list" aria-label={`${section}, in the order the tiles show`} onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => { forget(); setDrag(null); }}>
        {rows.map((m, i) => { const isPin = pinned.has(m.id), isHid = hidden.has(m.id), dragging = drag?.id === m.id, over = drag?.over === m.id;
          return (
            <div key={m.id} role="listitem" ref={(el) => { refs.current.set(m.id, el); }} tabIndex={0} aria-roledescription="tile to move" aria-describedby="arrange-how" aria-label={`${m.name}${isPin ? ', pinned' : ''}${isHid ? ', hidden from the tiles' : ''}`}
              onPointerDown={(e) => down(e, m.id)} onLostPointerCapture={up} onKeyDown={(e) => key(e, m.id)}
              className={`relative flex h-full cursor-grab flex-col overflow-hidden rounded-2xl text-left ${RING}`}
              style={{ ...noCallout, touchAction: 'pan-y', background: isHid ? SOFT : '#fff', border: `${over ? 2 : 1}px ${isHid ? 'dashed' : 'solid'} ${over ? INK : isHid ? '#c9cbcf' : LINE}`, padding: photos && m.imageUrl ? (over ? 4 : 5) : big ? 14 : 11, minHeight: photos && m.imageUrl ? undefined : big ? (lane ? 96 : 84) : 72,
                transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px) rotate(0deg)` : `rotate(${i % 2 ? 0.6 : -0.6}deg)`, zIndex: dragging ? 5 : undefined, boxShadow: dragging ? '0 10px 24px rgba(22,23,26,0.18)' : undefined, opacity: isHid && !dragging ? 0.7 : 1 }}>
              {photos && m.imageUrl && <span className="block aspect-[16/10] w-full overflow-hidden rounded-xl" style={{ background: SOFT }}><img src={m.imageUrl} alt="" draggable={false} className="h-full w-full object-cover" style={isHid ? { filter: 'grayscale(1)', opacity: 0.5 } : undefined} /></span>}
              <span className={`${photos && m.imageUrl ? 'px-2 pb-2 pt-2.5' : 'px-8'} ${big ? 'text-[15px]' : 'text-[14px]'} font-semibold leading-snug`} style={{ color: isHid ? MUTED : INK }}>{m.name}</span>
              {isHid && <span className={`${photos && m.imageUrl ? 'px-2 pb-1.5' : 'mt-auto px-8 pt-1'} text-[12.5px]`} style={{ color: MUTED }}>Hidden from the tiles</span>}
              <button type="button" disabled={busy} onClick={() => void apply(pinChange(s, m.id), isPin ? `${m.name} unpinned.` : `${m.name} pinned: it leads Most sold now and ${m.section}.`)} aria-pressed={isPin} aria-label={isPin ? `Unpin ${m.name}` : `Pin ${m.name}`} className={`${corner} left-0 ${RING}`}>
                <span className={dot} style={isPin ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `0 0 0 1px ${LINE}` }}><svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2.5h4l-.6 4 2.1 2H4.5l2.1-2z" /><path d="M8 8.5V13" /></svg></span>
              </button>
              <button type="button" disabled={busy} onClick={() => void apply(hideChange(s, m.id), isHid ? `${m.name} is back on the tiles.` : `${m.name} hidden from the tiles. Find or a scan still adds it.`)} aria-pressed={isHid} aria-label={isHid ? `Show ${m.name} on the tiles` : `Hide ${m.name} from the tiles`} className={`${corner} right-0 ${RING}`}>
                <span className={dot} style={isHid ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `0 0 0 1px ${LINE}` }}>{isHid
                  ? <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 3.5v9M3.5 8h9" /></svg>
                  : <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>}</span>
              </button>
            </div>); })}
      </div>
      <p role={msg?.warn ? 'alert' : 'status'} className={msg || busy ? 'text-[13.5px]' : 'sr-only'} style={{ color: msg?.warn ? AMBER : MUTED }}>{busy ? 'Saving…' : msg?.text || ''}</p>
    </div>
  );
}
