// src/lib/trip-log-server.ts — THE MILEAGE LOG, KEPT (server; lib/trip-log is the rules; api/mileage asks for it).
// Everything here is server only, in tenants/{t}/private:
//   trip_{id}       one trip (lib/trip-log Trip)
//   tripSetup       home, whether home is the main place of business, the odometer readings, suggestions passed over
//   tripPlaces      addresses already found on the map (Mapbox's lookups that may be kept), so each is asked once
//   drive_{userId}  a drive under way: where and when it started, and, once ended, where and when it ended
// Miles by road come from the map (lib/route-server roadLegs) and are kept with the trip they're for; the straight line,
// a little more for roads, when the map can't be reached.
import { bizLocationsOf } from '@/lib/here-server';
import { geocode, reverseGeocode, preciseEnough } from '@/lib/geocode-server';
import { roadLegs } from '@/lib/route-server';
import { estimateLegs } from '@/lib/route-plan';
import { milesBetween } from '@/lib/delivery-plan';
import { tenantTimeZone, todayIn, addDays } from '@/lib/tenant-time';
import { tripTenths, isCommute, cleanPlace, type Trip, type TripPlace, type TripSetup, type TripProof, type Purpose } from '@/lib/trip-log';

const priv = (t: string) => `tenants/${t}/private`;
export const setupRef = (db: any, t: string) => db.doc(`${priv(t)}/tripSetup`);
export const tripRef = (db: any, t: string, id: string) => db.doc(`${priv(t)}/trip_${id}`);
export const driveRef = (db: any, t: string, uid: string) => db.doc(`${priv(t)}/drive_${String(uid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`);
const placesRef = (db: any, t: string) => db.doc(`${priv(t)}/tripPlaces`);

/** A place this close to a kept one is that place (a parking lot away). */
const SAME_PLACE_MILES = 0.2;
/** A suggestion closer than this to where drives start is a walk, not a drive. */
const WALK_TENTHS = 3;
/** Further than this one way is travel, not a drive across town. */
const FAR_TENTHS = 3000;
/** How far back suggestions look. */
const SUGGEST_DAYS = 45;

export const newTripId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const todayFor = (tenant: any) => todayIn(tenantTimeZone(tenant));

export async function loadSetup(db: any, t: string): Promise<TripSetup> {
  return ((await setupRef(db, t).get()).data() || {}) as TripSetup;
}

export async function tripsOf(db: any, t: string, year: number): Promise<Trip[]> {
  const snap = await db.collection(priv(t)).where('kind', '==', 'trip').where('year', '==', year).limit(4000).get();
  return snap.docs.map((d: any) => d.data() as Trip).filter((x: Trip) => x && x.id)
    .sort((a: Trip, b: Trip) => b.day.localeCompare(a.day) || String(b.at).localeCompare(String(a.at)));
}

const onMap = (p: any): p is { lat: number; lng: number } => !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/** An address on the map, looked up once and kept (tripPlaces). Null when it can't be found or the map is down. */
async function findAddress(db: any, t: string, address: string): Promise<{ label: string; lat: number; lng: number } | null> {
  const key = address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120); if (key.length < 5) return null;
  const ref = placesRef(db, t); const kept: any = (await ref.get()).data() || {};
  const hit: any = kept.found?.[key.replace(/\s/g, '_')];
  if (hit && onMap({ ...hit })) return { label: String(hit.label || address), lat: Number(hit.lat), lng: Number(hit.lng) };
  const g = await geocode(address, { keep: true });
  if (!preciseEnough(g)) return null;
  const v = { label: g.label || address, lat: g.lat, lng: g.lng };
  const found = { ...(kept.found || {}) }; const keys = Object.keys(found);
  if (keys.length >= 400) delete found[keys[0]];
  found[key.replace(/\s/g, '_')] = v;
  await ref.set({ found }, { merge: false }).catch(() => {});
  return v;
}

/** The places trips start and end at most: the business's own (on the map: theirs, or their address looked up), home,
 *  and places driven to before. */
export async function keptPlaces(db: any, t: string, setup: TripSetup, recent: Trip[] = []): Promise<TripPlace[]> {
  const out: TripPlace[] = [];
  for (const l of await bizLocationsOf(db, t).catch(() => [])) {
    let at = l.coordinates; let label = l.address ? `${l.name}, ${l.address}` : l.name;
    if (!at && l.address) { const f = await findAddress(db, t, l.address); if (f) at = { lat: f.lat, lng: f.lng }; }
    if (at) out.push({ label: label.slice(0, 160), lat: at.lat, lng: at.lng, ref: `biz:${l.id}` });
    else out.push({ label: label.slice(0, 160), ref: `biz:${l.id}` });
  }
  if (setup.home && setup.home.label) out.push({ ...setup.home, ref: 'home' });
  const seen = new Set(out.map((p) => p.label.toLowerCase()));
  for (const tr of recent) for (const p of [tr.to, tr.from]) {
    if (!p?.label || p.ref || seen.has(p.label.toLowerCase()) || !onMap(p)) continue;
    seen.add(p.label.toLowerCase()); out.push({ label: p.label, lat: p.lat, lng: p.lng, ref: null });
    if (out.length >= 16) return out;
  }
  return out;
}

/** Where drives start from: the business's first place on the map, or home when home is where the business is run. */
export const originOf = (kept: TripPlace[], setup: TripSetup): TripPlace | null =>
  (setup.homeIsMain ? kept.find((p) => p.ref === 'home' && onMap(p)) : null) || kept.find((p) => (p.ref || '').startsWith('biz:') && onMap(p)) || kept.find((p) => p.ref === 'home' && onMap(p)) || null;

/** A point from the phone, named: a kept place when it's one, else its street address from the map. */
export async function placeAt(point: { lat: number; lng: number }, kept: TripPlace[]): Promise<TripPlace> {
  const k = keptAt(point, kept); if (k) return k;
  const g = await reverseGeocode(point);
  const label = g && g !== 'down' && g.label ? g.label : `Near ${point.lat.toFixed(3)}, ${point.lng.toFixed(3)}`;
  return { label: label.slice(0, 160), lat: Math.round(point.lat * 1e5) / 1e5, lng: Math.round(point.lng * 1e5) / 1e5, ref: null };
}

/** One way's miles between two places on the map, in tenths: by road from the map, else estimated. */
export async function milesFor(a: TripPlace, b: TripPlace): Promise<{ tenths: number; road: boolean } | null> {
  if (!onMap(a) || !onMap(b)) return null;
  const pts = [{ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }];
  const road = await roadLegs(pts).catch(() => null);
  const legs = road || estimateLegs(pts);
  return { tenths: Math.max(1, Math.round(legs.miles[0][1] * 10)), road: !!road };
}

/** The kept place a point is at (a parking lot away), if any. */
export function keptAt(point: { lat?: number; lng?: number }, kept: TripPlace[]): TripPlace | null {
  if (!onMap(point)) return null;
  let best: TripPlace | null = null; let d = Infinity;
  for (const p of kept) if (onMap(p)) { const m = milesBetween(point as any, p as any); if (m < d) { d = m; best = p; } }
  return best && d <= SAME_PLACE_MILES ? best : null;
}

/** A place as the owner sent it: a kept place (by its ref, or the place it's at), else its address looked up on the map
 *  here. Never a place on the map the page made up: only a kept place's is taken as sent, so "from the map" miles are
 *  the map's, and home typed out is still home. */
export async function resolvePlace(db: any, t: string, p: any, kept: TripPlace[]): Promise<TripPlace | null> {
  const ref = typeof p?.ref === 'string' ? p.ref : '';
  if (ref) { const k = kept.find((x) => x.ref === ref); if (k) return k; }
  const c = cleanPlace(p); if (!c) return null;
  if (/^(my )?home$/i.test(c.label)) { const h = kept.find((x) => x.ref === 'home'); if (h) return h; }
  const sent = onMap(c) ? keptAt(c, kept) : null;
  if (sent && sent.label.toLowerCase() === c.label.toLowerCase()) return sent;
  const f = await findAddress(db, t, c.label);
  if (!f) return { label: c.label, ref: null };
  return keptAt(f, kept) || { label: f.label.slice(0, 160), lat: f.lat, lng: f.lng, ref: null };
}

const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400e3;

/* ─── Suggested trips ────────────────────────────────────────────────────────── */

export type Suggestion = { id: string; kind: 'card' | 'event'; title: string; day: string; exact?: boolean; amountCents: number | null; to: TripPlace; oneWayTenths: number; road: boolean; purpose: Purpose };

async function candidates(db: any, t: string, today: string): Promise<{ id: string; kind: 'card' | 'event'; title: string; day: string; exact: boolean; amountCents: number | null; to: TripPlace; purpose: Purpose }[]> {
  const since = addDays(today, -SUGGEST_DAYS); const out: any[] = [];
  const lines = await db.collection(`tenants/${t}/bankTransactions`).where('date', '>=', since).limit(600).get().catch(() => ({ docs: [] as any[] }));
  for (const d of lines.docs) {
    const x: any = d.data() || {};
    if (x.direction !== 'out' || x.pending || (x.context || 'Business') !== 'Business' || !x.place || !onMap(x.place)) continue;
    if (['excluded', 'own_transfer'].includes(String(x.status || ''))) continue;
    // (The day it was bought, when the bank said; else the day it posted, which can be a day or more later: `exact`.)
    const bought = /^\d{4}-\d{2}-\d{2}$/.test(String(x.boughtOn || '')) ? String(x.boughtOn) : String(x.date);
    if (bought > today || bought < since) continue;
    const title = clean(x.merchant || x.name || 'A store', 80);
    out.push({ id: `card_${d.id}`, kind: 'card', title, day: bought, exact: !!x.boughtOn, amountCents: Number(x.amountCents) || null,
      to: { label: clean(x.place.address ? `${title}, ${x.place.address}` : title, 160), lat: Number(x.place.lat), lng: Number(x.place.lng), ref: null },
      purpose: /bank/i.test(title) ? 'bank' : /post ?office|usps/i.test(title) ? 'post' : 'supplies' });
  }
  // (Events away from the business: those made from a quote keep the place's street address, lib/quote-convert.)
  const evs = await db.collection(`tenants/${t}/studioEvents`).where('date', '>=', since).limit(200).get().catch(() => ({ docs: [] as any[] }));
  for (const d of evs.docs) {
    const x: any = d.data() || {}; const a = x.address || {};
    if (String(x.date || '') > today || ['cancelled', 'canceled'].includes(String(x.status || ''))) continue;
    const addr = [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' ')].map((v: any) => String(v || '').trim()).filter(Boolean).join(', ');
    if (!a.street || addr.length < 8) continue;
    const f = await findAddress(db, t, addr); if (!f) continue;
    const title = clean(x.title || x.name || 'Event', 80);
    out.push({ id: `event_${d.id}`, kind: 'event', title, day: String(x.date).slice(0, 10), amountCents: null,
      to: { label: clean(`${x.venue ? String(x.venue).slice(0, 60) + ', ' : ''}${f.label}`, 160), lat: f.lat, lng: f.lng, ref: null }, exact: true, purpose: 'event' });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/** Drives the books and the calendar point to, not logged or passed over yet: card purchases made in a store and
 *  off-site events in the last weeks, each with its one-way miles from where drives start (one map request for all). */
export async function suggestions(db: any, t: string, setup: TripSetup, origin: TripPlace | null, trips: Trip[], today: string): Promise<Suggestion[]> {
  if (!origin || !onMap(origin)) return [];
  const used = new Set(trips.filter((x) => x.proof && !x.removed).map((x) => `${x.proof!.kind}_${x.proof!.id}`));
  const passed = new Set(setup.dismissed || []);
  // (A drive already logged to the same place around the same day covers its purchase too: within a day of the day it
  // was bought, or three of the day it posted. The purchase is kept with the nearest such business trip as proof, once
  // the bank sends it, and the trip's history says so.)
  const logged = trips.filter((x) => !x.removed && onMap(x.to));
  // (A posted date is never before the purchase: from three days before it to that day.)
  const inWindow = (tripDay: string, c: { day: string; exact: boolean }) => c.exact ? dayGap(tripDay, c.day) <= 1 : tripDay <= c.day && dayGap(tripDay, c.day) <= 3;
  const near = (c: { day: string; exact: boolean; to: TripPlace }) => logged.filter((x) => inWindow(x.day, c) && milesBetween(x.to as any, c.to as any) <= SAME_PLACE_MILES)
    .sort((a, b) => dayGap(a.day, c.day) - dayGap(b.day, c.day));
  const all = await candidates(db, t, today);
  for (const c of all) {
    if (used.has(c.id) || c.kind !== 'card') continue;
    const trip = near(c).find((x) => !x.proof && x.use === 'business');
    if (trip) {
      const proof = proofOf({ ...c, oneWayTenths: 0, road: false }); const edits = [...(trip.edits || []), { at: new Date().toISOString(), by: 'ClarityFlow', was: `proof added: ${proof.label}` }].slice(-20);
      trip.proof = proof; trip.edits = edits; used.add(c.id);
      await tripRef(db, t, trip.id).set({ proof, edits }, { merge: true }).catch(() => {});
    }
  }
  const list = all.filter((c) => !used.has(c.id) && !passed.has(c.id) && !near(c).length).slice(0, 24);
  if (!list.length) return [];
  const pts = [{ lat: origin.lat!, lng: origin.lng! }, ...list.map((c) => ({ lat: c.to.lat!, lng: c.to.lng! }))];
  const road = await roadLegs(pts).catch(() => null); const legs = road || estimateLegs(pts);
  return list.map((c, i) => ({ ...c, oneWayTenths: Math.round(legs.miles[0][i + 1] * 10), road: !!road }))
    .filter((c) => c.oneWayTenths >= WALK_TENTHS && c.oneWayTenths <= FAR_TENTHS).slice(0, 8);
}

/** A suggestion as a trip: from where drives start, round trip unless said otherwise, with the purchase or event kept
 *  as proof. Looked up again here (never taken from the page). */
export async function suggestionTrip(db: any, t: string, setup: TripSetup, origin: TripPlace | null, trips: Trip[], today: string, id: string): Promise<Suggestion | null> {
  return (await suggestions(db, t, setup, origin, trips, today)).find((s) => s.id === id) || null;
}

export const proofOf = (s: Suggestion): TripProof => ({ kind: s.kind, id: s.id.replace(/^(card|event)_/, ''), label: s.kind === 'card' ? `Card purchase, ${s.title}${s.amountCents ? `, $${(s.amountCents / 100).toFixed(2)}` : ''}` : `Event, ${s.title}`, amountCents: s.amountCents, at: s.day });

/** A trip, put together. */
export function makeTrip(o: { id: string; day: string; from: TripPlace; to: TripPlace; oneWayTenths: number; roundTrip: boolean; how: Trip['how']; road: boolean; purpose: Purpose; note: string; use: Trip['use']; by: { id: string; name: string }; at: string; started?: string | null; ended?: string | null; proof?: TripProof | null; setup: TripSetup }): Trip {
  return {
    kind: 'trip', id: o.id, year: Number(o.day.slice(0, 4)), day: o.day,
    // (Home and the business's place, either way: commuting, whatever was picked, unless home is where the business is run.)
    use: o.use === 'commute' || isCommute(o.from, o.to, o.setup) ? 'commute' : 'business',
    purpose: o.purpose, note: o.note, from: o.from, to: o.to,
    oneWayTenths: o.oneWayTenths, roundTrip: o.roundTrip, tenths: tripTenths(o.oneWayTenths, o.roundTrip),
    how: o.how, road: o.road, started: o.started || null, ended: o.ended || null, proof: o.proof || null,
    by: o.by, at: o.at, edits: [], removed: null,
  };
}
