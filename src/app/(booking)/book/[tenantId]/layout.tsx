import type { Metadata } from 'next';
import React from 'react';

import { bookingJsonLd, clip, seoDescription, SEO_DESC_MAX } from '@/lib/shop-seo';

// ─── /(booking)/book/[tenantId]/layout.tsx ───────────────────────────────────
// The booking page is the most-shared link a salon owns — it goes in bios, on
// business cards, in every reply to "are you taking clients?" — and until now
// it introduced itself as "Book an Appointment. Book your visit at our
// studio." for every shop on the platform. Anonymous, and identical to every
// competitor also running this software.
//
// Same shape as the product SEO layout: the page itself is a client component
// (it has a live calendar), so the metadata and the structured data live in a
// server layout wrapped around it. Nothing about the page changes.
//
// On the structured data specifically: a local business with an address, a
// phone number, an offer catalog and a booking action is what lets a search
// engine — or an assistant answering out loud — say "yes, they do gel
// manicures, they're on Main Street, here's the link to book." A page with
// none of that can only be read, not used.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-booking-seo';
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

async function loadBookingContext(tenantId: string) {
  try {
    const db = getAdminDb();
    const [tSnap, svcSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).get(),
      db.collection(`tenants/${tenantId}/services`).limit(60).get(),
    ]);
    const t: any = tSnap.exists ? tSnap.data() : {};
    const services = svcSnap.docs
      .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      // Private services are internal arrangements, not an advertised menu.
      .filter((sv: any) => sv?.isPrivate !== true && sv?.type !== 'addon' && sv?.name)
      .map((sv: any) => ({
        name: String(sv.name),
        description: String(sv.description || ''),
        price: Number(sv.price) || 0,
        duration: Number(sv.duration) || 0,
      }));
    return {
      shopName: String(t?.businessName || t?.name || '').trim(),
      tagline: String(t?.retailSettings?.shopTagline || t?.tagline || '').trim(),
      telephone: String(t?.phone || t?.sms?.fromNumber || '').trim(),
      logoUrl: String(t?.logoUrl || t?.retailSettings?.logoUrl || '').trim(),
      address: t?.address && typeof t.address === 'object' ? {
        street: String(t.address.street || t.address.line1 || ''),
        city: String(t.address.city || ''),
        region: String(t.address.state || t.address.region || ''),
        postalCode: String(t.address.postalCode || t.address.zip || ''),
        country: String(t.address.country || 'US'),
      } : null,
      services,
    };
  } catch {
    // Metadata is decoration; never let it stop someone booking.
    return { shopName: '', tagline: '', telephone: '', logoUrl: '', address: null, services: [] };
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Metadata> {
  const { tenantId } = await params;
  const ctx = await loadBookingContext(tenantId);
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const url = origin ? `${origin}/book/${tenantId}` : undefined;

  const shop = ctx.shopName || 'Book an appointment';
  const title = clip(ctx.shopName ? `Book online \u00b7 ${ctx.shopName}` : 'Book an appointment', 60);

  // The description does real work here: it is the sentence a person reads
  // before deciding to tap. Name the services rather than saying "book now".
  const menu = ctx.services.slice(0, 4).map((s) => s.name).join(', ');
  const description = seoDescription({
    shopName: shop,
    description: ctx.tagline
      || (menu ? `Book ${menu} at ${shop}. Pick a time that suits you \u2014 instant confirmation.` : ''),
    seoDescription: '',
  }) || clip(`Book an appointment at ${shop}.`, SEO_DESC_MAX);

  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      title,
      description,
      ...(url ? { url } : {}),
      ...(ctx.shopName ? { siteName: ctx.shopName } : {}),
      ...(ctx.logoUrl ? { images: [ctx.logoUrl] } : {}),
    },
    twitter: {
      card: ctx.logoUrl ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  };
}

export default async function BookingSeoLayout({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const ctx = await loadBookingContext(tenantId);
  if (!ctx.shopName) return <>{children}</>;

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const ld = bookingJsonLd({
    shopName: ctx.shopName,
    url: origin ? `${origin}/book/${tenantId}` : undefined,
    description: ctx.tagline,
    telephone: ctx.telephone,
    address: ctx.address,
    services: ctx.services,
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
