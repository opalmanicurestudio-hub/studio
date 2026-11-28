// src/lib/public-business.ts — WHAT ANYONE MAY SEE OF A BUSINESS (design board "A public view of each business"). The
// booking page, the client portal, the walk-in screen, job applications and guest links used to read the business's
// whole record from the database, so anyone with a link could read every setting on it. They now ask the server
// (api/public/business), which reads the live record and hands back only what's listed here: the details guests are
// shown already. Anything else on the record, including anything added later, stays with the team until it's put on
// this list on purpose. Renters signed in to the team portal get the renter view below (design board "Renters off the
// full record"): this plus the few settings their screens use. Only the team and the business's own screens (kiosk,
// kitchen, check-in) read the full record.
// scripts/verify/public-business.verify.ts fails if a public page reads the record itself again, or touches a detail
// that's on neither this list nor its known-private list.
import { accessLockOf } from '@/lib/tenant-access';

/** Shown whole: these are what guests already see (contact details, look, the booking page, policies and fees). */
export const PUBLIC_FIELDS = [
  // Who and where
  'name', 'businessName', 'logoUrl', 'brandColor', 'color', 'tagline', 'description', 'phone', 'email', 'website', 'address',
  'studioAddress', 'timezone', 'timeZone', 'twilioPhoneNumber',
  // What kind of business, and which parts of the app are on
  'niche', 'businessType', 'businessSubtype', 'category', 'modules', 'menuSpanish', 'guestExperienceEnabled',
  // The booking page, the client portal and guest links
  'visitTimelineForClients', 'notificationDefaults', 'applicationQuestions', 'groupBooking', 'formRules',
  // Booking, deposit, cancellation, late and no-show policies, with their fees and windows
  'bookingRelease', 'bookingHorizonDays', 'bookingLeadHours', 'bookingLeadMinutes',
  'cancellationPolicy', 'cancellationPolicyText', 'cancellationFee', 'cancellationWindowHours', 'defaultCancellationMode',
  'noShowPolicy', 'noShowFee', 'noShowFeeMode', 'flatNoShowFee', 'lateArrivalPolicy', 'lateArrivalFee', 'lateArrivalGracePeriod',
  'autoCancelLateArrivals', 'rescheduleFee', 'rescheduleFeeWindowHours', 'allowGuestFeeDeferral', 'refundPolicy', 'timingPolicy',
  'depositPolicy', 'depositsLive', 'rebookDeposit', 'guardianPolicy', 'guardianProtocolEnabled',
  // Spaces to rent on the booking page: what renters are charged for, and the no-show rule for a space
  'incidentalCategories', 'boothNoShowPolicy',
] as const;

/** Shown in part: only these keys of a setting that also holds private ones (an API key, limits, an access code). A key
 *  with a dot is one key inside another (`fairUse.requirePhotos` is only that one of fairUse's keys). */
export const PUBLIC_PICKS: Record<string, readonly string[]> = {
  // Reminder and change cut-offs guests are told about (not the owner's phone, brief or the team's texts).
  // (and an older business's saved clock offset, used when it has no time zone).
  clientNotify: ['rescheduleCutoffHours', 'cancelHours', 'tzOffsetMinutes'],
  // Whether the rewards program is on, and its quiet-time bonus offered when booking (not what rewards cost the business,
  // its texting budget or how points affect the team's commission).
  loyalty: ['on', 'quiet', 'version'],
  // Health privacy mode and discreet messages (not how long records are kept or the team's sign-out time).
  privacy: ['healthMode', 'discreet'],
  // Refer a friend, as the friend and the client see it (not the business's margin on it).
  referrals: ['on', 'rewardCents', 'friendCents', 'unlock', 'months', 'cap', 'photos', 'arrival', 'layout', 'sections', 'motion', 'who', 'group', 'household'],
  // What a guest is offered when something isn't right, and the aftercare they're given (not the desk's limits, the
  // team's pay rules for a redo, cash refunds or fair-use checks).
  makingItRight: ['preset', 'policySince', 'reasons', 'fixes', 'redoWindowDays', 'serviceWindows', 'replyHours', 'aftercare', 'channels', 'afterPhotos',
    'reviews.on', 'reviews.googlePlaceId', 'fairUse.requirePhotos', 'fairUse.refundToOriginalCard'],
  retailSettings: ['timeZone', 'timezone', 'shopTagline', 'logoUrl', 'shopName', 'curbsideOffered'],
  kioskSettings: ['logoUrl', 'primaryColor', 'wordmarkUrl', 'theme', 'showWordmark', 'useSpecificHours', 'kioskSchedule'],
  giftCardSettings: ['online', 'onBooking', 'showcase', 'offers', 'designs', 'expiryYears'],
  automations: ['overtimeSuggest', 'extraProductSuggest'],
  orderAhead: ['on', 'curbside'],
};

/** Shown whole except these keys: what guests are shown, with the team's own settings kept back (the space-rental
 *  automation rules and renter discount, the team's booking-desk options, and when bookings are approved by themselves). */
export const PUBLIC_OMIT: Record<string, readonly string[]> = {
  bookingPageSettings: ['automationRules', 'renterDayDiscountPercent'],
  bookingPolicies: ['staffOpsLevel', 'renterDeskSupport', 'textAssist', 'overrunMessages'],
  bookingMode: ['autoApproveAfterVisits'],
};

/** On the record, read somewhere the public pages' code also reaches, but never needed by a public page: kept private.
 *  (The check lists these so a new one is a decision, not an accident.) */
export const KNOWN_PRIVATE = [
  'userId', 'ownerName', 'roles', 'staffPrivacy', 'agents', 'addons', 'voiceAgent', 'reconnect', 'tmhr', 'restocking',
  'subscriptionStatus', 'accessLocked', 'accessLockedAt', 'suspended', 'gracePeriodEndsAt', 'teamSize', 'movingIn', 'shape',
  'outreachRules',
] as const;

export type PublicBusiness = { id: string } & Record<string, any>;

/** The renter view adds these, whole: the document folders, the visit-readiness rules, and how the business is shaped
 *  (whether there's a front desk, and the owner's first name for "ask …" when there isn't), which the renter's portal
 *  screens use. Their own role's permissions are added too, and only theirs: the other roles, and the team's privacy
 *  settings, stay with the team. */
export const RENTER_FIELDS = ['docCollections', 'readiness', 'shape', 'teamSize', 'ownerName'] as const;

const DROP = Symbol('drop');
const plain = (v: unknown) => v !== undefined && typeof v !== 'function';
const isPlainObject = (v: any) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
/** As plain data only. A stored date becomes its ISO time and a map point its latitude and longitude; anything else
 *  that isn't plain data (a link to another record carries the server's own connection, keys included) is dropped. */
function clean(v: any, depth = 0): any {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v !== 'object' || depth > 40) return DROP;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  // (In a list, a dropped item leaves an empty place, so a list read by position, like a week's days, keeps its order.)
  if (Array.isArray(v)) return v.map((x) => { const c = clean(x, depth + 1); return c === DROP ? null : c; });
  if (!isPlainObject(v)) {
    const name = String(v?.constructor?.name || '');
    if (/Timestamp$/.test(name) && typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return null; } }
    if (/GeoPoint$/.test(name) && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) return { latitude: v.latitude, longitude: v.longitude };
    return DROP;
  }
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) { if (!plain(x)) continue; const c = clean(x, depth + 1); if (c !== DROP) o[k] = c; }
  return o;
}
const put = (o: Record<string, unknown>, k: string, v: unknown) => { const c = clean(v); if (c !== DROP) o[k] = c; };

/** The public view of a business's record. A business that's locked (paused, cancelled or past its grace) shows as
 *  closed, never why: only `accessLocked` and `suspended` are set, which is all lib/tenant-access needs. */
export function publicBusiness(id: string, t: any, now = Date.now()): PublicBusiness {
  const out: PublicBusiness = { id };
  if (!t || typeof t !== 'object') return out;
  for (const k of PUBLIC_FIELDS) if (plain(t[k])) put(out, k, t[k]);
  for (const [k, drop] of Object.entries(PUBLIC_OMIT)) {
    const v = t[k]; if (v === undefined) continue;
    // (A plain value, kept as stored by an older version of the setting, is shown as it is.)
    if (v === null || typeof v !== 'object') { if (plain(v)) put(out, k, v); continue; }
    if (Array.isArray(v) || !isPlainObject(v)) continue;
    const o: Record<string, unknown> = {}; for (const [kk, vv] of Object.entries(v)) if (!drop.includes(kk) && plain(vv)) put(o, kk, vv);
    out[k] = o;
  }
  for (const [k, keys] of Object.entries(PUBLIC_PICKS)) {
    const v = t[k]; if (!v || typeof v !== 'object' || Array.isArray(v) || !isPlainObject(v)) continue;
    const o: Record<string, any> = {};
    for (const kk of keys) {
      const [a, b] = kk.split('.');
      if (!b) { if (plain(v[a])) put(o, a, v[a]); continue; }
      const inner = v[a]; if (!inner || typeof inner !== 'object' || Array.isArray(inner) || !isPlainObject(inner) || !plain(inner[b])) continue;
      const c = clean(inner[b]); if (c === DROP) continue;
      o[a] = { ...(o[a] && typeof o[a] === 'object' ? o[a] : {}), [b]: c };
    }
    if (Object.keys(o).length) out[k] = o;
  }
  if (accessLockOf(t, now).locked) { out.accessLocked = true; out.suspended = true; }
  return out;
}

/** What a renter signed in to the team portal may see of the business (api/portal/business): the public view, plus
 *  RENTER_FIELDS and the renter role's own permissions. Pay rules, margins, limits, automations, paid add-ons, the other
 *  roles and anything added later stay with the team. */
export function renterBusiness(id: string, t: any, now = Date.now()): PublicBusiness {
  const out = publicBusiness(id, t, now);
  if (!t || typeof t !== 'object') return out;
  for (const k of RENTER_FIELDS) if (plain(t[k])) put(out, k, t[k]);
  const mine = t.roles && typeof t.roles === 'object' && !Array.isArray(t.roles) ? t.roles.renter : undefined;
  if (mine && typeof mine === 'object' && !Array.isArray(mine) && isPlainObject(mine)) {
    const r: Record<string, unknown> = {}; for (const k of ['name', 'caps']) if (plain(mine[k])) put(r, k, mine[k]);
    out.roles = { renter: r };
  }
  return out;
}
