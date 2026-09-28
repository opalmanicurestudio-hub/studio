// src/lib/staff-fetch.ts — the signed-in staff member's proof, for routes that
// must only act for staff (charging a saved card, staff bookings).
import { getAuth } from 'firebase/auth';

export async function staffAuthHeader(): Promise<Record<string, string>> {
  try { const t = await getAuth().currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
