// src/lib/expiry-alerts.ts — STOCK THAT'S ABOUT TO EXPIRE. Once a night, any batch with stock left that expires within
// 30 days gets one alert ("use or discount it"), and one more the day it expires (it then stops selling online on its
// own). Each alert is written once, keyed to the batch, so it never repeats.
import { batchExpiry } from './retail-orders';

const DAY = 86400e3;

export async function alertExpiringStock(db: any, t: string, now = Date.now()): Promise<number> {
  const snap = await db.collection(`tenants/${t}/inventory`).get();
  let n = 0;
  for (const d of snap.docs) {
    const it: any = d.data() || {}; if (it.status === 'archived') continue;
    for (const b of (Array.isArray(it.batches) ? it.batches : [])) {
      const stock = Number(b.stock) || 0; const exp = batchExpiry(b); if (stock <= 0 || !Number.isFinite(exp)) continue;
      const days = Math.ceil((exp - now) / DAY);
      const kind = days <= 0 ? 'expd' : days <= 30 ? 'exp' : ''; if (!kind) continue;
      const id = `${kind}-${d.id}-${String(b.id || '').replace(/[^\w-]/g, '')}`.slice(0, 140);
      const lot = b.lot ? ` (lot ${b.lot})` : '';
      try {
        await db.doc(`tenants/${t}/notifications/${id}`).create({ id, type: 'stock_expiry', read: false, createdAt: new Date(now).toISOString(), link: `/inventory/product/${d.id}`,
          message: kind === 'expd' ? `${stock} × ${it.name}${lot} expired today. It no longer sells online.` : `${stock} × ${it.name}${lot} expires in ${days} day${days === 1 ? '' : 's'}. Use it or put it on offer.` });
        n++;
      } catch { /* already told */ }
    }
  }
  return n;
}
