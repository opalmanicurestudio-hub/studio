// src/lib/team-access.ts — WHO ON THE TEAM CAN SIGN IN TO THE APP, and with what role.
//
// A team member's login (a Firebase account) is linked to their staff record by the server only:
//   staffDirectory/{uid} = { tenantId, staffId, role, name }   — read by the rules (isStaff / isManager) and by the app
//   staff/{staffId}.authUid = uid, .appAccess = 'invited' | 'active' | 'off'
// The role always comes from the staff record; syncAccess copies it across whenever it changes, and archiving someone
// turns their access off. Nobody can write staffDirectory from a browser.
//
//   inviteToApp   find or create the account for their email, link it, and email a link to set their password
//   syncAccess    copy the role across (or remove access when they're archived / a renter)
//   revokeAccess  turn app access off (the portal PIN still works)

export type AccessResult = { ok: true; message: string; link?: string; uid?: string } | { ok: false; error: string };

export async function syncAccess(db: any, tenantId: string, staffId: string): Promise<AccessResult> {
  const T = `tenants/${tenantId}`; const s = await db.doc(`${T}/staff/${staffId}`).get();
  if (!s.exists) return { ok: false, error: 'Team member not found.' };
  const m: any = s.data() || {}; const uid = String(m.authUid || '');
  if (!uid) return { ok: true, message: 'No app login to update.' };
  const off = m.archived === true || m.isRenter === true || m.role === 'renter' || m.appAccess === 'off';
  const dir = db.doc(`staffDirectory/${uid}`); const cur: any = (await dir.get()).data() || null;
  if (cur && cur.tenantId && cur.tenantId !== tenantId) return { ok: false, error: 'That login belongs to another business.' };
  if (off) { if (cur) await dir.delete(); return { ok: true, message: 'App access is off.' }; }
  await dir.set({ tenantId, staffId, role: String(m.role || 'staff'), name: String(m.name || ''), updatedAt: new Date().toISOString() }, { merge: true });
  return { ok: true, message: `Access updated — ${String(m.role || 'staff')}.` };
}

export async function inviteToApp(db: any, auth: any, tenantId: string, staffId: string, emailIn: string, opts: { send?: (to: string, subject: string, text: string) => Promise<boolean>; studioName?: string; by?: string } = {}): Promise<AccessResult> {
  const T = `tenants/${tenantId}`; const email = String(emailIn || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter their email address.' };
  const sRef = db.doc(`${T}/staff/${staffId}`); const s = await sRef.get();
  if (!s.exists) return { ok: false, error: 'Team member not found.' };
  const m: any = s.data() || {};
  if (m.isRenter === true || m.role === 'renter') return { ok: false, error: 'Renters use their own portal, not the team app.' };
  if (m.archived === true) return { ok: false, error: 'This team member is archived.' };
  let uid = '';
  try { uid = (await auth.getUserByEmail(email)).uid; }
  catch { try { uid = (await auth.createUser({ email, emailVerified: false, displayName: m.name || undefined })).uid; } catch (e: any) { return { ok: false, error: 'Couldn’t create a login for that email.' }; } }
  // The business owner's own account, or a login already on another business's team, can't be linked here.
  const tenant: any = (await db.doc(T).get()).data() || {};
  if (tenant.userId === uid) return { ok: false, error: 'That’s the owner’s own login.' };
  const owns = (await db.collection('tenants').where('userId', '==', uid).get()).docs.length > 0;
  if (owns) return { ok: false, error: 'That email owns a business on ClarityFlow — use a different email for their team login.' };
  const cur: any = (await db.doc(`staffDirectory/${uid}`).get()).data() || null;
  if (cur?.tenantId && cur.tenantId !== tenantId) return { ok: false, error: 'That email is already on another business’s team.' };
  if (cur?.staffId && cur.staffId !== staffId) return { ok: false, error: 'That email is already linked to someone else on your team.' };
  const now = new Date().toISOString();
  await sRef.set({ authUid: uid, email: m.email || email, appAccess: 'invited', appInvitedAt: now, ...(opts.by ? { appInvitedBy: opts.by } : {}) }, { merge: true });
  const sync = await syncAccess(db, tenantId, staffId); if (!sync.ok) return sync;
  let link = '';
  try { link = await auth.generatePasswordResetLink(email); } catch { link = ''; }
  let sent = false;
  if (link && opts.send) sent = await opts.send(email, `You’re invited to ${opts.studioName || 'the team'} on ClarityFlow`,
    `Hi ${String(m.name || '').split(' ')[0] || 'there'},\n\nYou’ve been given access to ${opts.studioName || 'your team'}’s app (role: ${String(m.role || 'staff')}).\n\nSet your password here, then sign in with ${email}:\n${link}\n\nYour PIN for the time clock and staff portal stays the same.\n`);
  return { ok: true, uid, link: link || undefined, message: sent ? `Invite emailed to ${email}.` : link ? 'Invite link created — copy it and send it to them.' : 'Access linked — they can use “Forgot password” on the sign-in page.' };
}

export async function revokeAccess(db: any, tenantId: string, staffId: string): Promise<AccessResult> {
  const sRef = db.doc(`tenants/${tenantId}/staff/${staffId}`); const s = await sRef.get(); if (!s.exists) return { ok: false, error: 'Team member not found.' };
  const uid = String((s.data() as any)?.authUid || '');
  await sRef.set({ appAccess: 'off', appAccessOffAt: new Date().toISOString() }, { merge: true });
  if (uid) { const d = db.doc(`staffDirectory/${uid}`); const cur: any = (await d.get()).data(); if (cur?.tenantId === tenantId) await d.delete(); }
  return { ok: true, message: 'App access turned off. Their PIN still works for the time clock and portal.' };
}
