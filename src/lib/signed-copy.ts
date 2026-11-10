// src/lib/signed-copy.ts — THE SIGNED COPY, TO BOTH SIDES (server). Once a renter signs a document electronically, they
// and the business each get an email with its whole text and its signature certificate (lib/esign-consent): a copy to
// keep, as signing electronically promises. Each side is sent it once (copyEmailedTo): a later call sends only to a
// side whose copy didn't go (a failed send is tried again), and to both only when asked (again: true).
import { sha256Hex } from '@/lib/sha256';
import { certificateRows } from '@/lib/esign-consent';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendSignedCopy(db: any, tenantId: string, documentId: string, o: { again?: boolean } = {}): Promise<{ renter: boolean; owner: boolean }> {
  const T = `tenants/${tenantId}`;
  const dRef = db.doc(`${T}/renterDocuments/${documentId}`);
  const d: any = (await dRef.get()).data() || null;
  if (!d || d.status !== 'signed' || !d.signedDocumentId) return { renter: false, owner: false };
  const done = { renter: !o.again && d.copyEmailedTo?.renter === true, owner: !o.again && d.copyEmailedTo?.owner === true };
  if (done.renter && done.owner) return { renter: false, owner: false };
  const [tSnap, sSnap, rSnap] = await Promise.all([db.doc(T).get(), db.doc(`${T}/signedDocuments/${d.signedDocumentId}`).get(), db.doc(`${T}/renters/${d.renterId}`).get()]);
  const t: any = tSnap.data() || {}, s: any = sSnap.data() || {}, r: any = rSnap.data() || {};
  const biz = String(t.name || t.businessName || 'The business');
  const renterName = `${r.firstName || ''} ${r.lastName || ''}`.trim() || String(d.renterName || 'The renter');
  const text = String(s.agreementText || d.body || '');
  const sha = String(s.termsSha256 || sha256Hex(text));
  const rows = certificateRows({
    title: String(d.title || 'Document'), business: biz, sha256: sha, fingerprintMatches: sha256Hex(text) === sha,
    sentAt: d.sentAt, sentBy: d.sentBy, viewedAt: s.viewedAt || d.viewedAt, consentAt: s.esignConsent?.at, signedName: s.signedName, signedAt: s.signedAt,
    ip: s.ip, device: s.userAgent, businessSignature: s.businessSignature || d.meta?.businessSignature || null, recordId: d.signedDocumentId,
  });
  const certHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td style="background:#f5f5f7;border-radius:16px;padding:16px 18px">
    <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#16171a">Signature certificate</p>
    ${rows.map((x) => `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#6d7075">${esc(x.label)}<br><span style="color:#16171a;word-break:break-all">${esc(x.value)}</span></p>`).join('')}
  </td></tr></table>
  <p style="margin:22px 0 0;font-size:15px;font-weight:600;color:#16171a">${esc(d.title || 'The document')}, as signed</p>
  <div style="margin:8px 0 0;padding:14px 16px;border:1px solid #ececee;border-radius:14px;font-size:13px;line-height:1.65;color:#2c2d31;white-space:pre-wrap">${esc(text)}</div>`;
  const certText = rows.map((x) => `${x.label}: ${x.value}`).join('\n');
  const { sendNotification } = await import('@/lib/notify');
  const { brandedEmailHtml } = await import('@/lib/email-template');
  const { renterPortalUrl } = await import('@/lib/renter-comms');
  const portal = await renterPortalUrl(db, tenantId);
  const sent = { renter: false, owner: false };

  const rEmail = String(r.email || '').trim();
  if (rEmail.includes('@') && !done.renter) {
    const res: any = await sendNotification(db, {
      tenantId, channel: 'email', to: rEmail, kind: 'signed_copy', recipientType: 'renter', recipientId: d.renterId,
      subject: `Your signed copy: ${d.title || 'document'} with ${biz}`,
      html: brandedEmailHtml({ studioName: biz, title: 'Your signed copy', bodyLines: [`You signed “${d.title || 'this document'}” with ${biz}. Here is the whole text as you signed it, with its signature certificate. Keep this email for your records.`, 'You can ask for a paper copy at no cost, and print it from your portal any time.'], bodyHtml: certHtml, cta: portal ? { label: 'Open my portal', url: portal } : null }),
      text: `You signed "${d.title}" with ${biz}.\n\n${certText}\n\n${text}`,
    } as any).catch(() => null);
    sent.renter = !!res && res.ok !== false;
  }
  const oEmail = String(t.ownerEmail || t.email || t.contactEmail || '').trim();
  if (oEmail.includes('@') && !done.owner) {
    const res: any = await sendNotification(db, {
      tenantId, channel: 'email', to: oEmail, kind: 'signed_copy', recipientType: 'other', recipientId: null,
      subject: `${renterName} signed: ${d.title || 'document'}`,
      html: brandedEmailHtml({ studioName: biz, title: `${renterName} signed`, bodyLines: [`${renterName} signed “${d.title || 'this document'}” in their portal. Here is the whole text as signed, with its signature certificate, for your records.`], bodyHtml: certHtml }),
      text: `${renterName} signed "${d.title}".\n\n${certText}\n\n${text}`,
    } as any).catch(() => null);
    sent.owner = !!res && res.ok !== false;
  }
  // A side with no email address counts as done: there's nowhere to send it.
  const to = { renter: done.renter || sent.renter || !rEmail.includes('@'), owner: done.owner || sent.owner || !oEmail.includes('@') };
  await dRef.set({ copyEmailedTo: to, ...(sent.renter || sent.owner ? { copyEmailedAt: new Date().toISOString() } : {}) }, { merge: true });
  return sent;
}
