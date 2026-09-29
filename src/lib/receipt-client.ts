'use client';
// src/lib/receipt-client.ts — open / send a receipt or void slip (the page is built from what the server recorded).
import { getAuth } from 'firebase/auth';
export async function receiptCall(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
/** Opens the printable page in a new tab (the tab opens first, so pop-up blockers allow it). */
export async function openReceipt(tenantId: string, receiptId: string) {
  const w = window.open('', '_blank'); const r: any = await receiptCall({ tenantId, receiptId, action: 'link' });
  if (r?.ok && w) w.location.href = r.url; else w?.close();
}
