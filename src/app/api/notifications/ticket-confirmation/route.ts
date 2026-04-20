import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Ticket confirmation email
//
// Currently a stub — returns 200 silently until Resend is configured.
//
// To wire up:
//   1. npm install resend
//   2. Add RESEND_API_KEY to Vercel env vars
//   3. Add RESEND_FROM_EMAIL to Vercel env vars (e.g. tickets@yourdomain.com)
//   4. Verify your sending domain in the Resend dashboard
//   5. Uncomment the code below and delete the stub return
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── STUB ──────────────────────────────────────────────────────────────────
  return NextResponse.json({ sent: false, reason: 'Email provider not configured yet' });

  // ── UNCOMMENT WHEN RESEND IS READY ────────────────────────────────────────
  // try {
  //   const { Resend } = await import('resend');
  //   const resend = new Resend(process.env.RESEND_API_KEY);
  //
  //   const { ticket, event, tenant, icsAttachment } = await req.json();
  //
  //   const eventDate = event?.date
  //     ? new Date(event.date).toLocaleDateString('en-US', {
  //         weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  //       })
  //     : '';
  //
  //   await resend.emails.send({
  //     from:    process.env.RESEND_FROM_EMAIL || 'tickets@yourdomain.com',
  //     to:      ticket.guestEmail,
  //     subject: `Your ticket for ${event?.name || event?.title || 'the event'}`,
  //     html: `
  //       <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
  //         ${tenant?.kioskSettings?.logoUrl
  //           ? `<img src="${tenant.kioskSettings.logoUrl}" height="40" style="margin-bottom:24px" />`
  //           : ''}
  //         <h1 style="font-size:28px;font-weight:900;margin:0 0 8px">
  //           ${event?.name || event?.title}
  //         </h1>
  //         <p style="color:#64748b;margin:0 0 24px">
  //           ${eventDate}${event?.time ? ' · ' + event.time : ''}${event?.venue ? ' · ' + event.venue : ''}
  //         </p>
  //         <div style="background:#f8fafc;border-radius:16px;padding:20px;margin-bottom:24px">
  //           <p style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#94a3b8;margin:0 0 4px">
  //             Ticket Code
  //           </p>
  //           <p style="font-size:28px;font-weight:900;font-family:monospace;margin:0;color:#0f172a;letter-spacing:0.15em">
  //             ${ticket.ticketCode}
  //           </p>
  //         </div>
  //         <p style="color:#64748b;font-size:14px;line-height:1.6">
  //           Hi ${ticket.guestName}, your ${ticket.type === 'paid' ? 'ticket' : 'RSVP'} is confirmed.
  //           Present your ticket code at the door.
  //         </p>
  //         ${ticket.type === 'paid'
  //           ? `<p style="color:#64748b;font-size:14px">Amount paid: <strong>$${ticket.amountPaid?.toFixed(2)}</strong></p>`
  //           : ''}
  //         ${icsAttachment
  //           ? `<p style="color:#94a3b8;font-size:12px;margin-top:24px">
  //               The calendar invite is attached — tap it to add this event to your calendar.
  //             </p>`
  //           : ''}
  //       </div>
  //     `,
  //     attachments: icsAttachment
  //       ? [{
  //           filename: `${(event?.name || 'event').replace(/\s+/g, '-').toLowerCase()}.ics`,
  //           content:  Buffer.from(icsAttachment).toString('base64'),
  //         }]
  //       : [],
  //   });
  //
  //   return NextResponse.json({ sent: true });
  // } catch (err: any) {
  //   console.error('[notifications/ticket-confirmation]', err);
  //   return NextResponse.json({ error: err.message }, { status: 500 });
  // }
}