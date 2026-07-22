// src/app/api/cron/nightly/route.ts
//
// Nightly bank sync — runs the same engine as the "Sync now" button for
// every tenant with a connected bank, so learned rules auto-book overnight
// and the review inbox is already populated when the owner opens the app.
//
// Vercel setup:
//   1. vercel.json →  { "crons": [{ "path": "/api/cron/nightly",
//                                   "schedule": "0 7 * * *" }] }
//      (07:00 UTC ≈ 2–3am Eastern)
//   2. Env var CRON_SECRET — Vercel automatically sends it as
//      "Authorization: Bearer <CRON_SECRET>" on cron invocations.
//      Requests without it are rejected, so nobody can trigger a sync
//      storm from outside.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { syncTenantBankFeed, listBankFeedTenants } from '@/lib/plaid-sync';
import { generateBillInstances } from '@/lib/bills-recurrence';
import { logAuditAdmin } from '@/lib/audit';
import { runReminderSweep } from '@/lib/reminders';
import { sweepNoShows } from '@/lib/no-show';

export const maxDuration = 300; // allow up to 5 min on Vercel Pro

export async function GET(req: NextRequest) {
  // ── Auth: only Vercel Cron (or someone holding the secret) may run this ──
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  // v70 — Plaid being unconfigured no longer aborts the whole run: bank
  // sync is skipped, but bill scheduling below still runs for everyone.
  const plaidConfigured = !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

  const db = getAdminDb();
  const tenants = plaidConfigured ? await listBankFeedTenants(db) : [];
  const results: Record<string, any> = {};
  let totals = { pulled: 0, matched: 0, autoBooked: 0, needsReview: 0 };
  if (!plaidConfigured) results['bank-sync'] = { skipped: 'Plaid not configured' };

  for (const tenantId of tenants) {
    try {
      const r = await syncTenantBankFeed(db, tenantId);
      results[tenantId] = r;
      totals = {
        pulled: totals.pulled + r.pulled,
        matched: totals.matched + r.matched,
        autoBooked: totals.autoBooked + r.autoBooked,
        needsReview: totals.needsReview + r.needsReview,
      };
      // Stamp the tenant so the UI can show "last synced overnight"
      await db.doc(`tenants/${tenantId}`).set(
        { bankFeed: { lastAutoSyncAt: new Date().toISOString(), lastAutoSyncResult: r } },
        { merge: true },
      );
    } catch (e: any) {
      // One tenant's failure must never block the rest
      results[tenantId] = { error: String(e?.message || e).slice(0, 200) };
    }
  }

  // ── v70: recurring bill scheduler — for EVERY tenant (bills exist
  // without banks), ensure each bill definition has its next unpaid
  // instance on its own cadence (daily/weekly/bi-weekly/monthly/
  // quarterly/annual). One pending instance per bill at a time.
  let billsScheduled = 0;
  const allTenantsSnap = await db.collection('tenants').get();
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const created = await generateBillInstances(db, tDoc.id);
      if (created > 0) {
        billsScheduled += created;
        await logAuditAdmin(db, tDoc.id, {
          action: 'bill.generate', targetType: 'bill',
          summary: `Scheduled ${created} upcoming bill due date${created === 1 ? '' : 's'} on their cadence`,
          actor: { type: 'system', name: 'bill-scheduler' },
        });
      }
    } catch (e) {
      results[`bills:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── v84: late-rent sweep — 'due' invoices past dueDate + grace flip to
  // 'late' and the lease's late-fee policy is applied ONCE. Only manual-
  // collection leases: auto-collect leases are latened by their own
  // charger (grace 3 → fee + retry → final retry day 7). Policy disabled
  // still marks late after a default 3-day grace — just without a fee.
  let rentMarkedLate = 0;
  let leasesRenewed = 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const leasesSnap = await db.collection(`tenants/${tDoc.id}/leases`).get();
      const leaseById = new Map(leasesSnap.docs.map((d: any) => [d.id, d.data()]));

      // ── v85: lease renewals — auto-renew leases extend by one full term
      // the day after they end; everyone else gets ONE "lease ended" nudge.
      for (const ld of leasesSnap.docs) {
        const l = ld.data() as any;
        if (l.status !== 'active' || !l.endDate || String(l.endDate).slice(0, 10) >= todayStr) continue;
        if (l.autoRenew) {
          const termDays = l.startDate
            ? Math.max(1, Math.round((new Date(l.endDate + 'T00:00:00Z').getTime() - new Date(l.startDate + 'T00:00:00Z').getTime()) / 86400000))
            : 30;
          const base = new Date(String(l.endDate).slice(0, 10) + 'T00:00:00Z');
          base.setUTCDate(base.getUTCDate() + termDays);
          const newEnd = base.toISOString().slice(0, 10);
          await ld.ref.set({ endDate: newEnd, renewedAt: new Date().toISOString() }, { merge: true });
          leasesRenewed++;
          await logAuditAdmin(db, tDoc.id, {
            action: 'lease.renewed', targetType: 'lease', targetId: ld.id,
            summary: `Lease auto-renewed through ${newEnd} (one full term)`,
            actor: { type: 'system', name: 'lease-renewals' },
          });
          const nR = db.collection(`tenants/${tDoc.id}/notifications`).doc();
          await nR.set({
            id: nR.id, userId: null, read: false, createdAt: new Date().toISOString(),
            type: 'lease', link: '/booths',
            message: `A lease auto-renewed through ${newEnd}.`,
          });
        } else if (!l.expiryNotifiedAt) {
          await ld.ref.set({ expiryNotifiedAt: new Date().toISOString() }, { merge: true });
          await logAuditAdmin(db, tDoc.id, {
            action: 'lease.expired', targetType: 'lease', targetId: ld.id,
            summary: `Lease ended ${String(l.endDate).slice(0, 10)} — renew it or end it in Booths`,
            actor: { type: 'system', name: 'lease-renewals' },
          });
          const nR = db.collection(`tenants/${tDoc.id}/notifications`).doc();
          await nR.set({
            id: nR.id, userId: null, read: false, createdAt: new Date().toISOString(),
            type: 'lease', link: '/booths',
            message: `A lease ended ${String(l.endDate).slice(0, 10)} — renew or end it in Booths.`,
          });
        }
      }

      const dueSnap = await db.collection(`tenants/${tDoc.id}/rentInvoices`)
        .where('status', '==', 'due').get();
      if (dueSnap.empty) continue;
      for (const inv of dueSnap.docs) {
        const v = inv.data() as any;
        const lease: any = leaseById.get(v.leaseId);
        if (!lease || lease.autoCollect) continue;
        const due = String(v.dueDate || '').slice(0, 10);
        if (!due) continue;
        const policy = lease.lateFeePolicy || {};
        const graceDays = policy.enabled ? (Number(policy.graceDays) || 0) : 3;
        const graceEnd = new Date(`${due}T12:00:00Z`);
        graceEnd.setUTCDate(graceEnd.getUTCDate() + graceDays);
        if (todayStr <= graceEnd.toISOString().slice(0, 10)) continue;
        let feeCents = 0;
        if (policy.enabled && !(v.lateFeeCents > 0)) {
          feeCents = policy.type === 'percent'
            ? Math.round((v.amountCents || 0) * (Number(policy.percent) || 0) / 100)
            : Math.max(0, Math.round(Number(policy.amountCents) || 0));
        }
        await inv.ref.set({
          status: 'late',
          markedLateAt: new Date().toISOString(),
          ...(feeCents > 0 ? { lateFeeCents: feeCents } : {}),
        }, { merge: true });
        rentMarkedLate++;
        let renterName = 'Renter';
        try {
          if (lease.renterId) {
            const r = (await db.doc(`tenants/${tDoc.id}/renters/${lease.renterId}`).get()).data() as any;
            if (r) renterName = `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Renter';
          }
        } catch { /* name is cosmetic */ }
        const owed = ((v.amountCents || 0) + (feeCents || v.lateFeeCents || 0)) / 100;
        await logAuditAdmin(db, tDoc.id, {
          action: 'rent.marked_late', targetType: 'rentInvoice', targetId: inv.id,
          summary: `${renterName}'s rent (due ${due}) is now LATE — $${owed.toFixed(2)} owed${feeCents > 0 ? ` (incl. $${(feeCents / 100).toFixed(2)} late fee)` : ''}`,
          amount: owed,
          actor: { type: 'system', name: 'rent-sweep' },
        });
        const nRef = db.collection(`tenants/${tDoc.id}/notifications`).doc();
        await nRef.set({
          id: nRef.id, userId: null, read: false, createdAt: new Date().toISOString(),
          type: 'rent_late', link: '/booths',
          message: `${renterName}'s rent is late — $${owed.toFixed(2)} owed${feeCents > 0 ? ' (late fee applied)' : ''}.`,
        });
      }
    } catch (e) {
      results[`rent:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── Reminder suite — for EVERY tenant, emit idempotent in-app reminders for
  // upcoming tours, rent coming due, credential/license expiry, and leases up
  // for renewal. Isolated in its own loop + try/catch so a reminder failure can
  // never affect bank sync, bill scheduling, or the late-rent sweep above.
  const reminderTotals = { tourReminders: 0, balanceDue: 0, licenseExpiry: 0, leaseRenewal: 0 };
  const nowForReminders = new Date();
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const c = await runReminderSweep(db, tDoc.id, nowForReminders);
      reminderTotals.tourReminders += c.tourReminders;
      reminderTotals.balanceDue += c.balanceDue;
      reminderTotals.licenseExpiry += c.licenseExpiry;
      reminderTotals.leaseRenewal += c.leaseRenewal;
    } catch (e) {
      results[`reminders:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── No-show sweep — for EVERY tenant, flag confirmed reservations whose booked
  // window fully elapsed without a check-in, and (only if the owner enabled it
  // with a fee and a card is on file) charge the no-show fee. Isolated loop so a
  // charge failure can never affect anything above it.
  const noShowTotals = { swept: 0, feesCharged: 0, feesDeclined: 0, feesNoCard: 0, feeCentsCharged: 0 };
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const c = await sweepNoShows(db, tDoc.id, nowForReminders);
      noShowTotals.swept += c.swept;
      noShowTotals.feesCharged += c.feesCharged;
      noShowTotals.feesDeclined += c.feesDeclined;
      noShowTotals.feesNoCard += c.feesNoCard;
      noShowTotals.feeCentsCharged += c.feeCentsCharged;
    } catch (e) {
      results[`noshow:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  console.log('[cron/nightly] synced', tenants.length, 'tenants', totals, '· bills scheduled', billsScheduled, '· rent marked late', rentMarkedLate, '· leases renewed', leasesRenewed, '· reminders', reminderTotals, '· no-shows', noShowTotals);
  return NextResponse.json({ ok: true, tenants: tenants.length, totals, billsScheduled, rentMarkedLate, leasesRenewed, reminderTotals, noShowTotals, results });
}
