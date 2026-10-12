// lib/undo-cancel.ts — a client who cancels from their link can take it back for 15 minutes.
//
// Only when nothing moved money: no fee, no paid deposit, no package or membership credit, not a
// reschedule, not a whole series, not a renter's booking. While the window is open the waitlist and
// Tidy my day leave the time alone (detectOpenings waits); someone booking it online in the meantime
// ends the undo, and the client is told so.
export const UNDO_MIN = 15;
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected'];
const ms = (v: any) => (v ? Date.parse(String(v)) || 0 : 0);

/** Can this self-cancel be undone? (decided by the self-cancel route as it cancels) */
export function undoAllowed(a: any, o: { byClient: boolean; feeCharged: boolean; reschedule: boolean; series: boolean; usedGrace: boolean }) {
  if (!o.byClient || o.feeCharged || o.reschedule || o.series || o.usedGrace) return false;
  if (a.isRenterBooking || a.paidByPackageId || a.paidByMembershipId) return false;
  if (a.depositStatus === 'paid' || a.depositPaidAt || a.renterDepositPaidAt) return false;
  return true;
}

/** Is the time still free for this provider? (another visit or a live block means no) */
export async function timeStillFree(db: any, t: string, a: any, now: number) {
  const s = ms(a.startTime), e = ms(a.endTime) || s + (Number(a.durationMin || a.duration) || 60) * 60000;
  const day = 864e5;
  const appts = (await db.collection(`tenants/${t}/appointments`).where('startTime', '>=', new Date(s - day).toISOString()).where('startTime', '<=', new Date(e).toISOString()).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const clash = appts.some((o: any) => o.id !== a.id && o.staffId === a.staffId && !DEAD.includes(String(o.status || '')) && ms(o.startTime) < e && (ms(o.endTime) || ms(o.startTime) + (Number(o.durationMin || o.duration) || 60) * 60000) > s);
  if (clash) return false;
  const blocks = (await db.collection(`tenants/${t}/staffBlocks`).where('staffId', '==', a.staffId).get()).docs.map((d: any) => d.data());
  return !blocks.some((b: any) => { if (b.until && ms(b.until) <= now) return false; const bs = ms(b.startTime), be = bs + (Number(b.duration) || 0) * 60000; return bs < e && be > s; });
}

export type UndoResult = { ok: true } | { ok: false; code: 'not_found' | 'needs_link' | 'not_cancelled' | 'too_late' | 'taken'; error: string };

/** Put the visit back. The key is the client's visit token (the same one that cancelled it). */
export async function undoCancel(db: any, t: string, id: string, key: string, now = Date.now()): Promise<UndoResult> {
  const ref = db.doc(`tenants/${t}/appointments/${id}`); const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: 'not_found', error: 'We couldn’t find that appointment.' };
  const a: any = { id, ...snap.data() };
  if (!key || key !== a.checkInToken) return { ok: false, code: 'needs_link', error: 'Please use the link from your confirmation.' };
  if (!DEAD.includes(String(a.status || ''))) return { ok: true };   // already back on — tapping twice is fine
  if (!a.undoUntil || ms(a.undoUntil) < now) return { ok: false, code: 'too_late', error: 'It’s been more than 15 minutes, so this can’t be undone here. Please book again or call us.' };
  if (!(await timeStillFree(db, t, a, now))) return { ok: false, code: 'taken', error: 'Sorry — someone has already booked that time. Please pick another time.' };
  await ref.set({ status: a.statusBeforeCancel || 'confirmed', cancelledAt: null, cancellationAudit: null, cancellationFeeCharged: null, cancellationFeeWaived: null,
    undoUntil: null, statusBeforeCancel: null, cancellationUndoneAt: new Date(now).toISOString(), waitlistOpeningId: null }, { merge: true });
  if (a.cancellationEventId) await db.doc(`tenants/${t}/cancellationEvents/${a.cancellationEventId}`).set({ undoneAt: new Date(now).toISOString() }, { merge: true }).catch(() => null);
  // An opening made in a race (shouldn't happen while undoUntil holds detectOpenings off) is closed.
  await db.doc(`tenants/${t}/openings/op_${id}`).get().then((o: any) => (o.exists ? o.ref.set({ status: 'closed', closedReason: 'cancellation_undone' }, { merge: true }) : null)).catch(() => null);
  try { await tell(db, t, a); } catch (e) { console.error('[undo-cancel tell]', e); }
  return { ok: true };
}

async function tell(db: any, t: string, a: any) {
  const T = `tenants/${t}`; const tenant: any = (await db.doc(T).get()).data() || {};
  const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const when = new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const svc = String(a.serviceName || 'appointment'); const name = String(a.clientName || 'A client');
  const { tellTeam } = await import('@/lib/deposit-release');
  await tellTeam(db, t, a, 'Cancellation undone', `${name} undid their cancellation — ${svc}, ${when} is back on.`);
  const cl: any = a.clientId ? ((await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}) : {};
  const email = String(a.clientEmail || cl.email || '').trim(); const phone = String(a.clientPhone || cl.phone || '').trim();
  const first = name.split(' ')[0] || 'there'; const tokens = { client_first: first, service: svc, when, studio: tenant.name || '' };
  const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
  const base = { tenantId: t, kind: 'cancellation_undone', tokens, recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id };
  if (email.includes('@')) await sendNotification(db, { ...base, channel: 'email', to: email, subject: `You’re still booked — ${svc}, ${when}`,
    html: brandedEmailHtml({ studioName: tenant.name || 'Your studio', title: 'You’re still booked', bodyLines: [`Hi ${first} — your cancellation is undone. You’re still booked for ${svc} on ${when}.`, 'See you then.'] } as any) } as any).catch(() => null);
  if (phone) await sendNotification(db, { ...base, channel: 'sms', to: phone, text: `${tenant.name || 'We'}: your cancellation is undone — you’re still booked for ${svc} on ${when}.` } as any).catch(() => null);
}
