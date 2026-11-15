// src/lib/jobs.ts — WHAT SOMEONE DOES ON A SHIFT, at a food business (design canvas "Jobs and home screens"). A person's
// job is kept on their team record (`job`, and `station` for a cook or a bartender). It decides the screen they open on
// when they sign in, the short menu they see, and how the pre-shift briefing counts them (lib/briefing jobOf). What
// they may do is still their role's (lib/permissions): a job never gives anyone more.
// Pure.
import type { Job } from '@/lib/briefing';

export type JobId = 'server' | 'host' | 'bartender' | 'barback' | 'cook' | 'expo' | 'runner' | 'busser' | 'dishwasher' | 'counter' | 'drive_thru' | 'shift_lead' | 'manager' | 'other';

export type JobDef = {
  id: JobId; name: string;
  /** How the pre-shift briefing counts them. */
  counts: Job;
  /** Where they work, asked when they're added: a station of the kitchen screen ('kitchen': the first that isn't the bar;
   *  'bar': the bar's). */
  station: 'kitchen' | 'bar' | null;
  /** The page they open on, and their short menu (pages of the app, or a station screen: see SCREEN_PAGES). */
  home: string | null; menu: string[];
  /** The role offered when they're added, when the business has it (they can pick another). */
  role: string;
  /** What it means for them, in a line. */
  line: string;
};

/** Station screens: pages that run full screen on their own, opened at /page/{business id}. */
export const SCREEN_PAGES = ['/kds', '/dish', '/barback', '/floor', '/drive-thru', '/host-stand'];
const EVERYONE = ['/messages', '/my-schedule'];

/** What managers and shift leads run the night from, and the station screens they look in on. */
export const TONIGHT = ['/briefing', '/host', '/menu', '/prep', '/close'];
export const STATION_SCREENS = ['/kds', '/dish', '/barback', '/floor', '/drive-thru', '/host-stand'];

export const JOBS: JobDef[] = [
  { id: 'server', name: 'Server', counts: 'server', station: null, home: '/tables', menu: ['/tables', '/clear', ...EVERYONE], role: 'staff',
    line: 'Opens on My tables: their tables, what’s ready at the pass, and guests asking for them.' },
  { id: 'host', name: 'Host', counts: 'host', station: null, home: '/host', menu: ['/host', '/tables', ...EVERYONE], role: 'front_desk',
    line: 'Opens on the host stand: who’s waiting, who’s booked, and which tables are free.' },
  { id: 'bartender', name: 'Bartender', counts: 'bar', station: 'bar', home: '/kds', menu: ['/kds', '/tables', ...EVERYONE], role: 'staff',
    line: 'Opens on the bar’s kitchen screen. On the bar tablet, they sign in with their PIN.' },
  { id: 'barback', name: 'Barback', counts: 'support', station: null, home: '/barback', menu: ['/barback', ...EVERYONE], role: 'assistant',
    line: 'Opens on the barback screen: what the bar is asking for, and what’s running low.' },
  { id: 'cook', name: 'Cook', counts: 'kitchen', station: 'kitchen', home: '/kds', menu: ['/kds', '/prep', ...EVERYONE], role: 'assistant',
    line: 'Opens on their station’s kitchen screen. On the kitchen tablet, they sign in with their PIN.' },
  { id: 'expo', name: 'Expo', counts: 'support', station: null, home: '/kds', menu: ['/kds', '/tables', ...EVERYONE], role: 'assistant',
    line: 'Opens on the kitchen screen’s expo view: every station’s plates, coming together at the pass.' },
  { id: 'runner', name: 'Runner', counts: 'support', station: null, home: '/tables', menu: ['/tables', '/clear', ...EVERYONE], role: 'assistant',
    line: 'Opens on the tables, to see what’s ready at the pass and where it goes.' },
  { id: 'busser', name: 'Busser', counts: 'support', station: null, home: '/clear', menu: ['/clear', ...EVERYONE], role: 'assistant',
    line: 'Opens on Clear tables: which tables just left, and what each needs to be ready again.' },
  { id: 'dishwasher', name: 'Dishwasher', counts: 'support', station: null, home: '/dish', menu: ['/dish', ...EVERYONE], role: 'assistant',
    line: 'Opens on the dish screen: what’s heading their way, calls from the line, and the machine check.' },
  { id: 'counter', name: 'Counter', counts: 'support', station: null, home: '/pos', menu: ['/pos', ...EVERYONE], role: 'front_desk',
    line: 'Opens on the front desk, to take orders and payments at the counter.' },
  { id: 'drive_thru', name: 'Drive-thru', counts: 'support', station: null, home: '/drive-thru', menu: ['/drive-thru', ...EVERYONE], role: 'front_desk',
    line: 'Opens on the drive-thru lane screen.' },
  { id: 'shift_lead', name: 'Shift lead', counts: 'manager', station: null, home: '/briefing', menu: [...TONIGHT, ...EVERYONE], role: 'shift_lead',
    line: 'Opens on the pre-shift briefing, with the night’s pages and every station screen in their menu.' },
  { id: 'manager', name: 'Manager', counts: 'manager', station: null, home: '/briefing', menu: [...TONIGHT, ...EVERYONE], role: 'manager',
    line: 'Opens on the pre-shift briefing, with the night’s pages and every station screen in their menu.' },
  { id: 'other', name: 'Something else', counts: 'other', station: null, home: null, menu: [], role: 'staff',
    line: 'Opens on the dashboard, with the everyday menu.' },
];
const BY_ID = new Map(JOBS.map((j) => [j.id, j]));

/** A job by its id, or null (an id that isn't one of ours counts as none). */
export const jobDef = (id: unknown): JobDef | null => BY_ID.get(String(id || '') as JobId) || null;
/** Their job, from their team record. */
export const jobOfStaff = (staff: any): JobDef | null => jobDef(staff?.job);
/** A job that runs the night: their menu has the night's pages and every station screen. */
export const runsTheNight = (j: JobDef | null) => !!j && (j.id === 'manager' || j.id === 'shift_lead');
/** Kitchen-side jobs: they may say an allergy was seen, and set tonight's counts, from their own phone. */
export const KITCHEN_SIDE: JobId[] = ['cook', 'bartender', 'expo', 'shift_lead', 'manager'];

/** The station a job asks for, as the business names it: the bar's, or the first that isn't the bar. */
export function stationFor(j: JobDef | null, stations: string[]): string | null {
  if (!j?.station || !stations.length) return null;
  const isBar = (s: string) => s.trim().toLowerCase() === 'bar';
  return j.station === 'bar' ? stations.find(isBar) || null : stations.find((s) => !isBar(s)) || stations[0];
}
/** A station that's still one of the business's, or null. */
export const keptStation = (s: unknown, stations: string[]) => { const v = String(s || '').trim(); return stations.find((x) => x.toLowerCase() === v.toLowerCase()) || null; };

/** The address of a page in someone's menu: a station screen at /page/{business id} (the kitchen screen opened at their
 *  station, or in expo view for expo), anything else as it is. */
export function pageHref(href: string, tenantId: string, o: { job?: JobDef | null; station?: string | null } = {}): string {
  if (!SCREEN_PAGES.includes(href)) return href;
  const base = `${href}/${tenantId}`;
  if (href !== '/kds' || !o.job) return base;
  const q = new URLSearchParams();
  if (o.job.id === 'expo') q.set('view', 'expo'); else if (o.station) q.set('station', o.station);
  // On their own phone, the kitchen screen opens as them (a shared tablet that's set up keeps its own key).
  if (o.job.home === '/kds') q.set('me', '1');
  const s = q.toString(); return s ? `${base}?${s}` : base;
}

/** Where someone with this job opens when they sign in (null: the dashboard, as before). */
export function homeOf(j: JobDef | null, tenantId: string, station?: string | null): string | null {
  if (!j?.home) return null;
  return pageHref(j.home, tenantId, { job: j, station });
}

/** The jobs asked about when someone's added: a food business only. */
export const JOB_IDS: JobId[] = JOBS.map((j) => j.id);
/** A job id as saved: one of ours, or null. */
export const cleanJob = (v: unknown): JobId | null => (jobDef(v)?.id ?? null);
