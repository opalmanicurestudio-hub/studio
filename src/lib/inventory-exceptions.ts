'use client';

// ─── Inventory Exceptions: the spine ─────────────────────────────────────────
// Every unit that leaves the business without producing its expected value
// gets ONE record here — the spec's core principle: inventory never simply
// disappears as an adjustment. An exception carries the full triple:
//
//   landed cost   — what the unit actually cost (the only number that ever
//                   reaches the accounting ledger; the writers that put it
//                   there link back via ledgerTxnId so the same loss can
//                   never be recognised twice)
//   retail value  — what it would have sold for (analytics, never a deduction)
//   lost margin   — retail minus landed (analytics)
//
// plus the reason (from the taxonomy below), the responsible party, links to
// the order/return/claim it came from, and a recovery stamp that Round N2's
// Recovery Queue will advance. Deterministic ids make every writer
// idempotent: the same source event can fire twice and produce one record.

import {
  collection, doc, getDoc, getDocs, query, runTransaction, setDoc, where, writeBatch, type Firestore,
} from 'firebase/firestore';
import { buildExceptionDoc, type InventoryExceptionInput } from './exception-doc';
export {
  EXCEPTION_REASONS, type ExceptionGroup, type ExceptionReason, reasonGroup, reasonLabel, RECOVERY_CANDIDATES, exceptionTriple, type InventoryExceptionInput, buildExceptionDoc, recoveryNetLossCents, deadlineState, type ClaimWindow, claimWindowFor, suggestedDeadline,
} from './exception-doc';

/** Write an exception outside a transaction (claims desk, manual). Skips
 *  cleanly if the deterministic id already exists — a re-fired source event
 *  produces exactly one record. */
export async function recordInventoryException(
  fs: Firestore, tenantId: string, input: InventoryExceptionInput,
): Promise<{ ok: boolean; created: boolean; message?: string }> {
  try {
    const ref = doc(collection(fs, `tenants/${tenantId}/inventoryExceptions`), input.dedupeId);
    const existing = await getDoc(ref);
    if (existing.exists()) return { ok: true, created: false };
    await setDoc(ref, JSON.parse(JSON.stringify(buildExceptionDoc(input, tenantId))));
    return { ok: true, created: true };
  } catch (e: any) {
    return { ok: false, created: false, message: e?.message || 'Could not record the exception.' };
  }
}


// ─── Round N2: the Recovery Queue lifecycle ──────────────────────────────────
// A carrier or supplier loss is money someone else may owe. The lifecycle is
// deliberately small and every transition is APPENDED to recovery.events —
// offsets never erase, exactly like the order event log. Recovered money
// writes a ledger INCOME line ('Loss recovery') that stands NEXT TO the
// original Spoilage expense, never instead of it: the loss happened, the
// reimbursement happened, and the books show both. netLoss = landed −
// recovered is computed truth, not a stored opinion.

export type RecoveryStatus = 'none' | 'candidate' | 'filed' | 'approved' | 'denied' | 'abandoned' | 'paid';
export type RecoveryAction = 'file' | 'approve' | 'deny' | 'abandon' | 'payment';

const RECOVERY_TRANSITIONS: Record<RecoveryAction, RecoveryStatus[]> = {
  file: ['candidate'],
  approve: ['filed'],
  deny: ['filed', 'approved'],
  abandon: ['candidate', 'filed'],
  payment: ['filed', 'approved', 'paid'], // partial payments accumulate
};

export async function advanceRecovery(
  fs: Firestore, tenantId: string, excId: string,
  action: RecoveryAction,
  payload: { amountCents?: number; refNumber?: string; deadlineAt?: string | null; note?: string },
  actor: { id: string; name: string },
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = doc(collection(fs, `tenants/${tenantId}/inventoryExceptions`), excId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Exception not found.' };
      const exc = snap.data() as any;
      const rec = { ...(exc.recovery || { status: 'none', claimAmountCents: 0, recoveredCents: 0 }) };
      const from: RecoveryStatus = rec.status || 'none';

      if (!RECOVERY_TRANSITIONS[action].includes(from)) {
        return { ok: false, message: `Can't ${action} a ${String(from).replace('_', ' ')} recovery.` };
      }

      const now = new Date().toISOString();
      const events = Array.isArray(rec.events) ? [...rec.events] : [];
      const note = payload.note ? String(payload.note).slice(0, 400) : null;

      if (action === 'file') {
        const amount = Math.max(0, Math.round(Number(payload.amountCents) || 0)) || (Number(exc.landedCostCents) || 0);
        rec.status = 'filed';
        rec.claimAmountCents = amount;
        rec.refNumber = payload.refNumber ? String(payload.refNumber).slice(0, 60) : null;
        rec.filedAt = now;
        rec.deadlineAt = payload.deadlineAt || null;
        events.push({ at: now, by: actor.name, action: 'file', amountCents: amount, ...(rec.refNumber ? { refNumber: rec.refNumber } : {}), ...(note ? { note } : {}) });
      } else if (action === 'approve') {
        rec.status = 'approved';
        events.push({ at: now, by: actor.name, action: 'approve', ...(note ? { note } : {}) });
      } else if (action === 'deny') {
        rec.status = 'denied';
        events.push({ at: now, by: actor.name, action: 'deny', ...(note ? { note } : {}) });
      } else if (action === 'abandon') {
        rec.status = 'abandoned';
        events.push({ at: now, by: actor.name, action: 'abandon', ...(note ? { note } : {}) });
      } else if (action === 'payment') {
        const amount = Math.max(0, Math.round(Number(payload.amountCents) || 0));
        if (amount <= 0) return { ok: false, message: 'Enter the amount that actually arrived.' };
        rec.recoveredCents = Math.max(0, Number(rec.recoveredCents) || 0) + amount;
        rec.status = 'paid';
        rec.lastPaymentAt = now;
        events.push({ at: now, by: actor.name, action: 'payment', amountCents: amount, ...(note ? { note } : {}) });

        /* The income line — the offset that never erases. Linked both ways
         * so reconciliation can pair every recovery with its loss. */
        const txnRef = doc(collection(fs, `tenants/${tenantId}/transactions`));
        txn.set(txnRef, {
          id: txnRef.id, date: now,
          description: `Loss recovery: ${exc.name}${exc.orderNumber != null ? ` (Order #${String(exc.orderNumber).padStart(4, '0')})` : ''}${rec.refNumber ? ` · ref ${rec.refNumber}` : ''}`,
          clientOrVendor: exc.carrier || (exc.responsibleParty === 'supplier' ? 'Supplier' : 'Carrier'),
          type: 'income', context: 'Business',
          category: 'Loss recovery', taxBucket: 'income',
          amount: amount / 100, paymentMethod: 'External', hasReceipt: false,
          inventoryExceptionId: excId, tenantId,
        });
        rec.lastRecoveryTxnId = txnRef.id;
      }

      rec.events = events;
      txn.update(ref, { recovery: JSON.parse(JSON.stringify(rec)) });
      const netAfter = Math.max(0, (Number(exc.landedCostCents) || 0) - (Number(rec.recoveredCents) || 0));
      return {
        ok: true,
        message: action === 'payment'
          ? `$${((Number(payload.amountCents) || 0) / 100).toFixed(2)} recorded — net loss now $${(netAfter / 100).toFixed(2)}`
          : action === 'file' ? 'Claim filed — the deadline clock is running'
          : `Recovery ${rec.status}`,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not update the recovery.' };
  }
}


// ─── Round N3: manual write-offs, duplicate recognition, accounting hand-off ─

/** The write-off dialog's reason list — codes from the taxonomy, in the
 *  order a small shop actually reaches for them. 'inbound_damage' is the
 *  quiet win: "damaged on arrival" is the SUPPLIER's loss, so choosing it
 *  lands the write-off in the Recovery Queue automatically. */
export const MANUAL_WRITEOFF_REASONS: { code: string; label: string }[] = [
  { code: 'inbound_damage', label: 'Damaged on arrival (supplier)' },
  { code: 'warehouse_damage', label: 'Damaged in studio' },
  { code: 'employee_damage', label: 'Employee damage' },
  { code: 'expired', label: 'Expired' },
  { code: 'obsolete', label: 'Obsolete / discontinued' },
  { code: 'theft_shrinkage', label: 'Theft / shrinkage' },
  { code: 'missing_inventory', label: 'Missing — can\u2019t locate' },
  { code: 'count_discrepancy', label: 'Count discrepancy' },
  { code: 'packaging_failure', label: 'Packaging failure / leaked' },
  { code: 'environmental', label: 'Temperature / environmental' },
  { code: 'sample_tester', label: 'Sample / tester' },
  { code: 'quality_testing', label: 'Quality-control testing' },
  { code: 'internal_use', label: 'Internal use' },
  { code: 'promo_giveaway', label: 'Promotional giveaway' },
  { code: 'recall', label: 'Product recall' },
];

const MANUAL_RESPONSIBLE: Record<string, InventoryExceptionInput['responsibleParty']> = {
  inbound_damage: 'supplier',
  theft_shrinkage: 'unknown',
  missing_inventory: 'unknown',
  count_discrepancy: 'unknown',
};

/** Duplicate recognition (the spec's double-deduction guard, second layer —
 *  deterministic ids catch exact re-fires; this catches the HUMAN path where
 *  the same economic loss gets recorded twice through different doors, e.g.
 *  a return already wrote the unit off and someone also writes it off from
 *  inventory). Looks for another exception on the same product within the
 *  window; a hit doesn't block — losses can legitimately repeat — it FLAGS,
 *  and the ledger shows the flag for a human to judge. */
export async function findRecentExceptionForProduct(
  fs: Firestore, tenantId: string, productId: string, withinDays = 30, excludeId?: string,
): Promise<{ id: string; at: string; reason: string } | null> {
  try {
    const snap = await getDocs(query(
      collection(fs, `tenants/${tenantId}/inventoryExceptions`),
      where('productId', '==', productId),
    ));
    const cutoff = Date.now() - withinDays * 86400000;
    const hits = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((r) => r.id !== excludeId && Date.parse(String(r.at || '')) >= cutoff)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return hits.length ? { id: hits[0].id, at: hits[0].at, reason: hits[0].reason } : null;
  } catch {
    return null; // the guard is best-effort; recording the loss still matters more
  }
}

/** Manual write-off entry point: runs the duplicate check, then records. */
export async function recordManualException(
  fs: Firestore, tenantId: string, input: InventoryExceptionInput,
): Promise<{ ok: boolean; created: boolean; possibleDuplicate: boolean; message?: string }> {
  const dup = input.productId
    ? await findRecentExceptionForProduct(fs, tenantId, input.productId, 30, input.dedupeId)
    : null;
  const res = await recordInventoryException(fs, tenantId, {
    ...input,
    responsibleParty: input.responsibleParty || MANUAL_RESPONSIBLE[input.reason] || 'internal',
    ...(dup ? { flags: [...(input.flags || []), 'possible_duplicate'], duplicateOfId: dup.id } : {}),
  });
  return { ...res, possibleDuplicate: Boolean(dup) };
}

/** Accounting hand-off: stamp every exception in a month as delivered to
 *  the accounting layer. The stamp is a state, not an edit — the records
 *  themselves stay append-only, and re-running skips already-stamped rows. */
export async function markMonthHandedOff(
  fs: Firestore, tenantId: string, monthKey: string, actorName: string,
): Promise<{ ok: boolean; stamped: number; message: string }> {
  try {
    const [y, m] = monthKey.split('-').map(Number);
    const start = new Date(y, m - 1, 1).toISOString();
    const end = new Date(y, m, 1).toISOString();
    const snap = await getDocs(query(
      collection(fs, `tenants/${tenantId}/inventoryExceptions`),
      where('at', '>=', start), where('at', '<', end),
    ));
    const now = new Date().toISOString();
    const targets = snap.docs.filter((d) => (d.data() as any).accountingStatus !== 'handed_off');
    if (targets.length === 0) return { ok: true, stamped: 0, message: 'Everything this month is already handed off.' };
    // Firestore batches cap at 500 writes — a month over that is chunked.
    for (let i = 0; i < targets.length; i += 450) {
      const batch = writeBatch(fs);
      for (const d of targets.slice(i, i + 450)) {
        batch.update(d.ref, { accountingStatus: 'handed_off', handedOffAt: now, handedOffBy: actorName });
      }
      await batch.commit();
    }
    return { ok: true, stamped: targets.length, message: `${targets.length} exception${targets.length === 1 ? '' : 's'} marked handed off.` };
  } catch (e: any) {
    return { ok: false, stamped: 0, message: e?.message || 'Could not stamp the month.' };
  }
}


// ─── Round N4: analytics + prevention ────────────────────────────────────────
// The spec's last stage: Detect → Document → Classify → Recover → Account →
// ANALYZE → PREVENT. Everything below is a pure function over the exception
// rows — no queries, no state — so the numbers are recomputable, testable,
// and identical wherever they render. Signals are deliberately conservative:
// each one states its threshold in its own text, fires only when the data
// clears it, and says nothing when the data is thin. A prevention system
// that cries wolf gets ignored by week two.

export interface LossAnalytics {
  windowDays: number;
  total: { count: number; landed: number; recovered: number; net: number; retail: number; margin: number };
  byGroup: { group: string; count: number; landed: number; recovered: number; net: number }[];
  byProduct: { productId: string | null; name: string; count: number; landed: number; net: number; topReason: string }[];
  byCarrier: { carrier: string; count: number; landed: number; recovered: number; ratePct: number | null }[];
  recovery: {
    candidateLanded: number;   // carrier/supplier losses where recovery was on the table
    recovered: number;
    ratePct: number | null;    // recovered ÷ candidate landed — null when no candidates
    avgDaysToPaid: number | null;
    openFiled: number;
  };
  signals: { severity: 'warn' | 'info'; text: string }[];
}

export function lossAnalytics(rows: any[], windowDays = 90, now = Date.now()): LossAnalytics {
  const cutoff = now - windowDays * 86400000;
  const inWin = rows.filter((r) => Date.parse(String(r.at || '')) >= cutoff);

  const landedOf = (r: any) => Number(r.landedCostCents) || 0;
  const recoveredOf = (r: any) => Number(r.recovery?.recoveredCents) || 0;
  const netOf = (r: any) => Math.max(0, landedOf(r) - recoveredOf(r));

  const total = {
    count: inWin.length,
    landed: inWin.reduce((a, r) => a + landedOf(r), 0),
    recovered: inWin.reduce((a, r) => a + recoveredOf(r), 0),
    net: inWin.reduce((a, r) => a + netOf(r), 0),
    retail: inWin.reduce((a, r) => a + (Number(r.retailCents) || 0), 0),
    margin: inWin.reduce((a, r) => a + (Number(r.marginCents) || 0), 0),
  };

  const groupAgg = new Map<string, { count: number; landed: number; recovered: number; net: number }>();
  for (const r of inWin) {
    const g = String(r.reasonGroup || 'internal');
    const cur = groupAgg.get(g) || { count: 0, landed: 0, recovered: 0, net: 0 };
    cur.count += 1; cur.landed += landedOf(r); cur.recovered += recoveredOf(r); cur.net += netOf(r);
    groupAgg.set(g, cur);
  }
  const byGroup = [...groupAgg.entries()]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => b.landed - a.landed);

  const prodAgg = new Map<string, { productId: string | null; name: string; count: number; landed: number; net: number; reasons: Map<string, number> }>();
  for (const r of inWin) {
    const key = String(r.productId || r.name || 'unknown');
    const cur = prodAgg.get(key) || { productId: r.productId || null, name: String(r.name || 'Unknown'), count: 0, landed: 0, net: 0, reasons: new Map() };
    cur.count += 1; cur.landed += landedOf(r); cur.net += netOf(r);
    cur.reasons.set(String(r.reason), (cur.reasons.get(String(r.reason)) || 0) + 1);
    prodAgg.set(key, cur);
  }
  const byProduct = [...prodAgg.values()]
    .map((p) => ({
      productId: p.productId, name: p.name, count: p.count, landed: p.landed, net: p.net,
      topReason: [...p.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }))
    .sort((a, b) => b.landed - a.landed)
    .slice(0, 8);

  const carrierAgg = new Map<string, { count: number; landed: number; recovered: number }>();
  for (const r of inWin) {
    if (String(r.reasonGroup) !== 'carrier') continue;
    const c = String(r.carrier || 'Unknown carrier');
    const cur = carrierAgg.get(c) || { count: 0, landed: 0, recovered: 0 };
    cur.count += 1; cur.landed += landedOf(r); cur.recovered += recoveredOf(r);
    carrierAgg.set(c, cur);
  }
  const byCarrier = [...carrierAgg.entries()]
    .map(([carrier, v]) => ({ carrier, ...v, ratePct: v.landed > 0 ? Math.round((v.recovered / v.landed) * 100) : null }))
    .sort((a, b) => b.landed - a.landed);

  const candidates = inWin.filter((r) => ['candidate', 'filed', 'approved', 'denied', 'paid'].includes(String(r.recovery?.status)));
  const candidateLanded = candidates.reduce((a, r) => a + landedOf(r), 0);
  const paidOnes = candidates.filter((r) => (Number(r.recovery?.recoveredCents) || 0) > 0 && r.recovery?.filedAt && r.recovery?.lastPaymentAt);
  const avgDaysToPaid = paidOnes.length
    ? Math.round(paidOnes.reduce((a, r) => a + Math.max(0, (Date.parse(r.recovery.lastPaymentAt) - Date.parse(r.recovery.filedAt)) / 86400000), 0) / paidOnes.length)
    : null;
  const recovery = {
    candidateLanded,
    recovered: total.recovered,
    ratePct: candidateLanded > 0 ? Math.round((total.recovered / candidateLanded) * 100) : null,
    avgDaysToPaid,
    openFiled: inWin.filter((r) => r.recovery?.status === 'filed').length,
  };

  // ── Prevention signals — each states its own threshold ──
  const signals: { severity: 'warn' | 'info'; text: string }[] = [];
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

  for (const p of byProduct) {
    /* Compared against the average of the OTHER products — with a small
     * catalog, a dominant loser inflates the plain average enough to mute
     * its own signal, which is exactly backwards. */
    const avgOther = prodAgg.size > 1 ? (total.landed - p.landed) / (prodAgg.size - 1) : 0;
    if (p.count >= 3 && p.landed >= Math.max(2 * avgOther, 2000)) {
      const hint = p.topReason.includes('damage') || p.topReason === 'carrier_damaged' ? 'packaging or handling review'
        : p.topReason === 'expired' ? 'smaller purchase quantities'
        : p.topReason.includes('defect') ? 'a supplier quality conversation'
        : 'a closer look at handling';
      signals.push({ severity: 'warn', text: `${p.name}: ${p.count} losses (${$(p.landed)}) in ${windowDays} days — 3+ events and 2×+ the product average suggests ${hint}.` });
    }
  }
  for (const c of byCarrier) {
    if (c.landed >= 5000 && (c.ratePct ?? 0) < 60) {
      signals.push({ severity: 'warn', text: `${c.carrier}: ${$(c.landed)} lost, only ${c.ratePct ?? 0}% recovered ($50+ at under 60%) — consider filing harder, insuring more, or routing around them.` });
    }
  }
  const internal = byGroup.find((g) => g.group === 'internal');
  const expiredLanded = inWin.filter((r) => r.reason === 'expired').reduce((a, r) => a + landedOf(r), 0);
  if (internal && internal.landed > 0 && expiredLanded / internal.landed >= 0.3 && expiredLanded >= 2000) {
    signals.push({ severity: 'warn', text: `Expiry is ${Math.round((expiredLanded / internal.landed) * 100)}% of internal losses (${$(expiredLanded)}, threshold 30% and $20+) — buying above sales velocity; trim reorder quantities.` });
  }
  const staleFiled = inWin.filter((r) => r.recovery?.status === 'filed' && r.recovery?.filedAt && (now - Date.parse(r.recovery.filedAt)) > 21 * 86400000);
  if (staleFiled.length > 0) {
    signals.push({ severity: 'info', text: `${staleFiled.length} filed claim${staleFiled.length === 1 ? '' : 's'} older than 21 days with no payment. Please follow up with the carrier.` });
  }
  const supplierEvents = inWin.filter((r) => String(r.reasonGroup) === 'supplier');
  if (supplierEvents.length >= 2) {
    const supLanded = supplierEvents.reduce((a, r) => a + landedOf(r), 0);
    signals.push({ severity: 'info', text: `${supplierEvents.length} supplier-caused losses (${$(supLanded)}) in ${windowDays} days — worth raising on the next order; supplier claims recover at the highest rate.` });
  }
  const uninsured = inWin.filter((r) => String(r.reasonGroup) === 'carrier' && r.insuredCents === 0);
  const uninsuredLanded = uninsured.reduce((a, r) => a + landedOf(r), 0);
  if (uninsured.length >= 1 && uninsuredLanded >= 2000) {
    signals.push({ severity: 'warn', text: `${uninsured.length} carrier loss${uninsured.length === 1 ? '' : 'es'} shipped uninsured (${$(uninsuredLanded)} landed, $20+ threshold). Losses beyond carrier minimums cannot be recovered. Consider lowering the auto-insure threshold in shipping settings.` });
  }
  const uncosted = inWin.filter((r) => r.costed === false).length;
  if (uncosted > 0) {
    signals.push({ severity: 'info', text: `${uncosted} exception${uncosted === 1 ? '' : 's'} missing a product cost — every figure above understates the true loss until costPerUnit is set.` });
  }

  return { windowDays, total, byGroup, byProduct, byCarrier, recovery, signals };
}
