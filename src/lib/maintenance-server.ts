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
import { pickRotationWorker } from './maintenance';

// ── AUTO-ROTATION (server side) ──────────────────────────────────────
// When the owner enables rotation (tenants/{id}.maintenanceAutoAssign ===
// 'rotate'), any ticket that arrives WITHOUT an assignee is handed to the
// least-recently-assigned active worker: the ticket is stamped, the
// worker's rotation cursor bumps, a system note lands on the thread, and
// the worker gets a text (when SMS is configured). Fail-soft: any error
// leaves the ticket unassigned for manual triage — never blocks creation.
export async function autoAssignTicket(
  db: any,
  tenantId: string,
  ticketId: string,
  ticket: { title: string; boothName?: string | null; priority?: string },
  origin?: string,
): Promise<{ assigneeId: string; assigneeName: string } | null> {
  try {
    const t = await db.doc(`tenants/${tenantId}`).get();
    if ((t.data() as any)?.maintenanceAutoAssign !== 'rotate') return null;
    const ws = await db.collection(`tenants/${tenantId}/maintenanceWorkers`).get();
    const pick: any = pickRotationWorker(ws.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })));
    if (!pick) return null;
    const nowIso = new Date().toISOString();
    const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
    const snap = await ref.get();
    const cur = (snap.data() as any) || {};
    if (cur.assigneeId) return null; // someone beat us to it — respect it
    await ref.set({
      assigneeId: pick.id, assigneeName: pick.name,
      assignNotifiedFor: pick.id,
      updates: [...(cur.updates || []), { at: nowIso, by: 'Rotation', byType: 'system', note: `Auto-assigned to ${pick.name}` }],
      updatedAt: nowIso,
    }, { merge: true });
    await db.doc(`tenants/${tenantId}/maintenanceWorkers/${pick.id}`).set({ lastAssignedAt: nowIso }, { merge: true });
    try {
      const { smsConfigured, sendTenantSms } = await import('./sms');
      if (pick.phone && smsConfigured()) {
        // Prefer the tenant's permanent domain — links built on a request's
        // deployment-specific origin die on the next deploy.
        const base = String((t.data() as any)?.publicOrigin || origin || '').replace(/\/+$/, '');
        const link = base ? ` Details: ${base}/maintain/${tenantId}?t=${pick.token}` : '';
        await sendTenantSms(db, tenantId, pick.phone,
          `New ${ticket.priority || 'normal'} ticket assigned to you: "${ticket.title}"${ticket.boothName ? ` at ${ticket.boothName}` : ''}.${link}`);
      }
    } catch { /* text is a bonus */ }
    return { assigneeId: pick.id, assigneeName: pick.name };
  } catch (err) {
    console.error('[maintenance] auto-assign failed', err);
    return null;
  }
}

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
