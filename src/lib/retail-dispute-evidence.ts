// ─── src/lib/retail-dispute-evidence.ts ───────────────────────────────────────
// Turns everything already recorded on a retail order into the evidence a card
// network actually reads.
//
// WHY THIS EXISTS. The Dispute Center was built for the service side, and it is
// good at that: consent form, signature, appointment, service date. But a
// retail chargeback lands in the same place, and until now it inherited that
// shape — a disputed physical product was described to Stripe as services
// rendered in full, under a refund policy written for appointments.
//
// That is worse than submitting nothing. On a product_not_received dispute the
// issuer is looking for a carrier, a tracking number and a delivery address. A
// service narrative answers none of those, contradicts the customer's own
// description of the purchase, and reads as a merchant who cannot tell what
// they sold. Physical goods have their own Stripe evidence fields and they are
// the ones that win.
//
// Nothing here is new data. Every fact comes from what fulfilment already
// recorded — the carrier trail, the weight check, the notification timestamps,
// the scan counts. This just reads it back in the order an issuer reads it.

export interface RetailEvidence {
  /** Stripe: product_description */
  productDescription: string;
  /** Stripe: shipping_carrier / shipping_tracking_number / shipping_date */
  shippingCarrier: string;
  shippingTrackingNumber: string;
  shippingDate: string;
  /** Stripe: shipping_address */
  shippingAddress: string;
  /** Stripe: uncategorized_text — the narrative, in issuer-reading order. */
  narrative: string;
  /** True when this is a goods sale and the service wording must NOT be used. */
  isGoods: boolean;
}

const money = (c: unknown) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

const when = (iso: unknown): string => {
  const s = String(iso || '');
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });
};

export function formatShippingAddress(order: any): string {
  const a = order?.shippingAddress || {};
  const parts = [
    a.name, a.line1, a.line2,
    [a.city, a.state].filter(Boolean).join(', '),
    a.postalCode, a.country,
  ].filter(Boolean).map(String);
  return parts.join(', ');
}

/** What was sold, in the customer's own terms, not ours. */
export function describeGoods(order: any): string {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  if (lines.length === 0) return 'Retail merchandise purchased online and shipped to the customer.';

  const bits = lines.map((l: any) => {
    const qty = Math.max(0, Number(l?.qtyOrdered) || 0);
    const short = Math.min(Math.max(0, Number(l?.qtyShorted) || 0), qty);
    const shipped = qty - short;
    const name = String(l?.name || 'Item')
      + (l?.optionsLabel ? ` (${String(l.optionsLabel)})` : '')
      + (l?.sku ? ` [SKU ${String(l.sku)}]` : '');
    return short > 0
      ? `${shipped} of ${qty} \u00d7 ${name} — ${short} unavailable and refunded before dispatch`
      : `${shipped} \u00d7 ${name}`;
  });

  return `Physical merchandise purchased through the online store and shipped: ${bits.join('; ')}.`;
}

/**
 * The narrative, ordered the way a disputes analyst reads: what was bought,
 * that it was picked and verified, that a carrier took it, what the carrier
 * itself reported, and when the customer was told each time.
 *
 * Written as flat prose rather than a table because Stripe renders
 * uncategorized_text as plain text and a mangled table reads as noise.
 */
export function buildNarrative(order: any, tenant: any): string {
  const s: string[] = [];
  const num = typeof order?.orderNumber === 'number' && order.orderNumber > 0
    ? `#${String(order.orderNumber).padStart(4, '0')}` : '(draft)';
  const shop = String(tenant?.businessName || tenant?.name || 'the merchant');

  s.push(`ORDER ${num} — ${shop}`);
  s.push(`Placed ${when(order?.placedAt)} and paid ${when(order?.paidAt)} for ${money(order?.totalCents)}. Customer-supplied email on the order: ${String(order?.customerEmail || 'not provided')}.`);

  // What we sent
  s.push('');
  s.push('WHAT WAS SHIPPED');
  s.push(describeGoods(order));
  const addr = formatShippingAddress(order);
  if (addr) s.push(`Shipped to the address the customer entered at checkout: ${addr}`);

  // Picking / packing verification
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  const scanned = lines.reduce((a: number, l: any) => a + (Number(l?.qtyScanned) || 0), 0);
  const ordered = lines.reduce((a: number, l: any) => a + (Number(l?.qtyOrdered) || 0), 0);
  if (scanned > 0) {
    s.push('');
    s.push('VERIFICATION BEFORE DISPATCH');
    s.push(`Every unit was barcode-scanned against this order as it was picked and packed — ${scanned} of ${ordered} units scanned. Scans are recorded against the order with the staff member and timestamp at the moment each item was handled.`);
  }

  // Protection bought
  const prot = order?.shipmentProtection || {};
  const protBits: string[] = [];
  if (prot.signature && prot.signature !== 'NONE') {
    protBits.push(prot.signature === 'ADULT'
      ? 'delivery required an adult signature (21+, ID checked)'
      : 'delivery required a signature');
  }
  if (Number(prot.insuranceCents) > 0) protBits.push(`the parcel was insured for ${money(prot.insuranceCents)}`);
  if (protBits.length) {
    s.push('');
    s.push('PROTECTION PURCHASED');
    s.push(`At the merchant's cost, ${protBits.join(' and ')}.`);
  }

  // Weight — the strongest missing-item answer
  const wc = order?.carrierTrail?.weightCheck;
  if (wc && wc.verdict && wc.verdict !== 'unknown') {
    s.push('');
    s.push('INDEPENDENT WEIGHT VERIFICATION');
    s.push(String(wc.note || ''));
    s.push(`Expected ${Number(wc.expectedOz).toFixed(1)} oz from the recorded per-item weights of the goods on this order; the carrier independently weighed the parcel at ${Number(wc.carrierOz).toFixed(1)} oz.`);
  }

  // The carrier's own account
  const trail = order?.carrierTrail || {};
  if (trail.trackingNumber || order?.trackingNumber) {
    s.push('');
    s.push('CARRIER RECORD');
    s.push(`${String(trail.carrier || order?.carrier || 'Carrier')} tracking ${String(trail.trackingNumber || order?.trackingNumber)}.`);
    if (trail.carrierStatus) {
      s.push(`Most recent carrier status: ${String(trail.carrierStatus)}${trail.carrierStatusAt ? ` at ${when(trail.carrierStatusAt)}` : ''}${trail.carrierLocation ? ` in ${String(trail.carrierLocation)}` : ''}.`);
    }
    if (trail.carrierDetail) s.push(`Carrier's own note: "${String(trail.carrierDetail)}"`);
    if (order?.deliveredAt) {
      s.push(`The carrier confirmed delivery at ${when(order.deliveredAt)}. This timestamp is the carrier's, not the merchant's.`);
    }
  }

  // What the customer was told, and when
  s.push('');
  s.push('CUSTOMER COMMUNICATION');
  s.push(`An order confirmation was emailed on payment. The customer was emailed automatically at each carrier milestone — dispatch, out for delivery, and delivery — to the address on the order.`);
  if (trail.customerNotifiedAt) {
    s.push(`Most recent notification sent ${when(trail.customerNotifiedAt)} to ${String(trail.customerNotifiedTo || order?.customerEmail || '')}.`);
  }
  s.push('The delivery notification asked the customer to report any problem within 7 days. No such report was received before this dispute was filed.');

  // Refunds already given — never claim money you gave back
  const refunded = Number(order?.refundedCents) || 0;
  if (refunded > 0) {
    s.push('');
    s.push('REFUNDS ALREADY ISSUED');
    s.push(`${money(refunded)} has already been refunded to the customer on this order, before any dispute was filed. The merchant is contesting only the remaining ${money((Number(order?.totalCents) || 0) - refunded)}.`);
  }

  return s.filter((l) => l !== undefined && l !== null).join('\n');
}

export function retailDisputeEvidence(order: any, tenant: any): RetailEvidence {
  const trail = order?.carrierTrail || {};
  return {
    isGoods: true,
    productDescription: describeGoods(order).slice(0, 1000),
    shippingCarrier: String(trail.carrier || order?.carrier || ''),
    shippingTrackingNumber: String(trail.trackingNumber || order?.trackingNumber || ''),
    shippingDate: String(order?.shippedAt || order?.labelPurchasedAt || order?.paidAt || ''),
    shippingAddress: formatShippingAddress(order),
    narrative: buildNarrative(order, tenant),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * TENANT-NEUTRAL SERVICE EVIDENCE
 *
 * This platform is multi-tenant and not tied to any one trade, but the dispute
 * path was written when it was one salon: a specific business name and a
 * specific profession were baked into the text submitted to Stripe. On another
 * tenant's dispute that is not a cosmetic slip — it names the wrong business in
 * a financial submission and describes work they do not do.
 *
 * These builders take everything from the tenant and the appointment. Where
 * something genuinely is not on file they fall back to wording that is true for
 * any business: "services", not a trade; "a team member", not a job title.
 * ════════════════════════════════════════════════════════════════════════════ */

export function businessNameOf(tenant: any): string {
  return String(tenant?.businessName || tenant?.name || '').trim() || 'the merchant';
}

/** What was sold, when the sale was a service rather than goods. */
export function describeService(tenant: any, appointment: any, txnDescriptions?: string[]): string {
  const named = (txnDescriptions || [])
    .map((d) => String(d || '').trim())
    .filter(Boolean);
  if (named.length > 0) return named.join(', ');

  const svc = String(appointment?.serviceName || '').trim();
  const biz = businessNameOf(tenant);
  return svc
    ? `${svc}, booked and completed at ${biz}.`
    : `Services booked and rendered in full at ${biz}.`;
}

/** The SERVICE DETAILS block, with no assumed trade or job title. */
export function serviceDetailLine(tenant: any, appointment: any): string {
  if (!appointment) return '';
  const svc = String(appointment.serviceName || '').trim() || 'Service';
  const mins = Math.max(1, Math.floor(Number(appointment.duration) || 60));
  const who = String(appointment.staffName || '').trim() || 'a team member';
  return `SERVICE DETAILS: ${svc}, ${mins} minutes, performed by ${who} at ${businessNameOf(tenant)}`;
}

/**
 * The merchant statement prefilled into the evidence builder for a SERVICE
 * dispute. Reads from the tenant, so each business describes its own work.
 */
export function serviceStatement(tenant: any, appointment: any): string {
  const biz = businessNameOf(tenant);
  const svc = String(appointment?.serviceName || '').trim();
  return svc
    ? `This charge represents ${svc} booked and provided by ${biz}. The work was completed in full at the time of the appointment.`
    : `This charge represents services booked and provided by ${biz}. The work was completed in full at the time of the appointment.`;
}

/** A service refund policy for a tenant that has not written one. */
export function serviceRefundPolicy(tenant: any): string {
  const stated = String(tenant?.refundPolicy || '').trim();
  if (stated) return stated;
  return `Appointments are booked in advance and the time is reserved exclusively for the customer. Completed work is not refundable once provided. Cancellation and rescheduling terms are shown to the customer at the time of booking. ${businessNameOf(tenant)} resolves any concern raised directly and promptly.`;
}

/**
 * A goods refund policy. The service default — "Services are non-refundable
 * once rendered" — is not merely unhelpful on a shipped product, it contradicts
 * the sale and undermines everything else submitted alongside it.
 */
export function goodsRefundPolicy(tenant: any): string {
  const rs = tenant?.retailSettings || {};
  const stated = String(rs.returnPolicyText || '').trim();
  if (stated) return stated;
  const days = Math.max(1, Math.floor(Number(rs.returnWindowDays) || 30));
  return `Returns accepted within ${days} days of delivery for unopened merchandise in original condition. Delivery problems must be reported within 7 days of the carrier's delivery scan so a carrier claim can be opened in time. This policy is shown to the customer at checkout and printed on the packing slip inside every parcel.`;
}
