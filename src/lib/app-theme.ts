// src/lib/app-theme.ts — white or true black, for the whole app (front desk included). Chosen per device.
// "light" (the default), "dark", or "system" (follow the device). The choice lives in localStorage; anything that
// changes it announces "cf:theme" so every open screen follows at once. A tiny script in the root layout applies it
// before the page draws, so a black app never flashes white.

export type ThemePref = 'light' | 'dark' | 'system';
export const THEME_KEY = 'cf.theme';
const OLD_KEY = 'cf.desk.theme';   // the desk's own switch, before it became app-wide

export function readThemePref(): ThemePref {
  try { const v = localStorage.getItem(THEME_KEY) || localStorage.getItem(OLD_KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* private mode */ }
  return 'light';
}
export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' { return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref; }
export function setThemePref(p: ThemePref) {
  try { localStorage.setItem(THEME_KEY, p); localStorage.removeItem(OLD_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('cf:theme', { detail: p }));
}

/** The main app's own pages (the (app) folder). Public pages — booking, visit links, the shop — keep their own look. */
export const APP_ROUTES = ['academy', 'admin', 'ai-cfo', 'applicants', 'appointments', 'before-the-visit', 'bills', 'booths', 'campaigns', 'cases', 'classes', 'clients', 'consents', 'dashboard', 'diagnostics', 'discounts', 'disputes', 'documents', 'events', 'financials', 'getting-started', 'gift-cards', 'host', 'import', 'inbox', 'inventory', 'ledger', 'maintenance', 'memberships', 'message-log', 'messages', 'money', 'my-schedule', 'operations', 'opportunities', 'payday', 'payroll', 'pipeline', 'planner', 'pos', 'print-doc', 'quotes', 'receipts', 'referrals', 'refunds', 'rent', 'renters', 'reports', 'resources', 'retail', 'retail-orders', 'reviews', 'schedule', 'services', 'settings', 'staff', 'subscriptions', 'team-performance', 'tidy', 'timesheets', 'transactions', 'voice', 'waitlist'];

/** Runs in <head> before anything draws: dark on the app's own pages when this device chose it. */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||localStorage.getItem('${OLD_KEY}')||'light';var d=p==='dark'||(p==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);var seg=location.pathname.split('/')[1]||'';var app=${JSON.stringify(APP_ROUTES)}.indexOf(seg)>=0;if(d&&app){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;
