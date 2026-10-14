// src/app/api/creator-campaigns/upload/route.ts — a creator's screenshot of their post's views, uploaded from their own
// visit link (the visit link is the key; only creators can upload). Images only, up to 8 MB. Firebase Admin storage.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
/** The same named Admin app and explicit bucket the visit link's other uploads use (api/completion/upload-file). */
async function adminBucket() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app'); const { getStorage } = await import('firebase-admin/storage');
  let app: any = getApps().find((a: any) => a.name === 'admin');
  if (!app) { const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID; const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL; const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin credentials missing.');
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), storageBucket: process.env.FIREBASE_STORAGE_BUCKET }, 'admin'); }
  const st = getStorage(app); return process.env.FIREBASE_STORAGE_BUCKET ? st.bucket(process.env.FIREBASE_STORAGE_BUCKET) : st.bucket();
}
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData(); const file = fd.get('file') as File | null; const token = String(fd.get('token') || '');
    if (!file || !/^[A-Za-z0-9_-]{6,80}$/.test(token)) return j({ ok: false, error: 'Missing details.' }, 400);
    if (!String(file.type || '').startsWith('image/')) return j({ ok: false, error: 'Please choose a photo or screenshot.' }, 400);
    if (file.size > 8 * 1024 * 1024) return j({ ok: false, error: 'That image is too large (8 MB at most).' }, 400);
    const db = getAdminDb(); const ci: any = (await db.doc(`appointmentCheckIns/${token}`).get()).data() || null;
    if (!ci?.tenantId || !(ci.id || ci.appointmentId)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const t = String(ci.tenantId); const a: any = (await db.doc(`tenants/${t}/appointments/${String(ci.id || ci.appointmentId)}`).get()).data() || null;
    if (!a?.clientId || (a.checkInToken && a.checkInToken !== token)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const cl: any = (await db.doc(`tenants/${t}/clients/${a.clientId}`).get()).data() || {}; if (!cl.circle?.creator?.code) return j({ ok: false, error: 'Only creators can hand in.' }, 403);
    const bucket = await adminBucket();
    const ext = (String(file.type).split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
    const path = `tenants/${t}/creator-handins/${a.clientId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const dl = crypto.randomUUID(); const f = bucket.file(path);
    await f.save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: dl } } });
    return j({ ok: true, url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${dl}` });
  } catch (e: any) { console.error('[creator-campaigns/upload]', e); return j({ ok: false, error: 'That didn’t upload. Please try again.' }, 500); }
}
