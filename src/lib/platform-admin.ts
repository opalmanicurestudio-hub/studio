// src/lib/platform-admin.ts
//
// WHO RUNS CLARITYFLOW ITSELF (not a business on it). Platform admins can see
// early-access requests and send invites. Set PLATFORM_ADMIN_EMAILS in Vercel
// to a comma-separated list, e.g. "you@yourdomain.com".

import { getAdminAuth } from '@/lib/firebase-admin';

export function platformAdminEmails(): string[] {
  return String(process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** The signed-in platform admin behind this request, or null. */
export async function verifyPlatformAdmin(req: Request): Promise<{ uid: string; email: string } | null> {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const d = await getAdminAuth().verifyIdToken(token);
    const email = String(d.email || '').toLowerCase();
    return email && platformAdminEmails().includes(email) ? { uid: d.uid, email } : null;
  } catch { return null; }
}

/** Is sign-up open to everyone, or by invite only? Invite-only unless SIGNUP_OPEN=true. */
export const signupIsOpen = () => String(process.env.NEXT_PUBLIC_SIGNUP_OPEN || process.env.SIGNUP_OPEN || '').toLowerCase() === 'true';
