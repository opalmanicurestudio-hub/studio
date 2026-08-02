'use client';

import { doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Car, DollarSign, Globe, Loader, Lock, Plus, Printer, Store, Truck, X, Zap,
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
  prepMinutes?: number;
  tipsEnabled?: boolean;
  scheduledPickup?: boolean;
  throttlePer15?: number;
  shippoApiKey?: string;
  shipFrom?: { name?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string; phone?: string };
  storePaused?: boolean;
  storePausedMessage?: string;
  cartHoldMinutes?: number;
  shopLayout?: 'grid' | 'list' | 'showcase';
  shopTagline?: string;
  shopAnnouncement?: string;
  taxRatePercent?: number;
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
  const { firestore } = useFirebase();
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
  const [drafts, setDrafts] = useState<Record<string, {
    wholesale: string; minQty: string; desc: string; img: string;
    howToUse: string; specs: string; docs: string; options: string;
  }>>({});

  useEffect(() => {
    if (loaded) return;
    const existing = (tenant?.retailSettings || {}) as RetailSettings;
    setRs({
      prepMinutes: Number(existing.prepMinutes) || 0,
      tipsEnabled: existing.tipsEnabled === true,
      scheduledPickup: existing.scheduledPickup === true,
      throttlePer15: Number(existing.throttlePer15) || 0,
      shippoApiKey: existing.shippoApiKey || '',
      shipFrom: existing.shipFrom || {},
      storePaused: existing.storePaused === true,
      storePausedMessage: existing.storePausedMessage || '',
      cartHoldMinutes: existing.cartHoldMinutes ?? 0,
      shopLayout: existing.shopLayout || 'grid',
      shopTagline: existing.shopTagline || '',
      shopAnnouncement: existing.shopAnnouncement || '',
      taxRatePercent: existing.taxRatePercent ?? 0,
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

  const saveSettings = async () => {
    if (!firestore || !tenantId || saving) return;
    setSaving(true);
    try {
      await setDoc(doc(firestore as Firestore, 'tenants', tenantId), {
        retailSettings: JSON.parse(JSON.stringify({
          ...rs,
          taxRatePercent: Number(rs.taxRatePercent) || 0,
          flatShippingDollars: Number(rs.flatShippingDollars) || 0,
          freeShippingOverDollars: Number(rs.freeShippingOverDollars) || 0,
          prepMinutes: Math.max(0, Math.floor(Number(rs.prepMinutes) || 0)),
          tipsEnabled: rs.tipsEnabled === true,
          scheduledPickup: rs.scheduledPickup === true,
          throttlePer15: Math.max(0, Math.floor(Number(rs.throttlePer15) || 0)),
          shippoApiKey: (rs.shippoApiKey || '').trim(),
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
    desc: it.onlineDescription || '',
    img: (it.imageUrls || []).join('\n'),
    howToUse: it.howToUse || '',
    specs: (it.specs || []).map((sp: any) => `${sp.label}: ${sp.value}`).join('\n'),
    docs: (it.documents || []).map((d: any) => `${d.name} | ${d.url}`).join('\n'),
    options: optionGroupsToText(it.optionGroups),
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
        wholesaleMinQty: d.minQty.trim() === '' ? null : Math.max(0, Math.floor(Number(d.minQty) || 0)),
        onlineDescription: d.desc.trim(),
        howToUse: d.howToUse.trim(),
        imageUrls,
        specs: JSON.parse(JSON.stringify(specs)),
        documents: JSON.parse(JSON.stringify(documents)),
        optionGroups: JSON.parse(JSON.stringify(parseOptionGroups(d.options))),
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
                        </div>
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
