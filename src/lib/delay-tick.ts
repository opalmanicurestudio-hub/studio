// src/lib/delay-tick.ts — TELLING PEOPLE WHEN A VISIT RUNS BEHIND (server only). Runs inside the ops tick.
// For each visit in service that is at least the business's margin behind (default 5 min), and each visit it pushes back:
//   • the next visit records when it is now expected to start (the desk, planner and the visit page read this),
//   • the next client's provider is told, if it is someone else,
//   • housekeeping is told when a station reset moves,
//   • the client: by default the desk confirms first ("Tell Bea" on the front desk); a business can choose to send
//     automatically up to a limit, or never. Every message and notice is written to the audit log.
// It tells again only when the knock-on grows by another margin, so a slow overrun doesn't send a text every 5 minutes.
import { delayChain, delaySettings, delayClientText, worthTelling } from '@/lib/delay';
import { attendantIds } from '@/lib/attendant';

const clock = (v: number, tz?: string) => new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined });

export async function delayTick(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<number> {
  const T = `tenants/${tenantId}`; const at = new Date(now).toISOString(); const tz = tenant?.timezone || tenant?.timeZone;
  const live = await db.collection(`${T}/appointments`).where('status', '==', 'servicing').limit(60).get();
  if (!live.docs.length) return 0;
  const rows = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const day = await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 6 * 3600000).toISOString()).where('startTime', '<=', new Date(now + 12 * 3600000).toISOString()).get();
  const appts = [...rows(day)]; for (const a of rows(live)) if (!appts.some((x) => x.id === a.id)) appts.push(a);
  const services = rows(await db.collection(`${T}/services`).get());
  const S = delaySettings(tenant);
  const chain = delayChain({ appts, services, now, settings: S });
  if (!chain.length) return 0;
  const staff = rows(await db.collection(`${T}/staff`).get());
  const nameOf = (id: string | null) => String(staff.find((m: any) => m.id === id)?.name || '').split(' ')[0];
  const managers = staff.filter((m: any) => ['owner', 'admin', 'manager'].includes(String(m.role)) && m.active !== false).map((m: any) => m.id);
  const keepers = attendantIds(tenant).filter((id) => staff.some((m: any) => m.id === id && m.active !== false && !m.onBreak));
  const { logAuditAdmin } = await import('@/lib/audit');
  let sent = 0;
  for (const e of chain) {
    const src = appts.find((x) => x.id === e.visitId) || {};
    const b = db.batch(); let writes = 0;
    const note = (userId: string, type: string, message: string, appointmentId: string) => { const ref = db.collection(`${T}/notifications`).doc(); b.set(ref, { id: ref.id, userId, type, priority: 'high', link: '/pos', appointmentId, message, createdAt: at, read: false }); writes++; };
    // The late visit itself: what it is now expected to do (shown on the desk / planner).
    if (worthTelling(e.delayMin, src.delay?.toldMin, S.marginMin)) {
      b.set(db.doc(`${T}/appointments/${e.visitId}`), { delay: { min: e.delayMin, clientEndAt: new Date(e.clientEndMs).toISOString(), freeAt: new Date(e.freeMs).toISOString(), toldMin: e.delayMin, at } }, { merge: true }); writes++;
      // The desk / managers hear about it once per margin step, with who is affected.
      const affected = e.next.filter((k) => k.lateMin >= 1).map((k) => `${k.clientName.split(' ')[0]} ${clock(k.startMs, tz)} → ~${clock(k.expectedMs, tz)}`).join(', ');
      for (const uid of managers) note(uid, 'visit_delay', `${e.clientName.split(' ')[0]}${nameOf(e.staffId) ? ` with ${nameOf(e.staffId)}` : ''} is running ${e.delayMin} min behind${affected ? ` — moves ${affected}` : ''}.`, e.visitId);
      // Housekeeping: the station reset moves.
      if (e.stationIds.length) for (const uid of (keepers.length ? keepers : [])) note(uid, 'visit_delay', `Station reset moves: ${e.clientName.split(' ')[0]} now finishes about ${clock(e.clientEndMs, tz)} (${e.delayMin} min behind) — reset after that.`, e.visitId);
      await logAuditAdmin(db, tenantId, { action: 'visit.running_behind', targetType: 'appointment', targetId: e.visitId, actor: { type: 'system', name: 'delay check' }, summary: `${e.clientName}: ${e.delayMin} min behind; free again ${clock(e.freeMs, tz)}${affected ? `; moves ${affected}` : ''}` }).catch(() => {});
    }
    for (const k of e.next) {
      const nx = appts.find((x) => x.id === k.id) || {};
      if (!worthTelling(k.lateMin, nx.delayedBy?.toldMin, S.marginMin)) continue;
      const fields: any = { expectedStartAt: new Date(k.expectedMs).toISOString(), delayedBy: { visitId: e.visitId, min: k.lateMin, why: k.why, toldMin: k.lateMin, at } };
      // Their provider (if not the one running late — they already know)
      if (k.staffId && k.staffId !== e.staffId) note(k.staffId, 'delay_affects_you', `Your ${clock(k.startMs, tz)} (${k.clientName.split(' ')[0]}) will start about ${k.lateMin} min late — ${k.why === 'station' ? 'the station is still in use' : 'the client before is running over'}.`, k.id);
      // The client
      const already = Math.max(Number(nx.delayTold?.min) || 0, Number(nx.providerDelay?.minutes) || 0) || null;
      if (S.clientMessages === 'auto' && k.lateMin <= S.autoMaxMin && worthTelling(k.lateMin, already, S.marginMin)) {
        const r = await tellClientDelay(db, tenantId, tenant, { ...nx, id: k.id }, k.expectedMs, nameOf(nx.staffId) || null, null);
        fields.delayTold = { min: k.lateMin, at, via: r.via, by: 'Automatic' }; fields.delayToConfirm = false; if (r.via !== 'none') sent++;
      } else if (S.clientMessages !== 'off' && worthTelling(k.lateMin, already, S.marginMin)) fields.delayToConfirm = true;   // the desk shows "Tell <name>"
      b.set(db.doc(`${T}/appointments/${k.id}`), fields, { merge: true }); writes++;
    }
    if (writes) await b.commit();
  }
  try { await (await import('@/lib/push')).pushNow(db, tenantId); } catch { /* the minute push job sends it */ }
  return sent;
}

/** Text (or email) one client that their visit will start late; updates their visit page; audited. */
export async function tellClientDelay(db: any, tenantId: string, tenant: any, ap: any, expectedMs: number, providerFirst: string | null, by: { uid?: string; name: string } | null, requestOrigin?: string | null): Promise<{ via: 'sms' | 'email' | 'both' | 'none'; message: string }> {
  const T = `tenants/${tenantId}`; const studio = tenant?.name || tenant?.businessName || 'the studio';
  const startMs = Date.parse(String(ap.startTime || '')) || 0;
  const late = Math.max(1, Math.round((expectedMs - startMs) / 60000)); const choiceFrom = delaySettings(tenant).choiceFromMin;
  const credit = Number(tenant?.bookingPolicies?.providerDelayCredit) || 0;
  const message = delayClientText({ first: String(ap.clientName || '').split(' ')[0] || 'there', provider: providerFirst, startMs, expectedMs, timeZone: tenant?.timezone || tenant?.timeZone })
    + (late >= choiceFrom ? ` If that doesn’t work, you can reschedule or cancel with no fee from your visit link.${credit > 0 ? ` If you’re happy to wait, we’ll add $${credit.toFixed(2)} credit as a thank-you.` : ''}` : '');
  let email = false, sms = false;
  try {
    const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, requestOrigin || null);
    const link = ap.checkInToken ? `${base}/check-in/${ap.checkInToken}` : null;
    const cl: any = ap.clientId ? (((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
    const em = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
    const { sendNotification } = await import('@/lib/notify');
    if (phone) sms = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'delay_notice', text: `${studio}: ${message}${link ? ` ${link}` : ''}`, appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok;
    if (!sms && em.includes('@')) { const { brandedEmailHtml } = await import('@/lib/email-template');
      email = !!(await sendNotification(db, { tenantId, channel: 'email', to: em, subject: `Running a little behind — ${studio}`, kind: 'delay_notice', html: brandedEmailHtml({ studioName: studio, title: 'Running a little behind', bodyLines: [message], cta: link ? { label: 'My visit', url: link } : null }), appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok; }
    // Their visit page shows the same update. From the business's "offer a choice" point (default 15 min) it is the
    // usual provider-delay card — keep it / reschedule / cancel, no fee, plus any thank-you credit the business offers.
    // Below that it is a simple message from the studio.
    const f: any = late >= choiceFrom ? { providerDelay: { minutes: late, newStartAt: new Date(expectedMs).toISOString(), at: new Date().toISOString(), by: by?.name || 'Automatic', reply: null }, providerLateMinutes: late }
      : { lateReply: { kind: 'studio_delay', message, at: new Date().toISOString(), by: by?.name || 'Automatic' }, studioAskedToMove: false };
    await db.doc(`${T}/appointments/${ap.id}`).set(f, { merge: true });
    if (ap.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${ap.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`${T}/appointmentCheckIns/${ap.checkInToken}`).set(f, { merge: true }).catch(() => {})]);
  } catch (e) { console.error('[delay] tell failed', e); }
  const via = sms && email ? 'both' : sms ? 'sms' : email ? 'email' : 'none';
  const { logAuditAdmin } = await import('@/lib/audit');
  await logAuditAdmin(db, tenantId, { action: 'appointment.delay_told', targetType: 'appointment', targetId: ap.id, actor: by ? { type: 'user', id: by.uid, name: by.name } : { type: 'system', name: 'delay check' },
    summary: `${ap.clientName || 'Client'} told their visit starts late (~${Math.round((expectedMs - startMs) / 60000)} min)${via === 'none' ? ' — no phone or email on file, not sent' : ` by ${via === 'sms' ? 'text' : via}`}` }).catch(() => {});
  return { via, message };
}
