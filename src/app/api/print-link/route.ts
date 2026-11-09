// src/app/api/print-link/route.ts — A SIGNED LINK TO ONE PRINTABLE PAGE (lib/print-link), for whoever may see it.
// POST { tenantId, path, params, token? }
//   The business's team: receipts for anyone who books or takes payments; statements, renter documents and the
//   interruption packet for managers and anyone who can see the business's numbers (renter documents also for
//   whoever manages documents).
//   A renter (signed in to the app as a renter, or to the renter portal with `token`): only their own receipts,
//   statements and documents, and only their own part of an interruption packet.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { isPrintPath, signPrintLink } from '@/lib/print-link';
import { renterSession } from '@/lib/renter-link';

const no = (error: string, status = 403) => NextResponse.json({ ok: false, error }, { status });
const NOT_YOURS = 'You can only open your own records.';

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const tenantId = String(body?.tenantId || '').trim().slice(0, 120);
  const path = body?.path;
  if (!tenantId || !isPrintPath(path)) return no('That page can’t be opened.', 400);
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body?.params || {})) {
    if (typeof v === 'string' || typeof v === 'number') params[String(k).slice(0, 40)] = String(v).slice(0, 200);
  }
  params.tenantId = tenantId;
  const db = getAdminDb();

  // Who is asking: a renter (portal session or the app) gets their own records only; the team by what their role allows.
  let mine: string[] | null = null;
  if (typeof body?.token === 'string' && body.token) {
    const s = await renterSession(db, tenantId, body.token);
    if (!s?.renterId) return no('Please sign in again.', 401);
    mine = [s.renterId];
  } else {
    const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
    const a = g.actor || {};
    if (a.isRenter) {
      const staff: any = (await db.doc(`tenants/${tenantId}/staff/${a.uid}`).get()).data() || {};
      mine = [staff.renterId, a.uid].filter(Boolean).map(String);
    } else {
      const caps: string[] = Array.isArray(a.caps) ? a.caps : [];
      const boss = !!(a.isTenantOwner || a.isManager);
      const ok = path === '/api/booths/receipt' ? boss || ['bookings.manage', 'checkout.take', 'money.view'].some((c) => caps.includes(c))
        : path === '/api/booths/renter-document' ? boss || caps.includes('money.view') || caps.includes('documents.manage')
        : boss || caps.includes('money.view');
      if (!ok) return no('Your role doesn’t allow that. Ask the owner.');
    }
  }

  if (mine) {
    const ownerOf = async (col: string, id: string) => {
      if (!id) return '';
      const d: any = (await db.doc(`tenants/${tenantId}/${col}/${id}`).get()).data() || {};
      return String(d.renterId || '');
    };
    if (path === '/api/booths/receipt') {
      const col = params.type === 'reservation' ? 'boothReservations' : params.type === 'ledger' ? 'transactions' : '';
      if (!col || !mine.includes(await ownerOf(col, params.id || ''))) return no(NOT_YOURS);
    } else if (path === '/api/booths/statement' || path === '/api/booths/account-statement') {
      if (!mine.includes(String(params.renterId || ''))) return no(NOT_YOURS);
    } else if (path === '/api/booths/notice-record') {
      if (!mine.includes(String(params.renterId || ''))) return no(NOT_YOURS);
      params.view = 'renter';   // their own copy: what their portal shows them (lib/notice-record forRenter)
    } else if (path === '/api/booths/renter-document') {
      const owner = await ownerOf('renterDocuments', params.id || '');
      if (!mine.includes(owner)) return no(NOT_YOURS);
      params.renterId = owner;
    } else if (path === '/api/booths/interruption-packet') {
      params.renterId = mine[0];   // their own part of the packet, never the whole business's
    }
  }

  const url = signPrintLink(path, params);
  if (!url) {
    console.error('[print-link] LINK_SECRET is not set, so printable pages cannot open. Add it to the hosting settings.');
    return no('Printing isn’t available right now. The problem is on our side, not yours. Try again later.', 503);
  }
  return NextResponse.json({ ok: true, url });
}
