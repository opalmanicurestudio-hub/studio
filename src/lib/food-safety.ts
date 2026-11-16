// src/lib/food-safety.ts — READY FOR THE INSPECTOR (design canvas "Food numbers": the binder). The food safety logs a
// kitchen keeps as the work is done, not filled in after: what each one is for, its limit, and whether a reading meets
// it. Kept in tenants/{t}/safetyLogs/{id} by the business's day (lib/food-safety-server), taken on the kitchen screen
// (with a PIN, so the log shows who) or by a manager from the Binder page.
//   delivery  cold food at 41°F or below on arrival, frozen at 0°F or below, hot at 135°F or above; refused when it isn't
//   cooling   cooked food from 135°F to 70°F within 2 hours, then to 41°F within 4 more (6 in all): started when it comes
//             off the heat, checked at each mark; missed, it's reheated to 165°F and cooled again, or thrown out
//   hot       hot holding at 135°F or above
//   cold      cold holding at 41°F or below (the line's reach-ins during service; the walk-in is on the closing list)
// The usual US numbers (the FDA Food Code); a business's health department may ask for its own.
// Also here: the binder's other parts, kept in their own collections (permits, incidents) and the certificates, permits
// and incidents in words. Pure.

export type LogKind = 'delivery' | 'cooling' | 'hot' | 'cold';
export const LOG_KINDS: { id: LogKind; label: string; limit: string }[] = [
  { id: 'delivery', label: 'Delivery', limit: 'Cold 41°F or below, frozen 0°F or below, hot 135°F or above' },
  { id: 'cooling', label: 'Cooling', limit: '70°F within 2 hours, then 41°F within 4 more' },
  { id: 'hot', label: 'Hot holding', limit: '135°F or above' },
  { id: 'cold', label: 'Cold holding', limit: '41°F or below' },
];
export type DeliveryKind = 'cold' | 'frozen' | 'hot';
export const COLD_MAX = 41, FROZEN_MAX = 0, HOT_MIN = 135, COOL_STAGE1 = 70, REHEAT = 165;
export const COOL_STAGE1_MIN = 120, COOL_TOTAL_MIN = 360;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A temperature as typed, in °F (−40 to 250, to a tenth), or null. */
export function cleanTemp(v: unknown): number | null {
  const s = String(v ?? '').trim(); if (!/^-?\d{1,3}(\.\d)?$/.test(s)) return null;
  const n = Number(s); return n >= -40 && n <= 250 ? n : null;
}
/** Whether a reading meets its limit. */
export function tempOk(kind: LogKind | DeliveryKind, tempF: number): boolean {
  if (kind === 'hot') return tempF >= HOT_MIN;
  if (kind === 'frozen') return tempF <= FROZEN_MAX;
  return tempF <= COLD_MAX;   // cold holding and cold deliveries
}
export function limitWords(kind: LogKind | DeliveryKind): string {
  return kind === 'hot' ? `${HOT_MIN}°F or above` : kind === 'frozen' ? `${FROZEN_MAX}°F or below` : `${COLD_MAX}°F or below`;
}

export type CoolCheck = { at: string; tempF: number; by: string };
export type CoolState = { state: 'cooling' | 'done' | 'missed'; stage: 1 | 2; dueAt: string; dueWords: string; missedWords: string | null };
/** Where a batch cooling stands: which mark it's working to (70°F by 2 hours, then 41°F by 6), when that's due, and
 *  whether it was missed (what to do then). */
export function coolState(startedAt: string, checks: CoolCheck[], now = Date.now(), timeZone?: string): CoolState {
  const clock = (ms: number) => clockIn(ms, timeZone);
  const t0 = Date.parse(startedAt); const sorted = [...checks].sort((a, b) => a.at.localeCompare(b.at));
  const by1 = t0 + COOL_STAGE1_MIN * 60000, by2 = t0 + COOL_TOTAL_MIN * 60000;
  const stage1 = sorted.find((c) => c.tempF <= COOL_STAGE1 && Date.parse(c.at) <= by1);
  const late1 = !stage1 && (now > by1 || sorted.some((c) => Date.parse(c.at) > by1));
  if (late1) return { state: 'missed', stage: 1, dueAt: new Date(by1).toISOString(), dueWords: `${COOL_STAGE1}°F by ${clock(by1)}`, missedWords: `It didn’t reach ${COOL_STAGE1}°F within 2 hours. Reheat it to ${REHEAT}°F and cool it again, or throw it out.` };
  if (!stage1) return { state: 'cooling', stage: 1, dueAt: new Date(by1).toISOString(), dueWords: `${COOL_STAGE1}°F by ${clock(by1)}`, missedWords: null };
  const stage2 = sorted.find((c) => c.tempF <= COLD_MAX && Date.parse(c.at) <= by2);
  if (stage2) return { state: 'done', stage: 2, dueAt: new Date(by2).toISOString(), dueWords: `${COLD_MAX}°F by ${clock(by2)}`, missedWords: null };
  if (now > by2 || sorted.some((c) => Date.parse(c.at) > by2)) return { state: 'missed', stage: 2, dueAt: new Date(by2).toISOString(), dueWords: `${COLD_MAX}°F by ${clock(by2)}`, missedWords: `It didn’t reach ${COLD_MAX}°F within 6 hours. Reheat it to ${REHEAT}°F and cool it again, or throw it out.` };
  return { state: 'cooling', stage: 2, dueAt: new Date(by2).toISOString(), dueWords: `${COLD_MAX}°F by ${clock(by2)}`, missedWords: null };
}
/** "2:45 PM" in the business's time zone (the device's own when none is given). */
export function clockIn(ms: number, timeZone?: string): string {
  try { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }); } catch { return new Date(ms).toISOString().slice(11, 16); }
}

export type LogInput = { kind: LogKind; item: string; tempF: number; supplier?: string | null; deliveryKind?: DeliveryKind; note?: string | null; startedAt?: string | null };
/** A log as typed, or what's wrong with it. A reading outside its limit needs what was done about it. */
export function cleanLog(raw: any, now = Date.now()): LogInput | { error: string } {
  const kind = String(raw?.kind || '') as LogKind; if (!LOG_KINDS.some((k) => k.id === kind)) return { error: 'Which log?' };
  const item = words(raw?.item, 80); if (!item) return { error: kind === 'delivery' ? 'What came in?' : 'What is it?' };
  const tempF = cleanTemp(raw?.tempF); if (tempF === null) return { error: 'The temperature, in °F, like 38 or 140.5.' };
  const note = words(raw?.note, 200) || null;
  if (kind === 'delivery') {
    const dk: DeliveryKind = raw?.deliveryKind === 'frozen' ? 'frozen' : raw?.deliveryKind === 'hot' ? 'hot' : 'cold';
    const supplier = words(raw?.supplier, 60) || null;
    if (!tempOk(dk, tempF) && !note) return { error: `That’s over ${limitWords(dk)}. Refuse it, and say so here (sent back, or what was done).` };
    return { kind, item, tempF, supplier, deliveryKind: dk, note };
  }
  if (kind === 'cooling') {
    // Started when it came off the heat: now, or a time typed in the last six hours (it was started before it was logged).
    const s = raw?.startedAt ? Date.parse(String(raw.startedAt)) : now;
    if (!Number.isFinite(s) || s > now + 60000 || s < now - COOL_TOTAL_MIN * 60000) return { error: 'When it came off the heat: within the last 6 hours.' };
    if (tempF < HOT_MIN && !note) return { error: `Cooling starts from ${HOT_MIN}°F or above. If it was cooler, say why (it was reheated, or it came from somewhere else).` };
    return { kind, item, tempF, startedAt: new Date(s).toISOString(), note };
  }
  if (!tempOk(kind, tempF) && !note) return { error: kind === 'hot' ? `That’s under ${HOT_MIN}°F. Reheat it to ${REHEAT}°F or throw it out, and say which.` : `That’s over ${COLD_MAX}°F. Say what was done (moved it, threw it out, called for service).` };
  return { kind, item, tempF, note };
}

// CERTIFICATES AND PERMITS (tenants/{t}/permits/{id}): what the business holds and when each runs out. A person's own
// (a food protection manager's certificate, a food handler card) names them. Never a license or ID number.
export type PermitKind = 'health' | 'liquor' | 'business' | 'fire' | 'manager' | 'handler' | 'other';
export const PERMIT_KINDS: { id: PermitKind; label: string; person: boolean }[] = [
  { id: 'health', label: 'Health permit', person: false },
  { id: 'liquor', label: 'Liquor license', person: false },
  { id: 'business', label: 'Business license', person: false },
  { id: 'fire', label: 'Fire inspection', person: false },
  { id: 'manager', label: 'Food protection manager', person: true },
  { id: 'handler', label: 'Food handler card', person: true },
  { id: 'other', label: 'Something else', person: false },
];
export const REMIND_DAYS = 60;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export type Permit = { id: string; kind: PermitKind; label: string; staffId: string | null; person: string | null; expires: string | null; note: string | null };
export function cleanPermit(raw: any): Omit<Permit, 'id'> | { error: string } {
  const k = PERMIT_KINDS.find((x) => x.id === raw?.kind); if (!k) return { error: 'Which kind?' };
  const label = words(raw?.label, 80) || k.label;
  const staffId = /^[A-Za-z0-9_-]{1,160}$/.test(String(raw?.staffId || '')) ? String(raw.staffId) : null;
  if (k.person && !staffId) return { error: 'Whose is it? Pick them from the team.' };
  const expires = raw?.expires ? String(raw.expires) : null; if (expires && (!DAY_RE.test(expires) || Number.isNaN(Date.parse(`${expires}T12:00:00Z`)))) return { error: 'When it runs out: a date.' };
  return { kind: k.id, label, staffId: k.person ? staffId : null, person: null, expires, note: words(raw?.note, 160) || null };
}
/** Days until it runs out (negative: it has), from a business day. */
export const daysLeft = (expires: string, today: string) => Math.round((Date.parse(`${expires}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
/** How it stands: fine, runs out soon (within 60 days), or has run out. */
export function permitState(p: { expires: string | null }, today: string): 'ok' | 'soon' | 'out' | 'none' {
  if (!p.expires) return 'none'; const d = daysLeft(p.expires, today); return d < 0 ? 'out' : d <= REMIND_DAYS ? 'soon' : 'ok';
}

// INCIDENTS (tenants/{t}/safetyIncidents/{id}): a guest's reaction or injury, written down the day it happens; and
// someone on the team sent home sick (kept off food until cleared). Kept short: what happened and what was done, never
// a diagnosis.
export type IncidentKind = 'guest' | 'sent_home';
export function cleanIncident(raw: any): { kind: IncidentKind; what: string; person: string | null; staffId: string | null; done: string | null; ate: string | null } | { error: string } {
  const kind: IncidentKind = raw?.kind === 'sent_home' ? 'sent_home' : 'guest';
  if (kind === 'sent_home') {
    const staffId = /^[A-Za-z0-9_-]{1,160}$/.test(String(raw?.staffId || '')) ? String(raw.staffId) : null; if (!staffId) return { error: 'Who was sent home? Pick them from the team.' };
    return { kind, what: 'Sent home sick, off food until cleared', person: null, staffId, done: null, ate: null };
  }
  const what = words(raw?.what, 500); if (!what) return { error: 'What happened?' };
  return { kind, what, person: words(raw?.person, 80) || null, staffId: null, done: words(raw?.done, 300) || null, ate: words(raw?.ate, 200) || null };
}

// EQUIPMENT AND SERVICE: kept as preventive maintenance plans (lib/maintenance), marked for the binder; these are the
// ones a kitchen is usually asked about.
export const SERVICE_PRESETS: { id: string; title: string; everyDays: number; description: string }[] = [
  { id: 'hood', title: 'Hood and duct cleaning', everyDays: 180, description: 'The kitchen hood, ducts and fans cleaned by a certified company. Keep the report.' },
  { id: 'suppression', title: 'Fire suppression inspection', everyDays: 180, description: 'The hood’s fire suppression system inspected. Keep the tag and the report.' },
  { id: 'grease', title: 'Grease trap pumped', everyDays: 90, description: 'The grease trap pumped out. Keep the hauler’s manifest.' },
  { id: 'pest', title: 'Pest control', everyDays: 30, description: 'The pest control company’s visit. Keep their report.' },
  { id: 'extinguishers', title: 'Fire extinguishers checked', everyDays: 365, description: 'Extinguishers inspected and tagged.' },
];
