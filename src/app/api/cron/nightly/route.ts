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
import { buildRentInvoice, leasesToInvoice, invoiceKey } from '@/lib/rent-invoices';
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
/**
 * Rent mail goes through sendNotification like every other message. It used
 * to POST straight to Resend from here, so it never appeared in the delivery
 * log, was never tracked to delivered/opened, and could not be switched or
 * reworded in message settings. The kind names already existed in the
 * catalogue; the sends simply bypassed them.
 */
async function sendRentEmail(opts: {
  db: any; tenantId: string; to: string; fromName: string; subject: string; html: string;
  kind: string; recipientId?: string | null; recipientName?: string | null;
}): Promise<boolean> {
  if (!opts.to) return false;
  try {
    const { sendNotification } = await import('@/lib/notify');
    const r = await sendNotification(opts.db, {
      tenantId: opts.tenantId, channel: 'email', to: opts.to,
      subject: opts.subject, html: opts.html, kind: opts.kind,
      recipientType: 'renter',
      recipientId: opts.recipientId || null,
      recipientName: opts.recipientName || null,
    });
    return r.ok;
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

  // ── Rent invoices — one per lease per due day, made for the owner ────────
  // The late sweep below, the due reminder, the planner and the renter portal
  // all read rentInvoices; until now nothing wrote it, so none of them ever
  // had anything to act on. Runs first so today's invoices exist before the
  // sweep judges them. Idempotent on leaseId+dueDate. Starts clean: no
  // back-fill of months that were never invoiced.
  let rentInvoiced = 0;
  for (const tDoc of (await db.collection('tenants').get()).docs) {
    try {
      const tenantData = tDoc.data() as any;
      const today = todayIn(tenantTimeZone(tenantData));
      const leasesSnap = await db.collection(`tenants/${tDoc.id}/leases`).where('status', '==', 'active').get();
      if (leasesSnap.empty) continue;
      const leases = leasesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const existingSnap = await db.collection(`tenants/${tDoc.id}/rentInvoices`).where('dueDate', '==', today).get();
      const existing = new Set(existingSnap.docs.map((d) => invoiceKey(String((d.data() as any).leaseId || ''), today)));
      const due = leasesToInvoice(leases, today, existing);
      if (due.length === 0) continue;

      const nowIso = new Date().toISOString();
      const batch = db.batch();
      const names: string[] = [];
      for (const lease of due) {
        const [renterSnap, boothSnap] = await Promise.all([
          db.doc(`tenants/${tDoc.id}/renters/${lease.renterId}`).get(),
          db.doc(`tenants/${tDoc.id}/booths/${lease.boothId}`).get(),
        ]);
        const ref = db.collection(`tenants/${tDoc.id}/rentInvoices`).doc();
        const inv = buildRentInvoice({
          id: ref.id, lease, renter: renterSnap.data(), booth: boothSnap.data(),
          dueDate: today, source: 'nightly', nowIso,
        });
        batch.set(ref, inv);
        if (names.length < 3) names.push(inv.renterName);
        rentInvoiced++;
      }
      const nRef = db.collection(`tenants/${tDoc.id}/notifications`).doc();
      batch.set(nRef, {
        id: nRef.id, type: 'rent_invoiced', read: false, createdAt: nowIso, link: '/rent',
        message: due.length === 1
          ? `Rent invoiced: ${names[0]} — due today.`
          : `Rent invoiced for ${due.length} renters (${names.join(', ')}${due.length > 3 ? ', …' : ''}) — due today.`,
      });
      await batch.commit();
      await logAuditAdmin(db, tDoc.id, {
        action: 'rent.invoice', targetType: 'rentInvoice',
        summary: `Invoiced ${due.length} lease${due.length === 1 ? '' : 's'} for ${today}`,
        actor: { type: 'system', name: 'rent-invoicer' },
      });
    } catch (e) { console.error('[cron/nightly] rent invoicing', tDoc.id, e); }
  }
  results.rentInvoiced = rentInvoiced;

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
  let profileMirrorsSynced = 0;
  let rentalDaysGranted = 0;
  let toursFlagged = 0;
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
      // ── Profile mirror + day-rental availability reconcile ────────────────
      // Two things elsewhere are written best-effort and would otherwise stay
      // wrong forever if their write happened to fail: the public half of a
      // renter's profile (mirrored onto the staff doc, which is what the
      // booking page reads) and the availability a confirmed day rental buys.
      // Both are cheap to recompute and only written when they actually differ,
      // so this stays quiet after the first pass.
      try {
        const renterSnap = await db.collection(`tenants/${tDoc.id}/renters`).get();
        const rentersById = new Map<string, any>();
        renterSnap.docs.forEach((d: any) => rentersById.set(d.id, d.data()));
        const staffSnap2 = await db.collection(`tenants/${tDoc.id}/staff`).where('isRenter', '==', true).get();

        for (const sd of staffSnap2.docs) {
          const st = sd.data() as any;
          const r = st.renterId ? rentersById.get(st.renterId) : null;
          if (!r) continue;
          const want = {
            bio: r.bio || '',
            instagram: r.instagram || '',
            photoUrl: r.photoUrl || '',
            externalBookingUrl: r.externalBookingUrl || '',
            listExternally: r.listExternally === true,
            bookingOptOut: r.bookingMode === 'own',
          };
          const drifted = Object.entries(want).some(([k, v]) => (st as any)[k] !== v && !((st as any)[k] === undefined && (v === '' || v === false)));
          if (drifted) {
            await sd.ref.set(want, { merge: true });
            profileMirrorsSynced++;
          }
        }

        // Confirmed rentals whose dates are still ahead of us should be
        // reflected in the booking system. Never touches a swap override.
        const DAY_NAMES_N = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const tenantData2 = tDoc.data() as any;
        const activeWeek = Array.isArray(tenantData2?.scheduleProfiles)
          ? (tenantData2.scheduleProfiles.find((x: any) => x.isActive)?.week || null) : null;
        const resSnap2 = await db.collection(`tenants/${tDoc.id}/boothReservations`)
          .where('status', '==', 'confirmed').get();
        const staffByRenter = new Map<string, any>();
        staffSnap2.docs.forEach((d: any) => {
          const x = d.data() as any;
          if (x.renterId && !staffByRenter.has(x.renterId)) staffByRenter.set(x.renterId, d);
        });

        for (const rd of resSnap2.docs) {
          const r: any = rd.data() || {};
          if (!r.renterId || !r.startDate) continue;
          if (String(r.endDate || r.startDate) < todayStr) continue;
          const sdoc = staffByRenter.get(r.renterId);
          if (!sdoc) continue;
          const sdata = sdoc.data() as any;
          if (sdata.bookingOptOut === true) continue;
          const isHourly = r.bookingType === 'hourly' && r.startTime && r.endTime;
          const dates = (() => {
            const out: string[] = [];
            const last = String(r.endDate || r.startDate);
            const d = new Date(`${r.startDate}T12:00:00Z`);
            while (out.length < 31) {
              const k = d.toISOString().slice(0, 10);
              out.push(k);
              if (k >= last) break;
              d.setUTCDate(d.getUTCDate() + 1);
            }
            return out;
          })();
          const flat: Record<string, any> = {};
          for (const dk of dates) {
            if (dk < todayStr) continue;
            const existing = sdata?.availability?.dates?.[dk];
            if (existing && existing.reason === 'swap') continue;
            if (existing && existing.reason === 'day_rental' && existing.reservationId === rd.id) continue;
            let start = isHourly ? String(r.startTime) : '';
            let end = isHourly ? String(r.endTime) : '';
            if (!isHourly) {
              const row = activeWeek?.[DAY_NAMES_N[new Date(`${dk}T12:00:00Z`).getUTCDay()]];
              if (!row?.enabled || !row?.start || !row?.end) continue;
              start = String(row.start); end = String(row.end);
            }
            flat[`availability.dates.${dk}`] = {
              enabled: true, start, end, reason: 'day_rental', reservationId: rd.id,
              setAt: new Date().toISOString(),
            };
            rentalDaysGranted++;
          }
          if (Object.keys(flat).length > 0) await sdoc.ref.update(flat);
        }
      } catch (e) { console.error('[cron/nightly] profile/rental reconcile', e); }


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
            type: 'lease', link: '/renters',
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
            type: 'lease', link: '/renters',
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
          type: 'rent_late', link: '/rent',
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
                db, tenantId: tDoc.id, kind: 'rent_overdue',
                recipientId: lease.renterId || null, recipientName: renterName,
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


  // ─── Tours that were never closed out ──────────────────────────────────────
  // A tour is the most expensive lead in this business: somebody drove over,
  // somebody walked them round. Every other stage of the funnel has a chaser —
  // rent has late sweeps, applications sit in a review queue — but a tour that
  // happened and was never written up simply evaporated. Nobody was told, and
  // the lead went cold in silence.
  //
  // This flags the tour, once, the day after it was due. It does not decide the
  // outcome: only the person who gave the tour knows whether it was a no-show,
  // a maybe, or a signature waiting to happen. The flag just makes sure the
  // question gets asked while the answer is still worth having.
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const tz = tenantTimeZone(tDoc.data() as any);
      const todayLocal = todayIn(tz);
      const appsSnap = await db.collection(`tenants/${tDoc.id}/boothApplications`)
        .where('kind', '==', 'tour').get();

      const stale: any[] = [];
      for (const ad of appsSnap.docs) {
        const a: any = ad.data() || {};
        // Only tours with a real date. A "time to confirm" enquiry has no
        // moment to have passed, so there is nothing to chase yet.
        const startIso = String(a.tourStartIso || (a.tourDate ? `${a.tourDate}T00:00:00` : ''));
        if (!startIso || startIso.length < 10) continue;
        const tourDay = startIso.slice(0, 10);
        if (tourDay >= todayLocal) continue;                 // still ahead of us
        // An outcome of any kind means somebody dealt with it.
        const st = String(a.status || 'new');
        if (!['new', 'in_review'].includes(st)) continue;
        if (a.tourOutcome) continue;
        if (a.followUpFlaggedAt) continue;                    // flagged already — never nag twice
        stale.push({ ref: ad.ref, id: ad.id, name: a.name || 'Someone', day: tourDay });
      }
      if (stale.length === 0) continue;

      const nowIso = new Date().toISOString();
      for (const x of stale) {
        await x.ref.set({ followUpFlaggedAt: nowIso, followUpNeeded: true }, { merge: true });
        toursFlagged++;
      }

      // ONE notification for the batch. A row per tour would be the fastest
      // way to teach somebody to swipe these away without reading them.
      const nRef = db.collection(`tenants/${tDoc.id}/notifications`).doc();
      const names = stale.slice(0, 3).map((x) => x.name).join(', ');
      await nRef.set({
        id: nRef.id, type: 'tour_followup', read: false, createdAt: nowIso, link: '/pipeline',
        message: stale.length === 1
          ? `${names} toured on ${stale[0].day} and it was never closed out — record the outcome while it is still fresh.`
          : `${stale.length} tours were never closed out (${names}${stale.length > 3 ? ', …' : ''}) — record the outcomes in Pipeline.`,
      });
    } catch (e) { console.error('[cron/nightly] tour follow-up', tDoc.id, e); }
  }
  results.tourFollowUps = toursFlagged;

  // ── Requests nobody answered ──────────────────────────────────────────────
  // With approval switched on, a tour request the owner never decides on sits
  // at "Awaiting your OK" past its own date, forever — still blocking the slot
  // in the checker, still on the pipeline as if a decision were coming. Worse,
  // the person who asked is still waiting. The day after the requested time
  // has gone, this closes it as expired, frees the slot, and tells them —
  // warmly, with the link to pick a fresh time. Once, never twice.
  let toursExpired = 0;
  for (const tDoc of allTenantsSnap.docs) {
    try {
      const tenantData = tDoc.data() as any;
      const tz = tenantTimeZone(tenantData);
      const todayLocal = todayIn(tz);
      const toursSnap = await db.collection(`tenants/${tDoc.id}/tours`)
        .where('status', '==', 'requested').get();
      if (toursSnap.empty) continue;

      const studio = String(tenantData.name || tenantData.businessName || '').trim() || 'The studio';
      const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://studio-one-blue.vercel.app';
      const nowIso = new Date().toISOString();
      let expiredHere = 0;
      const names: string[] = [];

      for (const td of toursSnap.docs) {
        const t: any = td.data() || {};
        if (!t.date || String(t.date) >= todayLocal) continue;     // still ahead of us
        if (t.expiredAt) continue;

        await td.ref.set({ status: 'expired', expiredAt: nowIso }, { merge: true });
        // The lead follows the tour: an expired request is a decision that was
        // never made, which is its own kind of answer.
        const appId = String(t.applicationId || '');
        if (appId) {
          await db.doc(`tenants/${tDoc.id}/boothApplications/${appId}`)
            .set({ status: 'expired', expiredAt: nowIso, followUpNeeded: true }, { merge: true })
            .catch(() => { /* the tour is already closed */ });
        }

        // Tell them. They asked for a time and heard nothing; silence past the
        // date reads as "we ignored you". A message with the door open reads
        // as "we missed it, come back".
        const to = String(t.email || '').trim();
        if (to.includes('@')) {
          try {
            const { sendNotification } = await import('@/lib/notify');
            const first = String(t.name || '').trim().split(' ')[0] || 'there';
            await sendNotification(db, {
              tenantId: tDoc.id, channel: 'email', to,
              subject: 'We missed your visit request — sorry',
              html: brandedEmailHtml({
                studioName: studio,
                title: 'We missed your request',
                bodyLines: [
                  `Hi ${first} — you asked to visit us on ${t.date}${t.time ? ` at ${t.time}` : ''} and we did not get back to you in time. That is on us.`,
                  'We would still love to show you around. Pick any time that suits you and it goes straight onto our calendar.',
                ],
                cta: { label: 'Pick a new time', url: `${origin}/tour/${tDoc.id}` },
                footerNote: `Sent by ${studio}. You're receiving this because you asked to visit us.`,
              }),
              kind: 'tour_request_expired',
              recipientType: 'contact', recipientId: td.id, recipientName: t.name || null,
              eventConfirmed: false,
            });
          } catch { /* best-effort */ }
        }
        expiredHere++; toursExpired++;
        if (names.length < 3) names.push(t.name || 'Someone');
      }

      if (expiredHere > 0) {
        // The owner hears about it too — a request that slipped is a process
        // problem worth noticing, not just a record to tidy.
        const nRef = db.collection(`tenants/${tDoc.id}/notifications`).doc();
        await nRef.set({
          id: nRef.id, type: 'tour_request_expired', read: false, createdAt: nowIso, link: '/pipeline',
          message: expiredHere === 1
            ? `${names[0]} asked for a tour and never got an answer — the request has expired and they've been invited to pick a new time.`
            : `${expiredHere} tour requests went unanswered past their dates (${names.join(', ')}${expiredHere > 3 ? ', …' : ''}) — each has been invited to rebook.`,
        });
      }
    } catch (e) { console.error('[cron/nightly] tour request expiry', tDoc.id, e); }
  }
  results.tourRequestsExpired = toursExpired;

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
        await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: nowIso, link: '/maintenance',
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
        await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: nowIso, link: '/maintenance',
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

  console.log('[cron/nightly] synced', tenants.length, 'tenants', totals, '· bills scheduled', billsScheduled, '· rent marked late', rentMarkedLate, '· leases renewed', leasesRenewed, '· lease windows synced', leaseWindowsSynced, '· profile mirrors', profileMirrorsSynced, '· rental days granted', rentalDaysGranted, '· tours flagged', toursFlagged, '· reminders', reminderTotals, '· no-shows', noShowTotals, '· plans', planTotals, '· sla', slaTotals, '· stock holds', stockTotals, '· retail sweeps', retailTotals);
  return NextResponse.json({ ok: true, tenants: tenants.length, totals, billsScheduled, rentMarkedLate, leasesRenewed, leaseWindowsSynced, profileMirrorsSynced, rentalDaysGranted, toursFlagged, reminderTotals, noShowTotals, planTotals, slaTotals, stockTotals, retailTotals, results });
}
