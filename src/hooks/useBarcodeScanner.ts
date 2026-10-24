'use client';
// src/hooks/useBarcodeScanner.ts — USB / BLUETOOTH BARCODE SCANNERS at the desk. They "type" the code very fast and
// press Enter. This hears that burst anywhere on the page, and in the desk's search box, through the one scanner
// listener (lib/use-wedge-scanner), behind everything else: when a scan sheet or a camera opens over the desk, it hears
// the scan instead, so one scan never does two things. Its limits are the desk's as they always were.
import { useWedgeScanner } from '@/lib/use-wedge-scanner';

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  useWedgeScanner(onScan, enabled, { layer: 'background', needEnter: true, minLen: 4, maxGapMs: 60, maxAvgMs: Infinity, remember: false });
}
