'use client';
// src/lib/use-wedge-scanner.ts — HANDHELD AND DESK SCANNERS, ALWAYS ON. A paired USB or Bluetooth scanner acts like a
// keyboard that types the code very fast and usually presses Enter. This listens for that burst anywhere on the
// screen, so a scan lands without tapping a box first. Real typing is far slower, so it is left alone, and nothing is
// taken while someone is typing in a field. When several scan surfaces are open (a sheet over the pick list), only
// the newest one hears the scan.
import * as React from 'react';

const MAX_GAP_MS = 60;
const MAX_AVG_MS = 35;
const MIN_LEN = 3;
const SEEN_KEY = 'cf-scanner-seen';

type Handler = (value: string) => void;
const stack: { id: number; fn: React.MutableRefObject<Handler> }[] = [];
let nextId = 1;
let attached = false;
let buf = '';
let first = 0;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export function isWedgeBurst(len: number, firstAt: number, lastAt: number): boolean {
  if (len < MIN_LEN) return false;
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

function deliver() {
  const value = buf.trim();
  const ok = isWedgeBurst(value.length, first, last);
  buf = ''; first = 0; last = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!ok) return false;
  const top = stack[stack.length - 1];
  if (!top) return false;
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage is optional */ }
  top.fn.current(value);
  return true;
}

function onKey(e: KeyboardEvent) {
  if (!stack.length || editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const now = performance.now();
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (buf && deliver()) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  if (e.key.length !== 1) return;
  if (buf && now - last > MAX_GAP_MS) { buf = ''; first = 0; }
  if (!buf) first = now;
  buf += e.key; last = now;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { deliver(); }, 120);
}

export function scannerSeenBefore(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function useWedgeScanner(onScan: Handler, enabled = true) {
  const ref = React.useRef<Handler>(onScan);
  React.useEffect(() => { ref.current = onScan; }, [onScan]);
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = nextId++;
    stack.push({ id, fn: ref });
    if (!attached) { window.addEventListener('keydown', onKey, true); attached = true; }
    return () => {
      const i = stack.findIndex((s) => s.id === id); if (i >= 0) stack.splice(i, 1);
      if (!stack.length && attached) { window.removeEventListener('keydown', onKey, true); attached = false; buf = ''; }
    };
  }, [enabled]);
}
