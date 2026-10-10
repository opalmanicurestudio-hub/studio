'use client';
// src/components/pay/pay-client.ts — small helpers the pay screens share: signed-in fetches, money, dates, downloads.
import { getAuth } from 'firebase/auth';
export const money = (v: number) => `${v < 0 ? '– ' : ''}$${Math.abs(Math.round((v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money0 = (v: number) => `$${Math.round(v || 0).toLocaleString('en-US')}`;
export const dshort = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
export const dlong = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
async function token() { try { return (await getAuth().currentUser?.getIdToken()) || ''; } catch { return ''; } }
export async function payGet(path: string) {
  const tk = await token();
  return fetch(path, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
}
export async function payPost(path: string, body: any) {
  const tk = await token();
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
}
/** Download the stub PDF (signed-in fetch → file). */
export async function downloadStub(tenantId: string, from: string, staffId?: string) {
  const tk = await token();
  const r = await fetch(`/api/pay/stub-pdf?tenantId=${encodeURIComponent(tenantId)}&from=${from}${staffId ? `&staffId=${encodeURIComponent(staffId)}` : ''}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
  if (!r.ok) throw new Error('That didn’t download — try again.');
  const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `pay-stub-${from}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export const PART_COLORS = (accent: string): Record<string, string> => ({ services: accent, tips: '#f59e0b', retail: '#55585e', time: '#c7cad1', other: '#9a9ca1', adjustments: '#1f6b3a' });
export const PART_LABEL: Record<string, string> = { services: 'Services', tips: 'Tips', retail: 'Retail', time: 'Time', other: 'Other', adjustments: 'Adjustments' };
