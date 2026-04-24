/**
 * API Route: POST /api/inquiry/upload-image
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts a multipart/form-data upload from the public inquiry form.
 * Uses the Firebase Admin SDK (server-side) to upload to Storage,
 * bypassing Firebase Storage security rules.
 *
 * File: src/app/api/inquiry/upload-image/route.ts
 *
 * SETUP REQUIRED:
 * 1. Install firebase-admin if not already:
 *    npm install firebase-admin
 *
 * 2. Add to your .env.local:
 *    FIREBASE_ADMIN_PROJECT_ID=your-project-id
 *    FIREBASE_ADMIN_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
 *    FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *    FIREBASE_STORAGE_BUCKET=your-project.appspot.com
 *
 * 3. Get these from Firebase Console → Project Settings → Service Accounts → Generate new private key
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

// Lazy-initialize Firebase Admin to avoid issues with Next.js hot reload
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
            // Find existing admin app or use first app
            adminApp = getApps().find(a => a.name === 'admin') || getApps()[0];
        }

        adminStorage = getStorage(adminApp);
        return adminStorage;
    } catch (e) {
        console.error('Firebase Admin init error:', e);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file      = formData.get('file') as File | null;
        const tenantId  = formData.get('tenantId') as string | null;

        if (!file)     return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

        // Validate file type
        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
        }

        const storage = await getAdminStorage();
        if (!storage) {
            return NextResponse.json({ error: 'Storage not available' }, { status: 500 });
        }

        const ext      = file.name.split('.').pop() || 'jpg';
        const filename = `${nanoid()}.${ext}`;
        const path     = `tenants/${tenantId}/inquiryInspo/${filename}`;

        const bucket    = storage.bucket();
        const fileRef   = bucket.file(path);
        const buffer    = Buffer.from(await file.arrayBuffer());

        await fileRef.save(buffer, {
            metadata: {
                contentType: file.type,
                metadata: { uploadedBy: 'inquiry_form', tenantId },
            },
        });

        // Make file publicly readable
        await fileRef.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;

        return NextResponse.json({ url: publicUrl }, { status: 200 });

    } catch (e: any) {
        console.error('Upload error:', e);
        return NextResponse.json({ error: e.message || 'Upload failed' }, { status: 500 });
    }
}

// Config: allow large bodies for image uploads
export const config = {
    api: { bodyParser: false },
};