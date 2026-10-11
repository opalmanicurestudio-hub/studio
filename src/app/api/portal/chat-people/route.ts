// src/app/api/portal/chat-people/route.ts — WHO'S IN TEAM CHAT, for people the database won't show the staff list to
// (booth renters: they run their own business, so the staff records — phone numbers, emails — stay closed to them).
//   GET  ?tenantId → the people this person can see in chat: name, photo, role, and whether they're away. Renters see
//        the managers and the other renters (Building Announcements); the team sees the team.
//   POST { tenantId, action: 'announcements' } → opens (or brings up to date) the announcements thread for them —
//        Building Announcements for renters, Team Announcements for the team — with everyone who belongs in it.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { isManagerRole } from '@/lib/permissions';
export const dynamic = 'force-dynamic';

const isRenterRec = (s: any) => !!s?.isRenter || s?.role === 'renter';

async function peopleFor(db: any, tenantId: string, staffId: string) {
  const [tSnap, snap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.collection(`tenants/${tenantId}/staff`).get()]);
  const tenant = tSnap.data() || {};
  const all = snap.docs.map((d: any) => ({ id: d.id, s: d.data() || {} })).filter(({ s }: any) => s.archived !== true);
  const me = all.find((x: any) => x.id === staffId)?.s || {}; const renter = isRenterRec(me);
  const mgr = (s: any) => ['owner', 'admin', 'manager'].includes(String(s.role || '')) || isManagerRole(tenant, String(s.role || ''));
  const seen = all.filter(({ s }: any) => (renter ? isRenterRec(s) || mgr(s) : !isRenterRec(s)));
  return { renter, people: seen.map(({ id, s }: any) => ({ id, name: String(s.name || 'Team member'), avatarUrl: s.avatarUrl || null, role: String(s.role || 'staff'), isRenter: isRenterRec(s),
    notificationAvailability: s.notificationAvailability ? { mode: s.notificationAvailability.mode || null, awayUntil: s.notificationAvailability.awayUntil || null } : null })) };
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const { people } = await peopleFor(db, tenantId, who.actor.staffId);
  return NextResponse.json({ ok: true, people }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (b.action !== 'announcements') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  const { renter, people } = await peopleFor(db, tenantId, who.actor.staffId);
  const id = renter ? 'building_broadcast' : 'team_broadcast';
  // Renters' announcements: every renter plus the managers. The team's: everyone who isn't a renter.
  const participantIds = [...new Set([who.actor.staffId, ...people.filter((p: any) => (renter ? true : !p.isRenter)).map((p: any) => p.id)])];
  await db.doc(`tenants/${tenantId}/staffThreads/${id}`).set({ id, tenantId, type: 'team', audience: renter ? 'renters' : 'staff', participantIds }, { merge: true });
  return NextResponse.json({ ok: true, id });
}
