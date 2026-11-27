// src/lib/payroll-export.ts — PAYROLL FOR ANOTHER PAYROLL COMPANY (Money › Payday › Download for another payroll company):
// the pay period's pay as a spreadsheet any payroll company takes (ADP, Paychex, QuickBooks Payroll, a bookkeeper): one
// row per employee with hours and each kind of pay as Gusto is sent it (lib/pay-period payrollFields), then the
// contractors, who aren't on the employee payroll. The rows are worked out by Payday, never here; this only lays them out.
import type { Cell } from './csv';

export type ExportPerson = {
  name: string; email?: string; contractor?: boolean; payStructure?: string;
  regularHours?: number; overtimeHours?: number; doubleOvertimeHours?: number;
  commission?: number; bonus?: number; salary?: number; tips?: number; cashTips?: number; adjustments?: number;
  /** Hours on the time clock (for anyone, commission and per service included: minimum wage and overtime are checked on them). */
  hours?: number;
  /** What's paid on payday (what they earned and any correction, less cash tips they took home), and everything they earned. */
  amount: number; earned?: number;
};

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const STRUCTURE: Record<string, string> = { hourly: 'Hourly', hourly_plus_commission: 'Hourly and commission', commission: 'Commission', per_service: 'Per service', salary: 'Salary' };

/** The spreadsheet's rows: a heading, each employee, a total, then each contractor. */
export function payrollExportRows(people: ExportPerson[], period: { from: string; to: string; payday?: string | null }): Cell[][] {
  const head: Cell[] = ['Name', 'Email', 'Type', 'Pay', 'Hours worked', 'Regular hours', 'Overtime hours', 'Double time hours', 'Salary', 'Commission', 'Bonus', 'Of the bonus, corrections', 'Paycheck tips', 'Cash tips (reported, already paid)', 'Paid on payday'];
  const rows: Cell[][] = [[`Pay period ${period.from} to ${period.to}${period.payday ? `, payday ${period.payday}` : ''}`], head];
  const employees = people.filter((p) => !p.contractor && (r2(p.amount) !== 0 || r2(p.cashTips) > 0)).sort((a, b) => a.name.localeCompare(b.name));
  for (const p of employees) rows.push([p.name, p.email || '', 'Employee', STRUCTURE[String(p.payStructure)] || '', r2(p.hours), r2(p.regularHours), r2(p.overtimeHours), r2(p.doubleOvertimeHours), r2(p.salary),
    r2(p.commission), r2(p.bonus), r2(p.adjustments), r2(p.tips), r2(p.cashTips), r2(p.amount)]);
  const sum = (k: keyof ExportPerson) => r2(employees.reduce((n, p) => n + (Number(p[k]) || 0), 0));
  rows.push(['Employees in all', '', '', '', sum('hours'), sum('regularHours'), sum('overtimeHours'), sum('doubleOvertimeHours'), sum('salary'), sum('commission'), sum('bonus'), sum('adjustments'), sum('tips'), sum('cashTips'), sum('amount')]);
  // (Everything a contractor earned, cash tips they took home included: what their 1099 adds up.)
  const earnedOf = (p: ExportPerson) => r2(p.earned ?? (Number(p.amount) || 0) + (Number(p.cashTips) || 0));
  const contractors = people.filter((p) => p.contractor && earnedOf(p) > 0).sort((a, b) => a.name.localeCompare(b.name));
  if (contractors.length) {
    rows.push([], ['Contractors (not on the employee payroll: nothing withheld)'], ['Name', 'Email', 'Type', 'Pay', 'Hours worked', 'Cash tips taken home', 'Paid on payday', 'Earned in all']);
    for (const p of contractors) rows.push([p.name, p.email || '', 'Contractor', STRUCTURE[String(p.payStructure)] || '', r2(p.hours), r2(p.cashTips), r2(Math.max(0, Number(p.amount) || 0)), earnedOf(p)]);
  }
  return rows;
}
