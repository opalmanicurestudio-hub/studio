'use client';
// src/lib/use-wedge-scanner.ts — HANDHELD AND DESK SCANNERS, ALWAYS ON. A paired USB or Bluetooth scanner acts like a
// keyboard that types the code very fast and usually presses Enter. This listens for that burst anywhere on the
// screen, so a scan lands without tapping a box first. Real typing is far slower, so it is left alone, and nothing is
// taken while someone is typing in a field. Every screen that hears scanners listens through here, and when several
// are open (the scan sheet over the desk, a camera drawer, a sheet over the pick list) only the newest one hears the
// scan, so one scan never does two things.
import * as React from 'react';

const MAX_GAP_MS = 80;
const MAX_AVG_MS = 50;
const MIN_LEN = 3;
const SEEN_KEY = 'cf-scanner-seen';

type Handler = (value: string) => void;
export type WedgeOptions = {
  /** Also take a scan typed into a box marked data-scan-field (the desk's search box), which then clears itself. */
  scanFields?: boolean;
  /** Only a burst that ends with Enter or Tab (a scanner set to add one), never one that just stops. */
  needEnter?: boolean;
  /** The shortest code worth taking. */
  minLen?: number;
};
const stack: { id: number; fn: React.MutableRefObject<Handler>; o: WedgeOptions }[] = [];
let nextId = 1;
let attached = false;
let buf = '';
let first = 0;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export function isWedgeBurst(len: number, firstAt: number, lastAt: number, minLen = MIN_LEN): boolean {
  if (len < Math.max(MIN_LEN, minLen)) return false;
  return (lastAt - firstAt) / Math.max(1, len - 1) <= MAX_AVG_MS;
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

/** The scan so far goes to the newest listener, when it was typed fast enough to be a scanner. */
function deliver(byEnter: boolean) {
  const value = buf.trim();
  const top = stack[stack.length - 1];
  const ok = !!top && isWedgeBurst(value.length, first, last, top.o.minLen) && (byEnter || !top.o.needEnter);
  buf = ''; first = 0; last = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!ok || !top) return false;
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage is optional */ }
  top.fn.current(value);
  return true;
}

function onKey(e: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top || e.ctrlKey || e.metaKey || e.altKey) return;
  const inField = scanField(e.target);
  if (editable(e.target) && !(inField && top.o.scanFields)) return;
  const now = performance.now();
  if (e.key === 'Enter' || e.key === 'Tab') {
    // A box made for scans clears itself once it sees the scan was taken (it checks defaultPrevented).
    if (buf && deliver(true)) { e.preventDefault(); if (!inField) e.stopPropagation(); }
    return;
  }
  if (e.key.length !== 1) return;
  if (buf && now - last > MAX_GAP_MS) { buf = ''; first = 0; }
  if (!buf) first = now;
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
  const { scanFields = false, needEnter = false, minLen = MIN_LEN } = o;
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = nextId++;
    stack.push({ id, fn: ref, o: { scanFields, needEnter, minLen } });
    if (!attached) { window.addEventListener('keydown', onKey, true); attached = true; }
    return () => {
      const i = stack.findIndex((s) => s.id === id); if (i >= 0) stack.splice(i, 1);
      if (!stack.length && attached) { window.removeEventListener('keydown', onKey, true); attached = false; buf = ''; }
    };
  }, [enabled, scanFields, needEnter, minLen]);
}
