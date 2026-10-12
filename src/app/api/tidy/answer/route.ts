// src/app/api/tidy/answer/route.ts — the link in a "could you come earlier?" text (/m/{tenant}/{token}). Public: the
// token is the proof. view → what's asked; yes / keep → their answer. Nobody moves until everyone asked says yes.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { tidyView, tidyAnswer } from '@/lib/tidy-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 120); const token = String(b.token || '').slice(0, 200); const action = String(b.action || 'view');
  if (!tenantId || !token) return NextResponse.json({ ok: false, error: 'This link isn’t complete.' }, { status: 400 });
  const db = getAdminDb();
  try {
    if (action === 'yes' || action === 'keep') return NextResponse.json(await tidyAnswer(db, tenantId, token, action === 'yes'));
    return NextResponse.json(await tidyView(db, tenantId, token));
  } catch (e) { console.error('[tidy/answer]', e); return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 }); }
}
