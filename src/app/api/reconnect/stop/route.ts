// src/app/api/reconnect/stop/route.ts
//
// "Prefer not to get these?" — the link at the foot of every reconnect nudge.
// Stateless and signed per client, so it works from any email without a
// login, and can't be used to opt someone else out. Stops RECONNECT nudges
// only: appointment confirmations and reminders still arrive, because a
// client who books still needs to know when to come in.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stopSig } from '@/lib/reconnect';

export const dynamic = 'force-dynamic';

const page = (title: string, body: string) => new NextResponse(
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:-apple-system,system-ui,sans-serif;max-width:460px;margin:15vh auto;padding:0 24px;color:#1c1917">` +
  `<h1 style="font-weight:500;font-size:22px">${title}</h1><p style="color:#57534e;line-height:1.5">${body}</p></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

export async function GET(req: NextRequest) {
  const t = String(req.nextUrl.searchParams.get('t') || '');
  const c = String(req.nextUrl.searchParams.get('c') || '');
  const sig = String(req.nextUrl.searchParams.get('s') || '');
  if (!t || !c || !sig || sig !== await stopSig(t, c)) return page('That link didn’t work', 'It may have been copied incompletely. Reply to the message you received and we’ll take care of it.');
  try {
    const db = getAdminDb();
    await db.doc(`tenants/${t}/clients/${c}`).set({ reconnectOptOut: true, reconnectOptOutAt: new Date().toISOString() }, { merge: true });
  } catch { return page('Something went wrong', 'Please try the link again in a moment.'); }
  return page('Done — no more check-ins', 'You won’t get any more “it’s been a while” messages. Appointment confirmations and reminders will still arrive whenever you book.');
}
