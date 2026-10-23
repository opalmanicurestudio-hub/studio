// src/app/api/retail/customer-contact/route.ts — THE TEAM CHANGES A CUSTOMER'S CONTACT DETAILS ON AN ORDER: name, email,
// mobile, and whether updates come by text. Managers and the front desk only (lib/contact-change), and a manager for an
// email or mobile change on an order held for review (the new contact gets the order's link, and the link is the order).
// POST { tenantId, orderId, name?, email?, phone?, textsOff? }.
// The order, its whole family (the order it came from and every follow-up, a backorder of a backorder too) and the
// open cases on them all take the new details, so
// replies, updates and the order page reach them; the customer's profile keeps its own. A new email gets the order's
// link, and the old one is told it changed (a change they didn't ask for is noticed); a new mobile gets one text with
// the link. Every change is on the order's record with who made it. The change itself is lib/order-contact, which the
// customer's own change from their order page uses too.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { cleanContact, contactDiff, mayEditContact } from '@/lib/contact-change';
import { applyOrderContact, familyHeld, orderFamily } from '@/lib/order-contact';

export const dynamic = 'force-dynamic';

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Please sign in to continue.', auth.status || 401);
  if (!mayEditContact(auth.tenant, auth.actor)) return bad('Only managers and the front desk can change a customer’s details.', 403);

  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) return bad('Order not found.', 404);
  const o: any = snap.data() || {};
  const { next, errors } = cleanContact(o, { name: b.name, email: b.email, phone: b.phone, textsOff: b.textsOff });
  if (errors.length) return bad(errors[0]);
  const changes = contactDiff(o, next);
  if (!changes.length) return NextResponse.json({ ok: true, unchanged: true, message: 'Nothing changed.' });
  const emailChange = changes.find((c) => c.field === 'email') || null;
  const phoneChange = changes.find((c) => c.field === 'phone') || null;
  const family = await orderFamily(db, tenantId, orderId, o);
  // An order held for review can be a stolen card: a new email or mobile on it (which gets the order's link) is a
  // manager's call, from any order in its family (a change here reaches all of them).
  if ((emailChange || phoneChange) && !auth.actor.isManager && familyHeld(family)) return bad('This order, or one it belongs with, is held for review, so a manager changes its email or mobile.', 403);
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
  const oldEmail = String(o.customerEmail || '').trim().toLowerCase();
  const { touched, toldNew, toldOld, texted } = await applyOrderContact(db, tenantId, orderId, o, next, changes, { uid: auth.actor.uid, name: auth.actor.name }, origin, family);

  const said = [
    emailChange ? (toldNew ? `the order link went to ${next.email}` : `the order now uses ${next.email}`) : '',
    emailChange && oldEmail ? (toldOld ? 'the old email was told it changed' : '') : '',
    phoneChange && next.phone ? (texted ? 'the new mobile got a text with the link' : '') : '',
    touched.length > 1 ? `its ${touched.length - 1 === 1 ? 'follow-up order' : `${touched.length - 1} follow-up orders`} changed too` : '',
  ].filter(Boolean);
  return NextResponse.json({ ok: true, changed: changes.map((c) => c.field), message: `Saved${said.length ? `: ${said.join(', ')}` : ''}.`, toldNew, toldOld, texted });
}
