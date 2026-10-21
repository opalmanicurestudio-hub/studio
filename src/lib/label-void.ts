// src/lib/label-void.ts — VOID AN ORDER'S LABELS, every box's, so the postage comes back. Server only. Used when the
// address changes after the label was bought, and by the label route's own "void" action. An order shipped in several
// boxes has one label per box; they were bought together on one rate, so they're found through that rate.
import { reversePostage } from '@/lib/postage';

const SHIPPO = 'https://api.goshippo.com';

/** What an order looks like once its labels are voided: no label, no tracking, nothing checked at the bench. */
export const LABEL_CLEARED = {
  trackingNumber: '', carrier: '', trackingUrl: '', labelUrl: '', shippoTransactionId: '',
  extraLabelUrls: [] as string[], extraTrackingNumbers: [] as string[], extraTrackingUrls: [] as string[], labelsChecked: [] as string[], labelCheckedAt: null,
};

export async function voidOrderLabels(db: any, tenantId: string, order: any, apiKey: string): Promise<{ ok: boolean; error?: string; status?: string; count: number }> {
  const master = String(order?.shippoTransactionId || '').trim();
  if (!master) return { ok: true, count: 0 };
  if (!apiKey) return { ok: false, error: 'Shippo isn’t connected, so the label can’t be voided here.', count: 0 };
  const auth = { Authorization: `ShippoToken ${apiKey}` };
  const ids = [master];
  if (Array.isArray(order?.extraLabelUrls) && order.extraLabelUrls.length) {
    try {
      const t: any = await fetch(`${SHIPPO}/transactions/${encodeURIComponent(master)}`, { headers: auth }).then((r) => r.json());
      const rate = typeof t?.rate === 'string' ? t.rate : t?.rate?.object_id;
      if (rate) {
        const list: any = await fetch(`${SHIPPO}/transactions/?rate=${encodeURIComponent(rate)}&results=25`, { headers: auth }).then((r) => r.json());
        for (const x of list?.results || []) if (x?.status === 'SUCCESS' && x.object_id && !ids.includes(x.object_id)) ids.push(String(x.object_id));
      }
    } catch { /* the first box's label is voided regardless */ }
  }
  let status = '';
  for (const id of ids) {
    const r = await fetch(`${SHIPPO}/refunds/`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: id, async: false }) }).catch(() => null);
    const d: any = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) {
      if (id === master) return { ok: false, error: `The label couldn’t be voided${d?.detail ? `: ${String(d.detail).slice(0, 160)}` : '. Try again in a minute.'}`, count: 0 };
      continue;
    }
    if (id === master) status = String(d.status || 'PENDING');
  }
  await reversePostage(db, tenantId, master).catch(() => {});
  return { ok: true, status, count: ids.length };
}
