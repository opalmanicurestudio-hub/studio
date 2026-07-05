/**
 * voice-utils — shared server-side helpers for the AI receptionist API routes.
 *
 * SERVER ONLY. Do not import from client components — no 'use client' here on
 * purpose. These routes run under the Node runtime on Vercel.
 *
 * Covers three things every voice route needs:
 *   1. Shared-secret auth (x-voice-secret header vs VOICE_AGENT_SECRET env var).
 *      Fails CLOSED — if the env var isn't set, every request is rejected.
 *   2. Phone normalization. Caller ID arrives E.164 (+13365551234) from the
 *      voice platform, but client docs may hold any format staff typed over
 *      the years. Comparison is always on the last 10 digits.
 *   3. Timezone-correct date math WITHOUT date-fns. The client-side
 *      useSmartAvailability hook runs in the salon's browser, so `new Date()`
 *      math is implicitly salon-local. These routes run on Vercel in UTC, so
 *      "8 AM business open" must be computed as 8 AM *in the tenant's
 *      timezone* and converted to a UTC instant. Uses Intl only — no new
 *      dependencies.
 */

import type { NextRequest } from 'next/server';

// ── Auth ─────────────────────────────────────────────────────────────────────

export function verifyVoiceSecret(req: NextRequest): boolean {
  const secret = process.env.VOICE_AGENT_SECRET;
  if (!secret) return false; // fail closed: unset secret means no access
  return req.headers.get('x-voice-secret') === secret;
}

// ── Retell tool-call envelope ────────────────────────────────────────────────

/**
 * Retell does NOT post tool arguments as a flat body — custom functions
 * receive { call: {...}, name, args: {...} }. This unwraps tolerantly (flat
 * bodies from curl smoke tests still work) and surfaces the call_id, which
 * lets drafts and inbox items link back to their recording, and the live
 * caller number as a fallback when the LLM forgets to pass phone.
 */
export function parseVoiceToolRequest(body: any): {
  args: any;
  retellCallId: string | null;
  callerNumber: string | null;
} {
  const args =
    body && typeof body === 'object' && body.args && typeof body.args === 'object'
      ? body.args
      : body || {};
  const call = body?.call || {};
  return {
    args,
    retellCallId: call.call_id || null,
    callerNumber: call.from_number || null,
  };
}

// ── Phone ────────────────────────────────────────────────────────────────────

/** Strips to the last 10 digits — the stable core of a US number. */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').slice(-10);
}

// ── Firestore write hygiene ──────────────────────────────────────────────────

/**
 * Admin SDK throws on `undefined` values (unless ignoreUndefinedProperties is
 * set globally, which we avoid touching since your existing admin init may
 * already configure settings). Mirrors the client-side sanitizeForFirestore.
 */
export function stripUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefined(v)]),
  ) as T;
}

// ── Timezone math (Intl-based, no dependencies) ──────────────────────────────

type WallParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getWallParts(date: Date, timeZone: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour % 24, // Intl can emit "24" for midnight
    minute: +map.minute,
    second: +map.second,
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. EDT = -14400000. */
export function tzOffsetMs(timeZone: string, date: Date): number {
  const p = getWallParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * Converts a wall-clock time in the tenant's timezone to a UTC instant.
 * e.g. wallTimeToUtc('2026-07-07', 8, 0, 'America/New_York') → the Date for
 * 8:00 AM Eastern on July 7. One refinement pass handles DST boundaries.
 */
export function wallTimeToUtc(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));
  const offset = tzOffsetMs(timeZone, guess);
  let result = new Date(guess.getTime() - offset);
  const offset2 = tzOffsetMs(timeZone, result);
  if (offset2 !== offset) result = new Date(guess.getTime() - offset2);
  return result;
}

/** 'HH:mm' wall-clock string in the tenant's timezone — matches slot.time in the client hook. */
export function localTimeHHmm(date: Date, timeZone: string): string {
  const p = getWallParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** 'yyyy-MM-dd' in the tenant's timezone. */
export function localDateStr(date: Date, timeZone: string): string {
  const p = getWallParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Local hour (0-23) — used for morning/afternoon/evening filtering. */
export function localHour(date: Date, timeZone: string): number {
  return getWallParts(date, timeZone).hour;
}

// ── Speech formatting ────────────────────────────────────────────────────────
// Response fields become spoken words. Everything below is pre-formatted so
// the voice LLM never has to read an ISO timestamp aloud.

/** 'Tuesday, July 7 at 2:30 PM' */
export function speakDateTime(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${day} at ${time}`;
}

/** '2:30 PM' */
export function speakTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** 'Tuesday, July 7' */
export function speakDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Natural-language list join: 'A', 'A or B', 'A, B, or C'. */
export function speakList(items: string[], conjunction: 'or' | 'and' = 'or'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}
