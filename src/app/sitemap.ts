import type { MetadataRoute } from 'next';

import { isStorefrontVisible, type SellableItem } from '@/lib/retail-orders';

// ─── /sitemap.xml ────────────────────────────────────────────────────────────
// The list of pages worth looking at. robots.txt already points here, so
// without this file that pointer leads nowhere.
//
// A sitemap is not a ranking trick — it is how a crawler discovers pages it
// would otherwise never reach. Nothing links to an individual product page
// from outside the shop, so on a new storefront those pages are effectively
// invisible until something announces them. This announces them.
//
// Two rules it obeys:
//
//   1. ONLY WHAT A STRANGER MAY SEE. Published retail products, storefronts,
//      catalogs and booking pages. Never an order, a library, an invoice, a
//      checkout — those are addressed to one person. The same list robots.txt
//      disallows, enforced again here, because a sitemap that leaks a private
//      URL has invited a crawler through the front door.
//
//   2. ONLY WHAT ACTUALLY WORKS. A product is listed only if it passes the
//      SAME visibility rules the storefront enforces. Submitting a URL that
//      returns "not available" teaches a search engine the site is unreliable
//      and costs the pages that ARE good.
//
// lastModified matters more than priority: a crawler uses it to decide what to
// re-read, and a shop that edits a product wants that seen today, not next month.

export const revalidate = 3600;

const MAX_TENANTS = 200;
const MAX_PRODUCTS_PER_TENANT = 500;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-sitemap';
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

const when = (value: any): Date => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? new Date(t) : new Date();
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  if (!origin) return [];

  const entries: MetadataRoute.Sitemap = [];

  try {
    const db = getAdminDb();
    const tenantsSnap = await db.collection('tenants').limit(MAX_TENANTS).get();

    for (const tDoc of tenantsSnap.docs) {
      const tenantId = tDoc.id;
      const tenant: any = tDoc.data() || {};

      // A tenant with no public name isn't a shop yet — listing it would send
      // a crawler to an unfinished page.
      if (!String(tenant.businessName || tenant.name || '').trim()) continue;

      entries.push(
        { url: `${origin}/shop/${tenantId}`, lastModified: when(tenant.updatedAt), changeFrequency: 'daily', priority: 0.9 },
        { url: `${origin}/shop/${tenantId}/catalog`, lastModified: when(tenant.updatedAt), changeFrequency: 'daily', priority: 0.7 },
        { url: `${origin}/book/${tenantId}`, lastModified: when(tenant.updatedAt), changeFrequency: 'weekly', priority: 1 },
      );

      try {
        const itemsSnap = await db
          .collection(`tenants/${tenantId}/inventory`)
          .where('showOnline', '==', true)
          .limit(MAX_PRODUCTS_PER_TENANT)
          .get();

        for (const iDoc of itemsSnap.docs) {
          const item: any = { id: iDoc.id, ...(iDoc.data() as any) };
          // The storefront's own rules decide, so a sitemap entry can never
          // promise a page the shop would refuse to sell from.
          if (!isStorefrontVisible(item as SellableItem)) continue;
          entries.push({
            url: `${origin}/shop/${tenantId}/product/${iDoc.id}`,
            lastModified: when(item.updatedAt || item.lastModified),
            changeFrequency: 'weekly',
            priority: 0.8,
          });
        }
      } catch (e: any) {
        // One shop's products failing must not blank the whole sitemap.
        console.error('[sitemap] products failed for', tenantId, e?.message);
      }
    }
  } catch (e: any) {
    console.error('[sitemap] failed:', e?.message);
  }

  return entries;
}
