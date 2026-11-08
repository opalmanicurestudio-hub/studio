// src/lib/launch-readiness.ts — HQ's "Ready to launch?" check (HQ, System). Everything ClarityFlow needs from its
// hosting settings, Stripe and Firebase before businesses use it, set or not, in plain words with the fix for each.
// Never shows a value: only whether it's there, and for Stripe whether it's in test or live mode.
//
// Groups:
//   need      — without it something people rely on fails (sign-in, payments, email, daily jobs).
//   invite    — fine for a test run; set before the first real business.
//   optional  — turns on a feature; nothing breaks without it.
//   unset     — should stay empty; it's a problem when set.
//
// Two checks look outside ClarityFlow: Stripe (are the webhooks set to send the events the app handles?) and Firebase
// (are the published database and storage rules the same as the repo's?). Either one that can't be reached says so,
// rather than passing or failing.
import Stripe from 'stripe';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { getAdminApp } from '@/lib/firebase-admin';
import { platformAdminEmails, signupIsOpen } from '@/lib/platform-admin';
import { smsConfigured } from '@/lib/sms';
import { resolveFromAddress } from '@/lib/notify';
import { aiConfigured } from '@/lib/ai';
import { rulesFingerprint } from '@/lib/rules-normalize';
import { RULES_FINGERPRINT } from '@/lib/rules-fingerprint';
import { readinessSummary, type ReadyGroup, type ReadyState, type ReadyRow } from '@/lib/launch-readiness-shared';

export { readinessSummary };
export type { ReadyGroup, ReadyState, ReadyRow };

/** What the Connected accounts webhook must send (lib/connect-webhook handles each of these). */
export const CONNECT_EVENTS = ['account.updated', 'checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'charge.succeeded', 'charge.captured', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed', 'payout.paid'];
/** Sent only matters when a shop asks for an ID check on a held order (lib/connect-webhook, api/retail/id-check). */
export const CONNECT_OPTIONAL_EVENTS = ['identity.verification_session.verified', 'identity.verification_session.requires_input',
  'identity.verification_session.canceled', 'identity.verification_session.processing'];
/** What the ClarityFlow plans webhook must send (api/stripe/billing-webhook). */
export const BILLING_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];

const has = (k: string) => !!String(process.env[k] || '').trim();
const row = (id: string, group: ReadyGroup, label: string, ok: boolean, okNote: string, missingNote: string, fix?: string, missingState: ReadyState = 'missing'): ReadyRow =>
  ({ id, group, label, state: ok ? 'ok' : missingState, note: ok ? okNote : missingNote, ...(ok ? {} : fix ? { fix } : {}) });

function withTimeout<T>(p: Promise<T>, ms = 6000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), ms); })]).finally(() => clearTimeout(timer));
}

/** The app's own addresses (its own domain and its Vercel one, with and without www), so a staging or preview webhook
 *  at the same path isn't mistaken for this one. Empty when neither is known. */
export function appHosts(): string[] {
  const out = new Set<string>();
  for (const raw of [process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const v = String(raw || '').trim(); if (!v) continue;
    try { const h = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`).host.toLowerCase(); out.add(h); out.add(h.startsWith('www.') ? h.slice(4) : `www.${h}`); } catch { /* skip */ }
  }
  return [...out];
}

/** Which webhook events are missing on an endpoint (none when it sends everything). */
export function missingEvents(enabled: string[] | undefined, needed: string[]): string[] {
  const on = new Set((enabled || []).map(String));
  if (on.has('*')) return [];
  return needed.filter((e) => !on.has(e));
}

/** Finds the endpoint that calls one of `paths` on this app (its own host, when known) and reports what it's missing.
 *  With more than one, the one with the most gaps is reported, so a healthy copy can't hide a broken one. */
export function webhookRow(id: string, label: string, endpoints: any[], paths: string[], needed: string[], fixWhere: string, hosts: string[] = [], optional: string[] = []): ReadyRow {
  const at = (e: any) => { try { const u = new URL(String(e.url)); return { host: u.host.toLowerCase(), path: u.pathname.replace(/\/$/, '') }; } catch { return null; } };
  const atPath = endpoints.filter((e) => { const u = at(e); return e?.status !== 'disabled' && !!u && paths.includes(u.path); });
  const mine = atPath.filter((e) => !hosts.length || hosts.includes(at(e)!.host));
  const where = hosts.length ? `https://${hosts[0]}${paths[0]}` : paths[0];
  // A webhook at the right path on an address the app doesn't know as its own: maybe a preview copy, maybe a domain
  // not listed in the settings. With the live address set, the live one has none, so it's needed; without it, it's
  // worth a look.
  if (!mine.length && atPath.length) return { id, group: 'need', label, state: has('NEXT_PUBLIC_APP_URL') ? 'missing' : 'warn', note: `A webhook calls ${at(atPath[0])!.host}, which isn’t an address this app knows as its own (${hosts.join(', ')}).`, fix: `If that’s your live address, add it in Vercel as NEXT_PUBLIC_APP_URL. If it’s a preview copy, add an endpoint at ${where} too.` };
  if (!mine.length) return { id, group: 'need', label, state: 'missing', note: hosts.length ? `No Stripe webhook calls ${hosts[0]} for it yet.` : 'No Stripe webhook calls this app for it yet.', fix: `In Stripe, Developers, Webhooks: add an endpoint ${fixWhere} at ${where}, with the events listed here, then copy its signing secret into Vercel.` };
  const worst = mine.map((e) => missingEvents(e.enabled_events, needed)).reduce((a, b) => (b.length > a.length ? b : a));
  if (worst.length) return { id, group: 'need', label, state: 'missing', note: `Set up, but it doesn't send: ${worst.join(', ')}.`, fix: 'In Stripe, Developers, Webhooks: open that endpoint, choose Update details, and add those events.' };
  const extra = mine.map((e) => missingEvents(e.enabled_events, optional)).reduce((a, b) => (b.length > a.length ? b : a), [] as string[]);
  const secret = 'Its signing secret in Vercel has to be the one Stripe shows for this endpoint; that part can’t be checked from here.';
  return { id, group: 'need', label, state: 'ok', note: extra.length ? `Set up, and it sends every event the app needs. Only needed for ID checks on held shop orders: ${extra.join(', ')}. ${secret}` : `Set up, and it sends every event the app handles. ${secret}` };
}

/** A fixed phrase for an outside error: never the provider's own message, which can quote part of a key. */
export function outsideError(e: any): string {
  const code = Number(e?.statusCode || e?.status || e?.code) || 0;
  const msg = String(e?.message || '');
  if (/timed out/i.test(msg)) return 'no answer in time';
  if (code === 401 || e?.type === 'StripeAuthenticationError' || /invalid api key|unauthenticated|invalid_grant/i.test(msg)) return 'the key was refused';
  if (code === 403 || e?.type === 'StripePermissionError' || /permission/i.test(msg)) return 'permission denied';
  return 'no answer';
}

/** Compares a published rules source with the repo's fingerprint. */
export function rulesRow(id: string, label: string, published: string | null, expected: string, where: string, err?: string): ReadyRow {
  if (published == null) return { id, group: 'need', label, state: 'unknown', note: `Couldn’t read the published rules${err ? `: ${err}` : ''}.`, fix: 'The Firebase admin account may need permission to read rules (the Firebase Rules Viewer role). Then reload this page.' };
  return rulesFingerprint(published) === expected
    ? { id, group: 'need', label, state: 'ok', note: 'The published rules are the latest.' }
    : { id, group: 'need', label, state: 'missing', note: 'The rules published in Firebase are different from the latest.', fix: `Paste the latest rules into Firebase, ${where}, and publish.` };
}

async function stripeRows(): Promise<ReadyRow[]> {
  const key = String(process.env.STRIPE_SECRET_KEY || '');
  if (!key) return [];
  try {
    const stripe = new Stripe(key, { apiVersion: '2025-04-30.basil' as any, timeout: 6000, maxNetworkRetries: 0 });
    const list: any = await withTimeout(stripe.webhookEndpoints.list({ limit: 100 }));
    const endpoints = Array.isArray(list?.data) ? list.data : [];
    const hosts = appHosts();
    return [
      webhookRow('stripe-connect-events', 'Stripe webhook for businesses’ payments', endpoints, ['/api/stripe/connect-webhook', '/api/stripe/webhook'], CONNECT_EVENTS, 'that listens to events on Connected accounts', hosts, CONNECT_OPTIONAL_EVENTS),
      webhookRow('stripe-billing-events', 'Stripe webhook for ClarityFlow plans', endpoints, ['/api/stripe/billing-webhook'], BILLING_EVENTS, 'that listens to events on your account', hosts),
    ];
  } catch (e: any) {
    return [{ id: 'stripe-events', group: 'need', label: 'Stripe webhooks', state: 'unknown', note: `Couldn’t ask Stripe: ${outsideError(e)}.`, fix: 'Check the Stripe secret key, then reload this page.' }];
  }
}

async function rulesRows(): Promise<ReadyRow[]> {
  const rules = getSecurityRules(getAdminApp());
  const bucket = String(process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').replace(/^gs:\/\//, '') || undefined;
  const read = async (p: () => Promise<any>) => { try { const r = await withTimeout(p()); return { src: (r?.source || []).map((f: any) => String(f?.content || '')).join('\n'), err: '' }; } catch (e: any) { return { src: null as string | null, err: outsideError(e) }; } };
  const [fs, st] = await Promise.all([read(() => rules.getFirestoreRuleset()), read(() => rules.getStorageRuleset(bucket))]);
  return [
    rulesRow('rules-firestore', 'Database rules published', fs.src, RULES_FINGERPRINT.firestore, 'Firestore Database, Rules', fs.err),
    rulesRow('rules-storage', 'Storage rules published', st.src, RULES_FINGERPRINT.storage, 'Storage, Rules', st.err),
  ];
}

/** Every row, in group order. `outside: false` skips Stripe and Firebase (for checks run without them). */
export async function launchReadiness(opts: { outside?: boolean } = {}): Promise<ReadyRow[]> {
  const sk = String(process.env.STRIPE_SECRET_KEY || ''), pk = String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');
  const skMode = /^(sk|rk)_live_/.test(sk) ? 'live' : /^(sk|rk)_test_/.test(sk) ? 'test' : sk ? 'bad' : '';
  const pkMode = /^pk_live_/.test(pk) ? 'live' : /^pk_test_/.test(pk) ? 'test' : pk ? 'bad' : '';
  const from = resolveFromAddress();
  const testSender = /resend\.dev/i.test(from);
  const adminKey = has('FIREBASE_ADMIN_PROJECT_ID') && has('FIREBASE_ADMIN_CLIENT_EMAIL') && has('FIREBASE_ADMIN_PRIVATE_KEY');

  const rows: ReadyRow[] = [
    row('firebase-admin', 'need', 'Firebase admin', adminKey, 'Set.', 'Missing: the server can’t read or write anything.', 'In Vercel, add FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY from a Firebase service account.'),
    row('storage-bucket', 'need', 'File storage', has('FIREBASE_STORAGE_BUCKET'), 'Set.', 'Missing: files the server saves (photos, downloads, documents) can’t be stored.', 'In Vercel, add FIREBASE_STORAGE_BUCKET (the gs:// name shown in Firebase Storage, without gs://).'),
    { id: 'stripe-keys', group: 'need', label: 'Stripe keys',
      state: !sk || !pk || skMode === 'bad' || pkMode === 'bad' || skMode !== pkMode ? 'missing' : skMode === 'test' ? 'warn' : 'ok',
      note: !sk || !pk ? 'Missing: nobody can pay.' : skMode === 'bad' || pkMode === 'bad' ? 'One of the keys doesn’t look like a Stripe key.' : skMode !== pkMode ? `The secret key is ${skMode} mode but the publishable key is ${pkMode} mode, so payments will fail.` : skMode === 'test' ? 'Test mode: good for the test run. Real cards won’t be charged.' : 'Live mode.',
      ...(!sk || !pk ? { fix: 'In Vercel, add STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY from Stripe, Developers, API keys.' }
        : skMode === 'bad' || pkMode === 'bad' ? { fix: 'Copy both keys again from Stripe, Developers, API keys.' }
        : skMode !== pkMode ? { fix: 'Use both keys from the same mode in Stripe.' }
        : skMode === 'test' ? { fix: 'Switch both keys to live ones before the first real business.' } : {}) },
    row('stripe-connect-secret', 'need', 'Stripe webhook secret, businesses’ payments', has('STRIPE_CONNECT_WEBHOOK_SECRET'), 'Set.', 'Missing: bookings and shop orders paid online are never recorded.', 'In Vercel, add STRIPE_CONNECT_WEBHOOK_SECRET from the Connected accounts webhook in Stripe.'),
    row('stripe-billing-secret', 'need', 'Stripe webhook secret, ClarityFlow plans', has('STRIPE_BILLING_WEBHOOK_SECRET'), 'Set.', 'Missing: a business that buys a plan is never marked as paid.', 'In Vercel, add STRIPE_BILLING_WEBHOOK_SECRET from the plans webhook in Stripe.'),
    row('email-key', 'need', 'Email', has('RESEND_API_KEY'), 'Set.', 'Missing: no email goes out (receipts, confirmations, sign-in links).', 'In Vercel, add RESEND_API_KEY from Resend.'),
    // The sender is whatever the app really sends from (lib/notify resolveFromAddress), however it was set.
    { id: 'email-from', group: 'need', label: 'Email sender', state: testSender ? 'missing' : 'ok',
      note: testSender ? 'Sending from the email service’s test address, which only reaches you.' : `Sending as ${from}.`,
      ...(testSender ? { fix: 'Verify your sending domain in Resend, then add NOTIFY_FROM_EMAIL in Vercel, like "ClarityFlow <hello@yourdomain.com>".' } : {}) },
    row('cron-secret', 'need', 'Daily jobs key', has('CRON_SECRET'), 'Set.', 'Missing: reminders and nightly jobs can’t run, and private links fall back to a guessable key.', 'In Vercel, add CRON_SECRET: any long random text.'),
    row('hq-admins', 'need', 'HQ access', platformAdminEmails().length > 0, `${platformAdminEmails().length} email${platformAdminEmails().length === 1 ? '' : 's'} can open HQ.`, 'Nobody is listed.', 'In Vercel, add PLATFORM_ADMIN_EMAILS with your email.'),
    row('live-address', 'need', 'Live address', has('VERCEL_PROJECT_PRODUCTION_URL') || has('NEXT_PUBLIC_APP_URL'), String(process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || ''), 'Unknown: links in emails and texts may point to the wrong place.', 'In Vercel, add NEXT_PUBLIC_APP_URL with the app’s address, or turn on “Automatically expose System Environment Variables”.'),
    row('pin-pepper', 'need', 'Team PIN key', has('PIN_PEPPER'), 'Set.', 'Not set: team PINs use the daily jobs key instead. It works, but a separate key is safer.', 'In Vercel, add PIN_PEPPER: any long random text. Team members re-enter their PIN once after it changes.', 'warn'),
    row('push', 'need', 'Phone notifications', has('NEXT_PUBLIC_FIREBASE_VAPID_KEY'), 'Set.', 'Missing: no phone notifications for owners or the team.', 'In Firebase, Project settings, Cloud Messaging: create a Web Push key pair, and add it in Vercel as NEXT_PUBLIC_FIREBASE_VAPID_KEY.'),
    { id: 'signup', group: 'need', label: 'Sign-up', state: 'ok', note: signupIsOpen() ? 'Open to everyone.' : 'Invite only: a business signs up with an invite from HQ.' },

    row('legal-name', 'invite', 'Company name on the legal pages', has('NEXT_PUBLIC_LEGAL_NAME'), 'Set.', 'Not set: the pages use neutral wording.', 'In Vercel, add NEXT_PUBLIC_LEGAL_NAME, then redeploy.', 'warn'),
    row('support-email', 'invite', 'Support email', has('NEXT_PUBLIC_SUPPORT_EMAIL'), 'Set.', 'Not set: the legal pages show the address they have now.', 'In Vercel, add NEXT_PUBLIC_SUPPORT_EMAIL, then redeploy.', 'warn'),
    row('legal-address', 'invite', 'Mailing address on the legal pages', has('NEXT_PUBLIC_LEGAL_ADDRESS'), 'Set.', 'Not set.', 'In Vercel, add NEXT_PUBLIC_LEGAL_ADDRESS, then redeploy.', 'warn'),
    row('legal-state', 'invite', 'Governing state', has('NEXT_PUBLIC_LEGAL_STATE'), 'Set.', 'Not set: the terms use neutral wording.', 'In Vercel, add NEXT_PUBLIC_LEGAL_STATE, then redeploy.', 'warn'),

    row('texting', 'optional', 'Texting', smsConfigured(), 'Connected.', 'Not connected: no texts. Reminders and receipts go by email where there is one.', 'In Vercel, add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID, and finish texting registration.', 'warn'),
    row('leads-email', 'optional', 'Help requests by email', has('LEADS_NOTIFY_EMAIL'), 'Set.', 'Not set: help and access requests only show in HQ.', 'In Vercel, add LEADS_NOTIFY_EMAIL.', 'warn'),
    row('maps', 'optional', 'Delivery maps', has('MAPBOX_TOKEN'), 'Set.', 'Not set: no delivery zones by distance, and no map on a delivery.', 'In Vercel, add MAPBOX_TOKEN from Mapbox.', 'warn'),
    row('writing-help', 'optional', 'Writing help', aiConfigured(), 'Set.', 'Not set: written drafts are off.', 'In Vercel, add the writing help key named in your setup steps.', 'warn'),
    row('gifs', 'optional', 'GIFs in team chat', has('NEXT_PUBLIC_TENOR_API_KEY'), 'Set.', 'Not set: no GIFs in team chat.', 'In Vercel, add NEXT_PUBLIC_TENOR_API_KEY.', 'warn'),

    row('shippo-shared', 'unset', 'Shared shipping account', !has('SHIPPO_API_KEY'), 'Not set, as it should be.', 'Set: every shop without its own shipping key buys labels on your account.', 'In Vercel, delete SHIPPO_API_KEY unless you mean to pay for every shop’s labels.', 'warn'),
    row('default-sms-tenant', 'unset', 'Default business for text replies', !has('DEFAULT_SMS_TENANT_ID'), 'Not set, as it should be.', 'Set: once there are two businesses, a client’s text reply can reach the wrong one.', 'In Vercel, delete DEFAULT_SMS_TENANT_ID.'),
  ];
  if (opts.outside === false) return rows;
  const [stripe, rules] = await Promise.all([stripeRows(), rulesRows().catch((e) => [rulesRow('rules', 'Published rules', null, '', '', outsideError(e))])]);
  // Outside checks sit with the other needed rows, after the settings they depend on.
  const at = rows.findIndex((r) => r.id === 'signup');
  rows.splice(at, 0, ...stripe, ...rules);
  return rows;
}

