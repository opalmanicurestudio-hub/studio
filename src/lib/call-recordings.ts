// src/lib/call-recordings.ts — CALL RECORDINGS KEPT IN THE BUSINESS'S OWN STORAGE.
// The call provider hosts recordings for a limited time. When a call ends we copy the recording into our storage
// (private: no public link) and play it back through /api/calls/recording for signed-in staff only.

async function bucketNames(db: any, tenantId: string): Promise<(string | null)[]> {
  let tenantBucket: string | null = null;
  try { tenantBucket = String(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.storageBucket || '') || null; } catch { /* keep looking */ }
  let projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  let appBucket: string | null = null;
  try { const { getApps } = await import('firebase-admin/app'); const o: any = getApps()[0]?.options || {}; appBucket = o.storageBucket || null; if (!projectId) projectId = o.projectId || ''; } catch { /* keep looking */ }
  return [tenantBucket, null, process.env.FIREBASE_STORAGE_BUCKET || null, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null, appBucket,
    projectId ? `${projectId}.firebasestorage.app` : null, projectId ? `${projectId}.appspot.com` : null];
}
async function bucket(name: string | null) { const { getAdminStorage } = await import('@/lib/firebase-admin'); const s: any = getAdminStorage(); return name ? s.bucket(name) : s.bucket(); }

/** Copy a call's recording into our storage. Best-effort: the provider's link stays on the call either way. */
export async function archiveRecording(db: any, tenantId: string, callId: string, url: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!/^https:\/\//.test(String(url || ''))) return { ok: false, error: 'No recording link.' };
  const ref = db.doc(`tenants/${tenantId}/voiceCalls/${callId}`); const cur: any = (await ref.get()).data() || {};
  if (cur.recordingPath) return { ok: true, path: cur.recordingPath };
  const res = await fetch(url).catch(() => null as any);
  if (!res?.ok) return { ok: false, error: `Could not download the recording (${res?.status || 'no response'}).` };
  const type = res.headers.get('content-type') || 'audio/wav'; const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 60 * 1024 * 1024) return { ok: false, error: 'The recording was empty or too large.' };
  const ext = /mpeg|mp3/.test(type) ? 'mp3' : /ogg/.test(type) ? 'ogg' : 'wav';
  const path = `tenants/${tenantId}/calls/${callId.replace(/[^\w-]/g, '')}.${ext}`;
  const tried = new Set<string>(); let lastErr: any = null;
  for (const name of await bucketNames(db, tenantId)) {
    const key = name || '(default)'; if (tried.has(key)) continue; tried.add(key);
    try {
      const b = await bucket(name); await b.file(path).save(buf, { contentType: type, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
      await ref.set({ recordingPath: path, recordingBucket: b.name, recordingType: type, recordingArchivedAt: new Date().toISOString() }, { merge: true });
      return { ok: true, path };
    } catch (e) { lastErr = e; }
  }
  await ref.set({ recordingArchiveError: String(lastErr?.message || lastErr || 'No storage bucket').slice(0, 200) }, { merge: true });
  return { ok: false, error: 'Storage was not available.' };
}

/** The recording's bytes, for playback to signed-in staff. Falls back to the provider's link if we have no copy. */
export async function readRecording(db: any, tenantId: string, callId: string): Promise<{ buf?: Buffer; type?: string; url?: string } | null> {
  const c: any = (await db.doc(`tenants/${tenantId}/voiceCalls/${callId}`).get()).data(); if (!c) return null;
  if (c.recordingPath) {
    try { const b = await bucket(c.recordingBucket || null); const [buf] = await b.file(c.recordingPath).download(); return { buf, type: c.recordingType || 'audio/wav' }; } catch { /* fall back */ }
  }
  return c.recordingUrl ? { url: c.recordingUrl } : null;
}
