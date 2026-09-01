'use client';

import React from 'react';

/**
 * The floor-plan shape library.
 *
 * One catalogue, one glyph set, one sizing rule — imported by the booths page
 * so the card renderer, the quick-add palette, the design-mode picker and the
 * space dialog can never drift apart.
 *
 * NAMING: every label here is niche-neutral. A tenant may be running a salon,
 * a restaurant, a studio, a clinic or a shop, so the floor speaks in furniture
 * ("Round table", "Counter run", "Recliner"), never in one trade's vocabulary.
 * The parenthetical hint is the only place a use-case is named, and it always
 * names several.
 */

export type FloorShapeGroup = 'Structure' | 'Areas' | 'Tables & stations' | 'Seating' | 'Fixtures';

export interface FloorShapeDef {
  value: string;
  label: string;
  hint: string;
  group: FloorShapeGroup;
  w: number;
  h: number;
}

export const FLOOR_SHAPES: FloorShapeDef[] = [
  { value: 'wall', label: 'Wall', hint: 'Divider, partition', group: 'Structure', w: 240, h: 20 },
  { value: 'door', label: 'Door', hint: 'Entry, exit', group: 'Structure', w: 80, h: 20 },
  { value: 'window', label: 'Window', hint: 'Glass, storefront', group: 'Structure', w: 120, h: 16 },
  { value: 'column', label: 'Column', hint: 'Pillar, post', group: 'Structure', w: 40, h: 40 },
  { value: 'stairs', label: 'Stairs', hint: 'Steps, level change', group: 'Structure', w: 120, h: 80 },

  { value: 'square', label: 'Zone', hint: 'Room, section, area', group: 'Areas', w: 160, h: 160 },
  { value: 'rug', label: 'Floor area', hint: 'Rug, mat, marked floor', group: 'Areas', w: 160, h: 100 },

  { value: 'rect', label: 'Rectangle', hint: 'Booth, suite, bay', group: 'Tables & stations', w: 140, h: 100 },
  { value: 'round', label: 'Round', hint: 'Round table, pod', group: 'Tables & stations', w: 120, h: 120 },
  { value: 'oval', label: 'Oval', hint: 'Oval table, island', group: 'Tables & stations', w: 160, h: 100 },
  { value: 'desk', label: 'Desk', hint: 'Reception, host stand', group: 'Tables & stations', w: 200, h: 80 },
  { value: 'counter', label: 'Counter run', hint: 'Bar, service counter', group: 'Tables & stations', w: 240, h: 50 },

  { value: 'chair', label: 'Chair', hint: 'Styling chair, seat', group: 'Seating', w: 80, h: 80 },
  { value: 'stool', label: 'Stool', hint: 'Bar stool, perch', group: 'Seating', w: 50, h: 50 },
  { value: 'bench', label: 'Bench', hint: 'Banquette, waiting bench', group: 'Seating', w: 160, h: 50 },
  { value: 'pedicure', label: 'Recliner', hint: 'Pedicure, treatment chair', group: 'Seating', w: 100, h: 100 },

  { value: 'sink', label: 'Sink', hint: 'Wash basin, shampoo', group: 'Fixtures', w: 80, h: 80 },
  { value: 'dryer', label: 'Appliance', hint: 'Dryer, machine, unit', group: 'Fixtures', w: 80, h: 80 },
  { value: 'shelf', label: 'Shelving', hint: 'Retail rack, storage', group: 'Fixtures', w: 160, h: 40 },
  { value: 'register', label: 'Point of sale', hint: 'Till, checkout', group: 'Fixtures', w: 80, h: 60 },
  { value: 'locker', label: 'Lockers', hint: 'Cubbies, coat storage', group: 'Fixtures', w: 120, h: 40 },
  { value: 'screen', label: 'Display', hint: 'Screen, board, mirror', group: 'Fixtures', w: 100, h: 20 },
  { value: 'plant', label: 'Décor', hint: 'Plant, ornament', group: 'Fixtures', w: 60, h: 60 },
];

export const FLOOR_SHAPE_GROUPS: FloorShapeGroup[] = [
  'Structure', 'Areas', 'Tables & stations', 'Seating', 'Fixtures',
];

/**
 * A circle drawn in a 140x100 box is an ellipse, and a wall 100px deep is a
 * room. These two families have to hold their proportions or the shape you
 * picked is not the shape you get; everything else keeps whatever size it was
 * dragged to.
 */
export const SQUARE_SHAPES = ['round', 'chair', 'stool', 'pedicure', 'sink', 'dryer', 'plant', 'column', 'register'];
export const THIN_SHAPES = ['wall', 'door', 'window', 'counter', 'bench', 'shelf', 'locker', 'screen'];

/** The box a shape needs, given the box it currently has. */
export function sizeForShape(shape: string, w: number, h: number): { w: number; h: number } {
  const def = FLOOR_SHAPES.find((s) => s.value === shape);
  if (SQUARE_SHAPES.includes(shape)) {
    const side = Math.max(40, Math.min(240, Math.round((w + h) / 2)));
    return { w: side, h: side };
  }
  if (THIN_SHAPES.includes(shape)) {
    return { w: Math.max(40, w), h: Math.min(h, def?.h ?? 20) };
  }
  return { w, h };
}

/**
 * Draw order. A plan reads as a room when its structure sits behind its
 * furniture: walls and floor areas at the back, fixtures above them, anything
 * bookable on top, and the selection above everything so it can be worked on.
 */
const FLOOR_LAYERS: Record<string, number> = {
  rug: 1, wall: 2, window: 2, door: 3, stairs: 3, column: 3,
  square: 4, shelf: 5, locker: 5, screen: 5, plant: 5,
  counter: 6, bench: 6, desk: 6, register: 6, sink: 6, dryer: 6, stool: 6,
};
export function layerFor(shape: string, selected: boolean): number {
  if (selected) return 15;
  return FLOOR_LAYERS[shape] ?? 8;
}

/**
 * Shapes that are scenery rather than something a customer can book. They
 * carry their own colours; everything else keeps its status or lens colour so
 * the floor still answers "who is in, who is free" at a glance.
 */
const DECOR_CHROME: Record<string, { background: string; border: string }> = {
  wall: { background: '#cbd5e1', border: '2px solid #94a3b8' },
  door: { background: 'repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 4px,#f8fafc 4px,#f8fafc 8px)', border: '2px dashed #94a3b8' },
  window: { background: '#e0f2fe', border: '2px solid #7dd3fc' },
  column: { background: '#cbd5e1', border: '2px solid #94a3b8' },
  stairs: { background: 'repeating-linear-gradient(0deg,#e2e8f0,#e2e8f0 6px,#f8fafc 6px,#f8fafc 12px)', border: '2px solid #94a3b8' },
  rug: { background: '#faf5ff', border: '2px dashed #d8b4fe' },
  shelf: { background: '#fef3c7', border: '2px solid #fcd34d' },
  locker: { background: '#f1f5f9', border: '2px solid #cbd5e1' },
  screen: { background: '#1e293b', border: '2px solid #0f172a' },
  plant: { background: '#ecfdf5', border: '2px solid #a7f3d0' },
};
export function decorChrome(shape: string) {
  return DECOR_CHROME[shape];
}

/** How the element's own box is drawn — corners, padding, content alignment. */
export function shapeClass(shape: string): string {
  if (shape === 'round') return 'rounded-full items-center justify-center text-center p-1.5';
  if (shape === 'oval') return 'rounded-[50%] items-center justify-center text-center p-1.5';
  if (shape === 'column') return 'rounded-full items-center justify-center text-center p-0.5';
  if (shape === 'desk') return 'rounded-t-3xl rounded-b-lg items-center justify-center text-center p-1.5';
  if (shape === 'counter') return 'rounded-lg items-center justify-center text-center p-1';
  if (shape === 'bench' || shape === 'shelf' || shape === 'locker') return 'rounded-md items-center justify-center text-center p-1';
  if (shape === 'screen') return 'rounded-sm items-center justify-center text-center p-0.5';
  if (['chair', 'stool', 'pedicure', 'sink', 'dryer', 'plant', 'register'].includes(shape)) {
    return 'rounded-2xl items-center justify-center text-center p-1';
  }
  if (['wall', 'door', 'window', 'stairs'].includes(shape)) return 'rounded-sm justify-center p-1';
  if (shape === 'rug') return 'rounded-2xl p-2';
  if (shape === 'square') return 'rounded-lg p-2.5';
  return 'rounded-xl p-2.5';
}

/**
 * Line-drawn glyphs, not emoji. Emoji render differently on every phone, take
 * the system's colour rather than the plan's, and cannot be scaled or aligned
 * — these inherit currentColor and sit on the same 24x24 grid, so a floor
 * reads as one drawing instead of a sticker sheet.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  chair: (
    <>
      <path d="M7 4h10v7H7z" />
      <path d="M5 11h14v4H5z" />
      <path d="M7 15v5M17 15v5" />
    </>
  ),
  stool: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M8 13l-2 7M16 13l2 7M12 14v6" />
    </>
  ),
  bench: (
    <>
      <path d="M3 9h18v4H3z" />
      <path d="M5 13v6M19 13v6" />
    </>
  ),
  pedicure: (
    <>
      <path d="M6 5h9v6H6z" />
      <path d="M4 11h13v4H4z" />
      <path d="M17 13h3v6h-6" />
      <path d="M6 15v4" />
    </>
  ),
  sink: (
    <>
      <path d="M4 11h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M12 11V6a2 2 0 0 1 2-2h3" />
      <circle cx="12" cy="14" r="1" />
    </>
  ),
  dryer: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="13" r="4" />
      <path d="M7 6h3" />
    </>
  ),
  shelf: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="M3 10h18M3 15h18" />
    </>
  ),
  locker: (
    <>
      <path d="M4 3h16v18H4z" />
      <path d="M12 3v18" />
      <path d="M9 11h1M15 11h1" />
    </>
  ),
  register: (
    <>
      <path d="M4 9h16v11H4z" />
      <path d="M8 9V5h8v4" />
      <path d="M8 14h8" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  plant: (
    <>
      <path d="M8 20h8l-1-6H9z" />
      <path d="M12 14c0-4 2-6 5-6 0 3-2 5-5 6z" />
      <path d="M12 14c0-3-2-5-5-5 0 3 2 4 5 5z" />
    </>
  ),
  column: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  stairs: (
    <>
      <path d="M3 20h5v-4h5v-4h5V8h3" />
      <path d="M3 20v-4h5v-4h5V8h5V4" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M12 6v12M3 12h18" />
    </>
  ),
  door: (
    <>
      <path d="M6 3h9v18H6z" />
      <path d="M12 12h.01" />
      <path d="M15 3a9 9 0 0 1 4 9" />
    </>
  ),
  wall: (
    <>
      <path d="M3 7h18v10H3z" />
      <path d="M3 12h18M9 7v5M15 12v5" />
    </>
  ),
  rug: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <rect x="6" y="9" width="12" height="6" rx="1" />
    </>
  ),
  counter: (
    <>
      <path d="M3 8h18v4H3z" />
      <path d="M5 12v8M19 12v8" />
    </>
  ),
  desk: (
    <>
      <path d="M3 9h18a0 0 0 0 1 0 0v3H3z" />
      <path d="M5 12v8M19 12v8" />
      <path d="M7 9V6h10v3" />
    </>
  ),
  rect: <rect x="3" y="6" width="18" height="12" rx="2" />,
  square: <rect x="4" y="4" width="16" height="16" rx="2" />,
  round: <circle cx="12" cy="12" r="8" />,
  oval: <ellipse cx="12" cy="12" rx="9" ry="6" />,
};

/** True when the shape's own box already says what it is. */
export function isContainerShape(shape: string): boolean {
  return ['rect', 'square', 'round', 'oval', 'rug'].includes(shape);
}

export function FloorGlyph({
  shape,
  className = 'h-5 w-5',
  strokeWidth = 1.6,
}: {
  shape: string;
  className?: string;
  strokeWidth?: number;
}) {
  const glyph = GLYPHS[shape] || GLYPHS.rect;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}
