// src/app/api/invites/route.ts
//
// EARLY ACCESS BY INVITE.
//
//   check    (public)       { code } → is this invite good? (+ who it's for)
//   redeem   (new owner)    { code, tenantId } → marks it used, after sign-up
//   list     (admin)        → early-access requests + invites
//   create   (admin)        { leadId?, email?, business?, type?, send? } →
//                            a code, and (send) an email with the sign-up link
//   status   (admin)        { leadId, status } — new / contacted / invited / onboarded / declined
//   revoke   (admin)        { code }
//
// Invites live in platformInvites/{CODE}; requests in platformLeads (see
// /api/leads). Admins are PLATFORM_ADMIN_EMAILS (src/lib/platform-admin.ts).
// Note: accounts are created in the browser (Firebase Auth), so the invite
// gate on /signup is a front door, not a vault — enough for early access.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { verifyPlatformAdmin, signupIsOpen, can } from '@/lib/platform-admin';
import { resolveFromAddress } from '@/lib/notify';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const hits = new Map<string, { n: number; at: number }>();
const clean = (c: any) => String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
const newCode = (seed: string) => {
  const word = String(seed || 'CF').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'CF';
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = ''; for (let i = 0; i < 5; i++) r += abc[Math.floor(Math.random() * abc.length)];
  return `${word}-${r}`;
};

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || '');
  const db = getAdminDb();

  if (action === 'check') {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
    const h = hits.get(ip); const now = Date.now();
    if (h && now - h.at < 600000 && h.n >= 20) return NextResponse.json({ ok: false, error: 'Too many tries — wait a few minutes.' }, { status: 429 });
    hits.set(ip, h && now - h.at < 600000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });
    if (signupIsOpen()) return NextResponse.json({ ok: true, open: true });
    const code = clean(b.code);
    if (code.length < 4) return NextResponse.json({ ok: false, error: 'Enter the invite code from your email.' }, { status: 400 });
    const inv = ((await db.doc(`platformInvites/${code}`).get()).data() as any) || null;
    if (!inv || inv.status === 'revoked') return NextResponse.json({ ok: false, error: 'That invite code isn’t recognised.' });
    if ((Number(inv.uses) || 0) >= (Number(inv.maxUses) || 1)) return NextResponse.json({ ok: false, error: 'That invite has already been used.' });
    return NextResponse.json({ ok: true, code, business: inv.business || null, email: inv.email || null, type: inv.type || null });
  }

  if (action === 'redeem') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    let uid = '';
    try { uid = (await getAdminAuth().verifyIdToken(token)).uid; } catch { return NextResponse.json({ ok: false }, { status: 401 }); }
    const code = clean(b.code); const tenantId = String(b.tenantId || '');
    const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || null;
    if (!t || t.userId !== uid) return NextResponse.json({ ok: false }, { status: 403 });
    const ref = db.doc(`platformInvites/${code}`);
    await db.runTransaction(async (tx: any) => {
      const inv = ((await tx.get(ref)).data() as any) || null;
      if (!inv) return;
      const uses = (Number(inv.uses) || 0) + 1;
      tx.set(ref, { uses, status: uses >= (Number(inv.maxUses) || 1) ? 'used' : 'active', usedAt: new Date().toISOString(), usedByTenantId: tenantId }, { merge: true });
      if (inv.leadId) tx.set(db.doc(`platformLeads/${inv.leadId}`), { status: 'onboarded', tenantId }, { merge: true });
    });
    await db.doc(`tenants/${tenantId}`).set({ inviteCode: code }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  // ── Everything below is for platform admins only ──
  const admin = await verifyPlatformAdmin(req);
  if (admin && !can(admin.role, 'invites')) return NextResponse.json({ ok: false, error: 'Your HQ role can’t manage invites.' }, { status: 403 });
  if (!admin) return NextResponse.json({ ok: false, error: 'Only ClarityFlow admins can do that. (Set PLATFORM_ADMIN_EMAILS in Vercel.)' }, { status: 403 });

  if (action === 'list') {
    const [leads, invites] = await Promise.all([
      db.collection('platformLeads').orderBy('createdAt', 'desc').limit(300).get(),
      db.collection('platformInvites').orderBy('createdAt', 'desc').limit(300).get(),
    ]);
    return NextResponse.json({ ok: true, signupOpen: signupIsOpen(), leads: leads.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })), invites: invites.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) });
  }

  if (action === 'status') {
    const status = ['new', 'contacted', 'invited', 'onboarded', 'declined'].includes(b.status) ? b.status : 'new';
    await db.doc(`platformLeads/${String(b.leadId || '')}`).set({ status, statusAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'revoke') {
    await db.doc(`platformInvites/${clean(b.code)}`).set({ status: 'revoked', revokedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'create') {
    let lead: any = null;
    if (b.leadId) lead = ((await db.doc(`platformLeads/${String(b.leadId)}`).get()).data() as any) || null;
    const email = String(b.email || lead?.email || '').trim().toLowerCase();
    const business = String(b.business || lead?.business || '').trim().slice(0, 120);
    const type = String(b.type || lead?.type || '');
    let code = newCode(business);
    for (let i = 0; i < 5 && (await db.doc(`platformInvites/${code}`).get()).exists; i++) code = newCode(business);
    const at = new Date().toISOString();
    await db.doc(`platformInvites/${code}`).set({ code, email: email || null, business: business || null, type: type || null, leadId: b.leadId || null,
      tools: Array.isArray(lead?.tools) ? lead.tools : [], maxUses: Math.max(1, Math.min(50, Number(b.maxUses) || 1)), uses: 0, status: 'active', createdAt: at, createdBy: admin.email });
    if (b.leadId) await db.doc(`platformLeads/${String(b.leadId)}`).set({ status: 'invited', inviteCode: code, statusAt: at }, { merge: true });
    const base = linkOrigin(null, req.nextUrl.origin);
    const params = new URLSearchParams({ invite: code, ...(type ? { type } : {}), ...(lead?.tools?.length ? { tools: lead.tools.join(',') } : {}) });
    const link = `${base}/signup?${params.toString()}`;
    let emailed = false;
    if (b.send && email && process.env.RESEND_API_KEY) {
      const first = String(lead?.name || '').split(/\s+/)[0] || 'there';
      const text = `Hi ${first},\n\nYou’re in — ${business || 'your business'} has early access to ClarityFlow.\n\nSet up here (takes a few minutes):\n${link}\n\nYour invite code: ${code}\n\nReply to this email any time — I’ll help you move your clients, services and team over.\n\n— ClarityFlow`;
      try {
        const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: resolveFromAddress(), to: email, reply_to: admin.email, subject: `You’re in — ClarityFlow early access`, text }) });
        emailed = r.ok;
      } catch { /* the code still works */ }
    }
    return NextResponse.json({ ok: true, code, link, emailed });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
