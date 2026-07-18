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

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { getGustoAuth, gustoFetch } from '@/lib/gusto-server';

const norm = (v: any) => String(v || '').trim().toLowerCase();

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }
  try {
    const db = getAdminDb();
    const auth = await getGustoAuth(db, tenantId);

    const gustoEmployees: any[] = await gustoFetch(auth, `/v1/companies/${auth.companyId}/employees`);
    const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
    const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

    const byGustoId = new Map(staff.filter((s: any) => s.gustoEmployeeId).map((s: any) => [s.gustoEmployeeId, s]));
    const byEmail = new Map(staff.filter((s: any) => norm(s.email)).map((s: any) => [norm(s.email), s]));
    const byName = new Map(staff.filter((s: any) => norm(s.name)).map((s: any) => [norm(s.name), s]));

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
      const emailHit: any = !saved && e.email ? byEmail.get(norm(e.email)) : null;
      const nameHit: any = !saved && !emailHit && fullName ? byName.get(norm(fullName)) : null;
      if (saved) {
        row.staffId = saved.id;
      } else if (emailHit) {
        // High-confidence: persist so payroll drafts can line up automatically.
        row.staffId = emailHit.id;
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
    return NextResponse.json({ ok: false, error: e?.message || 'Employee sync failed.' }, { status });
  }
}

// POST — confirm a suggested match (or set one manually) from the UI:
// { tenantId, staffId, gustoEmployeeId } → saved on the staff doc.
export async function POST(req: NextRequest) {
  try {
    const { tenantId, staffId, gustoEmployeeId } = await req.json();
    if (!tenantId || !staffId || !gustoEmployeeId) {
      return NextResponse.json({ error: 'tenantId, staffId and gustoEmployeeId are required' }, { status: 400 });
    }
    const db = getAdminDb();
    await db.doc(`tenants/${tenantId}/staff/${staffId}`).set({ gustoEmployeeId }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not save the match.' }, { status: 500 });
  }
}
