// src/lib/account-receipts.ts — RENT & TUITION: RECEIPTS, REVERSALS AND THE AUTOPAY OFFER (server).
// Receipts go to the person whose account it is (the renter / the student), by text and/or email — whichever they
// have — in the owner's own wording (Messages: "Rent receipt", "Tuition receipt"), respecting their switches and
// quiet hours. The receipt says what's left and when the next payment is. A voided desk payment tells them it no
// longer counts ("Payment reversed", can't be switched off — money they thought was paid isn't).
// Autopay: a recurring card charge needs the person's own consent, and a card tapped on a reader can't be reused later
// — so we never switch it on for them. We send THEIR link (their own phone/email; the renter's includes their sign-in)
// or show a QR code on the desk screen (no sign-in in it — a shared screen can be photographed).
import { MESSAGE_KINDS, resolveMessagePolicy, renderMessage } from '@/lib/message-policy';
import { linkOrigin } from '@/lib/app-origin';

const money = (c: number) => `$${(Math.max(0, Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null | undefined, tz: string) => { if (!iso) return ''; try { return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : tz }); } catch { return ''; } };

async function send(db: any, tenantId: string, tenant: any, kind: string, to: { email?: string | null; phone?: string | null; name?: string | null; clientId?: string | null }, tokens: Record<string, string>): Promise<string[]> {
  const def: any = (MESSAGE_KINDS as any[]).find((k) => k.id === kind) || {}; const sent: string[] = [];
  const { sendNotification } = await import('@/lib/notify');
  for (const channel of ['sms', 'email'] as const) {
    const addr = channel === 'sms' ? to.phone : to.email; if (!addr || !(def.channels || []).includes(channel)) continue;
    const p: any = resolveMessagePolicy(tenant, kind, channel); if (!p.enabled) continue;
    const body = renderMessage(p.body || def.defaultBody || '', tokens).replace(/\s+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
    try {
      if (channel === 'sms') { const r: any = await sendNotification(db, { tenantId, channel, to: addr, kind, clientId: to.clientId || null, clientName: to.name || null, text: body } as any); if (r?.ok) sent.push('text'); }
      else { const { brandedEmailHtml } = await import('@/lib/email-template'); const subject = renderMessage(p.subject || def.defaultSubject || 'Payment received', tokens);
        const r: any = await sendNotification(db, { tenantId, channel, to: addr, kind, clientId: to.clientId || null, clientName: to.name || null, subject,
          html: brandedEmailHtml({ studioName: tenant?.name || 'The studio', title: subject.split(' — ')[0], bodyLines: body.split('\n').filter(Boolean) } as any) } as any); if (r?.ok) sent.push('email'); }
    } catch { /* logged by the sender */ }
  }
  return sent;
}

/** Their contact details: the renter record, or the student's plan + client record. */
export async function accountContact(db: any, tenantId: string, kind: 'rent' | 'tuition', id: string) {
  const T = `tenants/${tenantId}`;
  if (kind === 'rent') { const r: any = (await db.doc(`${T}/renters/${id}`).get()).data() || {};
    return { name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.name || 'there', email: r.email || null, phone: r.phone || null, autopayOn: r.autopayEnabled === true && !!(r.stripeCustomerId && (r.stripePaymentMethodId || r.defaultPaymentMethodId)), record: r }; }
  const p: any = (await db.doc(`${T}/tuitionPlans/${id}`).get()).data() || {}; const c: any = p.studentId ? (await db.doc(`${T}/clients/${p.studentId}`).get()).data() || {} : {};
  return { name: p.name || c.name || 'there', email: p.email || c.email || null, phone: p.phone || c.phone || null, clientId: p.studentId || null, autopayOn: p.autopay === true && !!p.paymentMethodId, record: p };
}

/** "What's left, and when's next" — the line every receipt carries. */
export function statusLine(kind: 'rent' | 'tuition', o: { owedAfterCents?: number; creditCents?: number; remainingCents?: number; nextAmountCents?: number | null; nextDue?: string | null; autopayOn?: boolean }, tz: string) {
  if (kind === 'rent') {
    if ((o.owedAfterCents || 0) > 0) return `Still owed: ${money(o.owedAfterCents!)}.`;
    if ((o.creditCents || 0) > 0) return `${money(o.creditCents!)} paid ahead — it comes off your next rent.`;
    return `You're all paid up.${o.nextDue ? ` Next rent is due ${day(o.nextDue, tz)}${o.autopayOn ? ' (autopay)' : ''}.` : ''}`;
  }
  if (!((o.remainingCents || 0) > 0)) return 'Your tuition is paid in full.';
  return `Remaining tuition: ${money(o.remainingCents!)}.${o.nextDue && o.nextAmountCents ? ` Next instalment: ${money(o.nextAmountCents)} on ${day(o.nextDue, tz)}${o.autopayOn ? ' (autopay)' : ''}.` : ''}`;
}

export async function sendAccountReceipt(db: any, tenantId: string, tenant: any, x: { kind: 'rent' | 'tuition'; id: string; amountCents: number; receiptLink?: string | null } & Parameters<typeof statusLine>[1]) {
  const c = await accountContact(db, tenantId, x.kind, x.id); const tz = tenant?.timezone || 'America/New_York';
  const first = String(c.name).split(' ')[0];
  const tokens = { renter_first: first, student_first: first, first, amount: money(x.amountCents), when: day(new Date().toISOString(), tz), details: statusLine(x.kind, { ...x, autopayOn: c.autopayOn }, tz), link: x.receiptLink || '', studio: tenant?.name || 'The studio' };
  const ch = await send(db, tenantId, tenant, x.kind === 'rent' ? 'rent_receipt' : 'tuition_receipt', c, tokens);
  return { sentTo: ch.length ? `${first} by ${ch.join(' and ')}` : null, noContact: !c.email && !c.phone, autopayOn: c.autopayOn };
}

export async function sendReversalNotice(db: any, tenantId: string, tenant: any, x: { kind: 'rent' | 'tuition'; id: string; amountCents: number; paidOn: string; details?: string }) {
  const c = await accountContact(db, tenantId, x.kind, x.id); const tz = tenant?.timezone || 'America/New_York';
  return send(db, tenantId, tenant, 'account_payment_reversed', c, { first: String(c.name).split(' ')[0], amount: money(x.amountCents), what: x.kind === 'rent' ? 'rent' : 'tuition', when: day(x.paidOn, tz), details: x.details || '', studio: tenant?.name || 'The studio' });
}

/** Their autopay setup link. withSignIn only for their OWN phone/email (renters: their personal sign-in token). */
export async function autopayLink(db: any, tenantId: string, tenant: any, kind: 'rent' | 'tuition', id: string, withSignIn: boolean) {
  const base = linkOrigin(tenant); if (!base) return null;
  if (kind === 'tuition') return `${base}/learn/${tenantId}/my?tab=tuition`;
  if (!withSignIn) return `${base}/rent/${tenantId}?tab=rent`;
  const ref = db.doc(`tenants/${tenantId}/renters/${id}`); const r: any = (await ref.get()).data() || {};
  let tok = r.portalToken; if (!tok) { tok = [...Array(32)].map(() => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join(''); await ref.set({ portalToken: tok }, { merge: true }); }
  return `${base}/rent/${tenantId}?rt=${tok}&tab=rent`;
}

export async function sendAutopayInvite(db: any, tenantId: string, tenant: any, kind: 'rent' | 'tuition', id: string) {
  const c = await accountContact(db, tenantId, kind, id);
  if (c.autopayOn) return { ok: false, error: 'Autopay is already on.' };
  if (!c.email && !c.phone) return { ok: false, error: 'No phone or email on file — show them the QR code instead.' };
  const link = await autopayLink(db, tenantId, tenant, kind, id, true); if (!link) return { ok: false, error: 'This business’s web address isn’t set up.' };
  const ch = await send(db, tenantId, tenant, 'autopay_invite', c, { first: String(c.name).split(' ')[0], what: kind === 'rent' ? 'rent' : 'tuition', link, studio: tenant?.name || 'The studio' });
  return ch.length ? { ok: true, sentTo: `${String(c.name).split(' ')[0]} by ${ch.join(' and ')}` } : { ok: false, error: 'It didn’t send — check their phone number or email.' };
}
