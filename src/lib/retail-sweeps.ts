// ─── retail-sweeps.ts ─────────────────────────────────────────────────────────
// The three things that can only be noticed by the PASSAGE OF TIME. Every
// other signal in ClarityFlow has an event behind it — a scan, a tap, a
// webhook. These have the opposite shape: nothing happened, and the fact
// that nothing happened is the news.
//
//   1. sweepStalledShipments  — a parcel scanned into the network and then
//      went quiet. Carriers never send a "still nothing" webhook, so only a
//      clock catches it. Tells the CUSTOMER honestly, and flags the board.
//   2. sweepRecoveryDeadlines — a filed claim whose window is closing. The
//      exceptions page already shows amber/red strips, but a page nobody
//      opened protects nothing; this emails the OWNER while filing is still
//      possible.
//   3. sweepStaleCases        — a resolved support case nobody has touched
//      in N days gets closed, so the inbox reflects live work.
//
// Design rules shared by all three:
//   • Every send is marker-guarded — a doc id derived from the fact, so a
//     re-run (or a second cron region) cannot double-send.
//   • Windows are bounded: nothing older than the lookback is examined, so
//     the work per night stays flat as history grows.
//   • Errors are per-tenant and swallowed into the result, never thrown —
//     one shop's bad data must not stop the sweep for everyone else.
//   • Silence is the default. These functions email only when there is
//     genuinely something a human should act on.

import { brandedEmail, brandFromTenant, emailButton, getEmailBrand } from '@/lib/email-shell';

const DAY = 86400000;

export interface SweepResult {
  scanned: number;
  actioned: number;
  emailed: number;
  errors: string[];
}

const empty = (): SweepResult => ({ scanned: 0, actioned: 0, emailed: 0, errors: [] });

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** The shop's own contact address for owner-facing alerts. */
function ownerEmailOf(tenant: any): string {
  return String(tenant?.ownerEmail || tenant?.email || tenant?.businessEmail || '').trim();
}

function originOf(tenant: any): string {
  return String(
    tenant?.publicOrigin
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''),
  ).replace(/\/+$/, '');
}

// ═══ 1. STALLED SHIPMENTS ════════════════════════════════════════════════════
// A parcel is stalled when it has a carrier status that means "moving", the
// last carrier scan is older than stallDays, and it is not delivered or
// returned. The customer hears it from the shop first — in the shop's own
// words, with what the shop is doing about it — which is the entire point of
// the proactive layer.

export async function sweepStalledShipments(
  db: any,
  tenantId: string,
  opts?: { stallDays?: number; lookbackDays?: number; now?: number },
): Promise<SweepResult> {
  const res = empty();
  const stallDays = Math.max(1, opts?.stallDays ?? 4);
  const lookbackDays = Math.max(stallDays, opts?.lookbackDays ?? 45);
  const now = opts?.now ?? Date.now();

  try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res;
    const tenant = tenantSnap.data() || {};
    const brand = brandFromTenant(tenant);
    const origin = originOf(tenant);

    const since = new Date(now - lookbackDays * DAY).toISOString();
    const snap = await db.collection(`tenants/${tenantId}/retailOrders`)
      .where('stage', 'in', ['shipped', 'handed_off'])
      .get();

    for (const d of snap.docs) {
      const order = d.data() as any;
      res.scanned += 1;
      try {
        if (!order.trackingNumber) continue;
        if (String(order.completedAt || '') < since) continue;

        const status = String(order.carrierStatus || '');
        if (['DELIVERED', 'RETURNED'].includes(status)) continue;
        if (!['PRE_TRANSIT', 'TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', ''].includes(status)) continue;

        // Last sign of life: the carrier's own scan time, else our ship stamp.
        const lastMoveRaw = Date.parse(String(order.carrierStatusAt || order.completedAt || ''));
        if (!Number.isFinite(lastMoveRaw)) continue;
        const quietDays = Math.floor((now - lastMoveRaw) / DAY);
        if (quietDays < stallDays) continue;

        // One notice per parcel per quiet-week — if it stays stuck, it speaks
        // again a week later rather than every night.
        const markerId = `stall-${Math.floor(quietDays / 7)}`;
        const markerRef = d.ref.collection('events').doc(markerId);
        if ((await markerRef.get()).exists) continue;

        const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
        const link = origin ? `${origin}/shop/${tenantId}/order/${d.id}` : '';
        const first = String(order.customerName || '').trim().split(/\s+/)[0];

        let emailed = false;
        if (order.customerEmail) {
          const html = brandedEmail(brand, `
            <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">${first ? `${first}, we` : 'We'} are keeping an eye on your parcel and we do not like what we are seeing \u2014 ${order.carrier || 'the carrier'} has not scanned it in ${quietDays} days.</p>
            <p style="font-size:14px;color:#334155;line-height:1.7;margin:12px 0 0">Packages do sometimes sit and then move again, so this is not lost yet. But you should not have to be the one who noticed: we are opening it with the carrier now, and if it does not move we will make it right \u2014 replacement or refund, your choice.</p>
            <p style="font-size:14px;color:#334155;line-height:1.7;margin:12px 0 0">Nothing is needed from you today.</p>
            ${link ? emailButton(link, 'View my order', brand) : ''}`,
            { preheader: `No carrier scan in ${quietDays} days \u2014 we are on it`, title: 'Your parcel has gone quiet', tag: num });
          emailed = await sendEmail(order.customerEmail, `${brand.shopName} \u2014 we are chasing your parcel ${num}`, html);
        }

        await markerRef.set({
          id: markerId, type: 'note', at: new Date(now).toISOString(),
          actorId: 'system', actorName: 'Stall watch',
          meta: { text: `No carrier scan in ${quietDays} days — customer ${emailed ? 'notified' : 'not emailed'}`, quietDays },
        });
        await d.ref.set({ stalledFlaggedAt: new Date(now).toISOString(), stalledQuietDays: quietDays }, { merge: true });

        res.actioned += 1;
        if (emailed) res.emailed += 1;
      } catch (e: any) {
        res.errors.push(`order ${d.id}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  } catch (e: any) {
    res.errors.push(String(e?.message || e).slice(0, 160));
  }
  return res;
}

// ═══ 2. RECOVERY DEADLINES ═══════════════════════════════════════════════════
// Money the shop can still claim back, with a clock on it. One digest email
// per day per shop — a list, not a stream — because five separate deadline
// emails is how people learn to ignore deadline emails.

export async function sweepRecoveryDeadlines(
  db: any,
  tenantId: string,
  opts?: { warnDays?: number; now?: number },
): Promise<SweepResult> {
  const res = empty();
  const warnDays = Math.max(1, opts?.warnDays ?? 7);
  const now = opts?.now ?? Date.now();

  try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res;
    const tenant = tenantSnap.data() || {};
    const to = ownerEmailOf(tenant);
    if (!to) return res;

    const snap = await db.collection(`tenants/${tenantId}/inventoryExceptions`)
      .where('recovery.status', '==', 'filed')
      .get();

    const soon: any[] = [];
    const overdue: any[] = [];
    for (const d of snap.docs) {
      const r = { id: d.id, ...(d.data() as any) };
      res.scanned += 1;
      const dl = Date.parse(String(r.recovery?.deadlineAt || ''));
      if (!Number.isFinite(dl)) continue;
      const daysLeft = Math.floor((dl - now) / DAY);
      if (daysLeft < 0) overdue.push({ ...r, daysLeft });
      else if (daysLeft <= warnDays) soon.push({ ...r, daysLeft });
    }
    if (soon.length === 0 && overdue.length === 0) return res;

    // One digest per shop per day.
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const markerRef = db.collection(`tenants/${tenantId}/systemMarkers`).doc(`recovery-digest-${dayKey}`);
    if ((await markerRef.get()).exists) return res;

    const brand = await getEmailBrand(db, tenantId);
    const origin = originOf(tenant);
    const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
    const row = (r: any, late: boolean) => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#0f172a">${String(r.name || 'Item')}<br>
          <span style="font-size:11px;color:#64748b">${String(r.carrier || r.reasonGroup || '')} \u00b7 ref ${String(r.recovery?.refNumber || '\u2014')}</span></td>
        <td style="padding:6px 0;text-align:right;font-size:13px;font-weight:800;color:${late ? '#b91c1c' : '#b45309'}">
          ${money(r.recovery?.claimAmountCents || r.landedCostCents)}<br>
          <span style="font-size:11px;font-weight:700">${late ? `${Math.abs(r.daysLeft)}d overdue` : `${r.daysLeft}d left`}</span></td>
      </tr>`;
    const total = [...soon, ...overdue].reduce((a, r) => a + (Number(r.recovery?.claimAmountCents) || Number(r.landedCostCents) || 0), 0);
    const link = origin ? `${origin}/retail-orders/exceptions` : '';

    const html = brandedEmail(brand, `
      <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">${money(total)} of filed claims ${overdue.length ? 'is past its deadline or closing' : 'is closing'} \u2014 carriers and suppliers count on these quietly expiring.</p>
      <table style="width:100%;border-collapse:collapse;margin:14px 0 0">
        ${overdue.map((r) => row(r, true)).join('')}
        ${soon.map((r) => row(r, false)).join('')}
      </table>
      ${link ? emailButton(link, 'Open the recovery queue', brand) : ''}
      <p style="font-size:11px;color:#94a3b8;margin:12px 0 0">You are getting this because these claims are filed and unpaid. Record a payment or mark them denied and they stop appearing.</p>`,
      { preheader: `${money(total)} in claims closing`, title: overdue.length ? 'Claims past their deadline' : 'Claim deadlines closing' });

    const sent = await sendEmail(to, `${brand.shopName} \u2014 ${money(total)} in claims need attention`, html);
    await markerRef.set({ at: new Date(now).toISOString(), soon: soon.length, overdue: overdue.length, emailed: sent });
    res.actioned += soon.length + overdue.length;
    if (sent) res.emailed += 1;
  } catch (e: any) {
    res.errors.push(String(e?.message || e).slice(0, 160));
  }
  return res;
}

// ═══ 3. STALE CASE AUTO-CLOSE ════════════════════════════════════════════════
// A case the shop resolved and nobody has spoken in since. Closing it is
// bookkeeping, not a decision, so it happens quietly — and only for RESOLVED
// cases: an open case is never auto-closed no matter how old, because that
// would hide unfinished work instead of finishing it.

export async function sweepStaleCases(
  db: any,
  tenantId: string,
  opts?: { closeAfterDays?: number; now?: number },
): Promise<SweepResult> {
  const res = empty();
  const now = opts?.now ?? Date.now();

  try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res;
    const tenant = tenantSnap.data() || {};
    const configured = Number(tenant?.retailSettings?.policies?.caseAutoCloseDays);
    const closeAfterDays = Math.max(1, opts?.closeAfterDays ?? (Number.isFinite(configured) && configured > 0 ? configured : 14));

    const snap = await db.collection(`tenants/${tenantId}/retailSupport`)
      .where('status', '==', 'resolved')
      .get();

    for (const d of snap.docs) {
      const t = d.data() as any;
      res.scanned += 1;
      try {
        const lastTouchRaw = Date.parse(String(
          t.lastStaffReplyAt || t.resolvedAt || t.createdAt || '',
        ));
        if (!Number.isFinite(lastTouchRaw)) continue;
        if ((now - lastTouchRaw) < closeAfterDays * DAY) continue;
        // A customer who wrote back after resolution is NOT settled — leave
        // it for a human even though the status still says resolved.
        if ((Number(t.customerMessagesSinceStaffReply) || 0) > 0) continue;

        await d.ref.set({
          status: 'closed',
          closedAt: new Date(now).toISOString(),
          closedBy: 'system',
          closeReason: `No activity for ${closeAfterDays} days after resolution`,
        }, { merge: true });
        res.actioned += 1;
      } catch (e: any) {
        res.errors.push(`case ${d.id}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  } catch (e: any) {
    res.errors.push(String(e?.message || e).slice(0, 160));
  }
  return res;
}


// ═══ 4. BOOKING REQUESTS THAT NOBODY ANSWERED ════════════════════════════════
// Approval mode's honest failure case. A request the studio never got to is
// the studio's fault, not the client's — so it does not sit forever pretending
// to be alive. At its stated expiry it declines itself, frees the slot, and
// tells the client plainly, because the worst outcome is a person who kept a
// morning free for an appointment that was never going to happen.
//
// Only requests that CARRY an expiry are swept: a shop that configured "never
// expire" means it, and those wait for a human indefinitely.

export async function sweepExpiredRequests(
  db: any,
  tenantId: string,
  opts?: { now?: number },
): Promise<SweepResult> {
  const res = empty();
  const now = opts?.now ?? Date.now();

  try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res;
    const tenant = tenantSnap.data() || {};
    const brand = brandFromTenant(tenant);
    const origin = originOf(tenant);

    const snap = await db.collection(`tenants/${tenantId}/appointments`)
      .where('status', '==', 'requested')
      .get();

    for (const d of snap.docs) {
      const apt = d.data() as any;
      res.scanned += 1;
      try {
        const exp = Date.parse(String(apt.requestExpiresAt || ''));
        if (!Number.isFinite(exp) || now < exp) continue;

        await d.ref.set({
          status: 'expired',
          decidedAt: new Date(now).toISOString(),
          decidedBy: 'system',
          declineReason: 'The studio did not respond before the request expired',
        }, { merge: true });
        res.actioned += 1;

        const email = String(apt.clientEmail || '').trim()
          || (apt.clientId
            ? String(((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any)?.email || '').trim()
            : '');
        if (!email) continue;

        const first = String(apt.clientName || '').trim().split(/\s+/)[0];
        const when = apt.startTime
          ? new Date(apt.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : 'your requested time';
        const bookUrl = origin ? `${origin}/book/${tenantId}` : '';
        /* Wording comes from the message catalog — the shop's own if they
         * wrote one, the shipped default otherwise. Nothing about the tone
         * of this message is decided in this file. */
        const { resolveMessage, tidyBody } = await import('./message-policy');
        const msg = resolveMessage(tenant, 'request_declined', {
          client_first: first,
          when,
          reason: 'The request expired before it was answered.',
          link: bookUrl,
          studio: brand.shopName,
        }, 'email');
        if (!msg.send) continue;
        const paras = tidyBody(msg.body).split('\n\n')
          .map((line) => `<p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 12px">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
          .join('');
        const html = brandedEmail(brand, `
          ${paras}
          ${bookUrl ? emailButton(bookUrl, 'View available times', brand) : ''}`,
          { preheader: msg.subject, title: msg.subject, tag: 'Booking' });
        if (await sendEmail(email, `${brand.shopName} \u2014 ${msg.subject}`, html)) res.emailed += 1;
      } catch (e: any) {
        res.errors.push(`request ${d.id}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  } catch (e: any) {
    res.errors.push(String(e?.message || e).slice(0, 160));
  }
  return res;
}

// ═══ 5. REQUESTS GETTING STALE (owner nudge) ═════════════════════════════════
// Before anything expires, the owner gets ONE nudge listing everything waiting.
// Sent only when something is genuinely close to its deadline or the visit is
// imminent — a daily "you have 0 requests" email trains people to ignore it.

export async function sweepPendingRequestNudge(
  db: any,
  tenantId: string,
  opts?: { now?: number; urgentHours?: number },
): Promise<SweepResult> {
  const res = empty();
  const now = opts?.now ?? Date.now();
  const urgentH = Math.max(1, opts?.urgentHours ?? 6);

  try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res;
    const tenant = tenantSnap.data() || {};
    const to = ownerEmailOf(tenant);
    if (!to) return res;

    const snap = await db.collection(`tenants/${tenantId}/appointments`)
      .where('status', '==', 'requested')
      .get();

    const urgent: any[] = [];
    for (const d of snap.docs) {
      const apt = { id: d.id, ...(d.data() as any) };
      res.scanned += 1;
      const exp = Date.parse(String(apt.requestExpiresAt || ''));
      const start = Date.parse(String(apt.startTime || ''));
      const expSoon = Number.isFinite(exp) && (exp - now) < urgentH * 3600000;
      const startSoon = Number.isFinite(start) && (start - now) < 48 * DAY / 24;
      if (expSoon || startSoon) urgent.push(apt);
    }
    if (urgent.length === 0) return res;

    const dayKey = new Date(now).toISOString().slice(0, 10);
    const markerRef = db.collection(`tenants/${tenantId}/systemMarkers`).doc(`request-nudge-${dayKey}`);
    if ((await markerRef.get()).exists) return res;

    const brand = await getEmailBrand(db, tenantId);
    const origin = originOf(tenant);
    const link = origin ? `${origin}/appointments/requests` : '';
    const rows = urgent.slice(0, 10).map((a) => {
      const when = a.startTime
        ? new Date(a.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'time TBC';
      return `<tr><td style="padding:6px 0;font-size:13px;color:#0f172a">${String(a.clientName || 'A client')}<br>
        <span style="font-size:11px;color:#64748b">${String(a.serviceName || 'Service')} \u00b7 ${when}</span></td></tr>`;
    }).join('');

    const html = brandedEmail(brand, `
      <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">${urgent.length} booking request${urgent.length === 1 ? '' : 's'} ${urgent.length === 1 ? 'is' : 'are'} close to expiring or close to the appointment itself. Each one is somebody holding their day open for you.</p>
      <table style="width:100%;border-collapse:collapse;margin:14px 0 0">${rows}</table>
      ${link ? emailButton(link, 'Answer them now', brand) : ''}
      <p style="font-size:11px;color:#94a3b8;margin:12px 0 0">Expired requests decline themselves and free the slot \u2014 answering beats letting that happen.</p>`,
      { preheader: `${urgent.length} request${urgent.length === 1 ? '' : 's'} waiting`, title: 'Requests waiting on you' });

    const sent = await sendEmail(to, `${brand.shopName} \u2014 ${urgent.length} booking request${urgent.length === 1 ? '' : 's'} waiting`, html);
    await markerRef.set({ at: new Date(now).toISOString(), count: urgent.length, emailed: sent });
    res.actioned += urgent.length;
    if (sent) res.emailed += 1;
  } catch (e: any) {
    res.errors.push(String(e?.message || e).slice(0, 160));
  }
  return res;
}


// ═══ 6. UNPAID ACCEPTED BOOKINGS ═════════════════════════════════════════════
// The gap a failed card leaves behind. An accepted booking whose deposit never
// completed is holding a slot on the strength of money that did not arrive.
// Three things happen here, in order of decreasing hope:
//
//   1. RETRY once, if the failure was the kind that can pass later
//      (insufficient funds, a bank limit, a processing blip). An expired or
//      reported card is never retried — that is a second failure with the
//      client's hope attached.
//   2. REMIND, once, partway through the grace window, so the client hears
//      about it while they can still act.
//   3. RELEASE at the deadline: the slot goes back on sale and the client is
//      told plainly. Quietly keeping a slot for someone who never paid costs
//      the shop the booking twice.

export async function sweepUnpaidAccepted(
  db: any,
  tenantId: string,
  opts?: { now?: number; origin?: string },
): Promise<SweepResult> {
  const res = empty();
  const now = opts?.now ?? Date.now();

  try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return res;
    const tenant = tenantSnap.data() || {};
    const brand = brandFromTenant(tenant);
    const { internalOrigin } = await import('./message-policy');
    const origin = opts?.origin || internalOrigin(tenant, null) || originOf(tenant);
    const { resolveMessage, tidyBody } = await import('./message-policy');

    const snap = await db.collection(`tenants/${tenantId}/appointments`)
      .where('status', '==', 'pending_payment')
      .get();

    for (const d of snap.docs) {
      const apt = d.data() as any;
      res.scanned += 1;
      try {
        const due = Date.parse(String(apt.paymentDueAt || ''));
        if (!Number.isFinite(due)) continue;          // checkout holds are not ours
        if (apt.depositStatus === 'paid') continue;

        const first = String(apt.clientName || '').trim().split(/\s+/)[0];
        const when = apt.startTime
          ? new Date(apt.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : 'your appointment';
        const money = `$${((Number(apt.depositAmountCents) || 0) / 100).toFixed(2)}`;
        const link = origin && apt.checkInToken ? `${origin}/check-in/${apt.checkInToken}` : '';
        const email = String(apt.clientEmail || '').trim()
          || (apt.clientId
            ? String(((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any)?.email || '').trim()
            : '');

        // ── 3. Past the deadline: release it ──
        if (now >= due) {
          await d.ref.set({
            status: 'cancelled',
            cancelledAt: new Date(now).toISOString(),
            cancelledBy: 'system',
            cancelReason: 'The deposit was not completed within the payment window',
          }, { merge: true });
          res.actioned += 1;
          if (email) {
            const msg = resolveMessage(tenant, 'request_declined', {
              client_first: first, when,
              reason: 'The deposit was not completed in time, so the booking has been released.',
              link: origin ? `${origin}/book/${tenantId}` : '',
              studio: brand.shopName,
            }, 'email');
            if (msg.send) {
              const paras = tidyBody(msg.body).split('\n\n')
                .map((l) => `<p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 12px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
              const html = brandedEmail(brand, `${paras}${origin ? emailButton(`${origin}/book/${tenantId}`, 'View available times', brand) : ''}`,
                { preheader: msg.subject, title: msg.subject, tag: 'Booking' });
              if (await sendEmail(email, `${brand.shopName} \u2014 ${msg.subject}`, html)) res.emailed += 1;
            }
          }
          continue;
        }

        // ── 1. Retry, once, when the card could plausibly work now ──
        const attempts = Number(apt.depositAttempts) || 0;
        if (apt.depositRetryable === true && attempts < 2 && apt.clientId && origin) {
          const failedAt = Date.parse(String(apt.depositFailedAt || ''));
          // Give the bank some daylight before asking again.
          if (Number.isFinite(failedAt) && (now - failedAt) > 6 * 3600000) {
            try {
              const { internalPost } = await import('./message-policy');
              const rr = await internalPost(origin, '/api/stripe/charge-card', {
                tenantId, clientId: apt.clientId,
                amountCents: Number(apt.depositAmountCents) || 0,
                description: 'Deposit (retry)', category: 'Deposits',
                appointmentId: d.id, reason: apt.serviceName || 'Appointment deposit',
                kind: 'deposit', mode: 'auto',
              });
              const rd = rr.data || {};
              if (rr.ok && rd.ok) {
                await d.ref.set({
                  status: 'confirmed', depositStatus: 'paid',
                  depositPaidAt: new Date(now).toISOString(),
                  depositChargedOnFile: true,
                  depositPaymentIntentId: rd.paymentIntentId || null,
                  depositFailureReason: null, depositFailureCode: null, depositFailureGuidance: null,
                  paymentDueAt: null,
                }, { merge: true });
                res.actioned += 1;
                if (email) {
                  const msg = resolveMessage(tenant, 'deposit_charged', {
                    client_first: first, amount: money, when,
                    service: apt.serviceName || 'your appointment',
                    link, studio: brand.shopName,
                  }, 'email');
                  if (msg.send) {
                    const paras = tidyBody(msg.body).split('\n\n')
                      .map((l) => `<p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 12px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
                    const html = brandedEmail(brand, `${paras}${link ? emailButton(link, 'Manage my visit', brand) : ''}`,
                      { preheader: msg.subject, title: msg.subject, tag: 'Booking' });
                    if (await sendEmail(email, `${brand.shopName} \u2014 ${msg.subject}`, html)) res.emailed += 1;
                  }
                }
                continue;
              }
              await d.ref.set({ depositAttempts: attempts + 1, depositFailedAt: new Date(now).toISOString() }, { merge: true });
            } catch { /* the deadline sweep still protects the slot */ }
          }
        }

        // ── 2. One reminder, partway to the deadline ──
        const markerId = `unpaid-nudge-${d.id}`;
        const markerRef = db.collection(`tenants/${tenantId}/systemMarkers`).doc(markerId);
        const halfway = due - (due - Date.parse(String(apt.decidedAt || apt.createdAt || ''))) / 2;
        if (Number.isFinite(halfway) && now >= halfway && email && !(await markerRef.get()).exists) {
          const dueLabel = new Date(due).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
          const msg = resolveMessage(tenant, 'deposit_failed', {
            client_first: first, amount: money, when,
            card_issue: String(apt.depositFailureGuidance || ''),
            hold_until: dueLabel, link, studio: brand.shopName,
          }, 'email');
          if (msg.send) {
            const paras = tidyBody(msg.body).split('\n\n')
              .map((l) => `<p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 12px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
            const html = brandedEmail(brand, `${paras}${link ? emailButton(link, 'Pay deposit', brand) : ''}`,
              { preheader: msg.subject, title: msg.subject, tag: 'Booking' });
            if (await sendEmail(email, `${brand.shopName} \u2014 ${msg.subject}`, html)) res.emailed += 1;
            await markerRef.set({ at: new Date(now).toISOString(), appointmentId: d.id });
            res.actioned += 1;
          }
        }
      } catch (e: any) {
        res.errors.push(`appt ${d.id}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  } catch (e: any) {
    res.errors.push(String(e?.message || e).slice(0, 160));
  }
  return res;
}
