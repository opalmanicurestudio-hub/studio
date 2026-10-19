// src/lib/order-slip-server.ts — everything a print page needs to draw the smart slip for one order: the model
// (lib/order-slip), the products' care notes and batches, the shop name, and the two codes (the order page, and for
// gifts the gift exchange page, which never shows the sender's details or prices).
import QRCode from 'qrcode';
import { buildSlip, slipSettingsOf, type SlipModel, type SlipSize } from './order-slip';

export async function slipFor(db: any, tenantId: string, orderId: string, order: any, tenant: any, origin: string, size?: SlipSize): Promise<{ model: SlipModel; size: SlipSize; shopName: string; qr: string; giftQr: string }> {
  const rs = tenant?.retailSettings || {};
  const ids = [...new Set(((order?.lines || []) as any[]).map((l) => String(l.productId || '')).filter((x) => x && !x.includes('/')))].slice(0, 60);
  const products: Record<string, any> = {};
  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => db.collection(`tenants/${tenantId}/inventory`).doc(id))).catch(() => []);
    snaps.forEach((s: any) => { if (s.exists) { const d = s.data() || {}; products[s.id] = { name: d.name, careNote: d.careNote, batches: d.batches }; } });
  }
  const model = buildSlip(order, rs, products);
  const orderUrl = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';
  const giftUrl = origin && order?.gift?.token ? `${origin}/shop/${tenantId}/gift/${orderId}?g=${encodeURIComponent(order.gift.token)}` : '';
  const qr = orderUrl ? await QRCode.toDataURL(orderUrl, { width: 300, margin: 0 }).catch(() => '') : '';
  const giftQr = giftUrl ? await QRCode.toDataURL(giftUrl, { width: 300, margin: 0 }).catch(() => '') : '';
  return { model, size: size || slipSettingsOf(rs).size, shopName: String(tenant?.businessName || tenant?.name || ''), qr, giftQr };
}
