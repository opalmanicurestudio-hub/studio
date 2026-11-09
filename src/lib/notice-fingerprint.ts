// src/lib/notice-fingerprint.ts — A FIXED FINGERPRINT OF EXACTLY WHAT WAS SENT. The same subject and words always give
// the same fingerprint, and any change gives a different one, so a printed notice record (api/booths/notice-record)
// shows the copy on file is the copy that went. Written on each message log entry when it's sent (lib/notify, lib/sms).
// Server only.
import { createHash } from 'crypto';

export function wordsFingerprint(subject: unknown, body: unknown): string {
  return createHash('sha256').update(`${String(subject || '')}\n${String(body || '')}`, 'utf8').digest('hex');
}

/** The short form printed beside a notice: the first 16 characters, in groups of four. */
export function shortFingerprint(fp: string): string {
  return String(fp || '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
}
