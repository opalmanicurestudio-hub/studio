'use client';
// src/lib/use-wedge.ts — USB / BLUETOOTH BARCODE SCANNERS without tapping into a box first. Those scanners "type" the code
// very fast and press Enter; this hears anything typed that fast (and not into a text field), through the one scanner
// listener (lib/use-wedge-scanner), so only the newest screen that listens hears each scan.
import { useWedgeScanner } from '@/lib/use-wedge-scanner';

export function useWedge(onScan: (code: string) => void, enabled = true) {
  useWedgeScanner(onScan, enabled, { needEnter: true, minLen: 4 });
}
