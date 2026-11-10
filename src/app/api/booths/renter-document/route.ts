// src/app/api/booths/renter-document/route.ts
//
// One renter document on paper. Before signature it is the text as sent;
// after, the same text with the signature record beneath it — who, when,
// from what device — read from signedDocuments, the same place the lease
// signature lives. It opens only from a short-lived signed link (lib/print-link, api/print-link): the team by role,
// a renter only for documents addressed to them (the link then carries their renterId).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { printLinkValid, printLinkExpired } from '@/lib/print-link';
import { PRINT, PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';
import { sha256Hex } from '@/lib/sha256';
import { certificateRows } from '@/lib/esign-consent';

export const dynamic = 'force-dynamic';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = (iso: any) => {
  const d = new Date(String(iso || ''));
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!printLinkValid('/api/booths/renter-document', sp)) return printLinkExpired();
  const tenantId = String(sp.get('tenantId') || '').trim();
  const id = String(sp.get('id') || '').trim();
  const scopeRenter = String(sp.get('renterId') || '').trim();
  if (!tenantId || !id) return new NextResponse('Missing tenantId or id', { status: 400 });

  const db = getAdminDb();
  const [tSnap, dSnap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/renterDocuments/${id}`).get()]);
  if (!dSnap.exists) return new NextResponse('Document not found', { status: 404 });
  const tenant = (tSnap.data() as any) || {};
  const d = dSnap.data() as any;

  if (scopeRenter && String(d.renterId || '') !== scopeRenter) return new NextResponse('Document not found', { status: 404 });

  const signed = d.signedDocumentId ? ((await db.doc(`tenants/${tenantId}/signedDocuments/${d.signedDocumentId}`).get()).data() as any) || null : null;
  const studio = String(tenant.name || tenant.businessName || 'The studio');
  const addr = [tenant.address?.street || tenant.address?.line1, tenant.address?.city, tenant.address?.state, tenant.address?.zip || tenant.address?.postalCode].filter(Boolean).join(', ');
  const verb = d.action === 'acknowledge' ? 'Acknowledged' : 'Signed';

  // The app's print look (lib/print-style): Plus Jakarta Sans, a light heading, sentence-case labels in grey, thin
  // lines and soft rounded panels. The bar at the top is for the screen only.
  const styles = `@page { margin: 0.55in; }
  ${PRINT_CSS}
  .pp.page { max-width: 780px; }
  .pp .bar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 18px; padding: 8px 8px 8px 16px; background: ${PRINT.soft}; border-radius: 14px; font-size: 12px; font-weight: 500; }
  .pp .bar button { height: 36px; padding: 0 16px; border: 0; border-radius: 999px; background: ${PRINT.ink}; color: #fff; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .pp .meta .pill { margin-top: 6px; }
  .pp .doc { white-space: pre-wrap; font-size: 12.5px; line-height: 1.7; }
  .pp .sigs { margin-top: 8px; break-inside: avoid; }
  .pp .name { font-size: 17px; font-weight: 300; letter-spacing: -0.01em; margin-top: 2px; }
  .pp .sl { padding-top: 5px; border-top: 1px solid ${PRINT.ink}; font-size: 11px; font-weight: 500; color: ${PRINT.muted}; }
  .pp .sl.first { margin-top: 44px; } .pp .sl.next { margin-top: 22px; }
  .pp p.note { margin-top: 12px; }
  @media print { .pp .bar { display: none; } }
  `;
  const statusText = d.status === 'sent' ? 'Awaiting ' + (d.action === 'acknowledge' ? 'acknowledgment' : 'signature') : String(d.status || '');
  const statusTone = d.status === 'signed' ? 'ok' : d.status === 'declined' ? 'bad' : '';
  const blankSig = (who: string) => `<div class="box"><p class="lbl">${who}</p><p class="sl first">Name</p><p class="sl next">Date</p></div>`;
  // The business signs first as it sends (the lease builder); the renter second, in their portal.
  const bizSig: any = (signed && signed.businessSignature) || d.meta?.businessSignature || null;
  const bizBox = bizSig?.name ? `<div class="box"><p class="lbl">For ${esc(studio)}</p><p class="name">${esc(bizSig.name)}</p><p class="muted">Signed ${when(bizSig.at)}</p></div>` : blankSig(`For ${esc(studio)}`);
  // The signature certificate (lib/esign-consent): what was signed, by its fingerprint, and each step with its time.
  const text = String((signed && signed.agreementText) || d.body || '');
  const shaNow = sha256Hex(String(d.body || ''));
  const cert = d.status === 'signed' && signed && signed.action !== 'acknowledge' ? certificateRows({
    title: String(d.title || ''), business: studio, sha256: String(signed.termsSha256 || sha256Hex(text)), fingerprintMatches: signed.termsSha256 ? signed.termsSha256 === shaNow : null,
    sentAt: d.sentAt, sentBy: d.sentBy, viewedAt: signed.viewedAt || d.viewedAt, consentAt: signed.esignConsent?.at, signedName: signed.signedName, signedAt: signed.signedAt,
    ip: signed.ip, device: signed.userAgent, businessSignature: bizSig, recordId: d.signedDocumentId,
  }) : [];
  const certHtml = cert.length ? `<div class="sigs"><h2>Signature certificate</h2><div class="box">${cert.map((r) => `<p class="lbl">${esc(r.label)}</p><p style="margin:2px 0 8px;font-size:12px;word-break:break-all">${esc(r.value)}</p>`).join('')}</div>${signed.esignConsent?.text ? `<p class="note">Agreed before signing: “${esc(signed.esignConsent.text)}”</p>` : ''}</div>` : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} — ${esc(d.renterName)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="${PRINT_FONT_HREF}" rel="stylesheet"><style>${styles}</style></head><body class="pp-screen"><div class="pp page">
  <div class="bar"><span>${esc(d.title)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="head">
    <div><p class="shop">${esc(studio)}</p><h1>${esc(d.title)}</h1><p class="sub">For ${esc(d.renterName)} · sent ${when(d.sentAt)} by ${esc(d.sentBy || studio)}</p></div>
    <div class="meta">${addr ? `<div>${esc(addr)}</div>` : ''}<div><span class="pill ${statusTone}">${esc(statusText.charAt(0).toUpperCase() + statusText.slice(1))}</span></div></div>
  </div>
  <div class="doc">${esc(d.body)}</div>
  <div class="sigs">
    <h2>${d.status === 'signed' ? `${verb} electronically` : 'Signature'}</h2>
    ${d.status === 'signed' && signed ? `
      <div class="grid2">
        <div class="box"><p class="lbl">Renter</p><p class="name">${esc(signed.signedName)}</p><p class="muted">${verb} ${when(signed.signedAt)}</p>${signed.ip ? `<p class="muted">From ${esc(signed.ip)}</p>` : ''}${signed.userAgent ? `<p class="faint" style="font-size:10px">${esc(String(signed.userAgent).slice(0, 90))}</p>` : ''}</div>
        ${bizSig?.name ? bizBox : ''}
      </div>
      <p class="note">Electronic signature by typed name, recorded with the exact text above, the time and the device. Record ${esc(d.signedDocumentId)}.</p>`
    : d.status === 'declined' ? `<p class="muted">Declined ${when(d.declinedAt)}${d.declineNote ? ` — “${esc(d.declineNote)}”` : ''}.</p>`
    : `<div class="grid2">${blankSig('Renter')}${bizBox}</div><p class="note">Not yet signed. The renter can sign this in their portal, or both parties can sign this printed copy.</p>`}
  </div>
  ${certHtml}
  </div></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
