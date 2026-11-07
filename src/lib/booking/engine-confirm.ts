// src/lib/booking/engine-confirm.ts — BOOK THROUGH THE ENGINE, FROM A CLIENT SCREEN.
// The client portal used to write bookings straight from the browser, skipping
// the shared booking engine (/api/appointments/book): its availability check,
// booking mode, change rules, upcoming-booking limit, deposits and messages.
// This is the same sequence the public booking page runs, in one place:
//   1. the engine books it (and decides what it becomes)
//   2. a deposit is due → open the payment step for THAT appointment
//   3. the business needs a card on file → open the card step
//   4. otherwise → the confirmation
// Retrying while a deposit is pending pays for the held booking instead of
// booking twice. Browser-only (uses fetch).

// Exactly what the booking sheet understands: confirmed · open the payment step · an error to show.
export type ConfirmResult =
  | { requiresPayment: false }
  | { requiresPayment: true; clientSecret: string; stripeAccountId?: string; appointmentId?: string }
  | { requiresPayment: true; error: string };
export type EngineOutcome = { status: string; notice: string; depositCents: number; cardOnFile?: boolean; visitUrl?: string | null; earlier?: boolean; stillNeeded?: string[]; photosLeftOut?: number };

/** A booking holding its time while the client pays the deposit: which booking, for exactly what, and its link token
 *  (so the client can let it go if they step back to change something). */
export type HeldPay = { key: string; appointmentId: string; k?: string | null; left?: string[] };   // left: what the visit link still asks for

/** Everything that makes a booking what it is: paying again for a held booking only happens when nothing has changed
 *  (the visit, who and when, their details and consent, notes and photos, form answers, who recommended them); any
 *  change books it fresh after the held one is let go. */
export function holdKeyOf(d: any, client: { name?: any; email?: any; phone?: any } = {}, signedForms: any[] = []): string {
  return JSON.stringify([d?.serviceId || '', d?.staffId || 'any', d?.startTime || '', [...(Array.isArray(d?.addOnIds) ? d.addOnIds : [])].map(String).sort(), d?.place || '',
    String(client.email || '').trim().toLowerCase(), String(client.name || '').trim(), String(client.phone || '').replace(/[^\d+]/g, ''),
    d?.smsConsent === true, d?.smsMarketing === true, Number(d?.acceptExtraCents) || 0, String(d?.notes || ''),
    (Array.isArray(d?.inspirationPhotos) ? d.inspirationPhotos : []).map((x: any) => `${x?.url || ''}#${x?.note || ''}`), `${d?.nowPhoto?.url || ''}#${d?.nowPhoto?.note || ''}#${d?.nowPhoto?.original || ''}`,
    d?.referralTypedCode || '', d?.referredBy?.firstName || '', d?.referredBy?.phone || '',
    (Array.isArray(signedForms) ? signedForms : []).map((f: any) => [f?.formId || '', f?.formData || {}, f?.signedName || '', f?.guardian || null])]);
}

/** Opens payment for a booking already holding its time. Says when there's nothing left to pay (paid already, or no
 *  deposit due any more: the booking stands) and when the hold has ended (book it fresh). */
export async function payForHeld(tenantId: string, appointmentId: string): Promise<ConfirmResult & { settled?: boolean; ended?: boolean }> {
  const r = await fetch('/api/stripe/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId }) }).catch(() => null);
  const x: any = r ? await r.json().catch(() => null) : null;
  if (x?.clientSecret) return { requiresPayment: true, clientSecret: x.clientSecret, stripeAccountId: x.stripeAccountId, appointmentId };
  const said = String(x?.error || ''); const code = String(x?.code || '');
  if (code === 'paid' || code === 'booked') return { requiresPayment: true, error: said, settled: true };
  if (code === 'ended') return { requiresPayment: true, error: said, ended: true };
  if (!code && /already paid/i.test(said)) return { requiresPayment: true, error: said, settled: true };
  if (!code && /hold has ended|couldn.t find that booking/i.test(said)) return { requiresPayment: true, error: said, ended: true };
  return { requiresPayment: true, error: said || 'Your time is held, but the payment step didn’t open. Please try again, or use the pay link in your email.' };
}

/** The client stepped back from paying, or closed the sheet: let the held time go now (it would be let go on its own
 *  shortly anyway). 'paid' when it turned out to be paid (a real booking now); 'kept' when it couldn't be let go just
 *  now (it stays noted, so the next try lets it go first). */
export async function releaseHeld(tenantId: string, held: { current: HeldPay | null }): Promise<'released' | 'paid' | 'kept'> {
  const h = held.current;
  if (!h?.appointmentId) return 'released';
  if (!h.k) { held.current = null; return 'released'; }
  const ctl = new AbortController(); const stop = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('/api/appointments/release-hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ tenantId, appointmentId: h.appointmentId, k: h.k }) });
    const x: any = await r.json().catch(() => null);
    // Let go, gone, or no longer a hold this client can let go of (it ends on its own): nothing more to do from here.
    if (x?.ok || (x && r.status === 404) || x?.code === 'not_releasable') { if (held.current === h) held.current = null; return 'released'; }
    if (x?.paid) { if (held.current === h) held.current = null; return 'paid'; }
    return 'kept';
  } catch { return 'kept'; } finally { clearTimeout(stop); }
}

/** What the booked screen says when the booking they were holding turned out to be paid before they changed it:
 *  that one is theirs (its own time and details are in its email), not what they changed to. */
export const EARLIER_PAID = 'Your earlier booking was already paid, so that’s the one you have. Its time and details are in your email.';

/** What to say when a held time couldn't be let go before booking something new. */
export const KEPT_HOLD = 'We couldn’t let go of the time you were holding just now. Please try again in a moment.';

export async function bookThroughEngine(o: {
  tenantId: string; source: string;
  formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string; smsConsent?: boolean };
  apptDetails: any; signedForms: any[];
  setStep: (s: string) => void;
  onOutcome: (x: EngineOutcome) => void;
  held: { current: HeldPay | null };
  extra?: Record<string, any>;
}): Promise<ConfirmResult> {
  try {
    const { depositAmount, depositStatus, ...d } = o.apptDetails || {};
    void depositAmount; void depositStatus;                  // the server decides deposits
    if (!d?.serviceId || !d?.startTime) return { requiresPayment: true, error: 'Please pick a service and a time first.' };
    const holdKey = holdKeyOf({ ...d, notes: o.formData.notes }, { name: o.formData.clientName, email: o.formData.clientEmail, phone: o.formData.clientPhone }, o.signedForms);
    // Asked again for exactly the same booking while it holds its time: pay for that one (nothing left to pay: it's
    // booked). Anything changed: the held one is let go first and this is booked fresh.
    if (o.held.current && o.held.current.key === holdKey) {
      const h = o.held.current; const again = await payForHeld(o.tenantId, h.appointmentId);
      if (again.settled) { o.held.current = null; o.onOutcome({ status: 'confirmed', notice: '', depositCents: 0, visitUrl: h.k ? `/check-in/${encodeURIComponent(h.k)}` : null, stillNeeded: h.left || [] }); o.setStep('confirmation'); return { requiresPayment: false }; }
      if (!again.ended) return again;
      o.held.current = null;
    } else if (o.held.current) {
      // Letting go of the held one first. Paid in the meantime: that booking is theirs, so it's the one they're booked for.
      const h = o.held.current; const went = await releaseHeld(o.tenantId, o.held);
      if (went === 'kept') return { requiresPayment: true, error: KEPT_HOLD };
      if (went === 'paid') { o.onOutcome({ status: 'confirmed', notice: EARLIER_PAID, depositCents: 0, visitUrl: h.k ? `/check-in/${encodeURIComponent(h.k)}` : null, earlier: true, stillNeeded: h.left || [] }); o.setStep('confirmation'); return { requiresPayment: false }; }
    }
    let res: Response;
    try {
      res = await fetch('/api/appointments/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        tenantId: o.tenantId, source: o.source,
        serviceId: d.serviceId, addOnIds: d.addOnIds || [], staffId: d.staffId || 'any', startTime: d.startTime,
        ...(d.place ? { place: d.place } : {}),
        client: { name: o.formData.clientName, email: o.formData.clientEmail, phone: o.formData.clientPhone,
          smsConsent: (d.smsConsent ?? o.formData.smsConsent) === true, smsConsentText: d.smsConsentText || null,
          smsMarketing: d.smsMarketing === true, smsMarketingText: d.smsMarketing === true ? d.smsMarketingText || null : null },
        ...(Number(d.acceptExtraCents) > 0 ? { acceptExtraCents: Number(d.acceptExtraCents) } : {}),
        ...(d.referredBy ? { referredBy: d.referredBy } : {}), ...(d.referralTypedCode ? { referralTypedCode: d.referralTypedCode } : {}),
        notes: o.formData.notes,
        inspirationPhotoUrl: d.inspirationPhotoUrl || undefined,
        inspirationPhotos: Array.isArray(d.inspirationPhotos) ? d.inspirationPhotos : undefined,
        nowPhoto: d.nowPhoto || undefined,
        signedForms: Array.isArray(o.signedForms) ? o.signedForms : [],
        ...(o.extra || {}),
      }) });
    } catch { return { requiresPayment: true, error: 'We couldn’t reach the booking system — check your connection and try again.' }; }
    const out: any = await res.json().catch(() => null);
    if (!out?.ok) {
      // What the sheet can act on: agree to their usual extra time, or show only the times that fit it.
      if (out?.code === 'confirm_extra') return { requiresPayment: true, error: out.error, code: 'confirm_extra', extraMinutes: Number(out.extraMinutes) || 0, extraCents: Number(out.extraCents) || 0 } as any;
      if (out?.code === 'needs_longer') return { requiresPayment: true, error: out.error, code: 'needs_longer', extraMinutes: Number(out.extraMinutes) || 0 } as any;
      return { requiresPayment: true, error: out?.error || (res.status === 409 ? 'That time was just taken. Please choose another.' : 'We couldn’t hold that time. Please try again.') };
    }
    // The SERVER decided what this booking became — the screen, email and text all agree.
    o.onOutcome({ status: String(out.status || 'confirmed'), notice: String(out.clientNotice || ''), depositCents: Number(out.depositCents) || 0, cardOnFile: !!out.requiresCardOnFile,
      visitUrl: out.checkInToken ? `/check-in/${encodeURIComponent(String(out.checkInToken))}` : null,
      stillNeeded: Array.isArray(out.stillNeeded) ? out.stillNeeded.map(String).slice(0, 5) : [], photosLeftOut: Number(out.photosLeftOut) || 0 });
    if (out.status === 'pending_payment' && Number(out.depositCents) > 0 && out.appointmentId) {
      o.held.current = { key: holdKey, appointmentId: out.appointmentId, k: out.checkInToken || null, left: Array.isArray(out.stillNeeded) ? out.stillNeeded.map(String).slice(0, 5) : [] };
      return payForHeld(o.tenantId, out.appointmentId);
    }
    if (out.requiresCardOnFile && out.clientId) {
      try {
        // The card route checks the booking is this client's own: its id and the token from the booking's own link.
        const cr = await fetch('/api/stripe/booking-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: o.tenantId, clientId: out.clientId, appointmentId: out.appointmentId, checkInToken: out.checkInToken, clientEmail: o.formData.clientEmail, clientName: o.formData.clientName, serviceName: d.serviceName || '' }) });
        const c: any = await cr.json().catch(() => null);
        if (c?.clientSecret) return { requiresPayment: true, clientSecret: c.clientSecret, stripeAccountId: c.stripeAccountId };
      } catch { /* the booking stands — accepting it sends a pay link instead */ }
    }
    o.setStep('confirmation');
    return { requiresPayment: false };
  } catch (e: any) {
    return { requiresPayment: true, error: `Booking error: ${e?.message || String(e)}` };
  }
}
