// src/lib/geocode-server.ts — AN ADDRESS ON THE MAP (server). Mapbox forward geocoding, with the key from the
// MAPBOX_TOKEN environment variable. Two kinds of lookup, as Mapbox's terms set them:
//   · a lookup kept for later (the shop's own address, measured from for every delivery) asks for a result that may be
//     stored ('permanent');
//   · a customer's address at checkout is looked up for that checkout only and never kept, here or on the order: the
//     answer gives the zone, and checkout carries the distance in its own signed note so it isn't asked twice.
// Not found: null. No key, a slow answer or Mapbox refusing: 'down', so the caller can say the map can't be reached
// rather than that the address doesn't exist.

export type Geo = { lat: number; lng: number; label: string; postal: string; confidence: 'exact' | 'high' | 'medium' | 'low' | 'unknown' };

export const hasMapsKey = () => !!String(process.env.MAPBOX_TOKEN || '').trim();

// Only answers that may be stored are remembered (the shop's own address), for a few minutes.
const memo = new Map<string, { at: number; v: Geo | null }>();
const KEEP_MS = 10 * 60e3;

/** One line for an address: '88 Pine St, Suite 400, Portland, OR 97204'. */
export function addressLine(a: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string } | string): string {
  if (typeof a === 'string') return a.replace(/[;\s]+/g, ' ').trim().slice(0, 200);
  return [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].map((x) => String(x || '').replace(/[;\s]+/g, ' ').trim()).filter(Boolean).join(', ').slice(0, 200);
}

/** Reads Mapbox's answer: the first feature, if it's an address (or a place close enough to be one). */
export function readFeature(json: any): Geo | null {
  const f = Array.isArray(json?.features) ? json.features[0] : null;
  const c = f?.geometry?.coordinates;
  if (!f || !Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]), lat = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = f.properties || {};
  const conf = String(p.match_code?.confidence || '');
  const postal = String(p.context?.postcode?.name || '').slice(0, 10);
  return {
    lat, lng, label: String(p.full_address || p.place_formatted || p.name || '').slice(0, 160), postal,
    confidence: (['exact', 'high', 'medium', 'low'].includes(conf) ? conf : 'unknown') as Geo['confidence'],
  };
}

/**
 * Looks an address up. `keep` asks for a result that may be stored (the shop's own address); otherwise it's for this
 * checkout only. US addresses only for now.
 */
export async function geocode(address: string, opts: { keep?: boolean; fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<Geo | null | 'down'> {
  const token = String(process.env.MAPBOX_TOKEN || '').trim();
  const q = addressLine(address);
  if (!token) return 'down';
  if (q.length < 5) return null;
  const k = q.toLowerCase();
  const hit = opts.keep ? memo.get(k) : undefined;
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.v;
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=us&limit=1&types=address&autocomplete=false${opts.keep ? '&permanent=true' : ''}&access_token=${encodeURIComponent(token)}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000);
  try {
    const r = await (opts.fetcher || fetch)(url, { signal: ctl.signal, cache: 'no-store' } as any);
    if (!r.ok) {
      // The token's own trouble (wrong, revoked, over its limit) is logged without it.
      console.warn('[geocode] lookup refused', r.status);
      return r.status === 404 || r.status === 422 ? null : 'down';
    }
    const v = readFeature(await r.json());
    if (opts.keep) { if (memo.size > 200) memo.clear(); memo.set(k, { at: Date.now(), v }); }
    return v;
  } catch (e: any) {
    console.warn('[geocode] lookup failed', String(e?.name === 'AbortError' ? 'timeout' : e?.message || e).slice(0, 80));
    return 'down';
  } finally { clearTimeout(timer); }
}

/** Good enough to measure a delivery from: the street address itself was found, not just the town. */
export const preciseEnough = (g: Geo | null | 'down'): g is Geo => !!g && g !== 'down' && (g.confidence === 'exact' || g.confidence === 'high' || g.confidence === 'medium');
