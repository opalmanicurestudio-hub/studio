// src/lib/renter-account-notice.ts — TELLING A RENTER ABOUT A CHANGE MADE TO THEIR ACCOUNT BY HAND (server).
// The Rent page adds a charge, waives a late fee, a bill or a charge, and approves banked days off as credit, writing the
// change itself; it then asks for the renter to be told (api/rent/notify). The notice is written from the record as it
// is on the server, never from what the screen sends, only for a change made in the last day, and once per change:
//   charge_added    a charge to pay with their rent       Messages: "Charge added" (can't be switched off: they owe it)
//   fee_waived      a late fee waived                     Messages: "Waived or credited"
//   bill_waived     a whole rent bill waived              Messages: "Waived or credited"
//   charge_waived   a charge waived                       Messages: "Waived or credited"
//   credit_added    credit for banked days off            Messages: "Waived or credited" (and it comes off their
//                                                          open bills now)
// Each also leaves a note in their portal.

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usd = (c: number) => `$${(Math.max(0, Math.round(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const day = (iso: any) => { const s = String(iso || '').slice(0, 10); const d = new Date(`${s}T12:00:00Z`); return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const DAY_MS = 24 * 3600 * 1000;

export type AccountChange = 'charge_added' | 'fee_waived' | 'bill_waived' | 'charge_waived' | 'credit_added';
export const ACCOUNT_CHANGES: AccountChange[] = ['charge_added', 'fee_waived', 'bill_waived', 'charge_waived', 'credit_added'];

// Recent: in the last day (a screen whose clock runs ahead is allowed half an hour).
const recent = (iso: any, now: number) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) && now - t < DAY_MS && t - now < 30 * 60000; };
const plainReason = (r: any, generic: string[]) => { const s = String(r || '').trim(); return s && !generic.includes(s) ? `${s.replace(/\.$/, '')}.` : ''; };

/** What to tell the renter, read from the record. Null when the record isn't that change (or isn't recent). */
async function compose(db: any, T: string, kind: AccountChange, id: string, now: number): Promise<{ renterId: string; message: 'renter_charge_added' | 'renter_credit'; tokens: Record<string, string>; alert: string; tone: string } | null> {
  if (kind === 'fee_waived' || kind === 'bill_waived') {
    const inv: any = (await db.doc(`${T}/rentInvoices/${id}`).get()).data() || null;
    if (!inv?.renterId) return null;
    if (kind === 'fee_waived') {
      if (!recent(inv.feeWaivedAt, now) || !(n(inv.feeWaivedCents) > 0)) return null;
      const headline = `We waived the ${usd(n(inv.feeWaivedCents))} late fee on your rent due ${day(inv.dueDate)}.`;
      const details = plainReason(inv.feeWaivedReason, ['Late fee waived']);
      return { renterId: inv.renterId, message: 'renter_credit', tokens: { headline, details, amount: usd(n(inv.feeWaivedCents)) }, alert: `${headline}${details ? ` ${details}` : ''}`, tone: 'green' };
    }
    if (inv.status !== 'void' || inv.voidReason !== 'waived' || !recent(inv.voidedAt, now)) return null;
    const owed = Math.max(0, n(inv.amountCents) + n(inv.lateFeeCents) - n(inv.paidCents));
    const headline = `We waived your rent due ${day(inv.dueDate)}${owed > 0 ? ` (${usd(owed)})` : ''}. You don’t owe it.`;
    const details = plainReason(inv.voidNote, ['Invoice waived']);
    return { renterId: inv.renterId, message: 'renter_credit', tokens: { headline, details, amount: usd(owed) }, alert: `${headline}${details ? ` ${details}` : ''}`, tone: 'green' };
  }
  const e: any = (await db.doc(`${T}/rentLedger/${id}`).get()).data() || null;
  if (!e?.renterId) return null;
  const cents = Math.abs(n(e.amountCents));
  const what = String(e.description || 'a charge').trim();
  if (kind === 'charge_added') {
    if (!['one_off_charge', 'charge'].includes(String(e.type)) || e.status !== 'pending' || !(n(e.amountCents) > 0) || !recent(e.createdAt, now)) return null;
    const when = e.dueDate ? day(e.dueDate) : 'with your next rent';
    return { renterId: e.renterId, message: 'renter_charge_added', tokens: { amount: usd(cents), what, when },
      alert: `A charge of ${usd(cents)} for ${what} was added to your account, due ${when}.`, tone: 'slate' };
  }
  if (kind === 'charge_waived') {
    // Waived on the Rent page (it stamps waivedAt), not written off or folded into a waived bill.
    if (e.status !== 'waived' || !(n(e.amountCents) > 0) || !recent(e.waivedAt, now)) return null;
    const headline = `We waived the ${usd(cents)} charge for ${what}. You don’t owe it.`;
    return { renterId: e.renterId, message: 'renter_credit', tokens: { headline, details: '', amount: usd(cents) }, alert: headline, tone: 'green' };
  }
  if (e.type !== 'leave_credit' || !(n(e.amountCents) < 0) || !recent(e.createdAt, now)) return null;
  const headline = `We added ${usd(cents)} of credit to your account: ${what}. It comes off what you owe.`;
  return { renterId: e.renterId, message: 'renter_credit', tokens: { headline, details: plainReason(e.note, []), amount: usd(cents) }, alert: headline, tone: 'green' };
}

/** Tell the renter about one change, once. Returns who it went to (null when nothing was sent). */
export async function noticeAccountChange(db: any, tenantId: string, tenant: any, kind: AccountChange, id: string, nowMs: number = Date.now()): Promise<{ ok: boolean; sentTo: string | null; reason?: string }> {
  const T = `tenants/${tenantId}`; const key = safe(id);
  if (!ACCOUNT_CHANGES.includes(kind) || !key) return { ok: false, sentTo: null, reason: 'unknown' };
  const c = await compose(db, T, kind, key, nowMs);
  if (!c) return { ok: false, sentTo: null, reason: 'not_found' };
  // Credit comes off their open bills now, not at the next new bill (lib/rent-credits; safe to run twice).
  if (kind === 'credit_added') {
    try { const { applyCreditsToOpenBills } = await import('@/lib/rent-credits'); await applyCreditsToOpenBills(db, tenantId, c.renterId); }
    catch (e) { console.error('[renter-account-notice] credit', tenantId, key, e); }
  }
  // Claimed first, so two asks never both send; a claim whose send never finished is taken over after ten minutes.
  const mark = db.doc(`${T}/renterNotices/${kind}_${key}`);
  const mine = await db.runTransaction(async (tx: any) => {
    const m: any = (await tx.get(mark)).data() || null;
    if (m && (m.doneAt || nowMs - (Date.parse(String(m.at || '')) || 0) < 10 * 60000)) return false;
    tx.set(mark, { kind, recordId: key, renterId: c.renterId, at: new Date(nowMs).toISOString() }, { merge: true });
    return true;
  }).catch(() => false);
  if (!mine) return { ok: true, sentTo: null, reason: 'already' };
  try {
    const aRef = db.doc(`${T}/renterAlerts/${kind}_${key}`);
    await aRef.set({ id: aRef.id, renterId: c.renterId, kind: kind === 'charge_added' ? 'charge' : 'credit', tab: 'rent', tone: c.tone, at: new Date(nowMs).toISOString(), text: c.alert });
  } catch { /* the message still goes */ }
  let sentTo: string | null = null;
  try {
    const { sendRenterMoneyNotice } = await import('@/lib/account-receipts');
    const { linkOrigin } = await import('@/lib/app-origin');
    const base = linkOrigin(tenant);
    sentTo = (await sendRenterMoneyNotice(db, tenantId, tenant, { kind: c.message, renterId: c.renterId, tokens: { ...c.tokens, link: base ? `${base}/rent/${encodeURIComponent(tenantId)}?tab=rent` : '' } })).sentTo;
    await mark.set({ sentTo, doneAt: new Date().toISOString() }, { merge: true });
  } catch (e) { console.error('[renter-account-notice]', tenantId, kind, key, e); }
  return { ok: true, sentTo };
}
