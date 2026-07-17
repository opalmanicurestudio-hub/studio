// src/lib/gusto.ts
//
// Client-side Gusto integration layer for ClarityFlow.
//
// The app never talks to Gusto directly from the browser — everything goes
// through our own API routes (src/app/api/gusto/*), which hold the OAuth
// tokens server-side. This file is safe to import in client components.
//
// Flow:
//   1. beginGustoConnect()  → redirects to /api/gusto/authorize (OAuth start)
//   2. Gusto redirects back → /api/gusto/callback exchanges the code, stores
//      tokens + companyId on the tenant doc, then returns to /money?tab=payday
//   3. syncGustoEmployees() → pulls Gusto employees so staff can be matched
//   4. submitGustoPayroll() → sends the approved payroll draft
//   5. getGustoPayrollStatus() → polls processing status

export type GustoConnection = {
  connected: boolean;
  companyId?: string;
  companyName?: string;
  connectedAt?: string;
};

export type GustoEmployee = {
  gustoEmployeeId: string;
  firstName: string;
  lastName: string;
  email?: string;
  /** ClarityFlow staff id this Gusto employee is matched to, if any */
  staffId?: string;
};

export type GustoPayrollLine = {
  staffId: string;
  gustoEmployeeId?: string;
  name: string;
  regularHours: number;
  overtimeHours: number;
  commission: number;
  tips: number;
  bonus: number;
  reimbursements: number;
  deductions: number;
};

export type GustoPayrollDraft = {
  tenantId: string;
  periodStart: string; // ISO date
  periodEnd: string;   // ISO date
  lines: GustoPayrollLine[];
  /** Sum of all line earnings — used for the reserve check + tax estimate */
  grossTotal: number;
  estimatedEmployerTaxes: number;
};

export type GustoPayrollResult = {
  status: 'submitted' | 'processing' | 'processed' | 'failed' | 'not_connected';
  payrollId?: string;
  message?: string;
};

/** Read connection state off the tenant doc (written by the OAuth callback). */
export const getGustoConnection = (tenant: any): GustoConnection => ({
  connected: !!tenant?.gusto?.connected,
  companyId: tenant?.gusto?.companyId,
  companyName: tenant?.gusto?.companyName,
  connectedAt: tenant?.gusto?.connectedAt,
});

/** Step 1 — kick off OAuth. Full-page redirect; Gusto handles login + consent. */
export const beginGustoConnect = (tenantId: string) => {
  window.location.href = `/api/gusto/authorize?tenantId=${encodeURIComponent(tenantId)}`;
};

/** Step 3 — pull Gusto employees for matching against ClarityFlow staff. */
export const syncGustoEmployees = async (tenantId: string): Promise<GustoEmployee[]> => {
  const res = await fetch(`/api/gusto/employees?tenantId=${encodeURIComponent(tenantId)}`);
  if (!res.ok) throw new Error(`Employee sync failed (${res.status})`);
  const data = await res.json();
  return data.employees ?? [];
};

/** Step 4 — submit the approved payroll draft. */
export const submitGustoPayroll = async (draft: GustoPayrollDraft): Promise<GustoPayrollResult> => {
  const res = await fetch('/api/gusto/payroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { status: 'failed', message: body.error || `Submission failed (${res.status})` };
  }
  return res.json();
};

/** Step 5 — poll a submitted payroll's status. */
export const getGustoPayrollStatus = async (tenantId: string, payrollId: string): Promise<GustoPayrollResult> => {
  const res = await fetch(`/api/gusto/payroll?tenantId=${encodeURIComponent(tenantId)}&payrollId=${encodeURIComponent(payrollId)}`);
  if (!res.ok) return { status: 'failed', message: `Status check failed (${res.status})` };
  return res.json();
};
