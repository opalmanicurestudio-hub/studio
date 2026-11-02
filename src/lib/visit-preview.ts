// src/lib/visit-preview.ts — THE CARD A VISIT LINK SHOWS WHEN IT'S SENT (ClientEmails board 15G: "Your visit ·
// Opal Manicure Studio", in the business's color). Messages apps and email clients fetch the link before anyone opens
// it and show its title and picture, often on a lock screen, so the card says only whose visit link it is: never the
// service, the provider, the time or the client. Server side only (app/check-in/[token] layout and opengraph-image).
import { getAdminDb } from '@/lib/firebase-admin';
import { brandColor } from '@/lib/studio-page';
import { linkOrigin } from '@/lib/app-origin';

/** origin: the address the business's links use, so the card's picture is fetched from there. */
export type VisitPreview = { name: string; accent: string; origin: string };

export const PREVIEW_DESCRIPTION = 'See or change your visit, say you’re running late, and find your way there.';

// A short memory per server, so opening the visit page (and its picture) doesn't read the same two documents again.
const memo = new Map<string, { p: VisitPreview | null; at: number }>();
const KEEP_MS = 10 * 60_000, MISS_MS = 60_000, WAIT_MS = 1500;

async function lookUp(id: string): Promise<VisitPreview | null> {
  const db = getAdminDb();
  const copy: any = (await db.doc(`appointmentCheckIns/${id}`).get()).data();
  const tenantId = String(copy?.tenantId || '');
  if (!tenantId) return null;
  const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  return { name: String(t.name || t.businessName || '').trim().slice(0, 80), accent: brandColor(t), origin: linkOrigin(t, '') };
}

/** The business behind a visit link, from the link's public copy. null for a link that isn't one, or when the answer
 *  doesn't come within a moment (the page never waits on it). */
export async function visitPreviewOf(token: string): Promise<VisitPreview | null> {
  const id = String(token || '');
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(id)) return null;
  const hit = memo.get(id);
  if (hit && Date.now() - hit.at < (hit.p ? KEEP_MS : MISS_MS)) return hit.p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const p = await Promise.race([lookUp(id), new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), WAIT_MS); })]);
    if (p === 'late') return null;   // not remembered: the next ask tries again
    if (memo.size > 500) memo.clear();
    // A link that isn't one is remembered for a minute (so guessing costs nothing), a real one for ten.
    memo.set(id, { p, at: Date.now() });
    return p;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

/** "Your visit · Opal Manicure Studio" (or just "Your visit"). */
export const previewTitle = (p: VisitPreview | null) => (p?.name ? `Your visit · ${p.name}` : 'Your visit');
