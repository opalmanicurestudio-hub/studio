// /api/retail/gift-library — THE LIBRARY OF SOMEONE GIVEN A DOWNLOAD (lib/digital-gift). The buyer's order page is
// theirs; the person the gift was for sees only what they were given: the items, the buyer's first name and message,
// and their access. Proof it's them is the link in their gift email (once sent) or a 6-digit code to their email,
// which gives this device a gift pass for 30 days. Nothing about the buyer's payment or details is here.
//   POST { tenantId, orderId, g: <the gift link's token> }   or   { tenantId, orderId, p: <a gift pass> }
// A POST, so the token is never in an address that request logs keep.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkPass, makePass } from '@/lib/order-pass';
import { giftPassKey } from '@/lib/digital-gift';
import { digitalLineAccess } from '@/lib/digital-access-rule';
import { entitlementId, publicEntitlement } from '@/lib/entitlements';
import { deviceCap } from '@/lib/device-limit';
import { deliveryOf, filesOf, viewable } from '@/lib/digital-product';
import { maskEmail } from '@/lib/contact-change';
import { timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const q = { get: (k: string) => (typeof b?.[k] === 'string' ? String(b[k]) : '') };
  const tenantId = String(q.get('tenantId') || '').trim(); const orderId = String(q.get('orderId') || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb();
  const [oSnap, tSnap] = await Promise.all([db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const o: any = oSnap.exists ? oSnap.data() : null;
  const g = o?.digitalGift;
  if (!o || !g || !g.sentAt || !o.qrToken) return NextResponse.json({ error: 'This gift isn’t ready to open yet.' }, { status: 404 });
  const t: any = tSnap.exists ? tSnap.data() : {};
  const key = giftPassKey(String(o.qrToken));
  const fromLink = same(String(q.get('g') || ''), String(g.token || ''));
  const passOk = fromLink || checkPass(tenantId, key, q.get('p'));
  const base = { shopName: String(t.businessName || t.name || ''), toName: String(g.toName || ''), from: String(o.customerName || '').split(' ')[0] || 'Someone', verify: { passOk, emailMasked: maskEmail(String(g.toEmail || '')) } };
  if (!passOk) return NextResponse.json(base);

  const lines = (o.lines || []).filter((l: any) => l?.digital === true);
  const ents: Record<string, any> = {}; const items: Record<string, any> = {};
  try {
    if (lines.length) {
      const es = await db.getAll(...lines.map((l: any) => db.doc(`tenants/${tenantId}/entitlements/${entitlementId(orderId, l.lineId || l.productId)}`)));
      es.forEach((s: any, i: number) => { if (s.exists) ents[String(lines[i].lineId || lines[i].productId)] = s.data(); });
      const ids = [...new Set(lines.map((l: any) => String(l.productId || '')).filter(Boolean))] as string[];
      const is = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)));
      is.forEach((s: any, i: number) => { if (s.exists) items[ids[i]] = s.data(); });
      // A variant sold inside its listing opens as its listing's download unless it has its own (lib/variants asSold).
      const parents = [...new Set(Object.values(items).filter((it: any) => it.parentId && it.digital !== true).map((it: any) => String(it.parentId)))];
      if (parents.length) {
        const { asSold } = await import('@/lib/variants');
        const ps = await db.getAll(...parents.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)));
        const pm: Record<string, any> = {}; ps.forEach((sn: any, i: number) => { if (sn.exists) pm[parents[i]] = { id: parents[i], ...sn.data() }; });
        for (const [k, it] of Object.entries(items)) if ((it as any).parentId && (it as any).digital !== true && pm[String((it as any).parentId)]) items[k] = asSold(pm[String((it as any).parentId)], { id: k, ...(it as any) });
      }
    }
  } catch { /* the items still list; opening reads them again */ }
  const now = Date.now();
  return NextResponse.json({
    ...base,
    message: String(g.message || ''),
    newPass: fromLink ? makePass(tenantId, key) : null,
    lines: lines.map((l: any) => {
      const k = String(l.lineId || l.productId); const it = items[String(l.productId)];
      const a = digitalLineAccess(o, l, now, ents[k] || null);
      const files = it ? filesOf(it) : [];
      return {
        lineId: l.lineId || '', productId: l.productId, name: l.name, digital: true,
        access: { open: a.open, reason: a.reason, endsAt: a.endsAt },
        entitlement: publicEntitlement(ents[k] || null, it ? deviceCap(t, it, ents[k] || null) : null),
        contents: it ? { files: files.filter((f) => deliveryOf(it) !== 'view' || viewable(f.name)).map((f) => ({ id: f.id, name: f.name, inPage: viewable(f.name) && deliveryOf(it) !== 'download', size: f.size || 0 })), link: !!String(it.digitalUrl || l.digitalUrl || '').trim(), delivery: deliveryOf(it) } : null,
      };
    }),
  });
}
