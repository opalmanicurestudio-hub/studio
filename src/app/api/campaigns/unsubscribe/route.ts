// src/app/api/campaigns/unsubscribe/route.ts
//
// The unsubscribe link in every campaign email. Signed per client so it can't
// opt anyone else out. Stops CAMPAIGNS and reconnect nudges; booking
// confirmations and reminders still arrive — a client who books still needs
// to know when to come in.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { unsubSig } from '@/lib/campaigns';

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
  const s = String(req.nextUrl.searchParams.get('s') || '');
  if (!t || !c || !s || s !== await unsubSig(t, c)) return page('That link didn’t work', 'It may have been copied incompletely. Reply to the email and we’ll remove you by hand.');
  try {
    await getAdminDb().doc(`tenants/${t}/clients/${c}`).set({ marketingOptOut: true, reconnectOptOut: true, marketingOptOutAt: new Date().toISOString() }, { merge: true });
  } catch { return page('Something went wrong', 'Please try the link again in a moment.'); }
  return page('You’re unsubscribed', 'No more offers or check-ins. Appointment confirmations and reminders will still arrive whenever you book.');
}
