/**
 * API Route: POST /api/completion/upload-file
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts a multipart/form-data upload from the PUBLIC completion page.
 * Uses the Firebase Admin SDK server-side to write to Storage, bypassing
 * Storage security rules (same approach as /api/inquiry/upload-image).
 *
 * File: src/app/api/completion/upload-file/route.ts
 *
 * Requires the same env vars you already use for inquiry uploads:
 *   FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL,
 *   FIREBASE_ADMIN_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

// Lazy-initialize Firebase Admin (shares the named 'admin' app with the inquiry route)
let adminApp: any = null;
let adminStorage: any = null;

async function getAdminStorage() {
    if (adminStorage) return adminStorage;
    try {
        const { initializeApp, getApps, cert } = await import('firebase-admin/app');
        const { getStorage } = await import('firebase-admin/storage');

        if (!getApps().length) {
            adminApp = initializeApp({
                credential: cert({
                    projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                    privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                }),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            }, 'admin');
        } else {
            adminApp = getApps().find(a => a.name === 'admin') || getApps()[0];
        }

        adminStorage = getStorage(adminApp);
        return adminStorage;
    } catch (e) {
        console.error('Firebase Admin init error:', e);
        return null;
    }
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

        const storage = await getAdminStorage();
        if (!storage) {
            return NextResponse.json({ error: 'Storage not available' }, { status: 500 });
        }

        const ext       = file.name.split('.').pop() || 'bin';
        const filename   = `${nanoid()}.${ext}`;
        const safeToken  = (token || 'misc').replace(/[^A-Za-z0-9_-]/g, '');
        const safeReq    = reqId.replace(/[^A-Za-z0-9_-]/g, '');
        const path       = `tenants/${tenantId}/completions/${safeToken}/${safeReq}/${filename}`;

        const bucket  = storage.bucket();
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