// src/app/api/retail/pack-photo/route.ts — A PHOTO OF A PACKED BOX, saved by the server. The packer's phone or
// workstation sends the photo (already made a small JPEG, lib/client-image); the server stores it (so the photo
// storage's own rules never stop it) and records it on the order: which box it shows (box 1, box 2, … in the order of
// the boxes' labels), what it shows (open with its contents, sealed, the label on it, damage), and who took it when.
// The order's history gets a line for it. A photo can be taken off the record again (taken by mistake); the history
// keeps both. The shop's team only, not renters.
// POST { tenantId, orderId, dataUrl, box?, kind?, note? }         → { ok, photo, photos }
// POST { tenantId, orderId, action: 'remove', url }               → { ok, photos }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
import { PACK_PHOTO_KINDS, packPhotoLimit, packPhotoPolicy, packPhotosOf, type PackPhoto, type PackPhotoKind } from '@/lib/pack-photo';
import { buildEvent } from '@/lib/retail-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
// Photos are part of how an order went out: not for one that was cancelled.
const CLOSED = ['cancelled'];

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!tenantId || !orderId) return bad('Missing details.');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in to add a photo.', auth.status || 401);
  const a: any = auth.actor;
  if (a.isRenter) return bad('Orders are packed by the shop’s team.', 403);
  const db = getAdminDb();
  const T = `tenants/${tenantId}`;
  const oRef = db.doc(`${T}/retailOrders/${orderId}`);
  const o0 = await oRef.get();
  if (!o0.exists) return bad('That order wasn’t found.', 404);
  const order0: any = o0.data() || {};
  if (CLOSED.includes(String(order0.stage))) return bad('This order was cancelled, so it has no box to photograph.', 409);
  const now = new Date().toISOString();
  const by = String(a.name || 'A team member');

  if (b.action === 'remove') {
    const url = String(b.url || '');
    const photos = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(oRef); const o: any = s.data() || {};
      const list = packPhotosOf(o);
      const gone = list.find((p) => p.url === url);
      if (!gone) return null;
      const left = list.filter((p) => p.url !== url);
      tx.set(oRef, { packPhotos: left, packPhotoUrls: left.map((p) => p.url), ...(left.length ? {} : { packPhotoAt: null, packPhotoBy: null }) }, { merge: true });
      const ev = oRef.collection('events').doc();
      tx.set(ev, { id: ev.id, ...buildEvent('note', String(a.uid), by, { kind: 'pack_photo_removed', box: gone.box, text: `A photo of box ${gone.box} was taken off the order` }) });
      return left;
    });
    if (!photos) return bad('That photo isn’t on this order.', 404);
    return NextResponse.json({ ok: true, photos });
  }

  const kind: PackPhotoKind = (PACK_PHOTO_KINDS as readonly string[]).includes(String(b.kind)) ? b.kind : 'contents';
  const boxes = Math.max(1, Array.isArray(order0.packBoxes) ? order0.packBoxes.length : 1);
  const box = Math.min(Math.max(1, Math.floor(Number(b.box) || 1)), Math.max(boxes, 6));
  const rs = (((await db.doc(T).get()).data() as any) || {}).retailSettings || {};
  const policy = packPhotoPolicy(rs);
  // The shop's limit for each box (a box being photographed counts, saved or not yet).
  const limit = packPhotoLimit({ ...order0, packBoxes: Array.from({ length: Math.max(boxes, box) }) }, policy);
  if (packPhotosOf(order0).length >= limit) return bad(`This order already has ${limit} photos, the most it keeps. Take one off to add another.`, 409);

  const up = await uploadClaimPhotoFromDataUrl(tenantId, orderId, b.dataUrl, 'pack-photos');
  if (!up.url) return bad(up.error === 'Keep photos under 3 MB.' ? 'That photo is too large to send. Take it again.' : up.error || 'The photo couldn’t be saved. Try again.', 422);

  const photo: PackPhoto = { url: up.url, box, kind, at: now, by, byId: String(a.uid || '') || null, note: String(b.note || '').trim().slice(0, 200) || null };
  const photos = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(oRef); const o: any = s.data() || {};
    const list = [...packPhotosOf(o), photo].slice(-limit);
    tx.set(oRef, { packPhotos: list, packPhotoUrls: list.map((p) => p.url), packPhotoAt: now, packPhotoBy: by }, { merge: true });
    const ev = oRef.collection('events').doc();
    tx.set(ev, { id: ev.id, ...buildEvent('note', String(a.uid), by, { kind: 'pack_photo', box, photoKind: kind, text: `Photo of box ${box}${boxes > 1 ? ` of ${boxes}` : ''}: ${kind === 'contents' ? 'open, with what’s inside' : kind}` }) });
    return list;
  });
  return NextResponse.json({ ok: true, photo, photos });
}
