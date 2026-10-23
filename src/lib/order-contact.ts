// src/lib/order-contact.ts — A NEW EMAIL OR MOBILE ON AN ORDER, FROM THE TEAM OR FROM THE CUSTOMER (server).
// The team (api/retail/customer-contact: managers and the front desk, lib/contact-change) and the customer on their
// own order page (api/retail/self-serve, after a code sent to the NEW email or mobile shows it's really theirs) change
// it the same way: the order, its whole family (the order it came from and every follow-up, a backorder of a backorder
// too) and the open messages and problem reports on them take the new details, so replies, updates and the order page
// reach them. The new email gets the order's link, the old email is told it changed (a change nobody asked for is
// noticed), a new mobile gets one text, and it's all on the order's record with who did it. The customer's profile
// keeps its own details.
import { createHash, randomInt } from 'crypto';
import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';
import { changeLine, maskEmail, type ContactClean } from '@/lib/contact-change';
import { sendNotification } from '@/lib/notify';
import { followUpsOf } from '@/lib/order-family';

export type ContactChange = { field: 'name' | 'email' | 'phone' | 'texts'; from: string; to: string };
export type ContactWho = { uid: string; name: string; customer?: boolean };

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const d10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const last4 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-4);
export const CONTACT_CODE_MIN = 10;
export const CONTACT_CODE_TRIES = 5;
// How many codes go out: a few an hour per order, and per email or number (however it's typed), a few a day to any one
// email or number, and a cap a day for the whole shop, so the page can't be used to run up texts or flood someone.
export const CODE_LIMITS = { orderHour: 5, valueHour: 3, valueDay: 6, shopDay: 200 };
const valueKey = (field: string, v: string) => hash(`${field}:${field === 'email' ? String(v || '').trim().toLowerCase() : d10(v)}`).slice(0, 16);

/** The order's whole family: up the chain to the order the customer placed, then every follow-up made from it. */
export async function orderFamily(db: any, tenantId: string, orderId: string, o: any): Promise<{ id: string; x: any }[]> {
  const famIds = new Set<string>([orderId]);
  try {
    let root = orderId; let cur: any = o;
    for (let i = 0; i < 4 && cur?.parentOrderId; i++) {
      const pid = String(cur.parentOrderId);
      const ps = await db.doc(`tenants/${tenantId}/retailOrders/${pid}`).get();
      if (!ps.exists) break;
      root = pid; cur = ps.data(); famIds.add(pid);
    }
    const kids = await followUpsOf((q: any) => q.get(), db.collection(`tenants/${tenantId}/retailOrders`), root);
    kids.forEach((k: any) => famIds.add(String(k.id)));
  } catch { /* the order itself is still changed */ }
  const family: { id: string; x: any }[] = [];
  for (const id of famIds) {
    const x: any = id === orderId ? o : (((await db.doc(`tenants/${tenantId}/retailOrders/${id}`).get().catch(() => null))?.data?.()) || null);
    if (x) family.push({ id, x });
  }
  return family;
}

/** Any order in the family held for review (a possible stolen card): a new email or mobile there isn't for anyone but
 *  a manager. */
export const familyHeld = (family: { x: any }[]) => family.some((f) => f.x?.holdForReview === true);

/** Put the new details on the order, its family and their open cases, record it, and tell the customer. */
export async function applyOrderContact(db: any, tenantId: string, orderId: string, o: any, next: ContactClean, changes: ContactChange[], who: ContactWho, origin: string, family?: { id: string; x: any }[]) {
  const fam = family || await orderFamily(db, tenantId, orderId, o);
  const emailChange = changes.find((c) => c.field === 'email') || null;
  const phoneChange = changes.find((c) => c.field === 'phone') || null;
  const oldEmail = String(o.customerEmail || '').trim().toLowerCase();
  const oldPhone = String(o.customerPhone || '');
  const now = new Date().toISOString();
  const patchFor = (x: any) => ({
    // A follow-up takes a change only to details it shares with this order (it was made with them).
    ...(changes.some((c) => c.field === 'name') && String(x.customerName || '') === String(o.customerName || '') ? { customerName: next.name } : {}),
    ...(emailChange && String(x.customerEmail || '').trim().toLowerCase() === oldEmail ? { customerEmail: next.email } : {}),
    ...(phoneChange && d10(x.customerPhone) === d10(oldPhone) ? { customerPhone: next.phone } : {}),
    ...(changes.some((c) => c.field === 'texts') ? { textsOff: next.textsOff } : {}),
    contactChangedAt: now, contactChangedBy: who.customer ? 'customer' : who.name,
  });
  const batch = db.batch();
  const touched: string[] = [];
  for (const { id, x } of fam) {
    batch.set(db.doc(`tenants/${tenantId}/retailOrders/${id}`), patchFor(x), { merge: true });
    touched.push(id);
  }
  // The open cases on these orders reply to the new email and mobile.
  if (emailChange || phoneChange) {
    const ids = fam.map((f) => f.id);
    for (const col of ['retailSupport', 'retailClaims']) {
      for (let i = 0; i < ids.length; i += 10) {
        try {
          const s = await db.collection(`tenants/${tenantId}/${col}`).where('orderId', 'in', ids.slice(i, i + 10)).limit(60).get();
          s.docs.forEach((d: any) => {
            const c: any = d.data() || {};
            const patch = {
              ...(emailChange && String(c.customerEmail || '').trim().toLowerCase() === oldEmail ? { customerEmail: next.email } : {}),
              ...(phoneChange && c.customerPhone && d10(c.customerPhone) === d10(oldPhone) ? { customerPhone: next.phone } : {}),
            };
            if (Object.keys(patch).length) batch.set(d.ref, patch, { merge: true });
          });
        } catch { /* the order still changes */ }
      }
    }
  }
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const ev = ref.collection('events').doc();
  batch.set(ev, { id: ev.id, type: 'note', at: now, actorId: who.customer ? 'customer' : who.uid, actorName: who.name,
    meta: { kind: 'contact_changed', text: `${changes.map(changeLine).join('. ')}.${who.customer ? ' (Changed by the customer on their order page.)' : ''}`, fields: changes.map((c) => c.field), followUps: touched.filter((id) => id !== orderId).length, ...(who.customer ? { selfServe: true } : {}) } });
  await batch.commit();

  // Telling them: the new email gets the link; the old one hears it changed; a new mobile gets one text.
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const link = `${origin}/shop/${tenantId}/order/${orderId}`;
  const first = String(next.name || o.customerName || '').split(' ')[0] || 'there';
  let toldNew = false; let toldOld = false; let texted = false;
  try {
    const brand = await getEmailBrand(db, tenantId);
    const shop = brand.shopName || 'the shop';
    const byWhom = who.customer ? 'on your order page' : `by ${esc(shop)}`;
    if (emailChange && next.email) {
      const html = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">Hi ${esc(first)}, your order ${num} now uses this email address. Updates about it come here, and your order page has everything in one place.</p>${emailButton(link, 'Open my order', brand)}`,
        { title: 'Your order’s new email', tag: `Order ${num}`, preheader: `Updates about your order ${num} now come to this address.` });
      const r: any = await sendNotification(db, { tenantId, channel: 'email', to: next.email, subject: `${shop}: your order ${num} now uses this email`, html, text: `Your order ${num} now uses this email address. ${link}`,
        kind: 'contact_changed', recipientType: 'client', recipientId: orderId, recipientName: next.name || null, orderId } as any).catch(() => null);
      toldNew = !!r && r.ok !== false;
      if (oldEmail) {
        const html2 = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">Hi ${esc(first)}, the email address on your order ${num} was changed to ${esc(maskEmail(next.email))} ${byWhom}. Updates about the order go there now.</p><p style="font-size:14px;color:#334155;line-height:1.6">If you didn’t ask for this, please let us know right away by replying to this email.</p>`,
          { title: 'The email on your order changed', tag: `Order ${num}`, preheader: `The email on your order ${num} was changed.` });
        const r2: any = await sendNotification(db, { tenantId, channel: 'email', to: oldEmail, subject: `${shop}: the email on your order ${num} changed`, html: html2, text: `The email on your order ${num} was changed to ${maskEmail(next.email)}. If you didn’t ask for this, reply to this email.`,
          kind: 'contact_changed_notice', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId } as any).catch(() => null);
        toldOld = !!r2 && r2.ok !== false;
      }
    }
    if (phoneChange && next.phone && !next.textsOff) {
      const r3: any = await sendNotification(db, { tenantId, channel: 'sms', to: next.phone, text: `${shop}: updates about your order ${num} will come to this number. ${link}`,
        kind: 'contact_changed', recipientType: 'client', recipientId: orderId, recipientName: next.name || null, orderId } as any).catch(() => null);
      texted = !!r3 && r3.ok !== false;
    }
    // A mobile changed from the order page, with the email kept: the email hears about it too.
    if (who.customer && phoneChange && !emailChange && oldEmail) {
      const html4 = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">Hi ${esc(first)}, the mobile number on your order ${num} was ${next.phone ? `changed to one ending in ${esc(last4(next.phone))}` : 'removed'} on your order page.</p><p style="font-size:14px;color:#334155;line-height:1.6">If you didn’t ask for this, please let us know right away by replying to this email.</p>`,
        { title: 'The mobile on your order changed', tag: `Order ${num}`, preheader: `The mobile number on your order ${num} was changed.` });
      await sendNotification(db, { tenantId, channel: 'email', to: oldEmail, subject: `${shop}: the mobile on your order ${num} changed`, html: html4, text: `The mobile number on your order ${num} was changed. If you didn’t ask for this, reply to this email.`,
        kind: 'contact_changed_notice', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId } as any).catch(() => null);
    }
  } catch (e) { console.error('[order-contact] notices failed (the change is saved)', e); }
  return { touched, toldNew, toldOld, texted };
}

// ── The customer's own change: a code sent to the new email or mobile ──────────────────────────────────────────────

type Send = (db: any, m: any) => Promise<any>;

/** Send a 6-digit code to the NEW email or mobile. A few an hour per order, and per address. */
export async function sendContactCode(db: any, tenantId: string, orderId: string, o: any, field: 'email' | 'phone', value: string, opt: { now?: number; send?: Send; origin?: string } = {}) {
  const now = opt.now ?? Date.now(); const T = `tenants/${tenantId}`;
  const key = `order:${orderId}`;
  // Counted in one step (so many at once can't all slip through), on the server's own records (never the browser's).
  const vk = valueKey(field, value); const day = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  const oRef = db.doc(`${T}/clientVerifications/limit_o_${String(orderId).replace(/[^\w-]/g, '').slice(0, 80)}`); const dRef = db.doc(`${T}/clientVerifications/limit_d_${day}`);
  const allowed = await db.runTransaction(async (tx: any) => {
    const o1: any = ((await tx.get(oRef)).data() as any) || {}; const d1: any = ((await tx.get(dRef)).data() as any) || {};
    const sends = (Array.isArray(o1.sends) ? o1.sends : []).filter((x: any) => Number(x?.at) > now - 3600e3);
    const dayValue = Number(d1.byValue?.[vk]) || 0;
    if (sends.length >= CODE_LIMITS.orderHour || sends.filter((x: any) => x.v === vk).length >= CODE_LIMITS.valueHour || dayValue >= CODE_LIMITS.valueDay || (Number(d1.count) || 0) >= CODE_LIMITS.shopDay) return false;
    tx.set(oRef, { purpose: 'rate_limit', orderId, sends: [...sends, { at: now, v: vk }].slice(-20), updatedAt: new Date(now).toISOString() });
    tx.set(dRef, { purpose: 'rate_limit', day, count: (Number(d1.count) || 0) + 1, byValue: { ...(d1.byValue || {}), [vk]: dayValue + 1 }, updatedAt: new Date(now).toISOString() });
    return true;
  });
  if (!allowed) return { ok: false, error: 'We’ve sent several codes already. Please wait a little while and try again.' };
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const ref = db.collection(`${T}/clientVerifications`).doc();
  await ref.set({ id: ref.id, clientId: key, orderId, purpose: 'order_contact', field, value, channel: field === 'email' ? 'email' : 'sms',
    codeHash: hash(`${ref.id}:${code}`), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + CONTACT_CODE_MIN * 60000).toISOString(), tries: 0, usedAt: null });
  const send = opt.send || ((d: any, m: any) => sendNotification(d, m));
  const brand = await getEmailBrand(db, tenantId).catch(() => ({ shopName: '' } as any));
  const shop = brand.shopName || 'the shop';
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const r: any = field === 'email'
    ? await send(db, { tenantId, channel: 'email', to: value, subject: `Your code: ${code}`, kind: 'verify_code', essential: true, recipientType: 'client', recipientId: orderId, orderId,
        html: brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">Enter this code on your order page to use this email for order ${num}:</p><p style="font-size:30px;letter-spacing:6px;font-weight:700;color:#16171a;margin:14px 0">${code}</p><p style="font-size:13px;color:#6d7075;line-height:1.6">It expires in ${CONTACT_CODE_MIN} minutes. If you didn’t ask for this, you can ignore this email.</p>`, { title: 'Your code', tag: `Order ${num}`, preheader: `Your code is ${code}` }),
        text: `Your ${shop} code is ${code}. Enter it on your order page to use this email for order ${num}. It expires in ${CONTACT_CODE_MIN} minutes.` }).catch(() => null)
    : await send(db, { tenantId, channel: 'sms', to: value, kind: 'verify_code', essential: true, recipientType: 'client', recipientId: orderId, orderId,
        text: `${shop}: your code is ${code}. Enter it on your order page to get updates about order ${num} at this number. It expires in ${CONTACT_CODE_MIN} minutes.` }).catch(() => null);
  if (!r || r.ok === false) {
    await ref.set({ usedAt: new Date(now).toISOString(), failed: true }, { merge: true }).catch(() => {});
    return { ok: false, error: field === 'email' ? 'We couldn’t send a code to that email. Check it and try again.' : 'We couldn’t text a code to that number. Check it and try again.' };
  }
  return { ok: true, verificationId: ref.id, sentTo: field === 'email' ? maskEmail(value) : `the number ending in ${last4(value)}` };
}

/** Check the code. Once right, it can't be used again; five wrong tries and a new one is needed. */
export async function confirmContactCode(db: any, tenantId: string, orderId: string, verificationId: string, code: string, now = Date.now()): Promise<{ ok: true; field: 'email' | 'phone'; value: string } | { ok: false; error: string }> {
  const ref = db.doc(`tenants/${tenantId}/clientVerifications/${String(verificationId || '').replace(/[^\w-]/g, '').slice(0, 80) || 'none'}`);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref); const v: any = snap.exists ? snap.data() : null;
    if (!v || v.purpose !== 'order_contact' || v.orderId !== orderId || v.usedAt) return { ok: false, error: 'That code has already been used or has expired. Please ask for a new one.' };
    if (Date.parse(v.expiresAt) < now) return { ok: false, error: 'That code has expired. Please ask for a new one.' };
    if ((Number(v.tries) || 0) >= CONTACT_CODE_TRIES) return { ok: false, error: 'Too many tries. Please ask for a new code.' };
    if (hash(`${ref.id}:${String(code || '').replace(/\D/g, '')}`) !== v.codeHash) { tx.set(ref, { tries: (Number(v.tries) || 0) + 1 }, { merge: true }); return { ok: false, error: 'That code doesn’t match. Please check it and try again.' }; }
    tx.set(ref, { usedAt: new Date(now).toISOString() }, { merge: true });
    return { ok: true, field: v.field === 'phone' ? 'phone' : 'email', value: String(v.value || '') };
  });
}
