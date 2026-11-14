// src/app/api/printer/epson/[tenantId]/[printerId]/[key]/route.ts — AN EPSON PRINTER ON SERVER DIRECT PRINT
// (lib/printing-server). The printer is given this address once (Printers settings) and from then on asks every few
// seconds, as a form:
//   ConnectionType=GetRequest  → nothing (an empty answer), or one slip as ePOS-Print XML in a PrintRequestInfo.
//   ConnectionType=SetResponse → how it went (ResponseFile): printed, or not (tried again a few times).
// No sign-in: the address itself, with its secret key, is the printer's pass. A wrong one is told nothing.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renderEpos } from '@/lib/printing';
import { fromOf, heard, jobDone, jobOf, inMemory, keyOk, missed, nextJob, printerOf, tooManyMisses } from '@/lib/printing-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Ctx = { params: Promise<{ tenantId: string; printerId: string; key: string }> };
const empty = () => new NextResponse(null, { status: 200, headers: { 'Content-Length': '0' } });

export async function POST(req: NextRequest, ctx: Ctx) {
  const { tenantId, printerId, key } = await ctx.params;
  const from = fromOf(req);
  if (!ID.test(tenantId) || !ID.test(printerId)) return new NextResponse(null, { status: 404 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const known = inMemory(T, printerId); if (!known && tooManyMisses(from)) return new NextResponse(null, { status: 404 });
  const p = await printerOf(db, T, printerId);
  if (!p && !known) missed(from);
  if (!keyOk(p, key) || p.kind !== 'epson') return new NextResponse(null, { status: 404 });
  const form = new URLSearchParams(await req.text().catch(() => ''));
  const kind = form.get('ConnectionType');
  if (kind === 'SetResponse') {
    const xml = String(form.get('ResponseFile') || '');
    const jobId = (xml.match(/<printjobid>([^<]{1,160})<\/printjobid>/) || [])[1] || null;
    const ok = /success="true"/.test(xml);
    const code = (xml.match(/code="([^"]{0,60})"/) || [])[1] || '';
    // How it went is kept with the slip (and the printer's "last slip didn't print"), not as its status.
    await jobDone(db, T, p, jobId && ID.test(jobId) ? jobId : null, ok, code || (ok ? 'OK' : 'Not printed'));
    return empty();
  }
  if (kind !== 'GetRequest') return empty();
  await heard(db, T, p, '200 OK', null).catch(() => null);
  const j = await nextJob(db, T, async () => (await db.doc(T).get()).data() || {}, p).catch((e) => { console.error('[printer epson] next', e); return null; });
  const job = j ? await jobOf(db, T, p, j.id) : null;
  if (!job) return empty();
  const xml = `<?xml version="1.0" encoding="utf-8"?><PrintRequestInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><timeout>10000</timeout><printjobid>${job.id}</printjobid></Parameter><PrintData>${renderEpos(job.doc, p.cols)}</PrintData></ePOSPrint></PrintRequestInfo>`;
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}
