// src/lib/permissions.ts — WHO CAN DO WHAT. One list of things a person can be allowed to do (capabilities), roles that
// bundle them, and one check — can() — used by every screen, every server route and (through staffDirectory) the
// database rules.
//
//   Roles live on the business: tenant.roles = { [roleId]: { name, caps: string[], base?: string } }.
//   A team member's staff.role is a role id. Built-in ids (owner, admin, manager, staff, front_desk, assistant,
//   renter) work with no setup; a business can rename them, change what they allow, or add its own.
//   The owner can always do everything — so nobody can lock themselves out.
//
// Presets per kind of business only change the starting names and the suggested roles ("Stylist", "Therapist",
// "Trainer", "Artist", "Server"); the capabilities are the same everywhere, so screens never check a trade word.

export type Cap =
  | 'bookings.all' | 'bookings.manage' | 'checkout.take' | 'checkout.discount' | 'checkout.refund'
  | 'clients.contact' | 'clients.notes' | 'clients.export' | 'clients.delete' | 'clients.message'
  | 'team.view' | 'team.manage' | 'team.pay' | 'team.announce' | 'schedule.manage' | 'time.approve' | 'hiring.manage'
  | 'documents.manage' | 'money.view' | 'money.payroll' | 'money.manage'
  | 'services.manage' | 'inventory.manage' | 'marketing.manage' | 'settings.manage';

export const CAPS: { group: string; items: { id: Cap; label: string; hint?: string }[] }[] = [
  { group: 'Bookings and checkout', items: [
    { id: 'bookings.all', label: 'See everyone’s bookings', hint: 'Otherwise only their own' },
    { id: 'bookings.manage', label: 'Book, move and cancel any visit' },
    { id: 'checkout.take', label: 'Take payments' },
    { id: 'checkout.discount', label: 'Give discounts and change prices' },
    { id: 'checkout.refund', label: 'Refund payments' },
  ] },
  { group: 'Clients', items: [
    { id: 'clients.contact', label: 'See phone numbers and emails' },
    { id: 'clients.notes', label: 'Read health and care notes' },
    { id: 'clients.message', label: 'Message clients from the business' },
    { id: 'clients.export', label: 'Export the client list' },
    { id: 'clients.delete', label: 'Delete clients' },
  ] },
  { group: 'Team', items: [
    { id: 'team.view', label: 'See the team list and who’s working' },
    { id: 'team.announce', label: 'Post announcements to the whole team' },
    { id: 'schedule.manage', label: 'Build the schedule and answer requests' },
    { id: 'time.approve', label: 'Fix and approve time clock hours' },
    { id: 'team.manage', label: 'Add and edit team members, roles and app access' },
    { id: 'team.pay', label: 'See other people’s pay and earnings' },
    { id: 'hiring.manage', label: 'Hiring and applicants' },
    { id: 'documents.manage', label: 'Handbooks and documents' },
  ] },
  { group: 'Money', items: [
    { id: 'money.view', label: 'See sales, reports and the business’s numbers' },
    { id: 'money.payroll', label: 'Run payroll' },
    { id: 'money.manage', label: 'Bills, payouts and the books' },
  ] },
  { group: 'The business', items: [
    { id: 'services.manage', label: 'Services and prices' },
    { id: 'inventory.manage', label: 'Products and stock' },
    { id: 'marketing.manage', label: 'Campaigns, discounts and reviews' },
    { id: 'settings.manage', label: 'Business settings' },
  ] },
];
export const ALL_CAPS: Cap[] = CAPS.flatMap((g) => g.items.map((i) => i.id));

/** The capabilities that make someone a manager in the database rules and on the server (they act on other people). */
export const MANAGER_CAPS: Cap[] = ['team.manage', 'schedule.manage', 'time.approve', 'money.payroll', 'settings.manage'];

export type RoleDef = { name: string; caps: Cap[]; base?: string; about?: string };

const FRONT: Cap[] = ['bookings.all', 'bookings.manage', 'checkout.take', 'clients.contact', 'clients.message', 'team.view'];
const PROVIDER: Cap[] = ['checkout.take', 'clients.contact', 'clients.message', 'team.view'];
const MANAGER: Cap[] = ALL_CAPS.filter((c) => !['money.manage', 'settings.manage', 'clients.delete', 'clients.export'].includes(c));

/** Built-in roles. `staff` is the everyday provider role (and what anyone with an unknown role gets). */
export const BUILT_IN: Record<string, RoleDef> = {
  owner: { name: 'Owner', caps: ALL_CAPS, about: 'Everything, always.' },
  admin: { name: 'Admin', caps: ALL_CAPS, about: 'Everything the owner can do.' },
  manager: { name: 'Manager', caps: MANAGER, about: 'Runs the team and the day; no books or business settings.' },
  front_desk: { name: 'Front desk', caps: FRONT, about: 'The whole calendar, check-in and checkout.' },
  staff: { name: 'Provider', caps: PROVIDER, about: 'Their own clients and visits.' },
  assistant: { name: 'Assistant', caps: ['team.view'], about: 'Helps providers; sees their own schedule and pay.' },
  renter: { name: 'Renter', caps: [], about: 'Runs their own business in your space.' },
};

/** Starting names for the everyday roles, by kind of business. Only names — what they allow is the same. */
export const NICHE_NAMES: Record<string, Partial<Record<string, string>>> = {
  salon: { staff: 'Stylist / tech', assistant: 'Assistant' },
  spa: { staff: 'Therapist', assistant: 'Spa attendant' },
  fitness: { staff: 'Trainer', front_desk: 'Front desk', assistant: 'Floor staff' },
  tattoo: { staff: 'Artist', assistant: 'Apprentice' },
  hospitality: { staff: 'Server', front_desk: 'Host', assistant: 'Support' },
  events: { staff: 'Coordinator', assistant: 'Event crew' },
  shop: { staff: 'Sales associate', front_desk: 'Cashier', assistant: 'Stock' },
};
/** Extra roles worth offering when a business of this kind sets up its team (each built on a built-in). */
export const NICHE_EXTRAS: Record<string, { id: string; def: RoleDef }[]> = {
  salon: [{ id: 'educator', def: { name: 'Educator', base: 'staff', caps: [...PROVIDER, 'documents.manage', 'hiring.manage'] } }],
  tattoo: [{ id: 'shop_manager', def: { name: 'Shop manager', base: 'manager', caps: MANAGER } }],
  hospitality: [{ id: 'kitchen', def: { name: 'Kitchen', base: 'assistant', caps: ['team.view'] } }, { id: 'shift_lead', def: { name: 'Shift lead', base: 'front_desk', caps: [...FRONT, 'schedule.manage', 'time.approve', 'checkout.discount'] } }],
  fitness: [{ id: 'class_coach', def: { name: 'Class coach', base: 'staff', caps: [...PROVIDER, 'bookings.all'] } }],
  events: [{ id: 'lead', def: { name: 'Event lead', base: 'manager', caps: [...FRONT, 'schedule.manage', 'time.approve', 'team.announce'] } }],
  shop: [{ id: 'stock_lead', def: { name: 'Stock lead', base: 'assistant', caps: ['team.view', 'inventory.manage'] } }],
};

function withPrivacy(caps: Cap[], p: any): Cap[] {
  const set = new Set<Cap>(caps); const t = (k: string, cap: Cap, dflt: string) => { const v = String(p?.[k] || dflt); if (v === 'all_staff') set.add(cap); else set.delete(cap); };
  t('clientContact', 'clients.contact', 'all_staff'); t('careNoteContents', 'clients.notes', 'admins_only'); t('financials', 'money.view', 'admins_only');
  if (p?.staffMessaging === false) set.delete('clients.message'); else if (caps.includes('clients.message') || p?.staffMessaging === true) set.add('clients.message');
  return [...set];
}
const clean = (caps: any): Cap[] => Array.isArray(caps) ? caps.filter((c: any) => (ALL_CAPS as string[]).includes(String(c))) as Cap[] : [];

/** Every role this business has: built-ins (with its own names and changes) plus its own roles. */
export function rolesFor(tenant: any): Record<string, RoleDef & { builtIn: boolean }> {
  const kind = String(tenant?.businessType || tenant?.category || '');
  const names = NICHE_NAMES[kind] || {};
  const own: Record<string, any> = (tenant && typeof tenant.roles === 'object' && tenant.roles) || {};
  const out: Record<string, RoleDef & { builtIn: boolean }> = {};
  for (const [id, d] of Object.entries(BUILT_IN)) {
    const o = own[id] || {};
    let caps: Cap[] = id === 'owner' ? ALL_CAPS : o.caps ? clean(o.caps) : d.caps;
    // Until a business changes a role, its privacy choices (Settings → privacy) shape the everyday roles.
    if (!o.caps && ['staff', 'assistant', 'front_desk'].includes(id)) caps = withPrivacy(caps, tenant?.staffPrivacy);
    out[id] = { ...d, name: String(o.name || names[id] || d.name), caps, builtIn: true };
  }
  for (const [id, o] of Object.entries(own)) if (!BUILT_IN[id] && o && typeof o === 'object' && !o.deleted) out[id] = { name: String(o.name || id), caps: clean(o.caps), base: o.base, about: o.about, builtIn: false };
  return out;
}

/** What this role allows at this business. Unknown roles get the everyday provider role. */
export function capsFor(tenant: any, role?: string | null): Cap[] {
  const r = String(role || 'staff');
  if (r === 'owner') return ALL_CAPS;
  const all = rolesFor(tenant); return (all[r] || all.staff).caps;
}

/** THE check. `who` is a role id, or anything with a .role (a staff record, an actor). The business owner always can. */
export function can(tenant: any, who: string | { role?: string | null; isOwner?: boolean; isTenantOwner?: boolean } | null | undefined, cap: Cap): boolean {
  if (who && typeof who === 'object' && (who.isOwner || who.isTenantOwner)) return true;
  const role = typeof who === 'string' ? who : who?.role;
  if (role === 'owner') return true;
  return capsFor(tenant, role).includes(cap);
}

/** Does this role act on other people (rules + server "manager")? */
export function isManagerRole(tenant: any, role?: string | null): boolean {
  if (['owner', 'admin', 'manager'].includes(String(role || ''))) return true;
  const c = capsFor(tenant, role); return MANAGER_CAPS.some((x) => c.includes(x));
}

/** A safe role id from a name: "Shift lead" → "shift_lead" (never a built-in's id). */
export function roleIdFrom(name: string, taken: string[] = []): string {
  let base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'role';
  if (BUILT_IN[base]) base = `${base}_custom`;
  let id = base; let n = 2; while (taken.includes(id)) id = `${base}_${n++}`;
  return id;
}

/** Roles a person may hand out: only the owner gives owner/admin; nobody gives a role with more than they have. */
export function assignableRoles(tenant: any, who: { role?: string | null; isOwner?: boolean; isTenantOwner?: boolean } | string | null | undefined): string[] {
  const mine = typeof who === 'object' && who && (who.isOwner || who.isTenantOwner) ? ALL_CAPS : capsFor(tenant, typeof who === 'string' ? who : who?.role);
  const owner = (typeof who === 'object' && !!who && !!(who.isOwner || who.isTenantOwner)) || (typeof who === 'string' ? who : who?.role) === 'owner';
  return Object.entries(rolesFor(tenant)).filter(([id, d]) => {
    if (id === 'owner') return owner;
    if (id === 'admin') return owner || mine.length === ALL_CAPS.length;
    return d.caps.every((c) => mine.includes(c));
  }).map(([id]) => id);
}
