// src/app/api/gusto/employees/route.ts
//
// GET — list Gusto employees for this tenant's connected company, so the
// app can match them to ClarityFlow staff (store gustoEmployeeId on each
// staff doc once matched).

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  // ── TODO (real Gusto call) ───────────────────────────────────────────
  // 1. Load tokens for tenantId (firebase-admin), refresh if needed.
  // 2. GET /v1/companies/{companyId}/employees
  // 3. Map to { gustoEmployeeId, firstName, lastName, email } and, where a
  //    ClarityFlow staff doc has a matching email, include staffId.
  // ─────────────────────────────────────────────────────────────────────

  return NextResponse.json({
    employees: [],
    message: 'Gusto not configured yet — returning empty employee list.',
  });
}
