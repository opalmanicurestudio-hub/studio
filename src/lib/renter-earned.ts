// src/lib/renter-earned.ts — WHAT A RENTER EARNED THROUGH CLARITYFLOW (server; the renter portal's Earnings and expenses,
// api/portal/renter 'ledger', and their tax set-aside, api/portal/renter-taxes). Completed visits at their own prices (a
// visit a package covers is $0 on the day: the money came in when the package sold), package sales, and memberships in
// the month they were paid. Read from their own provider records only.

/** Their provider record: the one the portal reads, flagged as a renter and active. */
export async function renterProvider(db: any, tenantId: string, renterId: string): Promise<any | null> {
  if (!renterId) return null;
  const stSnap = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', renterId).get();
  return stSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).find((m: any) => m.isRenter && m.isActive !== false) || null;
}

// EVERY staff record that belongs to this renter — not just the one flagged as the provider. A renter who was an employee
// first, or was set up through the old rent page, can have two records with the same name: old appointments point at the
// old one, the portal reads the new one. Their chair is their chair whichever record booked it, so the book reads all.
export async function renterStaffIds(db: any, tenantId: string, renterId: string): Promise<string[]> {
  if (!renterId) return [];
  const stSnap = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', renterId).get();
  const ids = stSnap.docs.map((d: any) => d.id);
  // Same person by name, never linked (renterId missing on the old record).
  const r = ((await db.doc(`tenants/${tenantId}/renters/${renterId}`).get()).data() as any) || {};
  const full = `${r.firstName || ''} ${r.lastName || ''}`.trim().toLowerCase();
  if (full) {
    const byName = await db.collection(`tenants/${tenantId}/staff`).get();
    // (Never a record linked to someone, as another renter with the same name has their own; and never a current
    // employee's, whose bookings are the business's clients.)
    for (const d of byName.docs) { const x = d.data() as any; if (!ids.includes(d.id) && String(x.name || '').trim().toLowerCase() === full && !x.renterId && (x.isRenter || x.isActive === false)) ids.push(d.id); }
  }
  return ids.slice(0, 10); // Firestore 'in' cap
}

// Three ways down, so a missing Firestore index can never blank the book:
//   1. staffId IN ids + date range (needs a composite index)
//   2. one staffId == id + date range per record (needs the older index)
//   3. staffId == id only, dates filtered in memory (needs NO index)
export async function renterAppointments(db: any, tenantId: string, ids: string[], fromIso: string, toIso?: string): Promise<any[]> {
  if (ids.length === 0) return [];
  const col = db.collection(`tenants/${tenantId}/appointments`);
  const inRange = (a: any) => String(a.startTime || '') >= fromIso && (!toIso || String(a.startTime || '') <= toIso);
  try {
    let q: any = col.where('staffId', 'in', ids).where('startTime', '>=', fromIso);
    if (toIso) q = q.where('startTime', '<=', toIso);
    return (await q.get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  } catch (e1) {
    console.warn('[portal/renter] appointments: IN+range query unavailable (index?), falling back', String((e1 as any)?.message || e1).slice(0, 160));
  }
  try {
    const out: any[] = [];
    for (const id of ids) {
      let q: any = col.where('staffId', '==', id).where('startTime', '>=', fromIso);
      if (toIso) q = q.where('startTime', '<=', toIso);
      out.push(...(await q.get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })));
    }
    return out;
  } catch (e2) {
    console.warn('[portal/renter] appointments: ==+range query unavailable (index?), falling back to in-memory', String((e2 as any)?.message || e2).slice(0, 160));
  }
  const out: any[] = [];
  for (const id of ids) {
    const snap = await col.where('staffId', '==', id).get();
    out.push(...snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter(inRange));
  }
  return out;
}

/** What they earned between two times (ISO, the end not included): their completed visits and their package and
 *  membership sales, as Earnings and expenses lists them. */
export async function renterEarned(db: any, tenantId: string, renterId: string, from: string, to: string, opts: { eachMonth?: { today: string } } = {}): Promise<{ visits: any[]; packages: any[] }> {
  const st = await renterProvider(db, tenantId, renterId);
  const ids = st ? await renterStaffIds(db, tenantId, renterId) : [];
  const appts = ids.length ? (await renterAppointments(db, tenantId, ids, from, to)).filter((a: any) => a.isRenterBooking && (a.status === 'completed' || a.renterOutcome === 'completed') && String(a.startTime || '') < to) : [];
  const visits = appts.map((a: any) => ({ id: a.id, date: String(a.startTime).slice(0, 10), clientName: a.clientName || 'Client', serviceName: a.renterServiceName || a.serviceName || '', cents: a.paidByPackageId ? 0 : Math.max(0, Math.round((Number(a.renterServicePrice) || 0) * 100) - (Number(a.renterDiscountCents) || 0)), discountCents: Number(a.renterDiscountCents) || 0, covered: !!a.paidByPackageId, packageName: a.paidByPackageName || null }))
    .sort((x: any, y: any) => x.date.localeCompare(y.date));
  const pur = st ? (await db.collection(`tenants/${tenantId}/renterPackagePurchases`).where('staffId', '==', st.id).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((p: any) => String(p.purchasedAt || '') >= from && String(p.purchasedAt || '') < to && p.status !== 'refunded') : [];
  const packages = pur.map((p: any) => ({ id: p.id, date: String(p.purchasedAt).slice(0, 10), clientName: p.clientName || 'Client', packageName: p.packageName || 'Package', cents: Number(p.amountCents) || 0, source: p.source || 'stripe' }));
  // Membership income: active members' monthly price counts in the month it was last paid (start or renewal).
  const subs = st ? (await db.collection(`tenants/${tenantId}/renterMemberSubscriptions`).where('staffId', '==', st.id).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) : [];
  for (const m of subs as any[]) {
    // (Over a longer stretch, eachMonth: every month it's run, on the day of the month it started, up to today and
    // before it ended.)
    // A plan cancelled at the end of its period is billed no more after the request (it stops at the period's end); one
    // never paid for isn't counted.
    if (opts.eachMonth && ['incomplete', 'incomplete_expired', 'unpaid'].includes(String(m.status || ''))) continue;
    const stop = m.endedAt ? String(m.endedAt).slice(0, 10) : m.cancelAtPeriodEnd ? (m.currentPeriodEnd ? String(m.currentPeriodEnd).slice(0, 10) : m.cancelRequestedAt ? dayAfter(String(m.cancelRequestedAt).slice(0, 10)) : null) : null;
    if (opts.eachMonth && m.startedAt) for (const day of monthlyDays(String(m.startedAt).slice(0, 10), from.slice(0, 10), to.slice(0, 10), opts.eachMonth.today, stop)) {
      packages.push({ id: `m-${m.id}-${day}`, date: day, clientName: m.clientName || 'Member', packageName: `${m.membershipName || 'Membership'} (monthly)`, cents: Number(m.priceCents) || 0, source: 'stripe' });
    }
    else { const paid = String(m.lastPaidAt || m.startedAt || ''); if (paid >= from && paid < to) packages.push({ id: `m-${m.id}`, date: paid.slice(0, 10), clientName: m.clientName || 'Member', packageName: `${m.membershipName || 'Membership'} (monthly)`, cents: Number(m.priceCents) || 0, source: 'stripe' }); }
  }
  return { visits, packages };
}

/** The days a monthly plan started on `start` was billed from `from` up to (not including) `to`, up to `today` and before
 *  `ended`: the same day each month, or the month's last day when it's shorter. */
export function monthlyDays(start: string, from: string, to: string, today: string, ended: string | null): string[] {
  const out: string[] = []; const [sy, sm, sd] = start.split('-').map(Number); if (!sy || !sm || !sd) return out;
  for (let i = 0; i < 600; i++) {
    const y = sy + Math.floor((sm - 1 + i) / 12), m = ((sm - 1 + i) % 12) + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(sd, last)).padStart(2, '0')}`;
    if (day >= to || day > today || (ended && day >= ended)) break;
    if (day >= from) out.push(day);
  }
  return out;
}
const dayAfter = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
