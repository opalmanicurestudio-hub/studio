// src/lib/maintenance-server.ts
//
// SERVER-ONLY maintenance helpers (imported by API routes — never by
// 'use client' files; it pulls in firebase-admin).
//
// Photo uploads from ANONYMOUS surfaces (the token-authed tech portal and
// the session-authed renter portal) can't use client Firebase Storage —
// those users have no Firebase Auth, and opening Storage to public writes
// would be worse. So photos travel as small base64 data URLs to the API
// route, which validates and uploads them with Admin credentials and
// returns a long-lived download URL.
//
// Fail-soft everywhere: a photo that can't upload never blocks the note,
// the status change, or the ticket — callers get null and continue.

import { getStorage } from 'firebase-admin/storage';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 MB decoded — phone photos compress well below this
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface PhotoUploadResult { url: string | null; error?: string }

// dataUrl: "data:image/jpeg;base64,...."
export async function uploadTicketPhotoFromDataUrl(
  tenantId: string,
  ticketId: string,
  dataUrl: any,
): Promise<PhotoUploadResult> {
  try {
    const s = String(dataUrl || '');
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(s);
    if (!m) return { url: null, error: 'Not a valid image.' };
    const mime = m[1].toLowerCase();
    if (!ALLOWED.has(mime)) return { url: null, error: 'Use a JPG, PNG, WebP, or GIF.' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) return { url: null, error: 'Empty image.' };
    if (buf.length > MAX_PHOTO_BYTES) return { url: null, error: 'Photo too large — keep it under 3 MB.' };

    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const path = `tenants/${tenantId}/tickets/${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Default bucket from the admin app's options. A token in the URL makes
    // the file readable via the standard Firebase download URL WITHOUT
    // opening Storage rules — the same mechanism client getDownloadURL uses.
    const bucket = getStorage().bucket();
    const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const file = bucket.file(path);
    await file.save(buf, {
      contentType: mime,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { url };
  } catch (err: any) {
    console.error('[maintenance] photo upload failed', err);
    return { url: null, error: 'Photo upload is not available right now — the rest of your update was saved.' };
  }
}
