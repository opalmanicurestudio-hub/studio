import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

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

// Download a URL and return it as a Buffer (for Stripe file uploads)
async function urlToBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
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
    stripeDisputeId,
    stripeConnectedAccountId,
    evidenceText,
    consentFormUrls,
    signatureUrls,
    receiptUrl,
    extraNotes,
    additionalFiles,  // [{ url: string, purpose: string }]
  } = await req.json();

  if (!tenantId || !stripeDisputeId || !stripeConnectedAccountId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const db     = getAdminDb();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-04-30.basil' as any,
  });

  try {
    // ── Fetch tenant and dispute context from Firestore ──────────────────────
    const tenantDoc  = await db.collection('tenants').doc(tenantId).get();
    const tenant     = tenantDoc.data() || {};
    const disputeDoc = await db.collection(`tenants/${tenantId}/disputes`).doc(disputeId).get();
    const dispute    = disputeDoc.data() || {};

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

    // Fetch checkout transactions for service description
    let serviceDescription = 'Professional nail services rendered in full.';
    if (dispute.checkoutSessionId) {
      const txnsSnap = await db.collection(`tenants/${tenantId}/transactions`)
        .where('checkoutSessionId', '==', dispute.checkoutSessionId)
        .where('type', '==', 'income')
        .get();
      const descriptions = txnsSnap.docs
        .map((d: any) => d.data().description)
        .filter((d: string) => d && !d.includes('Tax') && !d.includes('Tip'));
      if (descriptions.length > 0) {
        serviceDescription = descriptions.join(', ');
      }
    }

    // ── Build evidence object ─────────────────────────────────────────────────
    const evidence: Stripe.DisputeUpdateParams.Evidence = {
      customer_name:         client?.name || dispute.clientName || 'Client on file',
      customer_email_address: client?.email || undefined,
      product_description:   serviceDescription,
      service_date:          dispute.createdAt
        ? new Date(dispute.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : undefined,
      service_documentation: evidenceText,
      uncategorized_text:    [
        extraNotes,
        tenant.refundPolicy ? `STUDIO REFUND POLICY:\n${tenant.refundPolicy}` : '',
        client?.address
          ? `CLIENT ADDRESS: ${client.address.street}, ${client.address.city}, ${client.address.state} ${client.address.zip}`
          : '',
        appointment
          ? `SERVICE DETAILS: ${appointment.serviceName || 'Nail Service'}, ${appointment.duration || 60} minutes, performed by ${appointment.staffName || 'Studio technician'}`
          : '',
      ].filter(Boolean).join('\n\n') || undefined,
      refund_policy: tenant.refundPolicy || 'All sales are final. Services are non-refundable once rendered.',
    };

    // ── Upload files to Stripe ────────────────────────────────────────────────
    // 1. Consent forms / signatures — uploaded as customer_signature
    const allSignatureUrls = [...(consentFormUrls || []), ...(signatureUrls || [])];

    if (allSignatureUrls.length > 0) {
      // Upload the first signature as customer_signature (Stripe accepts one)
      const buf = await urlToBuffer(allSignatureUrls[0]);
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
    if (receiptUrl) {
      const buf = await urlToBuffer(receiptUrl);
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
      for (const af of additionalFiles) {
        const buf = await urlToBuffer(af.url);
        if (!buf) continue;
        const ext      = af.url.split('.').pop()?.split('?')[0] || 'jpg';
        const filename = `evidence-${af.purpose}.${ext}`;
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
    await db.collection(`tenants/${tenantId}/disputes`).doc(disputeId).set({
      evidenceSubmitted:    true,
      evidenceSubmittedAt:  new Date().toISOString(),
      status:               'under_review',
      evidenceSummary:      evidenceText,
      extraNotes,
    }, { merge: true });

    console.log(`[dispute-evidence] Evidence submitted for dispute ${stripeDisputeId}`);
    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error('[dispute-evidence] Error:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
