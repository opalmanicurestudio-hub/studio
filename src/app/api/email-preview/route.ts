// src/app/api/email-preview/route.ts
//
// EMAIL PREVIEW — open in a browser to see exactly what recipients get, rendered live from the same shell the real
// sends use (lib/email-template, board 15G), in a business's look. No emails are sent; nothing is stored.
//
//   /api/email-preview                  → index of all previews
//   /api/email-preview?type=confirm     → booking confirmation
//   ...&studio=Your%20Name&color=1f7a4d → another business's name and color

import { NextRequest, NextResponse } from 'next/server';
import { brandedEmailHtml, applyEmailBrand, type BrandedEmailInput } from '@/lib/email-template';

const LINK = 'https://studio-one-blue.vercel.app/check-in/example';
const SAMPLES: Record<string, (studio: string) => BrandedEmailInput> = {
  confirm: (s) => ({ studioName: s, eyebrow: 'Booking confirmed', title: 'See you', titleBold: 'Saturday',
    bodyLines: ['Hi Dana, thanks for booking with us. You’re all set.'],
    details: { big: 'Sat, Nov 8 · 3:30 PM', lines: ['Gel manicure with Mia · 1 hr', '214 Bedford Ave, Brooklyn, NY 11249'] },
    amounts: [{ label: 'Deposit paid', value: '$20.00' }],
    bigCode: 'K7Q2', codeLabel: 'Your check-in code', codeNote: 'Show it when you arrive to check in.',
    cta: { label: 'See or change your booking', url: LINK }, links: [{ label: 'Add to calendar', url: LINK }, { label: 'Running late', url: `${LINK}?do=late` }],
    smallPrint: 'Your deposit comes off your total on the day of your visit.',
    notes: { title: 'Good to know', lines: ['You’re welcome to change or cancel your appointment from your visit link up to 24 hours before it starts.'] } }),
  reminder: (s) => ({ studioName: s, eyebrow: 'Tomorrow', title: 'See you tomorrow at', titleBold: '3:30 PM',
    details: { big: 'Sat, Nov 8 · 3:30 PM', lines: ['Gel manicure with Mia · 1 hr'] },
    cta: { label: 'See or change your visit', url: LINK }, links: [{ label: 'Running late', url: `${LINK}?do=late` }] }),
  request: (s) => ({ studioName: s, eyebrow: 'Request received', title: 'Not booked', titleBold: 'yet',
    bodyLines: ['Hi Dana, thanks for your request. We review every request personally, and you’ll hear from us shortly.'],
    details: { big: 'Sat, Nov 8 · 3:30 PM', lines: ['Gel manicure with Mia · 1 hr'] }, cta: { label: 'View my request', url: LINK } }),
  receipt: (s) => ({ studioName: s, eyebrow: 'Receipt', title: 'Thanks for coming in,', titleBold: 'Dana',
    amounts: [{ label: 'Gel manicure (Mia)', value: '$65.00' }, { label: 'Tax', value: '$5.77', muted: true }, { label: 'Tip', value: '$13.00', muted: true }, { label: 'Deposit already paid', value: '−$20.00', muted: true }, { label: 'Total', value: '$63.77', strong: true }],
    cta: { label: 'View your receipt', url: LINK }, links: [{ label: 'Book again', url: LINK }] }),
  code: (s) => ({ studioName: s, title: 'Your sign-in code', bodyLines: ['Use this code to sign in. It expires in 10 minutes.'], bigCode: '482913',
    footerNote: 'Didn’t ask for this? You can ignore it.' }),
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || '';
  const studio = (url.searchParams.get('studio') || 'Your Business').slice(0, 60);
  const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? `#${url.searchParams.get('color')}` : '#1f7a4d';

  if (SAMPLES[type]) {
    const html = applyEmailBrand(brandedEmailHtml(SAMPLES[type](studio)), { name: studio, accent: color, place: 'Brooklyn, NY' }, { replies: true });
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  const links = Object.keys(SAMPLES).map((k) =>
    `<li style="margin:10px 0"><a href="/api/email-preview?type=${k}&studio=${encodeURIComponent(studio)}&color=${color.slice(1)}" style="color:#16171a;font-weight:600">${k}</a></li>`).join('');
  return new NextResponse(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:'Plus Jakarta Sans',-apple-system,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#16171a">
    <h1 style="font-size:22px;font-weight:600">Email previews</h1>
    <p style="color:#6d7075;font-size:14px;line-height:1.6">Rendered live from the real email shell, in ${esc(studio)}’s look. Add <code>&amp;studio=Name&amp;color=1f7a4d</code> to see another business.</p>
    <ul style="padding-left:18px">${links}</ul></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
