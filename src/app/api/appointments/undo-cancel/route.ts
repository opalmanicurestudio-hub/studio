// POST /api/appointments/undo-cancel { tenantId, appointmentId, k } — the client takes back their own cancellation
// within 15 minutes, if the time is still free (lib/undo-cancel).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { undoCancel } from '@/lib/undo-cancel';

export async function POST(req: NextRequest) {
  let b: any = {}; try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }); }
  const t = String(b.tenantId || ''), id = String(b.appointmentId || ''), k = String(b.k || '');
  if (!/^[\w-]{1,80}$/.test(t) || !/^[\w-]{1,80}$/.test(id)) return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
  const r = await undoCancel(getAdminDb(), t, id, k);
  return NextResponse.json(r, { status: r.ok ? 200 : r.code === 'needs_link' ? 403 : r.code === 'not_found' ? 404 : 409 });
}
