// src/lib/reminders.ts
//
// Nightly reminder sweep. For one tenant, emits owner-facing, in-app
// reminders (tenants/{id}/notifications) for the things that quietly slip:
//
//   • Tour reminders     — a confirmed/pending tour happening in the next 2 days
//   • Balance due        — a rent invoice coming due in the next 3 days
//   • License expiry     — a renter credential expiring within 30 days (or expired)
//   • Lease renewal      — an active, non-auto-renew lease ending within 30 days
//
// Design guarantees (this is run EVERY night, so correctness = idempotence):
//   - Every reminder is stamped after it fires (a field on the source doc) and
//     never fires twice for the same milestone. Re-running the sweep is a no-op.
//   - Each item is wrapped in its own try/catch: one malformed doc can't stop
//     the rest, and a whole category failing can't stop the others.
//   - No external side effects (no emails/SMS) — purely in-app notifications,
//     matching the rest of the nightly cron. Email can be layered on later by
//     calling sendNotification() alongside pushNotification().
//
// All date math is UTC. Times shown in tour reminders come from the stored
// human-readable slot label (already localized when booked), never reformatted
// from an ISO instant — so we never show the wrong timezone.

import { logAuditAdmin } from './audit';

type Db = any;

export interface ReminderCounts {
  tourReminders: number;
  balanceDue: number;
  licenseExpiry: number;
  leaseRenewal: number;
  contactFollowUps: number;
}

// Resolved (non-actionable) tour statuses — these never get a reminder.
const RESOLVED_TOUR_STATUSES = new Set([
  'declined', 'cancelled', 'canceled', 'closed', 'completed',
  'no_show', 'checked_in', 'archived', 'done', 'converted',
]);

const DAY_MS = 86400000;
const iso = (d: Date) => d.toISOString();
const dateOnly = (v: any) => String(v || '').slice(0, 10);

// Whole days from start-of-today (UTC) to a YYYY-MM-DD date. Negative = past.
function daysUntil(dateStr: string, todayStr: string): number | null {
  const d = dateOnly(dateStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const target = new Date(d + 'T00:00:00Z').getTime();
  const today = new Date(todayStr + 'T00:00:00Z').getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / DAY_MS);
}

// Friendly UTC date label, e.g. "Mon, Jul 20".
function fmtDate(dateStr: string): string {
  const d = dateOnly(dateStr);
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  } catch { return d; }
}

// "today" / "tomorrow" / a date — relative to the run day.
function relDay(days: number, dateStr: string): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `on ${fmtDate(dateStr)}`;
}

const money = (cents: any) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;

async function pushNotification(db: Db, tenantId: string, n: { type: string; link: string; message: string }) {
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({
    id: ref.id, userId: null, read: false, createdAt: iso(new Date()),
    type: n.type, link: n.link, message: n.message,
  });
}

const renterName = (r: any): string =>
  `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || r?.name || 'A renter';

// Replicates booths-page complianceOf(): missing / expired / expiring(≤30d) / ok.
function credentialsOf(r: any): { label: string; expiry: string }[] {
  const out: { label: string; expiry: string }[] = [];
  if (Array.isArray(r?.credentials)) {
    for (const cr of r.credentials) {
      if (cr?.label && cr?.expiry) out.push({ label: String(cr.label), expiry: dateOnly(cr.expiry) });
    }
  }
  // Legacy single-field credentials — only if no structured credentials exist.
  if (out.length === 0) {
    if (r?.licenseExpiry) out.push({ label: 'Professional license', expiry: dateOnly(r.licenseExpiry) });
    if (r?.insuranceExpiry) out.push({ label: `Liability insurance${r?.insuranceCarrier ? ` (${r.insuranceCarrier})` : ''}`, expiry: dateOnly(r.insuranceExpiry) });
  }
  return out;
}

const sanitizeKey = (s: string) => s.replace(/[^\w-]/g, '_').slice(0, 80);

/**
 * Run the reminder sweep for a single tenant. Returns per-category counts of
 * reminders actually sent this run (0s when everything is already handled).
 */
export async function runReminderSweep(db: Db, tenantId: string, now: Date = new Date()): Promise<ReminderCounts> {
  const counts: ReminderCounts = { tourReminders: 0, balanceDue: 0, licenseExpiry: 0, leaseRenewal: 0, contactFollowUps: 0 };
  const nowMs = now.getTime();
  const todayStr = iso(now).slice(0, 10);

  // ── Load once: leases + renters (shared by balance-due, license, renewal) ──
  let leaseDocs: any[] = [];
  let renterById = new Map<string, any>();
  try {
    const [leasesSnap, rentersSnap] = await Promise.all([
      db.collection(`tenants/${tenantId}/leases`).get(),
      db.collection(`tenants/${tenantId}/renters`).get(),
    ]);
    leaseDocs = leasesSnap.docs;
    renterById = new Map(rentersSnap.docs.map((d: any) => [d.id, d.data()]));
  } catch { /* if these fail, the categories below simply find nothing */ }

  const leaseById = new Map(leaseDocs.map((d: any) => [d.id, d.data()]));
  const activeLeaseRenterIds = new Set(
    leaseDocs.map((d: any) => d.data()).filter((l: any) => l?.status === 'active' && l?.renterId).map((l: any) => l.renterId),
  );

  // ── 1) TOUR REMINDERS ──────────────────────────────────────────────────────
  // Tours (boothApplications kind:'tour') starting within the next 2 days,
  // with a concrete time, not already reminded, not in a resolved state.
  try {
    const toursSnap = await db.collection(`tenants/${tenantId}/boothApplications`)
      .where('kind', '==', 'tour').get();
    for (const doc of toursSnap.docs) {
      try {
        const t = doc.data() as any;
        if (t.tourReminderSentAt) continue;
        if (t.tourTimeTBD || !t.tourStartIso) continue;
        if (RESOLVED_TOUR_STATUSES.has(String(t.status || '').toLowerCase())) continue;
        const startMs = new Date(t.tourStartIso).getTime();
        if (Number.isNaN(startMs)) continue;
        const delta = startMs - nowMs;
        if (delta < 0 || delta > 2 * DAY_MS) continue; // only the next 2 days
        const startDateStr = dateOnly(t.tourStartIso);
        const when = t.tourSlot ? `· ${t.tourSlot}` : relDay(daysUntil(startDateStr, todayStr) ?? 0, startDateStr);
        await pushNotification(db, tenantId, {
          type: 'tour_reminder', link: '/booths',
          message: `Upcoming tour: ${t.name || 'A visitor'} at ${t.boothName || 'your studio'} ${when}.`,
        });
        await doc.ref.set({ tourReminderSentAt: iso(now) }, { merge: true });
        counts.tourReminders++;
      } catch { /* skip this tour */ }
    }
  } catch { /* no tours / query failed */ }

  // ── 2) BALANCE DUE ─────────────────────────────────────────────────────────
  // Rent invoices still 'due' with a due date in the next 3 days. Fires once
  // per invoice (stamped dueSoonNotifiedAt). Late invoices are handled by the
  // late-rent sweep, so they never reach here.
  try {
    const dueSnap = await db.collection(`tenants/${tenantId}/rentInvoices`)
      .where('status', '==', 'due').get();
    for (const inv of dueSnap.docs) {
      try {
        const v = inv.data() as any;
        if (v.dueSoonNotifiedAt) continue;
        const d = daysUntil(v.dueDate, todayStr);
        if (d === null || d < 0 || d > 3) continue; // due within the next 3 days
        const lease: any = v.leaseId ? leaseById.get(v.leaseId) : null;
        const who = lease?.renterId ? renterName(renterById.get(lease.renterId)) : (v.renterName || 'A renter');
        const total = (Number(v.amountCents) || 0) + (Number(v.lateFeeCents) || 0);
        await pushNotification(db, tenantId, {
          type: 'balance_due', link: '/booths',
          message: `${who}'s rent of ${money(total)} is due ${relDay(d, v.dueDate)}.`,
        });
        await inv.ref.set({ dueSoonNotifiedAt: iso(now) }, { merge: true });
        counts.balanceDue++;
      } catch { /* skip this invoice */ }
    }
  } catch { /* no invoices / query failed */ }

  // ── 3) LICENSE / CREDENTIAL EXPIRY ─────────────────────────────────────────
  // For renters with an active lease, alert once when a credential enters the
  // 30-day window ('expiring') and once when it actually lapses ('expired').
  // Dedupe map lives on the renter: licenseAlerts[key] = stage.
  for (const renterId of activeLeaseRenterIds) {
    try {
      const r = renterById.get(renterId);
      if (!r) continue;
      const creds = credentialsOf(r);
      if (!creds.length) continue;
      const alerts: Record<string, string> = (r.licenseAlerts && typeof r.licenseAlerts === 'object') ? { ...r.licenseAlerts } : {};
      let changed = false;
      for (const c of creds) {
        const d = daysUntil(c.expiry, todayStr);
        if (d === null) continue;
        const key = sanitizeKey(`${c.label}__${c.expiry}`);
        const prior = alerts[key];
        if (d < 0) {
          if (prior === 'expired') continue;
          await pushNotification(db, tenantId, {
            type: 'license_expiry', link: '/booths',
            message: `${renterName(r)}'s ${c.label} EXPIRED ${fmtDate(c.expiry)} — collect a renewal.`,
          });
          alerts[key] = 'expired'; changed = true; counts.licenseExpiry++;
        } else if (d <= 30) {
          if (prior === 'expiring' || prior === 'expired') continue;
          await pushNotification(db, tenantId, {
            type: 'license_expiry', link: '/booths',
            message: `${renterName(r)}'s ${c.label} expires ${relDay(d, c.expiry)} (${fmtDate(c.expiry)}).`,
          });
          alerts[key] = 'expiring'; changed = true; counts.licenseExpiry++;
        }
      }
      if (changed) {
        await db.doc(`tenants/${tenantId}/renters/${renterId}`).set({ licenseAlerts: alerts }, { merge: true });
      }
    } catch { /* skip this renter */ }
  }

  // ── 4) LEASE RENEWAL (proactive) ───────────────────────────────────────────
  // Active, non-auto-renew leases ending within 30 days get a 30-day heads-up
  // and then a 7-day nudge. renewalReminderStage tracks the last stage sent and
  // resets once the lease is comfortably far out again (e.g. after a renewal).
  for (const ld of leaseDocs) {
    try {
      const l = ld.data() as any;
      if (l.status !== 'active' || l.autoRenew || !l.endDate) continue;
      const d = daysUntil(l.endDate, todayStr);
      if (d === null || d < 0) continue; // already ended → handled by the expiry nudge elsewhere
      const stage = Number(l.renewalReminderStage) || 0;
      const who = l.renterId ? renterName(renterById.get(l.renterId)) : 'A renter';
      const space = l.boothName || 'a space';
      if (d > 30) {
        if (stage !== 0) await ld.ref.set({ renewalReminderStage: 0 }, { merge: true });
        continue;
      }
      if (d <= 7 && stage !== 7) {
        await pushNotification(db, tenantId, {
          type: 'lease_renewal', link: '/booths',
          message: `${who}'s lease for ${space} ends ${relDay(d, l.endDate)} (${fmtDate(l.endDate)}) — renew or end it.`,
        });
        await ld.ref.set({ renewalReminderStage: 7 }, { merge: true });
        counts.leaseRenewal++;
      } else if (d <= 30 && stage === 0) {
        await pushNotification(db, tenantId, {
          type: 'lease_renewal', link: '/booths',
          message: `${who}'s lease for ${space} ends ${fmtDate(l.endDate)} (${d} days) — plan the renewal.`,
        });
        await ld.ref.set({ renewalReminderStage: 30 }, { merge: true });
        counts.leaseRenewal++;
      }
    } catch { /* skip this lease */ }
  }

  // ── 5) CONTACT FOLLOW-UPS ──────────────────────────────────────────────────
  // A lead the owner chose to nurture: when the follow-up date they set arrives
  // (or has passed), surface it once. Won/lost contacts are never nudged. Deduped
  // by followUpNotifiedFor === the exact date, so re-scheduling re-arms it.
  try {
    const snap = await db.collection(`tenants/${tenantId}/contacts`).get();
    for (const doc of snap.docs) {
      try {
        const c = doc.data() as any;
        const due = dateOnly(c.nextFollowUpAt);
        if (!due) continue;
        if (c.pipelineStage === 'won' || c.pipelineStage === 'lost') continue;
        const d = daysUntil(due, todayStr);
        if (d === null || d > 0) continue;            // only due today or overdue
        if (c.followUpNotifiedFor === c.nextFollowUpAt) continue;
        const contactRef = c.phone || c.email || '';
        await pushNotification(db, tenantId, {
          type: 'contact_followup',
          link: contactRef ? `/booths?contact=${encodeURIComponent(contactRef)}` : '/booths',
          message: `Follow up with ${c.name || 'a contact'}${c.phone ? ` (${c.phone})` : ''} — you set a reminder for ${fmtDate(due)}.`,
        });
        await doc.ref.set({ followUpNotifiedFor: c.nextFollowUpAt }, { merge: true });
        counts.contactFollowUps++;
      } catch { /* skip this contact */ }
    }
  } catch { /* no contacts / query failed */ }

  const total = counts.tourReminders + counts.balanceDue + counts.licenseExpiry + counts.leaseRenewal + counts.contactFollowUps;
  if (total > 0) {
    try {
      await logAuditAdmin(db, tenantId, {
        action: 'reminders.swept', targetType: 'tenant', targetId: tenantId,
        summary: `Sent ${total} reminder${total === 1 ? '' : 's'} — ${counts.tourReminders} tour, ${counts.balanceDue} balance-due, ${counts.licenseExpiry} license, ${counts.leaseRenewal} lease-renewal, ${counts.contactFollowUps} follow-up`,
        actor: { type: 'system', name: 'reminders' },
      });
    } catch { /* audit is best-effort */ }
  }

  return counts;
}
