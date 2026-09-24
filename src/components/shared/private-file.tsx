'use client';
// src/components/shared/private-file.tsx
//
// Private client files (photo IDs, intake forms, client photos) are stored
// as references like /api/files/view?t=…&p=…. These helpers turn one into a
// five-minute link for the signed-in team member, and leave any ordinary URL
// (older public uploads, other images) exactly as it is.

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';

const cache = new Map<string, { url: string; at: number }>();
const isPrivate = (u?: string | null) => !!u && u.startsWith('/api/files/view?');

export async function resolvePrivateUrl(u: string): Promise<string> {
  if (!isPrivate(u)) return u;
  const hit = cache.get(u);
  if (hit && Date.now() - hit.at < 4 * 60 * 1000) return hit.url;
  const q = new URLSearchParams(u.split('?')[1] || '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try { const user = getAuth().currentUser; const tk = user ? await user.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* the route answers 401 */ }
  const res = await fetch('/api/files/view', { method: 'POST', headers, body: JSON.stringify({ t: q.get('t'), p: q.get('p') }) });
  const d = await res.json().catch(() => null);
  if (!d?.ok || !d.url) throw new Error(d?.error || 'Could not open that file.');
  cache.set(u, { url: d.url, at: Date.now() });
  return d.url;
}

/** Resolve for display (thumbnails). Returns null while loading or if not allowed. */
export function usePrivateUrl(u?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(isPrivate(u) ? null : (u || null));
  useEffect(() => {
    let alive = true;
    if (!u) { setUrl(null); return; }
    if (!isPrivate(u)) { setUrl(u); return; }
    resolvePrivateUrl(u).then((r) => { if (alive) setUrl(r); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [u]);
  return url;
}

/** Open in a new tab. The tab opens first (so browsers don't block it), then gets the link. */
export async function openPrivateFile(u: string) {
  if (!isPrivate(u)) { window.open(u, '_blank', 'noopener'); return; }
  const w = window.open('about:blank', '_blank');
  try { const url = await resolvePrivateUrl(u); if (w) w.location.href = url; else window.location.href = url; }
  catch (e: any) { if (w) w.close(); alert(e?.message || 'Could not open that file.'); }
}

export function PrivateImg({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const url = usePrivateUrl(src);
  return url ? <img src={url} alt={alt || ''} className={className} /> : <div className={className} style={{ background: 'rgba(120,113,108,0.08)' }} aria-label={alt || 'Loading'} />;
}
