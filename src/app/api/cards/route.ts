// /api/cards — ADD YOUR CARD (lib/card-save).
//   Public, by the client's private link (k):  GET ?tenantId&clientId&k → the page;  POST start | confirm.
//   Managers (Moving in → Cards on file):       POST members → every member and their card;  send { clientIds } → links.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { requireRole } from '@/lib/route-guard';
import { cardKey, cardView, startCardSave, confirmCardSave, membersCards, sendCardLink } from '@/lib/card-save';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const okId = (x: any) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const t = q.get('tenantId'), c = q.get('clientId');
  if (!okId(t) || !okId(c) || q.get('k') !== cardKey(t!, c!)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
  const v = await cardView(getAdminDb(), t!, c!); return v ? j({ ok: true, ...v }) : j({ ok: false, error: 'This link isn’t valid.' }, 404);
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const t = b.tenantId; const action = String(b.action || ''); if (!okId(t)) return j({ ok: false, error: 'Unknown business.' }, 400);
  const db = getAdminDb();
  if (action === 'members' || action === 'send') {
    const g = await requireRole(req, t, 'manager'); if (g.deny) return g.deny;
    if (action === 'members') return j({ ok: true, members: await membersCards(db, t) });
    const ids: string[] = (Array.isArray(b.clientIds) ? b.clientIds : []).filter(okId).slice(0, 300); let sent = 0; const failed: string[] = [];
    for (const id of ids) { const r: any = await sendCardLink(db, t, id, req.nextUrl.origin, 'manual').catch(() => ({ ok: false })); if (r.ok) sent++; else failed.push(id); }
    return j({ ok: true, sent, failed });
  }
  if (!okId(b.clientId) || b.k !== cardKey(t, b.clientId)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
  const limited = await limitPublic(req, 'card_save', t, { perHour: 10, perDay: 30 }); if (limited) return limited;
  try {
    if (action === 'start') { const r: any = await startCardSave(db, t, b.clientId); return j(r, r.ok ? 200 : 400); }
    if (action === 'confirm') return j(await confirmCardSave(db, t, b.clientId, String(b.sessionId || '')));
  } catch (e: any) { console.error('[cards]', e?.message); return j({ ok: false, error: 'That didn’t go through — nothing was charged. Please try again.' }, 500); }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
