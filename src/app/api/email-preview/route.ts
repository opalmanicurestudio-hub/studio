// src/app/api/email-preview/route.ts
//
// EMAIL PREVIEW — open in a browser to see exactly what recipients get,
// rendered live from the same template the real sends use. No emails are
// sent; nothing is stored. Change the template, refresh, see it.
//
//   /api/email-preview                → index of all previews
//   /api/email-preview?type=code      → sign-in code email
//   /api/email-preview?type=reminder  → appointment reminder
//   /api/email-preview?type=portal    → portal link (fallback w/ CTA)
//   /api/email-preview?type=assign    → tech job assignment
//   ...&studio=Your%20Name            → preview with your studio name

import { NextRequest, NextResponse } from 'next/server';
import { brandedEmailHtml } from '@/lib/email-template';

const SAMPLES: Record<string, (studio: string) => string> = {
  code: (s) => brandedEmailHtml({
    studioName: s, title: 'Your sign-in code',
    bodyLines: ['Use this code to sign in to your renter portal. It expires in 10 minutes.'],
    bigCode: '482913',
    footerNote: `Didn't request this? You can safely ignore it. Sent by ${s}.`,
  }),
  reminder: (s) => brandedEmailHtml({
    studioName: s, title: 'Appointment reminder',
    bodyLines: [`Reminder — your appointment is Tue, Jul 28 at 2:00 PM with Maya. Need to reschedule? Just reply or call us.`],
  }),
  portal: (s) => brandedEmailHtml({
    studioName: s, title: 'Your renter portal',
    bodyLines: ['Pay rent, get receipts, report issues, and manage your card — this link signs you in.'],
    cta: { label: 'Open my portal', url: 'https://studio-one-blue.vercel.app/rent/example' },
    footerNote: `Sent by email because your phone couldn't receive our text. You're receiving this because you rent with ${s}.`,
  }),
  assign: (s) => brandedEmailHtml({
    studioName: s, title: 'New job assigned to you',
    bodyLines: ['New high ticket: "Manicure Station: Leaky roof" at Manicure Station.'],
    cta: { label: 'Open work queue', url: 'https://studio-one-blue.vercel.app/maintain/example' },
  }),
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || '';
  const studio = (url.searchParams.get('studio') || 'Your Business').slice(0, 60);

  if (SAMPLES[type]) {
    return new NextResponse(SAMPLES[type](studio), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  // Index — links to every preview
  const links = Object.keys(SAMPLES).map((k) =>
    `<li style="margin:8px 0"><a href="/api/email-preview?type=${k}&studio=${encodeURIComponent(studio)}" style="color:#0f172a;font-weight:700">${k}</a></li>`).join('');
  return new NextResponse(`<!doctype html><html><body style="font-family:-apple-system,sans-serif;max-width:560px;margin:40px auto;color:#0f172a">
    <h1 style="font-size:20px">Email previews</h1>
    <p style="color:#64748b;font-size:14px">Rendered live from the real template — what you change in code is what you see here. Add <code>&studio=Name</code> to preview another brand.</p>
    <ul>${links}</ul></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
