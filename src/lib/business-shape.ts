// src/lib/business-shape.ts — HOW THE BUSINESS WORKS (client and server safe). One person who sees every client and is
// also the desk, or a team; someone at a front desk or not; health information kept or not. Each is worked out from what
// the app can see (who's on the team, a front desk role, the kind of business), and the business can say otherwise in
// Settings → Business profile → How your business works (tenant.shape { solo?, desk? }; health is privacy.healthMode).
// Screens and messages read it here, and say "from Jessica" or "at the front desk" to match, instead of assuming a team
// with a front desk. Where a visit happens (the studio, the client's place, online, by phone) is the service's own
// (lib/service-place) and is read from the visit.
import { providersOf } from './solo';
import { privacyOf } from './health-privacy';

export type BusinessShape = {
  /** One person sees every client (and does the desk's jobs too). */
  solo: boolean;
  /** Someone at a front desk greets clients, checks them in and takes payment. */
  desk: boolean;
  /** The business keeps clients' health information (privacy health mode). */
  health: boolean;
  /** Who a client deals with when there's no front desk: the one provider's (or the owner's) first name, or ''. */
  person: string;
  /** Nobody else is on the team at all (only known from the team itself, never from a choice): what "only you can see
   *  it" may be said on. A business that chose "just me" with others still on its team isn't alone. */
  alone: boolean;
  /** Which answers were worked out rather than chosen (Settings says so). */
  guessed: { solo: boolean; desk: boolean; health: boolean };
  /** How many people are on the team, when it was known. */
  providers: number | null;
};

const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const active = (m: any) => m && m.isActive !== false && m.active !== false && m.status !== 'inactive' && m.status !== 'archived' && m.archived !== true;

/** How the business works. Pass the team when it's at hand (it's what the answers are worked out from); without it,
 *  or with nobody on it (not loaded, or not readable), what was chosen at signup is used. */
export function shapeOf(tenant: any, staff?: any[] | null): BusinessShape {
  const s = tenant?.shape && typeof tenant.shape === 'object' ? tenant.shape : {};
  const all = Array.isArray(staff) ? staff.filter(active) : null;
  const people = all ? providersOf(all) : [];
  const team = all && people.length ? all : null;   // an empty team tells nothing
  const providers = team ? people.length : null;
  const soloGuess = providers != null ? providers <= 1 : tenant?.teamSize === 'solo';
  const solo = typeof s.solo === 'boolean' ? s.solo : soloGuess;
  // A team is taken to have a front desk (or a counter clients are sent to) unless the owner says it doesn't.
  const desk = typeof s.desk === 'boolean' ? s.desk : !solo;
  const pv = privacyOf(tenant);
  const owner = team ? team.find((m: any) => m.role === 'owner') : null;
  // The one person who sees clients; or, when "just me" was chosen with others still listed, the owner.
  const person = solo ? first((providers === 1 ? people[0]?.name : '') || owner?.name || tenant?.ownerName || (team ? people[0]?.name : '') || '') : '';
  return { solo, desk, health: pv.healthMode, person, alone: providers === 1, providers,
    guessed: { solo: typeof s.solo !== 'boolean', desk: typeof s.desk !== 'boolean', health: typeof tenant?.privacy?.healthMode !== 'boolean' } };
}

// The team read on the server, kept a minute (a client's visit link is opened again and again; the business's own
// choices are read fresh each time, from the tenant passed in).
const teams = new Map<string, { at: number; staff: any[] }>();
/** Server: the business's shape, reading its team (at most once a minute). */
export async function shapeFromDb(db: any, tenantId: string, tenant: any): Promise<BusinessShape> {
  const hit = teams.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return shapeOf(tenant, hit.staff);
  try {
    const snap = await db.collection(`tenants/${tenantId}/staff`).get();
    const staff = snap.docs.map((d: any) => { const x = d.data() || {}; return { id: d.id, name: x.name, role: x.role, isRenter: x.isRenter, isActive: x.isActive, active: x.active, status: x.status, archived: x.archived }; });
    if (teams.size > 500) teams.clear();
    teams.set(tenantId, { at: Date.now(), staff });
    return shapeOf(tenant, staff);
  } catch { return shapeOf(tenant, null); }
}

/** What a client's page needs to word things (never the team list). */
export const publicShape = (b: BusinessShape) => ({ solo: b.solo, desk: b.desk, person: b.person });
export type PublicShape = ReturnType<typeof publicShape>;

// ── The words, so every screen and message says the same thing.
/** Who to tell or ask in person: "the front desk", "Jessica", or "us". `who` is the visit's own provider, when known. */
export function inPerson(b: Partial<PublicShape> | null | undefined, who?: string | null): string {
  if (!b || b.desk !== false) return 'the front desk';
  return first(who) || b.person || 'us';
}
/** Where something is collected: "at the front desk", "from Jessica", or "when you come in". */
export function pickupWhere(b: Partial<PublicShape> | null | undefined, who?: string | null): string {
  if (!b || b.desk !== false) return 'at the front desk';
  const n = first(who) || b.person; return n ? `from ${n}` : 'when you come in';
}
/** The same, as a short label ("Front desk", "With Jessica", "When you come in"). */
export function pickupLabel(b: Partial<PublicShape> | null | undefined, who?: string | null): string {
  if (!b || b.desk !== false) return 'Front desk';
  const n = first(who) || b.person; return n ? `With ${n}` : 'When you come in';
}
