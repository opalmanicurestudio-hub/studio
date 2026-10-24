'use client';
// src/lib/use-wedge-scanner.ts — HANDHELD AND DESK SCANNERS, ALWAYS ON. A paired USB or Bluetooth scanner acts like a
// keyboard that types the code very fast and usually presses Enter. This listens for that burst anywhere on the
// screen, so a scan lands without tapping a box first. Real typing is far slower, so it is left alone, and nothing is
// taken while someone is typing in a field (a box made for scans, data-scan-field, is the exception). Every screen that
// hears scanners listens through here, and one scan goes to one of them, so it never does two things:
//   • a screen in front (a camera's scan box, a sheet, a panel) before one behind it (the desk, a wall that opens the
//     scanner sheet), and of those, the one that started listening last;
//   • each keeps its own idea of what a scanner is (how fast, how long, whether it ends with Enter), as before.
import * as React from 'react';

const SEEN_KEY = 'cf-scanner-seen';
// Keys this far apart still belong to one burst; each listener then holds the burst to its own limits.
const BURST_GAP_MS = 80;

type Handler = (value: string) => void;
export type WedgeOptions = {
  /** 'background': a screen behind everything else (the desk, a wall's scanner opener), which hears a scan only when
   *  nothing in front of it listens. Default 'front'. */
  layer?: 'front' | 'background';
  /** Only a burst that ends with Enter or Tab (a scanner set to add one), never one that just stops. */
  needEnter?: boolean;
  /** The shortest code worth taking. */
  minLen?: number;
  /** The longest pause between two keys of one scan, and the most a key may take on average. */
  maxGapMs?: number;
  maxAvgMs?: number;
  /** A scan heard here means this device has a scanner, so camera scan boxes start with the camera off. */
  remember?: boolean;
};
type Entry = { id: number; fn: React.MutableRefObject<Handler>; o: Required<WedgeOptions> };
const stack: Entry[] = [];
let nextId = 1;
let attached = false;
let buf = '';
let first = 0;
let last = 0;
let widest = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const DEFAULTS: Required<WedgeOptions> = { layer: 'front', needEnter: false, minLen: 3, maxGapMs: 60, maxAvgMs: 35, remember: true };

/** Is this burst a scanner's, by these limits? */
export function isWedgeBurst(len: number, firstAt: number, lastAt: number, minLen = DEFAULTS.minLen, maxAvgMs = DEFAULTS.maxAvgMs): boolean {
  if (len < Math.max(1, minLen)) return false;
  return (lastAt - firstAt) / Math.max(1, len - 1) <= maxAvgMs;
}

/** The listener a scan goes to now: the last to start of those in front, else the last of those behind. */
function current(): Entry | undefined {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].o.layer === 'front') return stack[i];
  return stack[stack.length - 1];
}

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (el.isContentEditable) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') { const type = String((el as HTMLInputElement).type || 'text').toLowerCase(); return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type); }
  return false;
}
const scanField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.hasAttribute?.('data-scan-field');

/** The scan so far goes to the listener in front, when it was typed fast enough to be a scanner by its limits. */
function deliver(byEnter: boolean) {
  const value = buf.trim();
  const top = current();
  const ok = !!top && widest <= top.o.maxGapMs && isWedgeBurst(value.length, first, last, top.o.minLen, top.o.maxAvgMs) && (byEnter || !top.o.needEnter);
  buf = ''; first = 0; last = 0; widest = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!ok || !top) return false;
  if (top.o.remember) { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage is optional */ } }
  top.fn.current(value);
  return true;
}

function onKey(e: KeyboardEvent) {
  if (!stack.length || e.ctrlKey || e.metaKey || e.altKey) return;
  // A box made for scans (the desk's search box) passes its scans on, to whichever screen is in front.
  const inField = scanField(e.target);
  if (editable(e.target) && !inField) return;
  const now = performance.now();
  if (e.key === 'Enter' || e.key === 'Tab') {
    // A box made for scans clears itself once it sees the scan was taken (it checks defaultPrevented).
    if (buf && deliver(true)) { e.preventDefault(); if (!inField) e.stopPropagation(); }
    return;
  }
  if (e.key.length !== 1) return;
  if (buf && now - last > BURST_GAP_MS) { buf = ''; first = 0; widest = 0; }
  if (!buf) first = now; else widest = Math.max(widest, now - last);
  buf += e.key; last = now;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { deliver(false); }, 120);
}

export function scannerSeenBefore(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function useWedgeScanner(onScan: Handler, enabled = true, o: WedgeOptions = {}) {
  const ref = React.useRef<Handler>(onScan);
  React.useEffect(() => { ref.current = onScan; }, [onScan]);
  const { layer, needEnter, minLen, maxGapMs, maxAvgMs, remember } = { ...DEFAULTS, ...o };
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = nextId++;
    stack.push({ id, fn: ref, o: { layer, needEnter, minLen, maxGapMs, maxAvgMs, remember } });
    if (!attached) { window.addEventListener('keydown', onKey, true); attached = true; }
    return () => {
      const i = stack.findIndex((s) => s.id === id); if (i >= 0) stack.splice(i, 1);
      if (!stack.length && attached) { window.removeEventListener('keydown', onKey, true); attached = false; buf = ''; }
    };
  }, [enabled, layer, needEnter, minLen, maxGapMs, maxAvgMs, remember]);
}
