'use client';
// src/hooks/useBarcodeScanner.ts — USB / BLUETOOTH BARCODE SCANNERS. They "type" the code very fast and press Enter.
// This listens for that burst anywhere on the page (not while someone is typing in a field), so staff can scan without
// tapping anything first. A person typing is far slower than a scanner, so ordinary typing is never mistaken for a scan.
import { useEffect, useRef } from 'react';

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buf = useRef(''); const last = useRef(0); const cb = useRef(onScan); cb.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) && !el.hasAttribute('data-scan-field');
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const now = Date.now();
      if (now - last.current > 60) buf.current = '';   // too slow to be a scanner — start again
      last.current = now;
      if (e.key === 'Enter' || e.key === 'Tab') { const code = buf.current; buf.current = ''; if (code.length >= 4) { e.preventDefault(); cb.current(code); } return; }
      if (e.key.length === 1) buf.current += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
