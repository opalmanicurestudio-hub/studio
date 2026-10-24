import { getRetailSecrets } from '@/lib/retail-secrets';
import { NextRequest, NextResponse } from 'next/server';

import { type SellableItem } from '@/lib/retail-orders';
import { listingsOf } from '@/lib/variants';
import { tenantTimeZone } from '@/lib/tenant-time';
import { sanitizeShopConfig } from '@/lib/shop-config';
import { resolveWholesaleAccess } from '@/lib/retail-wholesale';
import { busyBanner, publicSchedule, scheduleFrom } from '@/lib/ship-promise';
import { publicOffer } from '@/lib/retail-offers';
import { catalogProducts } from '@/lib/shop-catalog';
import { boughtTogether, liveOffers } from '@/lib/retail-offers-server';

// ─── /api/retail/catalog/route.ts ─────────────────────────────────────────────
// GET ?tenantId=...&wholesaleCode=...
//
// Public, unauthenticated. Serves the storefront its catalog through the
// Admin SDK so no Firestore security-rule changes are needed for the public
// shop. Never exposes costPerUnit, batches, supplier, or raw stock counts —
// only what a shopper may see.
//
// Wholesale prices are ONLY included when a valid wholesaleCode is supplied;
// otherwise the response is identical to what an anonymous shopper gets.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-catalog';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}


export async function GET(req: NextRequest) {
  try {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const wholesaleCode = String(req.nextUrl.searchParams.get('wholesaleCode') || '').trim();

  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

  const db = getAdminDb();
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};

  // A pre-order run "closing March 3" must stay open all of March 3 on the
  // SHOP'S clock, which is what its own comment always promised.
  const shopZone = tenantTimeZone(tenant);

  const wsAccess = await resolveWholesaleAccess(db, tenantId, wholesaleCode ? { ...rs, wholesaleAccessCode: (await getRetailSecrets(db, tenantId)).wholesaleAccessCode } : rs, wholesaleCode);
  if (wholesaleCode && !wsAccess.unlocked) {
    return NextResponse.json({ error: wsAccess.error || 'Invalid wholesale access code' }, { status: 403 });
  }
  const wholesaleUnlocked = wsAccess.unlocked;
  const wsDiscount = wsAccess.account?.extraDiscountPercent || 0;
  // "Unlock wholesale" shows only for a shop that sells wholesale: a house code, an active account, or the owner turned
  // it on. (It used to show on every shop, wholesale or not.)
  const wholesaleOffered = rs.wholesaleCodeSet === true || String(rs.wholesaleAccessCode || '').trim().length > 0 || rs.wholesaleOffered === true
    || !(await db.collection(`tenants/${tenantId}/wholesaleAccounts`).where('status', '==', 'active').limit(1).get().catch(() => ({ empty: true }))).empty;

  const invSnap = await db.collection(`tenants/${tenantId}/inventory`)
    .where('type', '==', 'retail').get();

  // A product that comes in variants is one listing, in stock while any of its variants is; its variants are sold
  // inside it, never listed on their own (lib/variants).
  const all = invSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as SellableItem));
  const byId = new Map<string, any>(all.map((i: any) => [String(i.id), i]));
  const listings = listingsOf(all);
  const products = catalogProducts(all, byId, listings, { wholesale: wholesaleUnlocked, discountPct: wsDiscount, zone: shopZone });

  // Bundles, kits, boxes, looks and bought-together picks (lib/retail-offers). Only offers whose products are all on
  // sale online right now are sent. Wholesale prices don't take bundle savings, so a wholesale buyer is sent none.
  const shownMap = new Map<string, any>(products.map((p: any) => [String(p.id), p]));
  const [offerList, pairs] = wholesaleUnlocked ? [[], {}] : await Promise.all([liveOffers(db, tenantId), boughtTogether(db, tenantId)]);
  const offers = (offerList as any[]).map((o) => publicOffer(o, shownMap)).filter(Boolean).sort((a: any, b: any) => a.order - b.order || String(a.name).localeCompare(String(b.name)));
  const shownPairs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(pairs as Record<string, string[]>)) { if (!shownMap.has(k)) continue; const ids = v.filter((x) => shownMap.has(x)); if (ids.length) shownPairs[k] = ids; }

  return NextResponse.json({
    shop: {
      tenantId,
      name: tenant.businessName || tenant.name || 'Shop',
      logoUrl: tenant.logoUrl || null,
      tagline: String(rs.shopTagline || '').trim() || 'Shop',
      announcement: String(rs.shopAnnouncement || '').trim(),
      layout: ['grid', 'list', 'showcase'].includes(rs.shopLayout) ? rs.shopLayout : 'grid',
      paused: rs.storePaused === true,
      pausedMessage: String(rs.storePausedMessage || '').trim(),
      cartHoldMinutes: Math.max(0, Math.floor(Number(rs.cartHoldMinutes) || 0)),
      prepMinutes: Math.max(0, Math.floor(Number(rs.prepMinutes) || 0)),
      tipsEnabled: rs.tipsEnabled === true,
      scheduledPickup: rs.scheduledPickup === true,
      pageConfig: sanitizeShopConfig(rs.shopPageConfig),
      wholesaleOffered,
      wholesaleUnlocked,
      wholesaleBusiness: wsAccess.account?.businessName || '',
      taxRatePercent: Number(rs.taxRatePercent) || 0,
      wholesaleTaxExempt: rs.wholesaleTaxExempt === true,
      flatShippingDollars: Number(rs.flatShippingDollars) || 0,
      freeShippingOverDollars: Number(rs.freeShippingOverDollars) || 0,
      // The ways of getting an order the shop offers (both shipping switches count, as checkout checks them).
      pickupOffered: rs.pickupEnabled !== false,
      shippingOffered: rs.shippingOffered !== false && rs.shippingEnabled !== false,
      curbsideOffered: rs.curbsideOffered !== false,
      curbsideMode: rs.curbsideMode || 'freeform',
      curbsideSpots: Array.isArray(rs.curbsideSpots) ? rs.curbsideSpots : [],
      // The shipping schedule, once the shop shows dates: checkout works out each option's ship-by and arrival
      // dates from it (lib/ship-promise), the same way the order stores them.
      timeZone: shopZone,
      shipSchedule: publicSchedule(rs),
      // A busy period's banner while one is on, in the shop's own words, filled in on its clock.
      busyBanner: busyBanner(scheduleFrom(rs), new Date(), shopZone),
      // The server's clock, so a device set wrong can't move a cutoff.
      serverNow: new Date().toISOString(),
    },
    products,
    offers,
    pairs: shownPairs,
  });
  } catch (e: any) {
    console.error('[retail-catalog] fatal:', e?.message);
    return NextResponse.json(
      { error: `Shop data error: ${String(e?.message || 'unknown').slice(0, 160)}` },
      { status: 500 }
    );
  }
}
