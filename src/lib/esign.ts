// src/lib/esign.ts
//
// Built-in e-signature core. One place to (a) snapshot exactly what a person
// agreed to, (b) record who signed it and when, and (c) persist it to an
// append-only, auditable collection: tenants/{tenantId}/signedDocuments.
//
// These records are legal evidence — they are WRITE-ONCE. Never update or
// delete a signed document; if terms change, issue a new one to be re-signed.
//
// This is intentionally provider-free: type-to-sign with a timestamp and a
// snapshot of the agreed text is sufficient for most small businesses under
// the U.S. E-SIGN Act / UETA. (It is not legal advice — have your own
// agreement wording reviewed by a lawyer.)

import { collection, doc, setDoc } from 'firebase/firestore';

export type SignerType = 'staff' | 'renter' | 'applicant' | 'client';

export type SignedDocumentKind =
  | 'employment_agreement'
  | 'contractor_agreement'
  | 'consent_form'
  | 'lease'
  | 'day_use'
  | 'house_rules'
  | 'policy';

export interface SignatureInput {
  subjectType: SignerType;
  subjectId?: string | null;   // staffId / renterId / applicationId, if known
  subjectName: string;
  kind: SignedDocumentKind;
  title: string;
  agreementText: string;       // the EXACT text shown to the signer (a snapshot)
  meta?: Record<string, any>;  // e.g. { boothName, rentAmount } — for context
}

export interface SignedDocumentRecord extends SignatureInput {
  id: string;
  signedName: string;
  method: 'typed';
  status: 'signed';
  signedAt: string;            // ISO
  userAgent: string | null;
}

// Build the immutable record. (IP is best captured server-side; the userAgent
// and timestamp are captured here as supporting evidence.)
export function buildSignedRecord(id: string, input: SignatureInput, signedName: string): SignedDocumentRecord {
  return {
    id,
    ...input,
    subjectId: input.subjectId ?? null,
    signedName: signedName.trim(),
    method: 'typed',
    status: 'signed',
    signedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };
}

// Persist to the append-only signed-documents collection and return the record.
export async function saveSignedDocument(
  db: any,
  tenantId: string,
  input: SignatureInput,
  signedName: string,
): Promise<SignedDocumentRecord> {
  const ref = doc(collection(db, `tenants/${tenantId}/signedDocuments`));
  const record = buildSignedRecord(ref.id, input, signedName);
  await setDoc(ref, record);
  return record;
}

// Fill {{placeholders}} in a template. Unknown keys are left visible so a
// missing value is obvious rather than silently blank.
export function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return (tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) =>
    (vars[k] !== undefined && vars[k] !== null && vars[k] !== '') ? String(vars[k]) : `[${k}]`);
}

// ── Default templates (editable starting points, NOT legal advice) ───────────
// Placeholders are filled with fillTemplate(). Keep the wording your own /
// lawyer-reviewed; these exist so onboarding works out of the box.
export const DEFAULT_INCIDENTALS_SCHEDULE = [
  'Cleaning fee — up to $75',
  'Damage — up to $500',
  'Lost key / fob — up to $25',
  'Late checkout — up to $50',
  'Missing product / supplies — up to $150',
].join('\n');

export const AGREEMENT_TEMPLATES: Record<SignedDocumentKind, { title: string; body: string }> = {
  contractor_agreement: {
    title: 'Independent Contractor Agreement',
    body:
`This Independent Contractor Agreement is entered into on {{date}} between {{studioName}} ("the Studio") and {{signerName}} ("the Contractor").

1. RELATIONSHIP. The Contractor is an independent contractor, not an employee. The Contractor is responsible for their own taxes, licensing, and insurance.

2. SERVICES. The Contractor will provide {{role}} services at the Studio's premises using their own tools and professional judgment.

3. COMPENSATION. Compensation is as agreed in the Studio's pay structure on file for the Contractor.

4. LICENSING. The Contractor affirms they hold, and will maintain, all licenses and certifications required by law to perform their services.

5. CONDUCT. The Contractor agrees to follow the Studio's House Rules & Policies and to treat clients and colleagues with professionalism.

6. TERMINATION. Either party may end this arrangement with reasonable notice.

By signing below, the Contractor confirms they have read, understood, and agree to the terms of this Agreement.`,
  },
  employment_agreement: {
    title: 'Employment Agreement',
    body:
`This Employment Agreement is entered into on {{date}} between {{studioName}} ("the Employer") and {{signerName}} ("the Employee").

1. POSITION. The Employee is hired for the role of {{role}} and will perform duties as assigned.

2. COMPENSATION. Wages and any commission are as set out in the Employee's pay structure on file.

3. SCHEDULE. Working hours will be scheduled by the Employer; the Employee agrees to clock in and out accurately.

4. LICENSING & CONDUCT. The Employee affirms they hold all required licenses and agrees to follow the Studio's House Rules & Policies.

5. CONFIDENTIALITY. The Employee will keep client information and business details confidential.

6. AT-WILL. Unless otherwise agreed in writing, employment is at-will and may be ended by either party.

By signing below, the Employee confirms they have read, understood, and agree to the terms of this Agreement.`,
  },
  house_rules: {
    title: 'Studio House Rules & Policies',
    body:
`{{studioName}} — House Rules & Policies

By signing, {{signerName}} agrees to:

• Arrive prepared and on time for scheduled shifts or bookings.
• Keep their station clean, sanitized, and compliant with health regulations.
• Follow all sanitation, safety, and licensing requirements at all times.
• Treat clients, colleagues, and management with respect and professionalism.
• Handle client information confidentially.
• Give reasonable notice for time off or cancellations.
• Report any incident, injury, or client concern to management promptly.

Acknowledged and agreed on {{date}}.`,
  },
  lease: {
    title: 'Booth Rental Lease Agreement',
    body:
`This Booth Rental Agreement is entered into on {{date}} between {{studioName}} ("the Studio") and {{signerName}} ("the Renter") for the rental of {{boothName}}.

1. TERM. The rental begins on {{startDate}}.

2. RENT. The Renter agrees to pay {{rentAmount}} per {{rentPeriod}}, due on schedule. Late payment may incur fees.

3. DEPOSIT. A security deposit of {{deposit}} is held and refundable per the terms below, less any damages or unpaid amounts.

4. USE. The space is for the Renter's licensed professional services only. The Renter maintains their own tools, products, licensing, and liability insurance.

5. INDEPENDENCE. The Renter operates their own business and is responsible for their own taxes and clients.

6. CONDUCT. The Renter agrees to the Studio's House Rules & Policies and to maintain the space in good, sanitary condition.

7. TERMINATION. Either party may end this agreement with the notice period stated in the Studio's policy.

8. INCIDENTAL CHARGES. The Renter authorizes the Studio to charge the card on file for the following, each only up to the stated cap:
{{incidentalsSchedule}}

By signing below, the Renter confirms they have read, understood, and agree to the terms of this Agreement.`,
  },
  day_use: {
    title: 'Short-Term Rental Agreement',
    body:
`This Short-Term Rental Agreement is made on {{date}} between {{studioName}} ("the Studio") and {{signerName}} ("the Renter") for use of {{boothName}} during {{bookingWindow}}.

1. USE OF SPACE. The Renter rents the space for their own licensed professional services only, for the booked time window above. The space may not be shared, sublet, or used for any other purpose. Access ends at the end of the booked window unless the Studio agrees in writing to extend it.

2. INDEPENDENT PROFESSIONAL. The Renter is an independent professional, not an employee or agent of the Studio. The Renter is solely responsible for their own clients, services, tools, products, taxes, and business decisions.

3. LICENSING & INSURANCE. The Renter affirms they hold, and will keep in force, every license, certification, and insurance required by law to perform their services, and will provide proof on request.

4. LIABILITY. The Renter performs all services at their own risk and is responsible for their own work and clients. To the fullest extent allowed by law, the Renter releases the Studio from, and will not hold the Studio liable for, any claim, injury, loss, or damage arising from the Renter's services, conduct, tools, products, or clients during the rental.

5. SANITATION & CONDUCT. The Renter will keep the station clean and sanitized, follow all health, safety, and sanitation rules, respect other renters and Studio staff, and leave the space in the condition they found it.

6. PAYMENT. The booking fee of {{amount}} is due as booked. A card is kept on file to secure the reservation and to cover any authorized incidental charges below.

7. INCIDENTAL CHARGES. The Renter authorizes the Studio to charge the card on file for the following, each only up to the stated cap:
{{incidentalsSchedule}}

8. CANCELLATION. Cancellations and refunds follow the Studio's posted cancellation policy. No-shows and late cancellations may forfeit the fee.

By typing their name below, the Renter confirms they have read, understood, and agree to this Agreement, and that their typed name is their legal electronic signature.`,
  },
  consent_form: { title: 'Consent Form', body: `{{body}}` },
  policy: { title: 'Policy Acknowledgement', body: `{{body}}` },
};

// Resolve the exact day-use agreement to show a short-term guest. If the
// owner has written their own booking-terms text, that is used verbatim
// (their words, their lawyer's review); otherwise the built-in default
// above is used so a guest ALWAYS signs real, protective terms — even
// before the owner customizes anything. Pure (no I/O) so both the public
// booking route and the check-in kiosk can call it and get identical text.
export function resolveDayUseAgreement(
  customBody: string | null | undefined,
  vars: Record<string, string | number | null | undefined>,
): { title: string; text: string } {
  const tpl = AGREEMENT_TEMPLATES.day_use;
  const body = (typeof customBody === 'string' && customBody.trim()) ? customBody : tpl.body;
  return { title: tpl.title, text: fillTemplate(body, vars) };
}
