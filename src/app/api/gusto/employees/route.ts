// src/app/api/gusto/employees/route.ts
//
// v87 — GET: list the connected Gusto company's employees and match them
// to ClarityFlow staff.
//
// Matching, in confidence order:
//   1. Already saved      — staff doc has gustoEmployeeId → matched
//   2. Email (exact, normalized) → matched AND persisted to the staff doc
//   3. Full name (normalized)    → suggested only (suggestedStaffId) —
//      names collide too easily to auto-save
//
// The response is what PaydayTab renders: every Gusto employee with either
// a staffId (matched) or suggestedStaffId (one click to confirm in the UI).

import { requireCan } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { getGustoAuth, gustoFetch } from '@/lib/gusto-server';
import { logAuditAdmin } from '@/lib/audit';

const norm = (v: any) => String(v || '').trim().toLowerCase();

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  { const g = await requireCan(req, String(tenantId || ''), 'money.payroll'); if (g.deny) return g.deny; }
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Which business?' }, { status: 400 });
  }
  try {
    const db = getAdminDb();
    const auth = await getGustoAuth(db, tenantId);

    const gustoEmployees: any[] = await gustoFetch(auth, `/v1/companies/${auth.companyId}/employees`);
    const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
    const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

    const byGustoId = new Map(staff.filter((s: any) => s.gustoEmployeeId).map((s: any) => [s.gustoEmployeeId, s]));
    // (Matched by email or suggested by name only for someone on the employee payroll who isn't matched yet: never a
    // renter, a contractor, or someone matched to another person in Gusto. The same checks as confirming one.)
    const open = staff.filter((s: any) => !s.gustoEmployeeId && s.isRenter !== true && s.archived !== true && s.employmentType !== 'contractor');
    const byEmail = new Map(open.filter((s: any) => norm(s.email)).map((s: any) => [norm(s.email), s]));
    const byName = new Map(open.filter((s: any) => norm(s.name)).map((s: any) => [norm(s.name), s]));
    const taken = new Set<string>();

    let persisted = 0;
    const employees = [];
    for (const e of (Array.isArray(gustoEmployees) ? gustoEmployees : [])) {
      const gustoEmployeeId = e.uuid || e.id;
      const fullName = `${e.first_name || ''} ${e.last_name || ''}`.trim();
      const row: any = {
        gustoEmployeeId,
        firstName: e.first_name || '',
        lastName: e.last_name || '',
        email: e.email || null,
        terminated: !!e.terminated,
      };
      const saved: any = byGustoId.get(gustoEmployeeId);
      // (Someone who has left in Gusto is never matched or suggested: a rehire is matched to their current record.)
      const free = (s: any) => s && !taken.has(s.id) && !e.terminated;
      const emailHit: any = !saved && e.email && free(byEmail.get(norm(e.email))) ? byEmail.get(norm(e.email)) : null;
      const nameHit: any = !saved && !emailHit && fullName && free(byName.get(norm(fullName))) ? byName.get(norm(fullName)) : null;
      if (emailHit) taken.add(emailHit.id);
      if (saved) {
        row.staffId = saved.id; row.how = 'saved';
      } else if (emailHit) {
        // High-confidence: persist so payroll drafts can line up automatically.
        row.staffId = emailHit.id; row.how = 'email';
        try {
          await db.doc(`tenants/${tenantId}/staff/${emailHit.id}`).set({ gustoEmployeeId }, { merge: true });
          persisted++;
        } catch { /* match still returned; persistence retries next sync */ }
      } else if (nameHit) {
        row.suggestedStaffId = nameHit.id;
        row.suggestedStaffName = nameHit.name || null;
      }
      employees.push(row);
    }

    return NextResponse.json({
      ok: true,
      employees,
      matched: employees.filter((e: any) => e.staffId).length,
      suggested: employees.filter((e: any) => e.suggestedStaffId).length,
      newlyPersisted: persisted,
    });
  } catch (e: any) {
    const status = e?.status === 409 ? 409 : e?.status === 401 ? 401 : 502;
    return NextResponse.json({ ok: false, error: e?.message || 'Gusto didn’t answer. Try again in a minute.' }, { status });
  }
}

// POST — confirm a suggested match (or set one manually) from the UI:
// { tenantId, staffId, gustoEmployeeId } → saved on the staff doc. One Gusto employee is one person here: anyone else
// matched to them is unmatched in the same step. Only someone on the team, never a renter or a contractor (they aren't
// on the employee payroll), and only an employee of the connected Gusto company.
export async function POST(req: NextRequest) {
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 }); }
  const tenantId = String(b?.tenantId || ''); const staffId = String(b?.staffId || ''); const gustoEmployeeId = String(b?.gustoEmployeeId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(staffId) || !/^[A-Za-z0-9_-]{1,128}$/.test(gustoEmployeeId)) return NextResponse.json({ ok: false, error: 'Pick who this is in Gusto.' }, { status: 400 });
  try {
    const db = getAdminDb();
    const me: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data();
    if (!me || me.isRenter === true) return NextResponse.json({ ok: false, error: 'That person isn’t on the team.' }, { status: 404 });
    if (me.employmentType === 'contractor') return NextResponse.json({ ok: false, error: 'Contractors aren’t on the employee payroll.' }, { status: 400 });
    const auth = await getGustoAuth(db, tenantId);
    const list: any[] = await gustoFetch(auth, `/v1/companies/${auth.companyId}/employees`);
    const them = (Array.isArray(list) ? list : []).find((e: any) => String(e.uuid || e.id) === gustoEmployeeId);
    if (!them) return NextResponse.json({ ok: false, error: 'That person isn’t in Gusto any more. Look in Gusto again.' }, { status: 404 });
    if (them.terminated) return NextResponse.json({ ok: false, error: 'That person has left in Gusto. Pick their current record there.' }, { status: 400 });
    const others = (await db.collection(`tenants/${tenantId}/staff`).where('gustoEmployeeId', '==', gustoEmployeeId).get()).docs.filter((d: any) => d.id !== staffId);
    const batch = db.batch();
    for (const d of others) batch.set(d.ref, { gustoEmployeeId: null }, { merge: true });
    batch.set(db.doc(`tenants/${tenantId}/staff/${staffId}`), { gustoEmployeeId }, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'payroll.gusto_match', targetType: 'staff', targetId: staffId,
      summary: `${me.name || 'A team member'} matched to ${`${them.first_name || ''} ${them.last_name || ''}`.trim() || 'an employee'} in Gusto`, actor: { type: 'user', id: g.actor?.uid, name: g.actor?.name || 'Team member' } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'The match wasn’t saved. Try again.' }, { status: e?.status === 401 ? 401 : 500 });
  }
}
