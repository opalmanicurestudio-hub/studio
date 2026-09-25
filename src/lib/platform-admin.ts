// src/lib/platform-admin.ts
//
// WHO RUNS CLARITYFLOW ITSELF — the HQ team, and what each role may do.
//
//   owner      everything, including the company's money (the emails in
//              PLATFORM_ADMIN_EMAILS are owners)
//   support    help desk, businesses (fixes, notes, resets), early access
//   developer  help desk (bugs), businesses (read + fixes), system
//   analyst    insights and businesses, read-only
//
// Team members beyond the owners live in platformTeam/{email}, added from
// HQ → Team. Everyone signs in with a normal ClarityFlow account.

import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

export type HqRole = 'owner' | 'support' | 'developer' | 'analyst';
export type HqPerm = 'tickets' | 'tenants' | 'fix' | 'suspend' | 'invites' | 'system' | 'insights' | 'team' | 'finance';

const PERMS: Record<HqRole, HqPerm[]> = {
  owner: ['tickets', 'tenants', 'fix', 'suspend', 'invites', 'system', 'insights', 'team', 'finance'],
  support: ['tickets', 'tenants', 'fix', 'invites'],
  developer: ['tickets', 'tenants', 'fix', 'system'],
  analyst: ['tenants', 'insights'],
};
export const can = (role: HqRole | null | undefined, perm: HqPerm) => !!role && PERMS[role].includes(perm);
export const permsFor = (role: HqRole) => PERMS[role];

export function platformAdminEmails(): string[] {
  return String(process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export interface HqMember { uid: string; email: string; role: HqRole; name: string }

/** The signed-in HQ team member behind this request, or null. */
export async function verifyPlatformAdmin(req: Request): Promise<HqMember | null> {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const d = await getAdminAuth().verifyIdToken(token);
    const email = String(d.email || '').toLowerCase();
    if (!email) return null;
    if (platformAdminEmails().includes(email)) return { uid: d.uid, email, role: 'owner', name: String(d.name || email.split('@')[0]) };
    const m = ((await getAdminDb().doc(`platformTeam/${email}`).get()).data() as any) || null;
    if (!m || m.active === false || !PERMS[m.role as HqRole]) return null;
    return { uid: d.uid, email, role: m.role, name: m.name || email.split('@')[0] };
  } catch { return null; }
}

/** Is sign-up open to everyone, or by invite only? Invite-only unless SIGNUP_OPEN=true. */
export const signupIsOpen = () => String(process.env.NEXT_PUBLIC_SIGNUP_OPEN || process.env.SIGNUP_OPEN || '').toLowerCase() === 'true';
