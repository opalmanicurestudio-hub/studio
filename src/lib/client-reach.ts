// src/lib/client-reach.ts — how a client reaches us (pure: server + browser). Texts only → Visit link → App with notifications.
export type Reach = 'texts' | 'link' | 'app' | 'app_push';
/** How a client reaches us, from their record. */
export function reachOf(c: any): { reach: Reach; label: string; detail: string | null } {
  const devices = (Array.isArray(c?.appDevices) ? c.appDevices : []).filter((d: any) => d?.token && !d.removedAt);
  if (devices.length) { const d = devices[devices.length - 1];
    return { reach: 'app_push', label: 'Notifications on', detail: `${d.platform || 'Phone'}${d.standalone ? ', saved to home screen' : ''} · since ${new Date(d.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` }; }
  if (c?.appInstalledAt) return { reach: 'app', label: 'Saved the app', detail: 'Notifications are off' };
  if (c?.linkLastUsedAt) return { reach: 'link', label: 'Uses their visit link', detail: `Last used ${new Date(c.linkLastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  return { reach: 'texts', label: 'Texts only', detail: null };
}

