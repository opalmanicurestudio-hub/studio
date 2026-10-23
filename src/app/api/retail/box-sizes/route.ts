// src/app/api/retail/box-sizes/route.ts — THE SHOP'S BOX SIZES (retailSettings.packagingPresets): the boxes a packer
// chooses from, and what each label is bought for (lib/ship-run). Managers add, change and remove them; at most eight.
// POST { tenantId, action: 'save', preset: { id?, name, lengthIn, widthIn, heightIn, weightOz } } or
//      { tenantId, action: 'remove', id }.
// A box already chosen on an order keeps its size (orders carry their own copy), so changing one never moves a label.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { presetsOf, type Preset } from '@/lib/ship-run';
import { MAX_BOX_SIZES, cleanPreset } from '@/lib/box-sizes';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const action = String(b.action || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Please sign in to continue.', auth.status || 401);
  if (!auth.actor.isManager) return bad('Managers set the box sizes.', 403);
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}`);
  const out = await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(ref)).data() || {};
    const list = presetsOf(t.retailSettings || {});
    let next = list;
    if (action === 'remove') {
      const id = String(b.id || '');
      if (!list.some((p) => p.id === id)) return { error: 'That box size wasn’t found.', status: 404 };
      next = list.filter((p) => p.id !== id);
    } else if (action === 'save') {
      const { preset, error } = cleanPreset(b.preset);
      if (error) return { error, status: 400 };
      const at = preset.id ? list.findIndex((p) => p.id === preset.id) : -1;
      if (at < 0 && list.length >= MAX_BOX_SIZES) return { error: `A shop keeps up to ${MAX_BOX_SIZES} box sizes. Remove one first.`, status: 409 };
      if (list.some((p, i) => i !== at && p.name.toLowerCase() === preset.name.toLowerCase())) return { error: `There’s already a box called ${preset.name}.`, status: 409 };
      const full: Preset = { ...preset, id: at >= 0 ? list[at].id : `box_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` } as Preset;
      next = at >= 0 ? list.map((p, i) => (i === at ? full : p)) : [...list, full];
    } else return { error: 'Unknown action.', status: 400 };
    tx.set(ref, { retailSettings: { packagingPresets: next } }, { merge: true });
    return { presets: next };
  });
  if ((out as any).error) return bad((out as any).error, (out as any).status || 400);
  return NextResponse.json({ ok: true, presets: (out as any).presets, message: action === 'remove' ? 'Box size removed.' : 'Box size saved.' });
}
