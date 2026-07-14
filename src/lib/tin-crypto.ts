/**
 * src/lib/tin-crypto.ts — v1
 *
 * AES-256-GCM encryption/decryption for Taxpayer Identification Numbers
 * (TINs: SSN or EIN). Server-side ONLY — this file must never be imported
 * by any 'use client' component or any route that runs in the browser.
 *
 * Key management:
 *  - Set W9_ENCRYPTION_KEY in Vercel env (Settings → Environment Variables).
 *  - Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *  - The key is a 64-char hex string (32 bytes).
 *  - NEVER log the key. NEVER commit it. NEVER put it in NEXT_PUBLIC_*.
 *  - If the key is rotated, existing encrypted TINs must be re-encrypted
 *    before the old key is removed (migration script, not included here).
 *
 * Storage format: "iv_hex:authTag_hex:ciphertext_base64"
 *  - iv (12 bytes random per encryption) — makes each encryption unique
 *  - authTag (16 bytes) — GCM authentication tag (integrity + authenticity)
 *  - ciphertext — the encrypted TIN
 *
 * This format is self-contained: the IV and tag travel with the ciphertext,
 * so decryption never needs anything except the key and this string.
 *
 * What is stored in Firestore:
 *  - tenants/{tenantId}/renters/{renterId}.w9 = {
 *      encryptedTin: string,        // this format
 *      tinType: 'ssn' | 'ein',     // NOT the TIN itself — safe to store plain
 *      tinLast4: string,            // last 4 digits only — for display/audit
 *      legalName: string,
 *      businessName: string,
 *      address: { street, city, state, zip },
 *      entityType: string,
 *      certifiedAt: string,         // ISO timestamp of checkbox agreement
 *      collectedAt: string,
 *    }
 *
 * What is NEVER stored:
 *  - The full TIN in plaintext, anywhere
 *  - The full TIN in logs
 *  - The full TIN in client-side state
 */

import crypto from 'crypto';

const KEY_ENV = 'W9_ENCRYPTION_KEY';

function getKey(): Buffer {
  const hex = process.env[KEY_ENV];
  if (!hex || hex.length !== 64) {
    throw new Error(
      `[tin-crypto] ${KEY_ENV} must be a 64-char hex string (32 bytes). ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a TIN. Returns a self-contained string safe to store in Firestore.
 * Throws if the env key is not set.
 */
export function encryptTin(tin: string): string {
  const key = getKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(tin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypt a TIN previously encrypted with encryptTin().
 * Returns the plaintext TIN or throws on tampering/wrong key.
 */
export function decryptTin(stored: string): string {
  const key = getKey();
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('[tin-crypto] Invalid stored format');
  const [ivHex, tagHex, ctBase64] = parts;
  const iv         = Buffer.from(ivHex, 'hex');
  const tag        = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Returns only the last 4 digits/chars of a TIN — safe for display and audit
 * without exposing the full number.
 */
export function tinLast4(tin: string): string {
  const digits = tin.replace(/\D/g, '');
  return digits.slice(-4);
}

/**
 * Masks a TIN for display: "***-**-6789" (SSN) or "**-***6789" (EIN).
 * Accepts the last4 stored value — never needs the full TIN.
 */
export function maskTin(last4: string, type: 'ssn' | 'ein'): string {
  return type === 'ssn' ? `***-**-${last4}` : `**-***${last4}`;
}
