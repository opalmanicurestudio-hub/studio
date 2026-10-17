// src/app/api/retail/restock-alert/route.ts — A CUSTOMER ASKS TO BE TOLD WHEN A SOLD-OUT PRODUCT IS BACK. Public.
// One request per email per product; it's closed after the one email goes (lib/restock-alerts).
// POST { tenantId, productId, email }
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { isStorefrontVisible } from '@/lib/retail-orders';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const productId = String(b.productId || '').trim();
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[\w-]{1,80}$/.test(tenantId) || !/^[\w-]{1,120}$/.test(productId) || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 });
  const db = getAdminDb();
  const it: any = (await db.doc(`tenants/${tenantId}/inventory/${productId}`).get()).data();
  if (!it || !isStorefrontVisible(it)) return NextResponse.json({ error: 'That item isn’t in the shop.' }, { status: 404 });
  const id = `${productId}_${createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
  const ref = db.doc(`tenants/${tenantId}/restockAlerts/${id}`);
  const existing = await ref.get();
  if (!existing.exists || existing.data()?.notifiedAt) await ref.set({ id, productId, productName: String(it.name || ''), email, createdAt: new Date().toISOString(), notifiedAt: null });
  return NextResponse.json({ ok: true, message: `We’ll email you once when ${it.name || 'it'} is back.` });
}
