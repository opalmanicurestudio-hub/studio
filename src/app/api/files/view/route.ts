// src/app/api/files/view/route.ts
//
// OPEN A PRIVATE CLIENT FILE — staff only, five minutes at a time.
//
// Client uploads (photo IDs, intake forms, client photos) are stored private.
// The app keeps a reference like /api/files/view?t=<tenant>&p=<path>; when a
// signed-in team member opens it, the app POSTs here with their sign-in
// token, and gets back a link that works for five minutes. A link that leaks
// stops working; a person who isn't on the team gets nothing.

import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.t || body.tenantId || '').trim();
  const path = String(body.p || '').trim();
  if (!tenantId || !path) return NextResponse.json({ ok: false, error: 'Missing file.' }, { status: 400 });
  // Only this business's private client files — nothing else in the bucket.
  // Admissions documents and the student file (IDs etc.): owners and managers only.
  const isAdmissionsDoc = path.startsWith(`tenants/${tenantId}/academy/admissions/`) || path.startsWith(`tenants/${tenantId}/academy/files/`);
  const isAcademyPhoto = path.startsWith(`tenants/${tenantId}/academy/attendance/`) || path.startsWith(`tenants/${tenantId}/academy/clinic/`) || path.startsWith(`tenants/${tenantId}/academy/submissions/`) || isAdmissionsDoc;
  if ((!path.startsWith(`tenants/${tenantId}/completions/`) && !isAcademyPhoto) || path.includes('..')) return NextResponse.json({ ok: false, error: 'Not a file you can open here.' }, { status: 403 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  // Applicants' documents (IDs, diplomas): owners and managers only.
  if (isAdmissionsDoc && !auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only managers can open admissions documents.' }, { status: 403 });
  // Clock-in photos: owners, managers and instructors only.
  if (isAcademyPhoto && !auth.actor.isManager && !auth.actor.isTenantOwner && String(auth.actor.role || '').toLowerCase() !== 'instructor') return NextResponse.json({ ok: false, error: 'Only instructors and managers can see clock-in photos.' }, { status: 403 });
  try {
    // Same admin app and bucket as the upload route that stored the file.
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getStorage } = await import('firebase-admin/storage');
    let app: any = getApps().find((a: any) => a.name === 'admin');
    if (!app) {
      const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
      app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey } as any), storageBucket: process.env.FIREBASE_STORAGE_BUCKET }, 'admin');
    }
    const storage: any = getStorage(app);
    const name = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const bucket = name ? storage.bucket(name) : storage.bucket();
    const [url] = await bucket.file(path).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json({ ok: true, url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'That file could not be opened.' }, { status: 404 });
  }
}

export async function GET() {
  return new NextResponse('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 24px"><h1 style="font-weight:500;font-size:20px">Private file</h1><p style="color:#57534e">Client files are private. Open this from the appointment in the app, while signed in.</p></body>', { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
