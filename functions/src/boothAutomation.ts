/**
 * boothAutomation.ts — v1 (PHASE 5: the automation engine)
 *
 * One scheduled function, runs daily at 7:00 AM America/New_York, three jobs:
 *
 *  1. LEASE EXPIRY LADDER — leases ending in exactly 60, 30, 7, or 1 days
 *     produce an owner notification ("Renew or re-list?"). Exact-day
 *     matching means each lease alerts once per rung, never spams.
 *
 *  2. TOMORROW'S ARRIVALS — confirmed day/hourly rentals starting tomorrow
 *     produce a heads-up notification with the guest's name, space, and
 *     time window, so the space is ready before they walk in.
 *
 *  3. AUTO-RELIST — leases whose endDate passed yesterday: if the booth
 *     has no other occupying lease, flip it back to 'vacant' so it
 *     reappears on the public listings automatically. The vacancy shows
 *     in the planner and KPIs the same morning.
 *
 * Deploy (from your functions directory, alongside onNotificationCreate):
 *   1. Save as functions/src/boothAutomation.ts
 *   2. In functions/src/index.ts add:  export { boothAutomation } from './boothAutomation';
 *   3. firebase deploy --only functions:boothAutomation
 *
 * Notifications land in tenants/{tid}/notifications — the same collection
 * your bell and push pipeline (onNotificationCreate) already consume, so
 * these alerts get push delivery for free.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();

const OCCUPYING = ['active', 'on_leave', 'pending_signature'];
const EXPIRY_RUNGS = [60, 30, 7, 1];

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function notify(db: FirebaseFirestore.Firestore, tenantId: string, message: string, link = '/booths') {
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({
    id: ref.id,
    type: 'booth_automation',
    read: false,
    createdAt: new Date().toISOString(),
    link,
    message,
  });
}

export const boothAutomation = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'America/New_York', region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const tenantsSnap = await db.collection('tenants').get();
    const today = isoDaysFromNow(0);
    const tomorrow = isoDaysFromNow(1);
    const yesterday = isoDaysFromNow(-1);

    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      try {
        // ── 1. Lease expiry ladder ────────────────────────────────────
        const leasesSnap = await db.collection(`tenants/${tenantId}/leases`).get();
        const leases = leasesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        for (const rung of EXPIRY_RUNGS) {
          const target = isoDaysFromNow(rung);
          for (const l of leases) {
            if (!OCCUPYING.includes(l.status) || l.endDate !== target) continue;
            let who = 'a renter';
            let boothName = 'a space';
            try {
              const [rSnap, bSnap] = await Promise.all([
                l.renterId ? db.doc(`tenants/${tenantId}/renters/${l.renterId}`).get() : null,
                l.boothId ? db.doc(`tenants/${tenantId}/booths/${l.boothId}`).get() : null,
              ]);
              if (rSnap?.exists) { const r = rSnap.data() as any; who = `${r.firstName || ''} ${r.lastName || ''}`.trim() || who; }
              if (bSnap?.exists) { boothName = (bSnap.data() as any).name || boothName; }
            } catch { /* names are cosmetic — never fail the job over them */ }
            await notify(db, tenantId,
              rung === 1
                ? `⏰ ${boothName}'s lease with ${who} ends TOMORROW. Renew or prepare to re-list.`
                : `📅 ${boothName}'s lease with ${who} ends in ${rung} days. Time to talk renewal.`);
          }
        }

        // ── 2. Tomorrow's arrivals ────────────────────────────────────
        const resSnap = await db.collection(`tenants/${tenantId}/boothReservations`)
          .where('startDate', '==', tomorrow).get();
        for (const d of resSnap.docs) {
          const r = d.data() as any;
          if (r.status !== 'confirmed') continue;
          const when = r.bookingType === 'hourly' && r.startTime
            ? `tomorrow ${r.startTime}–${r.endTime}`
            : `tomorrow${r.endDate !== r.startDate ? ` → ${r.endDate}` : ''}`;
          await notify(db, tenantId, `🔔 Arriving ${when}: ${r.name} — ${r.boothName}. Space ready?`);
        }

        // ── 2.5 Credential expiry ladder (v80, niche-neutral): any
        // tracked credential — license, permit, certification, insurance,
        // whatever the renter's trade requires. Exact-day rungs: 30/7/0.
        const rentersSnap = await db.collection(`tenants/${tenantId}/renters`).get();
        for (const rd of rentersSnap.docs) {
          const r = rd.data() as any;
          if (r.status && !['active', 'on_leave', 'pending'].includes(r.status)) continue;
          const who = `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'A renter';
          const creds: { label: string; expiry?: string }[] = Array.isArray(r.credentials) && r.credentials.length > 0
            ? r.credentials
            : [
                ...(r.licenseExpiry ? [{ label: 'professional license', expiry: r.licenseExpiry }] : []),
                ...(r.insuranceExpiry ? [{ label: 'liability insurance', expiry: r.insuranceExpiry }] : []),
              ];
          for (const cred of creds) {
            const exp = cred?.expiry;
            const label = (cred?.label || 'credential').toLowerCase();
            if (!exp) continue;
            for (const rung of [30, 7, 0]) {
              if (exp === isoDaysFromNow(rung)) {
                await notify(db, tenantId, rung === 0
                  ? `🔴 ${who}'s ${label} EXPIRES TODAY. They should not work until renewed — this is your liability.`
                  : `⚠ ${who}'s ${label} expires in ${rung} days (${exp}). Ask for the renewal now.`);
              }
            }
          }
        }

        // ── 2.7 No-show flag (v84): a confirmed booking whose end date
        // passed with no check-in never happened. Flag it once so the
        // owner can apply their no-show policy and free the record.
        const noShowSnap = await db.collection(`tenants/${tenantId}/boothReservations`)
          .where('status', '==', 'confirmed').get();
        for (const d of noShowSnap.docs) {
          const r = d.data() as any;
          if (r.noShow || r.actualCheckIn) continue;
          if (r.endDate && r.endDate < yesterday) {
            await d.ref.set({ noShow: true, noShowAt: new Date().toISOString() }, { merge: true });
            await notify(db, tenantId, `👻 No-show: ${r.name} never checked in for ${r.boothName} (${r.startDate}). Apply your no-show policy if needed.`);
          }
        }

        // ── 3. Auto-relist ────────────────────────────────────────────
        const endedYesterday = leases.filter(l => l.endDate === yesterday && OCCUPYING.includes(l.status));
        for (const l of endedYesterday) {
          if (!l.boothId) continue;
          const stillOccupied = leases.some(o =>
            o.id !== l.id && o.boothId === l.boothId && OCCUPYING.includes(o.status) &&
            (!o.endDate || o.endDate >= today));
          if (stillOccupied) continue;
          await db.doc(`tenants/${tenantId}/booths/${l.boothId}`).set(
            { status: 'vacant', currentRenterId: null, updatedAt: new Date().toISOString() },
            { merge: true });
          await notify(db, tenantId, `🔄 Lease ended — space re-listed as vacant and visible on your public page. Review its listing?`);
        }
      } catch (err) {
        // One tenant's bad data must never block the rest.
        console.error(`[boothAutomation] tenant ${tenantId} failed`, err);
      }
    }
  }
);
