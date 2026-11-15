// src/lib/klair-floor.ts — KLAIR ON TONIGHT'S FLOOR (design canvas "Klair at the table"; lib/klair, api/klair). A team
// member asks "what's left for table 4?", "how long is the wait for 4?", "is the kitchen behind?" or "what's 86'd?" and
// she answers from the floor, the tabs and the kitchen as they are right now (lib/floor-server, lib/kitchen-pace-server,
// lib/menu-server). Questions only: nothing is changed from here.
import { readFloor, waitNow, type FloorRead } from '@/lib/floor-server';
import { paceNow } from '@/lib/kitchen-pace-server';
import { readMenu, type MenuItem } from '@/lib/menu-server';
import { passCourses, type ItemState } from '@/lib/guest-pass';
import { lateCourses, reportItem } from '@/lib/table-recovery';
import { minutesWords } from '@/lib/wait-line';
import type { Pace } from '@/lib/kitchen-pace';
import type { Plan } from '@/lib/klair';

const STAFF_WORDS: Record<ItemState, string> = { held: 'held', ordered: 'ordered', making: 'being made', on_way: 'ready at the pass', served: 'out' };
const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mins = (ms: number) => Math.max(0, Math.floor(ms / 60000));

/** The seated table a name means ("4", "table 4", "patio 2"): its own name or its label, exactly. */
export function findTable(read: FloorRead, said: string): FloorRead['seated'][number] | null {
  const want = norm(said).replace(/^table /, ''); if (!want) return null;
  const units = new Map<string, string>((read.session?.units || []).map((u: any) => [String(u.id), norm(u.name).replace(/^table /, '')]));
  return read.seated.find((t) => t.unitIds.some((u) => units.get(u) === want) || norm(t.nt.table).replace(/^table /, '') === want) || null;
}

/** What's left for one table: each course not out yet, a course running late, what the table told us, the tab so far. */
export function tableAnswer(t: FloorRead['seated'][number], party: any, now: number): string {
  const head = `${t.nt.table}${party?.name ? `, ${String(party.name).split(' ')[0]}` : ''}${party?.size ? `, ${party.size}` : ''}.`;
  const tab = Array.isArray(t.nt.tab) ? t.nt.tab : [];
  const late = new Map(lateCourses(tab as any, t.nt.tickets as any, t.nt.courses, now).map((c) => [c.n, c.overMin]));
  const courses = passCourses(tab, t.nt.tickets as any, t.nt.courses);
  const open = courses.filter((c) => c.state !== 'served');
  const parts = !courses.length ? ['Nothing ordered yet.'] : !open.length ? ['Everything ordered is out.']
    : open.map((c) => `${c.name} ${STAFF_WORDS[c.state]}: ${Array.from(new Set(c.items.filter((i) => i.state !== 'served').map((i) => i.name))).join(', ')}${late.get(c.n) ? `, ${late.get(c.n)} min past their usual time` : ''}.`);
  const said = t.report ? [`They told us something isn’t right: ${reportItem(String(t.report.label || 'Something else'), t.report.dish || null)}.`] : [];
  const total = Number(t.row?.total) || 0;
  const pay = total ? [`${money(total)} so far, ${t.row?.paidAt ? 'paid' : t.row?.checkAt ? 'check asked for' : 'not paid'}.`] : [];
  return [head, ...parts, ...said, ...pay].join(' ');
}

/** The wait list: how many, a quote for a party size, and who's next. */
export function waitAnswer(read: FloorRead, tenant: any, size: number | null, now: number): string {
  const waiting = [...read.parties, ...(read.lobby || [])].filter((p: any) => ['waiting', 'notified'].includes(String(p.status)))
    .sort((a: any, b: any) => String(a.joinedAt || '').localeCompare(String(b.joinedAt || '')));
  const n = waiting.length;
  const head = n ? `${n} ${n === 1 ? 'party' : 'parties'} waiting.` : 'Nobody is waiting.';
  let quote = '';
  if (size) { const lp = waitNow(read, tenant, { id: 'klair-ask', size, status: 'waiting', joinedAt: new Date(now).toISOString(), needs: [] }, now);
    quote = ` A party of ${size} now: ${lp.minutes === null ? 'no table seats them tonight as it stands' : minutesWords(lp.minutes).replace(/^About/, 'about').replace(/^Any minute now$/, 'any minute now')}.`; }
  const next = waiting[0]; const nextLine = next ? ` Next up: ${String(next.name || 'a party').split(' ')[0]}, ${Number(next.size) || 1}, waited ${mins(now - Date.parse(String(next.joinedAt || '')) || 0)} min.` : '';
  return `${head}${quote}${nextLine}`;
}

/** Whether the kitchen is keeping up (lib/kitchen-pace). */
export function paceAnswer(p: Pace): string {
  if (p.level === 'calm') return `The kitchen is keeping up${p.making ? `: ${p.making} ${p.making === 1 ? 'dish' : 'dishes'} being made` : ''}.`;
  return `About ${p.behindMin} minutes behind${p.level === 'slammed' ? ', and slammed' : ''}, ${p.making} ${p.making === 1 ? 'dish' : 'dishes'} being made. The host stand’s waits and pickup times already count it.`;
}

/** What's sold out, and what's nearly gone. */
export function soldOutAnswer(menu: MenuItem[]): string {
  const live = menu.filter((m) => m.onMenu);
  const out = live.filter((m) => m.soldOut || !m.inStock).map((m) => m.name);
  const low = live.filter((m) => !m.soldOut && m.inStock && m.canMake !== null && m.canMake > 0 && m.canMake <= 3).map((m) => `${m.name} (${m.canMake} left)`);
  if (!out.length && !low.length) return 'Nothing is sold out.';
  return [out.length ? `Sold out: ${out.slice(0, 10).join(', ')}.` : 'Nothing is sold out.', low.length ? `Running low: ${low.slice(0, 6).join(', ')}.` : ''].filter(Boolean).join(' ');
}

/** The answer to a floor question. */
export async function floorAnswer(db: any, T: string, tenant: any, plan: Plan, now = Date.now()): Promise<string> {
  if (plan.intent === 'kitchen') return paceAnswer(await paceNow(db, T, tenant));
  if (plan.intent === 'soldout') return soldOutAnswer(await readMenu(db, T.split('/')[1]));
  const read = await readFloor(db, T, tenant);
  if (!read.session) return 'There’s no service open right now.';
  if (plan.intent === 'wait') return waitAnswer(read, tenant, plan.size || null, now);
  if (!plan.table) return 'Which table?';
  const t = findTable(read, plan.table);
  if (!t) return `Table ${plan.table} isn’t seated right now.`;
  return tableAnswer(t, read.parties.find((p: any) => p.id === t.partyId), now);
}
