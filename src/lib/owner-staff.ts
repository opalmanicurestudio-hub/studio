// src/lib/owner-staff.ts — THE OWNER IS ON THE TEAM. Every business's owner gets a team profile (role "owner"), made
// at signup — so owner notifications have somewhere to land, and the owner shows in Team like everyone else.
//   • Solo business: the owner IS the provider, so the profile is bookable (opening hours) and on the booking page.
//   • Team business: not bookable and not on the booking page until they choose (weekly hours "off every day" — the
//     booking engine's own rule; switch it on in Team if they also do services).
// Existing businesses get one the first time it's needed — reusing a profile they made themselves (role owner, or
// the same email) so nobody is listed twice. The profile's id is the owner's login id.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function ownerProfileFor(tenant: any, tenantId: string, owner: { uid: string; name?: string; email?: string; phone?: string }) {
  const name = String(owner.name || '').trim() || String(owner.email || '').split('@')[0] || 'Owner';
  const solo = tenant?.teamSize !== 'team';
  return {
    id: owner.uid, tenantId, name, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '),
    email: owner.email || '', phone: owner.phone || '', role: 'owner', avatarUrl: '', status: 'active', isActive: true,
    payStructure: 'salary', commissionRate: 0, decisionAuthority: 'full',
    showOnPublicPage: solo,
    ...(solo ? {} : { availability: { week: Object.fromEntries(DAYS.map((d) => [d, { enabled: false, start: '09:00 AM', end: '05:00 PM' }])) } }),
    addedAutomatically: true, createdAt: new Date().toISOString(),
  };
}

/** The owner's team profile id — found, or made. Never a duplicate. */
export async function ensureOwnerTeamMember(db: any, tenantId: string): Promise<string | null> {
  const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data();
  const uid = tenant?.userId || tenant?.ownerId; if (!uid) return null;
  if ((await db.doc(`${T}/staff/${uid}`).get()).exists) return uid;
  const owners = await db.collection(`${T}/staff`).where('role', '==', 'owner').limit(1).get();
  if (!owners.empty) return owners.docs[0].id;
  const user: any = (await db.doc(`users/${uid}`).get()).data() || {};
  const email = String(user.email || tenant.ownerEmail || '').toLowerCase();
  if (email) { const same = await db.collection(`${T}/staff`).where('email', '==', email).limit(1).get(); if (!same.empty) return same.docs[0].id; }
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || tenant.ownerName || '';
  await db.doc(`${T}/staff/${uid}`).set(ownerProfileFor(tenant, tenantId, { uid, name, email, phone: user.phone || '' }), { merge: true });
  return uid;
}

/** Which team member is signed in? Staff portal ("portal:<business>:<profile>"), a team member's own login, or the
 *  owner (their owner team profile — made if missing). */
export async function staffIdForLogin(db: any, tenantId: string, uid: string): Promise<string | null> {
  const T = `tenants/${tenantId}`; const portal = `portal:${tenantId}:`;
  if (uid.startsWith(portal)) { const id = uid.slice(portal.length); return (await db.doc(`${T}/staff/${id}`).get()).exists ? id : null; }
  if ((await db.doc(`${T}/staff/${uid}`).get()).exists) return uid;
  const tenant: any = (await db.doc(T).get()).data() || {};
  if (tenant.userId === uid || tenant.ownerId === uid) return ensureOwnerTeamMember(db, tenantId);
  return null;
}
