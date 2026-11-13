// src/app/api/retail/pro-licenses/route.ts — LICENSES ON FILE, for the team (app/(app)/retail-orders/licenses;
// lib/pro-license): the licenses customers sent from the shop, to approve or decline, and a quick check at the register.
//   list   { tenantId } → anyone on the team: those waiting to be checked (all of them), then the latest of the rest; a
//          renewal sent while a license is good shows as `pending` beside it (a copy's link to managers only)
//   decide { tenantId, id, decision: 'approve' | 'decline' | 'revoke', sentAt, expiresOn?, note? } → managers: approve
//          (with the expiry read off the license), decline (with a reason they're told), or take an approved one off.
//          `sentAt` is the one they looked at: sent again since, and it's 409. The customer gets an email either way
//          (lib/notify); an approval carries a sign-in link, the way they order products for pros (lib/retail-account).
//   check  { tenantId, email } → anyone on the team: whether that email has a license good today
//          ({ state: 'valid' | 'expired' | 'waiting' | 'declined' | 'none', expiresOn?, name? })
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { licensesOf, licenseFor, licenseValid, decideLicense, normEmail } from '@/lib/pro-license';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { getEmailBrand, brandedEmail } from '@/lib/email-shell';
import { sendNotification } from '@/lib/notify';
import { logAuditAdmin } from '@/lib/audit';
import { accountUrl } from '@/lib/retail-account';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const esc = (x: any) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const dayWords = (d: string) => { const t = Date.parse(`${d}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : d; };

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'decide', 'check'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, action === 'decide' ? 'manager' : 'staff'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('Licenses are the business’s own.', 403);
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const today = todayIn(tenantTimeZone(tenant));
    const manager = !!(g.actor?.isTenantOwner || g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase()));

    if (action === 'check') {
      const email = normEmail(b.email); if (!email) return bad('Which email?');
      const l: any = await licenseFor(db, tenantId, email);
      const state = !l ? 'none' : licenseValid(l, today) ? 'valid' : l.status === 'approved' ? 'expired' : l.status === 'waiting' ? 'waiting' : 'declined';
      return ok({ state, ...(l ? { name: l.name, expiresOn: l.expiresOn || null } : {}) });
    }

    if (action === 'list') {
      // Everything waiting, however many are on file; then the latest of the rest.
      const [waiting, latest] = await Promise.all([
        licensesOf(db, tenantId).where('toCheck', '==', true).limit(300).get(),
        licensesOf(db, tenantId).orderBy('sentAt', 'desc').limit(300).get(),
      ]);
      const seen = new Map<string, any>(); for (const d of [...waiting.docs, ...latest.docs]) if (!seen.has(d.id)) seen.set(d.id, d);
      // (The copy of someone's license, to managers only.)
      const copy = (x: any) => (manager ? { fileUrl: x?.fileUrl || '', fileName: x?.fileName || '' } : { hasFile: !!x?.fileUrl });
      const licenses = [...seen.values()].map((d: any) => { const l: any = d.data() || {}; const p: any = l.pending && typeof l.pending === 'object' ? l.pending : null;
        return { id: d.id, name: l.name || '', email: l.email || '', phone: l.phone || '', number: l.number || '', state: l.state || '', expiresOn: l.expiresOn || '',
          status: l.status || 'waiting', note: l.note || '', sentAt: l.sentAt || '', decidedAt: l.decidedAt || null, decidedBy: l.decidedBy || null,
          valid: licenseValid(l, today), renewalOf: l.renewalOf || null, toCheck: l.status === 'waiting' || !!p,
          pending: p ? { name: p.name || '', phone: p.phone || '', number: p.number || '', state: p.state || '', expiresOn: p.expiresOn || '', sentAt: p.sentAt || '', ...copy(p) } : null,
          ...copy(l) };
      }).sort((x: any, y: any) => Number(y.toCheck) - Number(x.toCheck) || String(y.pending?.sentAt || y.sentAt).localeCompare(String(x.pending?.sentAt || x.sentAt)));
      return ok({ licenses, today, canDecide: manager });
    }

    // decide
    const id = String(b.id || ''); const act = String(b.decision || '') as 'approve' | 'decline' | 'revoke';
    if (!['approve', 'decline', 'revoke'].includes(act)) return bad('Approve, decline or take off?');
    const by = { id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'A manager').slice(0, 80) };
    const r: any = await decideLicense(db, tenantId, id, { action: act, expiresOn: b.expiresOn, note: b.note, sentAt: b.sentAt == null ? undefined : String(b.sentAt) }, by, today, new Date().toISOString());
    if (!r.ok) return bad(r.error, r.status);
    const l = r.license;
    const what = `${l.name}’s ${r.renewal ? 'renewed ' : ''}license (${r.was.state} ${r.was.number})`;
    await logAuditAdmin(db, tenantId, { action: `pro_license.${act}`, targetType: 'pro_license', targetId: id, summary: `${what} ${act === 'approve' ? `approved, good to ${l.expiresOn}` : act === 'decline' ? 'declined' : 'taken off'}`, actor: { type: 'user', id: by.id, name: by.name } } as any).catch(() => {});
    // The customer hears either way, from the shop's own email.
    try {
      const brand = await getEmailBrand(db, tenantId);
      const origin = String(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || '').trim().replace(/\/+$/, '');
      const link = `${origin}/shop/${encodeURIComponent(tenantId)}/pro`;
      const first = String(l.name || '').split(' ')[0] || 'there';
      const why = String(l.note || '').trim().replace(/([^.!?])$/, '$1.');
      // (Approved: a sign-in link, since orders with products for pros are placed signed in with this email.)
      const signIn = act === 'approve' ? accountUrl(origin, tenantId, l.email) : '';
      const m = act === 'approve'
        ? { subject: `Your license is on file at ${brand.shopName}`, text: `Hi ${first}, your license is on file. You can order products for licensed pros until ${dayWords(l.expiresOn)}, signed in as ${l.email}. Open this link in the browser you shop with to sign in: ${signIn}` }
        // (The one on file is mentioned only while it's still good: not if it was taken off or has run out since.)
        : act === 'decline' && r.renewal && licenseValid(l, today)
        ? { subject: `About the license you sent ${brand.shopName}`, text: `Hi ${first}, we couldn’t put the license you just sent on file: ${why} The one on file is still good until ${dayWords(l.expiresOn)}. You can send the new one again here: ${link}` }
        : act === 'decline'
        ? { subject: `About the license you sent ${brand.shopName}`, text: `Hi ${first}, we couldn’t put your license on file: ${why} You can send it again here: ${link}` }
        : { subject: `Your license at ${brand.shopName}`, text: `Hi ${first}, your license is no longer on file${why ? `: ${why}` : '.'} You can send a current one here: ${link}` };
      await sendNotification(db, { tenantId, channel: 'email', to: l.email, subject: m.subject, text: m.text, html: brandedEmail(brand, signIn ? `<p>${esc(m.text.slice(0, m.text.lastIndexOf(' Open this link')))}</p><p><a href="${esc(signIn)}">Sign in to order</a></p><p>Open it in the browser you shop with.</p>` : `<p>${esc(m.text)}</p>`), kind: 'pro_license', recipientType: 'contact', recipientName: l.name } as any);
    } catch (e: any) { console.error('[pro-licenses] email not sent', e?.message); }
    return ok({ license: { ...l, valid: licenseValid(l, today) } });
  } catch (e: any) {
    console.error('[pro-licenses]', e?.message);
    return bad('That didn’t work. Try again.', 500);
  }
}
