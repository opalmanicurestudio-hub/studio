'use client';

import { doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Camera, Car, DollarSign, Globe, Loader, Lock, MapPin, Plus, Printer, ShieldCheck, Store, Truck, X, Zap,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

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
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';

import { optionGroupsToText, parseOptionGroups } from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

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
    howToUse: string; specs: string; docs: string; options: string;
  }>>({});

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
      shippoApiKey: existing.shippoApiKey || '',
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
      returnWindowDays: Number(existing.returnWindowDays) || 30,
      returnsEnabled: existing.returnsEnabled !== false,
      returnLabelPayer: existing.returnLabelPayer === 'shop' || existing.returnLabelPayer === 'customer' ? existing.returnLabelPayer : 'fault',
      claimAutoResolveMaxCents: Number(existing.claimAutoResolveMaxCents) || 0,
      cartRecoveryEnabled: existing.cartRecoveryEnabled !== false,
      deliveryIssueWindowDays: Number(existing.deliveryIssueWindowDays) || 7,
      returnPolicyText: existing.returnPolicyText || '',
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
      wholesaleAccessCode: existing.wholesaleAccessCode || '',
      wholesaleTaxExempt: existing.wholesaleTaxExempt === true,
    });
    if (tenant) setLoaded(true);
  }, [tenant, loaded]);

  const retailItems = useMemo(
    () => (inventory || []).filter((i: any) => i.type === 'retail' && i.status !== 'archived'),
    [inventory]
  );
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

  const saveSettings = async () => {
    if (!firestore || !tenantId || saving) return;
    setSaving(true);
    try {
      await setDoc(doc(firestore as Firestore, 'tenants', tenantId), {
        retailSettings: JSON.parse(JSON.stringify({
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
          shippoApiKey: (rs.shippoApiKey || '').trim(),
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
          returnWindowDays: Math.max(1, Math.floor(Number(rs.returnWindowDays) || 30)),
          returnsEnabled: rs.returnsEnabled !== false,
          returnLabelPayer: rs.returnLabelPayer === 'shop' || rs.returnLabelPayer === 'customer' ? rs.returnLabelPayer : 'fault',
          claimAutoResolveMaxCents: Math.max(0, Math.floor(Number(rs.claimAutoResolveMaxCents) || 0)),
          cartRecoveryEnabled: rs.cartRecoveryEnabled !== false,
          deliveryIssueWindowDays: Math.max(1, Math.floor(Number(rs.deliveryIssueWindowDays) || 7)),
          returnPolicyText: String(rs.returnPolicyText || '').trim().slice(0, 1200),
          shipFrom: JSON.parse(JSON.stringify(rs.shipFrom || {})),
          storePaused: rs.storePaused === true,
          storePausedMessage: (rs.storePausedMessage || '').trim(),
          cartHoldMinutes: Math.max(0, Math.floor(Number(rs.cartHoldMinutes) || 0)),
          shopLayout: rs.shopLayout || 'grid',
          shopTagline: (rs.shopTagline || '').trim(),
          shopAnnouncement: (rs.shopAnnouncement || '').trim(),
          wholesaleAccessCode: (rs.wholesaleAccessCode || '').trim(),
          curbsideSpots: (rs.curbsideSpots || []).filter(Boolean),
        })),
      }, { merge: true });
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
    specs: (it.specs || []).map((sp: any) => `${sp.label}: ${sp.value}`).join('\n'),
    docs: (it.documents || []).map((d: any) => `${d.name} | ${d.url}`).join('\n'),
    options: optionGroupsToText(it.optionGroups),
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
        wholesalePriceDollars: d.wholesale.trim() === '' ? null : Number(d.wholesale) || 0,
        weightOz: Math.max(0, Number(d.weight) || 0),
        wholesaleMinQty: d.minQty.trim() === '' ? null : Math.max(0, Math.floor(Number(d.minQty) || 0)),
        onlineDescription: d.desc.trim(),
        howToUse: d.howToUse.trim(),
        imageUrls,
        specs: JSON.parse(JSON.stringify(specs)),
        documents: JSON.parse(JSON.stringify(documents)),
        optionGroups: JSON.parse(JSON.stringify(parseOptionGroups(d.options))),
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
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
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
        <Card className={cn('border-2 rounded-[2rem] overflow-hidden bg-white', rs.storePaused && 'border-amber-300')}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">Store status</p>
                <p className={cn('font-black uppercase tracking-tighter text-lg leading-none mt-1', rs.storePaused ? 'text-amber-600' : 'text-green-600')}>
                  {rs.storePaused ? 'Paused' : 'Open'}
                </p>
              </div>
              <Switch checked={rs.storePaused !== true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, storePaused: !v })} />
            </div>
            {rs.storePaused && (
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Message visitors see while paused</Label>
                <Textarea placeholder="We are restocking the shelves — back within the hour!"
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
                <Input inputMode="numeric" value={rs.cartHoldMinutes == null ? '' : String(rs.cartHoldMinutes)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, cartHoldMinutes: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 pt-3 self-center">
                Shows a live countdown in the cart and releases idle carts — honest urgency for drops and high volume.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
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
                <Input placeholder="Shop" value={rs.shopTagline || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shopTagline: e.target.value })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Announcement bar (optional)</Label>
                <Input placeholder="e.g. Free pickup orders ready in 2 hours" value={rs.shopAnnouncement || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shopAnnouncement: e.target.value })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Pickup experience</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-black uppercase tracking-widest">Offer curbside</Label>
              <Switch checked={rs.curbsideOffered !== false}
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
                      <Input placeholder="Spot name (e.g. Spot 1)" value={newSpot}
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
              <Switch checked={rs.shippingOffered !== false}
                onCheckedChange={(v: boolean) => setRs({ ...rs, shippingOffered: v })} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Money</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Tax %</Label>
                <Input inputMode="decimal" value={num(rs.taxRatePercent)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, taxRatePercent: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Flat ship $</Label>
                <Input inputMode="decimal" value={num(rs.flatShippingDollars)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, flatShippingDollars: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Free over $</Label>
                <Input inputMode="decimal" value={num(rs.freeShippingOverDollars)}
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
              <Switch checked={rs.stripeTaxEnabled === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, stripeTaxEnabled: v })} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[11px] font-black uppercase tracking-widest">Fulfilment promises &amp; waves</p>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              These set the clock every order is measured against, and when the morning wave builds itself.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {([
                ['prepMinutes', 'Pickup ready in (min)'],
                ['shipProcessingHours', 'Ship within (hours)'],
                ['slaWarnMinutes', 'Warn me (min before due)'],
                ['readyStaleHours', 'Chase uncollected after (h)'],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
                  <Input
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
                <Switch
                  checked={rs.autoWaveEnabled === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, autoWaveEnabled: v })}
                />
              </div>
              {rs.autoWaveEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">From hour (0-23)</Label>
                    <Input
                      inputMode="numeric" value={String(rs.autoWaveHour ?? 9)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, autoWaveHour: Number(e.target.value) || 0 })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Totes to use</Label>
                    <Input
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

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-black uppercase tracking-tight">Shipment protection</p>
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
                <Switch
                  checked={rs.signatureConfirmationEnabled === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, signatureConfirmationEnabled: v })}
                />
              </div>
              {rs.signatureConfirmationEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Orders over ($)</Label>
                    <Input
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
                              : 'bg-white hover:border-primary/40'
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
                <Switch
                  checked={rs.shipmentInsuranceEnabled === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, shipmentInsuranceEnabled: v })}
                />
              </div>
              {rs.shipmentInsuranceEnabled && (
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Orders over ($)</Label>
                  <Input
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

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-black uppercase tracking-tight">Photo the packed box</p>
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              One shot of the open box at the bench, before it is sealed. It ends a
              &ldquo;something was missing&rdquo; claim faster than any argument, and takes about four
              seconds. Off until you switch it on &mdash; nobody should start storing photographs of
              customers&rsquo; orders without deciding to.
            </p>

            <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed p-3">
              <p className="text-xs font-black uppercase tracking-tight">Ask packers for a photo</p>
              <Switch
                checked={rs.packPhotoEnabled === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, packPhotoEnabled: v })}
              />
            </div>

            {rs.packPhotoEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Required over ($)</Label>
                    <Input
                      inputMode="decimal"
                      value={String((Number(rs.packPhotoOverCents) || 0) / 100)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRs({ ...rs, packPhotoOverCents: Math.round((Number(e.target.value) || 0) * 100) })}
                      className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Or items over</Label>
                    <Input
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
                  <Input
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

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-black uppercase tracking-tight">Address check &amp; policy</p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed p-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-tight">Check addresses at checkout</p>
                <p className="text-[11px] font-bold text-muted-foreground">
                  Asks the carriers whether the address exists while the customer can still fix it in ten
                  seconds &mdash; rather than at the label, or a week later when the parcel comes back.
                </p>
              </div>
              <Switch
                checked={rs.addressValidationEnabled === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, addressValidationEnabled: v })}
              />
            </div>

            {rs.addressValidationEnabled && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed p-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tight">Refuse addresses the carriers cannot find</p>
                  <p className="text-[11px] font-bold text-muted-foreground">
                    Leave this off if you would rather take the order and sort it out by phone. Validators
                    are wrong about new builds and rural routes, and a refused real address costs the whole
                    sale &mdash; worse than an occasional redelivery. Either way the result is recorded on
                    the order as evidence.
                  </p>
                </div>
                <Switch
                  checked={rs.blockUndeliverableAddresses === true}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, blockUndeliverableAddresses: v })}
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-widest">Accept returns</Label>
                <p className="text-[11px] font-bold text-muted-foreground">
                  Off closes self-serve returns storefront-wide and on every order page. &ldquo;Report a
                  problem&rdquo; stays open regardless &mdash; a shop can decline changed minds, never defects.
                </p>
              </div>
              <Switch
                checked={rs.returnsEnabled !== false}
                onCheckedChange={(v: boolean) => setRs({ ...rs, returnsEnabled: v })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Who pays return shipping</Label>
              <div className="flex flex-wrap gap-1.5">
                {([['fault', 'By fault'], ['shop', 'Shop always'], ['customer', 'Customer']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={(rs.returnLabelPayer || 'fault') === v}
                    onClick={() => setRs({ ...rs, returnLabelPayer: v })}
                    className={cn(
                      'h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest transition-all',
                      (rs.returnLabelPayer || 'fault') === v ? 'border-primary bg-primary/5 text-primary' : 'bg-white'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                By fault: the shop covers defective or wrong-item returns, the customer covers changed
                minds. Takes effect when return labels ship.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Auto-approve claims up to ($)</Label>
              <Input
                inputMode="decimal"
                value={String(((rs.claimAutoResolveMaxCents || 0) / 100) || '')}
                placeholder="0 = every claim gets a human"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRs({ ...rs, claimAutoResolveMaxCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })}
                className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
              />
              <p className="text-[11px] font-bold text-muted-foreground">
                Only fires when your own packing record agrees with the customer (the item was never
                scanned complete) and the account is low-risk &mdash; and it queues the refund in the
                banner, so money still moves through you. Zero keeps every claim on a person.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-widest">Cart recovery email</Label>
                <p className="text-[11px] font-bold text-muted-foreground">
                  One email when a checkout times out unpaid &mdash; their cart link, nothing else, never twice.
                </p>
              </div>
              <Switch
                checked={rs.cartRecoveryEnabled !== false}
                onCheckedChange={(v: boolean) => setRs({ ...rs, cartRecoveryEnabled: v })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Return window (days)</Label>
                <Input
                  inputMode="numeric"
                  value={String(rs.returnWindowDays ?? 30)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setRs({ ...rs, returnWindowDays: Number(e.target.value) || 1 })}
                  className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Report a problem within</Label>
                <Input
                  inputMode="numeric"
                  value={String(rs.deliveryIssueWindowDays ?? 7)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setRs({ ...rs, deliveryIssueWindowDays: Number(e.target.value) || 1 })}
                  className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Policy wording (optional)
              </Label>
              <Textarea
                placeholder="Leave blank and we write it from the two numbers above."
                value={rs.returnPolicyText || ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setRs({ ...rs, returnPolicyText: e.target.value })}
                className="min-h-24 rounded-xl border-2 text-sm font-bold"
              />
              <p className="text-[11px] font-bold text-muted-foreground">
                This appears on the Stripe checkout page above the pay button, on the tear-off card inside
                every parcel, and in the evidence pack if a payment is ever disputed. The exact wording is
                saved onto each order as it is placed, so editing it later never changes what a past
                customer agreed to.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Menu mode — order-ahead extras</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Prep promise (min, 0 = off)</Label>
                <Input inputMode="numeric" value={String(rs.prepMinutes ?? 0)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, prepMinutes: Number(e.target.value) || 0 })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm text-center" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Max orders / 15 min (0 = off)</Label>
                <Input inputMode="numeric" value={String(rs.throttlePer15 ?? 0)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, throttlePer15: Number(e.target.value) || 0 })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm text-center" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-tight">Tips at checkout</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">10 / 15 / 20% chips on the payment sheet</p>
              </div>
              <Switch checked={rs.tipsEnabled === true} onCheckedChange={(v: boolean) => setRs({ ...rs, tipsEnabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-tight">Scheduled pickup</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">ASAP / +15 / +30 / +45 / +60 picker</p>
              </div>
              <Switch checked={rs.scheduledPickup === true} onCheckedChange={(v: boolean) => setRs({ ...rs, scheduledPickup: v })} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Shipping labels (Shippo)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Shippo API key — blank keeps manual tracking entry</Label>
              <Input placeholder="shippo_live_…" value={rs.shippoApiKey || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shippoApiKey: e.target.value })}
                className="h-11 rounded-xl border-2 font-mono font-bold text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Ship-from address (printed on labels, used for rates)</Label>
              <Input placeholder="Sender name (defaults to shop name)" value={rs.shipFrom?.name || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, name: e.target.value } })}
                className="h-11 rounded-xl border-2 font-bold text-sm" />
              <Input placeholder="Street address" value={rs.shipFrom?.street1 || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, street1: e.target.value } })}
                className="h-11 rounded-xl border-2 font-bold text-sm" />
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="City" value={rs.shipFrom?.city || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, city: e.target.value } })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
                <Input placeholder="State" value={rs.shipFrom?.state || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, state: e.target.value } })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
                <Input placeholder="ZIP" value={rs.shipFrom?.zip || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, zip: e.target.value } })}
                  className="h-11 rounded-xl border-2 font-bold text-sm" />
              </div>
              <Input placeholder="Phone (carriers may require it)" value={rs.shipFrom?.phone || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, shipFrom: { ...rs.shipFrom, phone: e.target.value } })}
                className="h-11 rounded-xl border-2 font-bold text-sm" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">Wholesale &amp; B2B</p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
              <Link href="/retail-orders/wholesale">Manage per-business accounts</Link>
            </Button>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                House code — shared fallback; per-account codes live in Wholesale
              </Label>
              <Input placeholder="e.g. OPALPRO2026" value={rs.wholesaleAccessCode || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRs({ ...rs, wholesaleAccessCode: e.target.value })}
                className="h-11 rounded-xl border-2 font-black uppercase tracking-widest text-sm" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-black uppercase tracking-widest">Wholesale orders tax-exempt</Label>
              <Switch checked={rs.wholesaleTaxExempt === true}
                onCheckedChange={(v: boolean) => setRs({ ...rs, wholesaleTaxExempt: v })} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[11px] font-black uppercase tracking-widest">Product page layout</p>
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
                  <p className="text-xs font-black uppercase tracking-tight">{label}</p>
                  <p className="text-[11px] font-bold text-muted-foreground">{hint}</p>
                </div>
                <Switch
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
                <Switch checked={rs.pickupEnabled !== false}
                  onCheckedChange={(v: boolean) => setRs({ ...rs, pickupEnabled: v })} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-tight">Shipping</p>
                <Switch checked={rs.shippingEnabled !== false}
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
                  <Input
                    placeholder="Question"
                    value={f.q}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const next = [...(rs.pdpFaq || [])];
                      next[i] = { ...next[i], q: e.target.value };
                      setRs({ ...rs, pdpFaq: next });
                    }}
                    className="h-10 rounded-xl border-2 font-bold text-xs"
                  />
                  <Textarea
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

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[11px] font-black uppercase tracking-widest">Catalog health &amp; printing</p>
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
                onClick={() => window.open(`/print/catalog/${tenantId}?tier=wholesale`, '_blank')}
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

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="w-4 h-4 text-primary shrink-0" />
                <p className="text-[10px] font-black uppercase tracking-widest truncate">Online catalog — {retailItems.length} item(s)</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={liveCount === 0}
                onClick={() => {
                  const ids = retailItems.filter((i: any) => i.showOnline === true).map((i: any) => i.id).slice(0, 60);
                  window.open(`/print/product-labels/${tenantId}?ids=${ids.join(',')}`, '_blank');
                }}
                className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest shrink-0"
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" /> Print all live
              </Button>
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
                          {it.sku ? `${it.sku} · ` : ''}MSRP ${Number(it.msrp || 0).toFixed(2)} · {it.totalStock - (it.stockReserved || 0)} sellable
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-muted-foreground"
                          onClick={() => window.open(`/print/product-labels/${tenantId}?ids=${it.id}`, '_blank')}
                        >
                          <Printer className="h-3.5 w-3.5" />
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
                          <Input placeholder="Wholesale $ (optional)" inputMode="decimal" value={d.wholesale}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, wholesale: e.target.value } })}
                            className="h-10 rounded-xl border-2 font-black font-mono text-xs" />
                          <Input placeholder="Wholesale min qty" inputMode="numeric" value={d.minQty}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, minQty: e.target.value } })}
                            className="h-10 rounded-xl border-2 font-black font-mono text-xs" />
                          <Input placeholder="Weight (oz) — auto-weighs parcels" inputMode="decimal" value={d.weight}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [it.id]: { ...d, weight: e.target.value } })}
                            className="h-10 rounded-xl border-2 font-black font-mono text-xs" />
                        </div>
                        <div className="flex gap-2">
                          <label className={cn('flex-1 h-10 rounded-xl border-2 border-dashed flex items-center justify-center text-[9px] font-black uppercase tracking-widest cursor-pointer hover:border-primary/50 transition-all', uploading === `image-${it.id}` && 'opacity-50 pointer-events-none')}>
                            {uploading === `image-${it.id}` ? 'Uploading…' : '📷 Upload images'}
                            <input type="file" accept="image/*" multiple className="hidden"
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { uploadMedia(it, e.target.files, 'image'); e.target.value = ''; }} />
                          </label>
                          <label className={cn('flex-1 h-10 rounded-xl border-2 border-dashed flex items-center justify-center text-[9px] font-black uppercase tracking-widest cursor-pointer hover:border-primary/50 transition-all', uploading === `video-${it.id}` && 'opacity-50 pointer-events-none')}>
                            {uploading === `video-${it.id}` ? 'Uploading…' : '🎬 Upload video'}
                            <input type="file" accept="video/*" className="hidden"
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { uploadMedia(it, e.target.files, 'video'); e.target.value = ''; }} />
                          </label>
                        </div>
                        {d.video && (
                          <p className="text-[8px] font-black uppercase tracking-widest text-primary truncate">Video attached ✓ — saves with the item</p>
                        )}
                        <Textarea placeholder={'Image URLs — one per line (first is the cover)'} value={d.img}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, img: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <Textarea placeholder="Storefront description" value={d.desc}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, desc: e.target.value } })}
                          className="rounded-xl border-2 min-h-[60px] font-bold text-xs" />
                        <Textarea placeholder="How to use — steps or instructions" value={d.howToUse}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, howToUse: e.target.value } })}
                          className="rounded-xl border-2 min-h-[60px] font-bold text-xs" />
                        <Textarea placeholder={'Specs — one per line as Label: Value (e.g. Size: 15 mL)'} value={d.specs}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, specs: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <Textarea placeholder={'Documents — one per line as Name | https://link (e.g. MSDS | https://…)'} value={d.docs}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, docs: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
                        <Textarea placeholder={'Options — one group per line as Name | Choice:price, Choice:price (e.g. Size | Small:0, Large:1.50)'} value={d.options}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [it.id]: { ...d, options: e.target.value } })}
                          className="rounded-xl border-2 min-h-[54px] font-bold text-xs" />
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
      </main>
    </div>
  );
}
