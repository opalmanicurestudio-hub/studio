// src/lib/moments.ts — "MOMENTS": the personal touches at checkout (pure; the screen, the desk and the server all use it).
//   birthday   — within the business's window (the day / week / month); optional % off services, once a year
//   first      — their first visit: a welcome
//   milestone  — their Nth visit (5th, 10th, 25th, 50th by default); optional % off services at that visit
// A reward never combines with discount codes or team / family discounts — whichever is bigger applies.
export type MomentKind = 'birthday' | 'first' | 'milestone';
export interface Moment { kind: MomentKind; key: string; title: string; screenLine: string; deskLine: string; rewardPct: number; rewardLabel: string | null }
export interface MomentSettings {
  birthday: { on: boolean; window: 'day' | 'week' | 'month'; rewardPct: number };
  first: { on: boolean };
  milestones: { on: boolean; visits: number[]; rewardPct: number };
}
const pct = (v: any) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; };
export function momentSettingsOf(t: any): MomentSettings {
  const m = t?.clientScreen?.moments || {};
  const visits = (Array.isArray(m.milestones?.visits) ? m.milestones.visits : [5, 10, 25, 50]).map(Number).filter((n: number) => Number.isInteger(n) && n > 1 && n < 1000).sort((a: number, b: number) => a - b).slice(0, 8);
  return {
    birthday: { on: m.birthday?.on !== false, window: ['day', 'week', 'month'].includes(m.birthday?.window) ? m.birthday.window : 'week', rewardPct: pct(m.birthday?.rewardPct) },
    first: { on: m.first?.on !== false },
    milestones: { on: m.milestones?.on !== false, visits: visits.length ? visits : [5, 10, 25, 50], rewardPct: pct(m.milestones?.rewardPct) },
  };
}
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
/** Is their birthday inside the window around `now`? (Year ignored; handles Dec/Jan.) */
export function inBirthdayWindow(birthday: any, window: 'day' | 'week' | 'month', now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthday || '')); if (!m) return false;
  const mo = Number(m[2]) - 1, d = Number(m[3]);
  if (window === 'month') return mo === now.getMonth();
  const days = window === 'day' ? 0 : 3;   // the week = 3 days either side
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const b = new Date(y, mo, d); const diff = Math.round((b.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
    if (Math.abs(diff) <= days) return true;
  }
  return false;
}
/**
 * The moments for this visit. `completedVisits` = visits they've already finished (this one not included).
 * `used` = client.momentRewards (keys of rewards already given, e.g. "birthday-2026", "milestone-10").
 */
export function momentsFor(t: any, client: any, completedVisits: number, now = new Date(), hasVisitToday = true): Moment[] {
  if (!client) return [];
  const s = momentSettingsOf(t); const first = String(client.name || '').split(' ')[0] || 'there';
  const used = client.momentRewards || {}; const out: Moment[] = [];
  if (s.birthday.on && inBirthdayWindow(client.birthday, s.birthday.window, now)) {
    const key = `birthday-${now.getFullYear()}`; const r = used[key] ? 0 : s.birthday.rewardPct;
    out.push({ kind: 'birthday', key, title: `It’s ${first}’s birthday${s.birthday.window === 'day' ? '' : ' ' + s.birthday.window}`, screenLine: `Happy birthday, ${first}! 🎂`,
      deskLine: r ? `A ${r}% birthday treat on services is applied automatically.` : used[key] ? 'Their birthday treat was already used this year.' : 'Wish them a happy birthday.', rewardPct: r, rewardLabel: r ? `Birthday treat (${r}% off services)` : null });
  }
  if (hasVisitToday) {
    const thisVisit = completedVisits + 1;
    if (s.first.on && completedVisits === 0) out.push({ kind: 'first', key: 'first', title: `${first}’s first visit`, screenLine: `Welcome, ${first} — we’re so glad you’re here.`, deskLine: 'Their first visit — a warm welcome goes a long way.', rewardPct: 0, rewardLabel: null });
    if (s.milestones.on && s.milestones.visits.includes(thisVisit)) {
      const key = `milestone-${thisVisit}`; const r = used[key] ? 0 : s.milestones.rewardPct;
      out.push({ kind: 'milestone', key, title: `${first}’s ${ordinal(thisVisit)} visit`, screenLine: `This is your ${ordinal(thisVisit)} visit — thank you, ${first}!`,
        deskLine: r ? `A ${r}% thank-you on services is applied automatically.` : 'Thank them for coming back.', rewardPct: r, rewardLabel: r ? `${ordinal(thisVisit)}-visit thank-you (${r}% off services)` : null });
    }
  }
  return out;
}
/** The one reward to apply (the biggest), if any. */
export const bestMomentReward = (ms: Moment[]) => ms.filter((m) => m.rewardPct > 0).sort((a, b) => b.rewardPct - a.rewardPct)[0] || null;
