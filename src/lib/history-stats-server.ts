// src/lib/history-stats-server.ts — works out (and keeps for a few hours) the all-time numbers in lib/history-stats.
// Stored in tenants/{t}/historyStats: "meta" plus chunks of client rows, so no single record grows past its limit.
import { computeHistory, type ClientHist, type ServiceHist } from '@/lib/history-stats';

const FRESH_MS = 3 * 3600 * 1000;
const CHUNK = 1000;

export interface HistoryAnswer { computedAt: number; clients: Record<string, ClientHist>; services: Record<string, ServiceHist> }

async function compute(db: any, tenantId: string): Promise<HistoryAnswer> {
  const T = `tenants/${tenantId}`;
  const [ap, tx, sv] = await Promise.all([
    db.collection(`${T}/appointments`).select('startTime', 'clientId', 'status', 'serviceId', 'staffId', 'revenue', 'isRenterBooking').get(),
    db.collection(`${T}/transactions`).where('type', '==', 'income').select('type', 'amount', 'amountCents', 'category', 'appointmentId', 'clientId', 'tipAmount').get(),
    db.collection(`${T}/services`).select('price').get(),
  ]);
  const rows = (s: any) => s.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }));
  const h = computeHistory(rows(ap), rows(tx), rows(sv), Date.now(), true);
  // Keep it: meta + chunks.
  const ids = Object.keys(h.clients); const chunks = Math.max(1, Math.ceil(ids.length / CHUNK));
  const batch = db.batch(); const base = db.collection(`${T}/historyStats`);
  for (let i = 0; i < chunks; i++) batch.set(base.doc(`clients-${i}`), { rows: Object.fromEntries(ids.slice(i * CHUNK, (i + 1) * CHUNK).map((id) => [id, h.clients[id]])) });
  batch.set(base.doc('meta'), { computedAt: h.computedAt, chunks, services: h.services });
  await batch.commit();
  return h;
}

/** The numbers, worked out at most every few hours. `force` works them out now. */
export async function historyFor(db: any, tenantId: string, force = false): Promise<HistoryAnswer> {
  const base = db.collection(`tenants/${tenantId}/historyStats`);
  const meta: any = (await base.doc('meta').get()).data();
  if (!force && meta && Date.now() - Number(meta.computedAt || 0) < FRESH_MS) {
    const parts = await Promise.all(Array.from({ length: Number(meta.chunks) || 0 }, (_, i) => base.doc(`clients-${i}`).get()));
    const clients: Record<string, ClientHist> = {}; for (const p of parts) Object.assign(clients, (p.data() || {}).rows || {});
    return { computedAt: Number(meta.computedAt), clients, services: meta.services || {} };
  }
  return compute(db, tenantId);
}

/** Without money, for people who may not see it. */
export function withoutMoney(h: HistoryAnswer): HistoryAnswer {
  const clients: Record<string, ClientHist> = {};
  for (const [id, c] of Object.entries(h.clients)) { const { sr, rr, tp, ...rest } = c; void sr; void rr; void tp; clients[id] = rest; }
  const services: Record<string, ServiceHist> = {};
  for (const [id, s] of Object.entries(h.services)) services[id] = { ...s, rv: 0, tx: 0 };
  return { ...h, clients, services };
}
