// src/lib/team-alerts.ts — WHAT ABOUT THE TEAM BUZZES A MANAGER (Team → Alerts). Everything is on unless turned off.
//   tenant.teamAlerts = { late, noBreak, longBreak, overtime, documents, ownerOnly }
export type TeamAlertKey = 'late' | 'noBreak' | 'longBreak' | 'overtime' | 'documents';
export const TEAM_ALERTS: { key: TeamAlertKey; label: string; hint: string }[] = [
  { key: 'late', label: 'Clocked in late', hint: 'When someone clocks in late and it needs your approval.' },
  { key: 'noBreak', label: 'Worked without a break', hint: 'When a shift runs long with no proper break.' },
  { key: 'longBreak', label: 'Break ran over', hint: 'When a break goes past your limit.' },
  { key: 'overtime', label: 'Close to overtime', hint: 'When someone is near the weekly overtime line.' },
  { key: 'documents', label: 'Documents not signed', hint: 'When people still haven’t read and signed something that’s due.' },
];
export const teamAlertOn = (tenant: any, key: TeamAlertKey) => tenant?.teamAlerts?.[key] !== false;
/** Who hears about it: the owner and every manager, or the owner only. */
export const teamAlertOwnerOnly = (tenant: any) => tenant?.teamAlerts?.ownerOnly === true;
