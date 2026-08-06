import React from 'react';

import { sanitizeTheme, themeToCss } from '@/lib/shop-theme';

// ─── /shop/[tenantId]/layout.tsx ──────────────────────────────────────────────
// Every customer-facing page sits inside this, so a shop's brand is applied
// once, server-side, before anything renders — no flash of our colours before
// theirs arrive, and no per-page theming code to keep in sync.
//
// Theme values become CSS custom properties on a wrapper element. Components
// opt in with `bg-[var(--shop-card)]`-style classes, which means an untouched
// page keeps working exactly as it does today and can be migrated one block
// at a time rather than in one risky sweep.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-shop-theme';
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

async function loadTheme(tenantId: string) {
  try {
    const db = getAdminDb();
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return sanitizeTheme(null);
    const rs = (snap.data() as any)?.retailSettings || {};
    return sanitizeTheme(rs.shopTheme);
  } catch {
    // A theme is decoration; never let it stop a shop from selling.
    return sanitizeTheme(null);
  }
}

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const theme = await loadTheme(tenantId);

  return (
    <div
      data-shop-theme
      style={{ ...(Object.fromEntries(
        themeToCss(theme)
          .split(';')
          .map((pair) => pair.split(/:(.+)/))
          .filter((kv) => kv.length >= 2)
          .map(([k, v]) => [k.trim(), v.trim()])
      ) as React.CSSProperties) }}
      className="min-h-dvh"
    >
      {children}
    </div>
  );
}
