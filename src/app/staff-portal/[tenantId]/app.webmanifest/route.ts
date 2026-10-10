// src/app/staff-portal/[tenantId]/app.webmanifest/route.ts — the staff portal's Home Screen manifest: named for the
// business, opens on its portal, white while it starts.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: any) {
  const { tenantId } = await ctx.params; const id = String(tenantId || '').slice(0, 80);
  let name = 'Team';
  try { const t: any = (await getAdminDb().doc(`tenants/${id}`).get()).data(); if (t?.name) name = String(t.name); } catch { /* default name */ }
  const start = `/staff-portal/${id}`;
  return NextResponse.json({
    name: `${name} · Team`, short_name: name.length > 12 ? 'Team' : name, id: start, start_url: start, scope: start, display: 'standalone',
    background_color: '#ffffff', theme_color: '#ffffff',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
}
