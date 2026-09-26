// src/lib/grades.ts — letter grades (NC 21 NCAC 14T .0701: A 90–100, B 80–89, C 70–79, F below 70).
export function letter(pct: number | null | undefined, pass = 70) {
  if (pct == null || Number.isNaN(pct)) return '—';
  if (pct >= 90) return 'A'; if (pct >= 80) return 'B'; if (pct >= Math.min(pass, 79)) return 'C'; return 'F';
}
