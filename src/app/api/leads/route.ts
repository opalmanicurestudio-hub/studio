// src/app/api/leads/route.ts
//
// EARLY-ACCESS REQUESTS from the marketing site (/request-access).
// Saved to the top-level `platformLeads` collection (Admin SDK — nothing
// public can read it) and, if LEADS_NOTIFY_EMAIL is set, emailed to you
// through Resend so you can reach out and onboard them personally.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveFromAddress } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const hits = new Map<string, { n: number; at: number }>();
const TYPES = ['salon', 'spa', 'fitness', 'shop', 'other'];

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  const h = hits.get(ip); const now = Date.now();
  if (h && now - h.at < 3600000 && h.n >= 5) return NextResponse.json({ ok: false, error: 'Too many requests — try again later.' }, { status: 429 });
  hits.set(ip, h && now - h.at < 3600000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });

  const b = await req.json().catch(() => ({}));
  if (b.website) return NextResponse.json({ ok: true });   // bots fill the hidden field
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  const business = String(b.business || '').trim().slice(0, 120);
  const type = TYPES.includes(b.type) ? b.type : 'other';
  const size = String(b.size || '').slice(0, 40);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const currently = String(b.currently || '').trim().slice(0, 120);
  const note = String(b.note || '').trim().slice(0, 600);
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || business.length < 2) {
    return NextResponse.json({ ok: false, error: 'Please add your name, email and business name.' }, { status: 400 });
  }
  const at = new Date().toISOString();
  const db = getAdminDb();
  const ref = db.collection('platformLeads').doc();
  await ref.set({ id: ref.id, name, email, phone: phone || null, business, type, size: size || null, currently: currently || null, note: note || null, source: String(b.source || 'site').slice(0, 40), status: 'new', createdAt: at });

  const to = process.env.LEADS_NOTIFY_EMAIL;
  if (to && process.env.RESEND_API_KEY) {
    const lines = [`${name} — ${business} (${type}${size ? `, ${size}` : ''})`, `Email: ${email}${phone ? ` · Phone: ${phone}` : ''}`, currently ? `Currently using: ${currently}` : '', note ? `Note: ${note}` : ''].filter(Boolean);
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: resolveFromAddress(), to, reply_to: email, subject: `Early access request · ${business}`, text: lines.join('\n') }),
      });
    } catch { /* the lead is saved either way */ }
  }
  return NextResponse.json({ ok: true });
}
