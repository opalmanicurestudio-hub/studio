import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Ticket confirmation SMS
//
// Currently a stub — returns 200 silently until Twilio is configured.
//
// To wire up:
//   1. npm install twilio
//   2. Create a Twilio account at twilio.com
//   3. Get a phone number with SMS capability
//   4. Add to Vercel env vars:
//        TWILIO_ACCOUNT_SID
//        TWILIO_AUTH_TOKEN
//        TWILIO_PHONE_NUMBER  (e.g. +15551234567)
//   5. Uncomment the code below and delete the stub return
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── STUB ──────────────────────────────────────────────────────────────────
  return NextResponse.json({ sent: false, reason: 'SMS provider not configured yet' });

  // ── UNCOMMENT WHEN TWILIO IS READY ────────────────────────────────────────
  // try {
  //   const { phone, ticketCode, eventName, eventDate } = await req.json();
  //
  //   if (!phone) {
  //     return NextResponse.json({ sent: false, reason: 'No phone number provided' });
  //   }
  //
  //   const twilio = require('twilio');
  //   const client = twilio(
  //     process.env.TWILIO_ACCOUNT_SID,
  //     process.env.TWILIO_AUTH_TOKEN
  //   );
  //
  //   await client.messages.create({
  //     body: [
  //       `Your ticket for ${eventName} is confirmed!`,
  //       `Ticket code: ${ticketCode}`,
  //       eventDate ? `Date: ${eventDate}` : '',
  //       'Present this code at the door.',
  //     ].filter(Boolean).join('\n'),
  //     from: process.env.TWILIO_PHONE_NUMBER,
  //     to:   phone,
  //   });
  //
  //   return NextResponse.json({ sent: true });
  // } catch (err: any) {
  //   console.error('[notifications/ticket-sms]', err);
  //   return NextResponse.json({ error: err.message }, { status: 500 });
  // }
}