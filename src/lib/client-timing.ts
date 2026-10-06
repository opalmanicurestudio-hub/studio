// src/lib/client-timing.ts — A CLIENT'S OWN TIME NEEDS, without changing the service for everyone.
// Stored on the client as a DIFFERENCE from the service's length (so it still holds if the service's length changes or
// another provider takes them):
//   client.timing = { all?: number,                                  // extra minutes on every service (optional)
//                     services?: { [serviceId]: { extra, reason?, setBy?, setAt?, chargeCents? } } }
// `extra` may be negative for someone reliably quicker. `reason` is private to the team and never shown to the client.
// The business decides what extra time costs (Settings → Extra time), the same for every client:
//   tenant.extraTime = { mode: 'none' | 'per15', centsPer15?: number }
// and a service can opt out (service.extraTimeCharge === false). A per-client fixed amount (chargeCents) overrides the rate.
// Base it on time actually taken and service factors — never on a texture or any personal label.

export type ClientTimingEntry = { extra: number; reason?: string | null; setBy?: string | null; setAt?: string | null; chargeCents?: number | null };
export type ClientTiming = { all?: number | null; services?: Record<string, ClientTimingEntry> };
const clampMin = (n: any) => Math.max(-60, Math.min(240, Math.round(Number(n) || 0)));

/** Extra minutes this client usually needs on this service (0 when nothing is set). */
export function extraMinutesFor(client: any, serviceId: string | null | undefined): number {
  const t: ClientTiming = client?.timing || {}; const e = serviceId ? t.services?.[serviceId] : undefined;
  if (e && Number.isFinite(Number(e.extra))) return clampMin(e.extra);
  return clampMin(t.all || 0);
}
/** The business's rule for charging extra time. */
export function extraTimePolicy(tenant: any): { mode: 'none' | 'per15'; centsPer15: number } {
  const x = tenant?.extraTime || {}; const cents = Math.max(0, Math.round(Number(x.centsPer15) || 0));
  return { mode: x.mode === 'per15' && cents > 0 ? 'per15' : 'none', centsPer15: cents };
}
/** What the extra time costs this client on this service, in cents (0 = no charge). Never negative: quicker clients pay the normal price. */
export function extraChargeCents(tenant: any, service: any, client: any, serviceId?: string | null): number {
  const sid = serviceId || service?.id; const mins = extraMinutesFor(client, sid); if (mins <= 0) return 0;
  const entry = (client?.timing as ClientTiming | undefined)?.services?.[String(sid || '')];
  if (entry && Number.isFinite(Number(entry.chargeCents)) && Number(entry.chargeCents) >= 0) return Math.round(Number(entry.chargeCents));
  if (service?.extraTimeCharge === false) return 0;
  const pol = extraTimePolicy(tenant); return pol.mode === 'per15' ? Math.ceil(mins / 15) * pol.centsPer15 : 0;
}
/** "+20 min" / "−10 min" */
export function minutesLabel(m: number) { return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} min`; }
