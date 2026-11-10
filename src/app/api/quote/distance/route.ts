// src/app/api/quote/distance/route.ts — HOW FAR AN EVENT IS, BY ROAD, FOR A QUOTE'S TRAVEL. From the business's own
// address (or, without one, its first pinned location) to the event's address, there and back, in miles, measured on the map
// (lib/geocode-server finds both; Mapbox's driving route measures them). Nothing is guessed: when either address can't
// be found, or the map can't be reached, it says so and the miles are typed by hand. The team only.
// POST { tenantId, to: { street, city, state, zip } }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { geocode, hasMapsKey, preciseEnough } from '@/lib/geocode-server';
import { pinnedLocations } from '@/lib/delivery-server';
import { placeText } from '@/lib/quote-public';

const MILES_PER_METER = 1 / 1609.344;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const tenantId = String(body?.tenantId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
    const g = await requireCan(req, tenantId, 'bookings.manage'); if ((g as any).deny) return (g as any).deny;
    const toText = placeText(body?.to);
    if (toText.length < 8) return NextResponse.json({ ok: false, error: 'Add the event’s street, city and state first.' }, { status: 400 });
    if (!hasMapsKey()) return NextResponse.json({ ok: false, error: 'Distances can’t be measured here yet. Type the miles.' }, { status: 503 });
    const db = getAdminDb();
    // From: the business's own address (its main place); when that isn't set, its first location with a pin.
    let from: { lat: number; lng: number } | null = null;
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const a = t.address || {};
    const fromText = typeof a === 'string' ? a : [a.street || a.line1, a.city, a.state, a.zip || a.postalCode].filter(Boolean).join(', ') || String(a.formatted || t.studioAddress || '');
    let mapDown = false;
    if (fromText.length >= 8) {
      const f = await geocode(fromText, { keep: true });
      if (f === 'down') mapDown = true;
      else if (preciseEnough(f)) from = { lat: f.lat, lng: f.lng };
    }
    if (!from) {
      const pins = await pinnedLocations(db, tenantId).catch(() => []);
      if (pins.length) from = { lat: pins[0].lat, lng: pins[0].lng };
    }
    if (!from && mapDown) return NextResponse.json({ ok: false, error: 'The map can’t be reached just now. Type the miles, or try again in a minute.' }, { status: 503 });
    if (!from) return NextResponse.json({ ok: false, error: 'Your business’s address isn’t set or couldn’t be found on the map (Settings). Type the miles for now.' }, { status: 400 });
    const to = await geocode(toText);
    if (to === 'down') return NextResponse.json({ ok: false, error: 'The map can’t be reached just now. Type the miles, or try again in a minute.' }, { status: 503 });
    if (!preciseEnough(to)) return NextResponse.json({ ok: false, error: 'That address couldn’t be found on the map. Check it, or type the miles.' }, { status: 422 });
    const token = String(process.env.MAPBOX_TOKEN || '').trim();
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&access_token=${encodeURIComponent(token)}`;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 7000);
    let meters = 0; let seconds = 0;
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' } as any);
      if (!r.ok) return NextResponse.json({ ok: false, error: 'The map couldn’t find a road route. Type the miles.' }, { status: 503 });
      const j: any = await r.json();
      meters = Number(j?.routes?.[0]?.distance) || 0; seconds = Number(j?.routes?.[0]?.duration) || 0;
    } catch { return NextResponse.json({ ok: false, error: 'The map can’t be reached just now. Type the miles, or try again in a minute.' }, { status: 503 }); }
    finally { clearTimeout(timer); }
    if (!(meters > 0)) return NextResponse.json({ ok: false, error: 'The map couldn’t find a road route. Type the miles.' }, { status: 422 });
    const oneWay = meters * MILES_PER_METER;
    return NextResponse.json({ ok: true, roundTripMiles: Math.round(oneWay * 2 * 10) / 10, oneWayMinutes: Math.round(seconds / 60), to: to.label });
  } catch (err) {
    console.error('[quote/distance] failed', err);
    return NextResponse.json({ ok: false, error: 'The distance couldn’t be measured. Type the miles.' }, { status: 500 });
  }
}
