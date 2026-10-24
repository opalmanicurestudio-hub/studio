'use client';
// src/components/orders/BinsScreen.tsx — BINS AND TOTES. Walk the shelves and give every product a bin: scan the
// product, then the shelf label (or type the bin), and it saves. Print shelf labels for what you just set, and print
// the reusable tote tags used when picking several orders at once.
import * as React from 'react';
import Link from 'next/link';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { binOf, compareBins, normalizeBin } from '@/lib/bins';
import { codeBook, lookupCode } from '@/lib/code-lookup';
import { printShelfLabels, printToteTags } from '@/lib/shelf-labels-client';
import { parseTote } from '@/lib/totes';
import { Btn, C, Group, LargeTitle, UndoBar, muted, Ic } from './ui';

/** The product a scan is, by any code it carries (lib/code-lookup, as every scanner reads it): a listing itself, since
 *  it's the shelf being labelled. A code two products share finds neither. */
export function findProduct(items: any[], raw: string): any | null {
  const found = lookupCode(codeBook(items), raw, { variants: false });
  return found.kind === 'product' ? found.item : null;
}

export function BinsScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant } = useTenant() as any;
  const { inventory } = useInventory() as any;
  const tenantId = String(selectedTenant?.id || '');
  const products = React.useMemo(() => (inventory || []).filter((i: any) => i.type === 'retail' && i.archived !== true), [inventory]);
  const noBin = React.useMemo(() => products.filter((i: any) => !binOf(i)).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [products]);
  const withBin = React.useMemo(() => products.filter((i: any) => binOf(i)).sort((a: any, b: any) => compareBins(binOf(a), binOf(b))), [products]);
  const [current, setCurrent] = React.useState<any | null>(null);
  const [typed, setTyped] = React.useState('');
  const [justSet, setJustSet] = React.useState<{ id: string; name: string; bin: string }[]>([]);
  const [toast, setToast] = React.useState('');
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [toteCount, setToteCount] = React.useState(12);
  const binRef = React.useRef<HTMLInputElement>(null);

  const pick = (p: any) => { setCurrent(p); setTyped(binOf(p)); setMsg({ ok: true, text: `${p.name}. Now scan its shelf label, or type the bin.` }); setTimeout(() => binRef.current?.select(), 50); };
  const save = async (raw: string) => {
    if (!current || !fs || !tenantId) return;
    const bin = normalizeBin(raw);
    if (!bin) { setMsg({ ok: false, text: 'Type or scan a bin first.' }); return; }
    if (parseTote(bin)) { setMsg({ ok: false, text: 'That’s a tote tag, not a shelf. Scan the shelf label.' }); scanFeedback(false); return; }
    try {
      await updateDoc(doc(fs, `tenants/${tenantId}/inventory`, current.id), { storageLocation: bin });
      scanFeedback(true);
      setJustSet((l) => [{ id: current.id, name: String(current.name || ''), bin }, ...l.filter((x) => x.id !== current.id)].slice(0, 50));
      setMsg({ ok: true, text: `${current.name} lives at ${bin}. Scan the next product.` });
      setCurrent(null); setTyped('');
    } catch { setMsg({ ok: false, text: 'That didn’t save. Try again.' }); }
  };
  const onScan = (raw: string) => {
    if (current) { void save(raw); return; }
    const found = lookupCode(codeBook(products), raw, { variants: false });
    if (found.kind === 'product') { scanFeedback(true); pick(found.item); return; }
    scanFeedback(false);
    setMsg({ ok: false, text: found.kind === 'clash' ? `That code is on ${found.items.length} products. Choose which keeps it in Inventory, Codes and listings.` : 'No product has that code. Check its barcode or SKU on the product.' });
  };
  const print = (rows: { bin: string; name: string }[]) => { if (!rows.length) return; if (!printShelfLabels(rows)) setToast('Allow pop-ups to print labels.'); };

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <Link href="/retail-orders/setup" className="inline-flex h-11 items-center gap-1 text-[17px]" style={{ color: C.ink }}>{Ic.back}Setup</Link>
        <LargeTitle title="Bins and totes" sub={noBin.length ? `${noBin.length} product${noBin.length === 1 ? ' has' : 's have'} no bin yet` : 'Every product has a bin'} />

        <section className="mt-6 rounded-2xl border-2 p-4" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[17px] font-semibold">{current ? current.name : 'Scan a product'}</p>
          <p className="m-0 mt-0.5 text-[14px]" style={muted}>{current ? 'Now scan its shelf label, or type the bin.' : 'Or tap one below. Then scan the shelf, or type the bin.'}</p>
          {msg && <p role="status" className="cf-anim-rise m-0 mt-3 rounded-2xl px-4 py-3 text-[15px] font-semibold" style={msg.ok ? { background: C.okSoft, color: C.ok } : { background: C.warnSoft, color: C.warn }}>{msg.text}</p>}
          {current && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void save(typed); }}>
              <label className="sr-only" htmlFor="bin-input">Bin</label>
              <input id="bin-input" ref={binRef} value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="A-02-3" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                className="h-12 min-w-0 flex-1 rounded-2xl border px-4 font-mono text-[20px] font-semibold outline-none" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
              <Btn kind="primary" type="submit">Save</Btn>
              <Btn kind="soft" type="button" onClick={() => { setCurrent(null); setTyped(''); setMsg(null); }}>Cancel</Btn>
            </form>)}
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={onScan} cameraFirst={false} label={current ? 'Scan the shelf label' : 'Scan the product'} /></div>
        </section>

        {justSet.length > 0 && (
          <Group title="Just set" foot={<Btn kind="soft" className="mt-2" onClick={() => print(justSet)}>Print shelf labels for these</Btn>}>
            {justSet.map((r, i) => <div key={r.id} className="flex min-h-[52px] items-center justify-between gap-3 px-4" style={i < justSet.length - 1 ? { borderBottom: `1px solid ${C.line}` } : undefined}><span className="truncate text-[16px]">{r.name}</span><span className="font-mono text-[15px] font-semibold">{r.bin}</span></div>)}
          </Group>)}

        {noBin.length > 0 && (
          <Group title={`No bin yet · ${noBin.length}`}>
            {noBin.slice(0, 60).map((p: any, i: number) => <button key={p.id} type="button" onClick={() => pick(p)} className="cf-press flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left" style={i < Math.min(60, noBin.length) - 1 ? { borderBottom: `1px solid ${C.line}` } : undefined}><span className="truncate text-[16px]">{p.name}</span><span style={muted}>{Ic.chev}</span></button>)}
          </Group>)}

        <Group title="Labels" foot="Shelf labels are 2 × 1 in. Tote tags are 3 × 2 in, two across on letter paper. Tape over them so they last.">
          <div className="flex min-h-[56px] items-center justify-between gap-3 px-4" style={{ borderBottom: `1px solid ${C.line}` }}>
            <span className="text-[16px]">Shelf labels for every bin <span style={muted}>({withBin.length})</span></span>
            <Btn kind="soft" disabled={!withBin.length} onClick={() => print(withBin.map((p: any) => ({ bin: binOf(p), name: String(p.name || '') })))}>Print</Btn>
          </div>
          <div className="flex min-h-[56px] items-center justify-between gap-3 px-4">
            <label className="flex items-center gap-2 text-[16px]">Tote tags 1 to
              <input type="number" min={1} max={99} value={toteCount} onChange={(e) => setToteCount(Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1))))} className="h-10 w-16 rounded-xl border px-2 text-center text-[16px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
            </label>
            <Btn kind="soft" onClick={() => { if (!printToteTags(toteCount)) setToast('Allow pop-ups to print labels.'); }}>Print</Btn>
          </div>
        </Group>
      </div>
      {toast && <UndoBar text={toast} onDone={() => setToast('')} />}
    </div>);
}
