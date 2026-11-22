// src/app/api/printer/star/[tenantId]/[printerId]/[key]/route.ts — A STAR PRINTER ON CLOUDPRNT (lib/printing-server).
// The printer is given this address once (Printers settings) and from then on asks every few seconds:
//   POST   → "anything for me?" with what it says about itself; told { jobReady, mediaTypes, jobToken }.
//   GET    → the slip, as plain text at its width (cut after, the buzzer for a new ticket).
//   DELETE → done: code "200 OK" printed, anything else didn't (tried again a few times). Some set-ups confirm with a
//            GET carrying `delete` instead.
// No sign-in: the address itself, with its secret key, is the printer's pass. A wrong one is told nothing.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renderText } from '@/lib/printing';
import { dec, fromOf, heard, jobDone, jobOf, inMemory, keyOk, missed, nextJob, printerOf, tooManyMisses } from '@/lib/printing-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Ctx = { params: Promise<{ tenantId: string; printerId: string; key: string }> };
const none = () => new NextResponse(null, { status: 404 });

async function auth(req: NextRequest, ctx: Ctx) {
  const { tenantId, printerId, key } = await ctx.params; const from = fromOf(req);
  if (!ID.test(tenantId) || !ID.test(printerId)) return null;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const known = inMemory(T, printerId); if (!known && tooManyMisses(from)) return null;
  const p = await printerOf(db, T, printerId);
  if (!p && !known) missed(from);
  if (!keyOk(p, key) || p.kind !== 'star') return null;
  return { db, T, p };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const a = await auth(req, ctx); if (!a) return none();
  const b: any = await req.json().catch(() => ({}));
  await heard(a.db, a.T, a.p, typeof b.statusCode === 'string' ? b.statusCode : null, typeof b.printerMAC === 'string' ? b.printerMAC : null).catch(() => null);
  // Busy printing, or something's wrong with it: nothing new until it's ready.
  if (b.printingInProgress === true || !/^2/.test(dec(String(b.statusCode || '200'))) || /^220/.test(dec(String(b.statusCode || '')))) return NextResponse.json({ jobReady: false });
  const j = await nextJob(a.db, a.T, async () => (await a.db.doc(a.T).get()).data() || {}, a.p).catch((e) => { console.error('[printer star] next', e); return null; });
  return NextResponse.json(j ? { jobReady: true, mediaTypes: ['text/plain'], jobToken: j.id } : { jobReady: false });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const a = await auth(req, ctx); if (!a) return none();
  const q = req.nextUrl.searchParams; const token = q.get('token');
  if (q.has('delete')) { await jobDone(a.db, a.T, a.p, token, /^(2|OK)/i.test(dec(q.get('code') || '')), q.get('code') || ''); return new NextResponse(null, { status: 200 }); }
  const type = q.get('type');
  if (type && !/^text\/plain/i.test(type)) return new NextResponse(null, { status: 415 });
  const j = await jobOf(a.db, a.T, a.p, token); if (!j) return none();
  const headers: Record<string, string> = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' };
  // (Nothing to print, only the cash drawer to open: no cut, and only a few blank lines feed.)
  if (j.doc?.blocks?.length) headers['X-Star-Cut'] = 'partial; feed=true';
  if (j.doc?.buzz && a.p.buzz) headers['X-Star-Buzzerstartpattern'] = '1';
  // A cash sale's drawer, plugged into this printer (lib/printing receiptDoc, drawerDoc).
  if (j.doc?.drawer && a.p.drawer) headers['X-Star-Cashdrawer'] = 'start';
  return new NextResponse(renderText(j.doc, a.p.cols), { status: 200, headers });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const a = await auth(req, ctx); if (!a) return none();
  const q = req.nextUrl.searchParams;
  await jobDone(a.db, a.T, a.p, q.get('token'), /^(2|OK)/i.test(dec(q.get('code') || '')), q.get('code') || '');
  return new NextResponse(null, { status: 200 });
}
