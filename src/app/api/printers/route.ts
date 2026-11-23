// src/app/api/printers/route.ts — THE BUSINESS'S PRINTERS (lib/printing-server; design canvas Printers).
//   list   { tenantId } → each printer, what it prints and how it's doing; a manager also gets the address to put in
//          the printer's own settings (it carries the printer's secret key), and the stations to choose from.
//   save   { tenantId, id?, name, kind, cols, stations, tickets, checks, buzz, receipts, drawer, labels } → add one or
//          change it (a manager). `receipts`: it prints guests' receipts; `drawer`: a cash drawer is plugged into it;
//          `labels`: it prints food orders' bag labels (lib/food-bags).
//   after  { tenantId, after: 'ask' | 'print' | 'none' } → after a sale at the counter or the drive-thru: ask about a
//          receipt, print one, or don't print (text and email are always offered) (a manager).
//   remove { tenantId, id } → taken away; its address stops working within a minute (a manager).
//   rekey  { tenantId, id } → a new address, for one that's been shared too widely; the old one stops within a minute.
//   test   { tenantId, id } → a test page to that printer (a manager).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { linkOrigin } from '@/lib/app-origin';
import { stationsOf } from '@/lib/table-service';
import { tenantTimeZone } from '@/lib/tenant-time';
import { cleanPrinter, MAX_PRINTERS, printsWords, receiptAfterOf, testDoc } from '@/lib/printing';
import { forgetPrinter, newKey, printerFrom, printersOf, printerState, printerUrl, queueJob } from '@/lib/printing-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'list');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['list', 'save', 'remove', 'rekey', 'test', 'after'].includes(action)) return bad('Unknown action.');
  const g = await requireRole(req, tenantId, action === 'list' ? 'staff' : 'manager'); if (g.deny) return g.deny;
  const a = g.actor || {}; const manager = !!a.isTenantOwner || !!a.isManager || ['owner', 'admin', 'manager'].includes(String(a.role || '').toLowerCase());
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  const tz = tenantTimeZone(tenant); const origin = linkOrigin(tenant, req.nextUrl?.origin || '');
  const by = String(a.name || 'A manager').slice(0, 60);

  if (action === 'list') {
    const list = await printersOf(db, T); const now = Date.now();
    return ok({ manager, stations: stationsOf(tenant), receiptAfter: receiptAfterOf(tenant), printers: list.map((p) => ({ id: p.id, name: p.name, kind: p.kind, cols: p.cols, stations: p.stations, tickets: p.tickets, checks: p.checks, buzz: p.buzz, receipts: p.receipts, drawer: p.drawer, labels: p.labels,
      prints: printsWords(p), ...printerState(p, now, tz), ...(manager ? { url: printerUrl(origin, tenantId, p) } : {}) })) });
  }
  if (action === 'after') {
    const after = b.after === 'print' || b.after === 'none' ? b.after : 'ask';
    await db.doc(T).set({ receiptSettings: { after, updatedAt: new Date().toISOString(), updatedBy: by } }, { merge: true });
    return ok({ receiptAfter: after });
  }
  const id = String(b.id || '');
  if (action === 'save') {
    const s = cleanPrinter(b);
    const known = new Set(stationsOf(tenant).map((x) => x.toLowerCase()));
    s.stations = s.stations.filter((x) => known.has(x.toLowerCase()));
    if (id) {
      if (!ID.test(id)) return bad('Which printer?');
      const ref = db.doc(`${T}/printers/${id}`); const cur = (await ref.get()).data();
      if (!cur) return bad('That printer wasn’t found.', 404);
      // A different make speaks differently: a new address for it.
      await ref.set({ ...s, ...(cur.kind !== s.kind ? { key: newKey(), lastSeenAt: null, statusCode: null, lastError: null } : {}), updatedAt: new Date().toISOString(), updatedBy: by }, { merge: true });
      forgetPrinter(T, id);
      return ok({ id });
    }
    if ((await printersOf(db, T)).length >= MAX_PRINTERS) return bad(`${MAX_PRINTERS} printers at most.`);
    const ref = db.collection(`${T}/printers`).doc();
    await ref.set({ ...s, key: newKey(), addedAt: new Date().toISOString(), addedBy: by, lastSeenAt: null, statusCode: null, lastError: null });
    // (Known straight away to what reads the printers every half minute: a new bag-label printer prints the next order.)
    forgetPrinter(T, ref.id);
    return ok({ id: ref.id });
  }
  if (!ID.test(id)) return bad('Which printer?');
  const ref = db.doc(`${T}/printers/${id}`); const cur = (await ref.get()).data();
  if (!cur) return bad('That printer wasn’t found.', 404);
  if (action === 'remove') { await ref.delete(); forgetPrinter(T, id); return ok({ id }); }
  if (action === 'rekey') { await ref.set({ key: newKey(), lastSeenAt: null, statusCode: null }, { merge: true }); forgetPrinter(T, id); return ok({ id }); }
  const p = printerFrom(id, cur);
  await queueJob(db, T, id, 'test', testDoc({ business: String(tenant?.name || 'Your business').slice(0, 40), printer: p.name, what: printsWords(p), at: new Date().toISOString(), tz }));
  return ok({ id });
}
