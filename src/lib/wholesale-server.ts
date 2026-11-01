// src/lib/wholesale-server.ts — WHOLESALE BUYERS AND APPLICATIONS, CHANGED ONLY ON THE SERVER (api/retail/wholesale for
// the team, api/retail/wholesale-apply for the public). A buyer's code is money off, and their resale certificate makes
// their orders tax free, so no browser writes either (firestore.rules): managers ask here, and who did it, and when, is
// taken from their sign-in.
//   buyers       tenants/{t}/wholesaleAccounts/{id}  { businessName, contactName, email, phone, kind, state, website,
//                notes, accessCode, extraDiscountPercent, status 'active'|'suspended', tax 'exempt'|'taxable',
//                taxFromShopSwitch?, certs [Cert], certsRemoved [Cert + removedAt/By], taxEmails [], createdAt/By,
//                updatedAt/By, applicationId?, lastUsedAt? }
//   applications tenants/{t}/wholesaleApplications/{id} { businessName, contactName, email, phone, kind, state, website,
//                certNumber, certFileUrl, certFileName, note, status 'pending'|'approved'|'declined', createdAt,
//                updatedAt, decidedAt/By, accountId?, declineNote? }
// The tax rules themselves are lib/wholesale-tax. A certificate taken off a buyer is kept in certsRemoved, and buyers
// are paused, never deleted, so every certificate an order was sold under stays on file.
import { createHash } from 'crypto';
import { clampDiscount, generateAccessCode } from './retail-wholesale';
import { dayOrNull, readCerts, stateCode, stateName, taxSettingOf, type Cert } from './wholesale-tax';
import { ACCOUNT_TOKEN_DAYS, signProvenAccountToken } from './retail-account';

export type Actor = { id: string; name: string };
export type Ans = { ok: boolean; message: string; [k: string]: any };
/** How an email goes out (lib/notify in the routes; a stand-in in the checks). */
export type Send = (m: { to: string; subject: string; html: string; text: string; kind: string; name: string }) => Promise<{ ok: boolean }>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const KINDS = ['salon', 'spa', 'shop', 'other'] as const;
export const KIND_LABEL: Record<string, string> = { salon: 'Salon', spa: 'Spa', shop: 'Shop', other: 'Other' };
const MAX_CERTS = 20; const MAX_EMAILS = 10; const MAX_PENDING = 300; const MAX_HISTORY = 200;
const s = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const lc = (v: any, n = 160) => s(v, n).toLowerCase();
const first = (name: string) => String(name || '').trim().split(' ')[0] || 'there';
const accts = (db: any, t: string) => db.collection(`tenants/${t}/wholesaleAccounts`);
const apps = (db: any, t: string) => db.collection(`tenants/${t}/wholesaleApplications`);
const esc = (x: any) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A copy the server saved for this shop (lib/claim-photo-upload, folder wholesale-certs), and nothing else: the
 *  object's own path, right after the bucket, starts in this shop's certificate folder. */
export function isCertFile(tenantId: string, url: any): boolean {
  const u = String(url || '');
  if (u.length > 1200) return false;
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[a-z0-9._-]+\/o\/([^?#/]+)(\?|$)/i.exec(u);
  if (!m) return false;
  let path = ''; try { path = decodeURIComponent(m[1]); } catch { return false; }
  return path.startsWith(`tenants/${tenantId}/wholesale-certs/`) && !path.includes('..');
}

/** A code no buyer has (checked against every account; the house code is a different shape). */
export async function uniqueCode(db: any, t: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateAccessCode();
    if ((await accts(db, t).where('accessCode', '==', code).limit(1).get()).empty) return code;
  }
  throw new Error('no free code');
}

/**
 * The certificates as the team sent them, checked. Each needs a number and a copy (it's kept on file for every tax-free
 * sale). Who accepted it and when is kept while nothing about it changes; a change to its number, state, end date or
 * copy is accepted again by whoever made it, and the version before goes to the history (`replaced`).
 */
function certsFrom(t: string, raw: any, before: Cert[], actor: Actor, now: string): { certs: Cert[]; replaced: Cert[]; error?: string } {
  const bad = (error: string) => ({ certs: [], replaced: [], error });
  if (!Array.isArray(raw)) return { certs: [], replaced: [] };
  if (raw.length > MAX_CERTS) return bad(`Up to ${MAX_CERTS} certificates.`);
  const out: Cert[] = []; const replaced: Cert[] = []; const seen = new Set<string>();
  for (const c of raw) {
    const state = stateCode(c?.state);
    if (!state) return bad('Choose the state for each certificate.');
    const name = stateName(state);
    if (seen.has(state)) return bad(`There’s already a ${name} certificate. Change that one instead.`);
    seen.add(state);
    const number = s(c?.number, 40);
    if (number.length < 3) return bad(`Add the ${name} certificate’s number.`);
    // "On a date" with no date isn't "no end date": only null is.
    if (c?.endsOn !== null && c?.endsOn !== undefined && !String(c.endsOn).trim()) return bad(`Choose the ${name} certificate’s end date, or No end date.`);
    const endsRaw = s(c?.endsOn, 12); const endsOn = endsRaw ? dayOrNull(endsRaw) : null;
    if (endsRaw && !endsOn) return bad(`The ${name} certificate’s end date isn’t a real date.`);
    const fileUrl = c?.fileUrl ? String(c.fileUrl) : '';
    if (fileUrl && !isCertFile(t, fileUrl)) return bad('Add the copy again: that file wasn’t saved here.');
    if (!fileUrl) return bad(`Add a copy of the ${name} certificate. You keep it on file for every tax-free sale.`);
    const id = s(c?.id, 40) || `c${now.replace(/\D/g, '').slice(-10)}${out.length}`;
    const was = before.find((x) => x.id === id);
    const same = !!was && was.state === state && was.number === number && (was.endsOn || null) === endsOn && (was.fileUrl || '') === fileUrl;
    if (was && !same) replaced.push(was);
    out.push({ id, state, number, endsOn, fileUrl, fileName: s(c?.fileName, 120) || 'certificate',
      ...(same ? { acceptedBy: was!.acceptedBy || actor.name, ...(was!.acceptedById ? { acceptedById: was!.acceptedById } : {}), acceptedAt: was!.acceptedAt || now }
        : { acceptedBy: actor.name, acceptedById: actor.id, acceptedAt: now }) });
  }
  return { certs: out, replaced };
}

function emailsFrom(raw: any, contact: string): { emails: string[]; error?: string } {
  const xs = Array.isArray(raw) ? raw.map((e: any) => lc(e)).filter(Boolean) : [];
  const bad = xs.find((e) => !EMAIL.test(e));
  if (bad) return { emails: [], error: `${bad} isn’t an email address.` };
  const out = [...new Set(xs)].filter((e) => e !== contact);
  if (out.length > MAX_EMAILS) return { emails: [], error: `Up to ${MAX_EMAILS} more emails.` };
  return { emails: out };
}

/**
 * Add a buyer, or change one. `b` holds the fields the sheet edits; the code is made here for a new buyer, and the
 * status and code have their own steps. Sales tax: 'exempt' needs a contact email (orders are tax free only with the
 * buyer's emails) and a certificate, except for a buyer the old shop-wide switch already made tax free.
 */
export async function saveBuyer(db: any, t: string, actor: Actor, b: any, rs: any): Promise<Ans> {
  const id = s(b?.id, 80);
  // When the sheet was opened (the buyer's updatedAt then): a save over someone else's change since is turned back.
  const seenAt = typeof b?.seenAt === 'string' ? b.seenAt : null;
  const businessName = s(b?.businessName, 120);
  if (businessName.length < 2) return { ok: false, message: 'Add the business’s name.' };
  const email = lc(b?.email);
  if (email && !EMAIL.test(email)) return { ok: false, message: `${email} isn’t an email address.` };
  const tax = b?.tax === 'exempt' ? 'exempt' : 'taxable';
  const now = new Date().toISOString();
  const ref = id ? accts(db, t).doc(id) : accts(db, t).doc();
  const code = id ? '' : await uniqueCode(db, t);
  return db.runTransaction(async (tx: any) => {
    const snap = id ? await tx.get(ref) : null;
    if (id && !snap.exists) return { ok: false, message: 'That buyer isn’t here any more.' };
    const cur = snap?.data() || {};
    if (id && seenAt !== null && String(cur.updatedAt || cur.createdAt || '') !== seenAt) return { ok: false, message: 'Someone changed this buyer while you had it open. Close it and open it again to see their changes.', stale: true };
    const before = readCerts(cur.certs);
    // Certificates and the extra emails stay on the buyer when they're set to pay tax; only 'exempt' uses them.
    const c = certsFrom(t, b?.certs, before, actor, now);
    if (c.error) return { ok: false, message: c.error };
    const em = emailsFrom(b?.taxEmails, email);
    if (em.error) return { ok: false, message: em.error };
    // Tax free under the old shop-wide switch, with no certificate yet: it stays so until one is added. Once a
    // certificate has been on file, that's over: taking it off doesn't bring the old switch back.
    const legacy = id ? taxSettingOf(cur, rs).legacy && !before.length && !(Array.isArray(cur.certsRemoved) && cur.certsRemoved.length) : false;
    if (tax === 'exempt' && !email) return { ok: false, message: 'Add their email. Orders are tax free only when they’re placed with it.' };
    if (tax === 'exempt' && !c.certs.length && !legacy) return { ok: false, message: 'Add their resale certificate to make them tax free.' };
    // Certificates taken off, and versions changed, are kept, with who did it and when.
    const kept = new Set(c.certs.map((x) => x.id));
    const removed = [...before.filter((x) => !kept.has(x.id)).map((x) => ({ ...x, removedAt: now, removedBy: actor.name, removedById: actor.id })),
      ...c.replaced.map((x) => ({ ...x, removedAt: now, removedBy: actor.name, removedById: actor.id, replaced: true }))];
    const certsRemoved = [...(Array.isArray(cur.certsRemoved) ? cur.certsRemoved : []), ...removed].slice(-MAX_HISTORY);
    const fields: Record<string, any> = {
      businessName, contactName: s(b?.contactName, 80), email, phone: s(b?.phone, 30), notes: s(b?.notes, 1000),
      // What the sheet doesn't show (from their application) stays as it was.
      kind: KINDS.includes(b?.kind) ? b.kind : (cur.kind || ''), state: stateCode(b?.state) || cur.state || '', website: b?.website !== undefined ? s(b.website, 200) : (cur.website || ''),
      extraDiscountPercent: clampDiscount(b?.extraDiscountPercent), tax, taxFromShopSwitch: tax === 'exempt' && legacy && !c.certs.length,
      certs: c.certs, certsRemoved, taxEmails: em.emails, updatedAt: now, updatedBy: actor.name,
    };
    if (id) tx.update(ref, fields);
    else tx.set(ref, { ...fields, accessCode: code, status: 'active', createdAt: now, createdBy: actor.name });
    return { ok: true, message: id ? `${businessName} saved.` : `${businessName} added. Their code is ${code}.`, id: ref.id, updatedAt: now, ...(code ? { code } : {}) };
  });
}

export async function setBuyerStatus(db: any, t: string, actor: Actor, id: string, status: string): Promise<Ans> {
  if (status !== 'active' && status !== 'suspended') return { ok: false, message: 'Unknown status.' };
  const ref = accts(db, t).doc(s(id, 80));
  const snap = await ref.get(); if (!snap.exists) return { ok: false, message: 'That buyer isn’t here any more.' };
  const name = String(snap.data()?.businessName || 'They');
  const at = new Date().toISOString();
  await ref.update({ status, updatedAt: at, updatedBy: actor.name, ...(status === 'suspended' ? { pausedAt: at } : {}) });
  return { ok: true, updatedAt: at, message: status === 'suspended' ? `${name} is paused. Their code doesn’t work until you turn them back on.` : `${name} can buy wholesale again.` };
}

export async function newBuyerCode(db: any, t: string, actor: Actor, id: string): Promise<Ans> {
  const ref = accts(db, t).doc(s(id, 80));
  const snap = await ref.get(); if (!snap.exists) return { ok: false, message: 'That buyer isn’t here any more.' };
  const code = await uniqueCode(db, t);
  const at = new Date().toISOString();
  await ref.update({ accessCode: code, updatedAt: at, updatedBy: actor.name });
  return { ok: true, message: `Their new code is ${code}. The old one stopped working.`, code, updatedAt: at };
}

/** The email that gives a buyer their code: what it unlocks, where to use it, and when their orders are tax free. */
export function codeEmail(a: { shopName: string; business: string; contact: string; code: string; link: string; taxFreeStates: string[]; email: string }): { subject: string; body: string; text: string } {
  const tax = a.taxFreeStates.length
    ? `Orders placed with ${a.email} are tax free in ${a.taxFreeStates.map(stateName).join(', ')}, under your resale certificate on file.` : '';
  const body = `<p style="margin:0 0 10px">Hi ${esc(first(a.contact))},</p>
<p style="margin:0 0 14px">${esc(a.business)} can now buy wholesale from ${esc(a.shopName)}. This is your code:</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:.06em">${esc(a.code)}</p>
<p style="margin:0 0 14px">Open the link below to start shopping at wholesale prices. It also signs you in, which tax-free orders need. Or enter the code on the shop under Wholesale access.</p>
${tax ? `<p style="margin:0 0 14px">${esc(tax)}</p>` : ''}
<p style="margin:0 0 14px">Keep the code for your business: it works on every order until ${esc(a.shopName)} changes it.</p>`;
  const text = `Hi ${first(a.contact)}, ${a.business} can now buy wholesale from ${a.shopName}. Your code: ${a.code}. Start shopping: ${a.link}${tax ? ` ${tax}` : ''}`;
  return { subject: `${a.shopName}: your wholesale code`, body, text };
}

/** Current certificate states, for the code email. */
const freeStates = (acct: any, rs: any, today: string) => taxSettingOf(acct, rs).setting === 'exempt' ? [...new Set(readCerts(acct.certs).filter((c) => !c.endsOn || c.endsOn >= today).map((c) => c.state))] : [];

export async function emailBuyerCode(db: any, t: string, id: string, deps: { send: Send; shopName: string; origin: string; rs: any; today: string; wrap: (html: string) => string }): Promise<Ans> {
  const snap = await accts(db, t).doc(s(id, 80)).get(); if (!snap.exists) return { ok: false, message: 'That buyer isn’t here any more.' };
  const a = snap.data() || {};
  if (!a.email) return { ok: false, message: 'Add their email first.' };
  if (a.status !== 'active') return { ok: false, message: 'They’re paused. Turn them back on first.' };
  // The link signs them in as this email too, with a proven session (lib/retail-account): it reached their inbox, which
  // tax-free buying needs.
  const exp = Date.now() + ACCOUNT_TOKEN_DAYS * 864e5;
  const link = `${deps.origin}/shop/${encodeURIComponent(t)}/wholesale?code=${encodeURIComponent(a.accessCode)}&e=${encodeURIComponent(a.email)}&x=${exp}&s=${signProvenAccountToken(t, a.email, exp)}`;
  const m = codeEmail({ shopName: deps.shopName, business: a.businessName, contact: a.contactName || '', code: a.accessCode, link, taxFreeStates: freeStates(a, deps.rs, deps.today), email: a.email });
  const r = await deps.send({ to: a.email, subject: m.subject, html: deps.wrap(`${m.body}<p style="margin:0"><a href="${esc(link)}">Start shopping at wholesale prices</a></p>`), text: m.text, kind: 'wholesale_code', name: a.contactName || a.businessName });
  return r.ok ? { ok: true, message: `Emailed to ${a.email}.` } : { ok: false, message: 'That email didn’t go out. Try again in a minute.' };
}

/**
 * Approve an application: the buyer is made with the discount and sales tax the team chose (a tax-free one with the
 * certificate they sent, as checked by the team), their code is made, and the code is emailed to them. Once, however
 * many times it's pressed.
 */
export async function approveApplication(db: any, t: string, actor: Actor, b: any, rs: any): Promise<Ans> {
  const appRef = apps(db, t).doc(s(b?.appId, 80));
  const acctRef = accts(db, t).doc();
  const code = await uniqueCode(db, t);
  const now = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(appRef);
    if (!snap.exists) return { ok: false, message: 'That application isn’t here any more.' };
    const ap = snap.data() || {};
    if (ap.status === 'approved') return { ok: true, message: `${ap.businessName} is already a buyer.`, id: ap.accountId, already: true };
    if (ap.status === 'replaced') return { ok: false, message: 'They sent a newer application. Close this one and open the newer one.' };
    if (ap.status !== 'pending') return { ok: false, message: 'That application was declined. They can apply again.' };
    const tax = b?.tax === 'exempt' ? 'exempt' : 'taxable';
    let certs: Cert[] = [];
    if (tax === 'exempt') {
      // The copy they sent, or one the team added in the sheet.
      const file = isCertFile(t, b?.cert?.fileUrl) ? { fileUrl: String(b.cert.fileUrl), fileName: s(b.cert.fileName, 120) || 'certificate' } : isCertFile(t, ap.certFileUrl) ? { fileUrl: ap.certFileUrl, fileName: ap.certFileName } : {};
      const c = certsFrom(t, [{ state: b?.cert?.state, number: b?.cert?.number, endsOn: b?.cert?.endsOn ?? null, ...file }], [], actor, now);
      if (c.error) return { ok: false, message: c.error };
      certs = c.certs;
    }
    tx.set(acctRef, {
      businessName: ap.businessName, contactName: ap.contactName || '', email: ap.email, phone: ap.phone || '', kind: ap.kind || '', state: ap.state || '',
      website: ap.website || '', notes: s(b?.notes, 1000), accessCode: code, extraDiscountPercent: clampDiscount(b?.extraDiscountPercent), status: 'active',
      tax, taxFromShopSwitch: false, certs, certsRemoved: [], taxEmails: [], applicationId: appRef.id, createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
    });
    tx.update(appRef, { status: 'approved', accountId: acctRef.id, decidedAt: now, decidedBy: actor.name, updatedAt: now });
    return { ok: true, message: `${ap.businessName} is a buyer now.`, id: acctRef.id, code };
  });
}

/** Decline an application. They're emailed only when the team chooses, with the team's note if there is one. */
export async function declineApplication(db: any, t: string, actor: Actor, b: any): Promise<Ans> {
  const appRef = apps(db, t).doc(s(b?.appId, 80));
  const now = new Date().toISOString(); const note = s(b?.note, 500);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(appRef);
    if (!snap.exists) return { ok: false, message: 'That application isn’t here any more.' };
    const ap = snap.data() || {};
    if (ap.status === 'declined') return { ok: true, message: 'Already declined.', already: true };
    if (ap.status === 'replaced') return { ok: false, message: 'They sent a newer application. Close this one and open the newer one.' };
    if (ap.status !== 'pending') return { ok: false, message: `${ap.businessName} is already a buyer.` };
    tx.update(appRef, { status: 'declined', decidedAt: now, decidedBy: actor.name, updatedAt: now, ...(note ? { declineNote: note } : {}) });
    return { ok: true, message: `Declined. ${b?.email === true ? 'They’ll get an email.' : 'Nothing was sent to them.'}`, app: ap, note };
  });
}

export function declineEmail(a: { shopName: string; business: string; contact: string; note: string }): { subject: string; body: string; text: string } {
  const body = `<p style="margin:0 0 10px">Hi ${esc(first(a.contact))},</p>
<p style="margin:0 0 14px">Thank you for applying for a wholesale account for ${esc(a.business)}. ${esc(a.shopName)} can’t open one right now.</p>
${a.note ? `<p style="margin:0 0 14px">${esc(a.note)}</p>` : ''}
<p style="margin:0">You’re still welcome to shop at ${esc(a.shopName)} any time.</p>`;
  return { subject: `${a.shopName}: your wholesale application`, body, text: `Hi ${first(a.contact)}, thank you for applying for a wholesale account for ${a.business}. ${a.shopName} can’t open one right now.${a.note ? ` ${a.note}` : ''}` };
}

/**
 * Wholesale settings: taking applications, and whether the house code's orders are tax free. Before that switch
 * changes, each buyer that still follows it gets it as their own setting, so the switch only ever moves the house code.
 */
export async function saveWholesaleSettings(db: any, t: string, actor: Actor, b: any): Promise<Ans> {
  const ref = db.doc(`tenants/${t}`);
  const snap = await ref.get(); const rs = snap.data()?.retailSettings || {};
  const patch: Record<string, any> = {};
  if (typeof b?.applyOpen === 'boolean') patch.wholesaleApplyOpen = b.applyOpen;
  if (typeof b?.houseTaxFree === 'boolean' && b.houseTaxFree !== (rs.wholesaleTaxExempt === true)) {
    const all = await accts(db, t).get();
    const was = rs.wholesaleTaxExempt === true; const now = new Date().toISOString();
    // In batches of up to 400; a run cut short is safe to repeat (buyers already given a setting are skipped), and the
    // switch only changes once every buyer has theirs.
    const todo = all.docs.filter((d: any) => { const a = d.data() || {}; return a.tax !== 'exempt' && a.tax !== 'taxable'; });
    for (let i = 0; i < todo.length; i += 400) {
      const batch = db.batch();
      for (const d of todo.slice(i, i + 400)) batch.update(d.ref, { tax: was ? 'exempt' : 'taxable', taxFromShopSwitch: was, updatedAt: now, updatedBy: actor.name });
      await batch.commit();
    }
    patch.wholesaleTaxExempt = b.houseTaxFree;
  }
  if (!Object.keys(patch).length) return { ok: true, message: 'Nothing to change.' };
  await ref.set({ retailSettings: patch }, { merge: true });
  return { ok: true, message: 'Saved.' };
}

/** A public application's answers, checked; a message when something's missing. Run before anything is saved. */
export function checkApplication(b: any): { ok: true; fields: Record<string, any> } | { ok: false; message: string } {
  const businessName = s(b?.businessName, 120); const contactName = s(b?.contactName, 80); const email = lc(b?.email);
  if (businessName.length < 2) return { ok: false, message: 'Add your business’s name.' };
  if (!contactName) return { ok: false, message: 'Add your name.' };
  if (!EMAIL.test(email)) return { ok: false, message: 'Add an email we can send your code to.' };
  const state = stateCode(b?.state);
  if (!state) return { ok: false, message: 'Choose your state.' };
  return { ok: true, fields: {
    businessName, contactName, email, phone: s(b?.phone, 30), kind: KINDS.includes(b?.kind) ? b.kind : 'other', state,
    website: s(b?.website, 200), certNumber: s(b?.certNumber, 40), note: s(b?.note, 500),
  } };
}

/** How many applications are waiting (counted by the database where it can). */
export async function pendingCount(db: any, t: string): Promise<number> {
  const q = apps(db, t).where('status', '==', 'pending');
  if (typeof q.count === 'function') { try { return Number((await q.count().get()).data().count) || 0; } catch { /* below */ } }
  return (await q.limit(MAX_PENDING).get()).size;
}
export const tooManyWaiting = (n: number) => n >= MAX_PENDING;

/**
 * A public application from the shop (checkApplication first; the route saves any copy only after that). Each one is
 * its own record: one sent again with the same email marks the earlier waiting one replaced (keeping its copy if this
 * one has none), in one step with the team deciding on it, so an approved or declined one never goes back to waiting.
 * The answer is the same either way, so nobody learns from it who has applied.
 */
export async function applyForWholesale(db: any, t: string, b: any, rs: any): Promise<Ans & { id?: string; fresh?: boolean }> {
  if (rs?.wholesaleApplyOpen !== true) return { ok: false, message: 'This shop isn’t taking wholesale applications right now.' };
  const chk = checkApplication(b);
  if (!chk.ok) return { ok: false, message: chk.message };
  const f = chk.fields;
  const certFileUrl = b?.certFileUrl && isCertFile(t, b.certFileUrl) ? String(b.certFileUrl) : '';
  const now = new Date().toISOString();
  // One slot per email (a record beside the applications, with no status, so no list shows it): it names the latest
  // application from that email. Read and written in the same step, so two sent at once can't both start fresh.
  const slotRef = apps(db, t).doc(`slot_${createHash('sha256').update(`${t}|${f.email}`).digest('hex').slice(0, 32)}`);
  const ref = apps(db, t).doc();
  const fresh = await db.runTransaction(async (tx: any) => {
    const slot = await tx.get(slotRef);
    const lastId = slot.exists ? String(slot.data()?.appId || '') : '';
    const last = lastId ? await tx.get(apps(db, t).doc(lastId)) : null;
    const earlier = last?.exists && last.data()?.status === 'pending' ? { ref: last.ref, ...last.data() } : null;
    const file = certFileUrl ? { certFileUrl, certFileName: s(b?.certFileName, 120) || 'certificate' } : earlier?.certFileUrl ? { certFileUrl: earlier.certFileUrl, certFileName: earlier.certFileName || 'certificate' } : { certFileUrl: '', certFileName: '' };
    tx.set(ref, { ...f, ...file, status: 'pending', createdAt: now, updatedAt: now, ...(earlier ? { replaces: [earlier.ref.id] } : {}) });
    if (earlier) tx.update(earlier.ref, { status: 'replaced', replacedBy: ref.id, updatedAt: now });
    tx.set(slotRef, { appId: ref.id, at: now });
    return !earlier;
  });
  return { ok: true, message: 'Sent.', id: ref.id, fresh };
}
