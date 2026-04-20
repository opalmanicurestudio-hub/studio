// FILE: src/app/api/notifications/ticket-confirmation/route.ts
//
// EMAIL CONFIRMATION STUB
// Wire up Resend here when you're ready.
//
// Setup steps:
//   1. npm install resend
//   2. Add RESEND_API_KEY to Vercel env vars
//   3. Add your sending domain in Resend dashboard
//   4. Set RESEND_FROM_EMAIL in Vercel env vars (e.g. tickets@yourdomain.com)
//   5. Uncomment the code below
// ─────────────────────────────────────────────────────────────────────────────
 
import { NextRequest, NextResponse } from 'next/server';
 
export async function POST(req: NextRequest) {
  // ── STUB — returns 200 silently until Resend is configured ───────────────
  return NextResponse.json({ sent: false, reason: 'Email provider not configured yet' });
 
  // ── UNCOMMENT WHEN RESEND IS READY ───────────────────────────────────────
  // const { Resend } = await import('resend');
  // const resend = new Resend(process.env.RESEND_API_KEY);
  //
  // const { ticket, event, tenant, icsAttachment } = await req.json();
  //
  // const eventDate = event.date
  //   ? new Date(event.date).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  //   : '';
  //
  // await resend.emails.send({
  //   from: process.env.RESEND_FROM_EMAIL || 'tickets@yourdomain.com',
  //   to: ticket.guestEmail,
  //   subject: `Your ticket for ${event.name || event.title}`,
  //   html: `
  //     <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
  //       <img src="${tenant?.kioskSettings?.logoUrl || ''}" height="40" style="margin-bottom:24px" />
  //       <h1 style="font-size:28px;font-weight:900;margin:0 0 8px">${event.name || event.title}</h1>
  //       <p style="color:#64748b;margin:0 0 24px">${eventDate}${event.time ? ' · ' + event.time : ''}${event.venue ? ' · ' + event.venue : ''}</p>
  //       <div style="background:#f8fafc;border-radius:16px;padding:20px;margin-bottom:24px">
  //         <p style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#94a3b8;margin:0 0 4px">Ticket Code</p>
  //         <p style="font-size:24px;font-weight:900;font-family:monospace;margin:0;color:#0f172a">${ticket.ticketCode}</p>
  //       </div>
  //       <p style="color:#64748b;font-size:14px">Hi ${ticket.guestName}, your ${ticket.type === 'paid' ? 'ticket' : 'RSVP'} is confirmed. Present your ticket code at the door.</p>
  //       ${ticket.type === 'paid' ? `<p style="color:#64748b;font-size:14px">Amount paid: <strong>$${ticket.amountPaid?.toFixed(2)}</strong></p>` : ''}
  //       <p style="color:#94a3b8;font-size:12px;margin-top:32px">The calendar invite is attached — tap it to add to your calendar.</p>
  //     </div>
  //   `,
  //   attachments: icsAttachment ? [{
  //     filename: `${(event.name || 'event').replace(/\s+/g, '-').toLowerCase()}.ics`,
  //     content:  Buffer.from(icsAttachment).toString('base64'),
  //   }] : [],
  // });
  //
  // return NextResponse.json({ sent: true });
}
 