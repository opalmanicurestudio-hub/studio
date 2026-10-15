// src/lib/wage-data.ts — WHAT SIMILAR WORK PAYS (US, national), for the pay calculator. From the Bureau of Labor
// Statistics Occupational Employment and Wage Statistics: the hourly spread (10th, 25th, 50th, 75th, 90th percentile)
// from May 2023, and the median from May 2025. Figures include tips reported on pay. Update once a year: download
// https://www.bls.gov/oes/special-requests/oesm25nat.zip (H_PCT10 … H_PCT90) and replace the numbers below.
export type Occupation = { soc: string; title: string; p10: number | null; p25: number | null; median: number | null; p75: number | null; p90: number | null; median2025: number | null };
export const WAGE_SOURCE = { name: 'U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics', spread: 'May 2023', median: 'May 2025', url: 'https://www.bls.gov/oes/' };
export const OCCUPATIONS: Occupation[] = [
  { soc: '39-5092', title: 'Nail technician (manicurist, pedicurist)', p10: 13.11, p25: 14.99, median: 16.47, p75: 17.75, p90: 23.11, median2025: 17.19 },
  { soc: '39-5012', title: 'Hairstylist, cosmetologist', p10: 11.31, p25: 13.87, median: 16.81, p75: 22.80, p90: 30.44, median2025: 17.21 },
  { soc: '39-5011', title: 'Barber', p10: 12.87, p25: 14.49, median: 17.38, p75: 23.66, p90: 29.37, median2025: 18.37 },
  { soc: '39-5094', title: 'Esthetician, skincare specialist', p10: 13.27, p25: 16.01, median: 20.77, p75: 28.24, p90: 39.10, median2025: 21.79 },
  { soc: '39-5093', title: 'Shampoo assistant', p10: 10.67, p25: 12.80, median: 14.20, p75: 15.67, p90: 17.23, median2025: 15.67 },
  { soc: '31-9011', title: 'Massage therapist', p10: 15.50, p25: 20.00, median: 26.59, p75: 36.04, p90: 46.01, median2025: 28.10 },
  { soc: '39-9031', title: 'Fitness trainer, instructor', p10: 12.91, p25: 16.20, median: 22.35, p75: 29.62, p90: 38.82, median2025: 22.67 },
  { soc: '35-3031', title: 'Server (waiter, waitress)', p10: 8.94, p25: 11.43, median: 15.36, p75: 20.00, p90: 28.89, median2025: 16.94 },
  { soc: '35-3011', title: 'Bartender', p10: 9.55, p25: 11.47, median: 15.15, p75: 20.58, p90: 29.43, median2025: 16.51 },
  { soc: '35-3023', title: 'Counter, fast food, barista', p10: 10.67, p25: 12.64, median: 14.20, p75: 16.55, p90: 17.73, median2025: 15.00 },
  { soc: '35-2014', title: 'Restaurant cook', p10: 12.97, p25: 14.36, median: 17.20, p75: 19.06, p90: 22.32, median2025: 17.98 },
  { soc: '35-9031', title: 'Host, hostess', p10: 10.35, p25: 11.87, median: 14.05, p75: 16.67, p90: 18.67, median2025: 15.00 },
  { soc: '41-2031', title: 'Retail sales', p10: 11.42, p25: 13.75, median: 16.19, p75: 17.98, p90: 23.13, median2025: 17.03 },
  { soc: '41-2011', title: 'Cashier', p10: 10.86, p25: 12.92, median: 14.29, p75: 16.59, p90: 17.88, median2025: 15.83 },
  { soc: '43-4171', title: 'Receptionist, front desk', p10: 12.95, p25: 14.64, median: 17.23, p75: 19.58, p90: 22.77, median2025: 18.27 },
  { soc: '43-4051', title: 'Customer service', p10: 14.21, p25: 16.72, median: 19.08, p75: 23.31, p90: 29.45, median2025: 21.53 },
  { soc: '41-3091', title: 'Sales (services)', p10: 17.51, p25: 22.70, median: 31.06, p75: 47.08, p90: 69.02, median2025: 33.65 },
  { soc: '41-4012', title: 'Sales (wholesale, manufacturing)', p10: 17.90, p25: 23.33, median: 31.56, p75: 46.20, p90: 63.95, median2025: 34.65 },
  { soc: '41-9022', title: 'Real estate agent', p10: 15.10, p25: 18.30, median: 26.11, p75: 39.16, p90: 57.49, median2025: 25.40 },
  { soc: '31-9091', title: 'Dental assistant', p10: 17.05, p25: 18.38, median: 22.38, p75: 26.17, p90: 29.35, median2025: 23.11 },
  { soc: '31-9092', title: 'Medical assistant', p10: null, p25: null, median: null, p75: null, p90: null, median2025: 21.97 },
  { soc: '43-4081', title: 'Hotel front desk', p10: 11.30, p25: 13.51, median: 14.80, p75: 17.33, p90: 20.11, median2025: 16.86 },
  { soc: '37-2012', title: 'Housekeeper, cleaner (homes, hotels)', p10: 11.79, p25: 13.75, median: 16.08, p75: 18.09, p90: 21.96, median2025: 17.07 },
  { soc: '37-2011', title: 'Janitor', p10: 12.39, p25: 14.22, median: 16.84, p75: 19.05, p90: 23.18, median2025: 17.71 },
  { soc: '39-9011', title: 'Childcare worker', p10: 10.79, p25: 13.00, median: 14.60, p75: 17.41, p90: 20.80, median2025: 16.82 },
  { soc: '39-2021', title: 'Pet groomer, animal caretaker', p10: 11.15, p25: 13.47, median: 15.00, p75: 17.41, p90: 21.67, median2025: 17.00 },
  { soc: '49-3023', title: 'Auto technician, mechanic', p10: 14.71, p25: 17.74, median: 22.96, p75: 29.96, p90: 37.32, median2025: 24.34 },
  { soc: '47-2111', title: 'Electrician', p10: 18.49, p25: 23.13, median: 29.61, p75: 38.59, p90: 50.09, median2025: 30.38 },
  { soc: '47-2152', title: 'Plumber', p10: 18.60, p25: 22.99, median: 29.59, p75: 38.56, p90: 49.59, median2025: 30.67 },
  { soc: '53-3033', title: 'Delivery driver (light truck)', p10: 13.50, p25: 16.88, median: 20.42, p75: 24.57, p90: 36.10, median2025: null },
];
/** The spread to show: the May 2023 spread moved up to the May 2025 median when there is one (an estimate, said so). */
export function wageRange(soc: string): { low: number | null; p25: number | null; median: number; p75: number | null; high: number | null; scaled: boolean; year: string } | null {
  const o = OCCUPATIONS.find((x) => x.soc === soc); if (!o) return null;
  const med = o.median2025 ?? o.median; if (!med) return null;
  const f = o.median2025 && o.median ? o.median2025 / o.median : 1; const sc = (v: number | null) => (v === null ? null : Math.round(v * f * 100) / 100);
  return { low: sc(o.p10), p25: sc(o.p25), median: med, p75: sc(o.p75), high: sc(o.p90), scaled: f !== 1, year: o.median2025 ? '2025' : '2023' };
}
