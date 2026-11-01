// src/lib/us-phone.ts — a US phone's 10 digits ('5125550198') from what someone typed, with or without +1, or ''
// when it isn't one. Used where a number is matched and then texted, so both are always the very same number.
export function usPhone(typed: string): string {
  const raw = String(typed || '').replace(/\D/g, '');
  return raw.length === 10 ? raw : raw.length === 11 && raw[0] === '1' ? raw.slice(1) : '';
}
