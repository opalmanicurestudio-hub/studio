// The web service Apple Wallet calls for rewards cards (lib/wallet): register / unregister a device, list the cards that
// changed, send the newest card, and log. https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { appleToken, parseSerial, cardFacts, applePass, walletConfig } from '@/lib/wallet';

export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
type Ctx = { params: Promise<{ path: string[] }> };
const authed = (req: NextRequest, serial: string) => (req.headers.get('authorization') || '') === `ApplePass ${appleToken(serial)}`;
const ok = (status = 200) => new NextResponse(null, { status });
const typeOk = (p: string) => p === process.env.APPLE_PASS_TYPE_ID;

async function reg(req: NextRequest, ctx: Ctx, del: boolean) {
  const [, deviceId, , passType, serial] = (await ctx.params).path; if (!walletConfig().apple || !typeOk(passType) || !serial || !authed(req, serial)) return ok(401);
  const db = getAdminDb(); const ref = db.doc(`walletDevices/${String(deviceId).slice(0, 100)}__${serial}`); const s = parseSerial(serial); if (!s) return ok(400);
  if (del) { await ref.delete().catch(() => {}); return ok(200); }
  const b: any = await req.json().catch(() => ({})); const had = (await ref.get()).exists;
  await ref.set({ deviceId: String(deviceId).slice(0, 100), serial, tenantId: s.t, clientId: s.c, pushToken: String(b.pushToken || '').slice(0, 200), updatedAt: new Date().toISOString() }, { merge: true });
  await db.doc(`tenants/${s.t}/clients/${s.c}`).set({ wallet: { apple: true } }, { merge: true }).catch(() => {});
  return ok(had ? 200 : 201);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const p = (await ctx.params).path;
  if (p[0] === 'log') { const b: any = await req.json().catch(() => ({})); console.log('[wallet] apple log', JSON.stringify(b?.logs || []).slice(0, 800)); return ok(200); }
  if (p[0] === 'devices' && p[2] === 'registrations' && p.length === 5) return reg(req, ctx, false);
  return ok(404);
}
export async function DELETE(req: NextRequest, ctx: Ctx) { const p = (await ctx.params).path; return p[0] === 'devices' && p.length === 5 ? reg(req, ctx, true) : ok(404); }
export async function GET(req: NextRequest, ctx: Ctx) {
  const p = (await ctx.params).path; const db = getAdminDb(); if (!walletConfig().apple) return ok(404);
  if (p[0] === 'devices' && p[2] === 'registrations' && p.length === 4 && typeOk(p[3])) {   // which of this device's cards changed
    const since = Date.parse(String(req.nextUrl.searchParams.get('passesUpdatedSince') || '')) || 0;
    const regs = (await db.collection('walletDevices').where('deviceId', '==', String(p[1]).slice(0, 100)).get()).docs.map((d: any) => d.data());
    const changed: string[] = []; let latest = since;
    for (const r of regs) { const c: any = (await db.doc(`tenants/${r.tenantId}/clients/${r.clientId}`).get()).data() || {}; const u = Date.parse(String(c.loyalty?.updatedAt || '')) || 0; if (u > since) { changed.push(r.serial); latest = Math.max(latest, u); } }
    return changed.length ? NextResponse.json({ serialNumbers: changed, lastUpdated: new Date(latest).toISOString() }) : ok(204);
  }
  if (p[0] === 'passes' && p.length === 3 && typeOk(p[1])) {   // the newest card
    const serial = p[2]; if (!authed(req, serial)) return ok(401); const s = parseSerial(serial); if (!s) return ok(404);
    const f = await cardFacts(db, s.t, s.c); if (!f) return ok(404);
    const ims = Date.parse(String(req.headers.get('if-modified-since') || '')) || 0; if (ims && Date.parse(f.updatedAt) <= ims) return ok(304);
    const tenant: any = (await db.doc(`tenants/${s.t}`).get()).data() || {}; const { linkOrigin } = await import('@/lib/app-origin');
    const buf = await applePass(f, serial, linkOrigin(tenant, '') || req.nextUrl.origin);
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.apple.pkpass', 'Last-Modified': new Date(Date.parse(f.updatedAt) || Date.now()).toUTCString(), 'Cache-Control': 'no-store' } });
  }
  return ok(404);
}
