// src/lib/academy.ts
//
// THE ACADEMY — online courses any business on ClarityFlow can sell.
//
// Data (all under the business, all read/written by the server):
//   tenants/{t}/courses/{courseId}                 title, slug, price, status…
//   tenants/{t}/courses/{courseId}/lessons/{id}    module, order, kind, content, video
//   tenants/{t}/students/{studentId}               one per email, per business
//   tenants/{t}/enrollments/{courseId}_{studentId} progress, last lesson, payment
//   tenants/{t}/studentSessions/{sha256(token)}    30-day sign-ins (email link)
//   tenants/{t}/studentLogins/{sha256(token)}      30-minute email-link tokens
//
// Video: Mux (MUX_TOKEN_ID / MUX_TOKEN_SECRET). Videos are uploaded straight
// from the browser to Mux and stored as SIGNED: each play needs a token that
// only an enrolled student (or a preview lesson) gets, valid for 6 hours.
// Signing uses MUX_SIGNING_KEY_ID / MUX_SIGNING_KEY_PRIVATE. Until Mux is set
// up, a lesson can use a video link (private Vimeo / unlisted YouTube).

import { createHash, randomBytes, createSign } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';

export const RESERVED_SLUGS = ['my', 'welcome'];
export const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const slugify = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'course';
export const studentIdFor = (email: string) => sha(String(email).trim().toLowerCase()).slice(0, 24);

// ── Mux ──────────────────────────────────────────────────────────────────
export const muxConfigured = () => !!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
export const muxSigningReady = () => !!(process.env.MUX_SIGNING_KEY_ID && process.env.MUX_SIGNING_KEY_PRIVATE);

async function mux(path: string, init: RequestInit = {}) {
  const auth = Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString('base64');
  const r = await fetch(`https://api.mux.com${path}`, { ...init, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.messages?.join(' ') || `Mux error ${r.status}`);
  return d.data;
}

/** A one-time upload URL — the browser PUTs the video file straight to Mux. */
export const CAPTION_LANGUAGES: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', it: 'Italian', de: 'German', auto: 'Detect automatically' };

/** A one-time upload URL — the browser PUTs the video file straight to Mux.
 *  Captions are generated automatically (Mux's speech recognition). */
export async function muxCreateUpload(origin: string, captionLanguage = 'en') {
  const lang = CAPTION_LANGUAGES[captionLanguage] ? captionLanguage : 'en';
  const d = await mux('/video/v1/uploads', { method: 'POST', body: JSON.stringify({ cors_origin: origin, new_asset_settings: { playback_policy: ['signed'], video_quality: 'basic',
    inputs: [{ generated_subtitles: [{ language_code: lang, name: `${CAPTION_LANGUAGES[lang] === 'Detect automatically' ? 'Captions' : CAPTION_LANGUAGES[lang]} (generated)` }] }] } }) });
  return { uploadId: d.id as string, url: d.url as string };
}

/** Where an upload is up to: waiting → processing → ready (with its playback id). */
export async function muxUploadStatus(uploadId: string) {
  const up = await mux(`/video/v1/uploads/${uploadId}`);
  if (!up.asset_id) return { status: up.status === 'errored' ? 'errored' : 'uploading' as string };
  const asset = await mux(`/video/v1/assets/${up.asset_id}`);
  const playback = (asset.playback_ids || []).find((p: any) => p.policy === 'signed') || (asset.playback_ids || [])[0];
  const text = (asset.tracks || []).find((t: any) => t.type === 'text' && t.text_source === 'generated_vod');
  return { status: asset.status === 'ready' ? 'ready' : asset.status === 'errored' ? 'errored' : 'processing', assetId: up.asset_id as string, playbackId: playback?.id as string | undefined, durationSec: Math.round(Number(asset.duration) || 0),
    captions: text ? { trackId: text.id as string, status: String(text.status || 'preparing') } : null };
}

/** Add generated captions to a video uploaded before captions were switched on. */
export async function muxAddCaptions(assetId: string, captionLanguage = 'en') {
  const asset = await mux(`/video/v1/assets/${assetId}`);
  if ((asset.tracks || []).some((t: any) => t.type === 'text' && t.text_source === 'generated_vod')) return { already: true };
  const audio = (asset.tracks || []).find((t: any) => t.type === 'audio');
  if (!audio) throw new Error('This video has no sound track to caption.');
  const lang = CAPTION_LANGUAGES[captionLanguage] ? captionLanguage : 'en';
  await mux(`/video/v1/assets/${assetId}/tracks/${audio.id}/generate-subtitles`, { method: 'POST', body: JSON.stringify({ generated_subtitles: [{ language_code: lang, name: `${CAPTION_LANGUAGES[lang]} (generated)` }] }) });
  return { already: false };
}

/** The plain-text transcript of a ready caption track (for the tutor, AI drafts and students). */
export async function muxTranscript(playbackId: string, trackId: string): Promise<string | null> {
  const token = muxPlaybackToken(playbackId, 1);
  for (const url of [`https://stream.mux.com/${playbackId}/text/${trackId}.txt${token ? `?token=${token}` : ''}`, `https://stream.mux.com/${playbackId}/text/${trackId}.vtt${token ? `?token=${token}` : ''}`]) {
    try {
      const r = await fetch(url); if (!r.ok) continue;
      let t = await r.text();
      if (url.includes('.vtt')) t = t.replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^[\d:.]+ --> [\d:.]+.*$/gm, '').replace(/\n{2,}/g, '\n');
      t = t.trim(); if (t) return t.slice(0, 40000);
    } catch { /* try the next form */ }
  }
  return null;
}

/** A signed playback token (JWT, RS256) for one video, valid for 6 hours. */
export function muxPlaybackToken(playbackId: string, hours = 6): string | null {
  if (!muxSigningReady()) return null;
  const kid = String(process.env.MUX_SIGNING_KEY_ID);
  const raw = String(process.env.MUX_SIGNING_KEY_PRIVATE);
  const pem = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64({ sub: playbackId, aud: 'v', exp: Math.floor(Date.now() / 1000) + hours * 3600, kid });
  const signer = createSign('RSA-SHA256'); signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(pem).toString('base64url')}`;
}

// ── Students ─────────────────────────────────────────────────────────────
export async function upsertStudent(tenantId: string, email: string, name?: string | null) {
  const db = getAdminDb();
  const id = studentIdFor(email);
  const ref = db.doc(`tenants/${tenantId}/students/${id}`);
  const cur = ((await ref.get()).data() as any) || null;
  await ref.set({ id, email: email.trim().toLowerCase(), name: name || cur?.name || null, createdAt: cur?.createdAt || new Date().toISOString(), lastSeenAt: new Date().toISOString() }, { merge: true });
  return id;
}

/** A 30-day sign-in for a student. */
export async function createStudentSession(tenantId: string, studentId: string) {
  const token = newToken();
  await getAdminDb().doc(`tenants/${tenantId}/studentSessions/${sha(token)}`).set({ studentId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
  return token;
}

/** A 30-minute link for "email me a sign-in link". */
export async function createLoginLink(tenantId: string, studentId: string) {
  const token = newToken();
  await getAdminDb().doc(`tenants/${tenantId}/studentLogins/${sha(token)}`).set({ studentId, expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), used: false });
  return token;
}

export async function studentFromToken(tenantId: string, token?: string | null): Promise<{ id: string; email: string; name: string | null } | null> {
  if (!token) return null;
  const db = getAdminDb();
  const s = ((await db.doc(`tenants/${tenantId}/studentSessions/${sha(token)}`).get()).data() as any) || null;
  if (!s || new Date(s.expiresAt).getTime() < Date.now()) return null;
  const st = ((await db.doc(`tenants/${tenantId}/students/${s.studentId}`).get()).data() as any) || null;
  return st ? { id: s.studentId, email: st.email, name: st.name || null } : null;
}

// ── Enrolment ────────────────────────────────────────────────────────────
export async function enroll(opts: { tenantId: string; courseId: string; email: string; name?: string | null; paidCents: number; stripeSessionId?: string | null }) {
  const db = getAdminDb();
  const studentId = await upsertStudent(opts.tenantId, opts.email, opts.name);
  const ref = db.doc(`tenants/${opts.tenantId}/enrollments/${opts.courseId}_${studentId}`);
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({ id: ref.id, courseId: opts.courseId, studentId, email: opts.email.trim().toLowerCase(), status: 'active', paidCents: opts.paidCents, stripeSessionId: opts.stripeSessionId || null,
      progress: {}, lastLessonId: null, createdAt: new Date().toISOString() });
    const cRef = db.doc(`tenants/${opts.tenantId}/courses/${opts.courseId}`);
    const c = ((await cRef.get()).data() as any) || {};
    await cRef.set({ enrolledCount: (Number(c.enrolledCount) || 0) + 1, revenueCents: (Number(c.revenueCents) || 0) + (opts.paidCents || 0) }, { merge: true });
  }
  return { studentId, created: !existing.exists };
}

/** Enrol from a paid Stripe Checkout (course purchase). Safe to call twice. */
export async function enrollFromCheckout(tenantId: string, session: any) {
  if (session?.metadata?.type !== 'academy_course' || session.payment_status !== 'paid') return null;
  const email = String(session.metadata.email || session.customer_details?.email || '').trim().toLowerCase();
  if (!email) return null;
  return enroll({ tenantId, courseId: String(session.metadata.courseId), email, name: session.metadata.name || session.customer_details?.name || null, paidCents: Number(session.amount_total) || 0, stripeSessionId: session.id });
}

export async function loadCourseBySlug(tenantId: string, slug: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/courses`).where('slug', '==', slug).limit(1).get();
  return s.empty ? null : ({ id: s.docs[0].id, ...(s.docs[0].data() as any) });
}

export async function loadLessons(tenantId: string, courseId: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/courses/${courseId}/lessons`).limit(500).get();
  return s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
}

/** Turn a pasted video link into something a page can embed (fallback before Mux). */
export function embedUrl(link?: string | null): string | null {
  const u = String(link || '').trim(); if (!u) return null;
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`;
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/(\w+))?/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}${vm[2] ? `?h=${vm[2]}` : ''}`;
  return /^https:\/\//.test(u) ? u : null;
}
