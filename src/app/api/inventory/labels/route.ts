// /api/inventory/labels — PRODUCT LABELS AS A PDF (lib/labels-pdf), worked out from the products as they're saved:
// each label's name, price and codes the same way the labels page previews them (lib/product-labels), so the PDF is
// the preview. Anyone on the business's own team.
//   POST { tenantId, size: 'sheet' | 'roll', skip?, show?: { name, price, barcode, qr }, design?: boolean,
//          rows: [{ productId, qty }] }  → application/pdf
// `design`: a product with its own label design (its label image, uploaded to the app) prints that instead.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { ensureCodeIndex } from '@/lib/code-index';
import { variantIdsOf } from '@/lib/variants';
import { MAX_LABELS, SHOW_ALL, designUrlOk, labelContent, type LabelShow } from '@/lib/product-labels';
import { labelsPdf, type PdfLabel } from '@/lib/labels-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const safeId = (v: any) => { const s = String(v ?? ''); return s && s.length <= 160 && !s.includes('/') && s !== '.' && s !== '..' && !/^__.*__$/.test(s) ? s : ''; };
// Label designs are fetched only from the app's own file storage (lib/product-labels designUrlOk), a few at a time,
// none bigger than 4 MB, all of them within 20 seconds.
const MAX_DESIGN = 4_000_000;
async function designOf(url: any, signal: AbortSignal): Promise<PdfLabel['image']> {
  if (!designUrlOk(url)) return null;
  try {
    const r = await fetch(String(url), { signal, redirect: 'error' });
    if (!r.ok || !r.body) return null;
    if (Number(r.headers.get('content-length') || 0) > MAX_DESIGN) { await r.body.cancel().catch(() => {}); return null; }
    const type = String(r.headers.get('content-type') || '').toLowerCase();
    const reader = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length; if (n > MAX_DESIGN) { await reader.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
    const bytes = new Uint8Array(n); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    if (type.includes('png') || (bytes[0] === 0x89 && bytes[1] === 0x50)) return { bytes, type: 'png' };
    if (type.includes('jpeg') || type.includes('jpg') || (bytes[0] === 0xff && bytes[1] === 0xd8)) return { bytes, type: 'jpg' };
    return null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b?.tenantId || '');
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return NextResponse.json({ ok: false, error: 'Only the business’s own team can print its product labels.' }, { status: 403 });
  const size = b.size === 'roll' ? 'roll' : 'sheet';
  const show: LabelShow = { ...SHOW_ALL, ...Object.fromEntries(Object.entries(b.show && typeof b.show === 'object' ? b.show : {}).filter(([k]) => k in SHOW_ALL).map(([k, v]) => [k, v === true])) } as LabelShow;
  const rows: { id: string; qty: number }[] = [];
  for (const r of Array.isArray(b.rows) ? b.rows.slice(0, 300) : []) {
    const id = safeId(r?.productId); const qty = Math.max(0, Math.min(999, Math.floor(Number(r?.qty) || 0)));
    if (id && qty) rows.push({ id, qty });
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: 'Choose at least one label to print.' }, { status: 400 });
  if (rows.reduce((n, r) => n + r.qty, 0) > MAX_LABELS) return NextResponse.json({ ok: false, error: `That’s more than ${MAX_LABELS} labels. Print them in parts.` }, { status: 400 });
  const db = getAdminDb();
  try {
    // Each variant points at its listing (an index built before that is brought up to date first), so a variant's
    // label carries its listing's name and price, as the desk sells it.
    await ensureCodeIndex(db, tenantId);
    const ids = [...new Set(rows.map((r) => r.id))];
    const snaps = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)));
    const items = new Map<string, any>();
    snaps.forEach((s: any, i: number) => { if (s.exists && (s.data() || {}).status !== 'archived') items.set(ids[i], { ...(s.data() || {}), id: ids[i] }); });
    const pids = [...new Set([...items.values()].map((it) => safeId(it.parentId)).filter(Boolean))];
    const parents = new Map<string, any>();
    if (pids.length) (await db.getAll(...pids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)))).forEach((s: any, i: number) => { if (s.exists) parents.set(pids[i], { ...(s.data() || {}), id: pids[i] }); });
    const listings = new Map<string, any>();
    for (const it of items.values()) { const l = parents.get(safeId(it.parentId)); if (l && variantIdsOf(l).includes(it.id)) listings.set(it.id, l); }
    const designs = new Map<string, PdfLabel['image']>();
    if (b.design === true) {
      const want = [...items.values()].filter((it) => designUrlOk(it.labelImageUrl));
      const ctl = new AbortController(); const stop = setTimeout(() => ctl.abort(), 20_000);
      try {
        for (let k = 0; k < want.length; k += 6) {
          const got = await Promise.all(want.slice(k, k + 6).map((it) => designOf(it.labelImageUrl, ctl.signal)));
          got.forEach((img, j) => designs.set(want[k + j].id, img));
        }
      } finally { clearTimeout(stop); }
    }
    const labels: PdfLabel[] = [];
    for (const r of rows) {
      const it = items.get(r.id); if (!it) continue;
      const one: PdfLabel = { content: labelContent(it, listings), image: designs.get(r.id) || null };
      for (let i = 0; i < r.qty; i++) labels.push(one);
    }
    if (!labels.length) return NextResponse.json({ ok: false, error: 'Those products aren’t in Inventory any more.' }, { status: 404 });
    const bytes = await labelsPdf(labels, size, show, Math.floor(Number(b.skip) || 0));
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="product-labels.pdf"', 'Cache-Control': 'no-store', 'X-Label-Count': String(labels.length) } });
  } catch (e: any) {
    console.error('[inventory/labels]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The PDF didn’t finish. Try again.' }, { status: 500 });
  }
}
