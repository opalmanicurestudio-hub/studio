// src/lib/message-settings.ts — WHAT THE CLIENT MESSAGES PAGE MAY CHANGE ON THE BUSINESS (api/message-settings). Each
// field is checked here, so the page can be used by anyone whose role runs the settings (Settings → Roles), not only
// the owner, without the business record being writable from a browser.
import { MESSAGE_KIND_BY_ID, validateOverride } from '@/lib/message-policy';

const CALLBACK_KEYS = ['summary', 'callerId', 'links', 'addDetails'];
const hour = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 23 ? n : null; };

export function checkMessageSetting(field: string, value: unknown): { ok: true; value: any } | { ok: false; error: string } {
  if (field === 'messageQuietHours.enabled') return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'On or off?' };
  if (field === 'messageQuietHours') {
    const v: any = value || {};
    const startHour = hour(v.startHour); const endHour = hour(v.endHour);
    if (startHour === null || endHour === null) return { ok: false, error: 'Pick hours between midnight and 11 pm.' };
    return { ok: true, value: { enabled: v.enabled !== false, startHour, endHour } };
  }
  if (field === 'addressPolicy') {
    const v: any = value || {};
    if (!['always', 'on_confirm', 'before_event'].includes(v.mode)) return { ok: false, error: 'Pick when the address is shared.' };
    const n = Math.round(Number(v.offsetHours));
    return { ok: true, value: { mode: v.mode, offsetHours: Number.isFinite(n) && n > 0 && n <= 720 ? n : 24, areaLabel: String(v.areaLabel || '').replace(/\s+/g, ' ').trim().slice(0, 80) } };
  }
  const cb = /^callbackEmail\.([A-Za-z]+)$/.exec(field);
  if (cb) return CALLBACK_KEYS.includes(cb[1]) && typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'Unknown setting.' };
  const mp = /^messagePolicy\.([a-z_]+)\.(emailEnabled|smsEnabled|offsetHours|body|subject|smsBody)$/.exec(field);
  if (mp) {
    const def = Object.prototype.hasOwnProperty.call(MESSAGE_KIND_BY_ID, mp[1]) ? MESSAGE_KIND_BY_ID[mp[1]] : null; const key = mp[2];
    if (!def) return { ok: false, error: 'Unknown message.' };
    if (key === 'emailEnabled' || key === 'smsEnabled') {
      if (typeof value !== 'boolean') return { ok: false, error: 'On or off?' };
      if (!def.canDisable && value === false) return { ok: false, error: def.mandatoryNote || `${def.label} always sends.` };
      return { ok: true, value };
    }
    if (key === 'offsetHours') {
      const n = Number(value);
      if (def.timing === 'immediate' || !Number.isFinite(n) || n < 0 || n > 720) return { ok: false, error: 'Pick a time up to 30 days.' };
      return { ok: true, value: n };
    }
    const text = typeof value === 'string' ? value.trim() : null;
    if (text === null) return { ok: false, error: 'Write the message, or leave it empty for the built-in wording.' };
    if (key === 'subject') return text.length <= 200 ? { ok: true, value: text } : { ok: false, error: 'Keep the subject under 200 characters.' };
    if (text.length > 2000) return { ok: false, error: 'Keep the message under 2,000 characters.' };
    const c = validateOverride(def.id, text);
    return c.ok ? { ok: true, value: text } : { ok: false, error: c.error || 'That wording can’t be used.' };
  }
  return { ok: false, error: 'Unknown setting.' };
}
