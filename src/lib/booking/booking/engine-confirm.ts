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
  | { requiresPayment: true; clientSecret: string; stripeAccountId?: string }
  | { requiresPayment: true; error: string };
export type EngineOutcome = { status: string; notice: string; depositCents: number; cardOnFile?: boolean };

export async function bookThroughEngine(o: {
  tenantId: string; source: string;
  formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string; smsConsent?: boolean };
  apptDetails: any; signedForms: any[];
  setStep: (s: string) => void;
  onOutcome: (x: EngineOutcome) => void;
  held: { current: { key: string; appointmentId: string } | null };
  extra?: Record<string, any>;
}): Promise<ConfirmResult> {
  try {
    const { depositAmount, depositStatus, ...d } = o.apptDetails || {};
    void depositAmount; void depositStatus;                  // the server decides deposits
    if (!d?.serviceId || !d?.startTime) return { requiresPayment: true, error: 'Please pick a service and a time first.' };
    const holdKey = `${d.serviceId}|${d.startTime}|${String(o.formData.clientEmail || '').toLowerCase()}`;
    const payFor = async (appointmentId: string): Promise<ConfirmResult> => {
      const r = await fetch('/api/stripe/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: o.tenantId, appointmentId }) }).catch(() => null);
      const x: any = r ? await r.json().catch(() => null) : null;
      if (x?.clientSecret) return { requiresPayment: true, clientSecret: x.clientSecret, stripeAccountId: x.stripeAccountId };
      return { requiresPayment: true, error: x?.error || 'Your time is held, but the payment step didn’t open. Please try again — or use the pay link in your email.' };
    };
    if (o.held.current?.key === holdKey) return payFor(o.held.current.appointmentId);   // retry → pay for the held one
    let res: Response;
    try {
      res = await fetch('/api/appointments/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        tenantId: o.tenantId, source: o.source,
        serviceId: d.serviceId, addOnIds: d.addOnIds || [], staffId: d.staffId || 'any', startTime: d.startTime,
        client: { name: o.formData.clientName, email: o.formData.clientEmail, phone: o.formData.clientPhone,
          smsConsent: (d.smsConsent ?? o.formData.smsConsent) === true, smsConsentText: d.smsConsentText || null },
        notes: o.formData.notes,
        inspirationPhotoUrl: d.inspirationPhotoUrl || undefined,
        inspirationPhotos: Array.isArray(d.inspirationPhotos) ? d.inspirationPhotos : undefined,
        signedForms: Array.isArray(o.signedForms) ? o.signedForms : [],
        ...(o.extra || {}),
      }) });
    } catch { return { requiresPayment: true, error: 'We couldn’t reach the booking system — check your connection and try again.' }; }
    const out: any = await res.json().catch(() => null);
    if (!out?.ok) return { requiresPayment: true, error: out?.error || (res.status === 409 ? 'That time was just taken — pick another slot.' : 'We couldn’t hold that time. Please try again.') };
    // The SERVER decided what this booking became — the screen, email and text all agree.
    o.onOutcome({ status: String(out.status || 'confirmed'), notice: String(out.clientNotice || ''), depositCents: Number(out.depositCents) || 0, cardOnFile: !!out.requiresCardOnFile });
    if (out.status === 'pending_payment' && Number(out.depositCents) > 0 && out.appointmentId) {
      o.held.current = { key: holdKey, appointmentId: out.appointmentId };
      return payFor(out.appointmentId);
    }
    if (out.requiresCardOnFile && out.clientId) {
      try {
        const cr = await fetch('/api/stripe/booking-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: o.tenantId, clientId: out.clientId, clientEmail: o.formData.clientEmail, clientName: o.formData.clientName, serviceName: d.serviceName || '' }) });
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
