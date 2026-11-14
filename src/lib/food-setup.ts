// src/lib/food-setup.ts — SET UP FOR FOOD AND DRINK (design canvas "Food setup"; api/food-setup; the page at
// settings/setup/food). A café, food truck, counter, restaurant or bar answers three questions (what it runs, how guests
// order, who's working) and gets a plan to look over before anything changes: where things are made (its stations,
// each with its own kitchen screen and printer), courses when it has table service, a starter menu with recipes and
// what each item costs to make (lib/food-starters), the tools that fit it (never switched here: the business chooses
// its tools, and what they cost, in Your ClarityFlow), and its own setup steps (lib/setup-guide). Pure.
import { DEFAULT_COURSES, stationsOf, type Course } from '@/lib/table-service';
import { moduleEnabled, type ModuleId } from '@/lib/modules';
import { chosenNiche, guessNiche } from '@/lib/niche';
import { FOOD_STARTERS, INGREDIENT_BY_KEY, ingredientsFor, likelyAllergens, perUse, starterCost, suggestPrice, unitOf, type FoodKind, type StarterItem } from '@/lib/food-starters';
import type { ToolId } from '@/lib/module-catalog';

export type { FoodKind } from '@/lib/food-starters';
export type OrderWay = 'counter' | 'table' | 'ahead' | 'drivethru';
export type TeamSize = 'solo' | 'small' | 'mid' | 'large';
export type FoodAnswers = { kind: FoodKind; ways: OrderWay[]; team: TeamSize };

export const FOOD_KINDS: { value: FoodKind; label: string; sub: string }[] = [
  { value: 'cafe', label: 'Coffee shop or café', sub: 'Espresso, tea, pastries, breakfast' },
  { value: 'truck', label: 'Food truck, stall or pop-up', sub: 'A short menu, often on the move' },
  { value: 'counter', label: 'Counter service', sub: 'Order at the counter, food brought or called' },
  { value: 'restaurant', label: 'Restaurant with table service', sub: 'Servers, courses, a host stand' },
  { value: 'bar', label: 'Bar', sub: 'Drinks first, a few plates' },
];
export const ORDER_WAYS: { value: OrderWay; label: string }[] = [
  { value: 'counter', label: 'At the counter' }, { value: 'table', label: 'At their table' },
  { value: 'ahead', label: 'Ahead, on their phone' }, { value: 'drivethru', label: 'Drive-thru' },
];
export const TEAM_SIZES: { value: TeamSize; label: string }[] = [
  { value: 'solo', label: 'Just me' }, { value: 'small', label: '2 to 5' }, { value: 'mid', label: '6 to 15' }, { value: 'large', label: '16 or more' },
];
const KINDS = new Set(FOOD_KINDS.map((k) => k.value)); const WAYS = new Set(ORDER_WAYS.map((w) => w.value)); const TEAMS = new Set(TEAM_SIZES.map((t) => t.value));
export const kindLabel = (k: FoodKind | string | null | undefined) => FOOD_KINDS.find((x) => x.value === k)?.label || 'Food and drink';

/** How each kind usually takes orders (what the question starts with). */
export function usualWays(kind: FoodKind): OrderWay[] {
  return kind === 'restaurant' ? ['table'] : kind === 'bar' ? ['counter', 'table'] : kind === 'truck' ? ['counter'] : ['counter', 'ahead'];
}
/** The answers, cleaned (null when the kind isn't one of ours); at least one way to order. */
export function cleanAnswers(raw: any): FoodAnswers | null {
  const kind = String(raw?.kind || '') as FoodKind; if (!KINDS.has(kind)) return null;
  const ways = Array.from(new Set((Array.isArray(raw?.ways) ? raw.ways : []).map(String).filter((w: string) => WAYS.has(w as OrderWay)))) as OrderWay[];
  const team = TEAMS.has(String(raw?.team) as TeamSize) ? String(raw.team) as TeamSize : 'small';
  return { kind, ways: ways.length ? ways : usualWays(kind), team };
}

/** Where things are made, for this kind (each gets its own kitchen screen and printer). */
export function stationsFor(a: FoodAnswers): string[] {
  return a.kind === 'cafe' ? ['Bar', 'Kitchen'] : a.kind === 'truck' ? ['Kitchen'] : a.kind === 'counter' ? ['Kitchen', 'Drinks'] : a.kind === 'bar' ? ['Bar', 'Kitchen'] : ['Kitchen', 'Bar'];
}
/** Courses, only with table service (a held course waits until the server fires it). */
export const coursesFor = (a: FoodAnswers): Course[] | null => (a.ways.includes('table') ? DEFAULT_COURSES : null);

/** Whether the business already set its own stations (the plan then keeps them unless the owner picks the new ones). */
export const hasOwnStations = (t: any) => Array.isArray(t?.kitchenSettings?.stations) && t.kitchenSettings.stations.length > 0;

export type ToolFit = { id: ToolId; gate: ModuleId | null; name: string; fit: 'needed' | 'helps' | 'not needed'; why: string; on: boolean };
/** The tools that fit, and the ones this business has on that it may not need. Never switched here. */
export function toolsFor(a: FoodAnswers, t: any): ToolFit[] {
  const solo = a.team === 'solo';
  const rows: Omit<ToolFit, 'on'>[] = [
    { id: 'lounge', gate: 'hospitality', name: 'Lounge and hospitality', fit: 'needed', why: a.ways.includes('table') ? 'The host stand, table service, kitchen screens and closing the night' : 'Kitchen screens, ordering ahead, the drive-thru and closing the night' },
    { id: 'books', gate: 'money', name: 'Automated bookkeeping', fit: 'helps', why: 'What each item really makes, after its cost' },
    { id: 'team', gate: 'team', name: 'Team and onboarding', fit: solo ? 'not needed' : 'needed', why: solo ? 'You said it’s just you' : 'Shifts, the time clock, timesheets and tips' },
    { id: 'classes', gate: 'classes_events', name: 'Classes and events', fit: a.kind === 'restaurant' || a.kind === 'bar' ? 'helps' : 'not needed', why: a.kind === 'restaurant' || a.kind === 'bar' ? 'Private parties and ticketed nights' : 'For businesses that run events' },
    { id: 'memberships', gate: 'memberships', name: 'Memberships and packages', fit: a.kind === 'cafe' ? 'helps' : 'not needed', why: a.kind === 'cafe' ? 'A coffee subscription or punch card' : 'For businesses with members' },
    { id: 'marketing', gate: 'marketing', name: 'Marketing and reputation', fit: 'helps', why: 'Bringing regulars back' },
    { id: 'renters', gate: 'booth_rental', name: 'Renting out space', fit: 'not needed', why: 'For businesses that rent space to others' },
    { id: 'kiosk', gate: 'kiosk', name: 'Front desk and walk-ins', fit: 'not needed', why: 'A check-in desk for appointments; orders have their own screens' },
    { id: 'academy', gate: 'academy', name: 'Online academy', fit: 'not needed', why: 'For businesses that sell courses' },
  ];
  return rows.map((r) => ({ ...r, on: r.gate ? moduleEnabled(t, r.gate) : true }));
}

export type PlanItem = { key: string; name: string; section: string; station: string; course: number | null; cost: number; target: number; suggested: number; allergens: string[]; lines: { name: string; amount: number; unit: string; cost: number }[] };
export type PlanIngredient = { key: string; name: string; category: string; container: string; cost: number; unit: string; perUse: number };
export type FoodPlan = { answers: FoodAnswers; stations: string[]; ownStations: string[] | null; courses: Course[] | null; tools: ToolFit[]; items: PlanItem[]; ingredients: PlanIngredient[] };

/** What's suggested for this business, from its answers. */
export function foodPlan(a: FoodAnswers, t: any): FoodPlan {
  const station = (s: string, all: string[]) => (all.includes(s) ? s : all[0]);
  const stations = stationsFor(a);
  const items = (FOOD_STARTERS[a.kind] || []).map((x: StarterItem) => {
    const cost = starterCost(x);
    return { key: x.key, name: x.name, section: x.section, station: station(x.station, stations), course: a.ways.includes('table') ? x.course : null, cost, target: x.target, suggested: suggestPrice(cost, x.target),
      allergens: likelyAllergens(x), lines: x.recipe.flatMap(([k, q]) => { const i = INGREDIENT_BY_KEY.get(k); return i ? [{ name: i.name, amount: q, unit: unitOf(i), cost: Math.round(perUse(i) * q * 100) / 100 }] : []; }) };
  });
  const ingredients = ingredientsFor(a.kind).map((i) => ({ key: i.key, name: i.name, category: i.category, container: i.container, cost: i.cost, unit: unitOf(i), perUse: perUse(i) }));
  return { answers: a, stations, ownStations: hasOwnStations(t) ? stationsOf(t) : null, courses: coursesFor(a), tools: toolsFor(a, t), items, ingredients };
}

/** A food business: it said it's food and drink (its kind of business, or at sign-up), or set up for food here as its
 *  main business (api/food-setup `primary`: nothing else about it, no services of its own). A business of another kind
 *  with a café or lounge inside it (a spa's tea bar) can set up its menu here and stays the business it is. */
export function isFoodBusiness(t: any): boolean {
  const chosen = chosenNiche(t); if (chosen) return chosen === 'hospitality';
  if (String(t?.businessType || '') === 'hospitality') return true;
  return t?.foodSetup?.primary === true;
}
/** Whether setting up for food here makes it the main business: it says it's food, or nothing says it's anything and it
 *  has no services of its own. */
export const foodIsMain = (t: any, hasServices: boolean) => !chosenNiche(t) && (String(t?.businessType || '') === 'hospitality' || guessNiche(t) === 'hospitality' || (guessNiche(t) === 'general' && !hasServices));
/** Its answers, as kept (null before it's set up). */
export const foodAnswersOf = (t: any): FoodAnswers | null => (t?.foodSetup?.kind ? cleanAnswers(t.foodSetup) : null);

/** Words for a share of a price, "21%". */
export const pct = (n: number) => `${Math.round(n * 100)}%`;
