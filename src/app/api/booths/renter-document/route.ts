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

  const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap');
  *{box-sizing:border-box}
  body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;margin:0;padding:32px;max-width:780px;background:#f8fafc;-webkit-font-smoothing:antialiased}
  h1{font-size:24px;font-weight:800;margin:0 0 4px;letter-spacing:-.03em;text-transform:uppercase;line-height:1.05}
  .muted{color:#64748b;font-size:12px;font-weight:600}
  .kicker{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.25em;color:#64748b;opacity:.7;margin-bottom:6px}
  .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px;padding:22px 24px;background:#fff;border:2px solid #e2e8f0;border-radius:2rem}
  .card{background:#fff;border:2px solid #e2e8f0;border-radius:2rem;padding:22px 26px;margin-bottom:20px}
  .body{white-space:pre-wrap;font-size:13.5px;line-height:1.65;font-weight:500}
  .lbl{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b;margin-bottom:4px}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  .sig .box{border:2px solid #e2e8f0;border-radius:1.25rem;padding:14px 16px}
  .name{font-size:18px;font-weight:800;letter-spacing:-.02em}
  .line{border-top:2px solid #0f172a;padding-top:6px;margin-top:36px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#64748b}
  .status{display:inline-block;border-radius:999px;padding:4px 10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em}
  .foot{margin-top:20px;font-size:11px;font-weight:600;color:#64748b}
  .bar{position:sticky;top:0;background:#0f172a;color:#fff;padding:10px 16px;border-radius:1rem;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700}
  .bar button{background:#fff;color:#0f172a;border:0;border-radius:.75rem;padding:8px 14px;font-weight:800;font-size:12px;font-family:inherit}
  @media print{body{background:#fff;padding:0}.bar{display:none}.head,.card,.sig .box{border-color:#cbd5e1}}
  `;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} — ${esc(d.renterName)}</title><style>${styles}</style></head><body>
  <div class="bar"><span>${esc(d.title)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="head">
    <div><div class="kicker">${esc(studio)}${addr ? ` · ${esc(addr)}` : ''}</div><h1>${esc(d.title)}</h1><div class="muted">For ${esc(d.renterName)} · sent ${when(d.sentAt)} by ${esc(d.sentBy || studio)}</div></div>
    <div style="text-align:right"><span class="status" style="${d.status === 'signed' ? 'background:#d1fae5;color:#065f46' : d.status === 'declined' ? 'background:#fee2e2;color:#991b1b' : 'background:#f1f5f9;color:#334155'}">${esc(d.status === 'sent' ? 'Awaiting ' + (d.action === 'acknowledge' ? 'acknowledgment' : 'signature') : d.status)}</span></div>
  </div>
  <div class="card"><div class="body">${esc(d.body)}</div></div>
  <div class="card">
    <div class="lbl">${d.status === 'signed' ? `${verb} electronically` : 'Signature'}</div>
    ${d.status === 'signed' && signed ? `
      <div class="sig">
        <div class="box"><div class="lbl">Renter</div><div class="name">${esc(signed.signedName)}</div><div class="muted">${verb} ${when(signed.signedAt)}</div>${signed.ip ? `<div class="muted">From ${esc(signed.ip)}</div>` : ''}${signed.userAgent ? `<div class="muted" style="font-size:10px">${esc(String(signed.userAgent).slice(0, 90))}</div>` : ''}</div>
        <div class="box"><div class="lbl">For ${esc(studio)}</div><div class="line" style="margin-top:44px">Name</div><div class="line" style="margin-top:22px">Date</div></div>
      </div>
      <div class="foot">Electronic signature by typed name, recorded with the exact text above, the time and the device. Record ${esc(d.signedDocumentId)}.</div>`
    : d.status === 'declined' ? `<div class="muted">Declined ${when(d.declinedAt)}${d.declineNote ? ` — “${esc(d.declineNote)}”` : ''}.</div>`
    : `<div class="sig"><div class="box"><div class="lbl">Renter</div><div class="line" style="margin-top:44px">Name</div><div class="line" style="margin-top:22px">Date</div></div><div class="box"><div class="lbl">For ${esc(studio)}</div><div class="line" style="margin-top:44px">Name</div><div class="line" style="margin-top:22px">Date</div></div></div><div class="foot">Not yet signed. The renter can sign this in their portal, or both parties can sign this printed copy.</div>`}
  </div>
  </body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
