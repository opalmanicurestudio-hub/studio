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

  console.log('[cron/nightly] synced', tenants.length, 'tenants', totals, '· bills scheduled', billsScheduled);
  return NextResponse.json({ ok: true, tenants: tenants.length, totals, billsScheduled, results });
}
