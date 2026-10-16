// src/app/api/klair/route.ts — KLAIR (lib/klair). One request at a time, in three steps the person always sees:
//   ask     { tenantId, text, context?: { appointmentId? }, voice? } → an answer, "which one?", a preview of a change,
//           or "needs your OK"
//   choose  { tenantId, id, pick }  → after "which one?": the preview for the chosen person
//   confirm { tenantId, id }        → does it, through the same routes the app uses (rules, messages and the activity
//                                     log stay identical), and returns what changed, with Undo where it can be undone
//   undo    { tenantId, id }
// Pending steps live in tenants/{t}/klairActions for 15 minutes and only for the person who asked. Signed-in team
// members only, within their own permissions. Part of the ClarityFlow Assistant add-on.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { klairSettings, planPrompt, cleanPlan, plainPlan, matchPeople, underline, spokenLine, ACT_INTENTS, type Plan, type Candidate } from '@/lib/klair';
import { tenantTimeZone, todayIn, wallToUtc, addDays, dayKey, wallParts, formatShortDay, formatTime } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });
const rows = (s: any) => (s?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const ms = (v: any) => Date.parse(String(v || '')) || 0;
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const LIVE = ['confirmed', 'booked', 'scheduled', 'pending', 'deposit_pending', 'pending_payment', 'checked_in', 'waiting'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80); if (!tenantId) return j({ ok: false, error: 'Which business?' }, 400);
  const auth: any = await verifyStaffActor(req, tenantId); if (!auth.ok) return j({ ok: false, error: auth.error }, auth.status || 401);
  const t = auth.tenant; const K = klairSettings(t); const actor = auth.actor;
  if (!K.on) return j({ ok: false, code: 'klair_off', error: `${K.name} is part of the ClarityFlow Assistant add-on. An owner can turn her on in Settings.` }, 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const tz = tenantTimeZone(t); const now = Date.now();
  const say = (kind: Parameters<typeof spokenLine>[0], o: any = {}) => (b.voice || b.action !== 'ask' ? spokenLine(kind, o) : null);
  const when = (iso: string) => `${formatShortDay(iso, tz)}, ${formatTime(iso, tz)}`;
  // Forward to the app's own routes as this person (same rules, same messages, same activity log).
  const call = async (path: string, body: any) => { const r = await fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: req.headers.get('authorization') || '' }, body: JSON.stringify({ tenantId, ...body }) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) } as any; };
  const pending = db.collection(`${T}/klairActions`);

  // ── CONFIRM / UNDO / CHOOSE: a step she already showed ──
  if (b.action === 'confirm' || b.action === 'undo' || b.action === 'choose') {
    const ref = pending.doc(String(b.id || '').slice(0, 40)); const p: any = (await ref.get()).data();
    if (!p || p.by !== actor.uid) return j({ ok: false, error: 'That’s no longer waiting. Ask again.' }, 404);
    if (b.action === 'choose') {
      if (p.status !== 'choose' || ms(p.expiresAt) < now) return j({ ok: false, error: 'That’s no longer waiting. Ask again.' }, 409);
      const c: Candidate | undefined = p.candidates?.[Number(b.pick)]; if (!c) return j({ ok: false, error: 'Pick one of them.' }, 400);
      await ref.set({ status: 'closed' }, { merge: true });
      return j(await previewFor(p.plan, c));
    }
    if (b.action === 'confirm') {
      if (p.status !== 'pending' || ms(p.expiresAt) < now) return j({ ok: false, error: 'That’s no longer waiting. Ask again.' }, 409);
      const r = await execute(p); await ref.set({ status: r.ok ? 'done' : 'failed', doneAt: new Date().toISOString(), result: r.text || r.error || null, ...(r.undo ? { undo: r.undo } : {}) }, { merge: true });
      return j(r.ok ? { ok: true, kind: 'done', id: ref.id, text: r.text, canUndo: !!r.undo, say: say('done', { name: p.who?.clientName || '' }) } : { ok: false, error: r.error || 'That didn’t work.' });
    }
    if (p.status !== 'done' || !p.undo || ms(p.doneAt) < now - 15 * 60000) return j({ ok: false, error: 'That can’t be undone now. Open the visit to change it.' }, 409);
    const r = await call(p.undo.path, p.undo.body); const ok = r.ok !== false && r.status < 400;
    if (ok) await ref.set({ status: 'undone', undoneAt: new Date().toISOString() }, { merge: true });
    return j(ok ? { ok: true, kind: 'done', text: 'Undone. Everything is back as it was.', say: 'Undone.' } : { ok: false, error: r.error || 'That couldn’t be undone. Open the visit to change it.' });
  }

  // ── ASK ──
  const heard = String(b.text || '').trim().slice(0, 400); if (!heard) return j({ ok: false, error: 'Say or type what you need.' }, 400);
  const today = todayIn(tz); const weekday = new Date(wallToUtc(today, 12, 0, tz)).toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  const apSnap = await db.collection(`${T}/appointments`).where('startTime', '>=', addDays(today, -120)).where('startTime', '<=', addDays(today, 61)).get().catch(() => ({ docs: [] }));
  const appts = rows(apSnap); const staff = rows(await db.collection(`${T}/staff`).get().catch(() => ({ docs: [] })));
  const ctxAppt = b.context?.appointmentId ? appts.find((a: any) => a.id === String(b.context.appointmentId)) || null : null;
  // Read the request: the model if connected (and credits allow), else plain words.
  let plan: Plan = plainPlan(heard);
  try { const { aiConfigured, askAI, parseJson } = await import('@/lib/ai');
    // The add-on covers her reading; every call is still logged with its cost against this business (lib/ai).
    if (aiConfigured()) { const r = await askAI({ tier: 'fast', maxTokens: 300, purpose: 'klair', tenantId, system: planPrompt({ today, weekday, tz, name: K.name, inVisitClient: ctxAppt?.clientName || null }), prompt: heard });
      const pj = r.ok ? parseJson(r.text) : null; if (pj) plan = cleanPlan(pj, heard); } } catch { /* plain words */ }
  const shown = underline(heard, plan.spans);
  const base = { ok: true, heard, shown, intent: plan.intent };

  // Answers
  if (plan.intent === 'unknown') return j({ ...base, kind: 'answer', text: `I didn’t catch what to do. Try “move Sam to Thursday at 3”, “who hasn’t confirmed tomorrow?” or “tell my next client I’m 10 minutes late”.`, say: say('answer', { text: 'I didn’t catch that. Try again?' }) });
  if (plan.intent === 'next') {
    const mine = appts.filter((a: any) => LIVE.includes(String(a.status)) && ms(a.startTime) >= now - 30 * 60000 && (!actor.isManager ? a.staffId === actor.uid : true)).sort((x: any, y: any) => ms(x.startTime) - ms(y.startTime));
    const n = mine[0]; const text = n ? `Next: ${n.clientName || 'a client'}, ${String(n.serviceName || 'visit').toLowerCase()} at ${formatTime(n.startTime, tz)}${staff.find((m: any) => m.id === n.staffId) ? ` with ${first(staff.find((m: any) => m.id === n.staffId).name)}` : ''}${n.checkInStatus === 'arrived' ? '. They’re here.' : '.'}` : 'Nothing else booked today.';
    return j({ ...base, kind: 'answer', text, open: n ? n.id : null, say: say('answer', { text }) });
  }
  if (plan.intent === 'unconfirmed') {
    const { unconfirmedOn, needsConfirm } = await import('@/lib/confirm-ask'); void unconfirmedOn;
    const tomorrow = addDays(today, 1); const list = appts.filter((a: any) => dayKey(new Date(a.startTime), tz) === tomorrow && needsConfirm(a)).sort((x: any, y: any) => ms(x.startTime) - ms(y.startTime));
    if (!list.length) return j({ ...base, kind: 'answer', text: 'Everyone tomorrow has confirmed.', say: say('answer', { text: 'Everyone tomorrow has confirmed.' }) });
    const ref = pending.doc(); const items = list.map((a: any) => ({ id: a.id, label: `${a.clientName || 'Client'}, ${String(a.serviceName || 'visit').toLowerCase()}`, sub: `${formatTime(a.startTime, tz)}${staff.find((m: any) => m.id === a.staffId) ? ` with ${first(staff.find((m: any) => m.id === a.staffId).name)}` : ''}` }));
    await ref.set({ by: actor.uid, status: 'pending', kind: 'confirm_many', payload: { ids: list.map((a: any) => a.id) }, createdAt: new Date().toISOString(), expiresAt: new Date(now + 15 * 60000).toISOString() });
    const text = `${list.length} visit${list.length === 1 ? '' : 's'} tomorrow ${list.length === 1 ? 'isn’t' : 'aren’t'} confirmed.`;
    return j({ ...base, kind: 'list', id: ref.id, text, items, confirmLabel: `Ask ${list.length === 1 ? 'them' : `all ${list.length}`}`, say: say('answer', { text }) });
  }
  if (plan.intent === 'gaps') {
    const todays = appts.filter((a: any) => dayKey(new Date(a.startTime), tz) === today && LIVE.concat(['servicing']).includes(String(a.status)));
    const gaps: string[] = [];
    for (const m of staff) { const list = todays.filter((a: any) => a.staffId === m.id).sort((x: any, y: any) => ms(x.startTime) - ms(y.startTime));
      for (let i = 1; i < list.length; i++) { const from = Math.max(now, ms(list[i - 1].endTime || list[i - 1].startTime)); const mins = Math.round((ms(list[i].startTime) - from) / 60000);
        if (mins >= 30) gaps.push(`${first(m.name)}: ${mins} min from ${formatTime(new Date(from).toISOString(), tz)}`); } }
    const text = gaps.length ? `Open time today. ${gaps.slice(0, 5).join('. ')}.` : 'No gaps of 30 minutes or more left today.';
    return j({ ...base, kind: 'answer', text, say: say('answer', { text }) });
  }
  if (plan.intent === 'week') {
    if (!actor.isManager && !(actor.caps || []).includes('money.view')) return j({ ...base, kind: 'answer', text: 'Only people who can see the business’s numbers can ask that.' });
    const { weekNumbers } = await import('@/lib/week-numbers');
    const wk = (() => { const d = new Date(wallToUtc(today, 12, 0, tz)); const dow = d.getUTCDay(); return addDays(today, -dow); })();
    const tx = rows(await db.collection(`${T}/transactions`).where('date', '>=', addDays(wk, -7)).get().catch(() => ({ docs: [] })));
    const bills = rows(await db.collection(`${T}/billDefinitions`).get().catch(() => ({ docs: [] })));
    const services = rows(await db.collection(`${T}/services`).get().catch(() => ({ docs: [] })));
    const n = weekNumbers({ weekStart: new Date(wallToUtc(wk, 0, 0, tz)), transactions: tx, appointments: appts, services, billDefinitions: bills, tenant: t, openDays: 5 });
    const $ = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
    const text = `Taken so far ${$(n.taken)}${n.vsLastWeek != null ? `, ${n.vsLastWeek >= 0 ? `${n.vsLastWeek}% ahead of` : `${-n.vsLastWeek}% behind`} last week` : ''}. Still booked ${$(n.stillBooked)}.${n.weeklyCost != null ? ` This week’s share of your bills is ${$(n.weeklyCost)}.` : ''}`;
    return j({ ...base, kind: 'answer', text, say: say('answer', { text: 'Here’s your week.' }) });
  }
  if (plan.intent === 'late') {
    if (!plan.minutes) return j({ ...base, kind: 'answer', text: 'How many minutes behind are you?' });
    const ref = pending.doc();
    await ref.set({ by: actor.uid, status: 'pending', kind: 'late', payload: { staffId: actor.uid, minutes: plan.minutes }, createdAt: new Date().toISOString(), expiresAt: new Date(now + 15 * 60000).toISOString() });
    return j({ ...base, kind: 'preview', id: ref.id, title: `Running ${plan.minutes} minutes behind`, rows: [{ k: 'Who', v: 'Your next clients today' }, { k: 'They get', v: 'A text with the new estimated time and their choices' }], confirmLabel: 'Tell them', say: say('preview', { name: 'Your next clients', change: `${plan.minutes} minutes late` }) });
  }

  // Actions about a person
  if (!ACT_INTENTS.includes(plan.intent)) return j({ ...base, kind: 'answer', text: 'I can’t do that yet.' });
  let cands: Candidate[] = [];
  if (ctxAppt) cands = [{ clientId: ctxAppt.clientId || null, clientName: ctxAppt.clientName || 'This client', phoneLast4: String(ctxAppt.clientPhone || '').replace(/\D/g, '').slice(-4) || null,
    next: ms(ctxAppt.startTime) >= now - 3 * 3600e3 ? { id: ctxAppt.id, startTime: ctxAppt.startTime, serviceName: ctxAppt.serviceName || 'visit', staffName: first(staff.find((m: any) => m.id === ctxAppt.staffId)?.name) } : null, last: { id: ctxAppt.id, startTime: ctxAppt.startTime } }];
  else if (plan.person) cands = matchPeople(plan.person, appts, [], now, staff);
  if (!plan.person && !ctxAppt) return j({ ...base, kind: 'answer', text: 'Who is it for? Say their name.' });
  if (!cands.length) return j({ ...base, kind: 'answer', text: `I couldn’t find a client called ${plan.person} with a visit in the last four months or the next two. Check the name, or open their profile.` });
  if (cands.length > 1) {
    const ref = pending.doc(); await ref.set({ by: actor.uid, status: 'choose', plan, candidates: cands, createdAt: new Date().toISOString(), expiresAt: new Date(now + 15 * 60000).toISOString() });
    return j({ ...base, kind: 'choose', id: ref.id, text: `${cands.length} people match “${plan.person}”. Which one?`, unsure: plan.person,
      options: cands.map((c) => ({ name: c.clientName, sub: [c.next ? `${when(c.next.startTime)}, ${c.next.serviceName.toLowerCase()}${c.next.staffName ? ` with ${c.next.staffName}` : ''}` : c.last ? `Last in ${formatShortDay(c.last.startTime, tz)}` : '', c.phoneLast4 ? `Phone ending ${c.phoneLast4}` : ''].filter(Boolean).join('\n') })),
      say: say('choose', { name: plan.person, count: cands.length }) });
  }
  return j({ ...base, ...(await previewFor(plan, cands[0])) });

  // ── The preview for one person: exactly what would change, stored until they confirm ──
  async function previewFor(p: Plan, c: Candidate): Promise<any> {
    const who = { clientName: c.clientName, phoneLast4: c.phoneLast4, initials: c.clientName.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() };
    const save = async (kind: string, payload: any, extra: any = {}) => { const ref = pending.doc(); await ref.set({ by: actor.uid, status: 'pending', kind, payload, who, plan: p, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), ...extra }); return ref.id; };
    if (p.intent === 'refund') {
      const v = c.next || c.last; return { ok: true, kind: 'needs_ok', who, text: `Refunds and fee changes wait for you. Open ${first(c.clientName)}’s visit to approve it there.`, open: v?.id || null, say: say('needs_ok') };
    }
    if (p.intent === 'move') {
      if (!c.next) return { ok: true, kind: 'answer', text: `${first(c.clientName)} has no visit coming up to move.` };
      if (!p.date || !p.time) return { ok: true, kind: 'answer', text: `When should I move ${first(c.clientName)} to? Say a day and a time.` };
      const toIso = wallToUtc(p.date, Number(p.time.slice(0, 2)), Number(p.time.slice(3, 5)), tz).toISOString();
      const chk = await call('/api/appointments/reschedule', { appointmentId: c.next.id, action: 'check', date: p.date, time: p.time });
      if (chk.reason) return { ok: true, kind: 'answer', who, text: `I can’t move ${first(c.clientName)} to ${when(toIso)}: ${chk.reason}${Array.isArray(chk.times) && chk.times.length ? ` Open that day: ${chk.times.slice(0, 4).join(', ')}.` : ''}` };
      const fromIso = c.next.startTime; const fp = wallParts(new Date(fromIso), tz);
      const id = await save('move', { appointmentId: c.next.id, date: p.date, time: p.time }, { undo: null, back: { date: dayKey(new Date(fromIso), tz), time: `${String(fp.hour).padStart(2, '0')}:${String(fp.minute).padStart(2, '0')}` } });
      return { ok: true, kind: 'preview', id, who, sub: `${c.next.serviceName}${c.next.staffName ? ` with ${c.next.staffName}` : ''}${c.phoneLast4 ? `, phone ending ${c.phoneLast4}` : ''}`,
        rows: [{ k: 'Now', v: when(fromIso), struck: true }, { k: 'Moves to', v: when(toIso), strong: true }, { k: `${first(c.clientName)} gets`, v: 'A text with the new time' }, ...(chk.policyNote ? [{ k: 'Note', v: String(chk.policyNote) }] : [])], confirmLabel: 'Move it',
        say: say('preview', { name: c.clientName, change: `moving to ${formatShortDay(toIso, tz)} at ${formatTime(toIso, tz)}` }) };
    }
    if (p.intent === 'confirm') {
      if (!c.next) return { ok: true, kind: 'answer', text: `${first(c.clientName)} has no visit coming up.` };
      const id = await save('send', { appointmentId: c.next.id, kind: 'confirm' });
      return { ok: true, kind: 'preview', id, who, sub: `${c.next.serviceName}, ${when(c.next.startTime)}`, rows: [{ k: `${first(c.clientName)} gets`, v: 'One text asking them to confirm, with a one-tap link' }], confirmLabel: 'Ask them', say: say('preview', { name: c.clientName, change: 'asking them to confirm' }) };
    }
    if (p.intent === 'send') {
      const kind = p.kind || 'visit_link'; const v = kind === 'visit_link' ? c.next : (c.last || c.next); if (!v) return { ok: true, kind: 'answer', text: `I couldn’t find a visit for ${first(c.clientName)} to send that for.` };
      const words: Record<string, string> = { visit_link: 'Their visit link', aftercare: 'Their aftercare', review: '“How was your visit?”', rebook: 'A link to book their next visit' };
      const id = await save('send', { appointmentId: v.id, kind });
      return { ok: true, kind: 'preview', id, who, sub: `Visit on ${when(v.startTime)}`, rows: [{ k: `${first(c.clientName)} gets`, v: words[kind] }], confirmLabel: 'Send it', say: say('preview', { name: c.clientName, change: `sending ${words[kind].toLowerCase()}` }) };
    }
    if (p.intent === 'rebook') {
      const src = c.last ? appts.find((a: any) => a.id === c.last!.id) : c.next ? appts.find((a: any) => a.id === c.next!.id) : null;
      if (!src) return { ok: true, kind: 'answer', text: `I couldn’t find a visit for ${first(c.clientName)} to book again from.` };
      const weeks = p.weeks || 3; const { engineFor, suggestSlots, usualOf } = await import('@/lib/rebook'); const e = await engineFor(db, tenantId);
      const slots = e ? suggestSlots(e, { serviceId: src.serviceId, staffId: src.staffId, fromWeeks: weeks, toWeeks: weeks, usual: usualOf([src.startTime], tz), count: 3 }) : [];
      if (!slots.length) return { ok: true, kind: 'answer', text: `Nothing is open with ${first(staff.find((m: any) => m.id === src.staffId)?.name) || 'them'} around ${weeks} weeks out. Open the planner to pick a time.` };
      const s = slots[0]; const id = await save('book', { serviceId: src.serviceId, staffId: s.staffId, startTime: s.startIso, clientId: src.clientId || null });
      return { ok: true, kind: 'preview', id, who, sub: `${src.serviceName || 'Same service'}, as last time`, rows: [{ k: 'Books', v: `${s.dayLabel} at ${s.label}`, strong: true }, { k: 'With', v: s.staffName }, { k: `${first(c.clientName)} gets`, v: 'Their booking confirmation' }],
        others: slots.slice(1).map((x: any) => `${x.dayLabel} at ${x.label}`), confirmLabel: 'Book it', say: say('preview', { name: c.clientName, change: `${s.dayLabel} at ${s.label}` }) };
    }
    return { ok: true, kind: 'answer', text: 'I can’t do that yet.' };
  }

  // ── Doing it, through the app's own routes ──
  async function execute(p: any): Promise<{ ok: boolean; text?: string; error?: string; undo?: any }> {
    if (p.kind === 'move') { const r = await call('/api/appointments/reschedule', { appointmentId: p.payload.appointmentId, action: 'move', date: p.payload.date, time: p.payload.time });
      if (r.ok === false || r.status >= 400) return { ok: false, error: r.error || 'The move didn’t go through.' };
      return { ok: true, text: `Moved ${p.who?.clientName || 'the visit'}. ${first(p.who?.clientName)} has been texted the new time.`, undo: { path: '/api/appointments/reschedule', body: { appointmentId: p.payload.appointmentId, action: 'move', date: p.back.date, time: p.back.time, initiatedBy: 'studio', applyFee: false } } }; }
    if (p.kind === 'late') { const r = await call('/api/appointments/provider-late', { staffId: p.payload.staffId, minutes: p.payload.minutes });
      if (r.ok === false || r.status >= 400) return { ok: false, error: r.error || 'That didn’t go through.' };
      return { ok: true, text: `Your next clients have been told you’re about ${p.payload.minutes} minutes behind.`, undo: { path: '/api/appointments/provider-late', body: { staffId: p.payload.staffId, minutes: 0 } } }; }
    if (p.kind === 'send') { const r = await call('/api/visits/send-client', { appointmentId: p.payload.appointmentId, kind: p.payload.kind });
      return r.ok ? { ok: true, text: `Sent to ${p.who?.clientName || 'them'} by ${r.via === 'sms' ? 'text' : 'email'}.` } : { ok: false, error: r.reason || r.error || 'It couldn’t be sent.' }; }
    if (p.kind === 'confirm_many') { let sent = 0; for (const id of p.payload.ids || []) { const r = await call('/api/visits/send-client', { appointmentId: id, kind: 'confirm' }); if (r.ok) sent++; }
      return sent ? { ok: true, text: `Asked ${sent} client${sent === 1 ? '' : 's'} to confirm.` } : { ok: false, error: 'None could be sent. Check their numbers on the visits.' }; }
    if (p.kind === 'book') { const r = await call('/api/appointments/book', { source: 'front-desk', serviceId: p.payload.serviceId, staffId: p.payload.staffId, startTime: p.payload.startTime, client: p.payload.clientId ? { id: p.payload.clientId } : undefined, internalNotes: 'Booked by the assistant' });
      return r.ok === false || r.status >= 400 ? { ok: false, error: r.error || 'The booking didn’t go through.' } : { ok: true, text: `Booked ${p.who?.clientName || 'them'} for ${when(p.payload.startTime)}. They’ll get their confirmation.` }; }
    return { ok: false, error: 'I can’t do that yet.' };
  }
}
