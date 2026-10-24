// src/app/llms.txt/route.ts — HOW AI ASSISTANTS USE THIS PLATFORM (the agent plan, Phase 1). Each business has its own
// guide and data; this page says where they are and the rules every assistant follows.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-static';
export async function GET(req: NextRequest) {
  const o = req.nextUrl.origin;
  const text = [
    '# ClarityFlow booking and shops',
    '',
    '> Small businesses take bookings and sell online here. Each one has a public guide and data for assistants.',
    '',
    '## For each business',
    '',
    `- Guide (plain text): ${o}/book/{businessId}/llms.txt`,
    `- Data (JSON): ${o}/api/agents/{businessId} (services, prices, team, policies, how to book)`,
    `- Open times (JSON): ${o}/api/agents/{businessId}/open-times?service={serviceId}&provider={providerId|any}&from={YYYY-MM-DD}&days={1-14}`,
    `- Booking page for people: ${o}/book/{businessId}`,
    '',
    'The businessId is the part after /book/ in the business\'s booking link.',
    '',
    '## For each online shop',
    '',
    `- Guide (plain text): ${o}/shop/{businessId}/llms.txt`,
    `- Data (JSON): ${o}/api/agents/{businessId}/shop (products, live prices and stock, bundles, shipping and returns)`,
    `- Product feed (Google Merchant format): ${o}/shop/{businessId}/feed.xml`,
    `- Shop for people: ${o}/shop/{businessId}`,
    '',
    '## Rules',
    '',
    '- Only the customer places an order, and only the client confirms, changes or cancels their own booking. Assistants find times and hand the client a link, or hold a time where the business allows it.',
    '- Use the prices, times and policies in the data; never invent them.',
    '- Every answer carries a code and a message. Read the code; show the message.',
    '',
  ].join('\n');
  return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, s-maxage=86400' } });
}
