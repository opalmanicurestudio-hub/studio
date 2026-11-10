// src/lib/esign-consent.ts — SIGNING THAT HOLDS UP (pure). The words a renter agrees to before signing anything
// electronically (the U.S. E-SIGN Act asks for consent, a way to get paper, and a way to withdraw), and the signature
// certificate printed with a signed document and sent with its copy: what was signed (the fingerprint of its exact
// words), when it was sent, opened and signed, by whom, from where, and the business's own signature.
// Used by the renter portal (api/portal/renter document-sign), the printed copy (api/booths/renter-document) and the
// signed-copy emails. Not legal advice: the lease itself says to have an attorney review it.

export const ESIGN_CONSENT_VERSION = 1;

/** What the signer agrees to before signing electronically. */
export function esignConsentText(business: string): string {
  const biz = String(business || '').trim() || 'the business';
  return `I agree to sign electronically, and to get the documents ${biz} sends me in my portal, and notices about them, electronically, for as long as I rent from them. `
    + `To read and keep them I need a device with a web browser and an email address. `
    + `I can ask ${biz} for a paper copy at no cost, and withdraw this agreement at any time, by message in my portal or in writing; withdrawing doesn’t undo anything already signed.`;
}

export interface CertificateInput {
  title: string;
  business: string;
  sha256: string;
  fingerprintMatches: boolean | null;
  sentAt?: string | null;
  sentBy?: string | null;
  viewedAt?: string | null;
  consentAt?: string | null;
  signedName?: string | null;
  signedAt?: string | null;
  ip?: string | null;
  device?: string | null;
  businessSignature?: { name?: string | null; at?: string | null } | null;
  recordId?: string | null;
}

const when = (iso: any) => {
  const d = new Date(String(iso || ''));
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
};

/** The certificate, line by line (label, value), in the order things happened. Empty values are left out. */
export function certificateRows(c: CertificateInput): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'Document', value: c.title },
    { label: 'Fingerprint (SHA-256 of the exact text)', value: `${c.sha256}${c.fingerprintMatches === true ? ' · matches the text above' : c.fingerprintMatches === false ? ' · does not match the text above' : ''}` },
    { label: 'Sent', value: [when(c.sentAt), c.sentBy ? `by ${c.sentBy}` : ''].filter(Boolean).join(' ') },
    { label: `Signed for ${c.business}`, value: c.businessSignature?.name ? `${c.businessSignature.name}${c.businessSignature.at ? `, ${when(c.businessSignature.at)}` : ''}` : '' },
    { label: 'Opened by the renter', value: when(c.viewedAt) },
    { label: 'Agreed to sign electronically', value: when(c.consentAt) },
    { label: 'Signed by the renter', value: c.signedName ? `${c.signedName}${c.signedAt ? `, ${when(c.signedAt)}` : ''}` : '' },
    { label: 'From', value: [c.ip || '', c.device ? String(c.device).slice(0, 120) : ''].filter(Boolean).join(' · ') },
    { label: 'Record', value: c.recordId || '' },
  ];
  return rows.filter((r) => String(r.value || '').trim());
}

const PER: Record<string, string> = { daily: 'a day', weekly: 'a week', biweekly: 'every two weeks', monthly: 'a month' };
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;

/** The renter's own written OK for autopay: what's charged, from which card, when, and how to stop it. Signed by typing
 *  their name in their portal (api/portal/renter autopay-set), kept with its fingerprint, and emailed to them. */
export function autopayAuthorizationText(a: { business: string; card: string; rentCents: number; frequency: string; dueDay?: number | null }): string {
  const biz = String(a.business || '').trim() || 'the business';
  const rent = `$${(Math.max(0, Number(a.rentCents) || 0) / 100).toFixed(2)} ${PER[a.frequency] || 'a month'}`;
  const due = a.frequency === 'monthly' && Number(a.dueDay) >= 1 ? `, due on the ${ord(Number(a.dueDay))}` : '';
  return `I authorize ${biz} to charge my ${a.card} for each rent bill on its due date. My rent is ${rent}${due}; what’s charged is what’s still owed on that bill after any credits. `
    + `Late fees and other charges aren’t taken by autopay. If my rent changes as my lease allows, the new amount is charged after I’ve been given the notice my lease requires. `
    + `This lasts until I turn autopay off in my portal, which I can do at any time before a payment is taken. Each payment shows in my portal.`;
}
