// src/app/api/booths/renter-document/route.ts
//
// One renter document on paper. Before signature it is the text as sent;
// after, the same text with the signature record beneath it — who, when,
// from what device — read from signedDocuments, the same place the lease
// signature lives. The shop opens it by capability URL like the other print
// routes; a renter opens it with their own portal token, which unlocks only
// documents addressed to them.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { PRINT, PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';

export const dynamic = 'force-dynamic';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = (iso: any) => {
  const d = new Date(String(iso || ''));
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim();
  const id = String(sp.get('id') || '').trim();
  const renterToken = String(sp.get('renter') || '').trim();
  if (!tenantId || !id) return new NextResponse('Missing tenantId or id', { status: 400 });

  const db = getAdminDb();
  const [tSnap, dSnap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/renterDocuments/${id}`).get()]);
  if (!dSnap.exists) return new NextResponse('Document not found', { status: 404 });
  const tenant = (tSnap.data() as any) || {};
  const d = dSnap.data() as any;

  if (renterToken) {
    const r = ((await db.doc(`tenants/${tenantId}/renters/${d.renterId}`).get()).data() as any) || {};
    if (!r.portalToken || r.portalToken !== renterToken) return new NextResponse('That link is not valid', { status: 403 });
  }

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
        ${blankSig(`For ${esc(studio)}`)}
      </div>
      <p class="note">Electronic signature by typed name, recorded with the exact text above, the time and the device. Record ${esc(d.signedDocumentId)}.</p>`
    : d.status === 'declined' ? `<p class="muted">Declined ${when(d.declinedAt)}${d.declineNote ? ` — “${esc(d.declineNote)}”` : ''}.</p>`
    : `<div class="grid2">${blankSig('Renter')}${blankSig(`For ${esc(studio)}`)}</div><p class="note">Not yet signed. The renter can sign this in their portal, or both parties can sign this printed copy.</p>`}
  </div>
  </div></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
