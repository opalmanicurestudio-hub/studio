// src/lib/product-features.ts — WHAT A BUSINESS'S PRODUCT SCREENS SHOW. Not every business sells products, and not every
// one that sells them has an online shop. Without the Retail tool, products are the backbar and supplies: stock, cost
// and where they're kept, nothing about prices, holds or the shop. With it but no shop opened yet, products are sold at
// the desk: prices and sales, but no shop status, wholesale or "ready for the shop" prompts until the shop is opened.
import { moduleEnabled } from './modules';

export type ProductFeatures = { sell: boolean; online: boolean };

export function productFeatures(tenant: any): ProductFeatures {
  const sell = moduleEnabled(tenant, 'retail');
  const rs = tenant?.retailSettings || {};
  return { sell, online: sell && !!rs.shopOpenedAt };
}
