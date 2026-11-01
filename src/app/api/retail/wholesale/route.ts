// src/app/api/retail/wholesale/route.ts — WHOLESALE, CHANGED BY A MANAGER (lib/wholesale-server has the steps). A buyer's
// code is money off and their certificate makes orders tax free, so only managers come here, and the browser never
// writes either itself (firestore.rules). Who did it is taken from the sign-in.
//   save · status · newCode · emailCode · approve · decline · upload · settings
import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import * as W from '@/lib/wholesale-server';
import { getEmailBrand, brandedEmail } from '@/lib/email-shell';
import { sendNotification } from '@/lib/notify';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);

/** How the code and decline emails go out: the shop's branded email, logged with every other message (lib/notify). */
async function mailer(db: any, t: string) {
  const brand = await getEmailBrand(db, t);
  const send: W.Send = async (m) => {
    const r = await sendNotification(db, { tenantId: t, channel: 'email', to: m.to, subject: m.subject, html: m.html, text: m.text, kind: m.kind, recipientType: 'contact', recipientName: m.name });
    return { ok: r.ok };
  };
  return { send, shopName: brand.shopName, wrap: (html: string) => brandedEmail(brand, html) };
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const t = s(b.tenantId, 120);
  const g = await requireRole(req, t, 'manager'); if (g.deny) return g.deny;
  // Their whole name and their id, kept with each certificate they accept and each change they make.
  const actor = { id: String(g.actor.uid || ''), name: String(g.actor.name || 'A manager').slice(0, 80) };
  const db = getAdminDb();
  const tenant = (await db.doc(`tenants/${t}`).get()).data() || {};
  const rs = tenant.retailSettings || {};
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || '').trim().replace(/\/+$/, '');
  const today = todayIn(tenantTimeZone(tenant));
  const out = (r: W.Ans) => NextResponse.json(r, { status: r.ok ? 200 : 400 });
  try {
    switch (s(b.action, 30)) {
      case 'save': return out(await W.saveBuyer(db, t, actor, b.buyer || {}, rs));
      case 'status': return out(await W.setBuyerStatus(db, t, actor, s(b.id, 80), s(b.status, 20)));
      case 'newCode': return out(await W.newBuyerCode(db, t, actor, s(b.id, 80)));
      case 'emailCode': { const m = await mailer(db, t); return out(await W.emailBuyerCode(db, t, s(b.id, 80), { ...m, origin, rs, today })); }
      case 'approve': {
        const r = await W.approveApplication(db, t, actor, b, rs);
        if (!r.ok || r.already) return out(r);
        // The code goes to them once the buyer is made; if the email doesn't go out, the team can send it again.
        const m = await mailer(db, t);
        const sent = await W.emailBuyerCode(db, t, r.id, { ...m, origin, rs, today }).catch(() => ({ ok: false, message: '' }));
        return out({ ...r, emailed: sent.ok, message: sent.ok ? `${r.message} Their code is on its way to them.` : `${r.message} Their code is ${r.code}. The email didn’t go out: send it from their sheet.` });
      }
      case 'decline': {
        const r = await W.declineApplication(db, t, actor, b);
        if (r.ok && !r.already && b.email === true && r.app?.email) {
          const app = r.app; const note = String(r.note || '');
          after(async () => {
            const m = await mailer(db, t);
            const e = W.declineEmail({ shopName: m.shopName, business: app.businessName, contact: app.contactName || '', note });
            await m.send({ to: app.email, subject: e.subject, html: m.wrap(e.body), text: e.text, kind: 'wholesale_declined', name: app.contactName || app.businessName }).catch(() => null);
          });
        }
        const { app: _a, note: _n, ...rest } = r;
        return out(rest as W.Ans);
      }
      case 'upload': {
        const up = await uploadClaimPhotoFromDataUrl(t, s(b.for, 80).replace(/[^\w-]/g, '') || 'buyers', b.file, 'wholesale-certs');
        if (!up.url) return out({ ok: false, message: up.error || 'That copy couldn’t be saved. Try again.' });
        return out({ ok: true, message: 'Added.', url: up.url, name: s(b.name, 120).replace(/[^\w.\- ]/g, '') || 'certificate' });
      }
      case 'settings': {
        // Whether the house code's orders are tax free is the owner's call (it was the owner's to change before, on the
        // business record); taking applications is any manager's.
        if (typeof b.houseTaxFree === 'boolean') { const o = await requireRole(req, t, 'owner'); if (o.deny) return NextResponse.json({ ok: false, message: 'Only the owner or an admin can change whether house code orders are tax free.' }, { status: 403 }); }
        return out(await W.saveWholesaleSettings(db, t, actor, b));
      }
      default: return NextResponse.json({ ok: false, message: 'Unknown step.' }, { status: 400 });
    }
  } catch (e: any) {
    console.error('[wholesale]', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, message: 'That didn’t go through. Try again.' }, { status: 500 });
  }
}
