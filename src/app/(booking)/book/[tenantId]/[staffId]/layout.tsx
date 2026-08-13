import type { Metadata } from 'next';
import React from 'react';

import { clip, seoDescription, staffBookingJsonLd } from '@/lib/shop-seo';

// ─── /(booking)/book/[tenantId]/[staffId]/layout.tsx ─────────────────────────
// People search for a PERSON far more than a salon expects — "book with
// Kayla", "Kayla nails Burlington" — and this page has been answering with the
// same anonymous title as every other booking link on the platform.
//
// A staff member's page is also the link they share themselves, on their own
// profile, to their own following. It should carry their name.
//
// Modelled as a Person who works for the business, with their own booking
// action, so "can I book with Kayla on Friday" has somewhere to point.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-staff-seo';
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

async function load(tenantId: string, staffId: string) {
  try {
    const db = getAdminDb();
    const [tSnap, sSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).get(),
      db.collection(`tenants/${tenantId}/staff`).doc(staffId).get(),
    ]);
    const t: any = tSnap.exists ? tSnap.data() : {};
    const st: any = sSnap.exists ? sSnap.data() : null;
    return {
      shopName: String(t?.businessName || t?.name || '').trim(),
      staffName: String(st?.name || st?.displayName || '').trim(),
      role: String(st?.role || st?.title || '').trim(),
      bio: String(st?.bio || st?.about || '').trim(),
      imageUrl: String(st?.photoUrl || st?.avatarUrl || st?.imageUrl || '').trim(),
      // Someone who has left, or was never public, must not have a page
      // advertised on their behalf.
      bookable: !!st && st.isActive !== false && st.showOnBooking !== false,
    };
  } catch {
    return { shopName: '', staffName: '', role: '', bio: '', imageUrl: '', bookable: false };
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ tenantId: string; staffId: string }> },
): Promise<Metadata> {
  const { tenantId, staffId } = await params;
  const ctx = await load(tenantId, staffId);
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const url = origin ? `${origin}/book/${tenantId}/${staffId}` : undefined;

  if (!ctx.staffName) {
    return { title: ctx.shopName ? `Book online \u00b7 ${ctx.shopName}` : 'Book an appointment' };
  }

  const title = clip(
    ctx.shopName ? `Book with ${ctx.staffName} \u00b7 ${ctx.shopName}` : `Book with ${ctx.staffName}`,
    60,
  );
  const description = seoDescription({
    shopName: ctx.shopName,
    description: ctx.bio
      || `See ${ctx.staffName}'s availability at ${ctx.shopName || 'the studio'} and book a time that suits you.`,
  });

  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    // A staff member who isn't taking bookings shouldn't be found by someone
    // trying to book them.
    robots: ctx.bookable ? undefined : { index: false, follow: true },
    openGraph: {
      type: 'profile',
      title,
      description,
      ...(url ? { url } : {}),
      ...(ctx.shopName ? { siteName: ctx.shopName } : {}),
      ...(ctx.imageUrl ? { images: [ctx.imageUrl] } : {}),
    },
    twitter: {
      card: ctx.imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  };
}

export default async function StaffBookingSeoLayout({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string; staffId: string }>;
}) {
  const { tenantId, staffId } = await params;
  const ctx = await load(tenantId, staffId);
  if (!ctx.staffName || !ctx.bookable) return <>{children}</>;

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const ld = staffBookingJsonLd({
    shopName: ctx.shopName,
    staffName: ctx.staffName,
    role: ctx.role,
    imageUrl: ctx.imageUrl,
    url: origin ? `${origin}/book/${tenantId}/${staffId}` : undefined,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      {children}
    </>
  );
}
