// src/app/api/retail/labels-zpl/route.ts — ALL THE RAW LABEL-PRINTER LABELS FROM A RUN IN ONE FILE. Opened from the
// label stack page, so it carries the same short-lived print key instead of a sign-in. Orders in order-number order.
import { NextRequest, NextResponse } from 'next/server';
import { checkPrintKey } from '@/lib/print-key';
import { getAdminDb } from '@/lib/firebase-admin';
import { isZplLabel } from '@/lib/label-format';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tenantId = String(p.get('tenantId') || '').trim();
  if (!tenantId || !checkPrintKey(tenantId, 'orders', p.get('k'), p.get('x'))) return new NextResponse('This print link has expired. Go back to Orders and print again.', { status: 403 });
  const ids = String(p.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => s && !s.includes('/')).slice(0, 60);
  const db = getAdminDb();
  const snaps = await Promise.all(ids.map((id) => db.collection(`tenants/${tenantId}/retailOrders`).doc(id).get()));
  const orders = snaps.filter((s: any) => s.exists).map((s: any) => s.data() as any)
    .filter((o: any) => isZplLabel(o.labelUrl) && /^https:\/\//.test(String(o.labelUrl)))
    .sort((a: any, b: any) => (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));
  const parts: string[] = [];
  for (const o of orders) {
    const urls = [String(o.labelUrl), ...((Array.isArray(o.extraLabelUrls) ? o.extraLabelUrls : []) as string[]).filter((u) => isZplLabel(u) && /^https:\/\//.test(u))];
    for (const u of urls) {
      try { const r = await fetch(u); if (r.ok) parts.push((await r.text()).trim()); } catch { /* a missing label is listed on the stack page */ }
    }
  }
  if (!parts.length) return new NextResponse('No label-printer labels found on these orders.', { status: 404 });
  return new NextResponse(parts.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="labels-${new Date().toISOString().slice(0, 10)}.zpl"`, 'Cache-Control': 'no-store' } });
}
