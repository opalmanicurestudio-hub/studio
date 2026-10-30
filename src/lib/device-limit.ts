// src/lib/device-limit.ts — HOW MANY DEVICES A BUYER CAN OPEN A DOWNLOAD ON (pure), with Digital protection (lib/addons).
// The shop sets a number per product (1 to 10, default 3). Each buyer's access record (lib/entitlements) keeps the
// devices it has been opened on: a short id for the device (a hash, never the browser's own value), a label such as
// "iPhone · Safari", and when it was first and last used. Opening on a device already on the list always works and
// never counts twice; a new device is added until the list is full, then refused until the shop resets the list.
//   · The limit counts per copy bought: three copies of a guide limited to 3 devices open on 9.
//   · It only applies while the add-on is live (active, with its tool on). Off, nothing is checked and nobody is
//     locked out; the list is kept, so turning it on again picks up where it was.
//   · A lower limit never takes a device away: the ones already listed keep opening it.
// Honest limits, said to the shop too: clearing a browser makes it a new device, and a screen can be photographed.
import { addonLive } from './addons';

export const DEFAULT_DEVICES = 3;
export const MAX_DEVICES = 10;
/** How many devices a record keeps, whatever the limit (copies multiply it). */
export const KEEP_DEVICES = 100;
/** A device seen again within this long isn't written again (its last-used time is close enough). */
export const TOUCH_MS = 60 * 60_000;

export type Device = { id: string; label: string; firstAt: string; lastAt: string };

/** The product's own limit: a number from 1 to 10, or null when it's off. */
export function deviceLimitOf(item: any): number | null {
  const n = Math.floor(Number(item?.digitalDeviceLimit) || 0);
  return n >= 1 ? Math.min(MAX_DEVICES, n) : null;
}

/** The limit for one buyer right now (null = no limit): only with the add-on live and the product's limit on. */
export function deviceCap(tenant: any, item: any, ent?: { copies?: number } | null): number | null {
  if (!addonLive(tenant, 'digitalProtection')) return null;
  const n = deviceLimitOf(item);
  return n ? n * Math.max(1, Math.floor(Number(ent?.copies) || 1)) : null;
}

/** The devices on a record, cleaned. */
export function devicesOf(ent: any): Device[] {
  const list = Array.isArray(ent?.devices) ? ent.devices : [];
  return list.filter((d: any) => d && typeof d.id === 'string' && d.id).slice(-KEEP_DEVICES).map((d: any) => ({
    id: String(d.id).slice(0, 40), label: String(d.label || 'A device').slice(0, 60), firstAt: String(d.firstAt || ''), lastAt: String(d.lastAt || d.firstAt || ''),
  }));
}

/** At (or past) the limit: a new device can't open it. */
export const atDeviceLimit = (ent: any, cap: number | null) => cap !== null && devicesOf(ent).length >= cap;

/**
 * One open from a device: known devices always pass (their last use moves on), a new one is added while there's room,
 * and refused when there isn't. `changed` says whether the list needs writing.
 */
export function deviceStep(devices: Device[], key: string, label: string, cap: number, nowIso: string): { ok: boolean; devices: Device[]; changed: boolean; known: boolean } {
  const i = devices.findIndex((d) => d.id === key);
  if (i >= 0) {
    const d = devices[i];
    const stale = !(Date.parse(nowIso) - Date.parse(d.lastAt) < TOUCH_MS) || d.label !== label;
    if (!stale) return { ok: true, devices, changed: false, known: true };
    const next = devices.slice(); next[i] = { ...d, label: label || d.label, lastAt: nowIso };
    return { ok: true, devices: next, changed: true, known: true };
  }
  if (devices.length >= cap) return { ok: false, devices, changed: false, known: false };
  return { ok: true, devices: [...devices, { id: key, label, firstAt: nowIso, lastAt: nowIso }].slice(-KEEP_DEVICES), changed: true, known: false };
}

/**
 * A device's label from its browser: "iPhone · Safari", "Mac · Chrome", "Windows PC · Edge". An iPad asks for the
 * desktop site and says it's a Mac, so a Mac with a touch screen (`touch`, from the page) is called an iPad.
 */
export function deviceLabel(ua: string, touch = false): string {
  const u = String(ua || '');
  const kind = /iPhone|iPod/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? (/Mobile/.test(u) ? 'Android phone' : 'Android tablet')
    : /CrOS/.test(u) ? 'Chromebook' : /Macintosh|Mac OS X/.test(u) ? (touch ? 'iPad' : 'Mac') : /Windows/.test(u) ? 'Windows PC' : /Linux/.test(u) ? 'Linux computer' : 'A device';
  const browser = /Edg(e|A|iOS)?\//.test(u) ? 'Edge' : /SamsungBrowser\//.test(u) ? 'Samsung Internet' : /OPR\/|Opera/.test(u) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(u) ? 'Firefox' : /CriOS\/|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return browser ? `${kind} · ${browser}` : kind;
}

/** Just the browser part of a label: "Safari" from "iPhone · Safari" ('' when it isn't known). */
export const browserOf = (label: string) => String(label || '').split(' · ')[1] || '';

/** Just the device part of a label: "iPhone" from "iPhone · Safari". */
const kindOf = (label: string) => String(label || 'A device').split(' · ')[0] || 'A device';

/** The devices in words for the buyer: "iPhone, Mac and iPad", "2 iPhones and a Mac". */
export function deviceNames(devices: Device[]): string {
  const counts = new Map<string, number>();
  for (const d of devices) { const k = kindOf(d.label); counts.set(k, (counts.get(k) || 0) + 1); }
  const parts = [...counts].map(([k, n]) => (n > 1 ? `${n} ${k === 'A device' ? 'other devices' : `${k}s`}` : k === 'A device' ? 'another device' : k));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What a buyer is told on a new device once the list is full. */
export function limitMessage(name: string, cap: number, devices: Device[], gift = false): string {
  const n = devices.length;
  const what = String(name || 'This download').trim() || 'This download';
  return `${what} opens on up to ${cap} device${cap === 1 ? '' : 's'}, and it’s already open on ${n}${n ? `: ${deviceNames(devices)}` : ''}. Open it on ${n === 1 ? 'that one' : 'one of those'}, or ${gift ? 'reply to your gift email to ask the shop' : 'ask the shop'} to reset your devices.`;
}

/** "First Oct 12 · last Oct 28", for the shop's list. */
export function deviceWhen(d: Device): string {
  const day = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
  const a = day(d.firstAt); const b = day(d.lastAt);
  return a ? (b ? `First ${a} · last ${b}` : `First ${a}`) : '';
}
