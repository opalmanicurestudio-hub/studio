'use client';
// src/lib/use-wedge.ts — USB / BLUETOOTH BARCODE SCANNERS without tapping into a box first. Those scanners "type" the code
// very fast and press Enter; this hears anything typed that fast (and not into a text field), through the one scanner
// listener (lib/use-wedge-scanner), so each scan goes to one screen. `layer` 'background' for a listener behind
// everything else (a wall that opens the scanner sheet), so a screen in front of it hears scans first.
import { useWedgeScanner } from '@/lib/use-wedge-scanner';

export function useWedge(onScan: (code: string) => void, enabled = true, layer: 'front' | 'background' = 'front') {
  useWedgeScanner(onScan, enabled, { layer, needEnter: true, minLen: 4, maxGapMs: 80, maxAvgMs: 45, remember: false });
}
