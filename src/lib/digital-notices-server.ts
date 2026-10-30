// src/lib/digital-notices-server.ts — SENDING A DOWNLOAD'S LATER MESSAGES (server; the rules are in lib/digital-notices).
//   · sweepEndingNotices: the nightly shop checks (lib/retail-nightly) email anyone whose access ends within the lead
//     time, once per end date, claimed on the record first so a second run sends nothing;
//   · notifyFileUpdate: the shop's "Email buyers" after saving a new version (api/retail/digital/notify-update);
//   · alertMissingFile: a buyer couldn't open a file, so the team hears (once per item a day).
// Each email is claimed on the buyer's record before it goes and the claim given back if it doesn't, written with
// dotted paths so two messages going at once never undo each other's marks. If the process stops between the claim and
// the send, that one message is skipped rather than sent twice. Both senders stop at a time budget and carry on from
// where they stopped next time (the claims mark who is done).
import { accessEndsAt, downloadsLeft } from '@/lib/entitlements';
import { digitalLineAccess } from '@/lib/digital-access-rule';
import { filesOf } from '@/lib/digital-product';
import { tenantTimeZone } from '@/lib/tenant-time';
import { variantIdsOf } from '@/lib/variants';
import { endingDue, endingMessage, missingAlert, missingKey, updateDue, updateMessage } from '@/lib/digital-notices';

const DAY = 86400e3;
const appOrigin = () => String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');

async function mail(db: any, tenantId: string, ent: any, shop: string, subject: string, lines: string[], cta: { label: string; url: string }, kind: string): Promise<boolean> {
  try {
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const { sendNotification } = await import('@/lib/notify');
    const html = brandedEmailHtml({ studioName: shop, title: subject, bodyLines: lines, cta });
    const r = await sendNotification(db, { tenantId, channel: 'email', to: String(ent.email), subject, text: `${lines.join('\n\n')}\n\n${cta.url}`, html, kind, clientId: ent.clientId || null, recipientType: ent.gift ? 'other' : 'client' });
    return !!r.ok;
  } catch (e: any) { console.error('[digital-notices] send', String(e?.message || e).slice(0, 160)); return false; }
}

/** Where this record stands now, by the one rule over its order. */
async function standing(db: any, tenantId: string, ent: any, now: number): Promise<{ open: boolean; endsAt: string | null } | null> {
  if (!ent?.orderId) return null;
  const os = await db.doc(`tenants/${tenantId}/retailOrders/${ent.orderId}`).get();
  const order: any = os.exists ? os.data() : null;
  const line = order ? (order.lines || []).find((l: any) => String(l.lineId || l.productId) === String(ent.lineId || ent.productId)) : null;
  if (!order || !line) return null;
  const a = digitalLineAccess(order, line, now, ent);
  return { open: a.open, endsAt: a.endsAt };
}

/** Every record whose `field` falls in [lo, hi], a page at a time, until the time budget runs out. */
async function* inRange(col: any, field: string, lo: string, hi: string, until: number) {
  let last: any = null;
  while (Date.now() < until) {
    let q = col.where(field, '>=', lo).where(field, '<=', hi).orderBy(field).limit(200);
    if (last) q = q.startAfter(last);
    const s = await q.get();
    for (const d of s.docs) yield d;
    if (s.docs.length < 200) return;
    last = s.docs[s.docs.length - 1];
  }
}

/** Nightly: access ending within the week (or sooner for short windows). How many were emailed, and whether it finished. */
export async function sweepEndingNotices(db: any, tenantId: string, tenant: any, now = Date.now(), budgetMs = 60_000): Promise<{ sent: number; done: boolean }> {
  const origin = appOrigin(); if (!origin) throw new Error('NEXT_PUBLIC_APP_URL is not set, so access reminders can’t link to the library.');
  const until = Date.now() + budgetMs;
  const lo = new Date(now).toISOString(); const hi = new Date(now + 7 * DAY).toISOString();
  const col = db.collection(`tenants/${tenantId}/entitlements`);
  const shop = String(tenant?.businessName || tenant?.name || 'The shop');
  const zone = tenantTimeZone(tenant);
  const seen = new Set<string>();
  let sent = 0;
  // `accessEnd` is the end counting the shop's extensions. Records made before it existed are found by their window,
  // or by the extension the shop gave them.
  for (const field of ['accessEnd', 'access.endsAt', 'access.extendedUntil']) {
    for await (const d of inRange(col, field, lo, hi, until)) {
      if (seen.has(d.id)) continue; seen.add(d.id);
      try {
        const ent: any = { id: d.id, ...d.data() };
        const end = accessEndsAt(ent);
        // Already warned about this end: no order read needed.
        if (!end || !ent.email || String(ent.notices?.endingFor || '') === end) continue;
        const st = await standing(db, tenantId, ent, now);
        if (!st || !endingDue(ent, st, now)) continue;
        // Claimed for this end date first: a second run the same night finds it taken.
        const claimed = await db.runTransaction(async (tx: any) => {
          const cur: any = (await tx.get(d.ref)).data() || {};
          if (String(cur.notices?.endingFor || '') === st.endsAt) return false;
          tx.update(d.ref, { 'notices.endingFor': st.endsAt });
          return true;
        });
        if (!claimed) continue;
        const m = endingMessage(String(ent.name || 'your download'), shop, st.endsAt!, downloadsLeft(ent), ent.gift === true, zone);
        const ok = await mail(db, tenantId, ent, shop, m.subject, [m.line, m.ask], { label: ent.gift ? 'Open my gift' : 'Open my library', url: `${origin}/shop/${tenantId}/library/${ent.orderId}` }, 'digital_ending');
        if (ok) sent++;
        // A send that didn't go gives the claim back, so tomorrow's run tries again.
        else await d.ref.update({ 'notices.endingFor': null }).catch(() => {});
      } catch { /* next record; tomorrow tries again */ }
    }
    if (Date.now() >= until) return { sent, done: false };
  }
  return { sent, done: true };
}

/**
 * The shop's "Email buyers" after a new version: everyone who bought this item (or one of its variants) before that
 * version, and can still open it, once per file version. Stops at a time budget; pressing again carries on.
 */
export async function notifyFileUpdate(db: any, tenantId: string, productId: string, fileIds: string[], now = Date.now(), budgetMs = 90_000): Promise<{ ok: true; sent: number; skipped: number; failed: number; more: boolean } | { ok: false; error: string }> {
  const origin = appOrigin(); if (!origin) return { ok: false, error: 'Emails can’t be sent from this setup yet.' };
  const until = Date.now() + budgetMs;
  const [iSnap, tSnap] = await Promise.all([db.doc(`tenants/${tenantId}/inventory/${productId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const item: any = iSnap.exists ? { id: iSnap.id, ...iSnap.data() } : null;
  if (!item || item.digital !== true) return { ok: false, error: 'That download wasn’t found.' };
  // Only a file that has really had a new version: the first version is what everyone bought.
  const files = filesOf(item).filter((f) => fileIds.includes(f.id) && f.version >= 2).map((f) => ({ id: f.id, version: f.version, name: f.name, addedAt: f.addedAt }));
  if (!files.length) return { ok: false, error: 'Save the new version first.' };
  const t: any = tSnap.exists ? tSnap.data() : {};
  const shop = String(t.businessName || t.name || 'The shop');
  const ids = [item.id, ...variantIdsOf(item)];
  let sent = 0, skipped = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 30) {
    let last: any = null;
    for (;;) {
      if (Date.now() >= until) return { ok: true, sent, skipped, failed, more: true };
      let q = db.collection(`tenants/${tenantId}/entitlements`).where('productId', 'in', ids.slice(i, i + 30)).orderBy('__name__').limit(200);
      if (last) q = q.startAfter(last);
      const s = await q.get();
      for (const d of s.docs) {
        if (Date.now() >= until) return { ok: true, sent, skipped, failed, more: true };
        const ent: any = { id: d.id, ...d.data() };
        // Bought after the version went up (they already have it), or already told: nothing to say.
        const due = files.filter((f) => updateDue(ent, [f]) && !(f.addedAt && String(ent.createdAt || '') >= f.addedAt));
        if (!due.length || !ent.email) { skipped++; continue; }
        try {
          const st = await standing(db, tenantId, ent, now);
          if (!st?.open || ent.status === 'revoked') { skipped++; continue; }
          // Claimed for these versions first, so two presses at once send it once.
          const prev: Record<string, number> = {};
          const claimed = await db.runTransaction(async (tx: any) => {
            const cur: any = (await tx.get(d.ref)).data() || {};
            if (!due.some((f) => updateDue(cur, [f]))) return false;
            const patch: Record<string, any> = {};
            for (const f of due) { prev[f.id] = Number(cur.notices?.updated?.[f.id] || 0); patch[`notices.updated.${f.id}`] = f.version; }
            tx.update(d.ref, patch);
            return true;
          });
          if (!claimed) { skipped++; continue; }
          const m = updateMessage(String(ent.name || item.name || 'Your download'), shop, due, ent.gift === true);
          const ok = await mail(db, tenantId, ent, shop, m.subject, [m.line], { label: m.cta, url: `${origin}/shop/${tenantId}/library/${ent.orderId}` }, 'digital_update');
          if (ok) sent++;
          else {
            failed++;
            const back: Record<string, any> = {}; for (const f of due) back[`notices.updated.${f.id}`] = prev[f.id] || null;
            await d.ref.update(back).catch(() => {});
          }
        } catch { failed++; }
      }
      if (s.docs.length < 200) break;
      last = s.docs[s.docs.length - 1];
    }
  }
  return { ok: true, sent, skipped, failed, more: false };
}

/** A buyer couldn't open an item's file: the team hears, once per item a day. Never blocks the buyer's answer. */
export async function alertMissingFile(db: any, tenantId: string, item: any, productId: string, product: string, why: 'missing' | 'unattached'): Promise<void> {
  try {
    // A variant sold inside its listing keeps its files on the listing: that's where they're put right. The item here
    // may already carry the listing's files, so the variant's own record says whether it has any.
    let where = String(productId);
    if (item?.parentId && String(item.parentId) !== where) {
      const own: any = (await db.doc(`tenants/${tenantId}/inventory/${where}`).get().catch(() => null))?.data?.() || {};
      if (!(Array.isArray(own.digitalFiles) && own.digitalFiles.length) && !own.digitalFilePath) where = String(item.parentId);
    }
    const today = new Date().toISOString().slice(0, 10);
    const ref = db.doc(`tenants/${tenantId}/notifications/${missingKey(where, today)}`);
    await ref.create({ id: ref.id, type: 'digital_file_missing', read: false, createdAt: new Date().toISOString(), link: `/inventory/product/${encodeURIComponent(where)}`, productId: where, message: missingAlert(product, why) });
  } catch { /* already told today, or it couldn't be written: the buyer is still answered */ }
}
