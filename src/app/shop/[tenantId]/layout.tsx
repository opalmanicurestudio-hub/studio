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

async function loadShop(tenantId: string) {
  try {
    const db = getAdminDb();
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return { theme: sanitizeTheme(null), shopName: '' };
    const data = snap.data() as any;
    const rs = data?.retailSettings || {};
    // The footer needs the shop's name and this read already has it — one
    // Firestore read serves both, instead of a second fetch per page view.
    return {
      theme: sanitizeTheme(rs.shopTheme),
      shopName: String(data?.businessName || data?.name || '').trim(),
    };
  } catch {
    // A theme is decoration; never let it stop a shop from selling.
    return { theme: sanitizeTheme(null), shopName: '' };
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
  const { theme, shopName } = await loadShop(tenantId);

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
      className="min-h-dvh flex flex-col"
    >
      <div className="flex-1">{children}</div>
      <footer
        className="print:hidden border-t px-4 pt-6 text-center"
        style={{
          borderColor: 'var(--shop-border, rgba(0,0,0,.08))',
          background: 'var(--shop-surface, transparent)',
          color: 'var(--shop-muted, inherit)',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
      >
        <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px]">
          <a href="/legal/terms" className="underline underline-offset-2 hover:opacity-80" style={{ color: 'var(--shop-ink, inherit)' }}>
            Terms of use
          </a>
          <a href="/legal/privacy" className="underline underline-offset-2 hover:opacity-80" style={{ color: 'var(--shop-ink, inherit)' }}>
            Privacy policy
          </a>
        </nav>
        <p className="text-[11px] mt-3 max-w-md mx-auto leading-relaxed">
          This shop uses only essential cookies — the ones that keep your cart
          and sign-in working. Nothing tracks you across the web.
        </p>
        {shopName ? (
          <p className="text-[11px] mt-2 opacity-80">
            &copy; {new Date().getFullYear()} {shopName}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
