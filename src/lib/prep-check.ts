// src/lib/prep-check.ts — BEFORE THE VISIT (approved design, canvas row 25). A maintenance service (a fill, a rebalance,
// a root touch-up, a lash fill) can ask the client a few quick questions before the visit, so the right time is saved
// and nobody is surprised. Each answer can:
//   add minutes · add priced add-ons (the business's own add-on services, so the quote always matches checkout) ·
//   switch to another service (a new set instead of a fill) · or be a SAFETY answer (redness, pain) — no price, the
//   visit is paused and the team calls.
// The client sees the effect as they tap, then "Here's your visit now" (service, time, an "up to" or "about" price,
// deposit) and "Good to know" (every fee or rule that could apply) before they agree. Nothing changes on the booking
// until the provider (or the desk) approves — that's round 2. Pure: used by the settings page, the client page, the API.
import { resolvePolicy } from '@/lib/booking-policies';
import { returnPlanOf } from '@/lib/rebook';

export interface PrepEffect { addMinutes?: number; addOns?: Array<{ id: string; qty: number }>; switchServiceId?: string | null; safety?: boolean; safetyText?: string | null }
export interface PrepOption { id: string; label: string; note?: string | null; effect: PrepEffect }
export interface PrepQuestion { id: string; label: string; help?: string | null; kind: 'choice' | 'photo'; options: PrepOption[] }
export interface PrepCheck { on: boolean; questions: PrepQuestion[]; version: number }
export type QuoteKind = 'upto' | 'about';
export type OnDay = 'fit_rebook' | 'extend_or_move' | 'provider';
export interface PrepSettings { quote: QuoteKind; topUp: { mode: 'off' | 'over' | 'percent'; overCents: number; pct: number }; autoMinutes: number; onDay: OnDay; onDayFeeCents: number }

const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const rid = () => Math.random().toString(36).slice(2, 9);
const int = (v: any, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

export function prepSettingsOf(tenant: any): PrepSettings {
  const p = tenant?.prepCheck || {}; const t = p.topUp || {};
  return { quote: p.quote === 'about' ? 'about' : 'upto',
    topUp: { mode: t.mode === 'over' || t.mode === 'percent' ? t.mode : 'off', overCents: int(t.overCents, 0, 1e7), pct: int(t.pct, 0, 100) },
    autoMinutes: p.autoMinutes === 0 ? 0 : int(p.autoMinutes ?? 15, 0, 120), onDay: ['extend_or_move', 'provider'].includes(p.onDay) ? p.onDay : 'fit_rebook', onDayFeeCents: int(p.onDayFeeCents, 0, 1e6) };
}

export function cleanCheck(raw: any, prevVersion = 0): PrepCheck {
  const questions: PrepQuestion[] = (Array.isArray(raw?.questions) ? raw.questions : []).slice(0, 5).map((q: any) => {
    const kind = q?.kind === 'photo' ? 'photo' : 'choice';
    const options: PrepOption[] = kind === 'photo' ? [] : (Array.isArray(q?.options) ? q.options : []).slice(0, 5).map((o: any) => {
      const e = o?.effect || {};
      const addOns = (Array.isArray(e.addOns) ? e.addOns : []).filter((a: any) => a?.id).slice(0, 4).map((a: any) => ({ id: s(a.id, 120), qty: int(a.qty || 1, 1, 20) }));
      const effect: PrepEffect = { ...(int(e.addMinutes, 0, 240) ? { addMinutes: int(e.addMinutes, 0, 240) } : {}), ...(addOns.length ? { addOns } : {}),
        ...(e.switchServiceId ? { switchServiceId: s(e.switchServiceId, 120) } : {}), ...(e.safety === true ? { safety: true, safetyText: s(e.safetyText, 240) || null } : {}) };
      return { id: s(o?.id, 40) || rid(), label: s(o?.label, 60), note: s(o?.note, 200) || null, effect };
    }).filter((o: PrepOption) => o.label);
    return { id: s(q?.id, 40) || rid(), label: s(q?.label, 140), help: s(q?.help, 160) || null, kind, options };
  }).filter((q: PrepQuestion) => q.label && (q.kind === 'photo' || q.options.length >= 2));
  return { on: raw?.on === true && questions.length > 0, questions, version: prevVersion + 1 };
}
export const checkOf = (service: any): PrepCheck | null => { const c = service?.prepCheck; return c?.on && Array.isArray(c.questions) && c.questions.length ? c as PrepCheck : null; };

/** Starting sets, by kind of maintenance. Add-ons are linked by the business (they're its own services). */
export const STARTERS: Array<{ key: string; name: string; questions: PrepQuestion[] }> = [
  { key: 'nail-fill', name: 'Nail fill or rebalance', questions: [
    { id: 'lift', label: 'How many nails are lifting or broken?', kind: 'choice', options: [{ id: 'n0', label: 'None', effect: {} }, { id: 'n2', label: '1–2', effect: { addMinutes: 10 } }, { id: 'n3', label: '3 or more', effect: { addMinutes: 20 } }] },
    { id: 'else', label: 'Has anyone removed or redone them since?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { addMinutes: 30 } }] },
    { id: 'skin', label: 'Any redness, swelling or pain around a nail?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { safety: true, safetyText: 'Please don’t come in with this — we’ll call you to talk it through and move your visit for free.' } }] },
    { id: 'photo', label: 'A photo of your hands', help: 'Optional — it helps us plan.', kind: 'photo', options: [] }] },
  { key: 'root', name: 'Root touch-up', questions: [
    { id: 'grow', label: 'How much regrowth is there?', kind: 'choice', options: [{ id: 'g1', label: 'Under 1 inch', effect: {} }, { id: 'g2', label: '1–2 inches', effect: { addMinutes: 15 } }, { id: 'g3', label: 'Over 2 inches', effect: { addMinutes: 30 } }] },
    { id: 'change', label: 'Do you want a color change?', kind: 'choice', options: [{ id: 'no', label: 'No, same color', effect: {} }, { id: 'yes', label: 'Yes', effect: { addMinutes: 45 } }] },
    { id: 'box', label: 'Any box dye or color at home since your last visit?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { addMinutes: 30 } }] },
    { id: 'photo', label: 'A photo of your roots', help: 'Optional — natural light is best.', kind: 'photo', options: [] }] },
  { key: 'lash', name: 'Lash fill', questions: [
    { id: 'left', label: 'Roughly how many lashes are left?', kind: 'choice', options: [{ id: 'l1', label: 'Most of them', effect: {} }, { id: 'l2', label: 'About half', effect: { addMinutes: 15 } }, { id: 'l3', label: 'Under half', effect: { addMinutes: 30 } }] },
    { id: 'irr', label: 'Any itching, swelling or redness?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { safety: true, safetyText: 'Please don’t come in with this — we’ll call you and move your visit for free.' } }] }] },
];

export type Answers = Record<string, string>;   // question id → option id ('photo' questions: an image URL)
export interface Quote {
  serviceId: string; serviceName: string; switched: boolean; addOns: Array<{ id: string; name: string; qty: number; priceEach: number }>;
  addMinutes: number; oldPrice: number; newPrice: number; oldMinutes: number; newMinutes: number; changed: boolean;
  safety: { text: string } | null; lines: string[];
}
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2)}`;

/** What the answers mean for this visit. `booked`: the visit as booked (price in dollars, duration in minutes). */
export function quoteFor(check: PrepCheck | null, service: any, services: any[], answers: Answers, booked?: { price?: number | null; duration?: number | null }): Quote {
  const byId = (id: string) => (services || []).find((x: any) => x.id === id) || null;
  const oldPrice = Number.isFinite(Number(booked?.price)) && booked?.price !== null ? Number(booked?.price) : Number(service?.price) || 0;
  const oldMinutes = Number(booked?.duration) || Number(service?.duration) || 0;
  let target = service; let addMinutes = 0; let safety: Quote['safety'] = null; const add = new Map<string, number>(); const lines: string[] = [];
  for (const q of check?.questions || []) {
    if (q.kind !== 'choice') continue; const o = q.options.find((x) => x.id === answers?.[q.id]); if (!o) continue; const e = o.effect || {};
    if (e.safety) { safety = { text: e.safetyText || 'Please don’t come in with this — we’ll call you and move your visit for free.' }; continue; }
    if (e.switchServiceId) { const t = byId(e.switchServiceId); if (t) target = t; }
    addMinutes += Number(e.addMinutes) || 0;
    for (const a of e.addOns || []) add.set(a.id, (add.get(a.id) || 0) + (Number(a.qty) || 1));
  }
  const switched = !!target && target?.id !== service?.id;
  const addOns = [...add.entries()].map(([id, qty]) => { const x = byId(id); return x ? { id, name: String(x.name || 'Add-on'), qty, priceEach: Number(x.price) || 0 } : null; }).filter(Boolean) as Quote['addOns'];
  const switchDelta = switched ? (Number(target.price) || 0) - (Number(service?.price) || 0) : 0;
  const newPrice = Math.max(0, oldPrice + switchDelta + addOns.reduce((n, a) => n + a.priceEach * a.qty, 0));
  const newMinutes = oldMinutes + addMinutes + (switched ? (Number(target.duration) || 0) - (Number(service?.duration) || 0) : 0);
  if (switched) lines.push(`${target.name} instead of ${service?.name || 'your service'}`);
  for (const a of addOns) lines.push(`${a.qty > 1 ? `${a.name} × ${a.qty}` : a.name}${a.priceEach ? ` · ${money(a.priceEach * a.qty)}` : ''}`);
  if (newMinutes !== oldMinutes) lines.push(`${newMinutes > oldMinutes ? 'About' : 'About'} ${Math.abs(newMinutes - oldMinutes)} ${newMinutes > oldMinutes ? 'more' : 'fewer'} minutes`);
  return { serviceId: String(target?.id || service?.id || ''), serviceName: String(target?.name || service?.name || 'Your visit'), switched, addOns, addMinutes, oldPrice, newPrice, oldMinutes, newMinutes,
    changed: !safety && (switched || addOns.length > 0 || newMinutes !== oldMinutes), safety, lines };
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface DayInput { addOns?: Array<{ id: string; qty: number }>; addMinutes?: number; switchServiceId?: string | null }

/** A one-question check with the provider's picks as its only answer — so the day's change is priced exactly like a pre-visit one. */
export function dayCheck(input: DayInput): PrepCheck {
  const addOns = (Array.isArray(input.addOns) ? input.addOns : []).map((x) => ({ id: String(x?.id || '').slice(0, 120), qty: Math.max(1, Math.min(20, Math.round(num(x?.qty) || 1))) })).filter((x) => x.id).slice(0, 12);
  return { on: true, version: 1, questions: [{ id: 'day', label: 'On the day', kind: 'choice', options: [{ id: 'pick', label: 'On the day', effect: { addMinutes: Math.max(0, Math.min(240, Math.round(num(input.addMinutes)))), addOns, switchServiceId: input.switchServiceId ? String(input.switchServiceId).slice(0, 120) : null } }] }] };
}

/** The no-answer rule: past the service's "late" window, suggest its late service (the return plan). */
export function noAnswerSuggestion(service: any, services: any[], weeksSince: number | null): { serviceId: string; serviceName: string; why: string } | null {
  if (weeksSince === null || !service?.lateServiceId) return null;
  const plan = returnPlanOf(service, services); if (weeksSince <= plan.maxWeeks || !plan.lateServiceId) return null;
  return { serviceId: plan.lateServiceId, serviceName: plan.lateServiceName || 'a different service', why: `${weeksSince} weeks since the last ${String(service.name || 'visit').toLowerCase()}` };
}

/** "Good to know": every rule or fee that could apply to this visit, in plain words — shown before they agree. */
export function goodToKnow(tenant: any, service: any, services: any[], check: PrepCheck | null, S: PrepSettings, provider?: string | null): string[] {
  const out: string[] = []; const byId = (id: string) => (services || []).find((x: any) => x.id === id) || null; const who = provider || 'your provider';
  for (const q of check?.questions || []) for (const o of q.options) {
    const e = o.effect || {}; if (e.safety) continue;
    if (o.note) { out.push(o.note); continue; }
    const bits: string[] = []; const t = e.switchServiceId ? byId(e.switchServiceId) : null;
    if (t) bits.push(`it becomes a ${String(t.name).toLowerCase()} (${money(Number(t.price) || 0)})`);
    for (const a of e.addOns || []) { const x = byId(a.id); if (x && Number(x.price)) bits.push(`${String(x.name).toLowerCase()}${a.qty > 1 ? ` × ${a.qty}` : ''} is ${money((Number(x.price) || 0) * (a.qty || 1))}`); }
    if (bits.length) out.push(`${q.label.replace(/\?$/, '')} — ${o.label.toLowerCase()}: ${bits.join(', ')}.`);
  }
  if (service?.lateServiceId) { const plan = returnPlanOf(service, services); const late = byId(service.lateServiceId);
    if (late) out.push(`More than ${plan.maxWeeks} weeks since your last ${String(service.name || 'visit').toLowerCase()}: it becomes a ${String(late.name).toLowerCase()} (${money(Number(late.price) || 0)}).`); }
  out.push(S.onDay === 'extend_or_move' ? `If there’s more to do on the day, ${who} shows you the change and the price first. If there’s time we’ll take it; if not, we’ll move your visit.`
    : S.onDay === 'provider' ? `If there’s more to do on the day, ${who} shows you the change and the price first — you can say no.`
    : `If there’s more to do on the day, ${who} shows you the change and the price first. We’ll do what fits in your time and book the rest — you can say no.`);
  if (S.onDayFeeCents) out.push(`If it’s a lot more than you told us and needs a new visit, there’s a ${money(S.onDayFeeCents / 100)} fee.`);
  out.push('We suggested this change, so moving or cancelling is free until you say yes.');
  try { const p = resolvePolicy(tenant, service); const h = Number(p.cancel.windowHours.value) || 0; const fv = Number(p.cancel.feeValue.value) || 0; const fm = p.cancel.feeMode.value;
    if (h && fm !== 'none' && fv) out.push(`Otherwise, changing or cancelling less than ${h} hours before is ${fm === 'percentage' ? `${fv}% of the price` : money(fv)}.`); } catch { /* no policy */ }
  return out;
}

/** When to send: your cancellation window plus a day, so a change never traps the client inside it. Lock: 6 h before. */
export function sendTimes(startMs: number, windowHours: number) { const w = Math.max(0, Math.min(168, Number(windowHours) || 24)); return { sendAt: startMs - (w + 24) * 3600e3, lockAt: startMs - 6 * 3600e3 }; }

export const priceWord = (S: PrepSettings) => (S.quote === 'about' ? 'About' : 'Up to');
export { money as prepMoney };
