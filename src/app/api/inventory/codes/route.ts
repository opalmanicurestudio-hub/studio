// /api/inventory/codes — A PRODUCT'S CODES AND VARIANTS (lib/code-index). Every screen that gives a product a code
// sends it here, so a code is only ever on one product, and every screen that gives a listing its variants, so a
// variant is only ever in one listing. Anyone on the team, as for the rest of a product.
//   { action: 'set',   tenantId, productId, codes, create? } → its SKU, barcodes, case and pallet codes (only the fields
//                                                           sent); `create`: the rest of a new product, added with them
//   { action: 'learn', tenantId, productId, code }        → a code it was scanned with, added to it
//   { action: 'tag',   tenantId, productId, tag, remove? } → an RFID or NFC tag paired to it (or taken off)
//   { action: 'keep',  tenantId, code, productId }        → a code on more than one product stays on this one only
//   { action: 'reindex', tenantId, productIds }            → products brought back from the archive hold their codes again
//   { action: 'check', tenantId }                          → the codes and listings check, with the index brought up to date
//   { action: 'variants', tenantId, productId, optionGroups, was? } → a listing's choices, each variant pointed at it (refused
//                                                           with why: a product another listing sells, say)
//   { action: 'addVariant', tenantId, productId, variant: { label, barcode?, sku?, price?, stock?, group? } }
//                                                         → a new product, added to the listing's variants
// Booth renters run their own business and can't change the shop's products. Tags are paired one at a time ('tag'),
// so a tag a kit or a linen bundle has is never given to a product.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { moduleEnabled } from '@/lib/modules';
import { addVariant, codesCheck, ensureCodeIndex, keepCodeOn, learnCode, pairTag, reindexProducts, saveListingChoices, setProductCodes } from '@/lib/code-index';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b?.tenantId || '');
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return NextResponse.json({ ok: false, error: 'Only the business’s own team can change its products.' }, { status: 403 });
  const db = getAdminDb(); const by = String(g.actor?.name || 'Team').slice(0, 80);
  const productId = String(b.productId || '');
  const action = String(b.action || '');
  try {
    if (action === 'check') {
      const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      return NextResponse.json({ ok: true, shop: moduleEnabled(tenant, 'retail'), ...(await codesCheck(db, tenantId, { by })) });
    }
    if (action === 'reindex') {
      const ids = (Array.isArray(b.productIds) ? b.productIds : []).map(String).filter(Boolean).slice(0, 100);
      if (!ids.length) return NextResponse.json({ ok: false, error: 'Which products?' }, { status: 400 });
      await ensureCodeIndex(db, tenantId);
      return NextResponse.json({ ok: true, products: await reindexProducts(db, tenantId, ids, by) });
    }
    if (!['set', 'learn', 'tag', 'keep', 'variants', 'addVariant'].includes(action)) return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    if (!productId) return NextResponse.json({ ok: false, error: 'Which product?' }, { status: 400 });
    await ensureCodeIndex(db, tenantId);
    if (action === 'addVariant') {
      const r = await addVariant(db, tenantId, productId, b.variant, by);
      return r.ok ? NextResponse.json({ ok: true, productId: r.productId, optionGroups: r.groups }) : NextResponse.json({ ok: false, error: r.error, clashes: r.clashes || [] }, { status: r.status });
    }
    if (action === 'variants') {
      const r = await saveListingChoices(db, tenantId, productId, b.optionGroups, by, Array.isArray(b.was) ? b.was : undefined);
      return r.ok ? NextResponse.json({ ok: true, optionGroups: r.groups }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    }
    if (action === 'set') {
      const codes: any = b.codes && typeof b.codes === 'object' && !Array.isArray(b.codes) ? { ...b.codes } : {};
      delete codes.tagIds;   // tags are paired one at a time, with the kit and bundle check
      const r = await setProductCodes(db, tenantId, productId, codes, { by, ...(b.create !== undefined ? { create: b.create } : {}) });
      return r.ok ? NextResponse.json({ ok: true, codes: r.codes }) : NextResponse.json({ ok: false, error: r.error, clashes: r.clashes || [] }, { status: r.status });
    }
    if (action === 'learn') {
      const r = await learnCode(db, tenantId, productId, String(b.code ?? ''), by);
      return NextResponse.json({ ok: r.ok, message: r.message, ...(r.ok ? {} : { error: r.message }) }, { status: r.ok ? 200 : r.status || 400 });
    }
    if (action === 'tag') {
      const r = await pairTag(db, tenantId, productId, String(b.tag ?? ''), by, b.remove === true);
      return NextResponse.json({ ok: r.ok, message: r.message, ...(r.ok ? {} : { error: r.message }) }, { status: r.ok ? 200 : r.status || 400 });
    }
    const r = await keepCodeOn(db, tenantId, String(b.code ?? ''), productId, by);
    return r.ok ? NextResponse.json({ ok: true, removedFrom: r.removedFrom || [] }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status || 400 });
  } catch (e: any) {
    console.error('[inventory/codes]', action, e?.message || e);
    return NextResponse.json({ ok: false, error: action === 'check' ? 'The check didn’t finish. Try again.' : 'That didn’t save. Try again.' }, { status: 500 });
  }
}
