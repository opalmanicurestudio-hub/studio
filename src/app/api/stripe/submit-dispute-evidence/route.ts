import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import {
  describeService, goodsRefundPolicy, retailDisputeEvidence,
  serviceDetailLine, serviceRefundPolicy,
} from '@/lib/retail-dispute-evidence';
import { requireRole } from '@/lib/route-guard';
import { getAdminStorage } from '@/lib/firebase-admin';

// ─── /api/stripe/submit-dispute-evidence/route.ts ─────────────────────────────
// Assembles and submits evidence to Stripe for a dispute.
// Called from the EvidenceBuilderDialog in DisputeCenter.
//
// Stripe evidence fields used:
//   customer_name              → client name
//   customer_email_address     → client email if on file
//   product_description        → service description
//   service_date               → appointment date
//   service_documentation      → text summary of service rendered
//   customer_signature         → signed consent form image (strongest evidence)
//   receipt                    → checkout receipt image
//   billing_address             → client address if on file
//   uncategorized_text         → extra notes from owner
//   refund_policy              → studio refund policy from tenant settings
//
// RETAIL DISPUTES TAKE A DIFFERENT PATH. Everything above is service-shaped,
// and a shipped product described as "services rendered" loses a dispute it
// should win — the issuer is looking for a carrier, a tracking number and a
// delivery address, and a service narrative answers none of them while
// contradicting the customer's own description of the purchase.
//
// The link was already in the data: the retail webhook stamps retailOrderId on
// the income transaction it writes. This route now follows it, so it works on
// disputes ALREADY in the system without touching either Stripe webhook.
//
// Retail evidence fields used instead:
//   product_description        → the actual goods, with SKUs and quantities
//   shipping_carrier           → carrier from the tracking trail
//   shipping_tracking_number   → tracking number
//   shipping_date              → dispatch date
//   shipping_address           → the address the CUSTOMER entered at checkout
//   uncategorized_text         → scan verification, weight check, carrier's own
//                                report, and every customer notification
//
// WHO MAY SUBMIT: a manager or the owner, signed in. Submitting is final —
// Stripe takes no more evidence after it — so it's never open to anyone else.
// The dispute and the Stripe account come from the business's own records (the
// dispute's record and the business), never from what the screen sends. The
// files attached are only ones the business itself stored: its own storage, in
// its own folder (or an image kept inline). They're read straight from storage;
// no address the screen sends is ever fetched.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore }                 = require('firebase-admin/firestore');
  const APP_NAME = 'admin-dispute';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

// The business's own stored file behind a link: a file in our storage bucket, in this business's folder
// (tenants/{tenantId}/…), or an image kept inline. Anything else — another site, another bucket, another business's
// folder — is never read. Returns where it is, or null.
const MAX_FILE_BYTES = 5_000_000;
const ourBuckets = () => [process.env.FIREBASE_STORAGE_BUCKET, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET]
  .map((b) => String(b || '').trim().replace(/^gs:\/\//, '').replace(/\/+$/, '')).filter(Boolean);
function ownStoredFile(link: unknown, tenantId: string): { inline: Buffer } | { bucket: string; path: string } | null {
  const s = String(link || '').trim();
  if (!s || !tenantId) return null;
  const inline = s.match(/^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (inline) { const buf = Buffer.from(inline[2], 'base64'); return buf.length && buf.length <= MAX_FILE_BYTES ? { inline: buf } : null; }
  let bucket = '', path = '';
  try {
    if (s.startsWith('/api/files/view?')) {
      const q = new URL(s, 'https://app.invalid').searchParams;
      if (q.get('t') !== tenantId) return null;
      bucket = ourBuckets()[0] || ''; path = String(q.get('p') || '');
    } else {
      const u = new URL(s);
      if (u.protocol !== 'https:') return null;
      if (u.hostname === 'firebasestorage.googleapis.com') {
        const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/); if (!m) return null;
        bucket = decodeURIComponent(m[1]); path = decodeURIComponent(m[2]);
      } else if (u.hostname === 'storage.googleapis.com') {
        const m = u.pathname.match(/^\/([^/]+)\/(.+)$/); if (!m) return null;
        bucket = decodeURIComponent(m[1]); path = decodeURIComponent(m[2]);
      } else return null;
    }
  } catch { return null; }
  if (!bucket || !ourBuckets().includes(bucket)) return null;
  if (!path.startsWith(`tenants/${tenantId}/`) || path.includes('..') || path.includes('\\')) return null;
  return { bucket, path };
}

// Read one of the business's own stored files (for Stripe file uploads). Null when it isn't theirs or can't be read.
async function storedFileBuffer(link: unknown, tenantId: string): Promise<Buffer | null> {
  const where = ownStoredFile(link, tenantId);
  if (!where) return null;
  if ('inline' in where) return where.inline;
  try {
    const [buf] = await (getAdminStorage() as any).bucket(where.bucket).file(where.path).download();
    return buf && buf.length && buf.length <= MAX_FILE_BYTES ? Buffer.from(buf) : null;
  } catch {
    return null;
  }
}

// Upload a file to Stripe (returns file ID)
async function uploadFileToStripe(
  stripe: Stripe,
  buffer: Buffer,
  filename: string,
  purpose: Stripe.FileCreateParams.Purpose,
  connectedAccountId: string
): Promise<string | null> {
  try {
    const { Readable } = require('stream');
    const stream = Readable.from(buffer);
    (stream as any).name = filename;

    const file = await stripe.files.create(
      { purpose, file: { data: stream, name: filename, type: 'application/octet-stream' } },
      { stripeAccount: connectedAccountId }
    );
    return file.id;
  } catch (err) {
    console.error('[dispute-evidence] File upload failed:', err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const {
    tenantId,
    disputeId,
    stripeDisputeId: askedDisputeId,
    evidenceText,
    consentFormUrls,
    signatureUrls,
    receiptUrl,
    extraNotes,
    additionalFiles,  // [{ url: string, purpose: string }]
  } = await req.json().catch(() => ({} as any));

  if (!tenantId || !disputeId || !/^[A-Za-z0-9_-]{1,120}$/.test(String(disputeId))) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const g = await requireRole(req, String(tenantId), 'manager'); if (g.deny) return g.deny;

  const db     = getAdminDb();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-04-30.basil' as any,
  });

  // ── The dispute and the account, from the business's own records ─────────
  const tenantDoc  = await db.collection('tenants').doc(String(tenantId)).get();
  const tenant     = tenantDoc.data() || {};
  const disputeRef = db.collection(`tenants/${tenantId}/disputes`).doc(String(disputeId));
  const disputeDoc = await disputeRef.get();
  if (!disputeDoc.exists) return NextResponse.json({ ok: false, error: 'We couldn’t find that dispute.' }, { status: 404 });
  const dispute    = disputeDoc.data() || {};
  const stripeDisputeId = String(dispute.stripeDisputeId || '');
  const stripeConnectedAccountId = String(tenant.stripeAccountId || '');
  if (!stripeDisputeId || (askedDisputeId && String(askedDisputeId) !== stripeDisputeId)) {
    return NextResponse.json({ ok: false, error: 'That dispute doesn’t match this business’s records.' }, { status: 400 });
  }
  if (!stripeConnectedAccountId) {
    return NextResponse.json({ ok: false, error: 'This business has no payment account connected.' }, { status: 400 });
  }
  if (dispute.stripeConnectedAccountId && String(dispute.stripeConnectedAccountId) !== stripeConnectedAccountId) {
    return NextResponse.json({ ok: false, error: 'This dispute belongs to a payment account the business no longer uses. Respond to it in Stripe.' }, { status: 409 });
  }
  // Once: evidence already sent is done; a submission under way is left to finish.
  if (dispute.evidenceSubmitted === true) return NextResponse.json({ ok: true, already: true });
  const nowIso = new Date().toISOString();
  const claim: any = await db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(disputeRef)).data() || {};
    if (d.evidenceSubmitted === true) return { already: true };
    if (d.evidenceSubmittingAt && Date.now() - (Date.parse(String(d.evidenceSubmittingAt)) || 0) < 2 * 60000) return { busy: true };
    tx.set(disputeRef, { evidenceSubmittingAt: nowIso, evidenceSubmittingBy: g.actor?.name || null }, { merge: true });
    return { ok: true };
  });
  if (claim.already) return NextResponse.json({ ok: true, already: true });
  if (claim.busy) return NextResponse.json({ ok: false, error: 'This evidence is being sent already. Give it a moment.' }, { status: 409 });

  try {

    // Fetch client if linked
    let client: any = null;
    if (dispute.clientId) {
      const clientDoc = await db.collection(`tenants/${tenantId}/clients`).doc(dispute.clientId).get();
      client = clientDoc.data();
    }

    // Fetch appointment if linked
    let appointment: any = null;
    if (dispute.appointmentId) {
      const aptDoc = await db.collection(`tenants/${tenantId}/appointments`).doc(dispute.appointmentId).get();
      appointment = aptDoc.data();
    }

    // ── Is this a RETAIL order dispute? ───────────────────────────────────────
    // The dispute record itself may not say so — it was written before retail
    // existed on this path — but the income transaction behind the charge
    // carries retailOrderId. Follow it rather than requiring a backfill.
    let retailOrder: any = null;
    try {
      let retailOrderId: string = String(dispute.retailOrderId || '').trim();
      if (!retailOrderId && dispute.stripeChargeId) {
        const txns = await db.collection(`tenants/${tenantId}/transactions`)
          .where('stripeChargeId', '==', dispute.stripeChargeId)
          .where('taxBucket', '==', 'revenue')
          .limit(1).get();
        if (!txns.empty) retailOrderId = String(txns.docs[0].data().retailOrderId || '').trim();
      }
      if (retailOrderId) {
        const oDoc = await db.collection(`tenants/${tenantId}/retailOrders`).doc(retailOrderId).get();
        if (oDoc.exists) retailOrder = { id: oDoc.id, ...(oDoc.data() as any) };
      }
    } catch (err) {
      // A lookup failure must never block submitting SOMETHING before the
      // deadline. Falls through to the service path below.
      console.error('[dispute-evidence] retail order lookup failed:', err);
    }

    // Fetch checkout transactions for the service description.
    //
    // MULTI-TENANT: this used to hardcode one trade's wording, which meant every
    // other business on the platform submitted a description of work they do not
    // perform. Everything now comes from the tenant, the appointment, or the
    // transaction, with a trade-neutral fallback.
    let txnDescriptions: string[] = [];
    if (dispute.checkoutSessionId) {
      const txnsSnap = await db.collection(`tenants/${tenantId}/transactions`)
        .where('checkoutSessionId', '==', dispute.checkoutSessionId)
        .where('type', '==', 'income')
        .get();
      txnDescriptions = txnsSnap.docs
        .map((d: any) => d.data().description)
        .filter((d: string) => d && !d.includes('Tax') && !d.includes('Tip'));
    }
    const serviceDescription = describeService(tenant, appointment, txnDescriptions);

    // ── Build evidence object ─────────────────────────────────────────────────
    const goods = retailOrder ? retailDisputeEvidence(retailOrder, tenant) : null;

    const evidence: Stripe.DisputeUpdateParams.Evidence = {
      customer_name:         retailOrder?.customerName || client?.name || dispute.clientName || 'Client on file',
      customer_email_address: retailOrder?.customerEmail || client?.email || undefined,
      product_description:   goods ? goods.productDescription : serviceDescription,
      // A goods sale has no service date. Sending one invites the issuer to
      // treat the whole submission as boilerplate.
      service_date: goods ? undefined : (dispute.createdAt
        ? new Date(dispute.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : undefined),
      service_documentation: goods ? undefined : evidenceText,

      // The fields an issuer actually weighs on a "product not received"
      // dispute. Only ever set when there is a real value — an empty carrier
      // or tracking string is worse than the field being absent.
      shipping_carrier:         goods?.shippingCarrier || undefined,
      shipping_tracking_number: goods?.shippingTrackingNumber || undefined,
      shipping_date:            goods?.shippingDate || undefined,
      shipping_address:         goods?.shippingAddress || undefined,

      uncategorized_text:    [
        extraNotes,
        goods ? goods.narrative : '',
        // Staff notes typed into the builder still count, even on a goods
        // dispute — they are the only part a human wrote for this case.
        goods && evidenceText ? `MERCHANT STATEMENT:\n${evidenceText}` : '',
        goods
          ? `RETURN AND DELIVERY POLICY:\n${goodsRefundPolicy(tenant)}`
          : (tenant.refundPolicy ? `STUDIO REFUND POLICY:\n${tenant.refundPolicy}` : ''),
        !goods && client?.address
          ? `CLIENT ADDRESS: ${client.address.street}, ${client.address.city}, ${client.address.state} ${client.address.zip}`
          : '',
        !goods && appointment ? serviceDetailLine(tenant, appointment) : '',
      ].filter(Boolean).join('\n\n') || undefined,

      refund_policy: goods ? goodsRefundPolicy(tenant) : serviceRefundPolicy(tenant),
    };

    // ── Upload files to Stripe ────────────────────────────────────────────────
    // Only the business's own stored files (storedFileBuffer). The signatures and receipt are the ones on the
    // dispute's record when it has them.
    const listOf = (v: any) => (Array.isArray(v) ? v.map((x: any) => String(x || '')).filter(Boolean).slice(0, 10) : []);
    // 1. Consent forms / signatures — uploaded as customer_signature
    const allSignatureUrls = [
      ...listOf(Array.isArray(dispute.consentFormUrls) ? dispute.consentFormUrls : consentFormUrls),
      ...listOf(Array.isArray(dispute.signatureUrls) ? dispute.signatureUrls : signatureUrls),
    ];
    const receiptLink = String(dispute.receiptUrl || receiptUrl || '');

    if (allSignatureUrls.length > 0) {
      // Upload the first signature as customer_signature (Stripe accepts one)
      const buf = await storedFileBuffer(allSignatureUrls[0], String(tenantId));
      if (buf) {
        const fileId = await uploadFileToStripe(
          stripe, buf, 'consent-signature.png', 'dispute_evidence', stripeConnectedAccountId
        );
        if (fileId) (evidence as any).customer_signature = fileId;
      }

      // If there are additional signatures, include their URLs in uncategorized_text
      if (allSignatureUrls.length > 1) {
        const additionalUrls = allSignatureUrls.slice(1).join('\n');
        evidence.uncategorized_text = (evidence.uncategorized_text || '') +
          `\n\nADDITIONAL SIGNED DOCUMENTS:\n${additionalUrls}`;
      }
    }

    // 2. Receipt — uploaded as receipt
    if (receiptLink) {
      const buf = await storedFileBuffer(receiptLink, String(tenantId));
      if (buf) {
        const fileId = await uploadFileToStripe(
          stripe, buf, 'receipt.png', 'dispute_evidence', stripeConnectedAccountId
        );
        if (fileId) (evidence as any).receipt = fileId;
      }
    }

    // ── Upload additional manual files ──────────────────────────────────────────
    // Stripe accepts up to 5 files total. Map each to the correct evidence field.
    // Priority order: customer_signature > receipt > service_documentation >
    //                 customer_communication > uncategorized_file
    const additionalFileIds: { purpose: string; fileId: string }[] = [];

    if (additionalFiles && Array.isArray(additionalFiles)) {
      for (const af of additionalFiles.slice(0, 5)) {
        const buf = await storedFileBuffer(af?.url, String(tenantId));
        if (!buf) continue;
        const where = ownStoredFile(af.url, String(tenantId));
        const ext      = (where && 'path' in where ? where.path.split('.').pop() : '')?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
        const purpose  = String(af.purpose || 'uncategorized_file').replace(/[^a-z_]/g, '').slice(0, 40) || 'uncategorized_file';
        af.purpose = purpose;
        const filename = `evidence-${purpose}.${ext}`;
        const fileId   = await uploadFileToStripe(
          stripe, buf, filename, 'dispute_evidence', stripeConnectedAccountId
        );
        if (fileId) additionalFileIds.push({ purpose: af.purpose, fileId });
      }

      // Map uploaded file IDs to Stripe evidence fields
      for (const { purpose, fileId } of additionalFileIds) {
        if (purpose === 'customer_signature' && !(evidence as any).customer_signature) {
          (evidence as any).customer_signature = fileId;
        } else if (purpose === 'receipt' && !(evidence as any).receipt) {
          (evidence as any).receipt = fileId;
        } else if (purpose === 'service_documentation' && !(evidence as any).service_documentation) {
          (evidence as any).service_documentation = fileId;
        } else if (purpose === 'customer_communication' && !(evidence as any).customer_communication) {
          (evidence as any).customer_communication = fileId;
        } else if (!(evidence as any).uncategorized_file) {
          (evidence as any).uncategorized_file = fileId;
        }
        // Note: Stripe allows only one file per field; extras are noted in uncategorized_text
      }
    }

    // ── Submit to Stripe ──────────────────────────────────────────────────────
    await stripe.disputes.update(
      stripeDisputeId,
      { evidence, submit: true },
      { stripeAccount: stripeConnectedAccountId }
    );

    // ── Update dispute record in Firestore ────────────────────────────────────
    await disputeRef.set({
      evidenceSubmitted:    true,
      evidenceSubmittedAt:  new Date().toISOString(),
      evidenceSubmittedBy:  g.actor?.name || null,
      evidenceSubmittingAt: null,
      status:               'under_review',
      evidenceSummary:      evidenceText ?? null,
      extraNotes:           extraNotes ?? null,
    }, { merge: true });

    console.log(`[dispute-evidence] Evidence submitted for dispute ${stripeDisputeId}`);
    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error('[dispute-evidence] Error:', err);
    // Free to try again. Stripe itself takes a dispute's evidence only once, so a second try can't send it twice.
    await disputeRef.set({ evidenceSubmittingAt: null }, { merge: true }).catch(() => {});
    return NextResponse.json({ ok: false, error: err?.raw?.message || 'The evidence couldn’t be sent. Please try again.' }, { status: 500 });
  }
}
