'use client';
// src/components/inventory/CodesTab.tsx — A PRODUCT'S CODES AND VARIANTS, on its page. Every code a scanner reads for it
// (your SKU, the barcode on it and any other, a case's and a pallet's code), for any product, in the shop or not, saved
// by the server, which keeps each code on one product (lib/code-index): a code another product has is shown with that
// product, and isn't saved. For a listing, its variants (each with its own code, stock and price, sold inside the
// listing), and a new one added in a step: a product of its own, added to the listing's variants. A variant says which
// listing sells it, and for how much.
import * as React from 'react';
import Link from 'next/link';
import { ScanGate } from '@/components/retail/ScanGate';
import { saveCodes, addVariant } from '@/lib/codes-api';
import { changedCodes, codeClashes, codeForm, codesOf } from '@/lib/code-form';
import { retailBarcode } from '@/lib/product-labels';
import { isStorefrontVisible } from '@/lib/retail-orders';
import { buyable, canSell, choiceFor, listingStock, listingsOf, ownPrice, variantGroup, variantIdsOf, variantPriceCents } from '@/lib/variants';
import { Btn, C, muted } from '@/components/orders/ui';

type Draft = { sku: string; barcode: string; barcodes: string[]; caseBarcode: string; casePack: string; palletBarcode: string; palletPack: string };
const draftOf = (p: any): Draft => ({
  sku: String(p?.sku ?? ''), barcode: String(p?.barcode ?? ''), barcodes: (Array.isArray(p?.barcodes) ? p.barcodes : []).map(String),
  caseBarcode: String(p?.caseBarcode ?? ''), casePack: Number(p?.casePack) > 0 ? String(Math.floor(Number(p.casePack))) : '',
  palletBarcode: String(p?.palletBarcode ?? ''), palletPack: Number(p?.palletPack) > 0 ? String(Math.floor(Number(p.palletPack))) : '',
});
/** The draft as a product's code fields. */
const fieldsOf = (d: Draft) => ({
  sku: d.sku.trim(), barcode: d.barcode.trim(), barcodes: [...new Set(d.barcodes.map((x) => x.trim()).filter(Boolean))],
  caseBarcode: d.caseBarcode.trim(), casePack: Math.floor(Number(d.casePack) || 0) || null,
  palletBarcode: d.palletBarcode.trim(), palletPack: Math.floor(Number(d.palletPack) || 0) || null,
});
const money = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`;
const productHref = (id: string) => `/inventory/product/${encodeURIComponent(id)}?tab=codes`;
/** What kind of barcode it is, for the chip beside it. */
function kindOf(raw: string): string {
  const r = retailBarcode(raw); if (!r) return raw.trim() ? 'Code' : '';
  return r.format === 'UPC' ? 'UPC' : r.format === 'CODE128' ? 'GTIN-14' : 'EAN';
}

export function CodesTab({ product, inventory, tenantId }: { product: any; inventory: any[]; tenantId: string }) {
  const saved = draftOf(product);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = React.useState<Draft>(saved);
  const [base, setBase] = React.useState<Draft>(saved);
  const [more, setMore] = React.useState('');
  const [scan, setScan] = React.useState<'' | 'barcode' | 'more' | 'case' | 'pallet' | 'variant'>('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  // Saved somewhere else meanwhile (another screen, a code learned at packing): this shows it, unless it's being edited.
  React.useEffect(() => { if (!dirty) { setDraft(saved); setBase(saved); } }, [savedKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const items = inventory || [];
  const byId = React.useMemo(() => new Map(items.map((i: any) => [String(i.id), i])), [items]);
  const listings = React.useMemo(() => listingsOf(items), [items]);
  const sellsMe = listings.get(String(product.id)) || null;
  const vids = variantIdsOf(product);
  const variants = vids.map((id) => byId.get(id)).filter(Boolean);
  const isListing = vids.length > 0;
  const retail = product.type === 'retail';

  // Codes another product has: new ones aren't saved; ones it had before are settled on the codes check.
  const next = { ...product, ...fieldsOf(draft) };
  const clashes = React.useMemo(() => codeClashes(items, next, { exceptId: product.id, saved: product }), [items, JSON.stringify(fieldsOf(draft)), product]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clashFor = (raw: string) => { const code = codeForm(raw); return code ? clashes.find((c) => c.code === code) || null : null; };
  const blocked = clashes.filter((c) => !c.before);
  const casePack = Math.floor(Number(draft.casePack) || 0); const palletPack = Math.floor(Number(draft.palletPack) || 0);
  const problem = draft.caseBarcode.trim() && casePack < 2 ? 'Say how many are in a case (2 or more), so a scan of the case counts them all.'
    : draft.palletBarcode.trim() && casePack < 2 ? 'Add the case first: a pallet counts its cases.'
      : draft.palletBarcode.trim() && palletPack < 2 ? 'Say how many cases are on a pallet (2 or more).' : '';

  const save = async () => {
    if (busy || !dirty) return;
    if (blocked.length) { setNote({ text: `${blocked[0].raw} is already on ${blocked[0].item?.name || 'another product'}. A code can be on one product only.`, bad: true }); return; }
    if (problem) { setNote({ text: problem, bad: true }); return; }
    const patch = changedCodes(fieldsOf(base), fieldsOf(draft));
    if (!patch) { setBase(draft); return; }
    setBusy(true); setNote(null);
    const r: any = await saveCodes(tenantId, String(product.id), patch);
    setBusy(false);
    if (!r.ok) { setNote({ text: r.error, bad: true }); return; }
    setBase(draft); setNote({ text: 'Saved. Every scanner takes these codes now.' });
  };
  const set = (k: keyof Draft, v: any) => { setDraft((d) => ({ ...d, [k]: v })); setNote(null); };
  const addMore = (v = more) => {
    const c = v.trim(); if (!c) return;
    if (codeForm(c) && [draft.barcode, ...draft.barcodes].some((x) => codeForm(x) === codeForm(c))) { setMore(''); return; }
    set('barcodes', [...draft.barcodes, c].slice(0, 10)); setMore('');
  };
  const scanned = (v: string) => {
    const c = String(v || '').trim(); const where = scan; setScan('');
    if (!c || c.includes('://')) return;
    if (where === 'barcode') set('barcode', c); else if (where === 'more') addMore(c); else if (where === 'case') set('caseBarcode', c); else if (where === 'pallet') set('palletBarcode', c);
    else if (where === 'variant') setAdd((a) => ({ ...a, barcode: c }));
  };

  // ── A new variant ──
  const [adding, setAdding] = React.useState(false);
  const [add, setAdd] = React.useState({ label: '', group: '', barcode: '', price: '', stock: '' });
  const [addBusy, setAddBusy] = React.useState(false);
  const [addErr, setAddErr] = React.useState('');
  const addClash = add.barcode.trim() ? codeClashes(items, { id: '__new__', type: 'retail', barcode: add.barcode }, { exceptId: '__new__' })[0] || null : null;
  const submitVariant = async () => {
    if (addBusy) return;
    if (!add.label.trim()) { setAddErr('Name the variant, like Blush or 30 ml.'); return; }
    if (addClash) { setAddErr(`${addClash.raw} is already on ${addClash.item?.name || 'another product'}. A code can be on one product only.`); return; }
    setAddBusy(true); setAddErr('');
    const r: any = await addVariant(tenantId, String(product.id), { label: add.label.trim(), group: add.group.trim(), barcode: add.barcode.trim(), price: add.price.trim(), stock: Math.max(0, Math.floor(Number(add.stock) || 0)) });
    setAddBusy(false);
    if (!r.ok) { setAddErr(r.error); return; }
    setAdding(false); setAdd({ label: '', group: '', barcode: '', price: '', stock: '' });
    setNote({ text: `${add.label.trim()} is a variant of ${product.name || 'this listing'} now. Its own page has its stock and codes.` });
  };

  const field = 'h-11 w-full min-w-0 rounded-xl border bg-transparent px-3 text-[14.5px] tabular-nums outline-none';
  const lab = 'mb-1.5 block text-[13px] font-semibold';
  const box = 'flex flex-col gap-3.5 rounded-[18px] border p-4';
  const bad = (raw: string) => { const c = clashFor(raw); return c && !c.before ? { borderColor: C.warn, borderWidth: 2 } : { borderColor: C.line }; };
  const clashLine = (raw: string) => {
    const c = clashFor(raw); if (!c) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <p role={c.before ? 'status' : 'alert'} className="m-0 text-[13px] font-semibold" style={{ color: C.warn }}>
          {c.before ? `Also on ${c.item?.name || 'another product'}. Choose which keeps it in Codes and listings.` : `Already on ${c.item?.name || 'another product'}. A code can be on one product only.`}
        </p>
        <Link href={c.before ? '/inventory/codes' : productHref(String(c.item?.id))} className="cf-press inline-flex h-9 items-center rounded-full border px-3.5 text-[12.5px] font-semibold" style={{ borderColor: C.line, color: C.ink }}>
          {c.before ? 'Codes and listings' : `Open ${c.item?.name || 'it'}`}
        </Link>
      </div>);
  };
  const chip = (t: string) => t ? <span className="inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: C.soft }}>{t}</span> : null;
  const scanBtn = (k: typeof scan, label: string) => (
    <button type="button" onClick={() => setScan(scan === k ? '' : k)} aria-pressed={scan === k} aria-label={label} className="cf-press h-11 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold" style={{ borderColor: C.line, color: C.ink, background: C.paper }}>{scan === k ? 'Close' : 'Scan'}</button>);
  const camera = (k: typeof scan) => scan === k ? <div className="mt-2 overflow-hidden rounded-2xl"><ScanGate cameraFirst label="Point at the barcode" onScan={scanned} /></div> : null;

  // ── What a variant sells for, and whether the shop can sell it ──
  const listingLive = isStorefrontVisible(product);
  const shopState = (v: any) => !v ? 'Not in Inventory' : v.status === 'archived' ? 'Archived' : !listingLive ? 'Not in the shop' : buyable(v) ? 'Yes' : 'Sold out';
  const stocked = variants.filter((v: any) => v.status !== 'archived' && canSell(v) > 0).length;
  const byIdLive = byId as Map<string, any>;
  const priceWords = () => {
    const own = variants.filter((v: any) => ownPrice(v)); const rest = variants.filter((v: any) => !ownPrice(v));
    const name = (v: any) => choiceFor(product, String(v.id))?.choice.label || v.name;
    const parts = [...own.map((v: any) => `${name(v)} is ${money(variantPriceCents(v, product))}`)];
    if (rest.length) parts.push(`${rest.map(name).join(rest.length === 2 ? ' and ' : ', ')} ${rest.length === 1 ? 'is' : 'are'} ${money(variantPriceCents(rest[0], product))}`);
    return parts.join('; ');
  };

  return (
    <div className="flex flex-col gap-4 text-left" style={{ color: C.ink }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[14px]" style={note?.bad ? { color: C.warn, fontWeight: 600 } : muted} role={note?.bad ? 'alert' : 'status'}>{note?.text || (dirty ? 'Not saved yet.' : 'Every scanner in the shop reads these codes.')}</p>
        <Btn kind="primary" className="h-11 px-5 text-[14px]" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</Btn>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className={`${box} min-w-0 flex-[1_1_360px]`} style={{ borderColor: C.line }} aria-label="Codes">
          <p className="m-0 text-[13px] font-semibold" style={muted}>{isListing ? 'The listing’s own codes' : sellsMe ? 'This variant’s codes' : 'This product’s codes'}</p>
          <div>
            <label htmlFor="code-sku" className={lab}>SKU · your own code</label>
            <input id="code-sku" value={draft.sku} onChange={(e) => set('sku', e.target.value)} autoComplete="off" className={field} style={{ ...bad(draft.sku), color: C.ink }} />
            {clashLine(draft.sku)}
          </div>
          <div>
            <label htmlFor="code-barcode" className={lab}>Barcode on the product</label>
            <div className="flex items-center gap-2">
              <input id="code-barcode" value={draft.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or type" autoComplete="off" className={field} style={{ ...bad(draft.barcode), color: C.ink }} />
              {chip(kindOf(draft.barcode))}
              {scanBtn('barcode', 'Scan the barcode with the camera')}
            </div>
            {camera('barcode')}
            {clashLine(draft.barcode)}
          </div>
          {draft.barcodes.map((c, i) => (
            <div key={`${c}-${i}`}>
              <label htmlFor={`code-more-${i}`} className={lab}>Another barcode</label>
              <div className="flex items-center gap-2">
                <input id={`code-more-${i}`} value={c} onChange={(e) => set('barcodes', draft.barcodes.map((x, j) => (j === i ? e.target.value : x)))} autoComplete="off" className={field} style={{ ...bad(c), color: C.ink }} />
                {chip(kindOf(c))}
                <button type="button" onClick={() => set('barcodes', draft.barcodes.filter((_, j) => j !== i))} aria-label={`Remove ${c}`} className="cf-press h-11 shrink-0 px-2 text-[13px] font-semibold" style={muted}>Remove</button>
              </div>
              {clashLine(c)}
            </div>))}
          {draft.barcodes.length < 10 && (
            <div>
              <label htmlFor="code-add" className={lab}>{draft.barcodes.length ? 'One more barcode' : 'Another barcode (optional)'}</label>
              <div className="flex items-center gap-2">
                <input id="code-add" value={more} onChange={(e) => setMore(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMore(); } }} placeholder="A second barcode it carries" autoComplete="off" className={field} style={{ borderColor: C.line, color: C.ink }} />
                <button type="button" onClick={() => addMore()} disabled={!more.trim()} className="cf-press h-11 shrink-0 rounded-full px-4 text-[13px] font-semibold disabled:opacity-40" style={{ background: C.soft, color: C.ink }}>Add</button>
                {scanBtn('more', 'Scan another barcode with the camera')}
              </div>
              {camera('more')}
            </div>)}
          <div className="grid grid-cols-[minmax(0,1fr)_112px] items-end gap-2">
            <div className="min-w-0"><label htmlFor="code-case" className={lab}>Case code</label><input id="code-case" value={draft.caseBarcode} onChange={(e) => set('caseBarcode', e.target.value)} placeholder="On the carton" autoComplete="off" className={field} style={{ ...bad(draft.caseBarcode), color: C.ink }} /></div>
            <div><label htmlFor="code-case-n" className={lab}>In a case</label><input id="code-case-n" value={draft.casePack} onChange={(e) => set('casePack', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Units" className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
          </div>
          {clashLine(draft.caseBarcode)}
          <div className="grid grid-cols-[minmax(0,1fr)_112px] items-end gap-2">
            <div className="min-w-0"><label htmlFor="code-pallet" className={lab}>Pallet code</label><input id="code-pallet" value={draft.palletBarcode} onChange={(e) => set('palletBarcode', e.target.value)} placeholder="Scan or type" autoComplete="off" className={field} style={{ ...bad(draft.palletBarcode), color: C.ink }} /></div>
            <div><label htmlFor="code-pallet-n" className={lab}>Cases on it</label><input id="code-pallet-n" value={draft.palletPack} onChange={(e) => set('palletPack', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Cases" className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
          </div>
          {clashLine(draft.palletBarcode)}
          {casePack > 1 && palletPack > 1 && <p className="-mt-1.5 m-0 text-[12.5px]" style={muted}>A scan of the pallet counts {casePack * palletPack} ({palletPack} cases of {casePack}).</p>}
          {problem && <p className="m-0 text-[13px] font-semibold" style={{ color: C.warn }}>{problem}</p>}
          <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>Case and pallet codes can be added here for any product, in the shop or not. Its own QR code always works too, and it’s printed on every label next to the barcode.</p>
          <Link href={`/inventory/labels?items=${encodeURIComponent(String(product.id))}:1`} className="cf-press inline-flex h-11 w-fit items-center rounded-full border px-4 text-[13.5px] font-semibold" style={{ borderColor: C.line, color: C.ink }}>Print labels</Link>
        </section>

        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-4">
          {sellsMe ? (
            <section className={box} style={{ borderColor: C.line }} aria-label="Its listing">
              <p className="m-0 text-[13px] font-semibold" style={muted}>A variant of {sellsMe.name || 'a listing'}</p>
              <p className="m-0 text-[15px] leading-relaxed">
                Sold inside {sellsMe.name || 'its listing'} as “{choiceFor(sellsMe, String(product.id))?.choice.label || product.name}”, for {money(variantPriceCents(product, sellsMe))} ({ownPrice(product) ? 'its own price' : 'the listing’s price'}). Its codes and stock are its own, and it’s never listed on its own in the shop.
              </p>
              <Link href={productHref(String(sellsMe.id))} className="cf-press inline-flex h-11 w-fit items-center rounded-full px-4 text-[13.5px] font-semibold" style={{ background: C.soft, color: C.ink }}>Open {sellsMe.name || 'the listing'}</Link>
            </section>
          ) : retail ? (
            <section className={box} style={{ borderColor: C.line }} aria-label="Variants">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <p className="m-0 text-[13px] font-semibold" style={muted}>Variants · each with its own code and stock</p>
                {!adding && <Btn kind="soft" className="h-11 px-4 text-[13.5px]" style={{ border: `1px solid ${C.line}`, background: C.paper }} onClick={() => { setAdding(true); setAddErr(''); }}>Add a variant</Btn>}
              </div>
              {isListing ? (<>
                <ul className="m-0 flex list-none flex-col p-0 sm:hidden">{vids.map((id, i) => {
                  const v = byIdLive.get(id);
                  const label = choiceFor(product, id)?.choice.label || v?.name || 'Variant';
                  const unit = v ? codesOf(v).find((c) => c.kind === 'unit') || codesOf(v)[0] : null;
                  const n = v ? Math.max(0, Math.floor(Number(v.totalStock) || 0)) : 0;
                  return (
                    <li key={id} className="flex items-start gap-3 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : 0 }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{v ? <Link href={productHref(id)} style={{ color: C.ink }}>{label}</Link> : label}</span>
                        <span className="mt-0.5 block text-[13px] leading-relaxed tabular-nums" style={muted}>{unit ? unit.raw : 'No barcode yet'}{v ? <> · {money(variantPriceCents(v, product))} {ownPrice(v) ? 'its own' : 'the listing’s'}</> : null}</span>
                        <span className="mt-0.5 block text-[13px]" style={muted}>{shopState(v) === 'Yes' ? 'In the shop' : shopState(v)}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="block text-[17px] font-semibold" style={n === 0 ? { color: C.warn } : undefined}>{n}</span>
                        <span className="block text-[12px]" style={muted}>in stock</span>
                      </span>
                    </li>);
                })}</ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full border-collapse text-[14px]">
                    <thead><tr>{['Variant', 'Barcode', 'In stock', 'Price', 'In the shop'].map((h) => <th key={h} className="whitespace-nowrap border-b px-2.5 py-2 text-left text-[12.5px] font-semibold" style={{ borderColor: C.line, color: C.muted }}>{h}</th>)}</tr></thead>
                    <tbody>{vids.map((id, i) => {
                      const v = byIdLive.get(id); const last = i === vids.length - 1; const td = { borderBottom: last ? 0 : `1px solid ${C.line}` };
                      const label = choiceFor(product, id)?.choice.label || v?.name || 'Variant';
                      const unit = v ? codesOf(v).find((c) => c.kind === 'unit') || codesOf(v)[0] : null;
                      const n = v ? Math.max(0, Math.floor(Number(v.totalStock) || 0)) : 0;
                      return (
                        <tr key={id}>
                          <td className="whitespace-nowrap px-2.5 py-2.5 font-semibold" style={td}>{v ? <Link href={productHref(id)} className="underline-offset-2 hover:underline" style={{ color: C.ink }}>{label}</Link> : label}</td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 tabular-nums" style={{ ...td, ...(unit ? {} : { color: C.muted }) }}>{unit ? unit.raw : 'None yet'}</td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 tabular-nums" style={{ ...td, ...(n === 0 ? { color: C.warn, fontWeight: 600 } : {}) }}>{n}</td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 tabular-nums" style={td}>{v ? <>{money(variantPriceCents(v, product))} <span style={muted}>· {ownPrice(v) ? 'its own' : 'the listing’s'}</span></> : '·'}</td>
                          <td className="whitespace-nowrap px-2.5 py-2.5" style={td}>{shopState(v)}</td>
                        </tr>);
                    })}</tbody>
                  </table>
                </div>
              </>) : (
                <p className="m-0 text-[14.5px] leading-relaxed">No variants. A product that comes in colors, sizes or scents lists them here, each with its own barcode, stock and price when it has one, and is sold as one listing.</p>)}
              {isListing && (
                <div className="flex flex-wrap gap-2.5">
                  <div className="min-w-0 flex-[1_1_220px] rounded-[14px] px-3.5 py-3" style={{ background: C.soft }}>
                    <p className="m-0 text-[13px] font-semibold" style={muted}>In the shop</p>
                    <p className="m-0 mt-0.5 text-[14px] font-semibold">{!listingLive ? 'Not in the shop' : listingStock(product, byIdLive) > 0 ? `In stock · ${listingStock(product, byIdLive)} across ${stocked} ${stocked === 1 ? 'variant' : 'variants'}` : 'Sold out'}</p>
                    <p className="m-0 mt-0.5 text-[12.5px] leading-snug" style={muted}>A variant that’s sold out shows as sold out inside the listing, never as a listing of its own.</p>
                  </div>
                  <div className="min-w-0 flex-[1_1_220px] rounded-[14px] px-3.5 py-3" style={{ background: C.soft }}>
                    <p className="m-0 text-[13px] font-semibold" style={muted}>Scanning the listing’s barcode</p>
                    <p className="m-0 mt-0.5 text-[14px] font-semibold">{codesOf(product).length ? 'Asks which variant' : 'The listing has no code of its own'}</p>
                    <p className="m-0 mt-0.5 text-[12.5px] leading-snug" style={muted}>Each variant’s own barcode goes straight to that variant.</p>
                  </div>
                </div>)}
              {adding && (
                <div className="flex flex-col gap-3 rounded-[14px] border p-3.5" style={{ borderColor: C.line }}>
                  <p className="m-0 text-[14px] font-semibold">A new variant of {product.name || 'this listing'}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0"><label htmlFor="var-label" className={lab}>Its name</label><input id="var-label" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} placeholder="Blush, 30 ml…" autoComplete="off" className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
                    {!variantGroup(product) && <div className="min-w-0"><label htmlFor="var-group" className={lab}>What customers choose</label><input id="var-group" value={add.group} onChange={(e) => setAdd({ ...add, group: e.target.value })} placeholder="Color, size or scent" autoComplete="off" className={field} style={{ borderColor: C.line, color: C.ink }} /></div>}
                    <div className="min-w-0">
                      <label htmlFor="var-barcode" className={lab}>Its barcode (optional)</label>
                      <div className="flex items-center gap-2"><input id="var-barcode" value={add.barcode} onChange={(e) => setAdd({ ...add, barcode: e.target.value })} placeholder="Scan or type" autoComplete="off" className={field} style={{ borderColor: addClash ? C.warn : C.line, borderWidth: addClash ? 2 : 1, color: C.ink }} />{scanBtn('variant', 'Scan the variant’s barcode with the camera')}</div>
                    </div>
                    <div className="min-w-0"><label htmlFor="var-price" className={lab}>Its own price (optional)</label><input id="var-price" value={add.price} onChange={(e) => setAdd({ ...add, price: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) })} inputMode="decimal" placeholder={Number(product.msrp) > 0 ? `The listing’s, $${Number(product.msrp).toFixed(2)}` : 'The listing’s'} className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
                    <div className="min-w-0"><label htmlFor="var-stock" className={lab}>How many you have now</label><input id="var-stock" value={add.stock} onChange={(e) => setAdd({ ...add, stock: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" placeholder="0" className={field} style={{ borderColor: C.line, color: C.ink }} /></div>
                  </div>
                  {camera('variant')}
                  {addClash && <p role="alert" className="m-0 text-[13px] font-semibold" style={{ color: C.warn }}>{addClash.raw} is already on {addClash.item?.name || 'another product'}. A code can be on one product only.</p>}
                  {!isListing && Number(product.totalStock) > 0 && <p className="m-0 text-[13px] leading-relaxed" style={muted}>{product.name || 'This product'} has {Math.floor(Number(product.totalStock))} in stock of its own. Once it has variants, each variant holds its own stock, so count those into the variants they are.</p>}
                  {addErr && <p role="alert" className="m-0 text-[13px] font-semibold" style={{ color: C.warn }}>{addErr}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Btn kind="primary" className="h-11 px-5 text-[14px]" disabled={addBusy} onClick={() => void submitVariant()}>{addBusy ? 'Adding…' : 'Add the variant'}</Btn>
                    <Btn kind="soft" className="h-11 px-4 text-[14px]" onClick={() => { setAdding(false); setAddErr(''); if (scan === 'variant') setScan(''); }}>Cancel</Btn>
                  </div>
                  <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>It’s added to Inventory as a product of its own, named “{product.name || 'Listing'} · {add.label.trim() || 'its name'}”, with this listing’s supplier and cost. Its choices and words in the shop are the listing’s.</p>
                </div>)}
            </section>
          ) : null}

          {(isListing || sellsMe) && (
            <section className={box} style={{ borderColor: C.line }} aria-label="What a variant costs">
              <p className="m-0 text-[13px] font-semibold" style={muted}>What a variant costs</p>
              <div className="flex items-start gap-3 rounded-[14px] px-3.5 py-3" style={{ background: C.soft }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ok} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
                <div className="min-w-0">
                  <p className="m-0 text-[14px] font-semibold">Its own price when it has one, otherwise the listing’s</p>
                  {isListing && variants.length > 0 && <p className="m-0 mt-0.5 text-[12.5px] leading-snug" style={muted}>{priceWords()}.</p>}
                </div>
              </div>
              <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>The price shown in the shop is the price charged, online and at the desk. A variant with no price of its own and no listing price can’t be sold until it has one.</p>
            </section>)}
        </div>
      </div>
    </div>);
}
