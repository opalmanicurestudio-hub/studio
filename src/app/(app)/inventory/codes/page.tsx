'use client';
// src/app/(app)/inventory/codes/page.tsx — CODES AND LISTINGS. What stops a scan or a sale from working, counted on
// this shop's own products every time the page opens (lib/code-index codesCheck): a code on more than one product
// (choose which keeps it), and, with the online shop on, listings that look sold out while their variants have stock,
// things in the shop with nothing to scan, and variants that show as listings of their own.
import * as React from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { checkCodes, keepCode } from '@/lib/codes-api';
import { codeKindLabel } from '@/lib/code-form';
import { tenantTimeZone } from '@/lib/tenant-time';
import { Btn, C, Empty, UndoBar, muted } from '@/components/orders/ui';

type Owner = { productId: string; name: string; kind: string; raw: string };
type ClashRow = { code: string; raw: string; kind: any; pack: number; owners: Owner[] };
type Check = {
  checkedAt: string; shop: boolean; products: number; codes: number;
  counts: { clashes: number; soldOut: number; noCode: number; variantsListed: number };
  clashes: ClashRow[]; soldOut: { productId: string; name: string; withStock: number }[];
  noCode: { productId: string; name: string; listingId?: string }[];
  variantsListed: { productId: string; name: string; listingId: string; listingName: string }[];
  lookalikes: { a: string; b: string; aName: string; bName: string }[];
};
type Tile = 'clashes' | 'soldOut' | 'noCode' | 'variantsListed';

const TILES: { id: Tile; title: string; sub: string; shopOnly: boolean }[] = [
  { id: 'clashes', title: 'Codes on more than one product', sub: 'A scan can’t tell which one it is', shopOnly: false },
  { id: 'soldOut', title: 'Listings that look sold out', sub: 'Their variants have stock', shopOnly: true },
  { id: 'noCode', title: 'In the shop with nothing to scan', sub: 'No barcode or SKU on the product', shopOnly: true },
  { id: 'variantsListed', title: 'Variants listed on their own', sub: 'They show next to their own listing', shopOnly: true },
];
const productHref = (id: string) => `/inventory/product/${encodeURIComponent(id)}`;

export default function CodesCheckPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const zone = tenantTimeZone(selectedTenant);
  const [data, setData] = React.useState<Check | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState('');
  const [tile, setTile] = React.useState<Tile>('clashes');
  const [keeping, setKeeping] = React.useState('');
  const [toast, setToast] = React.useState('');
  const shown = React.useRef(false);

  const forTenant = React.useRef(tenantId); forTenant.current = tenantId;
  const run = React.useCallback(async () => {
    if (!tenantId) return;
    setBusy(true); setError('');
    const r: any = await checkCodes(tenantId);
    if (forTenant.current !== tenantId) return;   // another business was chosen meanwhile
    if (r.ok) { setData(r as Check); shown.current = true; }
    else { setError(r.error); if (shown.current) setToast(r.error); }   // with lists on screen, say so over them
    setBusy(false);
  }, [tenantId]);
  // Another business chosen: nothing of the last one's stays on screen.
  React.useEffect(() => { setData(null); shown.current = false; setTile('clashes'); void run(); }, [run]);

  const keep = async (row: ClashRow, o: Owner) => {
    if (keeping) return;
    setKeeping(`${row.code}|${o.productId}`);
    const r: any = await keepCode(tenantId, row.code, o.productId);
    setKeeping('');
    if (!r.ok) { setToast(r.error); return; }
    const off: string[] = Array.isArray(r.removedFrom) ? r.removedFrom : [];
    setToast(`${row.raw} stays on ${o.name}${off.length ? `, and came off ${off.join(' and ')}` : ''}.`);
    void run();
  };

  const tiles = TILES.filter((t) => !t.shopOnly || data?.shop !== false);
  const checkedAt = data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).toLowerCase() : '';
  const rowCls = 'flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-3 last:border-b-0';

  const list = () => {
    if (!data) return null;
    if (tile === 'clashes') return (
      <>
        {data.clashes.length === 0
          ? <Empty title="Every code is on one product" sub="A code typed, scanned in or imported that another product has is refused, so it stays that way." />
          : data.clashes.map((row) => (
            <div key={row.code} className={rowCls} style={{ borderColor: C.line }}>
              <div className="min-w-0 flex-[1_1_300px]">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-[15px] font-semibold tabular-nums tracking-[0.03em]">{row.raw}</p>
                  <span className="inline-flex h-[26px] items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: C.soft }}>{codeKindLabel(row.kind, row.pack)}</span>
                </div>
                <p className="m-0 mt-1 text-[13px]" style={muted}>
                  On {row.owners.map((o, i) => <React.Fragment key={o.productId}>{i > 0 ? (i === row.owners.length - 1 ? ' and on ' : ', ') : ''}<Link href={productHref(o.productId)} className="underline underline-offset-2" style={{ color: C.ink }}>{o.name}</Link></React.Fragment>)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.owners.slice(0, 6).map((o, i) => (
                  <Btn key={o.productId} kind={i === 0 ? 'primary' : 'soft'} className="h-11 text-[14px]" disabled={!!keeping} onClick={() => keep(row, o)}>
                    {keeping === `${row.code}|${o.productId}` ? 'Saving…' : `Keep on ${o.name}`}
                  </Btn>))}
              </div>
            </div>))}
        {data.lookalikes.length > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-[14px] px-3.5 py-3" style={{ background: C.soft }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.ok} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0"><path d="m5 12 5 5 9-10" /></svg>
            <p className="m-0 text-[13.5px] leading-relaxed">{data.lookalikes[0].a} and {data.lookalikes[0].b} used to count as one code, because only their digits were compared. They’re two codes now, on {data.lookalikes[0].aName} and {data.lookalikes[0].bName}, and nothing needs doing.</p>
          </div>)}
      </>);
    if (tile === 'soldOut') return data.soldOut.length === 0
      ? <Empty title="No listing looks sold out by mistake" sub="A listing whose variants have stock shows as in stock." />
      : data.soldOut.map((r) => (
        <div key={r.productId} className={rowCls} style={{ borderColor: C.line }}>
          <div className="min-w-0 flex-[1_1_260px]"><p className="m-0 text-[15px] font-semibold">{r.name}</p><p className="m-0 mt-0.5 text-[13px]" style={muted}>Shows sold out. {r.withStock} {r.withStock === 1 ? 'variant has' : 'variants have'} stock.</p></div>
          <Link href={productHref(r.productId)} className="cf-press inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold" style={{ background: C.soft, color: C.ink }}>Open</Link>
        </div>));
    if (tile === 'noCode') return data.noCode.length === 0
      ? <Empty title="Everything in the shop can be scanned" sub="Every listing, or each of its variants, has a barcode or SKU." />
      : data.noCode.map((r) => (
        <div key={r.productId} className={rowCls} style={{ borderColor: C.line }}>
          <div className="min-w-0 flex-[1_1_260px]"><p className="m-0 text-[15px] font-semibold">{r.name}</p><p className="m-0 mt-0.5 text-[13px]" style={muted}>No barcode or SKU yet. Scan the one printed on it, or give it a SKU.</p></div>
          <Link href={productHref(r.productId)} className="cf-press inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold" style={{ background: C.soft, color: C.ink }}>Add a code</Link>
        </div>));
    return data.variantsListed.length === 0
      ? <Empty title="No variant shows on its own" sub="Each variant is sold through its listing." />
      : data.variantsListed.map((r) => (
        <div key={r.productId} className={rowCls} style={{ borderColor: C.line }}>
          <div className="min-w-0 flex-[1_1_260px]"><p className="m-0 text-[15px] font-semibold">{r.name}</p><p className="m-0 mt-0.5 text-[13px]" style={muted}>A variant of {r.listingName}, also shown as a listing of its own.</p></div>
          <Link href={productHref(r.productId)} className="cf-press inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold" style={{ background: C.soft, color: C.ink }}>Open</Link>
        </div>));
  };

  const current = TILES.find((t) => t.id === tile)!;
  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pb-16 pt-5 lg:px-8">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold" style={muted}>Inventory{checkedAt ? ` · checked at ${checkedAt}` : ''}</p>
            <h1 className="m-0 mt-0.5 text-[26px] font-light leading-tight tracking-[-0.02em] sm:text-[30px]">Codes and listings</h1>
          </div>
          <Btn kind="soft" className="h-11 shrink-0 px-4 text-[14px]" disabled={busy} onClick={() => void run()}>{busy ? 'Checking…' : 'Check again'}</Btn>
        </div>
        <p className="m-0 -mt-2 max-w-[760px] text-[15px] leading-relaxed" style={muted}>
          {data?.shop === false ? 'A code on two products stops a scan from telling which one it is.' : 'Four things stop a scan or a sale from working. When all four are at zero, every scanner in the shop takes the same codes and every listing sells what’s on the shelf.'}
        </p>

        {error && !data ? (
          <div className="rounded-[18px] border p-5" style={{ borderColor: C.line }}>
            <p className="m-0 text-[15px]">{error}</p>
            <Btn kind="primary" className="mt-3 h-11 text-[14px]" onClick={() => void run()}>Try again</Btn>
          </div>
        ) : (
          <>
            {tiles.length > 1 && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((t) => {
                const n = data ? data.counts[t.id] : null; const on = tile === t.id;
                return (
                  <button key={t.id} type="button" aria-pressed={on} onClick={() => setTile(t.id)}
                    className="cf-press flex min-h-[124px] flex-col gap-1.5 rounded-[18px] bg-transparent text-left"
                    style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: on ? 15 : 16, color: C.ink }}>
                    <span className="text-[34px] font-light leading-none tracking-[-0.02em] tabular-nums" style={n === 0 ? { color: C.ok } : undefined}>{n === null ? '·' : n}</span>
                    <span className="text-[14px] font-semibold leading-snug">{t.title}</span>
                    <span className="text-[12.5px] leading-snug" style={muted}>{t.sub}</span>
                  </button>);
              })}
            </div>}

            <div className="flex flex-wrap items-start gap-5">
              <section className="min-w-0 flex-[2_1_640px] rounded-[18px] border p-4" style={{ borderColor: C.line }} aria-label={current.title}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 text-[13px] font-semibold" style={muted}>{current.title}{data ? ` · ${data.counts[tile]}` : ''}</p>
                  {tile === 'clashes' && (data?.clashes.length || 0) > 0 && <p className="m-0 text-[12.5px]" style={muted}>Choose which product keeps each code. The others keep their other codes.</p>}
                </div>
                <div className="mt-1">{busy && !data ? <p className="m-0 py-10 text-center text-[15px]" style={muted}>Checking every product…</p> : list()}</div>
              </section>
              <aside className="min-w-0 flex-[1_1_320px] rounded-[18px] border p-4" style={{ borderColor: C.line }}>
                <p className="m-0 text-[13px] font-semibold" style={muted}>How codes work</p>
                <p className="m-0 mt-2 text-[14px] leading-relaxed">Every code is kept once, in one form, on one product or variant: your SKU, the barcode on the product, a case’s or pallet’s code, and tags. A code that’s already taken is refused wherever it’s typed, scanned in or imported, and you’re shown the product it’s on.</p>
                {data && <p className="m-0 mt-3 text-[12.5px]" style={muted}>{data.codes} {data.codes === 1 ? 'code' : 'codes'} on {data.products} {data.products === 1 ? 'item' : 'items'}.</p>}
              </aside>
            </div>
          </>
        )}
      </div>
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
    </div>);
}
