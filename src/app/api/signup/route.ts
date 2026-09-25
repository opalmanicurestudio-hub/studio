// src/app/api/signup/route.ts
//
// ACCOUNTS ARE CREATED HERE — AND ONLY HERE.
//
// Before, the browser created the Firebase account and wrote the business
// records itself, so an invite check on the page could be skipped by anyone
// calling Firebase directly. Now this route does all of it with the Admin SDK:
//
//   1. checks the details and — unless sign-up is open — RESERVES the invite
//      in a transaction (one use per invite; two people can't race it)
//   2. creates the Firebase account
//   3. writes the user + business records (same defaults as before, plus the
//      business type and chosen tools)
//   4. marks the invite used / the request onboarded
//   5. returns a one-time sign-in token; the page signs in with it
//
// If anything fails after the account exists, the account is removed and the
// invite released, so a retry starts clean.
//
// Closing the other doors (see the Vercel/Firebase checklist):
//   • Firebase Console → Authentication → Settings → User actions →
//     turn OFF "Enable create (sign-up)" — browsers can no longer create
//     accounts; this route (Admin SDK) still can.
//   • firestore.rules — tenants can't be created from the browser, and the
//     account-status fields can only be changed by the server.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { signupIsOpen } from '@/lib/platform-admin';
import { CATEGORY_FOR, toTenantModules, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const TYPES = ['salon', 'spa', 'fitness', 'tattoo', 'shop', 'events', 'hospitality', 'other'];
const hits = new Map<string, { n: number; at: number }>();
const id = (n = 21) => randomBytes(n).toString('base64url').slice(0, n);
const cleanCode = (c: any) => String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  const h = hits.get(ip); const now = Date.now();
  if (h && now - h.at < 3600000 && h.n >= 8) return NextResponse.json({ ok: false, error: 'Too many attempts — try again in a while.' }, { status: 429 });
  hits.set(ip, h && now - h.at < 3600000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });

  const b = await req.json().catch(() => ({}));
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const password = String(b.password || '');
  const businessName = String(b.businessName || '').trim().slice(0, 80);
  const type = TYPES.includes(b.type) ? b.type : 'other';
  const teamSize = b.teamSize === 'team' ? 'team' : 'solo';
  const tools = (Array.isArray(b.tools) ? b.tools : []).map(String).filter((t: string) => TOOL_BY_ID[t as ToolId]) as ToolId[];
  const code = cleanCode(b.invite);

  if (name.length < 2) return NextResponse.json({ ok: false, error: 'Add your name.' }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'That email address doesn’t look right.' }, { status: 400 });
  if (phone.replace(/\D/g, '').length < 7) return NextResponse.json({ ok: false, error: 'Add a mobile number.' }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ ok: false, error: 'Choose a password of at least 6 characters.' }, { status: 400 });
  if (businessName.length < 2) return NextResponse.json({ ok: false, error: 'Add your business name.' }, { status: 400 });

  const db = getAdminDb();
  const auth = getAdminAuth();
  const inviteOnly = !signupIsOpen();
  const inviteRef = code ? db.doc(`platformInvites/${code}`) : null;

  // 1. Reserve the invite — atomically, so it can't be used twice at once.
  let invite: any = null;
  if (inviteOnly) {
    if (!inviteRef) return NextResponse.json({ ok: false, error: 'ClarityFlow is invite-only right now — enter the code from your invite email.' }, { status: 403 });
    try {
      invite = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(inviteRef);
        const inv = snap.exists ? (snap.data() as any) : null;
        if (!inv || inv.status === 'revoked') throw new Error('That invite code isn’t recognised.');
        const uses = Number(inv.uses) || 0; const max = Number(inv.maxUses) || 1;
        if (uses >= max) throw new Error('That invite has already been used.');
        if (inv.email && max === 1 && inv.email !== email) throw new Error(`This invite is for ${inv.email.replace(/(.{2}).*(@.*)/, '$1…$2')} — sign up with that email, or ask for a new invite.`);
        tx.update(inviteRef, { uses: uses + 1, status: uses + 1 >= max ? 'used' : 'active' });
        return inv;
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || 'That invite didn’t work.' }, { status: 403 });
    }
  }
  const release = async () => {
    if (!inviteRef || !invite) return;
    try { await db.runTransaction(async (tx: any) => { const s = await tx.get(inviteRef); const u = Math.max(0, (Number((s.data() as any)?.uses) || 1) - 1); tx.update(inviteRef, { uses: u, status: 'active' }); }); } catch { /* best effort */ }
  };

  // 2. The account.
  let userId = '';
  try {
    const u = await auth.createUser({ email, password, displayName: name, emailVerified: false });
    userId = u.uid;
  } catch (e: any) {
    await release();
    const c = String(e?.code || e?.errorInfo?.code || '');
    const msg = c.includes('email-already-exists') ? 'There’s already an account with that email — sign in instead.'
      : c.includes('invalid-password') ? 'Choose a password of at least 6 characters.'
      : c.includes('invalid-email') ? 'That email address doesn’t look right.'
      : 'We couldn’t create your account. Try again.';
    return NextResponse.json({ ok: false, error: msg, code: c.includes('email-already-exists') ? 'exists' : undefined }, { status: 400 });
  }

  // 3. The records — same defaults the app has always created.
  const tenantId = id(21);
  const at = new Date().toISOString();
  try {
    const batch = db.batch();
    batch.set(db.doc(`users/${userId}`), {
      id: userId, tenantId, email, phone,
      firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), createdAt: at,
    });
    batch.set(db.doc(`tenants/${tenantId}`), {
      id: tenantId, name: businessName, userId, category: CATEGORY_FOR[type] || 'other',
      businessType: type, teamSize, modules: toTenantModules(tools), signupTools: tools,
      subscriptionStatus: 'inactive', subscriptionTier: 'none',
      tmhr: 50, employerTaxBurdenPct: 10, createdAt: at, onboardingComplete: false,
      maxAutonomousRecoveryAmount: 50, maxAutonomousRecoveryPercent: 25, defaultCancellationMode: 'matrix',
      escalationPolicy: "1. Autonomy: Staff are authorized to resolve minor hospitality or technical lapses up to their limit. 2. Criteria: Use 'Recovery Adjustment' for delays > 15m or minor inconsistencies. 3. Immediate Escalation: Mandatory for medical reactions, property damage, or guest hostility. 4. Documentation: Always log specific reasoning in the Checkout Hub.",
      recoveryPresets: [
        { id: 'wait-time', label: 'WAIT TIME RECOVERY', type: 'fixed', value: 15 },
        { id: 'tech-adj', label: 'TECHNICAL REVISION', type: 'percentage', value: 20 },
        { id: 'hospitality', label: 'HOSPITALITY LAPSE', type: 'fixed', value: 10 },
        { id: 'protocol-fail', label: 'PROTOCOL FAILURE', type: 'percentage', value: 100 },
      ],
      bookingPageSettings: { heroTitle: `Welcome to ${businessName}`, primaryColor: '#7955c4', showTeam: teamSize === 'team', servicesSectionTitle: 'The Menu' },
      ...(code ? { inviteCode: code } : {}),
      signupIp: ip, signupAt: at,
    });
    const lp = id(); batch.set(db.doc(`tenants/${tenantId}/lifestyleProfiles/${lp}`), { id: lp, name: 'Primary Lifestyle', isActive: true, categories: [] });
    const bp = id(); batch.set(db.doc(`tenants/${tenantId}/businessProfiles/${bp}`), { id: bp, name: 'Core Studio Costs', isActive: true, categories: [] });
    const sp = id();
    const day = (enabled: boolean) => ({ enabled, start: '09:00 AM', end: '05:00 PM' });
    batch.set(db.doc(`tenants/${tenantId}/scheduleProfiles/${sp}`), {
      id: sp, name: 'Standard Studio Hours', isActive: true, isPublic: true,
      week: { monday: day(true), tuesday: day(true), wednesday: day(true), thursday: day(true), friday: day(true), saturday: day(false), sunday: day(false) },
      timeOff: { vacationDays: 14, holidays: 10 },
    });
    // 4. The invite and the request it came from.
    if (inviteRef && invite) {
      batch.set(inviteRef, { usedAt: at, usedByTenantId: tenantId, usedByEmail: email }, { merge: true });
      if (invite.leadId) batch.set(db.doc(`platformLeads/${invite.leadId}`), { status: 'onboarded', tenantId, statusAt: at }, { merge: true });
    }
    await batch.commit();
  } catch (e) {
    // Undo: no half-made accounts.
    try { await auth.deleteUser(userId); } catch { /* ignore */ }
    await release();
    return NextResponse.json({ ok: false, error: 'We couldn’t finish setting up your business. Nothing was kept — try again.' }, { status: 500 });
  }

  // 5. A one-time token so the page can sign straight in.
  const token = await auth.createCustomToken(userId);
  return NextResponse.json({ ok: true, token, tenantId });
}
