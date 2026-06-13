/**
 * API Route: POST /api/completion/upload-file
 * ─────────────────────────────────────────────────────────────────────────────
 * Public completion-page file upload via Firebase Admin (bypasses Storage rules),
 * mirroring /api/inquiry/upload-image.
 *
 * File: src/app/api/completion/upload-file/route.ts
 *
 * Requires (same as inquiry uploads):
 *   FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL,
 *   FIREBASE_ADMIN_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET
 *
 * Unlike the first version, this:
 *  - throws the REAL init error instead of a generic "Storage not available"
 *  - looks up its own named admin app specifically (not getApps()[0])
 *  - passes the bucket name explicitly, so it does not depend on an app default
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

const APP_NAME = 'admin';

async function getAdminStorage() {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getStorage } = await import('firebase-admin/storage');

    const existing = getApps().find((a: any) => a.name === APP_NAME);
    let app = existing;

    if (!app) {
        const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
        const privateKey  = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
        if (!projectId || !clientEmail || !privateKey) {
            throw new Error('Firebase Admin credentials missing - set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in Vercel.');
        }
        app = initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        }, APP_NAME);
    }

    return getStorage(app);
}

function resolveBucket(storage: any) {
    const name = process.env.FIREBASE_STORAGE_BUCKET;
    if (name) return storage.bucket(name);            // explicit - most reliable
    return storage.bucket();                           // default (requires app storageBucket)
}

const ALLOWED_PREFIXES = ['image/', 'application/pdf'];

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file     = formData.get('file') as File | null;
        const tenantId = formData.get('tenantId') as string | null;
        const token    = formData.get('token') as string | null;
        const reqId    = (formData.get('reqId') as string | null) || 'files';

        if (!file)     return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

        if (!ALLOWED_PREFIXES.some(p => file.type.startsWith(p))) {
            return NextResponse.json({ error: 'Only images or PDF files are allowed' }, { status: 400 });
        }
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
        }

        let storage: any;
        try {
            storage = await getAdminStorage();
        } catch (initErr: any) {
            return NextResponse.json({ error: initErr.message || 'Storage init failed' }, { status: 500 });
        }

        let bucket: any;
        try {
            bucket = resolveBucket(storage);
        } catch (bErr: any) {
            return NextResponse.json({ error: `Storage bucket unavailable - check FIREBASE_STORAGE_BUCKET. (${bErr.message})` }, { status: 500 });
        }

        const ext       = file.name.split('.').pop() || 'bin';
        const filename   = `${nanoid()}.${ext}`;
        const safeToken  = (token || 'misc').replace(/[^A-Za-z0-9_-]/g, '');
        const safeReq    = reqId.replace(/[^A-Za-z0-9_-]/g, '');
        const path       = `tenants/${tenantId}/completions/${safeToken}/${safeReq}/${filename}`;

        const fileRef = bucket.file(path);
        const buffer  = Buffer.from(await file.arrayBuffer());

        await fileRef.save(buffer, {
            metadata: {
                contentType: file.type,
                metadata: { uploadedBy: 'completion_page', tenantId, token: token || '' },
            },
        });

        await fileRef.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;
        return NextResponse.json({ url: publicUrl, name: file.name }, { status: 200 });

    } catch (e: any) {
        console.error('Completion upload error:', e);
        return NextResponse.json({ error: e.message || 'Upload failed' }, { status: 500 });
    }
}

export const config = {
    api: { bodyParser: false },
};