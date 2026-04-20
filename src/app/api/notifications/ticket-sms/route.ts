// FILE: src/app/api/notifications/ticket-sms/route.ts
//
// SMS CONFIRMATION STUB
// Wire up Twilio here when you're ready.
//
// Setup steps:
//   1. npm install twilio
//   2. Add to Vercel env vars:
//      TWILIO_ACCOUNT_SID
//      TWILIO_AUTH_TOKEN
//      TWILIO_PHONE_NUMBER  (e.g. +15551234567)
//   3. Uncomment the code below
// ─────────────────────────────────────────────────────────────────────────────
 
// import { NextRequest, NextResponse } from 'next/server';
//
// export async function POST(req: NextRequest) {
//   // ── STUB ──────────────────────────────────────────────────────────────────
//   return NextResponse.json({ sent: false, reason: 'SMS provider not configured yet' });
//
//   // ── UNCOMMENT WHEN TWILIO IS READY ────────────────────────────────────────
//   // const twilio = require('twilio');
//   // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
//   //
//   // const { phone, ticketCode, eventName, eventDate } = await req.json();
//   // if (!phone) return NextResponse.json({ sent: false, reason: 'No phone number' });
//   //
//   // await client.messages.create({
//   //   body: `Your ticket for ${eventName} is confirmed!\nTicket code: ${ticketCode}\n${eventDate ? `Date: ${eventDate}` : ''}\nPresent this code at the door.`,
//   //   from: process.env.TWILIO_PHONE_NUMBER,
//   //   to:   phone,
//   // });
//   //
//   // return NextResponse.json({ sent: true });
// }
 