'use client';
// src/app/(app)/inventory/labels/page.tsx — PRINT PRODUCT LABELS. A label for each product on the shelf: its name (a
// variant as its listing, with the variant under it), its price, a barcode a laser scanner reads and the shop's QR code,
// on a letter sheet of 30 or a label printer's roll (lib/product-labels). How many of each comes from the link that
// opened it (the delivery just received, the products chosen in Inventory, a product's page) and can be changed here.
// The preview is what prints: the same marks are drawn on screen, on the printed page and in the PDF (the PDF is made
// on the server from the products as they're saved, /api/inventory/labels).
import * as React from 'react';
import { Suspense } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { listingsOf, variantIdsOf } from '@/lib/variants';
import { codeForm } from '@/lib/code-form';
import { LAYOUTS, MAX_LABELS, SHOW_ALL, designUrlOk, drawLabel, expandCopies, labelContent, labelNote, labelRowsFromLink, labelable, perPage, placeLabels, type LabelRow, type LabelShow, type LabelSize } from '@/lib/product-labels';
import { LabelMarks } from '@/components/inventory/LabelMarks';
import { Btn, C, UndoBar, muted } from '@/components/orders/ui';

type Row = LabelRow;
const PREFS = 'cf-labels';
const SIZES: { id: LabelSize; label: string }[] = [
  { id: 'sheet', label: '2⅝ × 1 in · 30 on a letter sheet' },
  { id: 'roll', label: '2.25 × 1.25 in · label printer roll' },
];
const SHOWS: { id: keyof LabelShow; label: string }[] = [
  { id: 'name', label: 'The product’s name and variant' }, { id: 'price', label: 'Price' }, { id: 'barcode', label: 'Barcode' }, { id: 'qr', label: 'QR code' },
];

function readPrefs(): { size?: LabelSize; show?: Partial<LabelShow> } {
  try { const v = JSON.parse(localStorage.getItem(PREFS) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function savePrefs(v: any) { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch { /* a convenience only */ } }

function LabelsScreen() {
  const q = useSearchParams();
  const { inventory, isLoading } = useInventory() as any;
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const items: any[] = React.useMemo(() => (inventory || []).filter(labelable), [inventory]);
  const byId = React.useMemo(() => new Map(items.map((i) => [String(i.id), i])), [items]);
  const listings = React.useMemo(() => listingsOf(inventory || []), [inventory]);

  const [size, setSize] = React.useState<LabelSize>('sheet');
  const [show, setShow] = React.useState<LabelShow>(SHOW_ALL);
  const [skip, setSkip] = React.useState(0);
  const [design, setDesign] = React.useState(q.get('design') === '1');
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [find, setFind] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); const p = readPrefs(); if (p.size === 'roll' || p.size === 'sheet') setSize(p.size); if (p.show) setShow({ ...SHOW_ALL, ...p.show }); }, []);
  React.useEffect(() => { if (mounted) savePrefs({ size, show }); }, [mounted, size, show]);
  // The link's products, once the products have loaded.
  React.useEffect(() => { if (rows === null && !isLoading && (inventory || []).length) setRows(labelRowsFromLink(new URLSearchParams(q.toString()), inventory || [])); }, [rows, isLoading, inventory, q]);
  const list = rows || [];

  const layout = LAYOUTS[size];
  const contents = React.useMemo(() => new Map(list.map((r) => { const it = byId.get(r.productId); return [r.productId, it ? labelContent(it, listings) : null]; })), [list, byId, listings]);
  const hasDesign = list.some((r) => designUrlOk(byId.get(r.productId)?.labelImageUrl));
  const copies = React.useMemo(() => expandCopies(list.filter((r) => contents.get(r.productId)), MAX_LABELS), [list, contents]);
  const total = list.reduce((n, r) => n + (contents.get(r.productId) ? Math.max(0, r.qty) : 0), 0);
  const over = total > MAX_LABELS;
  const drawn = React.useMemo(() => new Map([...contents].map(([id, c]) => [id, c ? drawLabel(c, layout, show) : null])), [contents, layout, show]);
  const at = React.useMemo(() => placeLabels(layout, copies.length, skip), [layout, copies.length, skip]);
  const pages = Math.max(1, at.length ? at[at.length - 1].page + 1 : 1);
  React.useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  const imageOf = (id: string) => { const u = design ? String(byId.get(id)?.labelImageUrl || '') : ''; return u && designUrlOk(u) ? u : undefined; };

  const setQty = (id: string, n: number) => setRows((rs) => (rs || []).map((r) => (r.productId === id ? { ...r, qty: Math.max(0, Math.min(999, Math.floor(n) || 0)) } : r)));
  const remove = (id: string) => setRows((rs) => (rs || []).filter((r) => r.productId !== id));
  const add = (it: any) => {
    const vs = variantIdsOf(it).filter((v) => byId.has(v));
    setRows((rs) => { const cur = [...(rs || [])]; for (const id of vs.length ? vs : [String(it.id)]) if (!cur.some((r) => r.productId === id)) cur.push({ productId: id, qty: 1 }); return cur; });
    setFind('');
  };
  // Products to add: by name, SKU or any code, listings and their variants named as the shop sells them.
  const found = React.useMemo(() => {
    const t = find.trim().toLowerCase(); if (t.length < 2) return [];
    const code = codeForm(find);
    return items.filter((it) => String(it.name || '').toLowerCase().includes(t) || String(listings.get(String(it.id))?.name || '').toLowerCase().includes(t)
        || [it.sku, it.barcode, ...(Array.isArray(it.barcodes) ? it.barcodes : [])].some((c) => c && (String(c).toLowerCase().includes(t) || (!!code && codeForm(c) === code))))
      .slice(0, 8);
  }, [find, items, listings]);
  const nameOf = (it: any) => { const c = labelContent(it, listings); return [c.name, c.sub].filter(Boolean).join(' · '); };

  const print = async () => {
    if (!copies.length || over) return;
    // The words are fitted to the app's typeface: it's loaded (both weights) before anything prints.
    try { const f = (document as any).fonts; await Promise.all([f?.load("400 8px 'Plus Jakarta Sans'"), f?.load("500 8px 'Plus Jakarta Sans'")]); await f?.ready; } catch { /* print anyway */ }
    window.print();
  };
  const pdf = async () => {
    if (!copies.length || over || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/inventory/labels', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body: JSON.stringify({ tenantId, size, show, skip: size === 'sheet' ? skip : 0, design: design && hasDesign, rows: list.filter((r) => r.qty > 0 && contents.get(r.productId)) }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'The PDF didn’t download. Try again.'); }
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'product-labels.pdf';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e: any) { setToast(e?.message || 'The PDF didn’t download. Try again.'); }
    setBusy(false);
  };

  // A page of labels: the preview's outlines on screen only.
  const sheet = (n: number, outline: boolean) => (
    <svg key={n} className="pg" viewBox={`0 0 ${layout.pageW} ${layout.pageH}`} width={outline ? '100%' : `${layout.pageW / 72}in`} height={outline ? undefined : `${layout.pageH / 72}in`}
      role={outline ? 'img' : undefined} aria-label={outline ? `Page ${n + 1} of the labels` : undefined} style={{ display: 'block', background: '#fff', ...(outline ? { height: 'auto' } : {}) }}>
      {outline && Array.from({ length: perPage(layout) }, (_, k) => (
        <rect key={`o${k}`} x={layout.left + (k % layout.cols) * layout.pitchX + 0.5} y={layout.top + Math.floor(k / layout.cols) * layout.pitchY + 0.5} width={layout.labelW - 1} height={layout.labelH - 1} rx={size === 'sheet' ? 5 : 4} fill="none" stroke={C.muted} strokeOpacity={0.35} strokeWidth={0.6} strokeDasharray="2 2" />))}
      {copies.map((r, i) => (at[i]?.page === n ? <LabelMarks key={i} marks={drawn.get(r.productId)?.marks || []} x={at[i].x} y={at[i].y} image={imageOf(r.productId)} w={layout.labelW} h={layout.labelH} /> : null))}
    </svg>);

  const box = 'flex flex-col gap-3.5 rounded-[18px] border p-4';
  const field = 'h-11 w-full rounded-xl border bg-transparent px-3 text-[14.5px] outline-none';
  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pb-16 pt-5 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold" style={muted}><Link href="/inventory" className="underline-offset-2 hover:underline" style={{ color: C.muted }}>Inventory</Link> · labels</p>
            <h1 className="m-0 mt-0.5 text-[26px] font-light leading-tight tracking-[-0.02em] sm:text-[30px]">Print product labels</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn kind="soft" className="h-11 px-4 text-[14px]" style={{ border: `1px solid ${C.line}`, background: C.paper }} disabled={!copies.length || over || busy} onClick={() => void pdf()}>{busy ? 'Making the PDF…' : 'Download a PDF'}</Btn>
            <Btn kind="primary" className="h-11 px-5 text-[14px]" disabled={!copies.length || over} onClick={() => void print()}>{copies.length ? `Print ${copies.length} ${copies.length === 1 ? 'label' : 'labels'}` : 'Print labels'}</Btn>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
            <section className={box} style={{ borderColor: C.line }}>
              <div>
                <label htmlFor="label-size" className="mb-1.5 block text-[13px] font-semibold">Label size</label>
                <select id="label-size" value={size} onChange={(e) => { setSize(e.target.value as LabelSize); setPage(0); }} className={field} style={{ borderColor: C.line, color: C.ink, background: C.paper }}>
                  {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              {size === 'sheet' && (
                <div>
                  <label htmlFor="label-start" className="mb-1.5 block text-[13px] font-semibold">Start at label</label>
                  <select id="label-start" value={skip} onChange={(e) => { setSkip(Number(e.target.value) || 0); setPage(0); }} className={field} style={{ borderColor: C.line, color: C.ink, background: C.paper }}>
                    {Array.from({ length: 30 }, (_, i) => <option key={i} value={i}>{i === 0 ? '1, a new sheet' : `${i + 1}, on a sheet used before`}</option>)}
                  </select>
                </div>)}
              <p className="m-0 text-[13px] font-semibold" style={muted}>On each label</p>
              <div className="-mt-1.5 flex flex-col">
                {SHOWS.map((s) => (
                  <label key={s.id} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[14.5px]">
                    <input type="checkbox" checked={show[s.id]} onChange={(e) => setShow({ ...show, [s.id]: e.target.checked })} className="h-5 w-5 shrink-0" style={{ accentColor: '#16171a' }} />
                    {s.label}
                  </label>))}
                {hasDesign && (
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[14.5px]">
                    <input type="checkbox" checked={design} onChange={(e) => setDesign(e.target.checked)} className="h-5 w-5 shrink-0" style={{ accentColor: '#16171a' }} />
                    Its own label design, for a product that has one
                  </label>)}
              </div>
              <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>The barcode is the product’s own (UPC or EAN) when it has one, otherwise its SKU. A laser scanner reads either; a phone camera reads the QR code too.</p>
            </section>

            <section className={box} style={{ borderColor: C.line }} aria-label="How many of each">
              <p className="m-0 text-[13px] font-semibold" style={muted}>How many of each</p>
              {rows === null && isLoading ? <p className="m-0 text-[14px]" style={muted}>Loading your products…</p> : list.length === 0 ? (
                <p className="m-0 text-[14.5px] leading-relaxed">Add the products you want labels for. A listing adds each of its variants, as each has its own barcode.</p>
              ) : (
                <div className="-mt-1.5">
                  {list.map((r, i) => {
                    const it = byId.get(r.productId); const c = contents.get(r.productId);
                    const note = c ? [labelNote(c, show), drawn.get(r.productId)?.noBars ? (show.qr ? 'Its code is too long to print as a barcode at this size, so it has the QR code only' : 'Its code is too long to print as a barcode at this size') : drawn.get(r.productId)?.tight && show.qr ? 'Its code is long, so there’s no room for the QR code' : ''].filter(Boolean).join(' · ') : 'Not in Inventory any more';
                    return (
                      <div key={r.productId} className="flex min-h-[56px] items-center gap-3 py-2" style={{ borderBottom: i < list.length - 1 ? `1px solid ${C.line}` : 0 }}>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-[14.5px]">{it ? nameOf(it) : 'A product no longer in Inventory'}</p>
                          {note && <p className="m-0 mt-0.5 text-[12.5px] leading-snug" style={muted}>{note}</p>}
                        </div>
                        <input type="number" inputMode="numeric" min={0} max={999} value={r.qty} aria-label={`How many labels for ${it ? nameOf(it) : 'this product'}`}
                          onChange={(e) => setQty(r.productId, Number(e.target.value))} className="h-11 w-[72px] shrink-0 rounded-xl border bg-transparent text-center text-[15px] font-semibold tabular-nums outline-none" style={{ borderColor: C.line, color: C.ink }} />
                        <button type="button" onClick={() => remove(r.productId)} aria-label={`Take ${it ? nameOf(it) : 'this product'} off the list`} className="cf-press grid h-11 w-9 shrink-0 place-items-center text-[18px]" style={muted}>×</button>
                      </div>);
                  })}
                </div>)}
              <div>
                <label htmlFor="label-find" className="mb-1.5 block text-[13px] font-semibold">Add a product</label>
                <input id="label-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, SKU or barcode" autoComplete="off" className={field} style={{ borderColor: C.line, color: C.ink }} />
                {found.length > 0 && (
                  <div className="mt-2 overflow-hidden rounded-xl border" style={{ borderColor: C.line }}>
                    {found.map((it, i) => (
                      <button key={it.id} type="button" onClick={() => add(it)} className="cf-press flex min-h-[48px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-[14.5px]" style={{ borderTop: i ? `1px solid ${C.line}` : 0, background: C.paper, color: C.ink }}>
                        <span className="min-w-0 truncate">{nameOf(it)}</span>
                        <span className="shrink-0 text-[12.5px]" style={muted}>{variantIdsOf(it).length ? `${variantIdsOf(it).length} variants` : 'Add'}</span>
                      </button>))}
                  </div>)}
                {find.trim().length >= 2 && found.length === 0 && <p className="m-0 mt-2 text-[13px]" style={muted}>Nothing in Inventory matches that.</p>}
              </div>
              <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>{q.get('from') === 'delivery' ? 'Filled from the delivery just received. Change any number before printing.' : 'Change any number before printing. 0 leaves it out.'}{over ? ` That’s more than ${MAX_LABELS} labels: print them in parts.` : ''}</p>
            </section>
          </div>

          <section className="flex min-w-0 flex-[2_1_560px] flex-col gap-3.5 rounded-[18px] p-4" style={{ background: C.soft }} aria-label="Preview">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[13px] font-semibold" style={muted}>{size === 'sheet' ? 'Sheet' : 'Label'} preview · {page + 1} of {pages}</p>
              {pages > 1 && (
                <div className="flex gap-2">
                  <Btn kind="soft" className="h-10 px-4 text-[13.5px]" style={{ background: C.paper }} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Btn>
                  <Btn kind="soft" className="h-10 px-4 text-[13.5px]" style={{ background: C.paper }} disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Next</Btn>
                </div>)}
            </div>
            <div className="mx-auto w-full overflow-hidden rounded-[10px]" style={{ maxWidth: size === 'sheet' ? 640 : 420, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>{sheet(page, true)}</div>
            <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>The bars print black on white with clear space each side, which a laser scanner needs. For a sheet of labels, print the PDF at actual size (100%) so the labels line up.</p>
          </section>
        </div>
      </div>
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
      {mounted && createPortal(
        <div id="cf-label-print" aria-hidden="true">
          <style>{`#cf-label-print{display:none}@media print{@page{size:${layout.pageW / 72}in ${layout.pageH / 72}in;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important;height:auto!important;min-height:0!important}body>*:not(#cf-label-print){display:none!important}#cf-label-print{display:block!important}#cf-label-print .pg{break-after:page;page-break-after:always}#cf-label-print .pg:last-child{break-after:auto;page-break-after:auto}}`}</style>
          {!over && Array.from({ length: copies.length ? pages : 0 }, (_, n) => sheet(n, false))}
        </div>, document.body)}
    </div>);
}

export default function LabelsPage() {
  return <Suspense fallback={null}><LabelsScreen /></Suspense>;
}
