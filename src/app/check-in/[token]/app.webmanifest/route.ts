// src/app/check-in/[token]/app.webmanifest/route.ts — the client's visit link as a Home Screen app: saving the page
// opens THEIR visit page (not the business's main app), named for the business.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: any) {
  const { token } = await ctx.params; const id = String(token || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  let name = 'Your appointment';
  try {
    const db = getAdminDb(); const copy: any = id ? (await db.doc(`appointmentCheckIns/${id}`).get()).data() : null;
    if (copy?.tenantId) { const t: any = (await db.doc(`tenants/${String(copy.tenantId)}`).get()).data(); if (t?.name) name = String(t.name); }
  } catch { /* default name */ }
  const start = `/check-in/${id}`;
  return NextResponse.json({
    name, short_name: name.length > 12 ? 'Appointment' : name, id: start, start_url: start, scope: '/check-in/',   // the whole visit area, so it can move on to their next appointment display: 'standalone',
    background_color: '#faf8f5', theme_color: '#faf8f5',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, max-age=3600' } });
}
