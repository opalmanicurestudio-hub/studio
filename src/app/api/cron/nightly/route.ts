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
import { brandedEmailHtml } from '@/lib/email-template';
import { sweepNoShows } from '@/lib/no-show';
import { reconcileReservations } from '@/lib/stock-reconcile';
import { sweepStaleCurbside } from '@/lib/stock-reconcile';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import {
  sweepExpiredRequests, sweepPendingRequestNudge, sweepRecoveryDeadlines, sweepUnpaidAccepted,
  sweepStalledShipments, sweepStaleCases,
} from '@/lib/retail-sweeps';

export const maxDuration = 300; // allow up to 5 min on Vercel Pro


// Branded rent emails ride the same Resend + RESEND_FROM address the rest of
// the app's mail uses — tenant name as display name, fail-soft everywhere.
async function sendRentEmail(opts: { to: string; fromName: string; subject: string; html: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !opts.to) return false;
  const rf = String(process.env.RESEND_FROM || '').trim();
  const m = rf.match(/<([^>]+)>/);
  const addr = (m ? m[1] : rf).trim();
  const from = addr.includes('@') ? `${opts.fromName} <${addr}>` : `${opts.fromName} <notifications@clarityflow.app>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Magic portal link for a renter — mints their portalToken when missing,
// same mechanism as the owner's "Send portal link" button.
async function renterPortalLink(db: any, tenantId: string, renterId: string, r: any): Promise<string | null> {
  try {
    const base = String(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.publicOrigin
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
    if (!base) return null;
    let tok = r?.portalToken;
    if (!tok || String(tok).length < 12) {
      tok = Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 10)).join('') + Date.now().toString(36);
      await db.doc(`tenants/${tenantId}/renters/${renterId}`).set({ portalToken: tok }, { merge: true });
    }
    return `${base}/rent/${tenantId}?rt=${tok}`;
  } catch { return null; }
}


// ── Lease-window stamp ───────────────────────────────────────────────────────
// A money-free copy of what a renter's lease actually holds — days, times,
// station, turnover — kept on their STAFF doc so the availability engine can
// enforce it at read time. It has to live there because the PUBLIC booking page
// reads staff but must never read leases: leases carry rent.
//
// Duplicated (not imported) in /api/portal/renter, which stamps the same shape
// when a renter opens their portal or saves hours. A route is an endpoint, not
// a module; this nightly pass is the safety net that catches the case nobody is
// around for — the owner edits a lease and the renter never opens the portal.
const DEFAULT_TURNOVER_MINUTES = 15;

function leaseWindowStamp(lease: any, boothBufferMinutes: any, tenant: any): any {
  if (!lease) return null;
  const slot = lease.scheduleSlot;
  const days = Array.isArray(slot?.days) && slot.days.length > 0
    ? slot.days.map((d: any) => Number(d)).filter((n: number) => n >= 0 && n <= 6)
    : null;
  const raw = boothBufferMinutes ?? tenant?.boothTurnoverMinutes ?? DEFAULT_TURNOVER_MINUTES;
  const turnoverMinutes = Math.max(0, Math.min(120, Number(raw) || 0));
  return {
    days,
    startTime: slot?.startTime || '',
    endTime: slot?.endTime || '',
    boothId: lease.boothId || null,
    turnoverMinutes,
  };
}

/** True when the stored stamp already says exactly this — skip a pointless write. */
function sameLeaseWindow(a: any, b: any): boolean {
  if (!a || !b) return (!a && !b);
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  let leaseWindowsSynced = 0;
  for (const tDoc of allTenantsSnap.docs) {
    try {
      // "Today" belongs to the studio, not to the server. This ran at 07:00
      // UTC, which is 2am Eastern and 11pm Pacific the PREVIOUS day — so a
      // west-coast studio had rent marked late, and leases renewed, a day
      // early. Computed per tenant for the same reason.
      const todayStr = todayIn(tenantTimeZone(tDoc.data() as any));
      const leasesSnap = await db.collection(`tenants/${tDoc.id}/leases`).get();
      const leaseById = new Map(leasesSnap.docs.map((d: any) => [d.id, d.data()]));

      // ── Lease-window sync — push each active lease's shape onto the renter's
      // staff doc so the booking engine (and the public page) can honor it.
      // Without this, a lease edited by the owner never reaches the booking
      // grid: the renter's saved hours were clamped when THEY saved them, and
      // nothing rewrote them afterwards, so the chair kept selling old days.
      try {
        const tenantData = tDoc.data() as any;
        const renterStaffSnap = await db.collection(`tenants/${tDoc.id}/staff`).where('isRenter', '==', true).get();
        const boothBuffer = new Map<string, any>();
        for (const sd of renterStaffSnap.docs) {
          const st = sd.data() as any;
          if (!st.renterId) continue;
          const lease = leasesSnap.docs
            .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
            .find((l: any) => l.renterId === st.renterId && ['active', 'on_leave'].includes(String(l.status)));
          let bufferMinutes: any = undefined;
          if (lease?.boothId) {
            if (!boothBuffer.has(lease.boothId)) {
              try {
                const b = await db.doc(`tenants/${tDoc.id}/booths/${lease.boothId}`).get();
                boothBuffer.set(lease.boothId, b.exists ? (b.data() as any)?.dayUseBufferMinutes : undefined);
              } catch { boothBuffer.set(lease.boothId, undefined); }
            }
            bufferMinutes = boothBuffer.get(lease.boothId);
          }
          const next = leaseWindowStamp(lease, bufferMinutes, tenantData);
          if (!sameLeaseWindow(st.leaseWindow || null, next)) {
            await sd.ref.set({ leaseWindow: next }, { merge: true });
            leaseWindowsSynced++;
          }
        }
      } catch (e) { console.error('[cron/nightly] lease-window sync', e); }

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
        // COLLECTIONS ON AUTOPILOT: the renter hears it the same night,
        // with a one-tap magic link into their portal's Pay button.
        const rentComms: any = { lateNoticeEmail: true, lateNoticeSms: true, ...(((tDoc.data() as any)?.rentComms) || {}) };
        try {
          const { smsConfigured, sendTenantSms } = await import('@/lib/sms');
          if (rentComms.lateNoticeSms !== false && lease.renterId && smsConfigured()) {
            const rRef = db.doc(`tenants/${tDoc.id}/renters/${lease.renterId}`);
            const r = (await rRef.get()).data() as any;
            if (r?.phone) {
              const link = await renterPortalLink(db, tDoc.id, lease.renterId, r);
              await sendTenantSms(db, tDoc.id, r.phone,
                `Your rent (due ${due}) is now past due — $${owed.toFixed(2)} owed${feeCents > 0 ? ' incl. late fee' : ''}. Pay in your portal:${link ? ` ${link}` : ' (link in your welcome text)'}`,
                { email: r.email || null, subject: 'Rent past due' });
            }
          }
        } catch { /* renter text is a bonus — the owner notification stands */ }
        // Late notice EMAIL beside the text — some renters never text back,
        // and the branded email carries the same one-tap pay link.
        try {
          if (rentComms.lateNoticeEmail !== false && lease.renterId) {
            const r = (await db.doc(`tenants/${tDoc.id}/renters/${lease.renterId}`).get()).data() as any;
            if (r?.email) {
              const businessName = String((tDoc.data() as any)?.name || 'ClarityFlow');
              const payLink = await renterPortalLink(db, tDoc.id, lease.renterId, r);
              await sendRentEmail({
                to: r.email, fromName: businessName,
                subject: `Rent past due — $${owed.toFixed(2)} owed`,
                html: brandedEmailHtml({
                  studioName: businessName,
                  title: 'Your rent is past due.',
                  bodyLines: [
                    `Rent due ${due} is now late — $${owed.toFixed(2)} owed${feeCents > 0 ? ', including the late fee' : ''}.`,
                    'Paying now stops anything further.',
                  ],
                  ...(payLink ? { cta: { label: 'Pay in my portal', url: payLink } } : {}),
                  footerNote: `Sent by ${businessName}.`,
                }),
              });
            }
          }
        } catch { /* email is a bonus — the owner notification stands */ }
      }
    } catch (e) {
      results[`rent:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── SELF-SERVE NUDGES — renter-facing money + paperwork, plus the
  // Monday tech digest. Everything idempotent via stamps; everything
  // fail-soft; each tenant isolated.
  const nudgeTotals = { rentDue: 0, credExpiry: 0, techDigests: 0 };
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const tid = tDoc.id;
      const { smsConfigured, sendTenantSms } = await import('@/lib/sms');
      if (!smsConfigured()) break; // no SMS → these are pure-noise skips
      const tz = tenantTimeZone(tDoc.data() as any);
      const todayStr = todayIn(tz);
      const base = String((tDoc.data() as any)?.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');

      // 1) RENT COMING DUE (3 days out) — friendly nudge with pay link.
      try {
        const dueSnap = await db.collection(`tenants/${tid}/rentInvoices`).where('status', '==', 'due').get();
        const soon = todayIn(tz, new Date(Date.now() + 3 * 86400000));
        for (const inv of dueSnap.docs) {
          const v = inv.data() as any;
          const due = String(v.dueDate || '').slice(0, 10);
          if (!due || due > soon || due < todayStr || v.renterDueNotifiedAt) continue;
          const lease = v.leaseId ? (await db.doc(`tenants/${tid}/leases/${v.leaseId}`).get()).data() as any : null;
          if (!lease?.renterId || lease.autoCollect) continue;
          const r = (await db.doc(`tenants/${tid}/renters/${lease.renterId}`).get()).data() as any;
          if (!r?.phone) continue;
          const link = await renterPortalLink(db, tid, lease.renterId, r);
          const sent = await sendTenantSms(db, tid, r.phone,
            `Heads up — rent of $${((v.amountCents || 0) / 100).toFixed(2)} is due ${due === todayStr ? 'today' : due}. Pay any time in your portal:${link ? ` ${link}` : ''}`,
            { email: r.email || null, subject: 'Rent due soon' });
          if (sent.ok) { await inv.ref.set({ renterDueNotifiedAt: new Date().toISOString() }, { merge: true }); nudgeTotals.rentDue++; }
        }
      } catch { /* isolated */ }

      // 2) CREDENTIAL EXPIRY — the renter uploads the renewal THEMSELVES
      // via their portal; you get a notification, not a filing task.
      try {
        const renters = await db.collection(`tenants/${tid}/renters`).get();
        const cutoff = todayIn(tz, new Date(Date.now() + 14 * 86400000));
        for (const rDoc of renters.docs) {
          const r = rDoc.data() as any;
          if (!r?.phone || r.status === 'former') continue;
          for (const [field, label] of [['licenseExpiry', 'license'], ['insuranceExpiry', 'insurance']] as const) {
            const exp = String(r[field] || '').slice(0, 10);
            if (!exp || exp > cutoff) continue;
            const stampField = `credNotified_${field}`;
            if (r[stampField] === exp) continue;
            const link = await renterPortalLink(db, tid, rDoc.id, r);
            const sent = await sendTenantSms(db, tid, r.phone,
              `Your ${label} on file ${exp < todayStr ? 'expired' : 'expires'} ${exp}. Upload the renewed one in your portal (Documents):${link ? ` ${link}` : ''}`,
              { email: r.email || null, subject: `Your ${label} ${exp < todayStr ? 'expired' : 'expires soon'}` });
            if (sent.ok) { await rDoc.ref.set({ [stampField]: exp }, { merge: true }); nudgeTotals.credExpiry++; }
          }
        }
      } catch { /* isolated */ }

      // 3) MONDAY TECH DIGEST — each worker's week at a glance, once/week.
      try {
        const isMonday = new Date().getUTCDay() === 1;
        const lastDigest = String((tDoc.data() as any)?.lastTechDigestAt || '').slice(0, 10);
        if (isMonday && lastDigest !== todayStr) {
          const [ws, ts] = await Promise.all([
            db.collection(`tenants/${tid}/maintenanceWorkers`).get(),
            db.collection(`tenants/${tid}/tickets`).get(),
          ]);
          const tickets = ts.docs.map((d: any) => d.data() as any);
          const nowIso = new Date().toISOString();
          for (const wDoc of ws.docs) {
            const w = wDoc.data() as any;
            if (!w?.phone || w.active === false) continue;
            const mine = tickets.filter((t: any) => t.assigneeId === wDoc.id && ['open', 'in_progress'].includes(t.status));
            const overdue = mine.filter((t: any) => t.dueAt && t.dueAt < nowIso).length;
            const owed = (Math.max(0, Number(w.unpaidLaborCents) || 0) + Math.max(0, Number(w.unpaidMaterialsCents) || 0)) / 100;
            if (mine.length === 0 && owed === 0) continue;
            const link = base ? ` Queue: ${base}/maintain/${tid}?t=${w.token}` : '';
            const r = await sendTenantSms(db, tid, w.phone,
              `Week ahead: ${mine.length} open job${mine.length === 1 ? '' : 's'}${overdue ? ` (${overdue} overdue)` : ''}${owed > 0 ? ` · $${owed.toFixed(2)} owed to you` : ''}.${link}`,
              { email: w.email || null, subject: 'Your week ahead' });
            if (r.ok) nudgeTotals.techDigests++;
          }
          await tDoc.ref.set({ lastTechDigestAt: todayStr }, { merge: true });
        }
      } catch { /* isolated */ }
    } catch (e) {
      results[`nudges:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }
  results.selfServeNudges = nudgeTotals;

  // ── Reminder suite — for EVERY tenant, emit idempotent in-app reminders for
  // upcoming tours, rent coming due, credential/license expiry, and leases up
  // for renewal. Isolated in its own loop + try/catch so a reminder failure can
  // never affect bank sync, bill scheduling, or the late-rent sweep above.
  const reminderTotals = { tourReminders: 0, balanceDue: 0, licenseExpiry: 0, leaseRenewal: 0, contactFollowUps: 0 };
  const nowForReminders = new Date();
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const c = await runReminderSweep(db, tDoc.id, nowForReminders);
      reminderTotals.tourReminders += c.tourReminders;
      reminderTotals.balanceDue += c.balanceDue;
      reminderTotals.licenseExpiry += c.licenseExpiry;
      reminderTotals.leaseRenewal += c.leaseRenewal;
      reminderTotals.contactFollowUps += c.contactFollowUps;
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

  // ── Preventive maintenance plans — for EVERY tenant, open the scheduled
  // tickets whose nextRunAt has arrived. IDEMPOTENT: the nextRunAt advance
  // is written in the same pass as the ticket, so a rerun the same night
  // creates nothing twice. Generated tickets are completely normal tickets:
  // same queue, same SLA, same portals, same notifications.
  const planTotals: { ticketsOpened: number; assigneeTexts: number; staffTexts?: number; renterTexts?: number } = { ticketsOpened: 0, assigneeTexts: 0, staffTexts: 0, renterTexts: 0 };
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const tid = tDoc.id;
      const todayStr = todayIn(tenantTimeZone(tDoc.data() as any));
      const plansSnap = await db.collection(`tenants/${tid}/maintenancePlans`).get();
      for (const pDoc of plansSnap.docs) {
        const p = pDoc.data() as any;
        if (p.active === false) continue;
        if (!p.nextRunAt || String(p.nextRunAt).slice(0, 10) > todayStr) continue;
        const nowIso = new Date().toISOString();
        const { dueAtFor, addDaysISO } = await import('@/lib/maintenance');
        const every = Math.max(1, Math.round(Number(p.everyDays) || 30));
        const tRef = db.collection(`tenants/${tid}/tickets`).doc();
        // Advance the schedule FIRST-in-same-batch semantics: both writes
        // together, so no partial state survives a crash between them.
        const batch = db.batch();
        batch.set(tRef, {
          id: tRef.id, tenantId: tid, locationId: null,
          title: p.title, description: p.description || '',
          category: p.category || 'other', priority: p.priority || 'normal', status: 'open',
          boothId: p.boothId || null, boothName: p.boothName || null,
          resourceId: p.resourceId || null, resourceName: p.resourceName || null,
          photoUrls: [],
          reporter: { type: 'staff', name: 'Preventive plan' },
          assigneeId: p.assigneeId || null, assigneeName: p.assigneeName || null,
          planId: pDoc.id,
          updates: [{ at: nowIso, by: 'Preventive plan', byType: 'system', note: `Scheduled ${every}-day maintenance`, status: 'open' }],
          createdAt: nowIso, updatedAt: nowIso, dueAt: dueAtFor(p.priority || 'normal'), resolvedAt: null,
        });
        batch.set(pDoc.ref, {
          lastRunAt: todayStr,
          nextRunAt: addDaysISO(String(p.nextRunAt).slice(0, 10), every),
          runCount: Math.max(0, Math.round(Number(p.runCount) || 0)) + 1,
        }, { merge: true });
        await batch.commit();
        planTotals.ticketsOpened += 1;
        // No pre-assigned worker on the plan? Rotation picks one (and texts
        // them) so scheduled work never sits ownerless.
        let rotatedName: string | null = null;
        if (!p.assigneeId) {
          try {
            const { autoAssignTicket } = await import('@/lib/maintenance-server');
            const assigned = await autoAssignTicket(db, tid, tRef.id, { title: p.title, boothName: p.boothName, priority: p.priority || 'normal' });
            rotatedName = assigned?.assigneeName || null;
          } catch { /* stays unassigned for manual triage */ }
        }
        const nRef = db.collection(`tenants/${tid}/notifications`).doc();
        await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: nowIso, link: '/booths',
          message: `Scheduled maintenance opened: "${p.title}"${p.boothName ? ` (${p.boothName})` : ''}${p.assigneeName ? ` — assigned to ${p.assigneeName}` : rotatedName ? ` — auto-assigned to ${rotatedName}` : ' — needs a worker'}.` });
        if (p.assigneeId) {
          try {
            const { smsConfigured, sendTenantSms } = await import('@/lib/sms');
            if (smsConfigured()) {
              const w = await db.doc(`tenants/${tid}/maintenanceWorkers/${p.assigneeId}`).get();
              const phone = w.exists ? (w.data() as any)?.phone : null;
              if (phone) {
                const r = await sendTenantSms(db, tid, phone, `Scheduled job today: "${p.title}"${p.boothName ? ` at ${p.boothName}` : ''}. It's in your portal queue.`);
                if (r.ok) planTotals.assigneeTexts += 1;
              }
            }
          } catch { /* text is a bonus */ }
        }
        // The RENTER whose station gets worked on hears about it the
        // morning of — nobody should arrive to find someone under their
        // sink unannounced. Any priority: it's their space.
        if (p.boothId) {
          try {
            const { smsConfigured, sendTenantSms } = await import('@/lib/sms');
            if (smsConfigured()) {
              const leases = await db.collection(`tenants/${tid}/leases`).where('boothId', '==', p.boothId).get();
              const lease = leases.docs.map((d: any) => d.data() as any).find((l: any) => ['active', 'on_leave'].includes(l.status));
              if (lease?.renterId) {
                const r = (await db.doc(`tenants/${tid}/renters/${lease.renterId}`).get()).data() as any;
                if (r?.phone) {
                  await sendTenantSms(db, tid, r.phone,
                    `Heads up: scheduled maintenance at ${p.boothName || 'your station'} today ("${p.title}")${p.assigneeName ? ` — ${p.assigneeName} will handle it` : ''}. Questions? Just reply or ask the front desk.`);
                  planTotals.renterTexts = (planTotals.renterTexts || 0) + 1;
                }
              }
            }
          } catch { /* renter text is a bonus */ }
        }
        // BLOCKING scheduled work takes the space out of service, so the
        // TEAM hears about it too — every active staff member with a phone
        // gets one text. Normal/low plans (cleaning, filters) don't disrupt
        // anyone's day, so they stay quiet and just show on the planner.
        if (['urgent', 'high'].includes(String(p.priority || '')) && (p.boothName || p.resourceName)) {
          try {
            const { smsConfigured, sendTenantSms } = await import('@/lib/sms');
            if (smsConfigured()) {
              const staffSnap = await db.collection(`tenants/${tid}/staff`).get();
              for (const sDoc of staffSnap.docs) {
                const s = sDoc.data() as any;
                if (s.active === false || s.archived) continue;
                const sPhone = s.phone || s.phoneNumber || null;
                if (!sPhone) continue;
                await sendTenantSms(db, tid, sPhone,
                  `Heads up: ${p.boothName || p.resourceName} is out of service today for scheduled maintenance ("${p.title}"). It's on the planner — plan around it.`);
                planTotals.staffTexts = (planTotals.staffTexts || 0) + 1;
              }
            }
          } catch { /* staff texts are a bonus — the planner block is the source of truth */ }
        }
      }
    } catch (e) {
      results[`plans:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── Maintenance SLA sweep — for EVERY tenant, flag open tickets past
  // their SLA deadline exactly ONCE (overdueNotifiedAt stamp): a notification
  // for the owner, and — when SMS is configured — a nudge text to the
  // assigned worker. Isolated loop; ticket failures never touch money jobs.
  const slaTotals = { overdueFlagged: 0, techNudges: 0 };
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const tid = tDoc.id;
      const nowIso = new Date().toISOString();
      const snap = await db.collection(`tenants/${tid}/tickets`).get();
      for (const d of snap.docs) {
        const t = d.data() as any;
        const openish = t.status === 'open' || t.status === 'in_progress';
        if (!openish || !t.dueAt || t.dueAt >= nowIso || t.overdueNotifiedAt) continue;
        await d.ref.set({ overdueNotifiedAt: nowIso }, { merge: true });
        slaTotals.overdueFlagged += 1;
        const nRef = db.collection(`tenants/${tid}/notifications`).doc();
        await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: nowIso, link: '/booths',
          message: `Ticket OVERDUE: "${t.title}"${t.boothName ? ` (${t.boothName})` : ''} — ${t.priority} priority, due ${String(t.dueAt).slice(0, 16).replace('T', ' ')}${t.assigneeName ? `, assigned to ${t.assigneeName}` : ', UNASSIGNED'}.` });
        if (t.assigneeId) {
          try {
            const { smsConfigured, sendTenantSms } = await import('@/lib/sms');
            if (smsConfigured()) {
              const w = await db.doc(`tenants/${tid}/maintenanceWorkers/${t.assigneeId}`).get();
              const phone = w.exists ? (w.data() as any)?.phone : null;
              if (phone) {
                const r = await sendTenantSms(db, tid, phone, `Reminder: ticket "${t.title}"${t.boothName ? ` at ${t.boothName}` : ''} is past due. Please update it in your portal.`);
                if (r.ok) slaTotals.techNudges += 1;
              }
            }
          } catch { /* nudge is a bonus */ }
        }
      }
    } catch (e) {
      results[`sla:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── STOCK: heal leaked reservations ────────────────────────────────────
  // A hold that never released hides stock from everyone with no symptom.
  // Recomputing from live orders each night means that bug class fixes
  // itself instead of quietly compounding. Silent when nothing is wrong.
  const stockTotals = { tenants: 0, corrected: 0, unitsFreed: 0, unitsHeld: 0 };
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const r = await reconcileReservations(db, tDoc.id);
      // Anyone still showing as "outside" hours later did not get their order.
      const stale = await sweepStaleCurbside(db, tDoc.id);
      if (stale.flagged > 0) results[`curbside:${tDoc.id}`] = stale;
      if (r.corrected > 0) {
        stockTotals.tenants += 1;
        stockTotals.corrected += r.corrected;
        stockTotals.unitsFreed += r.unitsFreed;
        stockTotals.unitsHeld += r.unitsHeld;
        results[`stock:${tDoc.id}`] = r;
      }
    } catch (e) {
      results[`stock:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  // ── RETAIL: the three things only a clock can notice ───────────────────
  // A parcel that stopped scanning, a filed claim whose window is closing,
  // and a resolved case nobody has touched. Each is marker-guarded inside
  // the sweep, so a re-run of this cron sends nothing twice.
  const retailTotals = { stalled: 0, stalledEmailed: 0, deadlines: 0, deadlineDigests: 0, casesClosed: 0, requestsExpired: 0, requestNudges: 0, unpaidHandled: 0 };
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const [stall, deadlines, cases, expired, nudge, unpaid] = await Promise.all([
        sweepStalledShipments(db, tDoc.id),
        sweepRecoveryDeadlines(db, tDoc.id),
        sweepStaleCases(db, tDoc.id),
        // Booking requests: expire what died, then nudge about what has not.
        sweepExpiredRequests(db, tDoc.id),
        sweepPendingRequestNudge(db, tDoc.id),
        // Accepted bookings whose deposit never landed: retry, remind, release.
        sweepUnpaidAccepted(db, tDoc.id),
      ]);
      retailTotals.stalled += stall.actioned;
      retailTotals.stalledEmailed += stall.emailed;
      retailTotals.deadlines += deadlines.actioned;
      retailTotals.deadlineDigests += deadlines.emailed;
      retailTotals.casesClosed += cases.actioned;
      retailTotals.requestsExpired += expired.actioned;
      retailTotals.requestNudges += nudge.emailed;
      retailTotals.unpaidHandled += unpaid.actioned;
      if (stall.actioned || deadlines.actioned || cases.actioned || expired.actioned || nudge.emailed || unpaid.actioned) {
        results[`retail:${tDoc.id}`] = { stall, deadlines, cases, expired, nudge, unpaid };
      }
    } catch (e) {
      results[`retail:${tDoc.id}`] = { error: String((e as any)?.message || e).slice(0, 200) };
    }
  }

  console.log('[cron/nightly] synced', tenants.length, 'tenants', totals, '· bills scheduled', billsScheduled, '· rent marked late', rentMarkedLate, '· leases renewed', leasesRenewed, '· lease windows synced', leaseWindowsSynced, '· reminders', reminderTotals, '· no-shows', noShowTotals, '· plans', planTotals, '· sla', slaTotals, '· stock holds', stockTotals, '· retail sweeps', retailTotals);
  return NextResponse.json({ ok: true, tenants: tenants.length, totals, billsScheduled, rentMarkedLate, leasesRenewed, leaseWindowsSynced, reminderTotals, noShowTotals, planTotals, slaTotals, stockTotals, retailTotals, results });
}
