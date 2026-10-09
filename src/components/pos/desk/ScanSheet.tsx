'use client';
// src/components/pos/desk/ScanSheet.tsx — THE ONE SCANNER. Point the camera (or a USB / Bluetooth scanner, or tap an NFC
// tag) at anything behind the scenes and the right step appears right under the camera:
//   kit → its next step (take, cleanse, check, swap…) · bundle → its next laundry step · machine label → start or finish
//   a steriliser load (kits scanned in the next few minutes go into it) · station label → that station's reset checklist.
// The camera stays on, so a stack of kits or bundles can be scanned one after another. Full screen on a phone.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { collection } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { routeScan, LOAD_WINDOW_MS, type ScanRoute } from '@/lib/scan-route';
import { useWedge } from '@/lib/use-wedge';
import { useNfc } from '@/lib/use-nfc';
import { OfflineNote } from '@/lib/offline';
import { Kits } from '@/components/pos/desk/Kits';
import { Linens } from '@/components/pos/desk/Linens';
import { Sterilisation } from '@/components/pos/desk/Sterilisation';
import { Stations } from '@/components/pos/desk/Stations';

type Mode = { kind: 'kit'; id: string } | { kind: 'bundle'; linenId: string } | { kind: 'steriliser' } | { kind: 'station'; id: string } | null;

export function ScanSheet({ open, onClose, tenantId, tenant, appts, services, staff, manager, inventory = [], pending = null }: { open: boolean; onClose: () => void; tenantId: string; tenant: any; appts: any[]; services: any[]; staff: any[]; manager: boolean; inventory?: any[]; pending?: { code: string; n: number } | null }) {
  const { firestore } = useFirebase();
  const c = (n: string) => (firestore && tenantId && open ? collection(firestore, 'tenants', tenantId, n) : null);
  const { data: kits } = useCollection<any>(useMemoFirebase(() => c('kits'), [firestore, tenantId, open]));
  const { data: bundles } = useCollection<any>(useMemoFirebase(() => c('linenBundles'), [firestore, tenantId, open]));
  const { data: resources } = useCollection<any>(useMemoFirebase(() => c('resources'), [firestore, tenantId, open]));
  const { data: protocols } = useCollection<any>(useMemoFirebase(() => c('protocols'), [firestore, tenantId, open]));
  const [mode, setMode] = React.useState<Mode>(null); const [incoming, setIncoming] = React.useState<{ code: string; n: number } | null>(null);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null); const [recent, setRecent] = React.useState<{ label: string; at: number; ok: boolean }[]>([]);
  const [cam, setCam] = React.useState(true); const machineAt = React.useRef(0); const seq = React.useRef(0);
  const machines: string[] = Array.isArray(tenant?.ops?.sterilisers) && tenant.ops.sterilisers.length ? tenant.ops.sterilisers : ['Autoclave'];

  const scan = React.useCallback((raw: string) => {
    const r: ScanRoute = routeScan(raw, { kits: kits || [], bundles: bundles || [], machines, resources: resources || [], inventory });
    const push = (label: string, ok: boolean) => setRecent((xs) => [{ label, at: Date.now(), ok }, ...xs].slice(0, 6));
    const hand = (m: Mode) => { setMode(m); seq.current += 1; setIncoming({ code: raw, n: seq.current }); setNote(null); };
    if (r.target === 'machine') { machineAt.current = Date.now(); hand({ kind: 'steriliser' }); push(`${r.label} — steriliser`, true); return; }
    if (r.target === 'kit') { if (Date.now() - machineAt.current < LOAD_WINDOW_MS) { hand({ kind: 'steriliser' }); push(`${r.label} → steriliser load`, true); return; }
      hand({ kind: 'kit', id: r.id! }); push(r.label, true); return; }
    if (r.target === 'bundle') { const b: any = (bundles || []).find((x: any) => x.id === r.id); hand({ kind: 'bundle', linenId: b?.linenId }); push(r.label, true); return; }
    if (r.target === 'station') { setMode({ kind: 'station', id: r.id! }); setNote(null); scanFeedback(true); push(`${r.label} — station`, true); return; }
    if (r.target === 'product') { const p: any = inventory.find((i: any) => i.id === r.id); scanFeedback(true); setMode(null); setNote({ ok: true, text: `${r.label}${p ? ` — ${Number(p.totalStock) || 0} in stock` : ''}. To put it in a kit, open the kit type’s contents and scan it there.` }); push(r.label, true); return; }
    scanFeedback(false); setNote({ ok: false, text: `${r.label}${r.code ? ` (“${r.code.slice(0, 24)}”)` : ''}.` }); push(r.label, false);
  }, [kits, bundles, resources, inventory, machines]);

  // A scan that opened the sheet (USB scanner on the desk, or a tap elsewhere) is handled as soon as the data is here.
  const lastPending = React.useRef(0);
  React.useEffect(() => { if (open && pending && pending.n !== lastPending.current && kits && bundles && resources) { lastPending.current = pending.n; scan(pending.code); } }, [open, pending, kits, bundles, resources, scan]);
  useWedge(scan, open);
  const nfc = useNfc((id) => scan(id));
  React.useEffect(() => { if (!open) { setMode(null); setNote(null); setIncoming(null); nfc.end?.(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open || typeof document === 'undefined' || !firestore) return null;

  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Scan">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[#F6F3EE] sm:max-w-[520px] sm:rounded-l-[28px] sm:shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(16px,env(safe-area-inset-top))]">
          <div><p className="text-[22px] font-[800] tracking-[-0.01em]">Scan</p>
            <p className="text-[12px] text-[#6A655D]">Kits · bundles · sterilisers · stations{Date.now() - machineAt.current < LOAD_WINDOW_MS ? ' · loading a steriliser' : ''}</p></div>
          <button type="button" onClick={onClose} className="h-11 rounded-full bg-[#17181A] px-5 text-[15px] font-[700] text-white">Done</button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))]">
          <OfflineNote />
          {cam ? <ScanGate onScan={scan} label="Hold a label in the box — it scans by itself" /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCam((x) => !x)} className="h-11 flex-1 rounded-full border bg-white px-4 text-[14px] font-[600]">{cam ? 'Hide the camera' : 'Show the camera'}</button>
            {nfc.supported && <button type="button" onClick={() => (nfc.on ? nfc.end() : nfc.start())} className="h-11 flex-1 rounded-full border bg-white px-4 text-[14px] font-[600]">{nfc.on ? 'NFC on — tap a tag' : 'Tap NFC tags'}</button>}
          </div>
          {note && <p role="status" className="rounded-2xl px-4 py-3 text-[14px] font-[600]" style={{ background: note.ok ? '#E3F3E7' : '#FBEAE8', color: note.ok ? '#1F6B3A' : '#B42318' }}>{note.text}</p>}
          {mode?.kind === 'kit' && <Kits firestore={firestore} tenantId={tenantId} kits={(kits || []) as any} services={services} manager={manager} appts={appts} inventory={inventory} staff={staff} resources={resources || []} incoming={incoming} focusId={mode.id} hideScan />}
          {mode?.kind === 'bundle' && <Linens tenantId={tenantId} services={services} appts={appts} inventory={inventory} manager={manager} staff={staff} incoming={incoming} focusLinenId={mode.linenId} hideScan />}
          {mode?.kind === 'steriliser' && <Sterilisation tenantId={tenantId} tenant={tenant} kits={(kits || []) as any} manager={manager} incoming={incoming} hideScan />}
          {mode?.kind === 'station' && <Stations firestore={firestore} tenantId={tenantId} resources={resources || []} appts={appts} services={services} staff={staff} protocols={protocols || []} onlyRow={(r) => r.id === mode.id} />}
          {!mode && !note && <p className="rounded-2xl border border-dashed bg-white/60 p-4 text-[14px] text-[#6A655D]">Scan a kit, a linen bundle, a steriliser’s label or a station’s label. A USB or Bluetooth scanner works too — no need to tap anything first.</p>}
          {recent.length > 0 && <div className="space-y-1"><p className="text-[12px] font-[700] text-[#8A847A]">Just scanned</p>
            {recent.map((x, i) => <p key={i} className="flex items-center gap-2 text-[13px]"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: x.ok ? '#1F6B3A' : '#B42318' }} /><span className="min-w-0 flex-1 truncate">{x.label}</span><span className="tabular-nums text-[#8A847A]">{hm(x.at)}</span></p>)}</div>}
        </div>
      </div>
    </div>, document.body);
}

/** Desk / wall / phone: a USB or Bluetooth scanner anywhere on the screen opens the scanner with that code. */
export function useScanSheet() {
  const [open, setOpen] = React.useState(false); const [pending, setPending] = React.useState<{ code: string; n: number } | null>(null); const n = React.useRef(0);
  useWedge((code) => { n.current += 1; setPending({ code, n: n.current }); setOpen(true); }, !open);
  return { open, pending, show: () => setOpen(true), hide: () => setOpen(false) };
}
