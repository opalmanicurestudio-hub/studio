// src/app/api/public/menu/route.ts — THE LIVE MENU for embeds: the business's bookable services, grouped by category in
// menu order, with prices, lengths and "from" flags — exactly what the booking page shows, so a website menu never goes
// stale. Public, read-only, cached a few minutes, allowed from any site (it's the same data as the booking page).
//   GET /api/public/menu?business=<tenantId>[&categories=Manicures,Pedicures]
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
export const dynamic = 'force-dynamic';
const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } }); }
export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('business') || '').slice(0, 80); if (!tenantId) return NextResponse.json({ ok: false, error: 'Which business?' }, { status: 400, headers: H });
  const only = String(req.nextUrl.searchParams.get('categories') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const db = getAdminDb(); const t: any = (await db.doc(`tenants/${tenantId}`).get()).data(); if (!t) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404, headers: H });
  const rows = (await db.collection(`tenants/${tenantId}/services`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((s: any) => s.status !== 'archived' && s.isActive !== false && !s.isPrivate && s.type !== 'addon' && !s.isAddon)
    .sort((a: any, b: any) => (Number.isFinite(a.menuOrder) ? a.menuOrder : 1e9) - (Number.isFinite(b.menuOrder) ? b.menuOrder : 1e9) || String(a.name).localeCompare(String(b.name)));
  const m = new Map<string, any[]>();
  for (const s of rows) { const cat = String(s.category || 'Services'); if (only.length && !only.includes(cat.toLowerCase())) continue;
    m.set(cat, [...(m.get(cat) || []), { id: s.id, name: s.name, price: Number(s.price) || 0, from: !!(s.priceIsFrom || (s.serviceTiers || []).length), duration: Number(s.duration) || null, description: s.description ? String(s.description).slice(0, 240) : null, imageUrl: s.imageUrl || null, membersOnly: !!s.membersOnly }]); }
  const cfg: any = t.bookingPageSettings?.cfPageConfig || {};
  // Rentable spaces on offer (kind 'space', day use on, not hidden), with their hourly / daily rates.
  const spaces = only.length && !only.includes('spaces') ? [] : (await db.collection(`tenants/${tenantId}/booths`).where('kind', '==', 'space').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((b: any) => b.isActive !== false && b.dayUseEnabled && b.listed !== false && b.status !== 'maintenance')
    .map((b: any) => { const rate = (f: string) => { const o = (b.pricingOptions || []).find((x: any) => x.frequency === f && x.amountCents > 0); return o ? o.amountCents / 100 : null; };
      return { id: b.id, name: b.name, hourly: rate('hourly'), daily: rate('daily'), description: b.description ? String(b.description).slice(0, 200) : null, imageUrl: (b.photoUrls || [])[0] || b.photoUrl || null }; });
  return NextResponse.json({ ok: true, business: { name: t.name || 'Studio', accent: cfg.accentColor || t.brandColor || '#1c1917', logoUrl: cfg.logoUrl || t.logoUrl || null },
    bookBase: `${linkOrigin(t, req.nextUrl.origin)}/book/${encodeURIComponent(tenantId)}`, spaces, categories: [...m.entries()].map(([name, services]) => ({ name, services })) }, { headers: H });
}
