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
        // Permanent domain, automatically: manual override → Vercel's
        // production-domain env var → the request's origin as last resort.
        const base = String(
          (t.data() as any)?.publicOrigin
          || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
          || origin || '').replace(/\/+$/, '');
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

// NOTE on buckets: the admin SDK only knows its default bucket when the
// app was initialized with { storageBucket } — many setups aren't, and
// getStorage().bucket() then throws "Bucket name not specified", which
// used to surface as "photo upload is not available". The uploader below
// therefore tries every plausible bucket in order: the app default, the
// server env, the client env (always present — it's in the web config),
// and both Firebase bucket-naming conventions derived from the project id.

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

    // A token in the URL makes the file readable via the standard Firebase
    // download URL WITHOUT opening Storage rules — the same mechanism
    // client getDownloadURL uses. Both bucket-naming conventions are tried:
    // older projects use {id}.appspot.com, newer ones {id}.firebasestorage.app.
    const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Hunt the project id EVERYWHERE it can live — env vars, the admin
    // app's options, its service-account credential, and the service-
    // account JSON itself. Projects whose Firebase config is hardcoded in
    // source (not env) have NONE of the NEXT_PUBLIC_* vars server-side,
    // which is why "no storage bucket exists" fired even though the
    // bucket is right there.
    // GROUND TRUTH FIRST: the tenant doc carries the bucket's real name,
    // recorded automatically by the Booth Hub from the browser's Firebase
    // config (the browser has always known it — that's why client uploads
    // work). Everything after this is fallback guessing.
    let tenantBucket: string | null = null;
    try {
      const { getAdminDb } = await import('./firebase-admin');
      const tSnap = await getAdminDb().doc(`tenants/${tenantId}`).get();
      tenantBucket = String((tSnap.data() as any)?.storageBucket || '') || null;
    } catch { /* keep hunting */ }
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
    let appBucket: string | null = null;
    try {
      const { getApps } = await import('firebase-admin/app');
      const opts: any = getApps()[0]?.options || {};
      appBucket = opts.storageBucket || null;
      if (!projectId) projectId = opts.projectId || opts.credential?.projectId || '';
    } catch { /* keep hunting */ }
    if (!projectId) {
      try {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
        if (sa.project_id) projectId = sa.project_id;
      } catch { /* not JSON — fine */ }
    }
    const names: (string | null)[] = [
      tenantBucket, // ground truth, self-recorded from the working client
      null, // the app's default bucket
      process.env.FIREBASE_STORAGE_BUCKET || null,
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
      appBucket,
      projectId ? `${projectId}.firebasestorage.app` : null,
      projectId ? `${projectId}.appspot.com` : null,
    ];
    const tried = new Set<string>();
    let lastErr: any = null;
    for (const name of names) {
      if (name !== null && tried.has(name)) continue;
      if (name !== null) tried.add(name);
      try {
        const bucket = name === null ? getStorage().bucket() : getStorage().bucket(name);
        await bucket.file(path).save(buf, {
          contentType: mime,
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        return { url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}` };
      } catch (err) { lastErr = err; }
    }
    console.error('[maintenance] photo upload failed on every bucket candidate', Array.from(tried), lastErr);
    // Show WHICH names were tried — comparing this list against the real
    // gs:// name in the Firebase console makes the fix self-evident.
    const triedNote = tried.size > 0 ? ` Tried: ${Array.from(tried).join(', ')}.` : ' No bucket name could be resolved at all.';
    return { url: null, error: `${describeUploadError(lastErr)}${triedNote}` };
  } catch (err: any) {
    console.error('[maintenance] photo upload failed', err);
    return { url: null, error: describeUploadError(err) };
  }
}

// Turn opaque storage failures into a message that tells the OWNER what to
// fix (techs just relay it). The three real-world causes, in order of how
// often they happen: Storage was never enabled in the Firebase console, the
// service account lacks storage permission, or the bucket name is wrong.
function describeUploadError(err: any): string {
  const msg = String(err?.message || err || '');
  const code = Number((err as any)?.code) || 0;
  if (code === 404 || /not exist|notfound|not found/i.test(msg)) {
    return 'Photo not saved: the server could not find the storage bucket. Fix: the studio opens their Booth Hub once (it records the bucket automatically), then try again.';
  }
  if (code === 403 || /permission|forbidden|unauthorized/i.test(msg)) {
    return 'Photo not saved: the server is not allowed to write to storage — give the Firebase service account the "Storage Admin" role.';
  }
  return 'Photo not saved — the rest of your update went through. (Ask the studio to check the maintenance function logs.)';
}
