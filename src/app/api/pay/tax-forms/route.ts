// /api/pay/tax-forms — the Pay tab › Your tax forms (design board "Your own W-4"): a person fills in their own W-4 and
// their state's form, signs it with their typed name, and sends it. Only their own, and only the tax forms: what's taken
// out before taxes and how they're paid stay as the business set them. Saved with their pay (staffPay.taxForms, read
// by Payday and the server from the next paycheck), with the signature and the last few versions kept, and the owner
// told. Never takes a Social Security number. Only when payroll is run in ClarityFlow (a payroll company takes its own).
// POST { tenantId, forms: { federal, state }, signedName } → { ok }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { logAuditAdmin } from '@/lib/audit';
import { cleanTaxForms } from '@/lib/withholding';
import { runByOf, payrollStateOf } from '@/lib/payroll-taxes';
import { stateSpec } from '@/lib/state-payroll';
import { ensureOwnerTeamMember } from '@/lib/owner-staff';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 }); }
  const tenantId = String(b?.tenantId || '').slice(0, 80); if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const staffId = who.actor.staffId; if (!staffId) return NextResponse.json({ ok: false, error: 'Only someone on the team has tax forms here.' }, { status: 403 });
  const signedName = String(b?.signedName || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (signedName.length < 2) return NextResponse.json({ ok: false, error: 'Type your full name to sign it.' }, { status: 400 });
  const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  if (runByOf(tenant) !== 'clarityflow') return NextResponse.json({ ok: false, error: 'Your employer’s payroll company takes your W-4.' }, { status: 400 });
  const m: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data();
  if (!m || m.isRenter === true || m.employmentType === 'contractor') return NextResponse.json({ ok: false, error: 'Tax forms are for employees.' }, { status: 400 });
  // (Only the W-4, always the 2020 one or later, and the state's form; a form for another state isn't kept.)
  const fed = b?.forms?.federal && typeof b.forms.federal === 'object' ? { ...b.forms.federal, form: '2020', allowances: undefined } : undefined;
  const clean = cleanTaxForms({ federal: fed, state: b?.forms?.state });
  const code = payrollStateOf(tenant); if (clean.state && (clean.state as any).state && (clean.state as any).state !== code) delete clean.state;
  const ref = db.doc(`tenants/${tenantId}/staffPay/${staffId}`); const nowIso = new Date().toISOString();
  try {
    await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {}; const was = cur.taxForms || {};
      const signed = { name: signedName, at: nowIso, by: 'self' };
      // (What isn't sent stays as it was: a W-4 sent alone keeps the state's form on file, and the other way round.)
      const next = { ...(was.pretax ? { pretax: was.pretax } : {}), ...(was.payMethod ? { payMethod: was.payMethod } : {}),
        ...(clean.federal ? { federal: clean.federal } : was.federal ? { federal: was.federal } : {}), ...(clean.state ? { state: clean.state } : was.state ? { state: was.state } : {}), updatedAt: nowIso, signed };
      const history = [{ at: nowIso, signedName, federal: clean.federal || null, state: clean.state || null }, ...(Array.isArray(cur.taxFormsHistory) ? cur.taxFormsHistory : [])].slice(0, 8);
      tx.set(ref, { staffId, taxForms: next, taxFormsHistory: history, updatedAt: nowIso }, { merge: true });
    });
    // (The owner hears about it, unless it's the owner's own.)
    const ownerId = await ensureOwnerTeamMember(db, tenantId).catch(() => null);
    const stName = stateSpec(code)?.form && !stateSpec(code)!.form!.federal ? stateSpec(code)!.form!.name : null;
    if (ownerId && ownerId !== staffId) {
      const note = db.collection(`tenants/${tenantId}/notifications`).doc(); const title = `${String(m.name || 'Someone')} updated their tax forms`;
      const body = `Their W-4${clean.state && stName ? ` and ${stName}` : ''}, signed ${signedName}. It counts from the next payday.`;
      await note.set({ id: note.id, userId: ownerId, type: 'tax_forms_changed', priority: 'normal', title, body, message: `${title}. ${body}`, link: '/money?tab=payday', read: false, createdAt: nowIso });
    }
    await logAuditAdmin(db, tenantId, { action: 'payroll.tax_forms_self', targetType: 'staff', targetId: staffId,
      summary: `${String(m.name || 'A team member')} filled in their own tax forms (W-4${clean.state && stName ? ` and ${stName}` : ''}), signed by typed name`,
      actor: { type: 'user', id: staffId, name: String(m.name || 'Team member'), via: 'pay-tab' } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[pay/tax-forms]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Not sent. Try again.' }, { status: 500 });
  }
}
