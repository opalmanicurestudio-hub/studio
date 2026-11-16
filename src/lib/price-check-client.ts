// src/lib/price-check-client.ts — AFTER A DELIVERY IS PUT AWAY ON A STOCK SCREEN (a quick receive, an order received
// on the Inventory page): asks the server whether it came in at another price than last time, so the managers hear
// about any dish it pushed over the aim (api/food-cost 'moved', lib/price-creep-server). Never waited on, never says
// anything here: the delivery is in either way, and Food cost shows the move.
import { getAuth } from 'firebase/auth';

export function checkPrices(tenantId: string | null | undefined, itemIds: string[]): void {
  if (!tenantId || !itemIds.length) return;
  void (async () => {
    try {
      const tk = await getAuth().currentUser?.getIdToken(); if (!tk) return;
      await fetch('/api/food-cost', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ tenantId, action: 'moved', itemIds: Array.from(new Set(itemIds)).slice(0, 50) }) });
    } catch { /* the delivery is in; Food cost still shows the move */ }
  })();
}
