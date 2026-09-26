 // src/lib/school-identity.ts
//
// SCHOOL IDENTITY — who the school is, on every page and document.
//
//   tenants/{t}/schoolIdentity/main       text: names, licence, contact,
//                                         signer, options, image versions
//   tenants/{t}/schoolIdentity/logo       { dataUrl }   (each image in its
//   tenants/{t}/schoolIdentity/seal       { dataUrl }    own record so none
//   tenants/{t}/schoolIdentity/signature  { dataUrl }    nears the size cap)
//
// Server-only (firestore.rules). Images are served by
// /api/academy/identity-image; the signature link also needs a secret key
// that only staff tools and certificates carry, so it can't be guessed.
//
// Logo: everywhere. Seal + signature: only official documents
// (certificates, hours letters, student file / transcript, letters,
// signed enrolment agreements).
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';

export const IMAGE_KINDS = ['logo', 'seal', 'signature'] as const;
export type ImageKind = typeof IMAGE_KINDS[number];
export const TEXT_FIELDS = ['displayName', 'legalName', 'licenseNumber', 'licensingBoard', 'address', 'phone', 'email', 'website', 'signerName', 'signerTitle'] as const;
const MAX_IMAGE = 600_000; // characters of data URL (≈ 450 KB)

export interface Identity {
  displayName: string; legalName: string; licenseNumber: string; licensingBoard: string;
  address: string; phone: string; email: string; website: string; signerName: string; signerTitle: string;
  sealOnCertificates: boolean; signatureOnCertificates: boolean;
  logoUrl: string | null; sealUrl: string | null; signatureUrl: string | null;
  updatedAt: string | null; updatedBy: string | null;
}

/** What the business record already knows — the starting point. */
function defaults(t: any) {
  return {
    displayName: t?.name || '', legalName: '', licenseNumber: '', licensingBoard: '',
    address: [t?.address, t?.city, t?.state, t?.zip].filter(Boolean).join(', ') || t?.businessAddress || '',
    phone: t?.phone || '', email: t?.email || '', website: '', signerName: '', signerTitle: 'Director',
  };
}

export const imageUrl = (tenantId: string, k: ImageKind, v: string, key?: string) =>
  `/api/academy/identity-image?t=${encodeURIComponent(tenantId)}&k=${k}&v=${encodeURIComponent(v)}${key ? `&key=${encodeURIComponent(key)}` : ''}`;

/** Full identity. `forPublic` leaves the signature out unless it's shown on certificates. */
export async function getIdentity(tenantId: string, t?: any, opts: { forPublic?: boolean } = {}): Promise<Identity> {
  const db = getAdminDb();
  const tt = t || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const m = ((await db.doc(`tenants/${tenantId}/schoolIdentity/main`).get()).data() as any) || {};
  const d = defaults(tt); const out: any = {};
  for (const f of TEXT_FIELDS) out[f] = (m[f] ?? '') !== '' ? String(m[f]) : d[f];
  const v = m.versions || {};
  const sigOnCert = m.signatureOnCertificates !== false;
  return {
    ...out,
    sealOnCertificates: m.sealOnCertificates !== false, signatureOnCertificates: sigOnCert,
    logoUrl: v.logo ? imageUrl(tenantId, 'logo', v.logo) : (tt.logoUrl || tt.bookingPageSettings?.logoUrl || null),
    sealUrl: v.seal ? imageUrl(tenantId, 'seal', v.seal) : null,
    signatureUrl: v.signature && m.sigKey && (!opts.forPublic || sigOnCert) ? imageUrl(tenantId, 'signature', v.signature, m.sigKey) : null,
    updatedAt: m.updatedAt || null, updatedBy: m.updatedBy || null,
  };
}

/** Document branding (DocBrand in doc-theme.ts) from the identity. */
export function brandFromIdentity(id: Identity, t: any) {
  return {
    name: id.displayName || t?.name || 'Academy', legalName: id.legalName || null, logoUrl: id.logoUrl, color: t?.bookingPageSettings?.primaryColor || null,
    address: id.address || null, phone: id.phone || null, email: id.email || null, website: id.website || null,
    licenseNumber: id.licenseNumber || null, licensingBoard: id.licensingBoard || null,
    sealUrl: id.sealUrl, signatureUrl: id.signatureUrl, signerName: id.signerName || null, signerTitle: id.signerTitle || null,
  };
}

const cleanImage = (x: any): string | null | undefined => {
  if (x === undefined) return undefined;           // keep what's there
  if (x === null || x === '') return null;         // remove
  const s = String(x);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) throw new Error('Images must be PNG, JPG or WebP.');
  if (s.length > MAX_IMAGE) throw new Error('That image is too large — try a smaller one.');
  return s;
};

/** Save text + options; images: undefined = keep, null = remove, data URL = replace. Returns a change summary. */
export async function saveIdentity(tenantId: string, body: any, by: string) {
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/schoolIdentity/main`);
  const m = ((await ref.get()).data() as any) || {};
  const patch: any = { updatedAt: new Date().toISOString(), updatedBy: by };
  for (const f of TEXT_FIELDS) if (f in (body || {})) patch[f] = String(body[f] ?? '').trim().slice(0, f === 'address' ? 300 : 160);
  if ('sealOnCertificates' in body) patch.sealOnCertificates = body.sealOnCertificates !== false;
  if ('signatureOnCertificates' in body) patch.signatureOnCertificates = body.signatureOnCertificates !== false;
  const versions = { ...(m.versions || {}) }; const changed: string[] = [];
  for (const k of IMAGE_KINDS) {
    const img = cleanImage(body?.images?.[k]);
    if (img === undefined) continue;
    const iref = db.doc(`tenants/${tenantId}/schoolIdentity/${k}`);
    if (img === null) { await iref.delete(); delete versions[k]; changed.push(`${k} removed`); }
    else { await iref.set({ dataUrl: img, updatedAt: patch.updatedAt, updatedBy: by }); versions[k] = randomBytes(4).toString('hex'); changed.push(`${k} ${m.versions?.[k] ? 'replaced' : 'added'}`); }
  }
  patch.versions = versions;
  if (!m.sigKey) patch.sigKey = randomBytes(12).toString('hex');
  if (changed.includes('signature replaced') || changed.includes('signature added')) patch.sigKey = randomBytes(12).toString('hex'); // old signature links stop working
  // Write the whole record: a merge would keep removed images inside `versions`.
  await ref.set({ ...m, ...patch });
  const textChanged = TEXT_FIELDS.filter((f) => f in patch && (m[f] ?? '') !== patch[f]);
  return { changed, textChanged };
}

/** The image itself, for the public image route. Signature needs the key. */
export async function identityImage(tenantId: string, k: string, key?: string | null): Promise<{ type: string; bytes: Buffer } | null> {
  if (!(IMAGE_KINDS as readonly string[]).includes(k) || !/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return null;
  const db = getAdminDb();
  if (k === 'signature') { const m = ((await db.doc(`tenants/${tenantId}/schoolIdentity/main`).get()).data() as any) || {}; if (!m.sigKey || key !== m.sigKey) return null; }
  const d = ((await db.doc(`tenants/${tenantId}/schoolIdentity/${k}`).get()).data() as any) || null;
  const mt = String(d?.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/); if (!mt) return null;
  return { type: mt[1], bytes: Buffer.from(mt[2], 'base64') };
}
