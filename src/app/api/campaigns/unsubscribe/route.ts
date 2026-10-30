// src/app/api/campaigns/unsubscribe/route.ts
//
// The unsubscribe link in every campaign email. Signed per client so it can't
// opt anyone else out. Stops CAMPAIGNS, reconnect nudges and review requests (lib/reviews-server); booking
// confirmations and reminders still arrive — a client who books still needs
// to know when to come in.
//
// Opening the link asks them to confirm with one button (a POST to the same address). Mail scanners that open every
// link in an email would otherwise unsubscribe people who never asked to be.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { unsubSig } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const page = (title: string, body: string, extra = '') => new NextResponse(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
  `<body style="font-family:-apple-system,system-ui,sans-serif;max-width:460px;margin:15vh auto;padding:0 24px;color:#1c1917">` +
  `<h1 style="font-weight:500;font-size:22px">${title}</h1><p style="color:#57534e;line-height:1.5">${body}</p>${extra}</body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
);
const BAD = () => page('That link didn’t work', 'It may have been copied incompletely. Reply to the email and we’ll remove you by hand.');

async function signed(req: NextRequest) {
  const t = String(req.nextUrl.searchParams.get('t') || '');
  const c = String(req.nextUrl.searchParams.get('c') || '');
  const s = String(req.nextUrl.searchParams.get('s') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(t) || !/^[A-Za-z0-9_-]{1,128}$/.test(c) || !s || s !== await unsubSig(t, c)) return null;
  return { t, c, s };
}

export async function GET(req: NextRequest) {
  const k = await signed(req); if (!k) return BAD();
  const action = `?t=${encodeURIComponent(k.t)}&c=${encodeURIComponent(k.c)}&s=${encodeURIComponent(k.s)}`;
  return page('Unsubscribe?', 'You’ll stop getting offers, check-ins and review requests. Appointment confirmations, reminders and order updates will still arrive.',
    `<form method="post" action="${esc(action)}"><button type="submit" style="height:48px;padding:0 24px;border:0;border-radius:999px;background:#16171a;color:#fff;font:inherit;font-size:15px;font-weight:600">Unsubscribe</button></form>`);
}

// The confirm button.
export async function POST(req: NextRequest) {
  const k = await signed(req); if (!k) return BAD();
  try {
    await getAdminDb().doc(`tenants/${k.t}/clients/${k.c}`).set({ marketingOptOut: true, reconnectOptOut: true, marketingOptOutAt: new Date().toISOString() }, { merge: true });
  } catch { return page('Something went wrong', 'Please try again in a moment.'); }
  return page('You’re unsubscribed', 'No more offers, check-ins or review requests. Appointment confirmations, reminders and order updates will still arrive.');
}
