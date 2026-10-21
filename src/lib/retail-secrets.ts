// src/lib/retail-secrets.ts — THE SHOP'S SECRETS, SERVER ONLY. The Shippo API key and the shared wholesale access code
// live in tenants/{id}/private/retail, which no browser can read (the business record itself is public, because the
// shop and booking pages need it). The business record only carries harmless flags: whether a key is connected, its
// last four characters, and whether a wholesale code is set. Shops that saved these on the business record before are
// moved over the first time the server reads them.
import { FieldValue } from 'firebase-admin/firestore';

export interface RetailSecrets { shippoApiKey: string; wholesaleAccessCode: string }

const ref = (db: any, t: string) => db.doc(`tenants/${t}/private/retail`);

export function publicFlags(s: RetailSecrets) {
  return { shippoConnected: !!s.shippoApiKey, shippoKeyLast4: s.shippoApiKey ? s.shippoApiKey.slice(-4) : '', wholesaleCodeSet: !!s.wholesaleAccessCode };
}

export async function getRetailSecrets(db: any, t: string, tenantData?: any): Promise<RetailSecrets> {
  const snap = await ref(db, t).get();
  const priv: any = snap.exists ? snap.data() || {} : {};
  const tenant: any = tenantData || ((await db.doc(`tenants/${t}`).get()).data() || {});
  const rs = tenant.retailSettings || {};
  const legacyKey = String(rs.shippoApiKey || '').trim(); const legacyCode = String(rs.wholesaleAccessCode || '').trim();
  const out: RetailSecrets = { shippoApiKey: String(priv.shippoApiKey || legacyKey || '').trim(), wholesaleAccessCode: String(priv.wholesaleAccessCode || legacyCode || '').trim() };
  if (legacyKey || legacyCode || ('shippoApiKey' in rs) || ('wholesaleAccessCode' in rs)) {
    // Move them off the public record now.
    try {
      await ref(db, t).set({ shippoApiKey: out.shippoApiKey, wholesaleAccessCode: out.wholesaleAccessCode, movedAt: new Date().toISOString() }, { merge: true });
      const f = publicFlags(out);
      await db.doc(`tenants/${t}`).update({ 'retailSettings.shippoApiKey': FieldValue.delete(), 'retailSettings.wholesaleAccessCode': FieldValue.delete(),
        'retailSettings.shippoConnected': f.shippoConnected, 'retailSettings.shippoKeyLast4': f.shippoKeyLast4, 'retailSettings.wholesaleCodeSet': f.wholesaleCodeSet });
    } catch { /* next read tries again */ }
  }
  return out;
}

export async function setRetailSecrets(db: any, t: string, patch: Partial<RetailSecrets>): Promise<RetailSecrets> {
  const cur = await getRetailSecrets(db, t);
  const next: RetailSecrets = { shippoApiKey: patch.shippoApiKey !== undefined ? String(patch.shippoApiKey).trim() : cur.shippoApiKey, wholesaleAccessCode: patch.wholesaleAccessCode !== undefined ? String(patch.wholesaleAccessCode).trim() : cur.wholesaleAccessCode };
  await ref(db, t).set({ ...next, updatedAt: new Date().toISOString() }, { merge: true });
  const f = publicFlags(next);
  // A shop connecting its own Shippo account for the first time starts with carrier address checks on (Policies turns
  // them off). Shops that already chose either way keep their choice.
  let checksOn: Record<string, boolean> = {};
  if (!cur.shippoApiKey && next.shippoApiKey) {
    try { const rs: any = ((await db.doc(`tenants/${t}`).get()).data() || {}).retailSettings || {}; if (rs.addressValidationEnabled === undefined) checksOn = { 'retailSettings.addressValidationEnabled': true }; } catch { /* stays as it was */ }
  }
  await db.doc(`tenants/${t}`).update({ 'retailSettings.shippoConnected': f.shippoConnected, 'retailSettings.shippoKeyLast4': f.shippoKeyLast4, 'retailSettings.wholesaleCodeSet': f.wholesaleCodeSet, ...checksOn });
  return next;
}

/** The Shippo key to use for this shop: its own, or the platform's if it has none. */
export async function shippoKeyFor(db: any, t: string, tenantData?: any): Promise<string> {
  const s = await getRetailSecrets(db, t, tenantData);
  return String(s.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
}
