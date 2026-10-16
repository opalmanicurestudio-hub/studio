// src/lib/agent-hold-param.ts — the hold id carried by the booking page (?hold=), for the browser code that asks for
// open times, so the client's own held time shows as open to them (lib/agent-holds). Browser-safe on purpose.
export function holdParam(): string | null {
  try { const v = new URLSearchParams(window.location.search).get('hold') || ''; return /^[A-Za-z0-9_-]{6,40}$/.test(v) ? v : null; } catch { return null; }
}
