// FILE 2: src/app/api/stripe/webhook/route.ts
// Handles Stripe webhook events — creates ticket in Firestore on payment success
// ─────────────────────────────────────────────────────────────────────────────
 
// import { NextRequest, NextResponse } from 'next/server';
// import Stripe from 'stripe';
// import { getFirestore } from 'firebase-admin/firestore';
// import { nanoid } from 'nanoid';
//
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
//
// export async function POST(req: NextRequest) {
//   const body = await req.text();
//   const sig  = req.headers.get('stripe-signature')!;
//
//   let event: Stripe.Event;
//   try {
//     event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
//   } catch (err: any) {
//     return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
//   }
//
//   if (event.type === 'checkout.session.completed') {
//     const session = event.data.object as Stripe.Checkout.Session;
//     const meta    = session.metadata!;
//
//     const db   = getFirestore();
//     const code = nanoid(8).toUpperCase();
//     const id   = nanoid();
//
//     const ticket = {
//       id,
//       eventId:           meta.eventId,
//       tenantId:          meta.tenantId,
//       guestName:         meta.guestName,
//       guestEmail:        meta.guestEmail,
//       guestPhone:        meta.guestPhone || null,
//       guestId:           meta.guestId    || null,
//       type:              'paid',
//       status:            'paid',
//       price:             session.amount_total! / 100,
//       amountPaid:        session.amount_total! / 100,
//       ticketCode:        code,
//       stripeSessionId:   session.id,
//       stripePaymentIntentId: session.payment_intent as string,
//       source:            meta.guestId ? 'invite_link' : 'public',
//       confirmedAt:       new Date().toISOString(),
//       checkedInAt:       null,
//       tableNumber:       null,
//       seatNumber:        null,
//     };
//
//     await db
//       .collection(`tenants/${meta.tenantId}/eventTickets`)
//       .doc(id)
//       .set(ticket);
//
//     // TODO: Send confirmation email via Resend
//     // TODO: Send confirmation SMS via Twilio
//   }
//
//   return NextResponse.json({ received: true });
// }
//
// export const config = { api: { bodyParser: false } };
 
export {};
 
 