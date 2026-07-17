// src/app/api/gusto/payroll/route.ts
//
// POST — submit an approved payroll draft to Gusto.
// GET  — check the status of a previously submitted payroll.
//
// Gusto does the regulated work from here: exact tax calculations,
// withholdings, direct deposits, tax filings, pay stubs.

import { NextRequest, NextResponse } from 'next/server';

// const GUSTO_API_BASE = process.env.GUSTO_API_BASE || 'https://api.gusto.com';

export async function POST(req: NextRequest) {
  const draft = await req.json().catch(() => null);

  if (!draft?.tenantId || !Array.isArray(draft?.lines) || draft.lines.length === 0) {
    return NextResponse.json({ error: 'Invalid payroll draft' }, { status: 400 });
  }

  // ── TODO (real Gusto submission) ─────────────────────────────────────
  // 1. Load tokens from tenants/{tenantId}/private/gustoTokens (firebase-admin);
  //    refresh via /oauth/token grant_type=refresh_token if expired.
  // 2. Find the current unprocessed payroll:
  //      GET /v1/companies/{companyId}/payrolls?processing_statuses=unprocessed
  // 3. Map draft.lines → employee_compensations. Each line's staff earnings
  //    map to Gusto fixed/hourly compensation entries:
  //      regularHours / overtimeHours → hourly_compensations
  //      commission → fixed_compensations name: "Commission"
  //      tips       → fixed_compensations name: "Paycheck Tips"
  //      bonus      → fixed_compensations name: "Bonus"
  //      reimbursements → name: "Reimbursement" (non-taxable)
  //    PUT /v1/companies/{companyId}/payrolls/{payrollId}
  // 4. Submit: PUT /v1/companies/{companyId}/payrolls/{payrollId}/submit
  // 5. Store { payrollId, status, submittedAt } on
  //      tenants/{tenantId}/payrollRuns/{payrollId} for the dashboard.
  // ─────────────────────────────────────────────────────────────────────

  const configured = !!process.env.GUSTO_CLIENT_ID;
  if (!configured) {
    return NextResponse.json(
      { status: 'not_connected', message: 'Gusto is not configured yet — payroll draft validated but not submitted.' },
      { status: 200 },
    );
  }

  // Placeholder success until the TODO block above is implemented.
  return NextResponse.json({
    status: 'submitted',
    payrollId: `stub_${Date.now()}`,
    message: 'Payroll draft accepted (stub). Wire the TODO block to Gusto to process for real.',
  });
}

export async function GET(req: NextRequest) {
  const payrollId = req.nextUrl.searchParams.get('payrollId');
  if (!payrollId) {
    return NextResponse.json({ error: 'payrollId is required' }, { status: 400 });
  }
  // TODO: GET /v1/companies/{companyId}/payrolls/{payrollId} → map
  // processing status back to { status: 'processing' | 'processed' }.
  return NextResponse.json({ status: 'processing', payrollId });
}
