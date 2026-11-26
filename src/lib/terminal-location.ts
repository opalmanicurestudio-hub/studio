// src/lib/terminal-location.ts — WHERE A BUSINESS'S CARD READERS ARE, FOR THE CARD COMPANY. Every reader is registered
// to a location, and a location is the business's real address (never a made-up one). It's made the first time it's
// needed: the front desk's reader connecting (api/stripe/terminal/connection-token), or a manager adding a reader in
// Settings (api/stripe/terminal/register-reader), so a café that never opens the front desk can still add its reader.
// Server only.

import { accountOf } from '@/lib/reader-sale';

export type TerminalLocation = { ok: true; id: string } | { ok: false; error: string };

export async function ensureTerminalLocation(db: any, stripe: any, tenantId: string, tenant: any): Promise<TerminalLocation> {
  const acct = String(accountOf(tenant) || '');
  if (!acct) return { ok: false, error: 'Connect your Stripe account in Settings first. The card reader takes payments through it.' };
  if (tenant?.stripeTerminalLocationId) return { ok: true, id: String(tenant.stripeTerminalLocationId) };
  const p = tenant?.studioAddressParts || {};
  const line1 = String(p.street || p.line1 || '').trim(), city = String(p.city || '').trim(), state = String(p.state || '').trim(), zip = String(p.zip || p.postalCode || '').trim();
  if (!line1 || !city || !state || !zip) return { ok: false, error: 'Add your business address (street, city, state and ZIP) in Settings before connecting a card reader.' };
  const location = await stripe.terminal.locations.create(
    { display_name: String(tenant?.name || 'Front desk').slice(0, 100), address: { line1, city, state, country: String(p.country || 'US'), postal_code: zip } },
    { stripeAccount: acct },
  );
  await db.doc(`tenants/${tenantId}`).update({ stripeTerminalLocationId: location.id });
  return { ok: true, id: String(location.id) };
}
