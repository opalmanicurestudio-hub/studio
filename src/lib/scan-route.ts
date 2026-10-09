// src/lib/scan-route.ts — ONE SCANNER FOR EVERYTHING. Any code scanned (camera, USB / Bluetooth scanner, NFC tap) is
// recognised and sent to the right place: a kit (K…), a linen bundle (L…), a steriliser's machine label (M…), a station
// label (S:<id>), or a product in inventory. A tag paired to a kit or bundle (RFID / NFC) is found by its tag too.
// After a machine label, kits scanned within a few minutes go into that steriliser load instead of their usual next step.
import { findKit, type Kit } from '@/lib/kits';
import { findBundle, type LinenBundle } from '@/lib/linens';

export type ScanTarget = 'kit' | 'bundle' | 'machine' | 'station' | 'product' | 'unknown';
export interface ScanRoute { target: ScanTarget; code: string; id: string | null; label: string }
const clean = (raw: string) => String(raw || '').trim();
const tail = (raw: string) => clean(raw).toUpperCase().split(/[/=#]/).pop() || '';
export const machineCode = (d: string) => `M${String(d).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14)}`;
export const stationCode = (resourceId: string) => `S:${resourceId}`;

export function routeScan(raw: string, d: { kits?: Kit[]; bundles?: LinenBundle[]; machines?: string[]; resources?: any[]; inventory?: any[] }): ScanRoute {
  const code = clean(raw); const t = tail(raw);
  if (!code) return { target: 'unknown', code, id: null, label: 'Nothing scanned' };
  // Station label: S:<resource id> (also as the last part of a link)
  const st = /(?:^|[/=#])S:([A-Za-z0-9_-]{3,})$/.exec(code);
  if (st) { const r = (d.resources || []).find((x) => x.id === st[1]); return r ? { target: 'station', code, id: r.id, label: String(r.name || 'Station') } : { target: 'unknown', code, id: null, label: 'A station label from another business, or a removed station' }; }
  const m = (d.machines || []).find((x) => machineCode(x) === t); if (m) return { target: 'machine', code, id: m, label: m };
  const k = findKit(d.kits || [], code); if (k) return { target: 'kit', code, id: k.id, label: `${k.name} ${k.code}` };
  const b = findBundle(d.bundles || [], code); if (b) return { target: 'bundle', code, id: b.id, label: `${b.name} ${b.code}` };
  const p = (d.inventory || []).find((i: any) => [i.barcode, i.sku, i.upc, ...(Array.isArray(i.barcodes) ? i.barcodes : [])].filter(Boolean).some((x: any) => String(x).trim().toUpperCase() === code.toUpperCase()));
  if (p) return { target: 'product', code, id: p.id, label: String(p.name || 'Product') };
  return { target: 'unknown', code, id: null, label: /^K[A-Z0-9]{4}$/.test(t) ? 'No kit with that code' : /^L[A-Z0-9]{4}$/.test(t) ? 'No bundle with that code' : 'Not recognised' };
}

/** Kits scanned within this long of a machine label go into that steriliser's load. */
export const LOAD_WINDOW_MS = 3 * 60000;
