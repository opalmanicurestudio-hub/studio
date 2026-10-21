// src/app/api/retail/address-check/route.ts — "IS THIS ADDRESS RIGHT?", asked while the customer can still fix it:
// at checkout before they pay, and on their order page when they change it. Public, like the shop.
//   POST { tenantId, address } → { verdict, carrier, unitMissing, refuse, message, token }
//     verdict    valid | corrected (carrier holds a version that differs in a way that matters) | unconfirmed |
//                undeliverable | skipped (checks are off, the carrier couldn't be reached, or too many checks)
//     carrier    the carrier's whole version, when it's worth offering
//     unitMissing  ask for an apartment or unit number (lib/address-flow)
//     refuse     the shop turns away addresses the carrier can't find, so this one can't be used
//     token      the check, signed, for checkout or the change to use instead of checking again (lib/address-flow-server)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { addressMessage, addressPolicy, shouldBlock, validateAddress, type AddressCheck } from '@/lib/address-validation';
import { checkAllowed, signCheck } from '@/lib/address-flow-server';
import { shippoKeyFor } from '@/lib/retail-secrets';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const a = b.address || {};
  const address = {
    name: String(a.name || '').trim().slice(0, 80), line1: String(a.line1 || '').trim().slice(0, 120), line2: String(a.line2 || '').trim().slice(0, 120),
    city: String(a.city || '').trim().slice(0, 60), state: String(a.state || '').trim().slice(0, 30), postalCode: String(a.postalCode || '').trim().slice(0, 15), country: 'US',
  };
  if (!address.line1 || !address.city || !address.postalCode) return NextResponse.json({ ok: false, error: 'Add the street, city and ZIP code.' }, { status: 400 });

  const db = getAdminDb();
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tSnap.exists) return NextResponse.json({ ok: false, error: 'Shop not found.' }, { status: 404 });
  const tenant: any = tSnap.data() || {};
  const policy = addressPolicy(tenant.retailSettings);
  const skipped: AddressCheck = { verdict: 'skipped', suggestion: null, carrier: null, unitMissing: false, messages: [], checkedAt: new Date().toISOString() };

  let check = skipped;
  if (policy.enabled) {
    const who = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon';
    if (await checkAllowed(db, tenantId, who)) check = await validateAddress({ address, apiKey: await shippoKeyFor(db, tenantId, tenant), policy });
  }
  return NextResponse.json({
    ok: true,
    verdict: check.verdict,
    carrier: check.carrier || null,
    unitMissing: check.unitMissing === true,
    refuse: shouldBlock(check, policy),
    message: check.verdict === 'undeliverable' ? addressMessage(check) : '',
    // Only a real answer is signed: "skipped" (checks off, carrier down, too many checks) leaves checkout to check.
    token: check.verdict === 'skipped' ? null : signCheck(tenantId, address, check),
  });
}
