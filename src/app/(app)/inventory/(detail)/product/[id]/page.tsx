'use client';
// The product page: what it is, how much is on the shelf, how it sells, and everything else a tab away.
import { LotOrders } from '@/components/inventory/LotOrders';
import { costGap, lineCost, perContainer, recipeLines, restockMarkupPct, unitCost, unitLabel, usesLeft } from '@/lib/product-cost';
import { verifyPin } from '@/lib/pin-client';
import React, { useMemo, useState } from 'react';
import { useParams, notFound } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import Link from 'next/link';
import Image from 'next/image';
import { format, parseISO, isPast } from 'date-fns';
import { reconcile } from '@/lib/stock-ledger';
import { OnlineListingTab } from '@/components/inventory/OnlineListingTab';
import { CodesTab } from '@/components/inventory/CodesTab';
import { QuickReceiveDialog } from '@/components/inventory/QuickReceiveDialog';
import { syncPublicFields } from '@/lib/product-public';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { type InventoryItem } from '@/lib/data';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { saveProduct } from '@/lib/codes-client';
import { saveChoices } from '@/lib/codes-api';
import { doc } from 'firebase/firestore';
import { useStockChangesFor } from '@/hooks/use-stock';
import { useAppointmentWindow } from '@/hooks/use-appointments';
import { useClientsByIds } from '@/hooks/use-clients';
import { choiceFor, listingsOf, priceCentsOf, variantIdsOf } from '@/lib/variants';
import { shopStatus } from '@/components/products/ProductsList';
import { CountSheet } from '@/components/products/CountSheet';
import { productFeatures } from '@/lib/product-features';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';
import QRCode from 'qrcode';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

// Gathers every image the product carries, primary first, junk-safe.
const collectImages = (p: any): string[] =>
  [p?.imageUrl, ...(Array.isArray(p?.imageUrls) ? p.imageUrls : [])].filter(Boolean);

// The page's building blocks. Kept outside the page so typing in a field inside one doesn't rebuild it.
const card: React.CSSProperties = { background: C.paper, border: `1px solid ${C.line}` };
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
function Tile({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: string }) {
    return (
        <div className="rounded-2xl p-4" style={card}>
            <p className="m-0 text-[13px]" style={muted}>{label}</p>
            <p className="m-0 mt-1 text-[26px] font-light tabular-nums tracking-[-0.02em]" style={tone ? { color: tone } : undefined}>{value}</p>
            {note ? <p className="m-0 mt-0.5 text-[13px]" style={muted}>{note}</p> : null}
        </div>
    );
}
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl p-5" style={card}>
            <div className="mb-3 flex items-center justify-between gap-3"><h2 className="m-0 text-[17px] font-semibold">{title}</h2>{action}</div>
            {children}
        </section>
    );
}
function Line({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
    return <div className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[15px] first:border-t-0" style={{ borderColor: C.line }}><span style={muted}>{k}</span><span className="text-right tabular-nums">{v}</span></div>;
}

export default function ProductDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { inventory, locations, services, staff, isLoading: isInventoryLoading } = useInventory();
    // Who a service-use entry was for: recent visits from the shared window, and just those visits' clients.
    const { appointments } = useAppointmentWindow();
    const usedForIds = useMemo(() => (appointments || []).map((a: any) => a.clientId).filter(Boolean), [appointments]);
    const { clients } = useClientsByIds(usedForIds);
    const { stockCorrections } = useStockChangesFor(id || null);   // this product's changes only
    const { firestore } = useFirebase();
    // FIX: tenantId was never derived from selectedTenant — handleProductUpdate
    // referenced a bare `tenantId` that didn't exist, throwing a ReferenceError
    // the moment anyone tried to edit a product from this page.
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const sellOn = productFeatures(selectedTenant).sell;
    const { toast } = useToast();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isCountOpen, setIsCountOpen] = useState(false);
    const [countTarget, setCountTarget] = useState<any>(null);
    const [isReceiveOpen, setIsReceiveOpen] = useState(false);
    const [qr, setQr] = useState('');
    const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
    
    // Vault State
    const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
    const [vaultPin, setVaultPin] = useState('');
    const [isVerifyingVault, setIsVerifyingVault] = useState(false);
    
    const product = useMemo(() => inventory.find((p) => p.id === id), [inventory, id]);
    // The tab a link asks for (?tab=online, say), else the overview.
    // (equipment, an overhead cost). Worked out again for each product, so one product's tab never leaves the next
    // on a tab it doesn't have.
    const [tab, setTab] = useState('overview');
    const productType = String((product as any)?.type || '');
    const listings = useMemo(() => listingsOf(inventory || []), [inventory]);
    const hasVariants = variantIdsOf(product).length > 0;
    React.useEffect(() => {
        const old: Record<string, string> = { manufacturing: 'stock', batches: 'stock', ledger: 'history' };
        const has = (t: string) => t === 'codes' ? productType !== 'equipment' : t === 'online' ? productType === 'retail' && sellOn : t === 'variants' ? hasVariants : ['overview', 'stock', 'history'].includes(t);
        const raw = new URLSearchParams(window.location.search).get('tab') || '';
        const asked = old[raw] || raw;
        setTab(asked && has(asked) ? asked : 'overview');
        // Read once per product (when it opens, or when it loads): adding the first variant mustn't move anyone off their tab.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, productType, sellOn]);
    // The last variant removed while its tab is open: its codes are where variants are added back.
    React.useEffect(() => { if (tab === 'variants' && !hasVariants && productType) setTab('codes'); }, [tab, hasVariants, productType]);

    /**
     * Section saves from the In the shop tab.
     *
     * A PATCH, not a whole product: two sections saved seconds apart must not
     * overwrite each other, and a page holding a stale copy of a field it
     * never touched must not write it back.
     */
    const handleOnlineSave = async (patch: Record<string, any>) => {
        if (!firestore || !tenantId || !product) return;
        const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', product.id);
        updateDocumentNonBlocking(itemRef, syncPublicFields({ ...patch }));
        toast({ title: 'Saved', description: 'Your shop is updated.' });
    };

    // A listing's choices are saved by the server, which points each variant at the listing and refuses a product
    // another listing already sells (lib/code-index saveListingChoices): the reason is shown, and nothing is saved.
    const handleChoicesSave = async (groups: any[], was?: any[]): Promise<{ ok: boolean; optionGroups?: any[] }> => {
        if (!tenantId || !product) return { ok: false };
        const r: any = await saveChoices(tenantId, product.id, groups, was);
        if (!r.ok) { toast({ variant: 'destructive', title: 'Not saved', description: r.error }); return { ok: false }; }
        toast({ title: 'Saved', description: 'Your shop is updated.' });
        return { ok: true, optionGroups: r.optionGroups };
    };

    // A product's codes are saved by the server, which refuses one another product has (lib/codes-client): the form
    // stays open with the reason, and nothing is saved.
    const handleProductUpdate = async (updatedProduct: InventoryItem): Promise<boolean> => {
        if (!firestore || !tenantId) return false;
        const r = await saveProduct(firestore, tenantId, product, updatedProduct);
        if (!r.ok) { toast({ variant: 'destructive', title: 'Not saved', description: r.error }); return false; }
        toast({ title: "Saved", description: "Your changes are saved." });
        setIsEditDialogOpen(false);
        return true;
    };
    
    const productCategories = useMemo(() => {
        const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
        return [...new Set(allCategories)];
    }, [inventory]);

    const handleUnlockVault = async () => {
        setIsVerifyingVault(true);
        const pv = await verifyPin(selectedTenant?.id || '', vaultPin, ['owner', 'admin', 'manager']);   // checked on the server, owners & admins only
        const authorized = pv.ok;
        
        if (authorized) {
            setIsVaultUnlocked(true);
            setVaultPin('');
            toast({ title: "Unlocked", description: "The maker details and recipe are showing." });
        } else {
            toast({ variant: "destructive", title: "That PIN didn’t work", description: "It needs a manager’s PIN." });
            setVaultPin('');
        }
        setIsVerifyingVault(false);
    };

    const ledgerWithRunningStock = useMemo(() => {
        if (!product || !appointments || !clients) return [];
      
        const correctionsOldestFirst = stockCorrections
          .filter(sc => sc.productId === product.id)
          .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
    
        let totalChange = correctionsOldestFirst.reduce((acc, c) => acc + c.change, 0);
        
        let initialTotalUnits;
        if (product.costingMethod === 'uses') {
          const usesPerContainer = product.estimatedUses || 1;
          let currentTotalUses = (product.totalStock * usesPerContainer) + (product.partialContainerUses || 0);
          initialTotalUnits = currentTotalUses - totalChange;
        } else if (product.costingMethod === 'size' && product.size) {
          const sizePerContainer = product.size || 1;
          let currentTotalSize = (product.totalStock * sizePerContainer) + (product.partialContainerSize || 0);
          initialTotalUnits = currentTotalSize - totalChange;
        } else {
          initialTotalUnits = product.totalStock - totalChange;
        }
    
        let runningStock: number;
        let runningPartial: number;
    
        if (product.costingMethod === 'uses') {
            const usesPerContainer = product.estimatedUses || 1;
            runningStock = Math.floor(initialTotalUnits / usesPerContainer);
            runningPartial = initialTotalUnits % usesPerContainer;
        } else if (product.costingMethod === 'size' ) {
            const sizePerContainer = product.size || 1;
            runningStock = Math.floor(initialTotalUnits / sizePerContainer);
            runningPartial = initialTotalUnits % sizePerContainer;
        } else {
            runningStock = initialTotalUnits;
            runningPartial = 0;
        }
      
        const result = correctionsOldestFirst.map(correction => {
            const stockBefore = runningStock;
            const partialBefore = runningPartial;

            if (product.costingMethod === 'uses') {
                const usesPerContainer = product.estimatedUses || 1;
                let currentTotalUses = (runningStock * usesPerContainer) + runningPartial;
                currentTotalUses += correction.change;
                runningStock = Math.floor(currentTotalUses / usesPerContainer);
                runningPartial = currentTotalUses % usesPerContainer;
            } else if (product.costingMethod === 'size') {
                const sizePerContainer = product.size || 1;
                let currentTotalSize = (runningStock * sizePerContainer) + runningPartial;
                currentTotalSize += correction.change;
                runningStock = Math.floor(currentTotalSize / sizePerContainer);
                runningPartial = currentTotalSize % sizePerContainer;
            } else {
                runningStock += correction.change;
            }
            
            let displayReason = correction.reason;
            if (correction.reason.startsWith('Appointment #') && !correction.reason.includes(' for ')) {
                const parts = correction.reason.split(' by ');
                const shortId = parts[0].replace('Appointment #', '').toUpperCase();
                const staffName = parts[1] || 'Unknown Staff';
                const appointment = appointments.find(apt => apt.id.toUpperCase().endsWith(shortId));
                const clientName = appointment ? (clients.find(c => c.id === appointment.clientId)?.name || appointment.clientName) : null;
                displayReason = clientName ? `Service for ${clientName} by ${staffName}` : `Service by ${staffName}`;
            }
    
            return { 
                ...correction, 
                stockBefore,
                partialBefore,
                stockAfter: runningStock, 
                partialAfter: runningPartial, 
                displayReason 
            };
        });
      
        return result.reverse(); 
    }, [product, stockCorrections, appointments, clients]);

    // DOES THE LEDGER EXPLAIN THE SHELF?
    //
    // Every movement is now recorded, so the count can be checked rather than
    // trusted: sum the recorded changes and compare with the number the item
    // actually carries. Zero drift means every unit is accounted for. Non-zero
    // means something moved without a record — a hand edit, a path not yet on
    // the ledger, or a genuine miscount — and the DATE of the first gap is
    // where to look.
    //
    // Scoped to whole-unit products (the count IS the number). For uses/size
    // costing the ledger tracks partial containers, so a simple sum would
    // "find" drift that isn't there — we say nothing rather than cry wolf.
    // A count is a fresh start: the record from the newest count on is what has to add up, so a count really does put
    // a gap right (before, its own entry moved the record by just as much as the shelf, and the gap never closed).
    const stockDrift = useMemo(() => {
        if (!product) return null;
        if (product.costingMethod === 'uses' || product.costingMethod === 'size') return null;
        const all = stockCorrections.filter((sc: any) =>
            sc.productId === product.id && (sc.field || 'totalStock') === 'totalStock')
            .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
        if (all.length === 0) return null;
        const lastCount = [...all].reverse().find((e: any) => e.type === 'counted' && typeof e.balanceAfter === 'number');
        const entries = lastCount ? all.filter((e: any) => String(e.date) > String(lastCount.date)) : all;
        const opening = lastCount ? Number(lastCount.balanceAfter)
            : all.map((e: any) => (typeof e.balanceAfter === 'number' ? e.balanceAfter - (Number(e.change) || 0) : null)).find((v: number | null) => v !== null);
        if (opening === null || opening === undefined) return null;
        const { expected, actual, drift } = reconcile(entries as any, Number(product.totalStock) || 0, opening);
        return { expected, actual, drift, entries: entries.length, since: (lastCount || all[0])?.date || null, fromCount: !!lastCount };
    }, [product, stockCorrections]);

    const filteredLedger = useMemo(() => {
        if (!ledgerWithRunningStock) return [];
        if (!ledgerSearchTerm.trim()) return ledgerWithRunningStock;
        const lowercasedSearch = ledgerSearchTerm.toLowerCase();
        return ledgerWithRunningStock.filter(correction => correction.displayReason.toLowerCase().includes(lowercasedSearch));
    }, [ledgerWithRunningStock, ledgerSearchTerm]);

    if (isInventoryLoading) return <div className="flex min-h-screen w-full items-center justify-center" style={{ background: C.paper }}><p className="text-[15px]" style={muted}>Loading…</p></div>;
    if (!product) return notFound();

    const p: any = product;
    const kindOf = String(p.type || '');
    // Everything with stock can be counted, running-cost items (towels, foils, cleaning supplies) too; equipment can't.
    const countable = kindOf !== 'equipment';
    const productBatches: any[] = product.batches ?? [];
    const shelf = Math.max(0, Number(p.totalStock) || 0);
    const held = Math.max(0, Number(p.stockReserved) || 0);
    const reorderAt = Number(p.lowStockThreshold) || Number(p.reorderPoint) || 0;
    const priceCents = priceCentsOf(p, listings);
    const cost = Number(p.costPerUnit) || 0;
    const variantIds = variantIdsOf(p);
    const variants = variantIds.map((v) => inventory.find((i: any) => String(i.id) === v)).filter(Boolean) as any[];
    // A listing with variants holds nothing itself: its numbers are its variants'.
    const sumOf = (k: string) => variants.reduce((a, v) => a + Math.max(0, Number(v[k]) || 0), 0);
    const stockValue = variantIdsOf(p).length ? variants.reduce((a, v) => a + Math.max(0, Number(v.totalStock) || 0) * (Number(v.costPerUnit) || 0), 0)
        : shelf * cost + (p.costingMethod === 'uses' ? Number(p.partialContainerUses) || 0 : p.costingMethod === 'size' ? Number(p.partialContainerSize) || 0 : 0) * (unitCost(p) ?? 0);
    const free = variantIdsOf(p).length ? variants.reduce((a, v) => a + Math.max(0, (Number(v.totalStock) || 0) - (Number(v.stockReserved) || 0)), 0) : shelf - held;
    // Cost per use by the one rule every screen uses (lib/product-cost): per use, per ml / g, or each. Null when it can't
    // be counted yet (no cost, or no uses / size set), and the page says why instead of showing a wrong number.
    const unit = unitLabel(p);
    const perUseCost = unitCost(p);
    const gap = costGap(p);
    const useWord = p.costingMethod === 'uses' ? 'Cost per use' : p.costingMethod === 'size' ? `Cost per ${unit}` : 'Cost each';   // per ml / g
    const left = usesLeft(p);
    const markup = restockMarkupPct(p, selectedTenant);
    const ownMarkup = Number(p.restockingMarkup) > 0;
    const fundOn = (selectedTenant as any)?.restocking?.enabled === true;
    // The services whose recipe uses it, and what it costs each of them per visit.
    const usedIn = ((services as any[]) || []).filter((sv: any) => sv?.status !== 'archived')
        .map((sv: any) => ({ sv, line: recipeLines(sv.products || []).find((l) => l.productId === String(p.id)) }))
        .filter((x) => !!x.line) as { sv: any; line: { productId: string; qty: number } }[];
    const forServices = kindOf === 'professional' || kindOf === 'overhead' || usedIn.length > 0;
    // "1 use", "10 wraps", "3 ml": the unit reads right for one and for many.
    const one = unit === 'each' ? 'item' : unit === 'uses' ? 'use' : /^(ml|g|oz)$/i.test(unit) ? unit : unit.replace(/s$/, '');
    const many = unit === 'each' ? 'items' : unit;
    const fmtQty = (q: number) => { const r = Math.round(q * 100) / 100; return `${r} ${r === 1 ? one : many}`; };
    const wholesaleCents = priceCentsOf(p, listings, 'wholesale');
    // Not every business sells products, or sells them online: the page shows only what this one has.
    const features = productFeatures(selectedTenant);
    // Refreshments are priced for guests whether or not the business sells retail products.
    const sells = (features.sell && kindOf === 'retail') || kindOf === 'refreshment';
    const status = features.online ? shopStatus(p, listings) : null;
    const listing = listings.get(String(p.id));
    const where = [p.primaryLocationId, ...(Array.isArray(p.secondaryLocationIds) ? p.secondaryLocationIds : [])].filter(Boolean)
        .map((lid: string) => (locations || []).find((l: any) => String(l.id) === String(lid))?.name).filter(Boolean) as string[];
    const photo = collectImages(p)[0];
    const meta = [p.category, p.sku ? `SKU ${p.sku}` : '', p.supplier].filter(Boolean).join(' · ');
    const tabs: { id: string; label: string }[] = [
        { id: 'overview', label: 'Overview' },
        ...(countable ? [{ id: 'stock', label: 'Stock' }] : [{ id: 'stock', label: 'Details' }]),
        ...(kindOf === 'retail' && features.sell ? [{ id: 'online', label: features.online ? 'In the shop' : 'Online shop' }] : []),
        ...(variantIds.length ? [{ id: 'variants', label: 'Variants' }] : []),
        ...(countable ? [{ id: 'codes', label: 'Codes and labels' }] : []),
        { id: 'history', label: 'History' },
    ];
    const ready = kindOf === 'retail' && features.online && !listing ? [
        { done: priceCents > 0, label: 'A price', go: 'overview', fix: () => setIsEditDialogOpen(true) },
        { done: !!photo, label: 'A photo', go: 'online' },
        { done: String(p.publicDescription || p.description || '').trim().length >= 40, label: 'A few lines on what it is', go: 'online' },
        { done: !!(p.barcode || p.gtin), label: 'Its barcode, so search engines can match it', go: 'codes' },
        { done: free > 0 || !!p.preorder?.enabled, label: 'Some on the shelf', go: variantIds.length ? 'variants' : 'stock', fix: variantIds.length ? undefined : () => setIsCountOpen(true) },
        { done: p.showOnline === true, label: 'Turned on for the shop', go: 'online' },
    ] : [];
    const readyDone = ready.filter((r) => r.done).length;
    const recent = ledgerWithRunningStock.slice(0, 5);
    const linkBtn = 'inline-flex h-12 items-center justify-center rounded-full px-5 text-[15px] font-semibold';

    return (
        <div className="flex min-h-screen w-full flex-col overflow-x-hidden" style={{ background: C.paper, color: C.ink }}>
            <AppHeader title="Product" />
            <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-5 px-4 pb-16 pt-5 md:px-6">
                <Link href="/inventory" className="self-start text-[15px]" style={muted}>‹ Products</Link>

                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl" style={{ background: C.soft }}>
                            {photo ? <Image src={photo} alt={p.imageAlt || p.name} fill sizes="72px" className="object-cover" /> : null}
                        </div>
                        <div className="min-w-0">
                            {status ? <span className="mb-1 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={status.tone === 'ok' ? { background: C.okSoft, color: C.ok } : status.tone === 'warn' ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.muted }}>{status.label}</span> : null}
                            <h1 className="m-0 truncate text-[28px] font-light leading-tight tracking-[-0.02em]">{p.name}</h1>
                            {meta ? <p className="m-0 mt-0.5 truncate text-[14px]" style={muted}>{meta}</p> : null}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        <Btn kind="soft" onClick={() => setIsEditDialogOpen(true)}>Edit details</Btn>
                        {countable && <Link href={`/inventory/labels?items=${encodeURIComponent(p.id)}:1`} className={linkBtn} style={{ background: C.soft, color: C.ink }}>Print labels</Link>}
                        <Btn kind="soft" onClick={async () => { const url = await QRCode.toDataURL(`clarityflow://product/${p.id}`, { width: 512, margin: 1, errorCorrectionLevel: 'M' }).catch(() => ''); if (url) setQr(url); }}>QR code</Btn>
                        {countable && !variantIds.length && <Btn kind="soft" onClick={() => setIsCountOpen(true)}>Count it</Btn>}
                        {countable && !variantIds.length && <Btn kind="primary" onClick={() => setIsReceiveOpen(true)}>Receive stock</Btn>}
                    </div>
                </div>

                <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
                    <div className="inline-flex gap-0.5 rounded-full p-1" style={{ background: C.soft }} role="tablist" aria-label="Product sections">
                        {tabs.map((t) => (
                            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="h-11 whitespace-nowrap rounded-full px-4 text-[15px] font-medium"
                                style={tab === t.id ? { background: C.paper, color: C.ink, boxShadow: '0 1px 2px rgba(22, 23, 26, 0.08)' } : { color: C.muted }}>{t.label}</button>
                        ))}
                    </div>
                </div>

                {tab === 'overview' && (
                    <div className="flex flex-col gap-5">
                        {countable && (
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <Tile label="On the shelf" value={variantIds.length ? sumOf('totalStock') : shelf} note={variantIds.length ? `across ${variants.length} variants` : reorderAt ? `reorder at ${reorderAt}` : undefined} tone={!variantIds.length && reorderAt && shelf - held <= reorderAt ? C.warn : undefined} />
                                {sells ? <Tile label="Held for orders" value={variantIds.length ? sumOf('stockReserved') : held} note="paid, not yet handed over" />
                                    : <Tile label="Left to use" value={left === null ? '—' : fmtQty(left)} note={p.costingMethod && left !== null ? 'with the open one' : left === null ? 'set its size or uses' : undefined} />}
                                <Tile label={sells ? 'Price' : useWord} value={sells ? (priceCents > 0 ? money(priceCents / 100) : 'None yet') : perUseCost === null ? 'Can’t count yet' : money(perUseCost)} tone={!sells && perUseCost === null ? C.warn : undefined} />
                                <Tile label="Worth on the shelf" value={money(stockValue)} note="at what it cost" />
                            </div>
                        )}
                        {countable && forServices && (
                            <p className="m-0 rounded-2xl px-4 py-3 text-[14px]" style={gap ? { background: C.warnSoft, color: C.warn } : { background: C.okSoft, color: C.ok }}>
                                {gap ? `Its cost per use can’t be counted yet: ${gap}. Services using it leave it out of their margins and the restocking fund until it’s added in Edit details.`
                                    : `Counts toward service margins${fundOn ? ' and the restocking fund' : ''} at ${money(perUseCost || 0)} ${unit === 'each' ? 'each' : `per ${one}`}.`}
                            </p>
                        )}
                        <div className={`grid gap-5 ${kindOf === 'retail' && features.online ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
                            <div className="flex min-w-0 flex-col gap-5">
                                {sells ? (
                                    <Panel title="Selling it">
                                        <Line k="Price" v={priceCents > 0 ? money(priceCents / 100) : 'None yet'} />
                                        <Line k="It cost" v={money(cost)} />
                                        <Line k="Made on each" v={priceCents > 0 ? money(priceCents / 100 - cost) : '—'} />
                                        <Line k="Margin" v={priceCents > 0 ? `${(((priceCents / 100 - cost) / (priceCents / 100)) * 100).toFixed(0)}%` : '—'} />
                                        {features.online && wholesaleCents > 0 && wholesaleCents !== priceCents ? <Line k="Wholesale" v={money(wholesaleCents / 100)} /> : null}
                                    </Panel>
                                ) : null}
                                {countable && (forServices || !sells) ? (
                                    <Panel title={kindOf === 'overhead' ? 'What it costs to use' : 'Using it in services'}>
                                        <Line k="Counted by" v={p.costingMethod === 'uses' ? 'Uses' : p.costingMethod === 'size' ? `Amount used (${unit})` : 'Each one'} />
                                        <Line k={p.costingMethod ? 'One container cost' : 'One cost'} v={money(cost)} />
                                        {p.costingMethod ? <Line k="One container holds" v={perContainer(p) ? fmtQty(perContainer(p) as number) : <span style={{ color: C.warn }}>Not set</span>} /> : null}
                                        <Line k={useWord} v={perUseCost === null ? <span style={{ color: C.warn }}>Can’t count yet</span> : money(perUseCost)} />
                                        {fundOn && perUseCost !== null ? <Line k={`Set aside for restocking (${markup}%${ownMarkup ? '' : ', the business’s'})`} v={money(perUseCost * (1 + markup / 100))} /> : null}
                                        {usedIn.length > 0 && (
                                            <div className="mt-3 border-t pt-3" style={{ borderColor: C.line }}>
                                                <p className="m-0 mb-1 text-[13px] font-semibold" style={muted}>Used in {usedIn.length} service{usedIn.length === 1 ? '' : 's'}</p>
                                                {usedIn.slice(0, 8).map(({ sv, line }) => { const c = lineCost(p, line.qty); return (
                                                    <Line key={sv.id} k={<Link href={`/services/${encodeURIComponent(sv.id)}`} style={{ color: C.ink }}>{sv.name || 'A service'}</Link>} v={<span>{fmtQty(line.qty)} <span style={muted}>· {c === null ? 'can’t count' : `${money(c)} a visit`}</span></span>} />); })}
                                                {usedIn.length > 8 ? <p className="m-0 pt-1 text-[13px]" style={muted}>and {usedIn.length - 8} more</p> : null}
                                            </div>
                                        )}
                                    </Panel>
                                ) : !countable ? (
                                    <Panel title="Details">
                                        <Line k="It cost" v={money(cost)} />
                                        {p.supplier ? <Line k="From" v={p.supplier} /> : null}
                                    </Panel>
                                ) : null}
                                {variantIds.length > 0 && (
                                    <Panel title="Variants" action={<button type="button" className="-my-2 min-h-[44px] px-2 text-[15px] font-medium" style={{ color: C.ok }} onClick={() => setTab('variants')}>See them all</button>}>
                                        {variants.slice(0, 4).map((v) => <Line key={v.id} k={choiceFor(p, String(v.id))?.choice.label || v.name} v={`${Number(v.totalStock) || 0} on the shelf`} />)}
                                        {variants.length > 4 ? <p className="m-0 pt-2 text-[14px]" style={muted}>and {variants.length - 4} more</p> : null}
                                    </Panel>
                                )}
                                {countable && (
                                    <Panel title="Where it is">
                                        <p className="m-0 text-[15px]">{where.length ? where.join(', ') : <span style={muted}>No place set yet. Add one in Edit details so anyone can find it.</span>}</p>
                                        {p.lastCountedAt ? <p className="m-0 mt-2 text-[14px]" style={muted}>Last counted {format(safeDate(p.lastCountedAt), 'MMM d')}{p.lastCountedBy ? ` by ${p.lastCountedBy}` : ''}</p> : null}
                                    </Panel>
                                )}
                                {p.description ? (
                                    <Panel title="Notes">
                                        <p className="m-0 whitespace-pre-wrap text-[15px]">{p.description}</p>
                                    </Panel>
                                ) : null}
                                <Panel title="Lately" action={<button type="button" className="-my-2 min-h-[44px] px-2 text-[15px] font-medium" style={{ color: C.ok }} onClick={() => setTab('history')}>All of it</button>}>
                                    {recent.length ? recent.map((c: any) => (
                                        <div key={c.id} className="flex items-baseline justify-between gap-4 border-t py-2.5 first:border-t-0" style={{ borderColor: C.line }}>
                                            <span className="min-w-0"><span className="block truncate text-[15px]">{c.displayReason}</span><span className="text-[13px]" style={muted}>{format(safeDate(c.date), 'MMM d, h:mm a')}</span></span>
                                            <span className="shrink-0 tabular-nums text-[15px]" style={{ color: c.change > 0 ? C.ok : C.ink }}>{c.change > 0 ? '+' : ''}{c.change}</span>
                                        </div>
                                    )) : <p className="m-0 text-[15px]" style={muted}>Nothing has moved yet.</p>}
                                </Panel>
                            </div>
                            <div className="flex min-w-0 flex-col gap-5">
                                {ready.length > 0 && (
                                    <Panel title="Ready for the shop" action={<span className="text-[14px] tabular-nums" style={muted}>{readyDone} of {ready.length}</span>}>
                                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                                            {ready.map((r) => (
                                                <li key={r.label}>
                                                    <button type="button" onClick={() => (r.fix && !r.done ? r.fix() : setTab(r.go))} className="flex min-h-[44px] w-full items-center gap-3 text-left text-[15px]">
                                                        <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[12px]" style={r.done ? { background: C.ok, color: C.paper } : { border: `1.5px solid ${C.line}` }}>{r.done ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg> : null}</span>
                                                        <span style={r.done ? muted : undefined}>{r.label}</span>
                                                        <span className="sr-only">{r.done ? 'done' : 'to do'}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </Panel>
                                )}
                                {kindOf === 'retail' && features.online && (
                                    <Panel title="What customers see" action={tenantId && status?.tone === 'ok' ? <a href={`/shop/${tenantId}/product/${listing ? listing.id : p.id}`} target="_blank" rel="noopener noreferrer" className="text-[15px] font-medium" style={{ color: C.ok }}>Open it</a> : undefined}>
                                        <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
                                            <div className="relative aspect-square w-full" style={{ background: C.soft }}>
                                                {photo ? <Image src={photo} alt={p.imageAlt || p.name} fill sizes="360px" className="object-cover" /> : <p className="absolute inset-0 m-0 grid place-items-center text-[14px]" style={muted}>No photo yet</p>}
                                            </div>
                                            <div className="p-4">
                                                <p className="m-0 text-[16px] font-semibold">{listing ? listing.name : p.name}</p>
                                                <p className="m-0 mt-0.5 text-[15px] tabular-nums">{priceCents > 0 ? money(priceCents / 100) : <span style={{ color: C.warn }}>No price yet</span>}</p>
                                                <p className="m-0 mt-1 text-[13px]" style={muted}>{free > 0 ? 'In stock' : 'Sold out'}</p>
                                            </div>
                                        </div>
                                    </Panel>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {tab === 'stock' && (
                    <div className="flex flex-col gap-5">
                        {countable && (
                            <Panel title="Batches" action={!variantIds.length ? <Btn kind="soft" onClick={() => setIsReceiveOpen(true)}>Receive stock</Btn> : undefined}>
                                {productBatches.length ? [...productBatches].sort((a, b) => safeDate(b.receivedDate).getTime() - safeDate(a.receivedDate).getTime()).map((b: any) => (
                                    <div key={b.id} className="flex flex-wrap items-baseline justify-between gap-3 border-t py-3 first:border-t-0" style={{ borderColor: C.line }}>
                                        <div className="min-w-0">
                                            <p className="m-0 text-[15px]">Received {format(safeDate(b.receivedDate), 'MMM d, yyyy')}{b.note ? <span style={muted}> · {b.note}</span> : null}</p>
                                            <p className="m-0 mt-0.5 text-[13px]" style={b.expirationDate && isPast(safeDate(b.expirationDate)) ? { color: C.warn } : muted}>
                                                {[b.lot ? `Lot ${b.lot}` : '', b.expirationDate ? `${isPast(safeDate(b.expirationDate)) ? 'Expired' : 'Expires'} ${format(safeDate(b.expirationDate), 'MMM d, yyyy')}` : ''].filter(Boolean).join(' · ') || 'No lot or expiry'}
                                            </p>
                                            {b.lot ? <LotOrders tenantId={String(tenantId || '')} productId={String(p.id)} lot={String(b.lot)} /> : null}
                                        </div>
                                        <p className="m-0 shrink-0 text-[15px] tabular-nums">{Number(b.stock) || 0} left <span style={muted}>· {money(Number(b.costPerUnit) || 0)} each</span></p>
                                    </div>
                                )) : <p className="m-0 text-[15px]" style={muted}>No batches yet. Receiving stock adds one.</p>}
                            </Panel>
                        )}
                        <Panel title="Where it comes from">
                            <Line k="Supplier" v={p.supplier || 'Not set'} />
                            <Line k="Lead time" v={p.leadTimeDays ? `${p.leadTimeDays} days` : 'Not set'} />
                            <Line k="Smallest order" v={p.moq || 'Not set'} />
                            {p.supplierUrl ? <div className="pt-3"><a href={p.supplierUrl} target="_blank" rel="noopener noreferrer" className={linkBtn} style={{ background: C.soft, color: C.ink }}>Reorder from the supplier</a></div> : null}
                        </Panel>
                        <Panel title="How it’s made" action={isVaultUnlocked ? <span className="text-[13px]" style={muted}>Unlocked</span> : undefined}>
                            {!isVaultUnlocked ? (
                                <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (vaultPin.length >= 4) void handleUnlockVault(); }}>
                                    <div className="flex-1">
                                        <label htmlFor="vault-pin" className="mb-1.5 block text-[13px]" style={muted}>The maker, recipe and label files are for managers. Enter a manager PIN to see them.</label>
                                        <input id="vault-pin" type="password" inputMode="numeric" maxLength={8} value={vaultPin} onChange={(e) => setVaultPin(e.target.value.replace(/\D/g, ''))} className="h-12 w-full max-w-[200px] rounded-xl px-4 text-[18px] tracking-[0.3em] outline-none" style={{ border: `1px solid ${C.line}` }} />
                                    </div>
                                    <Btn kind="primary" type="submit" disabled={vaultPin.length < 4 || isVerifyingVault}>{isVerifyingVault ? 'Checking…' : 'Unlock'}</Btn>
                                </form>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    <Line k="Maker" v={p.manufacturerName || 'Not set'} />
                                    <Line k="Contact" v={p.manufacturerContactName || 'Not set'} />
                                    {p.manufacturerEmail ? <Line k="Email" v={<a href={`mailto:${p.manufacturerEmail}`} style={{ color: C.ok }}>{p.manufacturerEmail}</a>} /> : null}
                                    {p.manufacturerPhone ? <Line k="Phone" v={<a href={`tel:${p.manufacturerPhone}`} style={{ color: C.ok }}>{p.manufacturerPhone}</a>} /> : null}
                                    {p.labelTemplateUrl ? <Line k="Label file" v={<a href={p.labelTemplateUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.ok }}>Open it</a>} /> : null}
                                    {p.labelImageUrl ? (
                                        <div className="mt-3 flex flex-col gap-2">
                                            <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-2xl" style={{ background: C.soft }}><Image src={p.labelImageUrl} alt={`Label for ${p.name}`} fill sizes="448px" className="object-contain p-3" /></div>
                                            <Link href={`/inventory/labels?product=${encodeURIComponent(p.id)}&design=1`} className={`${linkBtn} self-start`} style={{ background: C.soft, color: C.ink }}>Print this label</Link>
                                        </div>
                                    ) : null}
                                    <p className="m-0 mt-3 text-[13px] font-semibold" style={muted}>How it’s made</p>
                                    <p className="m-0 whitespace-pre-wrap text-[15px]">{p.manufacturingSop || <span style={muted}>Nothing written yet.</span>}</p>
                                </div>
                            )}
                        </Panel>
                    </div>
                )}

                {tab === 'online' && kindOf === 'retail' && (
                    <OnlineListingTab product={product} inventory={inventory} onSave={handleOnlineSave} onSaveChoices={handleChoicesSave} />
                )}

                {tab === 'variants' && variantIds.length > 0 && (
                    <section className="overflow-hidden rounded-2xl" style={card}>
                        <div className="hidden grid-cols-[1.4fr_1fr_.8fr_.8fr_.8fr_120px] gap-3 px-5 py-3 text-[13px] font-semibold md:grid" style={{ ...muted, background: C.soft }}>
                            <span>Variant</span><span>On the shelf</span><span>Reorder at</span><span>{features.sell ? 'Price' : ''}</span><span>{features.online ? 'Wholesale' : ''}</span><span />
                        </div>
                        {variants.map((v) => {
                            const vShelf = Number(v.totalStock) || 0; const vHeld = Number(v.stockReserved) || 0; const vAt = Number(v.lowStockThreshold) || Number(v.reorderPoint) || 0;
                            const own = Number(v.msrp) > 0; const vp = priceCentsOf(v, listings); const wp = priceCentsOf(v, listings, 'wholesale');
                            return (
                                <div key={v.id} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 border-t px-5 py-3 text-[15px] md:grid-cols-[1.4fr_1fr_.8fr_.8fr_.8fr_120px]" style={{ borderColor: C.line }}>
                                    <Link href={`/inventory/product/${v.id}`} className="col-span-2 min-w-0 truncate font-medium md:col-span-1">{choiceFor(p, String(v.id))?.choice.label || v.name}</Link>
                                    <span className="tabular-nums" style={vAt && vShelf - vHeld <= vAt ? { color: C.warn } : undefined}>{vShelf}<span className="md:hidden"> on the shelf</span>{vHeld ? <span style={muted}> · {vHeld} held</span> : null}</span>
                                    <span className="tabular-nums" style={muted}><span className="md:hidden">reorder at </span>{vAt || '—'}</span>
                                    <span className="tabular-nums">{!features.sell ? '' : vp > 0 ? money(vp / 100) : '—'}{features.sell && vp > 0 && !own ? <span className="text-[13px]" style={muted}> listing’s</span> : null}</span>
                                    <span className="tabular-nums" style={muted}>{features.online ? <><span className="md:hidden">wholesale </span>{wp > 0 && wp !== vp ? money(wp / 100) : '—'}</> : null}</span>
                                    <span className="col-span-2 flex justify-end md:col-span-1"><Btn kind="soft" onClick={() => setCountTarget(v)}>Count it</Btn></span>
                                </div>
                            );
                        })}
                        <p className="m-0 border-t px-5 py-3 text-[14px]" style={{ ...muted, borderColor: C.line }}>Add or rename variants in Codes and labels. Open one to change its own price or where it’s kept.</p>
                    </section>
                )}

                {tab === 'codes' && countable && <CodesTab product={product} inventory={inventory} tenantId={String(tenantId || '')} />}

                {tab === 'history' && (
                    <div className="flex flex-col gap-4">
                        {stockDrift && (
                            <p className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={stockDrift.drift === 0 ? { background: C.okSoft, color: C.ok } : { background: C.warnSoft, color: C.warn }}>
                                {stockDrift.drift === 0
                                    ? (stockDrift.fromCount && !stockDrift.entries ? `Every unit is accounted for: the shelf matches the last count.` : `Every unit is accounted for: the ${stockDrift.entries} recorded changes${stockDrift.fromCount ? ' since the last count' : ''} add up to the ${stockDrift.actual} on the shelf.`)
                                    : `Off by ${Math.abs(stockDrift.drift)}. The record says ${stockDrift.expected}, the shelf says ${stockDrift.actual}, so something moved without being recorded since ${stockDrift.since ? format(parseISO(stockDrift.since), 'MMM d, yyyy') : 'the first entry'}. A count puts it right.`}
                            </p>
                        )}
                        <input type="search" placeholder="Search by client, team member or reason" aria-label="Search the history" value={ledgerSearchTerm} onChange={(e) => setLedgerSearchTerm(e.target.value)}
                            className="h-12 w-full rounded-xl px-4 text-[16px] outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper }} />
                        <section className="rounded-2xl px-5" style={card}>
                            {filteredLedger.length ? filteredLedger.map((c: any) => (
                                <div key={c.id} className="flex items-baseline justify-between gap-4 border-t py-3 first:border-t-0" style={{ borderColor: C.line }}>
                                    <span className="min-w-0"><span className="block text-[15px]">{c.displayReason}</span><span className="text-[13px]" style={muted}>{format(safeDate(c.date), 'MMM d, yyyy, h:mm a')}</span></span>
                                    <span className="shrink-0 text-right tabular-nums">
                                        <span className="block text-[15px]" style={{ color: c.change > 0 ? C.ok : C.ink }}>{c.change > 0 ? '+' : ''}{c.change} {c.unit}</span>
                                        <span className="block text-[13px]" style={muted}>{c.stockAfter} after{p.costingMethod === 'uses' ? ` + ${c.partialAfter} ${p.useUnit || 'uses'}` : p.costingMethod === 'size' ? ` + ${c.partialAfter} ${p.unit || 'ml'}` : ''}</span>
                                    </span>
                                </div>
                            )) : <p className="m-0 py-6 text-center text-[15px]" style={muted}>{ledgerSearchTerm ? 'Nothing matches that.' : 'Nothing has moved yet.'}</p>}
                        </section>
                    </div>
                )}
            </main>

            {(isCountOpen || countTarget) && tenantId && (
                <CountSheet tenantId={tenantId} product={countTarget || product} onClose={() => { setIsCountOpen(false); setCountTarget(null); }}
                    onCounted={(d) => toast({ title: d === 0 ? 'It matches' : 'Counted', description: d === 0 ? 'The shelf matches the record.' : `${d < 0 ? `${-d} fewer` : `${d} more`} than the record. It’s on the history.` })} />
            )}
            {qr && (
                <Sheet title="Its QR code" sub="Every scanner in the shop reads it as this product." onClose={() => setQr('')} closeLabel="Done">
                    <div className="mt-2 flex flex-col items-center gap-4">
                        <img src={qr} alt={`QR code for ${p.name}`} width={220} height={220} className="rounded-xl" />
                        <Btn kind="primary" className="w-full" onClick={() => window.print()}>Print it</Btn>
                    </div>
                </Sheet>
            )}
            {tenantId && <QuickReceiveDialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen} tenantId={tenantId} inventory={inventory as any} />}
            {product && (
                <EditProductDialog
                    open={isEditDialogOpen}
                    onOpenChange={setIsEditDialogOpen}
                    product={product}
                    onProductUpdated={handleProductUpdate}
                    categories={productCategories}
                    onNewCategory={() => {}}
                    locations={locations}
                    onAddLocationClick={() => {}}
                />
            )}
        </div>
    );
}
