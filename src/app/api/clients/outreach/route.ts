// src/app/api/clients/outreach/route.ts — "Why we reached out" for one client (lib/outreach-history). The team can read it.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { outreachTimeline } from '@/lib/outreach-history';

export const dynamic = 'force-dynamic';
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const clientId = String(b.clientId || '').slice(0, 120);
  const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny; if (!clientId) return NextResponse.json({ ok: false, error: 'Missing client.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const safe = (p: Promise<any>) => p.then(rows).catch(() => []);
  const [messages, opportunities, calls] = await Promise.all([safe(db.collection(`${T}/messageLog`).where('clientId', '==', clientId).get()), safe(db.collection(`${T}/opportunities`).where('clientId', '==', clientId).get()), safe(db.collection(`${T}/voiceCalls`).where('clientId', '==', clientId).get())]);
  const client: any = (await db.doc(`${T}/clients/${clientId}`).get()).data() || {};
  return NextResponse.json({ ok: true, items: outreachTimeline({ messages, opportunities, calls }), optedOut: client.smsOptOut === true || client.marketingOptOut === true, marketing: client.marketingConsent === true || client.smsMarketingConsent === true });
}
