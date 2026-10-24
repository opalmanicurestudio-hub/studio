'use client';

import { SlipSettingsCard } from '@/components/settings/SlipSettingsCard';
import { LABEL_FORMAT_CHOICES, labelFormatOf } from '@/lib/label-format';
import { RetailSecretField } from '@/components/settings/RetailSecretField';
import { doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Camera, Car, DollarSign, Globe, Loader, Lock, MapPin, Plus, Printer, ShieldCheck, Store, Truck, X, Zap,
} from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { Building2, ClipboardList, Package, RotateCcw, Sparkles, Store as StoreIcon, Wallet } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { uploadPrivateFile } from '@/lib/upload-image';
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';

import { listingsOf, variantGroup, variantIdsOf } from '@/lib/variants';
import { sellableStock } from '@/lib/retail-orders';
import { cn } from '@/lib/utils';
import { openPrint } from '@/lib/open-print';
import { VariantSettings } from '@/components/retail/VariantSettings';

// ─── Shop Settings ────────────────────────────────────────────────────────────
// One panel controls the whole retail surface. The storefront, checkout, and
// customer pages all read the SAME retailSettings fields, so what you promise
// here is exactly what checkout charges and the shop displays — configuration
// drift is structurally impossible.
//
// Curbside modes:
//   spots      → numbered/named parking spots; customers tap a spot at
//                check-in (no free-text ambiguity, board shows the spot)
//   drive_thru → a moving lane; customers check in from the car and see
//                their live lane position, board hands off in arrival order
//   freeform   → classic "describe your car" fallback

type CurbsideMode = 'spots' | 'drive_thru' | 'freeform';

interface RetailSettings {
  slip?: Record<string, any>;
  labelPackingSlip?: boolean;
  labelOrderRef?: boolean;
  labelFormat?: 'thermal' | 'paper' | 'zpl';
  shipProcessingHours?: number;
  slaWarnMinutes?: number;
  readyStaleHours?: number;
  autoWaveEnabled?: boolean;
  autoWaveHour?: number;
  autoWaveTotes?: number;
  pdpShowTrust?: boolean;
  pdpShowFaq?: boolean;
  pdpShowRelated?: boolean;
  pdpShowVideo?: boolean;
  pdpShowStickyBar?: boolean;
  pdpFaq?: { q: string; a: string }[];
  pickupEnabled?: boolean;
  shippingEnabled?: boolean;
  prepMinutes?: number;
  tipsEnabled?: boolean;
  scheduledPickup?: boolean;
  throttlePer15?: number;
  shippoApiKey?: string;
  signatureConfirmationEnabled?: boolean;
  signatureOverCents?: number;
  signatureType?: 'STANDARD' | 'ADULT';
  shipmentInsuranceEnabled?: boolean;
  insuranceOverCents?: number;
  weightToleranceOz?: number;
  packPhotoEnabled?: boolean;
  packPhotoOverCents?: number;
  packPhotoOverUnits?: number;
  packPhotoMaxPhotos?: number;
  addressValidationEnabled?: boolean;
  blockUndeliverableAddresses?: boolean;
  returnWindowDays?: number;
  returnsEnabled?: boolean;
  returnLabelPayer?: 'shop' | 'customer' | 'fault';
  claimAutoResolveMaxCents?: number;
  cartRecoveryEnabled?: boolean;
  requirePackScan?: boolean;
  requireScan?: boolean;
  curbsideAlertPhone?: string;
  curbsideLat?: number;
  curbsideLng?: number;
  deliveryIssueWindowDays?: number;
  returnPolicyText?: string;
  shipFrom?: { name?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string; phone?: string };
  storePaused?: boolean;
  storePausedMessage?: string;
  cartHoldMinutes?: number;
  shopLayout?: 'grid' | 'list' | 'showcase';
  shopTagline?: string;
  shopAnnouncement?: string;
  taxRatePercent?: number;
  stripeTaxEnabled?: boolean;
  flatShippingDollars?: number;
  freeShippingOverDollars?: number;
  shippingOffered?: boolean;
  curbsideOffered?: boolean;
  curbsideMode?: CurbsideMode;
  curbsideSpots?: string[];
  wholesaleAccessCode?: string;
  wholesaleTaxExempt?: boolean;
}

export default function RetailSettingsPage() {
  const { firestore, firebaseApp } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const tenant = selectedTenant as any;
  const { inventory } = useInventory();
  const { toast } = useToast();

  const [rs, setRs] = useState<RetailSettings>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>('shop');
  const [newSpot, setNewSpot] = useState('');
  const [itemBusy, setItemBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const uploadMedia = async (it: any, files: FileList | null, kind: 'image' | 'video') => {
    if (!files || files.length === 0 || !firebaseApp || !tenantId) return;
    setUploading(`${kind}-${it.id}`);
    try {
      const storage = getStorage(firebaseApp);
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, kind === 'video' ? 1 : 6)) {
        if (file.size > (kind === 'video' ? 100 : 10) * 1024 * 1024) {
          toast({ variant: 'destructive', title: `${file.name} is too large`, description: kind === 'video' ? 'Videos up to 100 MB.' : 'Images up to 10 MB.' });
          continue;
        }
        const path = `tenants/${tenantId}/products/${it.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
        urls.push(await getDownloadURL(snap.ref));
      }
      if (urls.length > 0) {
        const d = draftFor(it);
        const next = kind === 'image'
          ? { ...d, img: [d.img.trim(), ...urls].filter(Boolean).join('\n') }
          : { ...d, video: urls[0] };
        setDrafts((prev) => ({ ...prev, [it.id]: next }));
        toast({ title: kind === 'image' ? `${urls.length} image(s) uploaded` : 'Video uploaded', description: 'Tap Save on the item to publish.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: String(e?.message || '').includes('storage/unauthorized') ? 'Enable Firebase Storage + the rules from our setup note.' : e?.message });
    } finally {
      setUploading(null);
    }
  };

  const [drafts, setDrafts] = useState<Record<string, {
    wholesale: string; minQty: string; weight: string; desc: string; img: string; video: string;
    howToUse: string; specs: string; docs: string; kit: string; digital: boolean; digitalUrl: string; digitalFilePath: string; digitalFileName: string; digitalAccessDays: string; preorder: boolean; preorderEtaAt: string; preorderClosesAt: string; preorderLimit: string;
    made: boolean; leadMin: string; leadMax: string;
  }>>({});
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) return;
    const existing = (tenant?.retailSettings || {}) as RetailSettings;
    setRs({
      shipProcessingHours: Number(existing.shipProcessingHours) || 24,
      slaWarnMinutes: Number(existing.slaWarnMinutes) || 15,
      readyStaleHours: Number(existing.readyStaleHours) || 24,
      autoWaveEnabled: existing.autoWaveEnabled === true,
      autoWaveHour: Number(existing.autoWaveHour) || 9,
      autoWaveTotes: Number(existing.autoWaveTotes) || 12,
      pdpShowTrust: existing.pdpShowTrust !== false,
      pdpShowFaq: existing.pdpShowFaq !== false,
      pdpShowRelated: existing.pdpShowRelated !== false,
      pdpShowVideo: existing.pdpShowVideo !== false,
      pdpShowStickyBar: existing.pdpShowStickyBar !== false,
      pdpFaq: Array.isArray(existing.pdpFaq) ? existing.pdpFaq : [],
      pickupEnabled: existing.pickupEnabled !== false,
      shippingEnabled: existing.shippingEnabled !== false,
      prepMinutes: Number(existing.prepMinutes) || 0,
      tipsEnabled: existing.tipsEnabled === true,
      scheduledPickup: existing.scheduledPickup === true,
      throttlePer15: Number(existing.throttlePer15) || 0,
      signatureConfirmationEnabled: existing.signatureConfirmationEnabled === true,
      signatureOverCents: Number(existing.signatureOverCents) || 15000,
      signatureType: existing.signatureType === 'ADULT' ? 'ADULT' : 'STANDARD',
      shipmentInsuranceEnabled: existing.shipmentInsuranceEnabled === true,
      insuranceOverCents: Number(existing.insuranceOverCents) || 10000,
      weightToleranceOz: Number(existing.weightToleranceOz) || 4,
      packPhotoEnabled: existing.packPhotoEnabled === true,
      packPhotoOverCents: Number(existing.packPhotoOverCents) || 0,
      packPhotoOverUnits: Number(existing.packPhotoOverUnits) || 0,
      packPhotoMaxPhotos: Number(existing.packPhotoMaxPhotos) || 3,
      addressValidationEnabled: existing.addressValidationEnabled === true,
      blockUndeliverableAddresses: existing.blockUndeliverableAddresses === true,
      cartRecoveryEnabled: existing.cartRecoveryEnabled !== false,
      requirePackScan: existing.requirePackScan === true,
      requireScan: existing.requireScan === true,
      curbsideAlertPhone: existing.curbsideAlertPhone ?? '',
      curbsideLat: existing.curbsideLat ?? undefined,
      curbsideLng: existing.curbsideLng ?? undefined,
      shipFrom: existing.shipFrom || {},
      storePaused: existing.storePaused === true,
      storePausedMessage: existing.storePausedMessage || '',
      cartHoldMinutes: existing.cartHoldMinutes ?? 0,
      shopLayout: existing.shopLayout || 'grid',
      shopTagline: existing.shopTagline || '',
      shopAnnouncement: existing.shopAnnouncement || '',
      taxRatePercent: existing.taxRatePercent ?? 0,
      stripeTaxEnabled: existing.stripeTaxEnabled === true,
      flatShippingDollars: existing.flatShippingDollars ?? 0,
      freeShippingOverDollars: existing.freeShippingOverDollars ?? 0,
      shippingOffered: existing.shippingOffered !== false,
      curbsideOffered: existing.curbsideOffered !== false,
      curbsideMode: existing.curbsideMode || 'freeform',
      curbsideSpots: existing.curbsideSpots || [],
      wholesaleTaxExempt: existing.wholesaleTaxExempt === true,
      // Printing: loaded as saved, so changing one packing-slip option keeps the others (a save writes only what changed).
      ...(existing.slip && typeof existing.slip === 'object' ? { slip: JSON.parse(JSON.stringify(existing.slip)) } : {}),
      ...(existing.labelFormat ? { labelFormat: existing.labelFormat } : {}),
      ...(typeof existing.labelPackingSlip === 'boolean' ? { labelPackingSlip: existing.labelPackingSlip } : {}),
      ...(typeof existing.labelOrderRef === 'boolean' ? { labelOrderRef: existing.labelOrderRef } : {}),
    });
    if (tenant) setLoaded(true);
  }, [tenant, loaded]);

  // A product that comes in variants is one listing here, as in the shop: its variants are sold inside it (lib/variants).
  const listings = useMemo(() => listingsOf(inventory || []), [inventory]);
  const retailItems = useMemo(
    () => (inventory || []).filter((i: any) => i.type === 'retail' && i.status !== 'archived' && !listings.has(String(i.id))),
    [inventory, listings]
  );
  const invById = useMemo(() => new Map((inventory || []).map((i: any) => [String(i.id), i])), [inventory]);
  const liveCount = retailItems.filter((i: any) => i.showOnline === true && (i.msrp ?? 0) > 0).length;

  /*
   * Catalog health: "is my shop presentable?" answered on one screen instead
   * of by scrolling the storefront hoping nothing looks broken. Only live
   * items count — a draft with no photo is fine, a published one is not.
   * Images read from BOTH field families, so a photo added in Inventory
   * counts here exactly as it does online.
   */
  const health = useMemo(() => {
    const live = retailItems.filter((i: any) => i.showOnline === true);
    const hasImage = (i: any) =>
      (Array.isArray(i.imageUrls) && i.imageUrls.some((u: any) => typeof u === 'string' && u.trim()))
      || (typeof i.imageUrl === 'string' && i.imageUrl.trim());
    const hasCopy = (i: any) =>
      String(i.onlineDescription || '').trim().length > 0 || String(i.description || '').trim().length > 0;
    return {
      live,
      noImage: live.filter((i: any) => !hasImage(i)),
      noCopy: live.filter((i: any) => !hasCopy(i)),
      noPrice: live.filter((i: any) => !((i.msrp ?? 0) > 0)),
      noCategory: live.filter((i: any) => !String(i.category || '').trim()),
    };
  }, [retailItems]);

  // Only fields changed on this screen are written, one path each, so edits made elsewhere (Policies, the shop
  // designer, sales tax) are never put back to what this screen loaded.
  const normalise = (rs: RetailSettings): Record<string, any> => JSON.parse(JSON.stringify({
          ...rs,
          taxRatePercent: Number(rs.taxRatePercent) || 0,
          stripeTaxEnabled: rs.stripeTaxEnabled === true,
          flatShippingDollars: Number(rs.flatShippingDollars) || 0,
          freeShippingOverDollars: Number(rs.freeShippingOverDollars) || 0,
          shipProcessingHours: Math.max(1, Math.floor(Number(rs.shipProcessingHours) || 24)),
          slaWarnMinutes: Math.max(1, Math.floor(Number(rs.slaWarnMinutes) || 15)),
          readyStaleHours: Math.max(1, Math.floor(Number(rs.readyStaleHours) || 24)),
          autoWaveEnabled: rs.autoWaveEnabled === true,
          autoWaveHour: Math.min(23, Math.max(0, Math.floor(Number(rs.autoWaveHour) || 9))),
          autoWaveTotes: Math.max(1, Math.floor(Number(rs.autoWaveTotes) || 12)),
          pdpShowTrust: rs.pdpShowTrust !== false,
          pdpShowFaq: rs.pdpShowFaq !== false,
          pdpShowRelated: rs.pdpShowRelated !== false,
          pdpShowVideo: rs.pdpShowVideo !== false,
          pdpShowStickyBar: rs.pdpShowStickyBar !== false,
          pdpFaq: JSON.parse(JSON.stringify((rs.pdpFaq || []).filter((f) => f.q.trim() && f.a.trim()).slice(0, 6))),
          pickupEnabled: rs.pickupEnabled !== false,
          shippingEnabled: rs.shippingEnabled !== false,
          prepMinutes: Math.max(0, Math.floor(Number(rs.prepMinutes) || 0)),
          tipsEnabled: rs.tipsEnabled === true,
          scheduledPickup: rs.scheduledPickup === true,
          throttlePer15: Math.max(0, Math.floor(Number(rs.throttlePer15) || 0)),
          signatureConfirmationEnabled: rs.signatureConfirmationEnabled === true,
          signatureOverCents: Math.max(0, Math.floor(Number(rs.signatureOverCents) || 15000)),
          signatureType: rs.signatureType === 'ADULT' ? 'ADULT' : 'STANDARD',
          shipmentInsuranceEnabled: rs.shipmentInsuranceEnabled === true,
          insuranceOverCents: Math.max(0, Math.floor(Number(rs.insuranceOverCents) || 10000)),
          weightToleranceOz: Math.max(0, Math.floor(Number(rs.weightToleranceOz) || 4)),
          packPhotoEnabled: rs.packPhotoEnabled === true,
          packPhotoOverCents: Math.max(0, Math.floor(Number(rs.packPhotoOverCents) || 0)),
          packPhotoOverUnits: Math.max(0, Math.floor(Number(rs.packPhotoOverUnits) || 0)),
          packPhotoMaxPhotos: Math.min(10, Math.max(1, Math.floor(Number(rs.packPhotoMaxPhotos) || 3))),
          addressValidationEnabled: rs.addressValidationEnabled === true,
          blockUndeliverableAddresses: rs.blockUndeliverableAddresses === true,
          cartRecoveryEnabled: rs.cartRecoveryEnabled !== false,
          requirePackScan: rs.requirePackScan === true,
          requireScan: rs.requireScan === true,
          curbsideAlertPhone: String(rs.curbsideAlertPhone || '').trim() || null,
          curbsideLat: Number.isFinite(Number(rs.curbsideLat)) ? Number(rs.curbsideLat) : null,
          curbsideLng: Number.isFinite(Number(rs.curbsideLng)) ? Number(rs.curbsideLng) : null,
          shipFrom: JSON.parse(JSON.stringify(rs.shipFrom || {})),
          storePaused: rs.storePaused === true,
          storePausedMessage: (rs.storePausedMessage || '').trim(),
          cartHoldMinutes: Math.max(0, Math.floor(Number(rs.cartHoldMinutes) || 0)),
          shopLayout: rs.shopLayout || 'grid',
          shopTagline: (rs.shopTagline || '').trim(),
          shopAnnouncement: (rs.shopAnnouncement || '').trim(),
          curbsideSpots: (rs.curbsideSpots || []).filter(Boolean),
        }));
  const baseline = useRef<Record<string, any> | null>(null);
  useEffect(() => { if (loaded && !baseline.current) baseline.current = normalise(rs); }, [loaded]);

  const saveSettings = async () => {
    if (!firestore || !tenantId || saving) return;
    setSaving(true);
    try {
      const next = normalise(rs);
      const before = baseline.current || {};
      const patch: Record<string, any> = {};
      for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(before[k])) patch[`retailSettings.${k}`] = next[k] === undefined ? null : next[k];
      if (Object.keys(patch).length === 0) { toast({ title: 'Nothing changed' }); return; }
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), patch);
      baseline.current = next;

      toast({ title: 'Shop settings saved', description: 'The storefront and checkout use these immediately.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const draftFor = (it: any) => drafts[it.id] || {
    wholesale: it.wholesalePriceDollars != null ? String(it.wholesalePriceDollars) : '',
    minQty: it.wholesaleMinQty != null ? String(it.wholesaleMinQty) : '',
    weight: it.weightOz != null && it.weightOz > 0 ? String(it.weightOz) : '',
    desc: it.onlineDescription || '',
    img: (it.imageUrls || []).join('\n'),
    howToUse: it.howToUse || '',
    kit: (it.kitContents || []).join('\n'),
    digital: it.digital === true,
    digitalUrl: it.digitalUrl || '',
    preorder: it.preorder === true,
    preorderEtaAt: it.preorderEtaAt || '',
    preorderClosesAt: it.preorderClosesAt || '',
    preorderLimit: it.preorderLimit ? String(it.preorderLimit) : '',
    made: Number(it.leadDays?.max) > 0,
    leadMin: Number(it.leadDays?.min) > 0 ? String(it.leadDays.min) : '',
    leadMax: Number(it.leadDays?.max) > 0 ? String(it.leadDays.max) : '',
    digitalAccessDays: it.digitalAccessDays ? String(it.digitalAccessDays) : '',
    digitalFilePath: it.digitalFilePath || '',
    digitalFileName: it.digitalFileName || '',
    specs: (it.specs || []).map((sp: any) => `${sp.label}: ${sp.value}`).join('\n'),
    docs: (it.documents || []).map((d: any) => `${d.name} | ${d.url}`).join('\n'),
    video: it.videoUrl || '',
  };

  const toggleOnline = async (it: any, on: boolean) => {
    if (!firestore || !tenantId) return;
    if (on && !(it.msrp > 0)) {
      toast({ variant: 'destructive', title: 'Needs a price', description: `Set an MSRP on ${it.name} in Inventory first.` });
      return;
    }
    await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/inventory`, it.id), { showOnline: on });
    toast({ title: on ? `${it.name} is live on the shop` : `${it.name} hidden from the shop` });
  };

  const saveItem = async (it: any) => {
    if (!firestore || !tenantId || itemBusy) return;
    const d = draftFor(it);
    setItemBusy(it.id);
    try {
      const imageUrls = d.img.split(/\n+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
      const specs = d.specs.split(/\n+/).map((line) => {
        const idx = line.indexOf(':');
        if (idx <= 0) return null;
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        return label && value ? { label, value } : null;
      }).filter(Boolean).slice(0, 40);
      const documents = d.docs.split(/\n+/).map((line) => {
        const idx = line.indexOf('|');
        if (idx <= 0) return null;
        const name = line.slice(0, idx).trim();
        const url = line.slice(idx + 1).trim();
        return name && /^https?:\/\//i.test(url) ? { name, url } : null;
      }).filter(Boolean).slice(0, 20);
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/inventory`, it.id), {
        wholesalePriceDollars: Number(d.wholesale) > 0 ? Number(d.wholesale) : null,
        weightOz: Math.max(0, Number(d.weight) || 0),
        wholesaleMinQty: d.minQty.trim() === '' ? null : Math.max(0, Math.floor(Number(d.minQty) || 0)),
        onlineDescription: d.desc.trim(),
        howToUse: d.howToUse.trim(),
        kitContents: d.kit.split('\n').map((p: string) => p.trim()).filter(Boolean).slice(0, 40),
        digital: d.digital === true,
        digitalUrl: d.digital === true ? (d.digitalUrl.trim() || null) : null,
        preorder: d.preorder === true,
        preorderEtaAt: d.preorder === true ? (d.preorderEtaAt || null) : null,
        preorderClosesAt: d.preorder === true ? (d.preorderClosesAt || null) : null,
        preorderLimit: d.preorder === true ? (Math.max(0, Math.floor(Number(d.preorderLimit) || 0)) || null) : null,
        // Made to order: the longest time is what the ship-by date counts; the shortest is only shown.
        leadDays: (() => {
          if (d.made !== true) return null;
          const max = Math.min(120, Math.max(0, Math.floor(Number(d.leadMax) || Number(d.leadMin) || 0)));
          if (max <= 0) return null;
          const min = Math.min(max, Math.max(1, Math.floor(Number(d.leadMin) || max)));
          return { min, max };
        })(),
        digitalAccessDays: d.digital === true ? (Math.max(0, Math.floor(Number(d.digitalAccessDays) || 0)) || null) : null,
        digitalFilePath: d.digital === true ? (d.digitalFilePath || null) : null,
        digitalFileName: d.digital === true ? (d.digitalFileName || null) : null,
        imageUrls,
        specs: JSON.parse(JSON.stringify(specs)),
        documents: JSON.parse(JSON.stringify(documents)),
        videoUrl: (d.video || '').trim(),
      });
      toast({ title: `${it.name} updated` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: e?.message });
    } finally {
      setItemBusy(null);
    }
  };

  const num = (v: number | undefined) => (v == null || Number.isNaN(v) ? '' : String(v));

  if (!loaded) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/5 pb-28">
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur border-b-2">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Shop Settings</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {liveCount} product{liveCount === 1 ? '' : 's'} live · /shop/{tenantId}
            </p>
          </div>
          <Button onClick={saveSettings} disabled={saving}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20">
            {saving ? <Loader className="h-4 w-4 animate-spin" /> : 'Save settings'}
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'shop' ? null : 'shop')}
            aria-expanded={openGroup === 'shop'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'shop' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'shop' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <StoreIcon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">Your shop</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                {rs.storePaused ? 'Paused' : 'Open'} · {[rs.pickupEnabled !== false && 'pickup', rs.shippingEnabled !== false && 'delivery'].filter(Boolean).join(' + ') || 'no collection method'}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'shop' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'shop' && (
            <div className="space-y-5">
        <Card className={cn('border-2 rounded-[2rem] overflow-hidden bg-card', rs.storePaused && 'border-amber-300')}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">Store status</p>
                <p className={cn('font-black uppercase tracking-tighter text-lg leading-none mt-1', rs.storePaused ? 'text-amber-600' : 'text-green-600')}>
                  {rs.storePaused ? 'Paused' : 'Open'}
                </p>
              </div>
              <Switch aria-label="Store status" checked={rs.storePaused !== true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, storePaused: !v })} />
            </div>
            {rs.storePaused && (
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Message visitors see while paused</Label>
                <Textarea aria-label="Message visitors see while paused" placeholder="We are restocking the shelves — back within the hour!"
                  value={rs.storePausedMessage || ''}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRs({ ...rs, storePausedMessage: e.target.value })}
                  className="rounded-2xl border-2 min-h-[70px] font-bold text-sm" />
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  Browsing and checkout stop; existing orders and tracking pages stay live.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 pt-1 border-t-2 border-dashed">
              <div className="space-y-1.5 pt-3">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Cart hold (minutes, 0 = off)</Label>
                <Input aria-label="Cart hold (minutes, 0 = off)" inputMode="numeric" value={rs.cartHoldMinutes == null ? '' : String(rs.cartHoldMinutes)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, cartHoldMinutes: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 pt-3 self-center">
                Shows a live countdown in the cart and releases idle carts — honest urgency for drops and high volume.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest">Storefront</p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest">
                  <Link href="/retail-orders/designer">Design landing</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                  <a href={`/shop/${tenantId}`} target="_blank" rel="noreferrer">View shop</a>
                </Button>
                <Button variant="outline" size="sm" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/shop/${tenantId}`)
                      .then(() => toast({ title: 'Shop link copied' }))
                      .catch(() => toast({ variant: 'destructive', title: 'Could not copy' }));
                  }}>
                  Copy link
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Shopping layout</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'grid' as const, label: 'Grid', hint: 'Classic cards' },
                  { id: 'list' as const, label: 'List', hint: 'Dense rows' },
                  { id: 'showcase' as const, label: 'Showcase', hint: 'Big & bold' },
                ]).map((m) => (
                  <button key={m.id} type="button" onClick={() => setRs({ ...rs, shopLayout: m.id })}
                    className={cn('rounded-2xl border-2 p-3 space-y-2 transition-all text-left',
                      (rs.shopLayout || 'grid') === m.id ? 'border-primary bg-primary/5' : 'hover:border-primary/30')}>
                    <div className={cn('h-10 rounded-lg overflow-hidden flex gap-1 p-1',
                      (rs.shopLayout || 'grid') === m.id ? 'bg-primary/10' : 'bg-muted/20')}>
                      {m.id === 'grid' && (<><div className="flex-1 rounded bg-foreground/15" /><div className="flex-1 rounded bg-foreground/15" /><div className="flex-1 rounded bg-foreground/15" /></>)}
                      {m.id === 'list' && (<div className="flex-1 flex flex-col gap-1"><div className="flex-1 rounded bg-foreground/15" /><div className="flex-1 rounded bg-foreground/15" /><div className="flex-1 rounded bg-foreground/15" /></div>)}
                      {m.id === 'showcase' && (<div className="flex-1 rounded bg-foreground/20" />)}
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest">{m.label}</p>
                      <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">{m.hint}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Tagline under your name</Label>
                <Input aria-label="Tagline under your name" placeholder="Shop" value={rs.shopTagline || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shopTagline: e.target.value })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Announcement bar (optional)</Label>
                <Input aria-label="Announcement bar (optional)" placeholder="e.g. Free pickup orders ready in 2 hours" value={rs.shopAnnouncement || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shopAnnouncement: e.target.value })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Pickup experience</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-black uppercase tracking-widest">Offer curbside</Label>
              <Switch aria-label="Offer curbside" checked={rs.curbsideOffered !== false}
                onCheckedChange={(v: boolean) => setRs({ ...rs, curbsideOffered: v })} />
            </div>
            {rs.curbsideOffered !== false && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'freeform' as CurbsideMode, label: 'Describe car' },
                    { id: 'spots' as CurbsideMode, label: 'Parking spots' },
                    { id: 'drive_thru' as CurbsideMode, label: 'Drive-thru lane' },
                  ]).map((m) => (
                    <button key={m.id} type="button" onClick={() => setRs({ ...rs, curbsideMode: m.id })}
                      className={cn('rounded-2xl border-2 p-3 text-[9px] font-black uppercase tracking-widest transition-all',
                        rs.curbsideMode === m.id ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary/30')}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {rs.curbsideMode === 'spots' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {(rs.curbsideSpots || []).map((s, i) => (
                        <Badge key={`${s}-${i}`} variant="outline" className="h-8 pl-3 pr-1 rounded-xl border-2 font-black text-[10px] uppercase tracking-widest gap-1">
                          {s}
                          <button type="button" className="p-1"
                            onClick={() => setRs({ ...rs, curbsideSpots: (rs.curbsideSpots || []).filter((_, idx) => idx !== i) })}>
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input aria-label="Spot name (e.g. Spot 1)" placeholder="Spot name (e.g. Spot 1)" value={newSpot}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewSpot(e.target.value)}
                        className="h-11 rounded-xl border-2 font-bold text-sm" />
                      <Button variant="outline" disabled={!newSpot.trim()}
                        onClick={() => { setRs({ ...rs, curbsideSpots: [...(rs.curbsideSpots || []), newSpot.trim()] }); setNewSpot(''); }}
                        className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest px-4">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                      Customers tap their spot at check-in — the board shows exactly where to walk.
                    </p>
                  </div>
                )}
                {rs.curbsideMode === 'drive_thru' && (
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Customers check in from the lane and see their live position; the board hands off in arrival order.
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t-2 border-dashed">
              <Label className="text-xs font-black uppercase tracking-widest flex items-center gap-2 pt-3">
                <Truck className="w-3.5 h-3.5" /> Offer shipping
              </Label>
              <Switch aria-label="Offer shipping" checked={rs.shippingOffered !== false}
                onCheckedChange={(v: boolean) => setRs({ ...rs, shippingOffered: v })} />
            </div>
          </CardContent>
        </Card>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'money' ? null : 'money')}
            aria-expanded={openGroup === 'money'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'money' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'money' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <Wallet className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">Money</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                {rs.stripeTaxEnabled === true ? 'Tax by location' : `Tax ${Number(rs.taxRatePercent) || 0}%`} · {rs.tipsEnabled === false ? 'no tips' : 'tips on'}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'money' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'money' && (
            <div className="space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Money</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Tax %</Label>
                <Input aria-label="Tax %" inputMode="decimal" value={num(rs.taxRatePercent)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, taxRatePercent: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Flat ship $</Label>
                <Input aria-label="Flat ship $" inputMode="decimal" value={num(rs.flatShippingDollars)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, flatShippingDollars: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Free over $</Label>
                <Input aria-label="Free over $" inputMode="decimal" value={num(rs.freeShippingOverDollars)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, freeShippingOverDollars: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-3">
              <div className="min-w-0">
                <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                  Automatic sales tax on shipped orders
                </Label>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {rs.stripeTaxEnabled === true
                    ? 'Stripe Tax sets the rate from the delivery state on shipped orders. Pickup orders keep the flat rate above. Requires Stripe Tax activated, your registrations added, and an origin address in your Stripe dashboard — if that setup is missing, checkout quietly falls back to the flat rate so a customer is never blocked.'
                    : 'Off — every order uses the flat Tax % above. Right for pickup-only shops; a parcel crossing state lines should be taxed at its destination, which is what turning this on does.'}
                </p>
              </div>
              <Switch aria-label="Automatic sales tax on shipped orders" checked={rs.stripeTaxEnabled === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, stripeTaxEnabled: v })} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Shipping labels (Shippo)</p>
            </div>
            <RetailSecretField tenantId={tenantId} which="shippoApiKey" label="Shippo API key (blank keeps manual tracking entry)" placeholder="shippo_live_…" className="h-11 rounded-xl border-2 font-mono font-bold text-xs" />
            <fieldset className="space-y-2">
              <legend className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">What labels print on</legend>
              {LABEL_FORMAT_CHOICES.map((c) => {
                const on = labelFormatOf(rs) === c.id;
                return (
                  <label key={c.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3', on ? 'border-primary' : '')}>
                    <input type="radio" name="label-format" className="mt-1" checked={on} onChange={() => setRs({ ...rs, labelFormat: c.id })} />
                    <span className="min-w-0"><span className="block text-sm font-bold">{c.label}</span><span className="block text-[11px] text-muted-foreground">{c.sub}</span></span>
                  </label>);
              })}
            </fieldset>
            <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-3">
              <div className="min-w-0"><Label className="text-[10px] font-black uppercase tracking-widest">Packing slip after each label</Label><p className="text-[11px] text-muted-foreground mt-1">The label stack prints each order’s slip right behind its label, with the tote number, so they stay together.</p></div>
              <Switch aria-label="Packing slip after each label" checked={rs.labelPackingSlip === true} onCheckedChange={(v: boolean) => setRs({ ...rs, labelPackingSlip: v })} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-3">
              <div className="min-w-0"><Label className="text-[10px] font-black uppercase tracking-widest">Order number on the label</Label><p className="text-[11px] text-muted-foreground mt-1">Printed in the label’s reference line where the carrier supports it (USPS, UPS, FedEx).</p></div>
              <Switch aria-label="Order number on the label" checked={rs.labelOrderRef !== false} onCheckedChange={(v: boolean) => setRs({ ...rs, labelOrderRef: v })} />
            </div>
            <div className="rounded-xl border-2 p-3">
              <SlipSettingsCard rs={rs} setRs={setRs} />
            </div>
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Ship-from address (printed on labels, used for rates)</Label>
              <Input aria-label="Ship-from address (printed on labels, used for rates)" placeholder="Sender name (defaults to shop name)" value={rs.shipFrom?.name || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, name: e.target.value } })}
                className="h-11 rounded-xl border-2 font-bold text-sm" />
              <Input aria-label="Street address" placeholder="Street address" value={rs.shipFrom?.street1 || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, street1: e.target.value } })}
                className="h-11 rounded-xl border-2 font-bold text-sm" />
              <div className="grid grid-cols-3 gap-2">
                <Input aria-label="City" placeholder="City" value={rs.shipFrom?.city || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, city: e.target.value } })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
                <Input aria-label="State" placeholder="State" value={rs.shipFrom?.state || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, state: e.target.value } })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
                <Input aria-label="ZIP" placeholder="ZIP" value={rs.shipFrom?.zip || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, zip: e.target.value } })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
              </div>
              <Input aria-label="Phone (carriers may require it)" placeholder="Phone (carriers may require it)" value={rs.shipFrom?.phone || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, phone: e.target.value } })}
                className="h-11 rounded-xl border-2 font-bold text-sm" />
            </div>
          </CardContent>
        </Card>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'orders' ? null : 'orders')}
            aria-expanded={openGroup === 'orders'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'orders' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'orders' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <ClipboardList className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">Getting orders out</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                {rs.requirePackScan === true ? 'Two scans per order' : 'One scan per order'}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'orders' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'orders' && (
            <div className="space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[11px] font-black uppercase tracking-widest">How fast you promise to be ready</p>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              These set the clock every order is measured against, and when the morning wave builds itself.
            </p>

            <Link href="/retail-orders/policies/shipping" className="flex items-center justify-between gap-3 rounded-2xl border-2 p-3 hover:bg-muted">
              <span className="min-w-0">
                <span className="block text-xs font-black uppercase tracking-tight">Shipping schedule</span>
                <span className="block text-[11px] font-bold text-muted-foreground">How many days to ship, the daily cutoff, carrier pickups and holidays. Shipped orders are due by it.</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" aria-hidden="true" />
            </Link>
            <div className="grid grid-cols-2 gap-3">
              {([
                ['prepMinutes', 'Pickup ready in (min)'],
                ['slaWarnMinutes', 'Warn me (min before due)'],
                ['readyStaleHours', 'Chase uncollected after (h)'],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
                  <Input
                    aria-label={label}
                    inputMode="numeric"
                    value={String((rs as any)[key] ?? '')}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, [key]: Number(e.target.value) || 0 })}
                    className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                  />
                </div>
              ))}
            </div>

            <div className="rounded-2xl border-2 border-dashed p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tight">Build the morning wave for me</p>
                  <p className="text-[11px] font-bold text-muted-foreground">
                    Waiting when you open the wave page — never before your set hour, never twice a day.
                  </p>
                </div>
                <Switch aria-label="Build the morning wave for me"
                  checked={rs.autoWaveEnabled === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, autoWaveEnabled: v })}
                />
              </div>
              {rs.autoWaveEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Start at (24-hour clock)</Label>
                    <Input aria-label="Start hour on a 24-hour clock"
                      inputMode="numeric" value={String(rs.autoWaveHour ?? 9)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, autoWaveHour: Number(e.target.value) || 0 })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Bins or baskets available</Label>
                    <Input aria-label="How many bins or baskets are available"
                      inputMode="numeric" value={String(rs.autoWaveTotes ?? 12)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, autoWaveTotes: Number(e.target.value) || 1 })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-black uppercase tracking-tight">Proof for expensive parcels</p>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              Both cost money per label, so both start off. They defend against different things,
              which is why the cutoffs are separate: signature answers &ldquo;I never got it&rdquo;,
              insurance answers &ldquo;it arrived smashed&rdquo;. Only orders at or above a cutoff pay for it.
            </p>

            <div className="rounded-2xl border-2 border-dashed p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tight">Require a signature on valuable orders</p>
                  <p className="text-[11px] font-bold text-muted-foreground">
                    A delivery scan proves a parcel reached an address. A signature proves it reached a
                    person &mdash; which is what wins a &ldquo;never arrived&rdquo; dispute.
                  </p>
                </div>
                <Switch aria-label="Require a signature on valuable orders"
                  checked={rs.signatureConfirmationEnabled === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, signatureConfirmationEnabled: v })}
                />
              </div>
              {rs.signatureConfirmationEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Orders over ($)</Label>
                    <Input aria-label="Orders over ($)"
                      inputMode="decimal"
                      value={String((Number(rs.signatureOverCents) || 0) / 100)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRs({ ...rs, signatureOverCents: Math.round((Number(e.target.value) || 0) * 100) })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Who can sign</Label>
                    <div className="flex gap-2">
                      {(['STANDARD', 'ADULT'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setRs({ ...rs, signatureType: v })}
                          className={cn(
                            'h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest',
                            rs.signatureType === v
                              ? 'bg-foreground text-background border-foreground'
                              : 'bg-card hover:border-primary/40'
                          )}
                        >
                          {v === 'ADULT' ? 'Adult 21+' : 'Anyone'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border-2 border-dashed p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tight">Insure valuable orders</p>
                  <p className="text-[11px] font-bold text-muted-foreground">
                    Makes damage in transit the carrier&rsquo;s loss instead of yours. Insured for the
                    merchandise total &mdash; never shipping or tip, and never a line you already refunded.
                  </p>
                </div>
                <Switch aria-label="Insure valuable orders"
                  checked={rs.shipmentInsuranceEnabled === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, shipmentInsuranceEnabled: v })}
                />
              </div>
              {rs.shipmentInsuranceEnabled && (
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Orders over ($)</Label>
                  <Input aria-label="Orders over ($)"
                    inputMode="decimal"
                    value={String((Number(rs.insuranceOverCents) || 0) / 100)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setRs({ ...rs, insuranceOverCents: Math.round((Number(e.target.value) || 0) * 100) })}
                    className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Weight tolerance (oz)
              </Label>
              <Input
                aria-label="Weight tolerance in ounces"
                inputMode="numeric"
                value={String(rs.weightToleranceOz ?? 4)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRs({ ...rs, weightToleranceOz: Number(e.target.value) || 0 })}
                className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
              />
              <p className="text-[11px] font-bold text-muted-foreground">
                Carriers weigh every parcel and report it back. We compare that to what the order should
                weigh and flag anything lighter than expected by more than this &mdash; the evidence that
                answers &ldquo;items were missing from my box&rdquo;. Set it too tight and ordinary scale
                variance starts looking like a problem.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-black uppercase tracking-tight">Photograph the packed box</p>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              One shot of the open box at the bench, before it is sealed. It ends a
              &ldquo;something was missing&rdquo; claim faster than any argument, and takes about four
              seconds. Off until you switch it on &mdash; nobody should start storing photographs of
              customers&rsquo; orders without deciding to.
            </p>

            <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed p-3">
              <p className="text-xs font-black uppercase tracking-tight">Ask packers for a photo</p>
              <Switch aria-label="Ask packers for a photo"
                checked={rs.packPhotoEnabled === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, packPhotoEnabled: v })}
              />
            </div>

            {rs.packPhotoEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Required over ($)</Label>
                    <Input aria-label="Required over ($)"
                      inputMode="decimal"
                      value={String((Number(rs.packPhotoOverCents) || 0) / 100)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRs({ ...rs, packPhotoOverCents: Math.round((Number(e.target.value) || 0) * 100) })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Or items over</Label>
                    <Input aria-label="Or items over"
                      inputMode="numeric"
                      value={String(rs.packPhotoOverUnits ?? 0)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRs({ ...rs, packPhotoOverUnits: Number(e.target.value) || 0 })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                </div>
                <p className="text-[11px] font-bold text-muted-foreground">
                  {(Number(rs.packPhotoOverCents) || 0) === 0 && (Number(rs.packPhotoOverUnits) || 0) === 0
                    ? 'Both at zero means every parcel gets photographed.'
                    : 'Either one triggers it on its own. Value catches the expensive single item; item count catches the crowded box, where a missing piece is easiest to miss and hardest to disprove.'}
                </p>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Photos per order (max 10)</Label>
                  <Input aria-label="Photos per order (max 10)"
                    inputMode="numeric"
                    value={String(rs.packPhotoMaxPhotos ?? 3)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setRs({ ...rs, packPhotoMaxPhotos: Number(e.target.value) || 1 })}
                    className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'after' ? null : 'after')}
            aria-expanded={openGroup === 'after'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'after' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'after' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <RotateCcw className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">After the sale</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                Addresses, packing checks, curbside and policies
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'after' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'after' && (
            <div className="space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-black uppercase tracking-tight">After the sale</p>
            </div>

            <Link href="/retail-orders/policies" className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-xs font-black uppercase tracking-tight">Addresses</span>
                <span className="block text-[11px] font-bold text-muted-foreground">Checking addresses with the carrier{rs.addressValidationEnabled ? ' (on)' : ' (off)'}, and how long customers can change theirs, are in Policies.</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" aria-hidden="true" />
            </Link>

            <Link href="/retail-orders/policies" className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-xs font-black uppercase tracking-tight">Returns, refunds and fees</span>
                <span className="block text-[11px] font-bold text-muted-foreground">Return window, who pays return shipping, restocking fees and claim limits are all in Policies.</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" aria-hidden="true" />
            </Link>

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-widest">Cart recovery email</Label>
                <p className="text-[11px] font-bold text-muted-foreground">
                  One email when a checkout times out unpaid &mdash; their cart link, nothing else, never twice.
                </p>
              </div>
              <Switch aria-label="Cart recovery email"
                checked={rs.cartRecoveryEnabled !== false}
                onCheckedChange={(v: boolean) => setRs({ ...rs, cartRecoveryEnabled: v })}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-widest">Second scan at packing</Label>
                <p className="text-[11px] font-bold text-muted-foreground">
                  Every item is scanned into the box, never just tapped. An order picked at the shelf first is scanned again as it’s packed; wave orders, and orders scanned straight into the box, are scanned once.
                </p>
              </div>
              <Switch aria-label="Second scan at packing"
                checked={rs.requirePackScan === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, requirePackScan: v })}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-widest">Scan every item</Label>
                <p className="text-[11px] font-bold text-muted-foreground">
                  Packers scan each item into the box instead of tapping it on the screen. Leave it off if some items have no barcode.
                </p>
              </div>
              <Switch aria-label="Scan every item"
                checked={rs.requireScan === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, requireScan: v })}
              />
            </div>

            <div className="space-y-2 rounded-2xl border-2 p-4">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-widest">Curbside pickup spots</Label>
                <p className="text-[11px] font-bold text-muted-foreground">
                  Print numbered signs for your bays. Customers scan the sign and we know exactly where they parked &mdash; nothing to type, nothing to mistype.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline"
                  onClick={() => window.open(`/print/curbside-signs/${tenantId}?count=6`, '_blank')}
                  className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                  Print 6 signs
                </Button>
                <Button type="button" variant="outline"
                  onClick={() => {
                    const list = window.prompt('Which spots? Comma separated (e.g. 1,2,3 or A,B,Loading bay):', '1,2,3,4');
                    if (list && list.trim()) window.open(`/print/curbside-signs/${tenantId}?spots=${encodeURIComponent(list.trim())}`, '_blank');
                  }}
                  className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                  Choose spots
                </Button>
              </div>
              <Input placeholder="Alert phone — texted when someone waits too long" inputMode="tel" aria-label="Phone to alert when a customer or guest waits too long"
                value={rs.curbsideAlertPhone ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, curbsideAlertPhone: e.target.value })}
                className="h-11 rounded-xl border-2 font-bold text-xs" />
              <p className="text-[10px] font-bold text-muted-foreground">
                If a customer waits 5 minutes outside, or a lounge guest waits 6, this number gets a text — because a board nobody is watching is a person nobody is helping. Leave blank to turn it off.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Shop latitude" inputMode="decimal" aria-label="Shop latitude"
                  value={rs.curbsideLat ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, curbsideLat: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-bold text-xs" />
                <Input placeholder="Shop longitude" inputMode="decimal" aria-label="Shop longitude"
                  value={rs.curbsideLng ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, curbsideLng: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-bold text-xs" />
              </div>
              <p className="text-[10px] font-bold text-muted-foreground">
                Optional. With coordinates set, a customer who taps &ldquo;on my way&rdquo; gets a rough ETA and can be checked in automatically when they pull in &mdash; only while their order page is open. Find them by right-clicking your shop in Google Maps. The signs work with or without this.
              </p>
            </div>

          </CardContent>
        </Card>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'trade' ? null : 'trade')}
            aria-expanded={openGroup === 'trade'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'trade' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'trade' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">Trade &amp; wholesale</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                {(rs as any).wholesaleCodeSet || rs.wholesaleAccessCode ? 'Access code set' : 'No access code yet'}{rs.wholesaleTaxExempt === true ? ' · tax-exempt' : ''}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'trade' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'trade' && (
            <div className="space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Wholesale pricing</p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
              <Link href="/retail-orders/wholesale">Manage per-business accounts</Link>
            </Button>
            <RetailSecretField tenantId={tenantId} which="wholesaleAccessCode" label="House code (shared fallback; per-account codes live in Wholesale)" placeholder="e.g. OPALPRO2026" className="h-11 rounded-xl border-2 font-black uppercase tracking-widest text-sm" />
            <div className="flex items-center justify-between">
              <Label className="text-xs font-black uppercase tracking-widest">Wholesale orders tax-exempt</Label>
              <Switch aria-label="Wholesale orders tax-exempt" checked={rs.wholesaleTaxExempt === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, wholesaleTaxExempt: v })} />
            </div>
          </CardContent>
        </Card>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'extras' ? null : 'extras')}
            aria-expanded={openGroup === 'extras'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'extras' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'extras' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">Extras</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                Prep {Number(rs.prepMinutes) || 0} min · {Number(rs.throttlePer15) || 0} orders per 15 min
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'extras' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'extras' && (
            <div className="space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Order-ahead extras</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Prep promise (min, 0 = off)</Label>
                <Input aria-label="Prep promise (min, 0 = off)" inputMode="numeric" value={String(rs.prepMinutes ?? 0)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, prepMinutes: Number(e.target.value) || 0 })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm text-center" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Max orders / 15 min (0 = off)</Label>
                <Input aria-label="Max orders / 15 min (0 = off)" inputMode="numeric" value={String(rs.throttlePer15 ?? 0)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, throttlePer15: Number(e.target.value) || 0 })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm text-center" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-tight">Tips at checkout</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">10 / 15 / 20% chips on the payment sheet</p>
              </div>
              <Switch aria-label="Max orders / 15 min (0 = off)" checked={rs.tipsEnabled === true} onCheckedChange={(v: boolean) => setRs({ ...rs, tipsEnabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-tight">Scheduled pickup</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">ASAP / +15 / +30 / +45 / +60 picker</p>
              </div>
              <Switch aria-label="ASAP / +15 / +30 / +45 / +60 picker" checked={rs.scheduledPickup === true} onCheckedChange={(v: boolean) => setRs({ ...rs, scheduledPickup: v })} />
            </div>
          </CardContent>
        </Card>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'products' ? null : 'products')}
            aria-expanded={openGroup === 'products'}
            className={cn('flex w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-4 text-left transition-colors',
              openGroup === 'products' ? 'border-primary/40' : 'hover:border-primary/20')}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors',
              openGroup === 'products' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/20 bg-primary/5 text-primary')}>
              <Package className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black uppercase tracking-tighter text-base leading-tight">Your products</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                {retailItems.length} product{retailItems.length === 1 ? '' : 's'} · {liveCount} live
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openGroup === 'products' && 'rotate-180 text-primary')} aria-hidden="true" />
          </button>
          {openGroup === 'products' && (
            <div className="space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest">How your shop looks</p>
              <p className="text-[11px] font-bold text-muted-foreground">
                Colours, layout and type live in the Designer, where you can watch them change as you tap. The switches below control what appears on a product page.
              </p>
            </div>
            <Button asChild variant="outline" className="h-11 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
              <Link href="/retail-orders/designer">Open the Designer</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[11px] font-black uppercase tracking-widest">What shows on a product page</p>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              Turn blocks off for shops that don&rsquo;t need them. Everything is on by default.
            </p>

            {([
              ['pdpShowTrust', 'Trust badges', 'Pickup/returns/secure row under the buy button'],
              ['pdpShowVideo', 'Product video', 'Plays the video uploaded on the item'],
              ['pdpShowRelated', 'You may also like', 'Row of other products'],
              ['pdpShowFaq', 'Good to know', 'Collapsible questions'],
              ['pdpShowStickyBar', 'Sticky buy bar', 'Follows the shopper down the page'],
            ] as const).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p id={`toggle-${key}-label`} className="text-xs font-black uppercase tracking-tight">{label}</p>
                  <p className="text-[11px] font-bold text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  aria-labelledby={`toggle-${key}-label`}
                  checked={(rs as any)[key] !== false}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, [key]: v })}
                />
              </div>
            ))}

            <div className="rounded-2xl border-2 border-dashed p-3 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                What this shop offers
              </p>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-tight">Local pickup</p>
                <Switch aria-label="Local pickup" checked={rs.pickupEnabled !== false}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, pickupEnabled: v })} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-tight">Shipping</p>
                <Switch aria-label="Shipping" checked={rs.shippingEnabled !== false}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, shippingEnabled: v })} />
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                Turning pickup off swaps the pickup badge and answers for shipping ones — no more advertising
                a counter you don&rsquo;t have.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Your own questions (optional — replaces the defaults)
              </p>
              {(rs.pdpFaq || []).map((f, i) => (
                <div key={i} className="rounded-2xl border-2 p-3 space-y-2">
                  <Input aria-label="Question"
                    placeholder="Question"
                    value={f.q}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const next = [...(rs.pdpFaq || [])];
                      next[i] = { ...next[i], q: e.target.value };
                      setRs({ ...rs, pdpFaq: next });
                    }}
                    className="h-10 rounded-xl border-2 font-bold text-xs"
                  />
                  <Textarea aria-label="Answer"
                    placeholder="Answer"
                    value={f.a}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                      const next = [...(rs.pdpFaq || [])];
                      next[i] = { ...next[i], a: e.target.value };
                      setRs({ ...rs, pdpFaq: next });
                    }}
                    className="min-h-[54px] rounded-xl border-2 font-bold text-xs"
                  />
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setRs({ ...rs, pdpFaq: (rs.pdpFaq || []).filter((_, j) => j !== i) })}
                    className="h-8 rounded-lg text-destructive text-[11px] font-black uppercase tracking-widest"
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {(rs.pdpFaq || []).length < 6 && (
                <Button
                  variant="outline"
                  onClick={() => setRs({ ...rs, pdpFaq: [...(rs.pdpFaq || []), { q: '', a: '' }] })}
                  className="h-10 w-full rounded-xl border-2 text-[11px] font-black uppercase tracking-widest"
                >
                  Add a question
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[11px] font-black uppercase tracking-widest">Catalog check &amp; printing</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { n: health.live.length, label: 'live online', tone: 'ok' },
                { n: health.noImage.length, label: 'missing photo', tone: 'warn' },
                { n: health.noCopy.length, label: 'missing description', tone: 'warn' },
                { n: health.noPrice.length, label: 'missing price', tone: 'bad' },
              ].map((s2) => (
                <div
                  key={s2.label}
                  className={cn(
                    'rounded-2xl border-2 p-3',
                    s2.tone === 'ok' && 'bg-muted/20',
                    s2.tone === 'warn' && s2.n > 0 && 'border-amber-200 bg-amber-50',
                    s2.tone === 'bad' && s2.n > 0 && 'border-destructive/30 bg-destructive/5'
                  )}
                >
                  <p className="font-mono text-xl font-bold leading-none">{s2.n}</p>
                  <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{s2.label}</p>
                </div>
              ))}
            </div>

            {(health.noImage.length > 0 || health.noCopy.length > 0 || health.noPrice.length > 0) && (
              <div className="rounded-2xl border-2 border-dashed p-3 space-y-1.5">
                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Needs attention</p>
                {[...new Set([...health.noPrice, ...health.noImage, ...health.noCopy])].slice(0, 8).map((i: any) => (
                  <p key={i.id} className="text-xs font-bold">
                    {i.name}
                    <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                      {[
                        !((i.msrp ?? 0) > 0) ? 'price' : '',
                        !(Array.isArray(i.imageUrls) && i.imageUrls.length) && !i.imageUrl ? 'photo' : '',
                        !String(i.onlineDescription || i.description || '').trim() ? 'description' : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => window.open(`/print/catalog/${tenantId}`, '_blank')}
                className="h-11 rounded-xl border-2 font-black uppercase text-[11px] tracking-widest"
              >
                Print catalog
              </Button>
              <Button
                variant="outline"
                onClick={async () => { const e = await openPrint(String(tenantId || ''), 'catalog', `/print/catalog/${tenantId}?tier=wholesale`); if (e) toast({ variant: 'destructive', title: 'Not opened', description: e }); }}
                className="h-11 rounded-xl border-2 font-black uppercase text-[11px] tracking-widest"
              >
                Line sheet
              </Button>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              Opens a printable catalog of everything live — print it, or save as PDF to email a stockist.
            </p>
          </CardContent>
        </Card>
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="w-4 h-4 text-primary shrink-0" />
                <p className="text-[10px] font-black uppercase tracking-widest truncate">Online catalog — {retailItems.length} item(s)</p>
              </div>
              {liveCount === 0 ? (
                <Button variant="outline" size="sm" disabled className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest shrink-0">
                  <Printer className="mr-1.5 h-3.5 w-3.5" /> Labels for all live
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest shrink-0">
                  <Link href={`/inventory/labels?ids=${retailItems.filter((i: any) => i.showOnline === true).map((i: any) => encodeURIComponent(i.id)).slice(0, 200).join(',')}`}><Printer className="mr-1.5 h-3.5 w-3.5" /> Labels for all live</Link>
                </Button>
              )}
            </div>
            {retailItems.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed py-10 text-center space-y-2">
                <Store className="w-7 h-7 mx-auto opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest opacity-40">
                  Add retail items in Inventory first
                </p>
              </div>
            )}
            <div className="space-y-3">
              {retailItems.map((it: any) => {
                const d = draftFor(it);
                const live = it.showOnline === true;
                return (
                  <div key={it.id} className={cn('rounded-2xl border-2 p-4 space-y-3', live && 'border-primary/40 bg-primary/[0.02]')}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black uppercase tracking-tight text-xs truncate">{it.name}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          {it.sku ? `${it.sku} · ` : ''}MSRP ${Number(it.msrp || 0).toFixed(2)} · {variantIdsOf(it).length
                            ? `${variantIdsOf(it).reduce((n: number, v: string) => n + Math.max(0, sellableStock((invById.get(v) as any) || { totalStock: 0 })), 0)} sellable across ${variantIdsOf(it).length} variant${variantIdsOf(it).length === 1 ? '' : 's'}`
                            : `${it.totalStock - (it.stockReserved || 0)} sellable`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground">
                          <Link href={`/inventory/labels?ids=${encodeURIComponent(it.id)}`} aria-label={`Print labels for ${it.name}`}><Printer className="h-3.5 w-3.5" /></Link>
                        </Button>
                        <span className={cn('text-[8px] font-black uppercase tracking-widest', live ? 'text-primary' : 'text-muted-foreground/50')}>
                          {live ? 'Live' : 'Hidden'}
                        </span>
                        <Switch checked={live} onCheckedChange={(v: boolean) => toggleOnline(it, v)} />
                      </div>
                    </div>
                    {live && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input aria-label="Wholesale $ (optional)" placeholder="Wholesale $ (optional)" inputMode="decimal" value={d.wholesale}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, wholesale: e.target.value } })}
                            className="h-10 rounded-xl border-2 font-black font-mono text-xs" />
                          <Input aria-label="Wholesale min qty" placeholder="Wholesale min qty" inputMode="numeric" value={d.minQty}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, minQty: e.target.value } })}
                            className="h-10 rounded-xl border-2 font-black font-mono text-xs" />
                          <Input aria-label="Weight (oz) — auto-weighs parcels" placeholder="Weight (oz) — auto-weighs parcels" inputMode="decimal" value={d.weight}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, weight: e.target.value } })}
                            className="h-10 rounded-xl border-2 font-black font-mono text-xs" />
                        </div>
                        <div className="flex gap-2">
                          <label className={cn('flex-1 h-10 rounded-xl border-2 border-dashed flex items-center justify-center text-[9px] font-black uppercase tracking-widest cursor-pointer hover:border-primary/50 transition-all', uploading === `image-${it.id}` && 'opacity-50 pointer-events-none')}>
                            {uploading === `image-${it.id}` ? 'Uploading…' : 'Upload images'}
                            <input type="file" accept="image/*" multiple aria-label={`Upload images for ${it.name}`} className="hidden"
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { uploadMedia(it, e.target.files, 'image'); e.target.value = ''; }} />
                          </label>
                          <label className={cn('flex-1 h-10 rounded-xl border-2 border-dashed flex items-center justify-center text-[9px] font-black uppercase tracking-widest cursor-pointer hover:border-primary/50 transition-all', uploading === `video-${it.id}` && 'opacity-50 pointer-events-none')}>
                            {uploading === `video-${it.id}` ? 'Uploading…' : 'Upload a video'}
                            <input type="file" accept="video/*" aria-label={`Upload a video for ${it.name}`} className="hidden"
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { uploadMedia(it, e.target.files, 'video'); e.target.value = ''; }} />
                          </label>
                        </div>
                        {d.video && (
                          <p className="text-[8px] font-black uppercase tracking-widest text-primary truncate">Video attached. It saves with the item.</p>
                        )}
                        <Textarea aria-label="Storefront description" placeholder={'Image URLs — one per line (first is the cover)'} value={d.img}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, img: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <Textarea aria-label="Storefront description" placeholder="Storefront description" value={d.desc}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, desc: e.target.value } })}
                          className="rounded-xl border-2 min-h-[60px] font-bold text-xs" />
                        <Textarea aria-label="How to use — steps or instructions" placeholder="How to use — steps or instructions" value={d.howToUse}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, howToUse: e.target.value } })}
                          className="rounded-xl border-2 min-h-[60px] font-bold text-xs" />
                        <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-2.5">
                          <div>
                            <Label className="text-[11px] font-black uppercase tracking-widest">Made to order</Label>
                            <p className="text-[11px] font-bold text-muted-foreground">Ships in more business days than your usual time. In a cart with other items, the whole order follows the longest one.</p>
                          </div>
                          <Switch aria-label="Made to order"
                            checked={d.made === true}
                            onCheckedChange={(v: boolean) => setDrafts({ ...drafts, [it.id]: { ...d, made: v, leadMin: v && !d.leadMin ? '5' : d.leadMin, leadMax: v && !d.leadMax ? '7' : d.leadMax } })}
                          />
                        </div>
                        {d.made === true && (
                          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                            <span>Ships in</span>
                            <Input aria-label="Fewest business days" inputMode="numeric" value={d.leadMin}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, leadMin: e.target.value.replace(/[^0-9]/g, '') } })}
                              className="h-10 w-16 rounded-xl border-2 text-center font-mono text-sm font-bold" />
                            <span>to</span>
                            <Input aria-label="Most business days" inputMode="numeric" value={d.leadMax}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, leadMax: e.target.value.replace(/[^0-9]/g, '') } })}
                              className="h-10 w-16 rounded-xl border-2 text-center font-mono text-sm font-bold" />
                            <span>business days</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-2.5">
                          <div>
                            <Label className="text-[11px] font-black uppercase tracking-widest">Pre-order</Label>
                            <p className="text-[11px] font-bold text-muted-foreground">Sell before it lands. You promise a ship-by date — the law holds you to it, and so does this.</p>
                          </div>
                          <Switch aria-label="Pre-order"
                            checked={d.preorder === true}
                            onCheckedChange={(v: boolean) => setDrafts({ ...drafts, [it.id]: { ...d, preorder: v } })}
                          />
                        </div>
                        {d.preorder === true && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Ships by</Label>
                                <Input type="date" aria-label="Promised ship-by date" value={d.preorderEtaAt}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, preorderEtaAt: e.target.value } })}
                                  className="h-10 rounded-xl border-2 font-bold text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Orders close</Label>
                                <Input type="date" aria-label="Last day to pre-order" value={d.preorderClosesAt}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, preorderClosesAt: e.target.value } })}
                                  className="h-10 rounded-xl border-2 font-bold text-xs" />
                              </div>
                            </div>
                            <Input placeholder="How many this run can take (blank = no limit)" inputMode="numeric" aria-label="Pre-order run limit"
                              value={d.preorderLimit}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, preorderLimit: e.target.value } })}
                              className="h-10 rounded-xl border-2 font-bold text-xs" />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={runBusy === it.id}
                              className="h-9 w-full rounded-xl border-2 border-amber-300 text-amber-800 font-black uppercase text-[9px] tracking-widest"
                              onClick={async () => {
                                if (!tenantId) return;
                                const newDate = d.preorderEtaAt;
                                if (!newDate) {
                                  toast({ variant: 'destructive', title: 'Set the new ship-by date first', description: 'Change "Ships by" above, then tell everyone.' });
                                  return;
                                }
                                setRunBusy(it.id);
                                try {
                                  const peek = await fetch('/api/retail/preorder-run-eta', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ tenantId, productId: it.id, dryRun: true }),
                                  }).then((r) => r.json());
                                  if (!peek.ok) {
                                    toast({ variant: 'destructive', title: 'Could not check the run', description: peek.error || 'Try again.' });
                                    return;
                                  }
                                  if (!peek.orders) {
                                    toast({ title: 'Nobody to tell', description: 'No open pre-orders on this product yet.' });
                                    return;
                                  }
                                  const ok = window.confirm(`Tell ${peek.orders} customer(s) the new date is ${newDate}? Each can keep waiting or cancel for a full refund.`);
                                  if (!ok) return;
                                  const why = window.prompt('Why the change? (optional \u2014 goes in the email word for word)') || '';
                                  const res = await fetch('/api/retail/preorder-run-eta', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ tenantId, productId: it.id, newDate, note: why }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) toast({ variant: 'destructive', title: 'Not sent', description: data.error || 'Try again.' });
                                  else toast({ title: 'Everyone told', description: `${data.orders} order(s) updated, ${data.emailed} emailed.` });
                                } catch {
                                  toast({ variant: 'destructive', title: 'Not sent', description: 'Check your connection and try again.' });
                                } finally {
                                  setRunBusy(null);
                                }
                              }}
                            >
                              {runBusy === it.id ? 'Working\u2026' : 'Tell everyone the new date'}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={runBusy === it.id}
                              className="h-9 w-full rounded-xl border-2 border-destructive/30 text-destructive font-black uppercase text-[9px] tracking-widest"
                              onClick={async () => {
                                if (!tenantId) return;
                                setRunBusy(it.id);
                                try {
                                  const peek = await fetch('/api/retail/preorder-run-cancel', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ tenantId, productId: it.id, dryRun: true }),
                                  }).then((r) => r.json());
                                  if (!peek.ok) {
                                    toast({ variant: 'destructive', title: 'Could not check the run', description: peek.error || 'Try again.' });
                                    return;
                                  }
                                  if (!peek.orders) {
                                    toast({ title: 'Nothing to cancel', description: 'No open pre-orders on this product.' });
                                    return;
                                  }
                                  const ok = window.confirm(`Cancel this run? ${peek.orders} customer order(s), $${(peek.refundCents / 100).toFixed(2)} to refund. Each person is emailed. Refunds within your automatic amount go back on their own; the rest wait on Problems for someone allowed to send them.`);
                                  if (!ok) return;
                                  const why = window.prompt('Tell them why (goes in the email word for word):') || '';
                                  const res = await fetch('/api/retail/preorder-run-cancel', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ tenantId, productId: it.id, reason: why }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) toast({ variant: 'destructive', title: 'Not cancelled', description: data.error || 'Try again.' });
                                  else toast({ title: 'Run cancelled', description: `${data.orders} order(s), $${(data.refundCents / 100).toFixed(2)} to refund${data.sentCents ? `, $${(data.sentCents / 100).toFixed(2)} of it sent back already` : ''}, ${data.emailed} emailed.` });
                                } catch {
                                  toast({ variant: 'destructive', title: 'Not cancelled', description: 'Check your connection and try again.' });
                                } finally {
                                  setRunBusy(null);
                                }
                              }}
                            >
                              {runBusy === it.id ? 'Working\u2026' : 'Cancel this run + refund everyone'}
                            </Button>
                            <p className="text-[10px] font-bold text-muted-foreground">
                              Taken so far: {(it as any).preorderSold || 0}. Leave the close date blank to keep taking orders until you turn it off. If you miss the ship-by date, buyers get a one-tap refund — so promise a date you can keep.
                            </p>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-2.5">
                          <div>
                            <Label className="text-[11px] font-black uppercase tracking-widest">Digital item</Label>
                            <p className="text-[11px] font-bold text-muted-foreground">No stock, no shipping — the link below is emailed the moment they pay.</p>
                          </div>
                          <Switch aria-label="Digital item"
                            checked={d.digital === true}
                            onCheckedChange={(v: boolean) => setDrafts({ ...drafts, [it.id]: { ...d, digital: v } })}
                          />
                        </div>
                        {d.digital === true && (
                          <div className="space-y-2">
                            <label className="flex h-10 w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest hover:bg-muted">
                              <input
                                type="file"
                                className="sr-only"
                                aria-label="Upload the file customers receive"
                                disabled={fileBusy === it.id}
                                onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                                  const f = e.target.files?.[0];
                                  e.target.value = '';
                                  if (!f || !tenantId) return;
                                  if (f.size > 40 * 1024 * 1024) {
                                    toast({ variant: 'destructive', title: 'File too large', description: 'Keep files under 40 MB \u2014 host video elsewhere and paste the link instead.' });
                                    return;
                                  }
                                  setFileBusy(it.id);
                                  try {
                                    const path = `tenants/${tenantId}/digital/${it.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                                    await uploadPrivateFile(path, f);
                                    setDrafts({ ...drafts, [it.id]: { ...d, digitalFilePath: path, digitalFileName: f.name } });
                                    toast({ title: 'File attached', description: 'Save the item to publish it to buyers.' });
                                  } catch {
                                    toast({ variant: 'destructive', title: 'Upload failed', description: 'Try again, or paste a link instead.' });
                                  } finally {
                                    setFileBusy(null);
                                  }
                                }}
                              />
                              {fileBusy === it.id ? 'Uploading\u2026' : d.digitalFileName ? `File: ${d.digitalFileName}` : 'Upload the file (PDF, zip, image)'}
                            </label>
                            <Input placeholder="…or paste a link (course, video, download page)" aria-label="Digital delivery link"
                              value={d.digitalUrl}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, digitalUrl: e.target.value } })}
                              className="h-10 rounded-xl border-2 font-bold text-xs" />
                            <Input placeholder="Access days (blank = theirs to keep)" inputMode="numeric" aria-label="Days of access after purchase"
                              value={d.digitalAccessDays}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, digitalAccessDays: e.target.value } })}
                              className="h-10 rounded-xl border-2 font-bold text-xs" />
                            <p className="text-[10px] font-bold text-muted-foreground">
                              Uploaded files open inside the app, watermarked with the buyer&apos;s name — never a public URL. Leave access days blank for lifetime access; a window only limits NEW sales, never someone who already bought.
                            </p>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-dashed px-3 py-2.5">
                          <p className="min-w-0 text-[11px] font-bold text-muted-foreground">
                            {Number(it.casePack) > 1
                              ? `Case of ${Math.floor(Number(it.casePack))}${it.caseBarcode ? ` (${it.caseBarcode})` : ', no case code yet'}${Number(it.palletPack) > 1 ? ` · pallet of ${Math.floor(Number(it.palletPack))} cases${it.palletBarcode ? ` (${it.palletBarcode})` : ''}` : ''}. `
                              : 'No case or pallet code. '}
                            Its codes are set on its page, under Codes and labels.
                          </p>
                          <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                            <Link href={`/inventory/product/${encodeURIComponent(it.id)}?tab=codes`}>Codes</Link>
                          </Button>
                        </div>
                        <Textarea placeholder={'Kit or collection? List what\u2019s inside — one piece per line. Customers reporting a problem then pick the exact piece.'} value={d.kit}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, kit: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <Textarea placeholder={'Specs — one per line as Label: Value (e.g. Size: 15 mL)'} value={d.specs}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, specs: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <Textarea placeholder={'Documents — one per line as Name | https://link (e.g. MSDS | https://…)'} value={d.docs}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, docs: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-dashed px-3 py-2.5">
                          <p className="min-w-0 text-[11px] font-bold text-muted-foreground">
                            {(it.optionGroups || []).length
                              ? `Choices: ${(it.optionGroups || []).map((g: any) => (g === variantGroup(it) ? `${g.name} (${variantIdsOf(it).length} variant${variantIdsOf(it).length === 1 ? '' : 's'})` : g.name)).join(' · ')}`
                              : 'Variants are added on the product’s page, under Codes and labels, and other choices under In the shop.'}
                          </p>
                          <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                            <Link href={`/inventory/product/${encodeURIComponent(it.id)}?tab=${variantIdsOf(it).length ? 'codes' : 'online'}`}>{(it.optionGroups || []).length ? 'Edit choices' : 'Add choices'}</Link>
                          </Button>
                        </div>
                        <VariantSettings firestore={(firestore as Firestore) || null} tenantId={String(tenantId || '')} listing={it} byId={invById as Map<string, any>}
                          onToast={(t) => toast({ ...(t.bad ? { variant: 'destructive' as const } : {}), title: t.title, ...(t.description ? { description: t.description } : {}) })} />
                        <Button disabled={itemBusy === it.id} onClick={() => saveItem(it)}
                          variant="outline" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                          {itemBusy === it.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Save item'}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
