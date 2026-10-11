// src/lib/review-watch.ts — LOW REVIEWS BECOME A FOLLOW-UP. Once a day (and on "Check now"), the business's Google
// listing is read through Google's Places API; a review at or below the business's star line (Settings → Making it
// right → Reviews) that hasn't been seen before is kept in externalReviews and the desk and managers get "Start a case"
// — the case form opens with the reviewer's words and, when the name matches a client, their latest visit.
// Nothing is opened automatically and nothing is posted back to Google.
//
// Limits worth knowing: the Places API returns up to five reviews Google picks as most relevant (often, not always, the
// newest), so a review can be missed. Full access to every review needs the Google Business Profile API (an approved
// Google Cloud project and the owner signing in) — a later step if this isn't enough.
// Needs GOOGLE_PLACES_API_KEY on the server.
import { createHash } from 'crypto';
import { settingsOf } from '@/lib/making-it-right';

const MANAGERS = ['owner', 'admin', 'manager'];
export type ExtReview = { id: string; source: 'google'; rating: number; text: string; author: string; authorUri: string | null; publishedAt: string | null; url: string | null; lang: string | null };

export function parseGoogleReviews(json: any): ExtReview[] {
  return (Array.isArray(json?.reviews) ? json.reviews : []).map((r: any) => {
    const key = String(r.name || `${r.authorAttribution?.displayName}|${r.publishTime}`);
    return { id: createHash('sha1').update(key).digest('hex').slice(0, 24), source: 'google' as const, rating: Math.round(Number(r.rating) || 0),
      text: String(r.originalText?.text || r.text?.text || '').slice(0, 4000), author: String(r.authorAttribution?.displayName || 'A Google user').slice(0, 120),
      authorUri: r.authorAttribution?.uri || null, publishedAt: r.publishTime || null, url: r.googleMapsUri || null, lang: r.originalText?.languageCode || r.text?.languageCode || null };
  }).filter((r: ExtReview) => r.rating > 0);
}

export async function fetchGoogleReviews(placeId: string, key: string): Promise<{ ok: true; reviews: ExtReview[]; rating: number | null; count: number | null } | { ok: false; error: string }> {
  const id = placeId.replace(/^places\//, '');
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'reviews,rating,userRatingCount' }, cache: 'no-store' });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error?.message || `Google said no (${r.status}).` };
    return { ok: true, reviews: parseGoogleReviews(j), rating: Number(j.rating) || null, count: Number(j.userRatingCount) || null };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

/** Check the listing; returns how many new low reviews were raised. */
export async function reviewSweep(db: any, tenantId: string, tenant: any, o: { force?: boolean } = {}) {
  const S = settingsOf(tenant); const key = process.env.GOOGLE_PLACES_API_KEY || '';
  if (!S.reviews.on && !o.force) return { ok: true as const, raised: 0, skipped: 'off' };
  if (!S.reviews.googlePlaceId) return { ok: false as const, error: 'Add your Google Place ID first.' };
  if (!key) return { ok: false as const, error: 'Google reviews aren’t connected on the server yet (the Places API key is missing).' };
  const got = await fetchGoogleReviews(S.reviews.googlePlaceId, key);
  await db.doc(`tenants/${tenantId}`).set({ reviewWatch: { checkedAt: new Date().toISOString(), error: got.ok ? null : got.error, rating: got.ok ? got.rating : null, count: got.ok ? got.count : null } }, { merge: true });
  if (!got.ok) return got;
  const since = Date.now() - 45 * 86400000; let raised = 0;
  const low = got.reviews.filter((r) => r.rating <= S.reviews.maxStars && (!r.publishedAt || Date.parse(r.publishedAt) >= since));
  if (!low.length) return { ok: true as const, raised: 0 };
  const clients = (await db.collection(`tenants/${tenantId}/clients`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => !c.ownerRenterId);
  const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true && s.isActive !== false);
  const to = [...new Set([tenant?.userId, ...staff.filter((s: any) => MANAGERS.includes(String(s.role)) || s.role === 'front_desk').map((s: any) => s.id)].filter(Boolean))] as string[];
  for (const r of low) {
    const ref = db.doc(`tenants/${tenantId}/externalReviews/${r.id}`); if ((await ref.get()).exists) continue;
    const name = r.author.trim().toLowerCase(); const matches = clients.filter((c: any) => String(c.name || '').trim().toLowerCase() === name);
    const client = matches.length === 1 ? matches[0] : null;
    await ref.set({ ...r, clientId: client?.id || null, clientName: client?.name || null, seenAt: new Date().toISOString(), caseId: null });
    const quote = r.text ? ` “${r.text.slice(0, 110)}${r.text.length > 110 ? '…' : ''}”` : '';
    const b = db.batch(); const now = new Date().toISOString();
    for (const u of to) { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(n, { id: n.id, userId: u, type: 'case_hint', title: `${r.rating}-star Google review`, message: `${r.author} left ${r.rating} star${r.rating === 1 ? '' : 's'} on Google${client ? ' (a client)' : ''}.${quote}`, link: `/cases?start=review&review=${r.id}`, createdAt: now, read: false }); }
    await b.commit(); raised++;
  }
  return { ok: true as const, raised };
}
