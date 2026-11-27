// src/lib/mileage-actions.ts — WHAT A MILEAGE LOG DOES, for whoever keeps one (server; lib/trip-log is the rules,
// lib/trip-log-server the store): the business's own log (api/mileage, kept by the owner) and a renter's own log for their
// own business (api/portal/renter-mileage, in their portal). The same actions, the same rules, each log kept apart
// (lib/trip-log-server LogOf). POST bodies as api/mileage lists them.
import { dayKey, tenantTimeZone } from '@/lib/tenant-time';
import { cleanChoice, tenthsOf, yearSummary, cleanReading, editWords, logCsv, milesText, purposeLabel, isCommute, tripTenths, dayOk, type Trip, type TripSetup } from '@/lib/trip-log';
import { loadSetup, tripsOf, keptPlaces, originOf, placeAt, milesFor, resolvePlace, suggestions, suggestionTrip, proofOf, makeTrip, newTripId, todayFor, setupRef, tripRef, driveRef, type LogOf } from '@/lib/trip-log-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const point = (b: any) => { const lat = Number(b?.lat), lng = Number(b?.lng); return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null; };
/** A drive left running longer than this is stale: a new one starts. */
const DRIVE_HOURS = 12;

export type MileageCtx = {
  db: any; tenantId: string; tenant: any;
  /** Whose log: null for the business's, a renter id for a renter's own. */
  who: LogOf;
  /** Who's logging (their own drive under way is kept by their id). */
  by: { id: string; name: string };
  /** May log and change trips (the owner, or the renter in their own log); otherwise only see and download. */
  canLog: boolean;
  /** Suggests drives from the business's own card purchases and events (the owner's log only). */
  suggest: boolean;
  /** Said in the business's activity (the owner's log); a renter's own log isn't the business's to see. */
  audit: (summary: string, id: string) => Promise<void>;
  /** Who may log, said when someone else tries. */
  onlyWords: string;
};

/** One action on a log: the reply's body and status. */
export async function mileageAction(c: MileageCtx, action: string, b: any): Promise<{ status: number; body: any }> {
  const { db, tenantId, tenant, who, by, audit } = c;
  const out = (body: any, status = 200) => ({ status, body });
  const today = todayFor(tenant); const now = new Date().toISOString();
  const setup: TripSetup = await loadSetup(db, tenantId, who);
  const thisYear = Number(today.slice(0, 4));
  if (!['list', 'export'].includes(action) && !c.canLog) return out({ ok: false, error: c.onlyWords }, 403);
  // (Suggestions come from the business's own card purchases and events: a log that isn't suggested them can't log or pass
  // over one either, so a renter's log never takes in the business's purchases.)
  if ((action === 'suggested' || action === 'dismiss') && !c.suggest) return out({ ok: false, error: 'Something went wrong.' }, 400);

    if (action === 'list') {
      const year = Number(b.year) >= thisYear - 1 && Number(b.year) <= thisYear ? Number(b.year) : thisYear;
      const trips = await tripsOf(db, tenantId, year, who);
      const recent = year === thisYear ? trips : await tripsOf(db, tenantId, thisYear, who);
      const kept = await keptPlaces(db, tenantId, setup, recent, who);
      const origin = originOf(kept, setup);
      // (Suggestions are this year's to log, the owner's only, since they come from the owner's own card purchases too; a
      // purchase already kept as proof on any trip isn't suggested again.)
      const sugg = year === thisYear && c.suggest ? await suggestions(db, tenantId, setup, origin, [...recent, ...await tripsOf(db, tenantId, thisYear - 1, who).catch(() => [])], today).catch(() => []) : [];
      // (A drive ended but not saved stays until it's saved or dropped; one never ended goes stale after a while.)
      const drive: any = c.canLog ? (await driveRef(db, tenantId, by.id, who).get()).data() || null : null;
      const live = drive && (drive.ended || Date.now() - Date.parse(drive.startedAt) < DRIVE_HOURS * 3600e3) ? drive : null;
      return out({ ok: true, year, today, years: [thisYear, thisYear - 1], summary: yearSummary(trips, year, setup), trips: trips.filter((x) => !x.removed),
        places: kept, origin, suggestions: sugg, drive: live ? { startedAt: live.startedAt, from: live.from, ended: live.ended || null, to: live.to || null, oneWayTenths: live.oneWayTenths ?? null, road: !!live.road, commute: !!(live.to && isCommute(live.from, live.to, setup)) } : null,
        owner: c.canLog,
        setup: { home: setup.home || null, homeIsMain: !!setup.homeIsMain, odometer: setup.odometer || {} } });
    }

    if (action === 'start') {
      const p = point(b); if (!p) return out({ ok: false, error: 'Your phone didn’t share where you are. Turn on location for ClarityFlow, or add the trip after.' }, 400);
      const ref = driveRef(db, tenantId, by.id, who); const cur: any = (await ref.get()).data();
      if (cur?.ended) return out({ ok: false, error: 'Save or drop the last drive first.' }, 409);
      if (cur && Date.now() - Date.parse(cur.startedAt) < DRIVE_HOURS * 3600e3) return out({ ok: true, startedAt: cur.startedAt, from: cur.from });
      const kept = await keptPlaces(db, tenantId, setup, [], who);
      const from = await placeAt(p, kept);
      await ref.set({ startedAt: now, from, by });
      return out({ ok: true, startedAt: now, from });
    }

    if (action === 'end') {
      const p = point(b); if (!p) return out({ ok: false, error: 'Your phone didn’t share where you are. Turn on location, or cancel this drive and add the trip after.' }, 400);
      const ref = driveRef(db, tenantId, by.id, who); const cur: any = (await ref.get()).data();
      if (!cur) return out({ ok: false, error: 'There’s no drive under way.' }, 409);
      if (cur.ended) return out({ ok: true, startedAt: cur.startedAt, ended: cur.ended, from: cur.from, to: cur.to, oneWayTenths: cur.oneWayTenths, road: !!cur.road });
      const kept = await keptPlaces(db, tenantId, setup, await tripsOf(db, tenantId, thisYear, who).catch(() => []), who);
      const to = await placeAt(p, kept);
      const m = (await milesFor(cur.from, to)) || { tenths: 1, road: false };
      await ref.set({ ended: now, to, oneWayTenths: m.tenths, road: m.road }, { merge: true });
      return out({ ok: true, startedAt: cur.startedAt, ended: now, from: cur.from, to, oneWayTenths: m.tenths, road: m.road, commute: isCommute(cur.from, to, setup) });
    }

    if (action === 'cancel') { await driveRef(db, tenantId, by.id, who).delete().catch(() => {}); return out({ ok: true }); }

    if (action === 'save') {
      const ref = driveRef(db, tenantId, by.id, who);
      // (Once: the drive is read and dropped as the trip is made, so a second tap finds no drive.)
      const r: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(ref)).data();
        if (!cur) return { status: 409, error: 'That drive is saved already.' };
        if (!cur.ended) return { status: 409, error: 'End the drive first.' };
        // (The day it ended, by the business's own clock.)
        const day = dayKey(new Date(cur.ended), tenantTimeZone(tenant));
        const c = cleanChoice({ ...b, day }, today); if (!c.ok) return { status: 400, error: c.error };
        const id = newTripId();
        const trip = makeTrip({ id, day: c.day, from: cur.from, to: cur.to, oneWayTenths: Number(cur.oneWayTenths) || 1, roundTrip: c.roundTrip, how: 'drive', road: !!cur.road, purpose: c.purpose, note: c.note, use: c.use, by, at: now, started: cur.startedAt, ended: cur.ended, setup });
        tx.create(tripRef(db, tenantId, id, who), trip); tx.delete(ref);
        return { trip };
      });
      if (!r.trip) return out({ ok: false, error: r.error }, r.status);
      const trip: Trip = r.trip; const id = trip.id;
      await audit(`Logged a ${milesText(trip.tenths)} mile drive${trip.use === 'commute' ? ' (commuting)' : ` for ${purposeLabel(trip.purpose)}`}.`, id);
      return out({ ok: true, trip });
    }

    if (action === 'miles' || action === 'add') {
      const kept = await keptPlaces(db, tenantId, setup, await tripsOf(db, tenantId, thisYear, who).catch(() => []), who);
      const from = await resolvePlace(db, tenantId, b.from, kept, who); const to = await resolvePlace(db, tenantId, b.to, kept, who);
      if (!from || !to) return out({ ok: false, error: 'Say where the trip started and where it went.' }, 400);
      const typed = b.miles != null && String(b.miles).trim() !== '' ? tenthsOf(b.miles) : null;
      if (b.miles != null && String(b.miles).trim() !== '' && typed == null) return out({ ok: false, error: 'Miles one way, like 6.4.' }, 400);
      const m = typed != null ? { tenths: typed, road: false } : await milesFor(from, to);
      if (action === 'miles') return out({ ok: true, from, to, oneWayTenths: m?.tenths ?? null, road: !!m?.road, commute: isCommute(from, to, setup) });
      if (!m) return out({ ok: false, error: 'One of those places isn’t on the map. Type the miles one way instead.' }, 400);
      const c = cleanChoice(b, today); if (!c.ok) return out({ ok: false, error: c.error }, 400);
      const id = newTripId();
      const trip = makeTrip({ id, day: c.day, from, to, oneWayTenths: m.tenths, roundTrip: c.roundTrip, how: typed != null ? 'typed' : 'map', road: m.road, purpose: c.purpose, note: c.note, use: c.use, by, at: now, setup });
      await tripRef(db, tenantId, id, who).set(trip);
      await audit(`Added a ${milesText(trip.tenths)} mile trip on ${trip.day}${trip.use === 'commute' ? ' (commuting)' : ` for ${purposeLabel(trip.purpose)}`}.`, id);
      return out({ ok: true, trip });
    }

    if (action === 'suggested') {
      const id = String(b.id || ''); if (!/^(card|event)_[A-Za-z0-9_-]{1,160}$/.test(id)) return out({ ok: false, error: 'Something went wrong.' }, 400);
      const trips = [...await tripsOf(db, tenantId, thisYear, who), ...await tripsOf(db, tenantId, thisYear - 1, who).catch(() => [])];
      const kept = await keptPlaces(db, tenantId, setup, trips, who); const origin = originOf(kept, setup);
      const s = await suggestionTrip(db, tenantId, setup, origin, trips, today, id);
      if (!s || !origin) return out({ ok: false, error: 'That one’s logged already, or it’s no longer suggested.' }, 409);
      const purpose = ['supplies', 'bank', 'client', 'event', 'class', 'post', 'meeting', 'other'].includes(String(b.purpose)) ? b.purpose : s.purpose;
      // (Its own id, made once: a second tap is refused, not a second trip.)
      const tid = `s_${id}`.slice(0, 160);
      const trip = makeTrip({ id: tid, day: s.day, from: origin, to: s.to, oneWayTenths: s.oneWayTenths, roundTrip: b.roundTrip !== false, how: 'map', road: s.road, purpose, note: '', use: 'business', by, at: now, proof: proofOf(s), setup });
      // (Taken out before and logged again: the same trip, back, its history kept and saying so.)
      const tRef = tripRef(db, tenantId, tid, who); const was: any = (await tRef.get()).data();
      if (was && !was.removed) return out({ ok: false, error: 'That one’s logged already.' }, 409);
      if (was) trip.edits = [...(Array.isArray(was.edits) ? was.edits : []), { at: now, by: by.name, was: `taken out ${String(was.removed?.at || '').slice(0, 10)} by ${was.removed?.by || 'someone'}, logged again` }].slice(-20);
      await tRef.set(trip);
      await audit(`Logged a ${milesText(trip.tenths)} mile trip on ${trip.day} from a ${s.kind === 'card' ? 'card purchase' : 'event'}.`, tid);
      return out({ ok: true, trip });
    }

    if (action === 'dismiss') {
      const id = String(b.id || ''); if (!/^(card|event)_[A-Za-z0-9_-]{1,160}$/.test(id)) return out({ ok: false, error: 'Something went wrong.' }, 400);
      const list = [...(setup.dismissed || []).filter((x) => x !== id), id].slice(-300);
      await setupRef(db, tenantId, who).set({ dismissed: list }, { merge: true });
      return out({ ok: true });
    }

    if (action === 'edit' || action === 'remove') {
      const id = String(b.id || ''); if (!ID.test(id)) return out({ ok: false, error: 'Something went wrong.' }, 400);
      const ref = tripRef(db, tenantId, id, who); const was = (await ref.get()).data() as Trip | undefined;
      if (!was || was.removed) return out({ ok: false, error: 'That trip isn’t in the log.' }, 404);
      if (action === 'remove') {
        await ref.set({ removed: { at: now, by: by.name } }, { merge: true });
        await audit(`Took a ${milesText(was.tenths)} mile trip on ${was.day} out of the log.`, id);
        return out({ ok: true });
      }
      const next: Partial<Trip> = {};
      if (b.purpose != null) { if (!['supplies', 'bank', 'client', 'event', 'class', 'post', 'meeting', 'other'].includes(String(b.purpose))) return out({ ok: false, error: 'Pick what the trip was for.' }, 400); next.purpose = b.purpose; }
      if (b.note != null) next.note = String(b.note).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (b.day != null) { if (!dayOk(String(b.day), today)) return out({ ok: false, error: 'A day this year or last, up to today.' }, 400); next.day = String(b.day); next.year = Number(next.day.slice(0, 4)); }
      const oneWay = b.miles != null ? tenthsOf(b.miles) : was.oneWayTenths;
      if (b.miles != null && oneWay == null) return out({ ok: false, error: 'Miles one way, like 6.4.' }, 400);
      const round = b.roundTrip != null ? b.roundTrip === true : was.roundTrip;
      if (b.miles != null || b.roundTrip != null) { next.oneWayTenths = oneWay!; next.roundTrip = round; next.tenths = tripTenths(oneWay!, round); if (b.miles != null) { next.how = 'typed'; next.road = false; } }
      if (b.use != null) next.use = b.use === 'commute' || isCommute(was.from, was.to, setup) ? 'commute' : 'business';
      const words = editWords(was, next); if (!words) return out({ ok: true, trip: was });
      const edits = [...(was.edits || []), { at: now, by: by.name, was: words }].slice(-20);
      await ref.set({ ...next, edits }, { merge: true });
      await audit(`Changed a trip on ${was.day}: ${words}.`, id);
      return out({ ok: true, trip: { ...was, ...next, edits } });
    }

    if (action === 'setup') {
      const patch: any = {};
      if (b.home !== undefined) {
        if (b.home === null || String(b.home?.label || '').trim() === '') patch.home = null;
        else { const p = await resolvePlace(db, tenantId, { label: b.home.label }, [], who); if (!p || p.lat == null) return out({ ok: false, error: 'That address isn’t on the map. Check it and try again.' }, 400); patch.home = { label: p.label, lat: p.lat, lng: p.lng, ref: 'home' }; }
      }
      if (b.homeIsMain !== undefined) patch.homeIsMain = b.homeIsMain === true;
      if (b.year != null) {
        const y = Number(b.year); if (!(y >= thisYear - 1 && y <= thisYear)) return out({ ok: false, error: 'This year or last.' }, 400);
        const start = b.start !== undefined ? cleanReading(b.start) : undefined; const end = b.end !== undefined ? cleanReading(b.end) : undefined;
        if (start === undefined && b.start !== undefined || end === undefined && b.end !== undefined) return out({ ok: false, error: 'Odometer readings are whole miles, like 41208.' }, 400);
        const cur = setup.odometer?.[String(y)] || {};
        const s2 = start !== undefined ? start : cur.start ?? null, e2 = end !== undefined ? end : cur.end ?? null;
        if (s2 != null && e2 != null && e2 < s2) return out({ ok: false, error: 'December 31’s reading is lower than January 1’s.' }, 400);
        patch.odometer = { ...(setup.odometer || {}), [String(y)]: { start: s2, end: e2 } };
      }
      await setupRef(db, tenantId, who).set(patch, { merge: true });
      const said = [patch.home !== undefined ? (patch.home ? 'set home' : 'cleared home') : '', patch.homeIsMain !== undefined ? (patch.homeIsMain ? 'said the business is run from home' : 'said the business isn’t run from home') : '',
        b.year != null ? `entered the ${b.year} odometer reading${b.start !== undefined && b.end !== undefined ? 's' : b.start !== undefined ? ' for January 1' : ' for December 31'}` : ''].filter(Boolean).join(', ');
      if (said) await audit(`Mileage log: ${said}.`, 'setup');
      return out({ ok: true });
    }

    if (action === 'export') {
      const year = Number(b.year) >= thisYear - 1 && Number(b.year) <= thisYear ? Number(b.year) : thisYear;
      await audit(`Downloaded the ${year} mileage log.`, `export_${year}`);
      return out({ ok: true, csv: logCsv(await tripsOf(db, tenantId, year, who), year) });
    }

    return out({ ok: false, error: 'Something went wrong.' }, 400);
}
