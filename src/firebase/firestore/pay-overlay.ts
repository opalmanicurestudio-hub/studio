// src/firebase/firestore/pay-overlay.ts — pay rates for the app's screens. Pay lives in tenants/{t}/staffPay (lib/staff-pay),
// readable only by managers and the person themselves. For a manager, StaffPayOverlay (in the app layout) listens to it
// and useCollection / useDoc put the rates back on staff records, so pay screens work as before; for everyone else the
// staff records simply have no rates on them.
import { useEffect, useState } from 'react';

// Kept in step with PAY_FIELDS in lib/staff-pay (this file stays dependency-free: it's loaded by every data hook).
const FIELDS = ['commissionRate', 'retailCommissionRate', 'hourlyRate', 'serviceHourRate', 'servicePay', 'serviceCommission', 'nonServiceRate',
  'commissionTiers', 'salaryAmount', 'salaryPer', 'salaryWeekly', 'overtimeExempt', 'overtimeNonExempt'];
function mergePay(s: any, pay: any) { if (!s || !pay) return s; const out: any = { ...s }; for (const k of FIELDS) if (pay[k] !== undefined) out[k] = pay[k]; return out; }

type Store = { tenantId: string | null; byId: Record<string, any>; v: number };
let store: Store = { tenantId: null, byId: {}, v: 0 };
const subs = new Set<() => void>();
export function setPayOverlay(tenantId: string | null, byId: Record<string, any>) { store = { tenantId, byId, v: store.v + 1 }; subs.forEach((f) => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function usePayOverlay(): Store { const [s, set] = useState(store); useEffect(() => { set(store); return subscribe(() => set(store)); }, []); return s; }

const COL = /^tenants\/([^/]+)\/staff$/; const DOC = /^tenants\/([^/]+)\/staff\/([^/]+)$/;
export function overlayList<T>(path: string | null, data: T[] | null, s: Store): T[] | null {
  if (!data || !path || !s.tenantId) return data; const m = path.match(COL); if (!m || m[1] !== s.tenantId) return data;
  return data.map((x: any) => mergePay(x, s.byId[x?.id]));
}
export function overlayDoc<T>(path: string | null, data: T | null, s: Store): T | null {
  if (!data || !path || !s.tenantId) return data; const m = path.match(DOC); if (!m || m[1] !== s.tenantId) return data;
  return mergePay(data as any, s.byId[m[2]]);
}
