// src/lib/w9-record.ts — A RENTER'S W-9, checked and sealed the same way wherever it's sent from.
//
// The renter portal (/api/portal/renter, actions w9-status and w9-save) and the older staff-portal route
// (/api/booths/w9) both take a W-9 here. The tax number is encrypted at once (lib/tin-crypto) and only its last four
// digits are kept readable; nothing here ever logs or returns the full number.
import { encryptTin, tinLast4, maskTin } from '@/lib/tin-crypto';

import { W9_ENTITY_TYPES } from '@/lib/w9-entity-types';
export { W9_ENTITY_TYPES };

/** A nine-digit SSN or EIN, with or without the usual dashes. */
export function validTin(tin: unknown, type: unknown): boolean {
  const raw = String(tin || '');
  if (type !== 'ssn' && type !== 'ein') return false;
  if (!/^[\d\s-]+$/.test(raw)) return false;
  return raw.replace(/\D/g, '').length === 9;
}

export type W9Input = {
  tin?: unknown; tinType?: unknown; legalName?: unknown; businessName?: unknown;
  address?: { street?: unknown; city?: unknown; state?: unknown; zip?: unknown } | null;
  entityType?: unknown; certifiedUnderPenalty?: unknown;
};

/** What's wrong with a W-9 as sent, in plain words, or null when it can be saved. */
export function w9Problem(b: W9Input): string | null {
  if (!b.tin || !b.tinType) return 'Your SSN or EIN is needed.';
  if (b.tinType !== 'ssn' && b.tinType !== 'ein') return 'Choose SSN or EIN.';
  if (!validTin(b.tin, b.tinType)) return b.tinType === 'ssn' ? 'An SSN has nine digits.' : 'An EIN has nine digits.';
  if (!String(b.legalName || '').trim()) return 'Your legal name is needed.';
  if (b.certifiedUnderPenalty !== true) return 'Check the box to sign it.';
  return null;
}

/** The record to store on the renter: the number encrypted, its last four digits, and the rest as given. */
export function sealW9(b: W9Input, nowIso: string): Record<string, any> {
  const digits = String(b.tin).replace(/\D/g, '');
  const a = b.address || {};
  return {
    encryptedTin: encryptTin(digits),
    tinType: b.tinType,
    tinLast4: tinLast4(digits),
    legalName: String(b.legalName || '').trim().slice(0, 120),
    businessName: String(b.businessName || '').trim().slice(0, 120),
    address: {
      street: String(a.street || '').trim().slice(0, 200),
      city: String(a.city || '').trim().slice(0, 100),
      state: String(a.state || '').trim().slice(0, 50),
      zip: String(a.zip || '').trim().slice(0, 20),
    },
    entityType: W9_ENTITY_TYPES.includes(String(b.entityType || '')) ? String(b.entityType) : String(b.entityType || '').trim().slice(0, 60),
    certifiedUnderPenalty: true,
    certifiedAt: nowIso,
    collectedAt: nowIso,
  };
}

/** What may be shown of a stored W-9: never the encrypted number, only the masked one. */
export function w9View(w9: any): { tinMasked: string; tinType: string; legalName: string; businessName: string; address: any; entityType: string; certifiedAt: string; collectedAt: string } | null {
  if (!w9 || !w9.tinLast4) return null;
  return {
    tinMasked: maskTin(String(w9.tinLast4), w9.tinType === 'ein' ? 'ein' : 'ssn'),
    tinType: w9.tinType === 'ein' ? 'ein' : 'ssn',
    legalName: String(w9.legalName || ''),
    businessName: String(w9.businessName || ''),
    address: w9.address || { street: '', city: '', state: '', zip: '' },
    entityType: String(w9.entityType || ''),
    certifiedAt: String(w9.certifiedAt || ''),
    collectedAt: String(w9.collectedAt || ''),
  };
}
