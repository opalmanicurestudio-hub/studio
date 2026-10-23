// src/lib/contact-change.ts — CHANGING A CUSTOMER'S CONTACT DETAILS ON AN ORDER (name, email, mobile, texts on or off).
// Who may: managers and the front desk (the business owner's decision), never a renter. What's checked: a real email,
// a mobile with at least ten digits, a name that fits a label. What it changes: the order and its follow-ups (a
// backorder, a replacement), and the open cases on them, so replies, updates and the order page all reach the new
// details; the customer's profile keeps its own. Pure — the order workspace shows Edit only to the roles the server
// allows (api/retail/customer-contact).
import { rolesFor } from './permissions';

export type ContactWho = { role?: string | null; isManager?: boolean; isTenantOwner?: boolean; isRenter?: boolean } | null | undefined;

const MANAGERS = ['owner', 'admin', 'manager'];

/** Managers and the front desk (and roles a business built on the front desk), never a renter. */
export function mayEditContact(tenant: any, who: ContactWho): boolean {
  if (!who || who.isRenter) return false;
  if (who.isTenantOwner || who.isManager) return true;
  const role = String(who.role || '').toLowerCase();
  if (!role || role === 'renter') return false;
  if (MANAGERS.includes(role) || role === 'front_desk') return true;
  const def: any = rolesFor(tenant)[role];
  return !!def && (def.base === 'front_desk' || MANAGERS.includes(String(def.base || '')));
}

export type ContactInput = { name?: unknown; email?: unknown; phone?: unknown; textsOff?: unknown };
export type ContactClean = { name: string; email: string; phone: string; textsOff: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** The new details, cleaned, with what's wrong in plain words. Missing fields keep the order's current ones. */
export function cleanContact(order: any, input: ContactInput): { next: ContactClean; errors: string[] } {
  const errors: string[] = [];
  const name = input.name === undefined ? String(order?.customerName || '') : String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const email = input.email === undefined ? String(order?.customerEmail || '') : String(input.email || '').trim().toLowerCase().slice(0, 200);
  const phoneRaw = input.phone === undefined ? String(order?.customerPhone || '') : String(input.phone || '').trim().slice(0, 30);
  const textsOff = input.textsOff === undefined ? order?.textsOff === true : input.textsOff === true;
  if (!name) errors.push('Add the customer’s name.');
  if (!email && !order?.isTest) errors.push('Add an email address: receipts and updates go there.');
  else if (email && !EMAIL.test(email)) errors.push('That email address doesn’t look right.');
  const d = digits(phoneRaw);
  if (phoneRaw && (d.length < 10 || d.length > 15)) errors.push('That mobile number doesn’t look right. Include the area code.');
  return { next: { name, email, phone: d.length ? phoneRaw : '', textsOff }, errors };
}

/** What changes, field by field (only real changes: a different case in an email isn't one). */
export function contactDiff(order: any, next: ContactClean): { field: 'name' | 'email' | 'phone' | 'texts'; from: string; to: string }[] {
  const out: { field: 'name' | 'email' | 'phone' | 'texts'; from: string; to: string }[] = [];
  const was = { name: String(order?.customerName || ''), email: String(order?.customerEmail || '').trim().toLowerCase(), phone: String(order?.customerPhone || '') };
  if (next.name !== was.name) out.push({ field: 'name', from: was.name, to: next.name });
  if (next.email !== was.email) out.push({ field: 'email', from: was.email, to: next.email });
  if (digits(next.phone).slice(-10) !== digits(was.phone).slice(-10)) out.push({ field: 'phone', from: was.phone, to: next.phone });
  if (next.textsOff !== (order?.textsOff === true)) out.push({ field: 'texts', from: order?.textsOff === true ? 'off' : 'on', to: next.textsOff ? 'off' : 'on' });
  return out;
}

/** An email shown to someone who shouldn't read it whole: p•••@shahstudio.com. */
export function maskEmail(email: string): string {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${(user || '').slice(0, 1)}•••@${domain}`;
}

/** A mobile shown the same way: •••• 0148. */
export function maskPhone(phone: string): string {
  const d = digits(phone);
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : '';
}

/** The record's line for a change: "Email changed from a@x.com to b@y.com". */
export function changeLine(c: { field: string; from: string; to: string }): string {
  if (c.field === 'texts') return c.to === 'off' ? 'Texts about this order turned off' : 'Texts about this order turned on';
  const what = c.field === 'name' ? 'Name' : c.field === 'email' ? 'Email' : 'Mobile';
  if (!c.from) return `${what} added: ${c.to}`;
  if (!c.to) return `${what} removed (was ${c.from})`;
  return `${what} changed from ${c.from} to ${c.to}`;
}
