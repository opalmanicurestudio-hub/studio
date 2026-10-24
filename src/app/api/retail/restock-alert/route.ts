// src/app/api/retail/restock-alert/route.ts — A CUSTOMER ASKS TO BE TOLD WHEN A SOLD-OUT PRODUCT IS BACK. Public.
// One request per email per product (or per variant of a listing, `choiceId`); it's closed after the one email goes
// (lib/restock-alerts).
// POST { tenantId, productId, choiceId?, email }
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { isStorefrontVisible } from '@/lib/retail-orders';
import { variantGroup, pickedBy } from '@/lib/variants';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const productId = String(b.productId || '').trim();
  const choiceId = String(b.choiceId || '').trim();
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[\w-]{1,80}$/.test(tenantId) || !/^[\w-]{1,120}$/.test(productId) || !/^\S+@\S+\.\S+$/.test(email) || (choiceId && !/^[\w-]{1,40}$/.test(choiceId))) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 });
  const db = getAdminDb();
  const it: any = (await db.doc(`tenants/${tenantId}/inventory/${productId}`).get()).data();
  if (!it || !isStorefrontVisible(it)) return NextResponse.json({ error: 'That item isn’t in the shop.' }, { status: 404 });
  // A variant of the listing: the alert watches the variant, and its email opens the listing with it picked.
  let watch = productId; let name = String(it.name || '');
  if (choiceId) {
    const g = variantGroup({ ...it, id: productId }); const c = g?.choices.find((x: any) => x.id === choiceId);
    const vid = c ? pickedBy({ ...it, id: productId }, c) : '';
    if (!vid) return NextResponse.json({ error: 'That choice isn’t offered any more.' }, { status: 404 });
    watch = vid; name = `${name} · ${c!.label}`;
  }
  const id = `${watch}_${createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
  const ref = db.doc(`tenants/${tenantId}/restockAlerts/${id}`);
  const existing = await ref.get();
  // A request still waiting is kept (and given the listing, when it was made on the variant's own page before).
  if (!existing.exists || existing.data()?.notifiedAt) await ref.set({ id, productId: watch, productName: name, ...(choiceId ? { listingId: productId, choiceId } : {}), email, createdAt: new Date().toISOString(), notifiedAt: null });
  else if (choiceId && existing.data()?.listingId !== productId) await ref.set({ productName: name, listingId: productId, choiceId }, { merge: true });
  return NextResponse.json({ ok: true, message: `We’ll email you once when ${name || 'it'} is back.` });
}
