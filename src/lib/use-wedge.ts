'use client';
// src/lib/use-wedge.ts — USB / BLUETOOTH BARCODE SCANNERS without tapping into a box first. Those scanners "type" the code
// very fast and press Enter; this listens on the whole screen and hands over anything typed that fast (and not into a
// text field). Ordinary typing is far slower, so it is never mistaken for a scan.
import * as React from 'react';

export function useWedge(onScan: (code: string) => void, enabled = true) {
  const cb = React.useRef(onScan); cb.current = onScan;
  React.useEffect(() => {
    if (!enabled) return;
    let buf = ''; let first = 0; let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null; const tag = (el?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;   // typing into a field stays there
      const now = Date.now();
      if (now - last > 80) { buf = ''; first = now; }   // a pause means a new sequence
      last = now;
      if (e.key === 'Enter') { const code = buf; const avg = code.length > 1 ? (now - first) / code.length : 999; buf = '';
        if (code.length >= 4 && avg < 45) { e.preventDefault(); cb.current(code); } return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
